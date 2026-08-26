/**
 * Tests for the rules that, if wrong, are wrong silently.
 *
 * Everything here guards a decision recorded in a comment somewhere else: the
 * barcode gate, the title fold, the work key, and the matcher's author rule.
 * A change that breaks one of these does not throw at runtime — it files a book
 * under the wrong row, or writes a review nobody can find.
 *
 * Run with `npm test` (Node 22+ strips the types; no build step, no framework).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyScannedCode, isBooklandEan13, isValidIsbn13, toIsbn10, toIsbn13 } from '../src/isbn.ts';
import {
  cleanAudiobookTitle,
  normaliseTitle,
  cleanTitleWithSeries,
  detectSeriesFromTitle,
  parseSeriesFromTitle,
  parseVolumeNumber,
  parseWorkKey,
  primaryAuthor,
  splitAuthors,
  workKeyFor,
} from '../src/titles.ts';
import {
  buildWorkIndex,
  foldSeriesNames,
  foldVolumeMarker,
  isBareSeriesTitle,
  matchIndexedWork,
  matchIndexedWorkAll,
  titleSimilarity,
} from '../src/matching.ts';
import {
  corroborate,
  samePublisher,
  seriesMentioned,
  volumeMentioned,
  volumeStatedIn,
} from '../src/corroboration.ts';
import {
  blankLine,
  hasPendingLookups,
  isAddable,
  isOutstanding,
  jobSummary,
  lookupProgress,
  needsLookup,
  outstandingCount,
  overlapSentence,
  proposedAuthors,
  proposedTitle,
  searchText,
  type ScanLine,
} from '../src/scanjobs.ts';
import {
  copyBlocksDeletion,
  deletionBlockers,
  heldCopies,
  ownedMoreThanOnce,
} from '../src/holdings.ts';
import {
  MAX_COVER_BYTES,
  assembleCoverCandidates,
  checkCoverUpload,
  coverNeeded,
  coverObjectKey,
  extensionFor,
  sniffImageType,
  type CoverCandidateEdition,
} from '../src/covers.ts';
import { SHELF_SCHEMA } from '../src/vision.ts';
import { REFUSED_FIELDS, detailGaps, verdictFor } from '../src/gaps.ts';
import {
  completenessSentence,
  gapAudioLabel,
  gapEvidenceLabel,
  gapSkipLabel,
  gapsCountingAudio,
  gapsInPrint,
  seriesCompleteness,
} from '../src/completeness.ts';
import {
  EBOOK_FILE_FORMATS,
  EDITION_FORMATS,
  EDITION_KINDS,
  EDITION_MEDIA,
  HELD_STATUSES,
  PHYSICAL_FORMATS,
  UNKNOWN_AUTHOR,
  WISHLIST_STATUSES,
  editionMedium,
  isDirectionalRelation,
} from '../src/constants.ts';
import {
  createWorkSchema,
  observedRatingsSchema,
  updateCopySchema,
  updateEditionSchema,
  updateWorkSchema,
} from '../src/schemas.ts';
import {
  aliasedBookIdIndex,
  bookIdFromTitle,
  overrideTitleAliases,
  reviewDocFor,
  reviewSourceOf,
  workKeyForAudiobookRow,
} from '../src/reviews.ts';
import {
  deriveReadState,
  isMyReview,
  observedRatingsFromReviews,
  ratingImpliesRead,
  readFormatFromReviewSource,
} from '../src/readstate.ts';
import {
  auditSentence,
  classifyEdition,
  mediumFromHint,
  pledgeAudit,
  pledgeItemMedium,
  rewardFlags,
  suggestFormat,
} from '../src/crowdfunding.ts';

describe('isbn — the scanner gate', () => {
  it('accepts a real Bookland EAN-13', () => {
    // The Way of Kings, Tor. Verified against Open Library 2026-08-09.
    assert.ok(isValidIsbn13('9780765326355'));
    assert.ok(isBooklandEan13('9780765326355'));
  });

  it('rejects the 5-digit price add-on printed beside it', () => {
    const c = classifyScannedCode('51999');
    assert.equal(c.kind, 'ignore');
    assert.equal(c.kind === 'ignore' ? c.reason : null, 'price_addon');
  });

  it('rejects a valid retail UPC that is not a book', () => {
    // A well-formed EAN-13 with a non-Bookland prefix. Real product, real
    // checksum, and a lookup on it would return something — which is why it
    // must be refused rather than tried.
    const c = classifyScannedCode('0012345678905');
    assert.equal(c.kind, 'ignore');
  });

  it('converts ISBN-10 at the edge so nothing downstream sees two formats', () => {
    assert.equal(toIsbn13('0765326353'), '9780765326355');
    assert.equal(toIsbn10('9780765326355'), '0765326353');
  });

  it('has no ISBN-10 form for a 979 prefix', () => {
    // 979s were allocated after ISBN-10 was retired. Code assuming a round trip
    // is wrong, and this is where that assumption dies.
    const isbn13 = '9791234567896';
    if (isValidIsbn13(isbn13)) assert.equal(toIsbn10(isbn13), null);
  });

  it('recognises a Kindle ASIN and does not mistake it for an ISBN', () => {
    const c = classifyScannedCode('B07XYZ1234');
    assert.equal(c.kind, 'asin');
  });
});

describe('titles — the fold everything else depends on', () => {
  it('folds case, accents, ampersands and a leading article', () => {
    assert.equal(normaliseTitle('The Café & Bar'), 'cafe and bar');
  });

  it('splits authors the way the audiobook catalog displays them', () => {
    assert.deepEqual(splitAuthors('Caroline Peckham, Susanne Valenti'), [
      'Caroline Peckham',
      'Susanne Valenti',
    ]);
    // A translator is not who wrote it and must never become the primary author.
    assert.equal(
      primaryAuthor('Oleg Sapphire, Alexey Kovtunov, Jennifer E. Sunseri - Translator'),
      'Oleg Sapphire',
    );
  });

  it('strips Audible decoration — the measured 5/30 -> 14/30 change', () => {
    assert.equal(cleanAudiobookTitle('Firefight - The Reckoners, Book 2'), 'Firefight');
    assert.equal(cleanAudiobookTitle('Sharp Objects - A Novel'), 'Sharp Objects');
  });

  it('does NOT strip a colon subtitle, even an obviously promotional one', () => {
    // "…: An OP MC Isekai LitRPG" is Amazon keyword stuffing and removing it
    // would help. It is left in anyway, because no rule can tell it from
    // "Mistborn: The Final Empire" — where the text after the colon IS the book.
    // Losing a volume title merges a series into one row; keeping a genre tag
    // costs one failed lookup. The asymmetry decides it.
    assert.equal(
      cleanAudiobookTitle('Arc the SS Tier Heroine Book 3: An OP MC Isekai LitRPG - Arc, Book 3'),
      'Arc the SS Tier Heroine Book 3: An OP MC Isekai LitRPG',
    );
    assert.equal(
      cleanAudiobookTitle('Mistborn: The Final Empire'),
      'Mistborn: The Final Empire',
    );
  });

  it('leaves a bare trailing number alone — "Summoner 6" IS the title', () => {
    assert.equal(cleanAudiobookTitle('Summoner 6'), 'Summoner 6');
  });

  it('strips Audible packaging that is never on a book', () => {
    assert.equal(
      cleanAudiobookTitle('A Court of Mist and Fury (Part 2 of 2) (Dramatized Adaptation)'),
      'A Court of Mist and Fury',
    );
  });

  it('uses the known series name to strip all three suffix spellings', () => {
    // Measured against the real catalog: Audible writes these three ways within
    // one series, and only the middle one has nothing for a pattern to catch.
    const series = 'A Court of Thorns and Roses';
    for (const raw of [
      'A Court of Mist and Fury (Part 1 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses 2',
      'A Court of Mist and Fury (Part 2 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses, Book 2',
      'A Court of Mist and Fury (Part 2 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses',
    ]) {
      assert.equal(cleanTitleWithSeries(raw, series), 'A Court of Mist and Fury');
    }
  });

  it('never empties a title whose name IS its series', () => {
    // "Dune", series "Dune". An empty title half makes the work key author-only,
    // which collides across every book that author wrote.
    assert.equal(cleanTitleWithSeries('Dune', 'Dune'), 'Dune');
  });

  it('reads a series out of a decorated title without guessing one', () => {
    assert.deepEqual(parseSeriesFromTitle('Firefight - The Reckoners, Book 2'), {
      series: 'The Reckoners',
      index: 2,
      display: 'Book 2',
    });
    assert.equal(parseSeriesFromTitle('Sharp Objects').series, null);
  });
});

describe('detectSeriesFromTitle — the shapes an ebook title uses', () => {
  // Every example below is a real title out of the 117 ebook rows already in
  // this catalog, read from the D1 database on 2026-08-10. None of them is
  // hypothetical, and none of them is caught by `parseSeriesFromTitle`.
  const cases: [string, string, number | null, string][] = [
    ['Blackflame (Cradle Book 3)', 'Cradle', 3, 'Book 3'],
    ['The Captain (The Last Horizon Book 1)', 'The Last Horizon', 1, 'Book 1'],
    ['A Killer’s Mind (Zoe Bentley Mystery Book 1)', 'Zoe Bentley Mystery', 1, 'Book 1'],
    [
      'High School DxD - Volume 07 - Ragnarok After the School',
      'High School DxD',
      7,
      'Volume 07',
    ],
    ['Arcane Pathfinder Book 5: Daunting', 'Arcane Pathfinder', 5, 'Book 5'],
    ['Tamer: King of Dinosaurs Book 10', 'Tamer: King of Dinosaurs', 10, 'Book 10'],
    [
      'Rise of the Weakest Summoner: Volume XI',
      'Rise of the Weakest Summoner',
      11,
      'Volume XI',
    ],
    [
      'He Who Fights with Monsters 10: A LitRPG Adventure',
      'He Who Fights with Monsters',
      10,
      '10',
    ],
    ['All The Skills - 5', 'All The Skills', 5, '5'],
  ];

  for (const [raw, series, index, display] of cases) {
    it(`reads ${JSON.stringify(raw)}`, () => {
      assert.deepEqual(detectSeriesFromTitle(raw), { series, index, display });
    });
  }

  it('gives an Extra a label but no sort position', () => {
    // "Extra.3" has no place on a number line. A null sort index puts it after
    // the numbered volumes rather than claiming it is volume 0.
    assert.deepEqual(
      detectSeriesFromTitle(
        "Seirei Tsukai no Blade Dance - Extra.3 - The Princess' Confidential Part-time Job",
      ),
      { series: 'Seirei Tsukai no Blade Dance', index: null, display: 'Extra 3' },
    );
  });

  it('⚠️ never reads a bare trailing number as a volume', () => {
    // The rule `cleanAudiobookTitle` exists to protect: Eric Vall's books really
    // are called "Summoner 6", and six distinct works would collapse into one.
    assert.equal(detectSeriesFromTitle('Summoner 6').series, null);
    assert.equal(detectSeriesFromTitle('Monster Empire 2').series, null);
  });

  it('does not mistake a subtitle for a series', () => {
    for (const raw of [
      'Legion: Skin Deep',
      'Guild Mage: Apprentice',
      'The Tenth Island: Finding Joy, Beauty, and Unexpected Love in the Azores',
      'Board & Conquest: [A Kingdom Building LitRPG]',
      'What If Everybody Said That? (What If Everybody?)',
      'Firstborn / Defending Elysium',
      'Under Ashen Skies- MM',
    ]) {
      assert.equal(detectSeriesFromTitle(raw).series, null, raw);
    }
  });
});

describe('parseVolumeNumber — three spellings, all in this library', () => {
  it('reads Arabic, leading-zero, decimal, word and Roman numerals', () => {
    assert.equal(parseVolumeNumber('10'), 10);
    assert.equal(parseVolumeNumber('07'), 7);
    assert.equal(parseVolumeNumber('2.5'), 2.5);
    assert.equal(parseVolumeNumber('Three'), 3);
    assert.equal(parseVolumeNumber('XI'), 11);
    assert.equal(parseVolumeNumber('IX'), 9);
  });

  it('returns null rather than guessing at a label that is not a number', () => {
    assert.equal(parseVolumeNumber('Prequel'), null);
    assert.equal(parseVolumeNumber('BR SS Compilation'), null);
    assert.equal(parseVolumeNumber(''), null);
  });
});

describe('workKey — the bridge to the audiobook catalog', () => {
  it('joins a paperback to its audiobook', () => {
    // What the audiobook row would produce...
    const audio = workKeyForAudiobookRow('Firefight - The Reckoners, Book 2', 'Brandon Sanderson');
    // ...and what a print copy on the shelf produces.
    const print = workKeyFor('Firefight', 'Brandon Sanderson');
    assert.equal(audio, print);
    assert.equal(print, 'firefight|brandon sanderson');
  });

  it('keeps two different books with the same title apart', () => {
    // The failure the audiobook site's title-only `bookId` cannot avoid, and
    // the entire reason the author is in the key.
    assert.notEqual(workKeyFor('Gold', 'Raven Kennedy'), workKeyFor('Gold', 'Chris Cleave'));
  });

  it('is unaffected by the author-splitter divergence it was designed around', () => {
    // Comma-only (metadata.py) and [;,/&]| and  (audit_site.py) disagree about
    // the LIST but agree about the FIRST name — which is all the key reads.
    assert.equal(
      workKeyFor('Warrior Fae', 'Caroline Peckham, Susanne Valenti'),
      workKeyFor('Warrior Fae', 'Caroline Peckham and Susanne Valenti'),
    );
  });
});

describe('the provisional key — a book with no author (migration 0120)', () => {
  it('normaliseTitle emits only [a-z0-9 ], so no real author can produce a ?', () => {
    // The collision proof's first half, exercised rather than asserted in a
    // comment: sweep the whole Basic Multilingual Plane through the fold and
    // check the output alphabet. Verified independently over an 8,448-codepoint
    // sweep on 2026-08-13; this pins it against any future "improvement" to
    // the fold.
    const allowed = /^[a-z0-9 ]*$/;
    for (let cp = 0; cp <= 0xffff; cp++) {
      // Skip lone surrogates — not real characters, and String.fromCharCode on
      // them makes .normalize() throw on some engines.
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const folded = normaliseTitle(`x${String.fromCharCode(cp)}x`);
      assert.ok(
        allowed.test(folded),
        `normaliseTitle leaked a character outside [a-z0-9 ] for codepoint U+${cp.toString(16)}: ${JSON.stringify(folded)}`,
      );
    }
  });

  it('workKeyFor carries the sentinel through UNFOLDED — the branch is load-bearing', () => {
    // ⚠️ The alphabet proof above is necessary but NOT sufficient:
    // normaliseTitle('?unknown') === normaliseTitle('Unknown') === 'unknown',
    // so if workKeyFor's sentinel branch were deleted ("harmless
    // simplification"), every authorless book would silently collide with any
    // book genuinely credited to "Unknown". This test fails if the branch goes.
    const key = workKeyFor('Who Goes Roar?', UNKNOWN_AUTHOR);
    assert.ok(key.endsWith(`|${UNKNOWN_AUTHOR}`), `provisional key must end |?unknown, got ${key}`);
    assert.equal(key, 'who goes roar|?unknown');

    // The credited-"Unknown" cases a folded sentinel would collide with.
    assert.notEqual(key, workKeyFor('Who Goes Roar?', 'Unknown'));
    assert.notEqual(key, workKeyFor('Who Goes Roar?', 'Author Unknown'));
    assert.equal(workKeyFor('Who Goes Roar?', 'Unknown'), 'who goes roar|unknown');
  });

  it('a provisional key still splits cleanly', () => {
    const parsed = parseWorkKey('who goes roar|?unknown');
    assert.deepEqual(parsed, { title: 'who goes roar', author: UNKNOWN_AUTHOR });
  });

  it('reviewDocFor throws on the sentinel — it must never reach Firestore', () => {
    // The refusal is the entire reason remediation is a free move: zero review
    // documents can carry a provisional key, so zero can be orphaned when the
    // author arrives and the key moves. Asserted, not left as a comment.
    assert.throws(
      () =>
        reviewDocFor({
          title: 'Who Goes Roar?',
          authors: UNKNOWN_AUTHOR,
          displayName: 'Skylar',
          rating: 4,
          text: '',
        }),
      /provisional/i,
    );
  });

  it('the create schema refuses the sentinel as caller vocabulary, but accepts null', () => {
    const base = { title: 'Who Goes Roar?' };
    assert.equal(createWorkSchema.safeParse({ ...base, authors: UNKNOWN_AUTHOR }).success, false);
    const ok = createWorkSchema.safeParse({ ...base, authors: null });
    assert.equal(ok.success, true);
    assert.equal(ok.success ? ok.data.authors : 'x', null);
    // And authorless stays explicit: omitting the field entirely is refused.
    assert.equal(createWorkSchema.safeParse({ ...base }).success, false);
  });

  it('⚠️ illustrator is a free field, and it can never reach the key', () => {
    // Migration 0130. Accepted on create and update, blank folds to null —
    // and it is NOT frozen, NOT ceremonial: no keyMove needed, ever.
    const created = createWorkSchema.safeParse({
      title: 'Who Goes Roar?',
      authors: 'Christie Hainsby',
      illustrator: 'Shannon Hays',
    });
    assert.equal(created.success && created.data.illustrator, 'Shannon Hays');
    const blank = createWorkSchema.safeParse({ title: 'x', authors: 'y', illustrator: '' });
    assert.equal(blank.success && blank.data.illustrator, null);
    const patched = updateWorkSchema.safeParse({ illustrator: 'Judi Abbot' });
    assert.equal(patched.success, true);
    const cleared = updateWorkSchema.safeParse({ illustrator: null });
    assert.equal(cleared.success, true);
    // THE ONE RULE: the key is title|primaryAuthor and nothing else — it joins
    // ~860 reviews across two catalogs, and folding the illustrator in would
    // make correcting one orphan them. The two-argument signature is the
    // guard; this assertion is the tripwire against widening it.
    assert.equal(workKeyFor.length, 2);
  });
});

describe('reviews — the document the other site already writes', () => {
  it('builds the doc id with THEIR slug, article and all', () => {
    // `bookIdFromTitle` keeps the leading article; `normaliseTitle` strips it.
    // Using the wrong one writes a second review beside the existing one.
    assert.equal(bookIdFromTitle('The Lake House'), 'the-lake-house');
    assert.equal(normaliseTitle('The Lake House'), 'lake house');
  });

  it('carries workKey while leaving bookId untouched', () => {
    const { id, doc } = reviewDocFor({
      title: 'Firefight - The Reckoners, Book 2',
      authors: 'Brandon Sanderson',
      displayName: 'Skylar',
      rating: 4.5,
      text: 'good',
    });
    // bookId from the title AS GIVEN, so it lands on the existing document.
    assert.equal(doc.bookId, 'firefight-the-reckoners-book-2');
    assert.equal(id, 'firefight-the-reckoners-book-2_skylar');
    // workKey from the CLEANED title, so a paperback finds it.
    assert.equal(doc.workKey, 'firefight|brandon sanderson');
  });
});

describe('override aliases — a retitle on the other side must not orphan its reviews', () => {
  // The MP4 title atom, built rather than typed: it is U+00A9 + 'nam', and a
  // source file rewritten through PowerShell can come back with the literal
  // re-encoded (CLAUDE.md records exactly that failure).
  const NAM = String.fromCharCode(0xa9) + 'nam';

  it('a title correction becomes an old-slug → new-slug alias', () => {
    // The hazard, in one entry: every existing review of this book is filed
    // under `implode`, and the next build publishes `Implode - Book 8`.
    const { aliases, ambiguous } = overrideTitleAliases({
      overrides: [
        {
          match: { title: 'Implode', author: 'Dakota Krout' },
          set: { title: 'Implode - The Completionist Chronicles, Book 8' },
        },
      ],
    });
    assert.deepEqual(ambiguous, []);
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].fromBookId, 'implode');
    assert.equal(aliases[0].toBookId, 'implode-the-completionist-chronicles-book-8');
    // ⚠️ `match.title` is the PRE-correction spelling by construction —
    // `edit_overrides.py` keys entries on the tags, not on the published CSV.
    assert.equal(aliases[0].via, 'match.title');
  });

  it('an ASIN-keyed retitle falls back to the tag that was actually read', () => {
    // An asin match block carries no title (carrying one would break the entry
    // on the first retitle — the file's own `_schema` says so), so the only
    // record of the old spelling is the evidence.
    const { aliases } = overrideTitleAliases({
      overrides: [
        {
          match: { asin: 'B07XYZ' },
          set: { title: 'The Way of Kings' },
          evidence: { tags_read: { [NAM]: 'Way of Kings, The (Unabridged)' } },
        },
      ],
    });
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].fromBookId, 'way-of-kings-the-unabridged');
    assert.equal(aliases[0].via, 'evidence.tags_read');
  });

  it('⚠️ an author-only or series-only correction produces NO alias', () => {
    // `bookId` is a slug of the title alone. A corrected author moves the
    // derived workKey — which the backfill recomputes anyway — but the document
    // still matches on its own slug, so an alias here would be noise. All 69
    // entries in production today are of this shape.
    const { aliases } = overrideTitleAliases({
      overrides: [
        { match: { title: 'Implode' }, set: { author: 'Dakota Krout' } },
        { match: { title: 'Implode' }, set: { series: 'The Completionist Chronicles', series_index: '8' } },
      ],
    });
    assert.deepEqual(aliases, []);
  });

  it('a correction that slugs the same is not a rename', () => {
    const { aliases } = overrideTitleAliases([
      { match: { title: 'Gold: A Novel' }, set: { title: 'Gold - A Novel' } },
    ]);
    assert.deepEqual(aliases, []);
  });

  it('⚠️ two corrections claiming one old slug are REFUSED, not guessed', () => {
    // Restamping either would file somebody's review on the wrong book, which
    // is the single failure workKey exists to prevent.
    const { aliases, ambiguous } = overrideTitleAliases([
      { match: { title: 'Gold' }, set: { title: 'Gold - Plated Prisoner 1' } },
      { match: { title: 'Gold' }, set: { title: 'Gold - Mining Guild 3' } },
    ]);
    assert.deepEqual(aliases, []);
    assert.deepEqual(ambiguous, ['gold']);
  });

  it('reads the real file shape, and ignores anything it does not understand', () => {
    // catalog_overrides.json is mostly `_`-prefixed prose plus `canonical_series`;
    // only `overrides` is a list of entries.
    const { aliases } = overrideTitleAliases({
      _description: 'CATALOG CORRECTIONS LAYER',
      canonical_series: { 'the completionist chronicles': 'The Completionist Chronicles' },
      overrides: [null, 'nonsense', {}, { set: { title: 'No match block' } },
        { match: { title: 'Old' }, set: { title: 'New' } }],
    });
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].fromBookId, 'old');
  });

  it('an alias points the old slug at the corrected row', () => {
    const csv = new Map([['implode-the-completionist-chronicles-book-8', { id: 8 }]]);
    const { aliases } = overrideTitleAliases([
      { match: { title: 'Implode' }, set: { title: 'Implode - The Completionist Chronicles, Book 8' } },
    ]);
    const { index, applied, shadowed, dangling } = aliasedBookIdIndex(csv, aliases);
    assert.equal(index.get('implode')?.id, 8);
    assert.equal(applied.length, 1);
    assert.deepEqual([shadowed.length, dangling.length], [0, 0]);
    // The real row is untouched: aliasing adds keys, it never rewrites one.
    assert.equal(index.get('implode-the-completionist-chronicles-book-8')?.id, 8);
  });

  it('⚠️ a live catalog row beats an alias, always', () => {
    // Some other book is published under `implode` today. Pointing its reviews
    // at the renamed book is worse than leaving the rename unmatched.
    const csv = new Map([
      ['implode', { id: 99 }],
      ['implode-the-completionist-chronicles-book-8', { id: 8 }],
    ]);
    const { aliases } = overrideTitleAliases([
      { match: { title: 'Implode' }, set: { title: 'Implode - The Completionist Chronicles, Book 8' } },
    ]);
    const { index, applied, shadowed } = aliasedBookIdIndex(csv, aliases);
    assert.equal(index.get('implode')?.id, 99);
    assert.deepEqual(applied, []);
    assert.equal(shadowed.length, 1);
  });

  it('before the site is rebuilt the old slug is still the live row, and wins', () => {
    // The override is committed but `python -m app.main` has not run, so the
    // CSV still publishes the old title. Matching is fine — it is the ordinary
    // pre-correction case — and the alias must stand aside rather than claim it.
    const csv = new Map([['implode', { id: 8 }]]);
    const { aliases } = overrideTitleAliases([
      { match: { title: 'Implode' }, set: { title: 'Implode - Book 8' } },
    ]);
    const { index, applied, shadowed, dangling } = aliasedBookIdIndex(csv, aliases);
    assert.equal(index.get('implode')?.id, 8);
    assert.deepEqual([applied.length, shadowed.length, dangling.length], [0, 1, 0]);
  });

  it('a corrected title that is in no catalog row at all is dangling, and says so', () => {
    // Neither spelling is published: the book left the library, or something
    // upstream renamed it again. Nothing is invented — it is reported.
    const csv = new Map([['some-other-book', { id: 1 }]]);
    const { aliases } = overrideTitleAliases([
      { match: { title: 'Implode' }, set: { title: 'Implode - Book 8' } },
    ]);
    const { index, applied, dangling } = aliasedBookIdIndex(csv, aliases);
    assert.equal(index.size, 1);
    assert.deepEqual(applied, []);
    assert.equal(dangling.length, 1);
  });
});

describe('matching — the load-bearing change from the board game catalog', () => {
  const shelf = [
    { id: 1, title: 'Gold', authors: 'Raven Kennedy' },
    { id: 2, title: 'Mistborn: The Final Empire', authors: 'Brandon Sanderson' },
  ];
  const index = buildWorkIndex(shelf);

  it('matches an exact title with the right author', () => {
    const m = matchIndexedWork(index, 'Gold', 'Raven Kennedy');
    assert.equal(m?.work.id, 1);
    assert.equal(m?.via, 'exact');
  });

  it('REJECTS an exact title with a different author', () => {
    // The single most important assertion in this file. Without it, a different
    // book called Gold is filed as one already owned, where it is lost rather
    // than merely wrong.
    assert.equal(matchIndexedWork(index, 'Gold', 'Chris Cleave'), null);
  });

  it('keeps the 0.7 fragment guard — a series name is not a volume', () => {
    // "Mistborn" against "Mistborn: The Final Empire" is 8/26 characters: below
    // the 60% containment floor, so it does not match. For books this is not a
    // near miss — the series name and the volume title are routinely both
    // printed on a spine.
    assert.equal(matchIndexedWork(index, 'Mistborn', 'Brandon Sanderson'), null);
  });

  it('scores a one-word fragment of a two-word title below the spine floor', () => {
    // 2*1/(1+2) = 0.67, the measured bogus-match cluster. 0.7 sits above it.
    assert.ok(titleSimilarity('Quandary', 'Zorblax Quandary') < 0.7);
    assert.equal(titleSimilarity('Catan', 'Catan'), 1);
  });

  it('accepts a surname-only spine read via the lower author floor', () => {
    const m = matchIndexedWork(index, 'Gold', 'Kennedy');
    assert.equal(m?.work.id, 1);
  });

  it('honours an alias but still checks the author', () => {
    const aliased = buildWorkIndex(
      [{ id: 3, title: 'Northern Lights', authors: 'Philip Pullman' }],
      [{ workId: 3, alias: 'The Golden Compass' }],
    );
    assert.equal(matchIndexedWork(aliased, 'The Golden Compass', 'Philip Pullman')?.work.id, 3);
    assert.equal(matchIndexedWork(aliased, 'The Golden Compass', 'Someone Else'), null);
  });

  it('treats an alias with no kind as a TITLE alias', () => {
    // Every row written before migration 0005 has no `kind`, and they were all
    // alternate titles. An untyped alias must never reach the author gate.
    const aliased = buildWorkIndex(
      [{ id: 3, title: 'Northern Lights', authors: 'Philip Pullman' }],
      [{ workId: 3, alias: 'Shirtaloon' }],
    );
    assert.equal(matchIndexedWork(aliased, 'Northern Lights', 'Shirtaloon'), null);
  });
});

/**
 * The five *He Who Fights with Monsters* works, and the shape that missed them.
 *
 * Measured on 2026-08-10: Open Library files the series under the pen name
 * Shirtaloon, this catalog files it under Travis Deverell, and the author gate
 * refused every candidate — correctly, on the evidence it had.
 */
describe('matching — author aliases', () => {
  const hwfwm = [
    { id: 94, title: 'He Who Fights with Monsters 2', authors: 'Travis Deverell' },
    { id: 95, title: 'He Who Fights with Monsters 3', authors: 'Travis Deverell' },
  ];

  it('refuses the pen name before the alias exists', () => {
    const bare = buildWorkIndex(hwfwm);
    assert.equal(matchIndexedWork(bare, 'He Who Fights with Monsters 2', 'Shirtaloon'), null);
  });

  it('accepts it afterwards, on every work that carries it', () => {
    const withPenName = buildWorkIndex(hwfwm, [
      { workId: 94, alias: 'Shirtaloon', kind: 'author' },
      { workId: 95, alias: 'Shirtaloon', kind: 'author' },
    ]);
    assert.equal(
      matchIndexedWork(withPenName, 'He Who Fights with Monsters 2', 'Shirtaloon')?.work.id,
      94,
    );
    // ⚠️ Both works claim the same alias, and both keep it. `buildWorkIndex`'s
    // contested-alias rule applies to TITLE aliases only: a title identifies a
    // work, so a contested one identifies neither — a pen name identifies a
    // person and a whole series shares it. Applying rule 2 here would throw away
    // the exact case this feature was built for.
    assert.equal(
      matchIndexedWork(withPenName, 'He Who Fights with Monsters 3', 'Shirtaloon')?.work.id,
      95,
    );
  });

  it('still accepts the name the catalog actually stores', () => {
    const withPenName = buildWorkIndex(hwfwm, [
      { workId: 94, alias: 'Shirtaloon', kind: 'author' },
    ]);
    const m = matchIndexedWork(withPenName, 'He Who Fights with Monsters 2', 'Travis Deverell');
    assert.equal(m?.work.id, 94);
    assert.equal(m?.authorSimilarity, 1);
  });

  it('an author alias does NOT make the book findable by that name as a title', () => {
    // The whole reason `kind` exists. An author alias widens the gate that
    // refuses a wrong book; it must not widen the one that finds a book.
    const withPenName = buildWorkIndex(hwfwm, [
      { workId: 94, alias: 'Shirtaloon', kind: 'author' },
    ]);
    assert.equal(matchIndexedWork(withPenName, 'Shirtaloon', 'Travis Deverell'), null);
  });

  it('still refuses an author who is neither the stored one nor an alias', () => {
    const withPenName = buildWorkIndex(hwfwm, [
      { workId: 94, alias: 'Shirtaloon', kind: 'author' },
    ]);
    assert.equal(
      matchIndexedWork(withPenName, 'He Who Fights with Monsters 2', 'Brandon Sanderson'),
      null,
    );
  });
});

describe('series completeness — what we may and may not claim', () => {
  const own = (index: number, id = index) => ({ index, workId: id });
  const said = (index: number, extra: Record<string, unknown> = {}) => ({
    index,
    workId: null,
    source: 'audiobook_catalog',
    ...extra,
  });

  it('finds a hole between two books we own, and calls it certain', () => {
    // Cradle if we had skipped one. Nothing external is consulted and nothing
    // can make this wrong: a book 4 and a book 2 have a book 3 between them.
    const c = seriesCompleteness('Cradle', [own(1), own(2), own(4)]);
    assert.deepEqual(c.gaps.map((g) => g.index), [3]);
    assert.equal(c.gaps[0]?.evidence, 'interior');
    assert.equal(c.certainGaps, 1);
    assert.equal(c.attestedGaps, 0);
  });

  it('⚠️ does NOT claim a book above the highest we own', () => {
    // THE test. We own Cradle 1–12; the series may or may not have a 13, and
    // nothing in this catalog knows which. Inventing one is the failure this
    // whole module is shaped to prevent.
    const c = seriesCompleteness('Cradle', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => own(n)));
    assert.deepEqual(c.gaps, []);
    assert.equal(c.highestKnown, 12);
    assert.equal(c.openEnded, true);
    assert.match(completenessSentence(c), /Nothing says whether the series goes further/);
  });

  it('infers the volumes below the lowest we own, because a book 7 implies a book 1', () => {
    // Real: this library holds High School DxD volumes 7–21 and none before.
    const c = seriesCompleteness('High School DxD', [7, 8, 9].map((n) => own(n)));
    assert.deepEqual(c.gaps.map((g) => g.index), [1, 2, 3, 4, 5, 6]);
    assert.ok(c.gaps.every((g) => g.evidence === 'earlier'));
    assert.equal(c.certainGaps, 6);
  });

  it('goes above the top only when a source said so, and names the source', () => {
    // Real: Beneath the Dragoneye Moons. We hold 1–6, 9, 10, 12, 13; the
    // audiobook catalog lists 1–16. 7, 8 and 11 are holes; 14–16 are attested.
    const owned = [1, 2, 3, 4, 5, 6, 9, 10, 12, 13].map((n) => own(n));
    const attested = [7, 8, 11, 14, 15, 16].map((n) => said(n, { title: `Book ${n}` }));
    const c = seriesCompleteness('Beneath the Dragoneye Moons', [...owned, ...attested]);

    assert.deepEqual(c.gaps.map((g) => g.index), [7, 8, 11, 14, 15, 16]);
    // 7, 8 and 11 sit between books we own, so they are certain regardless of
    // what any CSV says. 14–16 rest entirely on the source.
    assert.deepEqual(
      c.gaps.filter((g) => g.evidence === 'interior').map((g) => g.index),
      [7, 8, 11],
    );
    assert.equal(c.attestedGaps, 3);
    assert.equal(c.highestKnown, 16);
    assert.match(completenessSentence(c), /at least 16/);
    assert.equal(gapEvidenceLabel(c.gaps[3]!), 'listed in the audiobook catalog');
  });

  it('fills the run up to an attested volume, and says which step is which', () => {
    // Real, and it is why `implied` exists as a separate verdict. We own Legion
    // 1 and 2. The audiobook catalog lists a Legion **4** — the omnibus, "The
    // Many Lives of Stephen Leeds" — and says nothing whatever about 3.
    //
    // Reporting 4 and silently skipping 3 would be absurd: a book numbered 4
    // implies a book 3. But 3's existence rests on the source being right about
    // 4, and unlike 4 we cannot even name it. Two verdicts, not one.
    const c = seriesCompleteness('Legion', [
      own(1),
      own(2),
      said(4, { title: 'Legion: The Many Lives of Stephen Leeds' }),
    ]);
    assert.deepEqual(c.gaps.map((g) => [g.index, g.evidence]), [
      [3, 'implied'],
      [4, 'attested'],
    ]);
    assert.equal(c.gaps[0]?.title, null);
    assert.equal(c.certainGaps, 0);
    assert.equal(c.attestedGaps, 2);
  });

  it('⚠️ wishing for a volume does not fill the gap', () => {
    // Found in a browser, not in a test. Putting an attested volume on the
    // wishlist creates a `work` row for it, and the first version treated any
    // work with a volume number as owned — so the moment you said you wanted
    // book 14, the series reported that you had it.
    //
    // A work with NO copies still counts as held: that is what all 115 imported
    // ebook rows look like, and the opposite rule would empty the whole shelf.
    const c = seriesCompleteness('Beneath the Dragoneye Moons', [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => own(n)),
      { index: 14, workId: 900, wanted: true, title: 'Immortal War' },
    ]);
    assert.deepEqual(c.gaps.map((g) => g.index), [14]);
    assert.equal(c.gaps[0]?.wanted, true);
    assert.equal(c.gaps[0]?.workId, 900);
    assert.equal(c.owned, 13);
    assert.equal(c.wanted, 1);
    // Still 14 — a wish is evidence the volume exists, which it already was.
    assert.equal(c.highestKnown, 14);
  });

  it('⚠️ wanting a second FORMAT of a book we hold does not make it missing', () => {
    // The other half of the same bug, and the one that reached a screen. Cradle
    // 1–12 are all held as EPUBs; wanting a hardcover of book 1 made the series
    // read "11 of 12, 1 to go". The caller decides `wanted`, and its rule is
    // narrow enough that a work with an edition is never a wish — see the note
    // on `SeriesVolumeInput.wanted`.
    const c = seriesCompleteness(
      'Cradle',
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({ index: n, workId: n, wanted: false })),
      { knownTotal: 12, knownTotalSource: "the author's site" },
    );
    assert.deepEqual(c.gaps, []);
    assert.equal(c.owned, 12);
    assert.match(completenessSentence(c), /^All 12\. Complete/);
  });

  it('carries the attested volume’s title so it can be wished for', () => {
    const c = seriesCompleteness('The Divine Dungeon', [own(1), said(2, { title: 'Dungeon Madness', authors: 'Dakota Krout' })]);
    assert.equal(c.gaps[0]?.title, 'Dungeon Madness');
    assert.equal(c.gaps[0]?.authors, 'Dakota Krout');
  });

  it('counts unnumbered volumes without letting them near the arithmetic', () => {
    // The six Blade Dance "Extra" side stories, and the Divine Dungeon omnibus.
    // `parseVolumeNumber` returns null for them on purpose; NaN must not poison
    // Math.min or invent a gap at every integer.
    const c = seriesCompleteness('Seirei Tsukai no Blade Dance', [
      own(1),
      own(2),
      { index: Number.NaN, workId: 99 },
      { index: Number.NaN, workId: 98 },
    ]);
    assert.equal(c.owned, 4);
    assert.equal(c.unnumbered, 2);
    assert.deepEqual(c.gaps, []);
    assert.equal(c.highestKnown, 2);
  });

  it('treats a fractional volume as real but not as a hole', () => {
    // Owning 2.5 must not create a gap at 3, and an attested 2.5 we lack must
    // still be reported — it is missing, it is simply not on the integer line.
    const owning = seriesCompleteness('S', [own(1), own(2), { index: 2.5, workId: 7 }, own(3)]);
    assert.deepEqual(owning.gaps, []);

    const lacking = seriesCompleteness('S', [own(1), own(2), said(2.5), own(3)]);
    assert.deepEqual(lacking.gaps.map((g) => g.index), [2.5]);
    assert.equal(lacking.gaps[0]?.evidence, 'attested');
  });

  it('says nothing at all about a series with no numbered volumes', () => {
    const c = seriesCompleteness('White Sand', [{ index: Number.NaN, workId: 22 }]);
    assert.deepEqual(c.gaps, []);
    assert.equal(c.highestKnown, null);
    assert.match(completenessSentence(c), /none of them numbered/);
  });

  it('only says "complete" when a person typed a total with a source', () => {
    const volumes = [1, 2, 3].map((n) => own(n));
    const bare = seriesCompleteness('The Last Horizon', volumes);
    assert.equal(bare.openEnded, true);
    assert.doesNotMatch(completenessSentence(bare), /Complete/);

    const told = seriesCompleteness('The Last Horizon', volumes, {
      knownTotal: 3,
      knownTotalSource: "the author's own site",
    });
    assert.equal(told.openEnded, false);
    assert.match(completenessSentence(told), /Complete, per the author's own site/);
  });

  it('distinguishes never-checked from checked-and-nothing-found', () => {
    const never = seriesCompleteness('Cradle', [own(1)]);
    assert.equal(never.checked, false);
    assert.equal(never.checkOutcome, null);

    const looked = seriesCompleteness('Cradle', [own(1)], {
      outcome: 'not_found',
      source: 'audiobook_catalog',
    });
    assert.equal(looked.checked, true);
    assert.equal(looked.checkOutcome, 'not_found');
  });

  it('carries checkedAt and checkNote through untouched — provenance, not arithmetic', () => {
    // Migration 0200. Neither field may move a single count: they are read
    // straight off `SeriesCheckInput` and nothing derives from them.
    const c = seriesCompleteness('Cradle', [own(1)], {
      outcome: 'ok',
      source: 'claude_research',
      checkedAt: '2026-08-15 10:00:00',
      note: 'The source describes this as an open-ended run.',
    });
    assert.equal(c.checkSource, 'claude_research');
    assert.equal(c.checkedAt, '2026-08-15 10:00:00');
    assert.equal(c.checkNote, 'The source describes this as an open-ended run.');
  });

  it('checkedAt and checkNote are null when nothing checked this series', () => {
    const c = seriesCompleteness('Cradle', [own(1)]);
    assert.equal(c.checkedAt, null);
    assert.equal(c.checkNote, null);
  });

  describe('a scan: the same attested-volume machinery, a fourth source', () => {
    const scanned = (index: number, extra: Record<string, unknown> = {}) => ({
      index,
      workId: null,
      source: 'claude_research',
      ...extra,
    });

    it('a scanned volume closes no gap by itself — it only names one', () => {
      // The whole rule this feature has to respect: a scan INFORMS the ladder
      // exactly as an audiobook-catalog row already does. It never counts as
      // owned, and it never removes a rung from `gaps` on its own — only
      // `wanted`, `skipped` or an audio holding (all decided elsewhere, never
      // by the scan) can do that.
      const owned = [own(1), own(2), own(4)];
      const scan = [scanned(3, { title: 'Foundation of Ash', year: 2019 })];
      const c = seriesCompleteness('Cradle', [...owned, ...scan]);

      assert.deepEqual(c.gaps.map((g) => g.index), [3]);
      assert.equal(c.gaps[0]?.workId, null);
      assert.equal(c.gaps[0]?.title, 'Foundation of Ash');
      assert.equal(c.gaps[0]?.year, 2019);
      assert.equal(c.gaps[0]?.source, 'claude_research');
    });

    it('scanned-list vs owned-rungs: names every rung the owner does not have', () => {
      // The comparison the "Scan for missing books" button exists to run: a
      // scan reports the whole canonical list (1–5), the shelf holds 1, 2 and
      // 4, and everything else is missing BY NAME — the feature's actual ask.
      const owned = [own(1), own(2), own(4)];
      const scan = [1, 2, 3, 4, 5].map((n) =>
        scanned(n, { title: `Volume ${n}`, year: 2015 + n }),
      );
      const c = seriesCompleteness('Cradle', [...owned, ...scan]);

      assert.deepEqual(c.gaps.map((g) => g.index), [3, 5]);
      assert.deepEqual(
        c.gaps.map((g) => g.title),
        ['Volume 3', 'Volume 5'],
      );
      assert.deepEqual(
        c.gaps.map((g) => g.year),
        [2018, 2020],
      );
      // The scan also re-reported 1, 2 and 4 — see `researchSeriesVolumes`'s
      // header on why it is asked to report the full list rather than only the
      // gap. None of those three may appear as missing: an owned rung wins over
      // an attested row at the same index by construction (`reportFor` in
      // `@lc/db` filters attested rows down to indexes we do not already hold).
      assert.equal(c.owned, 3);
    });

    it('year is null when the scan could not find one, never invented', () => {
      const c = seriesCompleteness('Cradle', [own(1), scanned(2, { title: 'Wax and Wane' })]);
      assert.equal(c.gaps[0]?.year, null);
    });

    it('a manual row is never overwritten by a scan finding the same volume', () => {
      // Not `seriesCompleteness`'s rule — `upsertSeriesVolume`'s, in `@lc/db` —
      // but the shape here is what that rule protects: a hand-typed title must
      // win the same way an audiobook-catalog import already cannot clobber one.
      // Exercised at the arithmetic level by simply never letting a second
      // `SeriesVolumeInput` reach the same index; `@lc/db` is what enforces the
      // ON CONFLICT before either row gets this far.
      const manual = { index: 2, workId: null, source: 'manual', title: "The owner's own title" };
      const c = seriesCompleteness('Cradle', [own(1), manual]);
      assert.equal(c.gaps[0]?.title, "The owner's own title");
      assert.equal(c.gaps[0]?.source, 'manual');
    });
  });
});

describe('series completeness — a rung we own, but not in this catalog', () => {
  const own = (index: number, id = index) => ({ index, workId: id });
  const said = (index: number, extra: Record<string, unknown> = {}) => ({
    index,
    workId: null,
    source: 'audiobook_catalog',
    ...extra,
  });
  /** A migration 0090 row. `work_match` unless a test says otherwise. */
  const onAudio = (index: number, extra: Record<string, unknown> = {}) => ({
    index,
    title: `Volume ${index}`,
    authors: 'Brandon Sanderson',
    audiobookSeries: 'The Stormlight Archive',
    indexDisplay: null,
    matchedVia: 'work_match' as const,
    ...extra,
  });

  /**
   * THE test for this feature, and the shape of the real bug.
   *
   * The household owns every Stormlight Archive audiobook — 1, 2, 2.5, 3, 3.5, 4
   * and 5, verified against `audiobook_catalog/site/catalog.csv` on 2026-08-11 —
   * and this catalog holds one of those titles, *Words of Radiance*, as an ebook.
   *
   * `audiobook_holding` is keyed on `work_id`, so the other six could not be
   * represented at all, and the page read "1 book of at least 5 — 6 missing from
   * the run itself". Six books, every one of them in the house. Telling somebody
   * they lack a book they own is how they buy it twice.
   */
  it('⚠️ does not call a book missing when the household owns it on audio', () => {
    const volumes = [own(2), ...[1, 2.5, 3, 3.5, 4, 5].map((n) => said(n))];
    const audio = [1, 2.5, 3, 3.5, 4, 5].map((n) => onAudio(n));
    const c = seriesCompleteness('The Stormlight Archive', volumes, {}, { audio });

    // Still rungs, still absent from THIS catalog — buying the paperback is a
    // real decision. What they have stopped being is missing.
    assert.equal(c.gaps.length, 6);
    assert.equal(c.certainGaps, 0);
    assert.equal(c.attestedGaps, 0);
    assert.equal(c.onAudio, 6);

    const sentence = completenessSentence(c);
    assert.match(sentence, /nothing here is missing/);
    assert.match(sentence, /6 more you own on audio/);
    assert.doesNotMatch(sentence, /missing from the run itself/);
  });

  it('⚠️ a match on the folded series name alone stays counted as missing', () => {
    // The honesty rail. `'fold'` means nothing but two series names folding
    // together connects the two catalogs — no book was ever identified, and the
    // numbering has never been seen to agree. `matching.ts` opens with three
    // wrong matches the sibling project shipped, every one of which would have
    // read fine as a flat claim.
    const c = seriesCompleteness(
      'Dark Healer',
      [own(1), said(2), said(3)],
      {},
      { audio: [onAudio(2, { matchedVia: 'fold' }), onAudio(3, { matchedVia: 'fold' })] },
    );
    assert.equal(c.onAudio, 0);
    assert.equal(c.maybeOnAudio, 2);
    // Both are still on the missing side of the ledger.
    assert.equal(c.certainGaps + c.attestedGaps, 2);
    assert.match(completenessSentence(c), /2 possibly on audio/);
    assert.doesNotMatch(completenessSentence(c), /you own on audio/);
  });

  it('says which claim it is making, on the rung itself', () => {
    const c = seriesCompleteness(
      'The Stormlight Archive',
      [own(2), said(1, { title: 'The Way of Kings' }), said(3, { title: 'Oathbringer' })],
      {},
      { audio: [onAudio(1), onAudio(3, { matchedVia: 'fold' })] },
    );
    assert.match(gapAudioLabel(c.gaps[0]!)!, /^you own this on audio/);
    assert.match(gapAudioLabel(c.gaps[1]!)!, /^possibly on audio/);
    // ⚠️ Names what was actually compared. A hedge that does not say what is
    // uncertain is a certainty in a quieter font.
    assert.match(gapAudioLabel(c.gaps[1]!)!, /only the series name connects/);
  });

  /**
   * Migration 0110, and the case is *Legion*.
   *
   * This catalog holds books 1 and 2; the sibling catalog's only Legion audiobook
   * is **4**, the omnibus *The Many Lives of Stephen Leeds*. So the two catalogs
   * share no volume, `work_match` — which needs one volume in BOTH, agreeing on
   * its number — is unreachable for ever, and rung 4 hedged permanently over a
   * book the owner had checked by hand and found in the house.
   *
   * ⚠️ The point of the test is the arithmetic, not the wording: an `'owner'` rung
   * must leave the missing count exactly as a `'work_match'` rung does. `held()`
   * in `completeness.ts` is written as "not the hedge" so that adding a value
   * cannot silently keep counting an owned book as missing, and this is what would
   * fail if somebody rewrote it as a list of the values that count.
   */
  it('⚠️ the owner confirming the series match takes the rung out of missing', () => {
    const c = seriesCompleteness(
      'Legion',
      [own(1), own(2), said(4, { title: 'Legion: The Many Lives of Stephen Leeds' })],
      {},
      { audio: [onAudio(4, { matchedVia: 'owner' })] },
    );

    // Still a rung, still absent from this catalog — buying the print omnibus is
    // a real decision. It has stopped being *missing*.
    assert.equal(c.gaps.length, 2);
    assert.equal(c.onAudio, 1);
    assert.equal(c.maybeOnAudio, 0);
    // Rung 3 is still genuinely missing: implied by a volume 4 and owned nowhere.
    assert.equal(c.certainGaps + c.attestedGaps, 1);

    const sentence = completenessSentence(c);
    assert.match(sentence, /1 more you own on audio/);
    assert.doesNotMatch(sentence, /possibly on audio/);
  });

  it('⚠️ says the owner is what settled it, and does not claim a book proved it', () => {
    // The rail, restated for the third value. Both rungs read as owned; only one
    // of them rests on something re-checkable, and the page must not launder the
    // owner's word into evidence — migration 0110.
    const c = seriesCompleteness(
      'Arcane Pathfinder',
      [own(5), said(1, { title: 'Arcane Pathfinder' }), said(2, { title: 'The Beastlands' })],
      {},
      { audio: [onAudio(1, { matchedVia: 'owner' }), onAudio(2)] },
    );
    assert.match(gapAudioLabel(c.gaps[0]!)!, /^you own this on audio/);
    assert.match(gapAudioLabel(c.gaps[0]!)!, /you confirmed the series match/);
    // The corroborated one says nothing about anybody confirming anything.
    assert.match(gapAudioLabel(c.gaps[1]!)!, /^you own this on audio, as “Volume 2”$/);
    assert.equal(c.onAudio, 2);
  });

  it('keeps our source’s title, and only borrows theirs when we have none', () => {
    // The two catalogs spell it differently — "Dawnshard - Stormlight Archive"
    // there — and a rung that renames itself the day an audio match lands reads
    // as a different book.
    const c = seriesCompleteness(
      'The Stormlight Archive',
      [own(1), said(2, { title: 'Words of Radiance' }), said(3)],
      {},
      {
        audio: [
          onAudio(2, { title: 'Words of Radiance - The Stormlight Archive, Book 2' }),
          onAudio(3, { title: 'Oathbringer' }),
        ],
      },
    );
    assert.equal(c.gaps[0]?.title, 'Words of Radiance');
    assert.equal(c.gaps[1]?.title, 'Oathbringer');
  });

  it('⚠️ audio can never raise the ceiling, so it can never invent a volume', () => {
    // The whole module's safety property, restated for the new input. We own
    // Cradle 1–12 and nothing attests a 13; a stray audio row at 13 must not
    // conjure a rung, because `highestKnown` is what stops this fabricating.
    const c = seriesCompleteness(
      'Cradle',
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => own(n)),
      {},
      { audio: [onAudio(13)] },
    );
    assert.deepEqual(c.gaps, []);
    assert.equal(c.highestKnown, 12);
    assert.equal(c.onAudio, 0);
  });
});

describe('series completeness — “I am never buying that one”', () => {
  const own = (index: number, id = index) => ({ index, workId: id });
  const said = (index: number, extra: Record<string, unknown> = {}) => ({
    index,
    workId: null,
    source: 'audiobook_catalog',
    ...extra,
  });
  const skip = (index: number, reason = 'Patreon-only short, never sold') => ({ index, reason });

  /**
   * The real case: the three Patreon-era Completionist Chronicles shorts — 6.5
   * *Havoc in the Deathyards*, 11.5 *Jaxon's New Clients*, 13.5 *Poppy's
   * Promise* — are not sold, so the series read incomplete for ever.
   */
  it('moves a skipped rung out of gaps entirely, rather than flagging it inside', () => {
    const volumes = [
      ...[12, 13, 14].map((n) => own(n)),
      ...[6.5, 11.5, 13.5].map((n) => said(n, { title: `Short ${n}` })),
    ];
    const c = seriesCompleteness(
      'The Completionist Chronicles',
      volumes,
      {},
      { skipped: [6.5, 11.5, 13.5].map((n) => skip(n)) },
    );

    assert.deepEqual(c.skipped.map((g) => g.index), [6.5, 11.5, 13.5]);
    // ⚠️ Not in `gaps`, so every count derived from it — and both chips on the
    // series list, and the "only series with gaps" filter — stop seeing them
    // with no edit to any of those.
    assert.equal(c.gaps.some((g) => g.index === 6.5), false);
    assert.equal(c.gaps.every((g) => g.skipped == null), true);
    assert.equal(gapSkipLabel(c.skipped[0]!), 'skipped — Patreon-only short, never sold');
    assert.equal(gapSkipLabel(c.gaps[0]!), null);
  });

  it('⚠️ says "12 of 15, 3 skipped" and never "12 of 12"', () => {
    // The two readings that were on the table. Shortening the series is a claim
    // about how long it is, and only a sourced `series_check.known_total` may
    // make one — deciding not to buy book 13 does not un-publish it.
    const volumes = [...Array(12)].map((_, i) => own(i + 1));
    const withTotal = { knownTotal: 15, knownTotalSource: "the author's site" };
    const c = seriesCompleteness('S', [...volumes, said(13), said(14), said(15)], withTotal, {
      skipped: [13, 14, 15].map((n) => skip(n, 'novellas, not reading them')),
    });

    const sentence = completenessSentence(c);
    assert.match(sentence, /All 15 accounted for/);
    assert.match(sentence, /12 here/);
    assert.match(sentence, /3 deliberately skipped/);
    // ⚠️ The total is untouched. "12 of 12" would be this app inventing a
    // shorter series, which is the one thing the whole feature refuses.
    assert.equal(c.knownTotal, 15);
    assert.doesNotMatch(sentence, /of 12/);
    assert.doesNotMatch(sentence, /to go/);
  });

  it('still counts what is genuinely outstanding beside what was skipped', () => {
    const c = seriesCompleteness(
      'S',
      [own(1), own(2), said(3), said(4)],
      { knownTotal: 4, knownTotalSource: 'the publisher' },
      { skipped: [skip(4)] },
    );
    assert.match(completenessSentence(c), /2 of 4, per the publisher — 1 to go\./);
    assert.match(completenessSentence(c), /1 deliberately skipped\./);
  });

  it('⚠️ "unbroken" is withdrawn once a rung is skipped', () => {
    // With every remaining hole skipped there is nothing missing, but the run is
    // not unbroken and must not claim to be.
    const c = seriesCompleteness('S', [own(1), own(2), said(3), own(4)], {}, { skipped: [skip(3)] });
    assert.deepEqual(c.gaps, []);
    const sentence = completenessSentence(c);
    assert.doesNotMatch(sentence, /unbroken/);
    assert.match(sentence, /nothing else is missing/);
    assert.match(sentence, /1 deliberately skipped/);
    assert.match(sentence, /Nothing says whether the series goes further/);
  });

  it('skips a rung that no source ever attested, because arithmetic made it', () => {
    // An `earlier` gap exists in no table at all — it is implied by owning book
    // 7. `gap_verdict` could not express this even if it were not keyed on a
    // work id, and it is why skips arrive through `GapContext` rather than
    // through the volume list.
    const c = seriesCompleteness('High School DxD', [7, 8].map((n) => own(n)), {}, {
      skipped: [1, 2, 3].map((n) => skip(n, 'starting at 7 on purpose')),
    });
    assert.deepEqual(c.gaps.map((g) => g.index), [4, 5, 6]);
    assert.deepEqual(c.skipped.map((g) => g.index), [1, 2, 3]);
    assert.equal(c.certainGaps, 3);
  });
});

describe('gapsInPrint / gapsCountingAudio — the by-format headline', () => {
  const own = (index: number, id = index) => ({ index, workId: id });
  const said = (index: number, extra: Record<string, unknown> = {}) => ({
    index,
    workId: null,
    source: 'audiobook_catalog',
    ...extra,
  });
  const onAudio = (index: number, extra: Record<string, unknown> = {}) => ({
    index,
    title: `Volume ${index}`,
    authors: 'Brandon Sanderson',
    audiobookSeries: 'The Stormlight Archive',
    indexDisplay: null,
    matchedVia: 'work_match' as const,
    ...extra,
  });

  it('agree with no audio in the picture at all', () => {
    // High School DxD 7–9: three gaps below the lowest we own, nothing in the
    // sibling catalog consulted. Both numbers are the plain gap count.
    const c = seriesCompleteness('High School DxD', [7, 8, 9].map((n) => own(n)));
    assert.equal(gapsInPrint(c), 6);
    assert.equal(gapsCountingAudio(c), 6);
  });

  it('⚠️ split apart by a CONFIRMED audio holding — the whole point of the pair', () => {
    // The Stormlight Archive case from `completeness.ts`'s own header: six
    // rungs absent from this catalog, all six owned on audio. "In print" must
    // still say 6 — nothing was added to the shelf — while "counting audio"
    // says 0, because every one of those six is in the house.
    const volumes = [own(2), ...[1, 2.5, 3, 3.5, 4, 5].map((n) => said(n))];
    const audio = [1, 2.5, 3, 3.5, 4, 5].map((n) => onAudio(n));
    const c = seriesCompleteness('The Stormlight Archive', volumes, {}, { audio });

    assert.equal(gapsInPrint(c), 6);
    assert.equal(gapsCountingAudio(c), 0);
  });

  it('⚠️ a HEDGED audio match ("fold") moves neither number', () => {
    // The honesty rail again, from the other angle: a folded series name is a
    // guess, not a receipt, so it may not shrink either count. `gapsInPrint`
    // and `gapsCountingAudio` land on the SAME number here — that equality is
    // itself the honest answer ("audio has not actually confirmed anything"),
    // not a sign the pair collapsed to one.
    const c = seriesCompleteness(
      'Dark Healer',
      [own(1), said(2), said(3)],
      {},
      { audio: [onAudio(2, { matchedVia: 'fold' }), onAudio(3, { matchedVia: 'fold' })] },
    );
    assert.equal(gapsInPrint(c), 2);
    assert.equal(gapsCountingAudio(c), 2);
    assert.equal(c.maybeOnAudio, 2);
  });

  it('a mix of confirmed and hedged rungs splits the pair by exactly the confirmed ones', () => {
    const c = seriesCompleteness(
      'The Stormlight Archive',
      [own(2), said(1, { title: 'The Way of Kings' }), said(3, { title: 'Oathbringer' })],
      {},
      { audio: [onAudio(1), onAudio(3, { matchedVia: 'fold' })] },
    );
    // Two gaps total; rung 1 is confirmed (drops out of "counting audio"),
    // rung 3 is only hedged (stays in both numbers).
    assert.equal(gapsInPrint(c), 2);
    assert.equal(gapsCountingAudio(c), 1);
  });

  it('both read zero on a series with nothing missing', () => {
    const c = seriesCompleteness('Cradle', [1, 2, 3].map((n) => own(n)));
    assert.equal(gapsInPrint(c), 0);
    assert.equal(gapsCountingAudio(c), 0);
  });
});

describe('work relations — direction is the meaning', () => {
  it('marks exactly the two relations whose ends are not interchangeable', () => {
    assert.equal(isDirectionalRelation('contains'), true);
    assert.equal(isDirectionalRelation('precedes'), true);
    assert.equal(isDirectionalRelation('same_universe'), false);
    assert.equal(isDirectionalRelation('companion'), false);
  });

  it('keeps the wishlist statuses out of the held ones', () => {
    // A book cannot be both wanted and on the shelf, and `lent` is on the shelf
    // — it is ours, it is just elsewhere.
    for (const s of WISHLIST_STATUSES) assert.ok(!HELD_STATUSES.includes(s));
    assert.ok(HELD_STATUSES.includes('lent'));
    assert.ok(!HELD_STATUSES.includes('sold'));
  });
});

describe('edition medium — the shelf a printing lives on', () => {
  it('calls exactly the things with mass physical', () => {
    for (const f of PHYSICAL_FORMATS) assert.equal(editionMedium(f), 'physical');
  });

  it('calls every file and every licence an ebook', () => {
    // ⚠️ Including `ebook_kindle`, which is a licence with no bytes on our side
    // (migration 0002). It is still not something you can hand across a table,
    // which is the only question this function answers. Anything that cares
    // about the file/licence difference must gate on EBOOK_FILE_FORMATS.
    for (const f of EDITION_FORMATS) {
      if ((PHYSICAL_FORMATS as readonly string[]).includes(f)) continue;
      assert.equal(editionMedium(f), 'ebook');
    }
  });

  it('classifies every format in the enum, leaving none unaccounted for', () => {
    // The guard that matters when a format is added: a new value silently
    // falling into 'ebook' is right for a file and wrong for, say, 'audio_cd'.
    // This does not stop that — nothing can — but it makes the count visible.
    const counted = EDITION_FORMATS.filter((f) => editionMedium(f) === 'physical').length;
    assert.equal(counted, PHYSICAL_FORMATS.length);
  });

  it('⚠️ has no audio medium, and must not grow one', () => {
    // HANDOFF.md open question 5, and PLATFORM.md §2.2: audiobooks stay in the
    // sibling catalog and meet this one through work_key, never by merging. A
    // third value here is the first step towards edition.format = 'audiobook'.
    // The series page shows audio as a third chip; it does not store one.
    assert.deepEqual([...EDITION_MEDIA], ['physical', 'ebook']);
  });
});

describe('corroboration — the Firefight rule', () => {
  // docs/info/isbn-ladder.md §4.4, verbatim: Open Library answered "Firefight" +
  // "Brandon Sanderson" with a DIFFERENT 2001 book called Firefight, scoring 1.0
  // on title and 1.0 on author. Only the publisher and the year separated them.
  // These are that measurement turned into a test.
  const sandersonsFirefight = {
    series: 'The Reckoners',
    volume: 2,
    publisher: 'Delacorte Press',
    year: 2015,
  };

  it('refuses the wrong Firefight, which title and author cannot', () => {
    const wrong = corroborate(sandersonsFirefight, {
      publishers: ['Random House Books for Young Readers'],
      years: [2001],
      seriesStrings: ['Firefight'],
    });
    assert.equal(wrong.confidence, 'none');
    assert.deepEqual(wrong.strong, []);
  });

  it('accepts the right one on the publisher and the year', () => {
    const right = corroborate(sandersonsFirefight, {
      publishers: ['Delacorte Press'],
      years: [2015],
      seriesStrings: ['Firefight', 'The Reckoners, Book 2'],
    });
    assert.equal(right.confidence, 'high');
    assert.ok(right.strong.includes('publisher'));
    assert.ok(right.strong.includes('series+volume'));
  });

  it('holds one weak corroborator below the bar, and two at it', () => {
    const one = corroborate({ year: 2015 }, { years: [2015] });
    assert.equal(one.confidence, 'medium');

    const two = corroborate({ year: 2015, series: 'Cradle' }, { years: [2015], seriesStrings: ['Cradle'] });
    assert.equal(two.confidence, 'high');
  });
});

describe('corroboration — publisher folding', () => {
  it('folds the corporate furniture this library actually contains', () => {
    // Three spellings of one publisher, all present in these EPUBs and in OL.
    assert.ok(samePublisher('Dragonsteel Entertainment, LLC', 'Dragonsteel Entertainment'));
    assert.ok(samePublisher('Dragonsteel, LLC', 'Dragonsteel'));
    assert.ok(samePublisher('Thomas & Mercer', 'Thomas and Mercer'));
    assert.ok(samePublisher('Delacorte', 'Delacorte Press'));
  });

  it('does not fold two different houses together', () => {
    // The whole value of the discriminator is this line failing to fire.
    assert.ok(!samePublisher('Delacorte Press', 'Random House Books for Young Readers'));
    assert.ok(!samePublisher('Hidden Gnome Publishing', 'Brilliance Audio'));
    // Lake Union really is an Amazon imprint, and folding on that would need a
    // table of imprints — which nobody has written, so the honest answer is no.
    assert.ok(!samePublisher('Lake Union Publishing', 'Amazon Publishing'));
  });
});

describe('corroboration — series and volume in an edition label', () => {
  it('reads the volume Hidden Gnome files in the subtitle', () => {
    // covers-and-series.md §3.1: "Ghostwater" :: "Cradle, Volume Five".
    assert.ok(seriesMentioned('Cradle, Volume Five', 'Cradle'));
    assert.ok(volumeMentioned('Cradle, Volume Five', 5));
    assert.ok(volumeMentioned('Cradle, Volume 5', 5));
    assert.ok(volumeMentioned('Cradle Book 5', 5));
  });

  it('does not read a bare trailing number as a volume', () => {
    // cleanAudiobookTitle's rule: Eric Vall's books really are called
    // "Summoner 6", and a digit with no marker word in front of it is not a
    // volume claim. This is the same trap one layer up.
    assert.ok(!volumeMentioned('Summoner 6', 6));
    assert.ok(!volumeMentioned('Cradle 5', 5));
  });

  it('requires every word of our series name to be present', () => {
    assert.ok(!seriesMentioned('Skyward Flight', 'Skyward Legacy'));
    assert.ok(seriesMentioned('The Reckoners, Book 2', 'The Reckoners'));
  });
});

describe('volumeStatedIn — the extracting half of volumeMentioned', () => {
  it('reads Arabic, word and Roman volumes', () => {
    assert.equal(volumeStatedIn('Cradle, Volume Four'), 4);
    assert.equal(volumeStatedIn('Cradle, Volume 4'), 4);
    assert.equal(volumeStatedIn('Rise of the Weakest Summoner: Volume XI'), 11);
    assert.equal(volumeStatedIn('Secret Projects, Book #2'), 2);
  });

  it('refuses a bare trailing number', () => {
    // Eric Vall's book really is called "Summoner 6". Reading every trailing
    // digit as a volume would invent one for any title ending in a digit.
    assert.equal(volumeStatedIn('Summoner 6'), null);
    assert.equal(volumeStatedIn('Skysworn'), null);
  });

  it('still agrees with volumeMentioned, which now delegates to it', () => {
    assert.equal(volumeMentioned('Cradle, Volume Four', 4), true);
    assert.equal(volumeMentioned('Cradle, Volume Four', 5), false);
    assert.equal(volumeMentioned('Summoner 6', 6), false);
  });
});

describe('scan-job lines — what still needs a person', () => {
  const line = (over: Partial<ScanLine> = {}): ScanLine => ({
    ...blankLine(1, 'spine', 'Wintersteel'),
    ...over,
  });

  it('⚠️ a book we already hold is a QUESTION, not a settled row', () => {
    // Reversed on the owner's instruction. "Already yours" used to settle the
    // row, which made it a dead end: the one legitimate reason to scan a book
    // you own — a second physical copy — could only be recorded by leaving the
    // sweep, finding the book, and adding the copy by hand.
    assert.equal(isOutstanding(line({ state: 'owned', existingWorkId: 7 })), true);
  });

  it('a price code is still settled, because it is still not a book', () => {
    // The other half of the same rule, deliberately NOT reversed. There is no
    // question to ask about a five-digit price add-on.
    assert.equal(isOutstanding(line({ state: 'skipped' })), false);
  });

  it('answering the duplicate question either way settles it', () => {
    // Both routes off an owned row: a second copy added, or left alone.
    assert.equal(isOutstanding(line({ state: 'owned', existingWorkId: 7, addedWorkId: 7 })), false);
    assert.equal(isOutstanding(line({ state: 'owned', existingWorkId: 7, dismissed: true })), false);
  });

  it('⚠️ keeps the rows that did NOT resolve cleanly', () => {
    // The whole point. The sibling project closed a job when the *easy* rows
    // were added and took these with it — and these are exactly the ones worth
    // coming back to.
    assert.equal(isOutstanding(line({ state: 'not_found' })), true);
    assert.equal(isOutstanding(line({ state: 'error' })), true);
    assert.equal(isOutstanding(line({ state: 'found' })), true);
  });

  it('settles only on a person having acted', () => {
    assert.equal(isOutstanding(line({ state: 'found', dismissed: true })), false);
    assert.equal(isOutstanding(line({ state: 'found', addedWorkId: 9 })), false);
  });

  it('a fresh line is never pre-added or pre-dismissed', () => {
    // A proposal that arrives already accepted is the one bug this whole screen
    // exists to prevent.
    const fresh = blankLine(3, 'barcode', '9780765326355');
    assert.equal(fresh.addedWorkId, null);
    assert.equal(fresh.dismissed, false);
    assert.equal(fresh.similarity, null);
    assert.equal(fresh.position, 3);
    // And never pre-answered: the automatic pass keys on this.
    assert.equal(fresh.lookedUp, false);
  });

  it('counts and summarises what is left', () => {
    const lines = [
      line({ state: 'owned', existingWorkId: 1 }),
      line({ state: 'found' }),
      line({ state: 'not_found' }),
      line({ state: 'found', addedWorkId: 4 }),
    ];
    // Three, not two: the owned row is now a duplicate awaiting a decision.
    assert.equal(outstandingCount(lines), 3);
    assert.equal(jobSummary({ lines, status: 'review' }), '4 books · 3 to sort');
    assert.equal(
      jobSummary({ lines: [line({ state: 'owned', dismissed: true })], status: 'review' }),
      '1 book · all sorted',
    );
    assert.equal(jobSummary({ lines: [], status: 'review' }), 'nothing yet');
  });
});

describe('scan-job lines — what the automatic first pass will spend a search on', () => {
  const spine = (over: Partial<ScanLine> = {}): ScanLine => ({
    ...blankLine(1, 'spine', 'Wintersteel'),
    ...over,
  });

  it('asks about an unresolved spine, exactly once', () => {
    const fresh = spine();
    assert.equal(needsLookup(fresh), true);
    // "Asked" and "answered" are different things, and this is the one that
    // stops the pass looping: a search that found nothing is still an answer.
    assert.equal(needsLookup({ ...fresh, state: 'not_found', lookedUp: true }), false);
    assert.equal(needsLookup({ ...fresh, state: 'found', lookedUp: true }), false);
  });

  it('⚠️ retries a line the service never answered, and only that line', () => {
    // `error` means Open Library was unreachable — not a fact about the book.
    // The route leaves `lookedUp` alone for exactly this.
    assert.equal(needsLookup(spine({ state: 'error' })), true);
    assert.equal(needsLookup(spine({ state: 'error', lookedUp: true })), false);
  });

  it('⚠️ never searches a barcode line that has only its code', () => {
    // Its ladder already ran, against an identifier. The only thing this pass
    // can do is search by title, and a barcode line's text IS the code —
    // searching Open Library for "9780765326355" is a wasted call at best.
    const code = blankLine(1, 'barcode', '9780765326355');
    assert.equal(searchText(code), null);
    assert.equal(needsLookup(code), false);
    assert.equal(needsLookup({ ...code, state: 'not_found' }), false);
  });

  it('⚠️ does search a barcode line once somebody types a title into it', () => {
    // The board-book path. `via` is still 'barcode', and gating on `via` — as
    // the button used to — would refuse the one search that can work here.
    const typed = { ...blankLine(1, 'barcode', '9780241361221'), text: 'Brown Bear, Brown Bear' };
    assert.equal(searchText(typed), 'Brown Bear, Brown Bear');
    assert.equal(needsLookup(typed), true);
  });

  it('spends nothing on rows the catalog or a person already settled', () => {
    assert.equal(needsLookup(spine({ state: 'owned', existingWorkId: 3 })), false);
    assert.equal(needsLookup(spine({ state: 'skipped' })), false);
    assert.equal(needsLookup(spine({ state: 'unresolvable' })), false);
    assert.equal(needsLookup(spine({ dismissed: true })), false);
    assert.equal(needsLookup(spine({ addedWorkId: 3 })), false);
    assert.equal(needsLookup(spine({ text: '   ' })), false);
  });

  it('⚠️ treats a job written before the flag existed as not yet asked', () => {
    // Old rows have no `lookedUp` key at all. `undefined` must read as "ask",
    // so reopening a half-finished sweep finishes it instead of stranding it.
    const legacy = { ...spine(), lookedUp: undefined };
    assert.equal(needsLookup(legacy), true);
  });

  it('reports progress over the lines the pass is responsible for', () => {
    // Not over every line: a shelf of five where two are already ours reads
    // "3 of 3", not "3 of 5 (two of which will never move)".
    const lines = [
      spine({ state: 'found', lookedUp: true }),
      spine({ state: 'not_found', lookedUp: true }),
      spine(),
      spine({ state: 'owned', existingWorkId: 9 }),
      blankLine(5, 'barcode', '9780765326355'),
    ];
    assert.deepEqual(lookupProgress(lines), { done: 2, total: 3 });
    assert.equal(hasPendingLookups(lines), true);

    const finished = lines.map((l) => (needsLookup(l) ? { ...l, lookedUp: true } : l));
    assert.deepEqual(lookupProgress(finished), { done: 3, total: 3 });
    assert.equal(hasPendingLookups(finished), false);
  });
});

describe('scan-job lines — what a row may be given, however it arrived', () => {
  const spine = (over: Partial<ScanLine> = {}): ScanLine => ({
    ...blankLine(1, 'spine', 'Wintersteel'),
    ...over,
  });
  /** A board book: real ISBN, scanned fine, and nothing indexes it. */
  const boardBook = (over: Partial<ScanLine> = {}): ScanLine => ({
    ...blankLine(1, 'barcode', '9780241361221'),
    isbn13: '9780241361221',
    state: 'not_found',
    lookedUp: true,
    ...over,
  });

  it('⚠️ refuses to file a book under the barcode that was scanned', () => {
    // The whole reason `proposedTitle` exists. `resolvedTitle ?? text` — the
    // old rule in catalog-add.ts — would have created a work called
    // "9780241361221" the moment the Add button was un-gated.
    assert.equal(proposedTitle(boardBook()), null);
    assert.equal(isAddable(boardBook()), false);
  });

  it('⚠️ lets an unresolved board book be added once it is typed in', () => {
    // The owner's bug: scanned, ISBN valid, nothing found, no way to add it.
    const typed = boardBook({ text: 'Brown Bear, Brown Bear', author: 'Bill Martin Jr.' });
    assert.equal(proposedTitle(typed), 'Brown Bear, Brown Bear');
    assert.equal(proposedAuthors(typed), 'Bill Martin Jr.');
    assert.equal(isAddable(typed), true);
  });

  it('needs BOTH a title and an author, because the catalog does', () => {
    assert.equal(isAddable(boardBook({ text: 'Brown Bear, Brown Bear' })), false);
    assert.equal(isAddable(boardBook({ author: 'Bill Martin Jr.' })), false);
  });

  it('a SKU or shop barcode is addable by hand too, and never looked up', () => {
    // No global registry of SKUs, so there is nothing to ask — but the book is
    // in your hand, so there is everything to type.
    const sku = {
      ...blankLine(1, 'barcode', '5012345678900'),
      state: 'unresolvable' as const,
    };
    assert.equal(isAddable(sku), false);
    assert.equal(needsLookup(sku), false);
    const typed = { ...sku, text: 'The Very Hungry Caterpillar', author: 'Eric Carle' };
    assert.equal(isAddable(typed), true);
    // Still not searched automatically: `unresolvable` is an answer.
    assert.equal(needsLookup(typed), false);
  });

  it('a duplicate is addable with no title of its own — the work supplies it', () => {
    // The second-copy path. There is nothing to name, because the work is known.
    const dup = spine({ state: 'owned', existingWorkId: 12, existingTitle: 'Wintersteel' });
    assert.equal(isAddable(dup), true);
    assert.equal(isAddable({ ...dup, dismissed: true }), false);
    assert.equal(isAddable({ ...dup, addedWorkId: 12 }), false);
  });

  it('prefers what a service resolved over what was read off the shelf', () => {
    const found = spine({ state: 'found', resolvedTitle: 'Wintersteel', resolvedAuthors: 'Will Wight' });
    assert.equal(proposedTitle(found), 'Wintersteel');
    assert.equal(proposedAuthors(found), 'Will Wight');
    assert.equal(isAddable(found), true);
  });

  it('treats whitespace as nothing said', () => {
    assert.equal(proposedTitle(spine({ text: '   ' })), null);
    assert.equal(proposedAuthors(spine({ author: '  ' })), null);
  });
});

describe('the shelf-read output contract', () => {
  it('⚠️ requires `author`, so a missing one is an explicit null', () => {
    // Not cosmetic. If `author` fell out of `required` the model would simply
    // omit it, `line.author` would be undefined, and matching would silently
    // degrade to title-only — the `BOSS MONSTER` → `Super Boss Monster 2`
    // shape that files a new book under "already yours", where it is lost.
    const item = SHELF_SCHEMA.properties.books.items;
    assert.ok((item.required as readonly string[]).includes('author'));
    assert.equal(item.additionalProperties, false);
    assert.deepEqual(item.properties.author.type, ['string', 'null']);
  });

  it('asks for a position on every book, so the shelf can be walked back along', () => {
    const item = SHELF_SCHEMA.properties.books.items;
    assert.ok((item.required as readonly string[]).includes('position'));
    assert.equal(item.properties.position.type, 'integer');
  });

  it('keeps "unreadable" separate from "no books", because the advice differs', () => {
    assert.ok((SHELF_SCHEMA.required as readonly string[]).includes('unreadable'));
    assert.equal(SHELF_SCHEMA.properties.unreadable.type, 'boolean');
  });
});

describe('gaps — what is a question, and what is already an answer', () => {
  it('asks every book for its year and its description', () => {
    // Measured against production 2026-08-10: 116 of 116 works have neither.
    // If this ever stops being true the queue has quietly stopped asking.
    assert.deepEqual(detailGaps({ series: 'Cradle', seriesIndexSort: 1, seriesIndexDisplay: '1' }), [
      'firstPublished',
      'description',
    ]);
  });

  it('does not ask a book with no series which volume it is', () => {
    // ⚠️ The conditional that stops a model being handed a blank to fill. Asked
    // anyway, it invents a series to put the number in.
    const gaps = detailGaps({ series: null });
    assert.ok(!gaps.includes('seriesIndex'));
    assert.ok(gaps.includes('series'));
  });

  it('asks for the volume number once a series is known', () => {
    assert.ok(detailGaps({ series: 'Cradle', seriesIndexSort: null }).includes('seriesIndex'));
  });

  it('⚠️ a recorded verdict is an answer, not a gap', () => {
    // The eleven researched standalones. Without this the queue re-asks — and
    // re-buys — work done by hand on 2026-08-10 and written down with sources
    // in scripts/series-overrides.json.
    const standalone = { series: null, verdicts: ['series'] as const };
    assert.ok(!detailGaps(standalone).includes('series'));
    assert.ok(detailGaps({ series: null }).includes('series'));
  });

  it('an unknown verdict closes the question just as firmly as a none', () => {
    // Firstborn / Defending Elysium and Undead Knight. "Nobody knows" cost
    // somebody an afternoon; it must not be re-asked either.
    assert.ok(!detailGaps({ series: null, verdicts: ['series'] }).includes('series'));
  });

  it('a book with everything answered leaves the queue', () => {
    assert.deepEqual(
      detailGaps({
        firstPublished: 2016,
        series: 'Cradle',
        seriesIndexSort: 1,
        seriesIndexDisplay: '1',
        description: 'A boy from a doomed valley learns the sacred arts.',
      }),
      [],
    );
  });

  it('treats whitespace as blank, because an empty form field is not a value', () => {
    assert.ok(detailGaps({ description: '   ' }).includes('description'));
    assert.ok(detailGaps({ series: '  ' }).includes('series'));
  });

  it('a volume 0 is a position, not a missing one', () => {
    // `!subject.seriesIndexSort` would call volume 0 a gap. Prequels numbered 0
    // exist and are already in this catalog's series ladders.
    assert.ok(
      !detailGaps({ series: 'X', seriesIndexSort: 0, seriesIndexDisplay: '0' }).includes(
        'seriesIndex',
      ),
    );
  });

  it('⚠️ the SORT alone answers the volume number — the printed form is optional', () => {
    // ## ⚠️ SUPERSEDED 2026-08-19 — this test used to assert the opposite
    //
    // It was called *"a volume number nobody can read is not an answer — both
    // columns, or it is a gap"*, and it was written for a real finding:
    // 2026-08-13, 22 works had `sort` set and `display` NULL, filing into
    // exactly the right ladder position and printing nothing, while the gap
    // test reported zero gaps for all of them.
    //
    // **The diagnosis was right and the remedy was wrong**, and the wrongness
    // took six days to become visible. Demanding `display` demanded a fact
    // about a PHYSICAL PRINTING from a catalog of EPUB files, and nothing
    // downstream of `routes/ingest.ts` ever wrote it — not research, not the
    // donor, not any backfill. Measured on `library-catalog-2nd` the day it was
    // reversed: **55 of 55 remaining queue rows were `seriesIndex`**, every one
    // a row the queue could be paid for for ever and never close. The owner
    // pressed the button, the lookups all succeeded, and the count did not move.
    //
    // Owner ruling, verbatim: *"We don't need physical volume if we have
    // series. Only a few things have it like the 2 part Sanderson. Make it
    // optional."* Canonical semantics: `docs/info/volume-numbers.md`.
    //
    // ⚠️ Kept as a dated supersession rather than deleted, because the old
    // reasoning is genuinely persuasive and a future session will re-derive it.

    // A sort with no printed form is COMPLETE. This is the assertion that
    // reversed.
    assert.ok(
      !detailGaps({ series: 'He Who Fights with Monsters', seriesIndexSort: 1 }).includes(
        'seriesIndex',
      ),
    );
    assert.ok(
      !detailGaps({ series: 'X', seriesIndexSort: 8, seriesIndexDisplay: '  ' }).includes(
        'seriesIndex',
      ),
    );
    // ⚠️ UNCHANGED, and still the point of the 2026-08-13 finding: a printed
    // number that files nowhere IS a gap. The ladder would shove it to the end
    // as if unnumbered, and that half was never about the physical printing.
    assert.ok(
      detailGaps({ series: 'X', seriesIndexSort: null, seriesIndexDisplay: 'Book 2' }).includes(
        'seriesIndex',
      ),
    );
    // A printed form alongside a sort is kept and closes nothing extra — it is
    // data, not a requirement.
    assert.ok(
      !detailGaps({ series: 'X', seriesIndexSort: 2.5, seriesIndexDisplay: 'Vol. 2.5' }).includes(
        'seriesIndex',
      ),
    );
  });

  it('reports gaps in DETAIL_FIELDS order, so two rows read identically', () => {
    assert.deepEqual(detailGaps({}), ['firstPublished', 'series', 'description']);
  });

  it('a found finding is not a verdict; the other two are', () => {
    assert.equal(verdictFor('found'), null);
    assert.equal(verdictFor('none'), 'none');
    assert.equal(verdictFor('unknown'), 'unknown');
  });

  it('names every field it refuses, with a reason', () => {
    // The list is rendered on the queue page. A refusal with no reason is
    // indistinguishable from an oversight.
    assert.ok(REFUSED_FIELDS.length > 0);
    for (const r of REFUSED_FIELDS) assert.ok(r.because.length > 20, r.field);
    assert.ok(REFUSED_FIELDS.some((r) => r.field.includes('ISBN')));
  });
});

describe('updateEditionSchema — correcting a printing without disturbing it', () => {
  // ⚠️ The whole panel rests on one zod subtlety. `createEditionSchema` gives
  // `format` and `source` defaults; `.partial()` wraps each field as
  // ZodOptional<ZodDefault<…>> and an absent key short-circuits at the
  // ZodOptional, so the default never fires. If that ever stopped being true,
  // every one-field PATCH would silently rewrite the row's provenance to
  // `manual` — and `EDITION_SOURCES` says `manual` is never overwritten, so the
  // damage would be permanent and invisible. Typecheck cannot see this.
  it('⚠️ leaves absent fields absent rather than filling in defaults', () => {
    const patch = updateEditionSchema.parse({ format: 'hardcover' });
    assert.deepEqual(Object.keys(patch), ['format']);
    assert.equal('source' in patch, false);
    assert.equal('format' in patch, true);
  });

  it('an empty patch asks for no change at all', () => {
    assert.deepEqual(updateEditionSchema.parse({}), {});
  });

  // The distinction `updateEdition` in @lc/db relies on: undefined leaves a
  // column alone, an explicit null clears it. An edit form that cannot clear a
  // publisher typed by mistake is only half a fix.
  it('distinguishes clearing a field from not mentioning it', () => {
    const cleared = updateEditionSchema.parse({ isbn13: null, publisher: '' });
    assert.equal(cleared.isbn13, null);
    assert.equal(cleared.publisher, null, 'a blank form field is not a value');
    assert.equal('pages' in cleared, false);
  });

  it('refuses a malformed ISBN rather than storing it', () => {
    assert.equal(updateEditionSchema.safeParse({ isbn13: '123' }).success, false);
    assert.equal(updateEditionSchema.safeParse({ isbn13: '9780765326355' }).success, true);
  });

  it('refuses a format outside the enum, which is also the CHECK constraint', () => {
    assert.equal(updateEditionSchema.safeParse({ format: 'audiobook' }).success, false);
    for (const f of EDITION_FORMATS) {
      assert.equal(updateEditionSchema.safeParse({ format: f }).success, true, f);
    }
  });

  // Moving a printing to another book is not an edit: the copies, reviews and
  // read-state all hang off the work and would be left behind. `workId` is
  // omitted from the schema — and since `.strict()` (2026-08-13) a caller
  // sending one is REFUSED, not silently ignored. The old behaviour (strip
  // and 200) was the lie this estate documents: the caller believed the
  // re-point happened. A 400 naming the key is a bug report.
  it('⚠️ will not re-point an edition at a different work — and says so', () => {
    const res = updateEditionSchema.safeParse({ workId: 9 });
    assert.equal(res.success, false);
    assert.match(JSON.stringify(res.success ? [] : res.error.issues), /workId/);
  });

  // The strip-lie in general: an unknown or misspelled key is a 400 that names
  // it, never a 200 that changed nothing. With an audit log the strip would be
  // worse than a lie — change_log would truthfully record that nothing
  // changed while the caller was told it did.
  it('⚠️ refuses unknown keys by name instead of stripping them', () => {
    for (const [schema, body] of [
      [updateEditionSchema, { Format: 'hardcover' }],
      [updateWorkSchema, { Title: 'x' }],
      [updateCopySchema, { Status: 'owned' }],
    ] as const) {
      const res = schema.safeParse(body);
      assert.equal(res.success, false);
      const said = JSON.stringify(res.success ? [] : res.error.issues);
      assert.match(said, /unrecognized_keys/);
      assert.match(said, new RegExp(Object.keys(body)[0]!));
    }
  });
});

describe('PHYSICAL_FORMATS — the list the Drive links are hidden by', () => {
  // A book that only exists on paper is on a shelf, so the book page hides the
  // "open it in Drive" links for it. That rule keys on format and on nothing
  // else — deliberately not on the presence of an ISBN, because an ebook can
  // carry one. These guard the list the rule reads.
  it('every physical format is a real format', () => {
    for (const f of PHYSICAL_FORMATS) assert.ok(EDITION_FORMATS.includes(f), f);
  });

  it('⚠️ nothing is both a physical printing and a file', () => {
    for (const f of EBOOK_FILE_FORMATS) assert.equal(PHYSICAL_FORMATS.includes(f), false, f);
  });

  it('a Kindle licence is not physical, so it keeps its Drive links', () => {
    // No bytes on our side, but nor is it paper. Hiding the links for it would
    // be hiding them for a book that may well have a sideloaded file in Drive.
    assert.equal(PHYSICAL_FORMATS.includes('ebook_kindle'), false);
  });

  it('the three printings a barcode can mean are all physical', () => {
    // The set `addLineToCatalog` is guessing between when it writes 'paperback'.
    assert.deepEqual([...PHYSICAL_FORMATS], ['hardcover', 'paperback', 'mass_market']);
  });
});

describe('crowdfunding — the physical/digital split', () => {
  // ⚠️ The whole reason this module exists, in the owner's words: "Kickstarter
  // stuff generally has a mix of physical and digital books so make sure when
  // youre auditing you're really looking close." Every assertion below is a way
  // that could go wrong quietly.

  it('a matched edition ends the question', () => {
    assert.equal(pledgeItemMedium({ format: 'hardcover' }), 'physical');
    assert.equal(pledgeItemMedium({ format: 'ebook_epub' }), 'digital');
    // ⚠️ A Kindle licence is digital even though no file exists on our side.
    assert.equal(pledgeItemMedium({ format: 'ebook_kindle' }), 'digital');
  });

  it('⚠️ the edition beats the campaign blurb, never the other way round', () => {
    // Once a line is resolved, the campaign's words are evidence for the match,
    // not a second opinion about it. Letting the blurb win would make the
    // catalog disagree with a row it had already settled.
    assert.equal(
      pledgeItemMedium({ format: 'ebook_epub', formatHint: 'Deluxe Hardcover + Ebook' }),
      'digital',
    );
  });

  it('reads the campaign words when nothing is matched yet', () => {
    // The ordinary state of a fresh scan: a reward line and no edition row.
    assert.equal(pledgeItemMedium({ formatHint: 'Deluxe Hardcover' }), 'physical');
    assert.equal(pledgeItemMedium({ formatHint: 'EPUB + MOBI' }), 'digital');
    assert.equal(pledgeItemMedium({ formatHint: 'Signed Paperback' }), 'physical');
  });

  it('⚠️ a bundle naming both is `both`, not whichever word came first', () => {
    // This is the line that loses an ebook if it is silently resolved. It needs
    // splitting into two pledge_item rows, and the audit says so.
    assert.equal(mediumFromHint('Hardcover + Ebook Bundle'), 'both');
    assert.equal(mediumFromHint('Print & Digital'), 'both');
  });

  it('falls back to the reward title, then gives up honestly', () => {
    assert.equal(pledgeItemMedium({ title: 'Book 3 — Ebook' }), 'digital');
    // ⚠️ `unknown` is a real answer. There is no rung guessing from the tier or
    // the amount paid — isbn-ladder.md §4.4, where a wrong answer scored 1.00.
    assert.equal(pledgeItemMedium({ title: 'All-In Tier' }), 'unknown');
    assert.equal(pledgeItemMedium({}), 'unknown');
  });

  it('an audiobook reward is digital, not unknown', () => {
    // It will never be an edition in this catalog — audio lives next door — but
    // it is still a file, and calling it unknown would park it in the
    // somebody-go-look queue forever.
    assert.equal(mediumFromHint('Audiobook download'), 'digital');
  });

  it('⚠️ ONE work delivered twice is two lines and ONE book', () => {
    // The failure the owner named in advance. `lines` must not equal `works`
    // here: reporting 2 books double-counts the novel, reporting 1 line loses
    // the ebook.
    const audit = pledgeAudit([
      { workId: 57, editionId: 9, format: 'hardcover' },
      { workId: 57, editionId: 10, format: 'ebook_epub' },
    ]);
    assert.equal(audit.lines, 2);
    assert.equal(audit.works, 1);
    assert.equal(audit.physical, 1);
    assert.equal(audit.digital, 1);
    assert.equal(audit.unmatched, 0);
  });

  it('counts the two states a person still has to resolve', () => {
    const audit = pledgeAudit([
      { workId: 1, formatHint: 'Hardcover + Ebook' },
      { workId: 2, formatHint: 'All-In' },
      { workId: 3, editionId: 4, format: 'paperback', fulfilled: true },
    ]);
    assert.equal(audit.both, 1);
    assert.equal(audit.unknown, 1);
    // Two of the three have no edition_id, so two are "matched to a book, not a
    // printing" — the queue the audit exists to produce.
    assert.equal(audit.unmatched, 2);
    assert.equal(audit.fulfilled, 1);
  });

  it('the audit sentence leads with what is wrong', () => {
    const clean = auditSentence(pledgeAudit([{ workId: 1, editionId: 2, format: 'hardcover' }]));
    assert.ok(!clean.startsWith('⚠️'), clean);

    const dirty = auditSentence(pledgeAudit([{ workId: 1, formatHint: 'Hardcover + Ebook' }]));
    assert.ok(dirty.startsWith('⚠️'), dirty);
    assert.ok(dirty.includes('split'), dirty);
  });

  it('⚠️ a settled audiobook line is NOT an outstanding one', () => {
    // Measured: one pledge routinely delivers ebook + print + audiobook (Space
    // Knight 5 and 6, Tamer Bk 11, Fires of December). The audiobook can never
    // have an `edition` — EDITION_FORMATS has no audiobook value and never will
    // — so without the verdict the "no printing" queue could never empty, and a
    // queue that cannot empty is a queue nobody reads. Same rule `detailGaps`
    // follows for `gap_verdict`.
    const audit = pledgeAudit([
      { workId: 5, editionId: 11, format: 'ebook_epub' },
      { workId: 5, editionId: 12, format: 'paperback' },
      { workId: 5, editionId: null, editionVerdict: 'none', formatHint: 'Audiobook' },
    ]);
    assert.equal(audit.lines, 3);
    assert.equal(audit.works, 1);
    assert.equal(audit.unmatched, 0);
    assert.equal(audit.digital, 2);
    assert.equal(audit.physical, 1);
    assert.ok(!auditSentence(audit).startsWith('⚠️'), auditSentence(audit));
  });

  it('reads signed and numbered out of the reward prose', () => {
    // ⚠️ There is no signed field on a campaign page. All three strings below
    // are verbatim from the real purchase scan.
    assert.deepEqual(rewardFlags('Book 1 will be Signed & Numbered'), {
      signed: true,
      numbered: true,
    });
    assert.deepEqual(rewardFlags('CONQUEROR -- SIGNED PAPERBACK+'), {
      signed: true,
      numbered: false,
    });
    assert.deepEqual(rewardFlags('Legendary Book Box (Uniquely Numbered)'), {
      signed: false,
      numbered: true,
    });
  });

  it('⚠️ "deluxe" is not "signed"', () => {
    // A nicer printing is not a signature, and a ticked is_signed box is very
    // hard to un-believe once it is ticked.
    assert.deepEqual(rewardFlags('Deluxe Hardcover, sprayed edges'), {
      signed: false,
      numbered: false,
    });
    assert.deepEqual(rewardFlags(null), { signed: false, numbered: false });
  });

  it('suggests a format from a hint, and only ever suggests', () => {
    assert.equal(suggestFormat('Deluxe Hardcover'), 'hardcover');
    assert.equal(suggestFormat('Signed Paperback'), 'paperback');
    assert.equal(suggestFormat('EPUB'), 'ebook_epub');
    assert.equal(suggestFormat('Kindle edition'), 'ebook_kindle');
    // Mass market must win over the bare "paperback" inside it.
    assert.equal(suggestFormat('Mass market paperback'), 'mass_market');
    assert.equal(suggestFormat('All-In Tier'), null);
    assert.equal(suggestFormat(null), null);

    // The owner's rules, added 2026-08-11 after five real reward lines had to be
    // answered by hand. Each is a guess the owner endorsed, not a fact the
    // string states — see the comments in `suggestFormat`.
    assert.equal(suggestFormat("Collector's Edition"), 'hardcover');
    assert.equal(suggestFormat('Collectors Edition Trilogy'), 'hardcover');
    assert.equal(suggestFormat('Signed Leatherbound'), 'hardcover');
    // A bare "ebook" is a choice of file, and EPUB is the one always offered.
    assert.equal(suggestFormat('ebook'), 'ebook_epub');

    // ⚠️ Order matters: a tier can name BOTH a binding and a tier word, and the
    // binding must win. "Collector's Edition Paperback" is a paperback.
    assert.equal(suggestFormat("Collector's Edition Paperback"), 'paperback');
    assert.equal(suggestFormat('Collectors Edition — Mass market'), 'mass_market');
    // And a specific file type still beats the bare-ebook fallback.
    assert.equal(suggestFormat('Ebook (Kindle)'), 'ebook_kindle');

    // ⚠️ Still refused, and deliberately: these name no format at all. If this
    // ever starts answering, the propose/accept rule has quietly become
    // guess-and-apply.
    assert.equal(suggestFormat('Deluxe Edition'), null);
    assert.equal(suggestFormat('Backer Pack'), null);
  });
});

describe('edition kind — one bucket for every way a shop spells "fancy"', () => {
  /*
   * The owner, 2026-08-11: *"Let's normalize any edition to collectors edition.
   * Keep the original name on the visible listing but for our sanity all
   * editions should be collectors and we can fix them one off if needed."*
   *
   * ⚠️ Every string in the tests below is a VERBATIM `edition_name` from
   * production, measured the same day: 17 named editions across 13 distinct
   * names, beside 220 rows with no name at all. They are here rather than
   * paraphrased because the whole value of this function is that it survives
   * contact with real vendor prose, and a paraphrase would quietly test a tidier
   * world.
   */

  it('the real names that ARE a special printing', () => {
    assert.equal(classifyEdition('Illumicrate Exclusive'), 'collectors');
    assert.equal(classifyEdition('Year of Sanderson premium hardcover'), 'collectors');
    assert.equal(classifyEdition('B&N Exclusive Edition'), 'collectors');
    assert.equal(classifyEdition('Campaign-only exclusive hardcover, signed extras'), 'collectors');
    assert.equal(classifyEdition("Collector's Edition"), 'collectors');
    assert.equal(
      classifyEdition("Collector's Edition Trilogy — Book 1 Signed & Numbered"),
      'collectors',
    );
    assert.equal(classifyEdition('Deluxe Edition'), 'collectors');
    assert.equal(classifyEdition('Signed Leatherbound'), 'collectors');
  });

  /*
   * ⚠️ THE THREE EXCLUSIONS. These are why this is a keyword list about
   * *objects* rather than a "does it have a name" test, and each is a different
   * way the obvious implementation goes wrong.
   */
  it('⚠️ an omnibus is not a collector’s edition — it describes the CONTENTS', () => {
    // Both rows are *White Sand*, the original "alternate copies of stuff we
    // already own" case the whole series restructure was built around. An
    // omnibus is an ordinary trade printing that happens to hold three volumes;
    // calling it a collector's edition would be plainly false, and would break
    // the feature's own worked example.
    assert.equal(classifyEdition('Omnibus - collects volumes 1-3'), null);
    assert.equal(classifyEdition('Volume 1'), null);
  });

  it('⚠️ a bare "ebook" names no printing at all', () => {
    // Junk that leaked out of a crowdfunding reward name. The row's `format` is
    // already `ebook_epub`, so the name adds nothing — the backfill clears it to
    // NULL rather than finding a bucket for it.
    assert.equal(classifyEdition('ebook'), null);
  });

  it('⚠️ a contents word does not veto a tier word — the combination is real', () => {
    // Nothing blacklists "omnibus": the refusals above work because no contents
    // word is on COLLECTORS_HINTS in the first place. A blacklist would get this
    // wrong, and "Omnibus Collector's Edition" is a product people sell.
    assert.equal(classifyEdition("Omnibus Collector's Edition"), 'collectors');
    assert.equal(classifyEdition('Volume 1 — Signed Leatherbound'), 'collectors');
  });

  it('an unnamed printing is an ordinary printing', () => {
    // ⚠️ 220 editions in production are this case. NULL means ORDINARY
    // here, not "unclassified" — see EDITION_KINDS, which argues out why this
    // column breaks the NULL rule `cover_status` and `decided_how` follow.
    assert.equal(classifyEdition(null), null);
    assert.equal(classifyEdition(undefined), null);
    assert.equal(classifyEdition(''), null);
  });

  it('⚠️ answers a different question from suggestFormat, about the same string', () => {
    // The pair that proves these are not one function wearing two names.
    // "Deluxe Edition" names no binding, so suggestFormat rightly refuses it —
    // and it is unmistakably a special printing.
    assert.equal(suggestFormat('Deluxe Edition'), null);
    assert.equal(classifyEdition('Deluxe Edition'), 'collectors');
    // And the other way round: a binding is a format and no kind.
    assert.equal(suggestFormat('Trade paperback'), 'paperback');
    assert.equal(classifyEdition('Trade paperback'), null);
  });

  it('the curly apostrophe is the same word as the straight one', () => {
    // Measured names in this catalog use ASCII, but a vendor page writing U+2019
    // is selling the identical product, and a substring test that could not see
    // that would file half a shelf as ordinary.
    assert.equal(classifyEdition('Collector’s Edition'), 'collectors');
  });

  it('is case-insensitive, because vendor prose is not consistent', () => {
    assert.equal(classifyEdition('COLLECTORS EDITION'), 'collectors');
    assert.equal(classifyEdition('bn exclusive edition'), 'collectors');
  });

  it('⚠️ one value, and the ask is the reason', () => {
    // "Illumicrate Exclusive", "Deluxe Edition" and "Signed Leatherbound" are
    // three names for one shelf. Splitting them into exclusive/deluxe/signed
    // would rebuild the thirteen-way problem with tidier spelling — the exact
    // thing "for our sanity" was asking to stop.
    assert.deepEqual([...EDITION_KINDS], ['collectors']);
    for (const name of [
      'Illumicrate Exclusive',
      'Deluxe Edition',
      'Signed Leatherbound',
      'Year of Sanderson premium hardcover',
    ]) {
      const kind = classifyEdition(name);
      assert.ok(kind !== null && EDITION_KINDS.includes(kind), name);
    }
  });

  it('a name it does not recognise stays unsorted rather than being guessed at', () => {
    // ⚠️ The failure this leaves open, on purpose. "Book with sticker and
    // bookmark tier" is a real production row the owner calls a special
    // printing, and no honest keyword reaches it — a bookmark is not a binding.
    // It is set by hand in `scripts/backfill-edition-kinds.mjs`, and any future
    // one like it lands in the collection's "Named, not sorted" filter, which is
    // what makes NULL-means-ordinary safe rather than merely convenient.
    assert.equal(classifyEdition('Book with sticker and bookmark tier'), null);
    assert.equal(classifyEdition('All-In Tier'), null);
    assert.equal(classifyEdition('Backer Pack'), null);
  });

  it('never auto-classifies an ebook, whatever the campaign called it', () => {
    /*
     * The owner's rule, 2026-08-11: "basically all ebooks are going to be normal
     * editions and not special editions unless we state otherwise."
     *
     * ⚠️ The words that make a printing collectible are all about the OBJECT —
     * leatherbound, sprayed edges, a slipcase, a signature. A reward tier called
     * "Deluxe Edition" that delivers an EPUB is describing the pledge, not the
     * bytes. Format vetoes the keywords rather than the keyword list being
     * trimmed, so the hints stay honest about physical books.
     */
    for (const fmt of ['ebook_epub', 'ebook_mobi', 'ebook_azw3', 'ebook_kepub', 'ebook_pdf', 'ebook_kindle']) {
      assert.equal(classifyEdition("Collector's Edition", fmt), null, fmt);
      assert.equal(classifyEdition('Signed Leatherbound', fmt), null, fmt);
      assert.equal(classifyEdition('Deluxe Edition', fmt), null, fmt);
    }

    // The same strings on a physical printing still classify.
    for (const fmt of ['hardcover', 'paperback', 'mass_market']) {
      assert.equal(classifyEdition("Collector's Edition", fmt), 'collectors', fmt);
    }

    // ⚠️ Format omitted means "unknown", NOT "ebook" — a caller that has no
    // format must still get the keyword answer, or every hint-only path
    // (the import audit, which runs before any edition row exists) goes blank.
    assert.equal(classifyEdition("Collector's Edition"), 'collectors');
    assert.equal(classifyEdition("Collector's Edition", null), 'collectors');
  });
});

describe('updateEditionSchema — the kind travels beside the name, separately', () => {
  it('accepts the vocabulary and refuses anything else', () => {
    assert.equal(updateEditionSchema.safeParse({ editionKind: 'collectors' }).success, true);
    assert.equal(updateEditionSchema.safeParse({ editionKind: 'deluxe' }).success, false);
    for (const k of EDITION_KINDS) {
      assert.equal(updateEditionSchema.safeParse({ editionKind: k }).success, true, k);
    }
  });

  it('⚠️ an explicit null is how a printing is filed back as ordinary', () => {
    // Not an absence. NULL is a real value in this column — it means an ordinary
    // printing — so the edit form's "Ordinary printing" option has to reach the
    // database, and `updateEdition` in @lc/db distinguishes an explicit null
    // from a field the patch never mentioned.
    const cleared = updateEditionSchema.parse({ editionKind: null });
    assert.equal(cleared.editionKind, null);
    assert.equal('editionKind' in cleared, true);
  });

  it('⚠️ has no default, unlike format and source', () => {
    // A default would be indistinguishable from the value it defaults to and
    // would remove the caller's ability to clear it. Same zod subtlety the
    // partial-schema test above guards for `source`.
    const patch = updateEditionSchema.parse({ format: 'hardcover' });
    assert.equal('editionKind' in patch, false);
  });

  it('renaming a printing does not re-file it, and vice versa', () => {
    // Two independent fields on the wire, because the alternative — deriving the
    // kind from the name on every save — would undo a hand-made one-off
    // correction the next time somebody fixed a typo in the name.
    const renamed = updateEditionSchema.parse({ editionName: 'B&N Exclusive Edition' });
    assert.equal('editionKind' in renamed, false);
    const refiled = updateEditionSchema.parse({ editionKind: 'collectors' });
    assert.equal('editionName' in refiled, false);
  });
});

describe('matching — a numbered volume prefers a numbered row', () => {
  /*
   * The real rows, measured against production 2026-08-10. The audiobook catalog
   * holds Tamer volumes 1, 7, 8, 9 and 10 — and a series-level row with no
   * number at all. It does NOT hold volume 11.
   */
  const audio = [
    { id: 1, title: 'Tamer: King of Dinosaurs', authors: 'Michael-scott Earle' },
    { id: 2, title: 'Tamer: King of Dinosaurs 1', authors: 'Michael-scott Earle' },
    { id: 3, title: 'Tamer: King of Dinosaurs 7', authors: 'Michael-scott Earle' },
    { id: 4, title: 'Tamer: King of Dinosaurs 8', authors: 'Michael-scott Earle' },
    { id: 5, title: 'The Primal Hunter 10', authors: 'Zogarth' },
    { id: 6, title: 'The Primal Hunter 5', authors: 'Zogarth' },
    { id: 7, title: 'Oathbound Healer', authors: 'Actus' },
  ];
  const index = buildWorkIndex(audio);

  it('reaches the numbered row when only the marker word differs', () => {
    // Ours says "Book 7", theirs says "7". Before the volume-marker fold these
    // could not meet at all: containment is a substring test and "book" sits in
    // the middle, so the ONLY substring candidate was the series-level row.
    const m = matchIndexedWork(index, 'Tamer: King of Dinosaurs Book 7', 'Michael-scott Earle');
    assert.equal(m?.work.id, 3);
    assert.equal(m?.via, 'exact');
  });

  it('does not let volume 8 reach volume 7', () => {
    assert.equal(
      matchIndexedWork(index, 'Tamer: King of Dinosaurs Book 8', 'Michael-scott Earle')?.work.id,
      4,
    );
  });

  it('⚠️ claims NOTHING for a volume that is not held on audio', () => {
    // The whole point. Volume 11 exists in this library and not in that catalog,
    // and before the numeric gate it matched the series-level row by containment
    // and rendered as `AUDIO?` — a false claim about what the household owns.
    assert.equal(
      matchIndexedWork(index, 'Tamer: King of Dinosaurs Book 11', 'Michael-scott Earle'),
      null,
    );
  });

  it('does not hand an unnumbered work the highest-numbered volume', () => {
    // "The Primal Hunter" is book 1. Containment sorts longest key first, which
    // among numbered volumes means the biggest number wins — it matched book 10.
    assert.equal(matchIndexedWork(index, 'The Primal Hunter', 'Zogarth'), null);
  });

  it('still allows containment where only decoration differs', () => {
    // The rung must keep working: this library files the book as "Oathbound
    // Healer - MM" and the audiobook catalog as "Oathbound Healer". No numbers
    // on either side, so the gate does not fire.
    const m = matchIndexedWork(index, 'Oathbound Healer - MM', 'Actus');
    assert.equal(m?.work.id, 7);
    assert.equal(m?.via, 'containment');
  });

  it('folds only a marker that precedes a number', () => {
    assert.equal(foldVolumeMarker('tamer king of dinosaurs book 7'), 'tamer king of dinosaurs 7');
    assert.equal(foldVolumeMarker('space knight volume 5'), 'space knight 5');
    // "The Book Thief" keeps its "book" — nothing numeric follows it.
    assert.equal(foldVolumeMarker('book thief'), 'book thief');
  });
});

describe('matching — ambiguous-fold disambiguation by series volume (Space Knight)', () => {
  /*
   * The real shape, measured 2026-08-14: works #249 "Space Knight Book 1" and
   * #250 "Space Knight Book 2" both refused to match anything. The audiobook
   * catalog's OWN title-cleaning strips the series+volume suffix down to bare
   * "Space Knight" for both its volume-1 and volume-2 rows — so both rows
   * fold to the identical titleKey with ZERO digits left in it, and
   * `numbersAgree` correctly rejects a containment match against either (0
   * numbers vs 1). The volume number survives outside the title text though,
   * in `series_index_sort` / `MatchableWork.seriesIndex`, and that is the one
   * thing `disambiguateByVolume` is allowed to use to tell the two rows apart.
   */
  const spaceKnight = [
    { id: 1, title: 'Space Knight', authors: 'Michael-scott Earle', seriesIndex: 1 },
    { id: 2, title: 'Space Knight', authors: 'Michael-scott Earle', seriesIndex: 2 },
  ];
  const index = buildWorkIndex(spaceKnight);

  it('reaches volume 1 when our own series_index_sort says 1', () => {
    const m = matchIndexedWork(index, 'Space Knight Book 1', 'Michael-scott Earle', 1);
    assert.equal(m?.work.id, 1);
    assert.equal(m?.via, 'containment');
  });

  it('reaches volume 2 when our own series_index_sort says 2 — not the same row as volume 1', () => {
    const m = matchIndexedWork(index, 'Space Knight Book 2', 'Michael-scott Earle', 2);
    assert.equal(m?.work.id, 2);
    assert.equal(m?.via, 'containment');
  });

  it('refuses when our side states no volume — the ambiguity is real and must not be guessed', () => {
    assert.equal(matchIndexedWork(index, 'Space Knight Book 1', 'Michael-scott Earle'), null);
  });

  it('refuses when our volume has no counterpart on the other side', () => {
    assert.equal(matchIndexedWork(index, 'Space Knight Book 3', 'Michael-scott Earle', 3), null);
  });

  it('the exact tier disambiguates the same way when our own title IS the bare fold', () => {
    // A work legitimately titled with a bare series name (volume 1s are
    // ordinary — see `isBareSeriesTitle`'s header) hits the EXACT tier
    // directly rather than containment, and the same volume rule applies
    // there: `exactCandidates.length > 1` is the identical ambiguous-fold
    // shape, just one step earlier in the function.
    const m = matchIndexedWork(index, 'Space Knight', 'Michael-scott Earle', 1);
    assert.equal(m?.work.id, 1);
    assert.equal(m?.via, 'exact');
  });

  it('refuses the bare series name with no volume stated — still ambiguous, still refused', () => {
    assert.equal(matchIndexedWork(index, 'Space Knight', 'Michael-scott Earle'), null);
  });

  it('a non-ambiguous bare title is unaffected — the Tamer/Oathbound Healer protections still hold', () => {
    // Only one row folds to "oathbound healer" here, so `titleKeyCounts` is 1
    // and pass 2 never engages: this must behave exactly as the existing
    // "still allows containment where only decoration differs" test above.
    const mixed = buildWorkIndex([
      { id: 9, title: 'Oathbound Healer', authors: 'Actus', seriesIndex: null },
    ]);
    const m = matchIndexedWork(mixed, 'Oathbound Healer - MM', 'Actus');
    assert.equal(m?.work.id, 9);
    assert.equal(m?.via, 'containment');
  });

  it('does not let volume disambiguation override the author gate', () => {
    // Same ambiguous pair, wrong author entirely — must still refuse even
    // though the volume number would otherwise resolve cleanly.
    assert.equal(
      matchIndexedWork(index, 'Space Knight Book 1', 'A Completely Different Author', 1),
      null,
    );
  });

  it('matchIndexedWorkAll keeps every one of these refusals', () => {
    // The multi-result entry point shares the rungs, so an ambiguous fold is
    // still a positive refusal — an EMPTY set, never both rows. Handing volume
    // 1 both Space Knight recordings is the flat-lie shape `numbersAgree`
    // exists to stop, one table down.
    assert.deepEqual(matchIndexedWorkAll(index, 'Space Knight Book 1', 'Michael-scott Earle'), []);
    assert.deepEqual(matchIndexedWorkAll(index, 'Space Knight Book 3', 'Michael-scott Earle', 3), []);
    assert.deepEqual(
      matchIndexedWorkAll(index, 'Space Knight Book 1', 'A Completely Different Author', 1),
      [],
    );
    // And it still resolves the one it can.
    const one = matchIndexedWorkAll(index, 'Space Knight Book 2', 'Michael-scott Earle', 2);
    assert.deepEqual(one.map((m) => m.work.id), [2]);

    // ⚠️ The bare title hits the EXACT tier, where the volume DOES settle it —
    // and the row it settled against must not come back through containment.
    const bare = matchIndexedWorkAll(index, 'Space Knight', 'Michael-scott Earle', 1);
    assert.deepEqual(bare.map((m) => [m.work.id, m.via]), [[1, 'exact']]);
  });
});

/**
 * `matchIndexedWorkAll` — the same rungs, without the early return.
 *
 * The caller is `audiobook_edition_holding` (migration 0390), which is keyed
 * per edition and can store more than one audiobook per work. Everything here
 * is about proving the extra answers are the ones the single-result function
 * *would have found and stopped short of*, and that not one gate is looser.
 */
describe('matching — matchIndexedWorkAll, every row that passes', () => {
  it('returns the exact row AND the contained one, strongest first', () => {
    // The shape that actually produces two editions: one row whose title is
    // ours exactly, and a second that differs only by decoration and clears
    // the 60% containment floor (16/19 characters here).
    const audio = [
      { id: 1, title: 'Oathbound Healer MM', authors: 'Actus' },
      { id: 2, title: 'Oathbound Healer', authors: 'Actus' },
    ];
    const index = buildWorkIndex(audio);

    const all = matchIndexedWorkAll(index, 'Oathbound Healer - MM', 'Actus');
    assert.deepEqual(all.map((m) => [m.work.id, m.via]), [[1, 'exact'], [2, 'containment']]);

    // `matchIndexedWork` is untouched: it still answers with the strongest
    // rung and stops, and that answer is `all[0]`.
    const one = matchIndexedWork(index, 'Oathbound Healer - MM', 'Actus');
    assert.equal(one?.work.id, all[0]?.work.id);
    assert.equal(one?.via, all[0]?.via);
  });

  it('emits a row once even when it satisfies two rungs', () => {
    // An exact title is trivially contained in itself. The single-result
    // function never noticed because it returned at the exact rung.
    const index = buildWorkIndex([{ id: 1, title: 'Gold', authors: 'Raven Kennedy' }]);
    assert.deepEqual(
      matchIndexedWorkAll(index, 'Gold', 'Raven Kennedy').map((m) => [m.work.id, m.via]),
      [[1, 'exact']],
    );
  });

  it('REJECTS an exact title with a different author, and offers nothing weaker', () => {
    // The single most important assertion in the single-result tests, restated
    // here because a multi-result function that fell through to containment
    // would find the very same wrong row again and return it.
    const index = buildWorkIndex([{ id: 1, title: 'Gold', authors: 'Raven Kennedy' }]);
    assert.deepEqual(matchIndexedWorkAll(index, 'Gold', 'Chris Cleave'), []);
  });

  it('keeps the number gate — no volume that is not held is claimed', () => {
    const index = buildWorkIndex([
      { id: 1, title: 'Tamer: King of Dinosaurs', authors: 'Michael-scott Earle' },
      { id: 2, title: 'Tamer: King of Dinosaurs 7', authors: 'Michael-scott Earle' },
    ]);
    assert.deepEqual(
      matchIndexedWorkAll(index, 'Tamer: King of Dinosaurs Book 11', 'Michael-scott Earle'),
      [],
    );
    // And volume 7 reaches its own row and NOT the series-level one beside it.
    assert.deepEqual(
      matchIndexedWorkAll(index, 'Tamer: King of Dinosaurs Book 7', 'Michael-scott Earle').map(
        (m) => m.work.id,
      ),
      [2],
    );
  });

  it('⚠️ never hands back the rest of an ambiguous fold through containment', () => {
    // The regression this file exists for. Five DIFFERENT books whose volume
    // decoration the title cleaner strips — the real shape, measured
    // 2026-08-23: `The Eminence in Shadow, Vol. 1` … `Vol. 5` all clean to the
    // identical string. `disambiguateByVolume` picks vol 3 for our vol 3, and
    // the other four are REJECTED, not merely unexamined. Every one of them
    // has `titleKey === target`, and containment is a substring test a string
    // trivially satisfies against itself, so an unguarded pass sweeps all five
    // back in and the work page claims the household owns five recordings of
    // one book. That is the flat "All 5 held on audio" lie in a new place.
    const eminence = [1, 2, 3, 4, 5].map((v) => ({
      id: v,
      title: 'The Eminence in Shadow',
      authors: 'Daisuke Aizawa',
      seriesIndex: v,
    }));
    const index = buildWorkIndex(eminence);

    assert.deepEqual(
      matchIndexedWorkAll(index, 'The Eminence in Shadow', 'Daisuke Aizawa', 3).map((m) => [
        m.work.id,
        m.via,
      ]),
      [[3, 'exact']],
    );
    // No volume on our side: still the whole-fold refusal, not five answers.
    assert.deepEqual(matchIndexedWorkAll(index, 'The Eminence in Shadow', 'Daisuke Aizawa'), []);
  });

  it('keeps the 60% containment floor', () => {
    const index = buildWorkIndex([
      { id: 1, title: 'Mistborn: The Final Empire', authors: 'Brandon Sanderson' },
    ]);
    assert.deepEqual(matchIndexedWorkAll(index, 'Mistborn', 'Brandon Sanderson'), []);
  });

  it('returns [] for a title too short to match, same floor as the single-result form', () => {
    const index = buildWorkIndex([{ id: 1, title: 'Gold', authors: 'Raven Kennedy' }]);
    assert.deepEqual(matchIndexedWorkAll(index, 'A', 'Raven Kennedy'), []);
  });
});

/**
 * ⚠️ Elantris — the case migration 0390 was built for, and the MEASUREMENT that
 * says the schema alone does not close it.
 *
 * The household owns two Elantris recordings (`audiobook_catalog/site/catalog.csv`
 * lines 995 and 996). These are their titles as `loadAudiobooks()` produces
 * them — verified against the real file on 2026-08-23, `cleanTitleWithSeries`
 * leaves both untouched, because the series suffix strip only fires when the
 * series name is a SUFFIX and here it is the whole title of row 995 and the
 * PREFIX of row 996.
 */
describe('matching — the two Elantris audiobooks (measured 2026-08-23)', () => {
  const elantris = [
    // catalog.csv:995 — the full-cast recording. No series stated.
    { id: 1, title: 'Elantris', authors: 'Brandon Sanderson', seriesIndex: null },
    // catalog.csv:996 — series "Elantris", volume 1, narrated by Jack Garrett.
    {
      id: 2,
      title: 'Elantris - Tenth Anniversary Special Edition',
      authors: 'Brandon Sanderson',
      seriesIndex: 1,
    },
  ];
  const index = buildWorkIndex(elantris);

  it('⚠️ still finds only ONE — the containment floor, not the early return, is what loses row 996', () => {
    // The design note in docs/TODO.md part B assumed the early return in
    // `matchIndexedWork` was what dropped the Tenth Anniversary edition.
    // Measured, it is not: with the early return gone, row 996 is still
    // refused, by the 60% length floor. Folded, our side is "elantris" (8
    // chars) and row 996 is "elantris tenth anniversary special edition" (42),
    // a ratio of 0.19 against a floor of 0.6 — the same floor that stops
    // "Mistborn" reaching "Mistborn: The Final Empire".
    //
    // This assertion pins the measurement rather than the wish. Reaching row
    // 996 needs a decision nobody has made: either teach the title cleaner
    // that "Tenth Anniversary Special Edition" is edition decoration (a change
    // to `cleanAudiobookTitle`, which produces stored keys), or move the
    // containment floor (which this file's header says may only move WITH
    // evidence). Both are owner-facing calls, not a refactor.
    const all = matchIndexedWorkAll(index, 'Elantris', 'Brandon Sanderson');
    assert.deepEqual(all.map((m) => [m.work.id, m.via]), [[1, 'exact']]);

    // And the single-result function is unchanged — same row, same rung.
    assert.equal(matchIndexedWork(index, 'Elantris', 'Brandon Sanderson')?.work.id, 1);
  });

  it('stores BOTH the moment the second edition clears the same gates', () => {
    // The half that migration 0390 does close, proved on the same pair: if the
    // sibling catalog spelled row 996 in a way that passes the unchanged
    // rungs, the multi-result function hands back both editions — the full-cast
    // row with no series, and the one that knows series "Elantris" volume 1.
    // `audiobook_holding`'s view then shows the series-bearing row, because it
    // orders `(series IS NULL)` first.
    //
    // ⚠️ "Elantris Live" and not "Elantris 10th" on purpose: a digit in the
    // second title would make `numbersAgree` refuse (one number against none),
    // which is the Tamer protection doing its job. The window where a second
    // edition is reachable is genuinely narrow — 8 chars of title admit at most
    // 13, so only a short, numberless suffix survives both gates.
    const reachable = buildWorkIndex([
      { id: 1, title: 'Elantris', authors: 'Brandon Sanderson', seriesIndex: null },
      { id: 2, title: 'Elantris Live', authors: 'Brandon Sanderson', seriesIndex: 1 },
    ]);
    const all = matchIndexedWorkAll(reachable, 'Elantris', 'Brandon Sanderson');
    assert.deepEqual(all.map((m) => [m.work.id, m.via]), [[1, 'exact'], [2, 'containment']]);
  });
});

/**
 * ⚠️ Isles of the Emberdark — an EDITION SET, and the reason `isEditionSet`
 * exists. Measured 2026-08-26.
 *
 * The household owns two recordings of one book, and
 * `audiobook_catalog/site/catalog.csv` files them under the identical title,
 * the identical series and the identical volume number — the strings below are
 * verbatim from that file (rows 98 and 99), through `loadAudiobooks()`. Before
 * this rule the ambiguous-fold refusal treated them as two different volumes,
 * so BOTH catalogs showed the book as having no audiobook at all: padhard #348
 * filed under "no audiobook" by the backfill dry run, and main #4's
 * `audiobook_edition_holding` row marked `stale_at 2026-08-17` — the day the
 * second recording landed in the CSV.
 *
 * The two padhard/main strings are pinned in BOTH directions because the two
 * instances hold different EDITIONS of the print book — padhard the Tor
 * *"…: A Cosmere Novel"* (ISBN 9781250415394), main the Dragonsteel
 * *"Isles of the Emberdark"* (9781938570506) — and it was the subtitle that
 * kept padhard's printed title out.
 */
describe('matching — Isles of the Emberdark, two recordings of one book (2026-08-26)', () => {
  /** catalog.csv rows 98 and 99, as `loadAudiobooks()` produces them. */
  const emberdark = [
    {
      id: 1,
      title: 'Isles of the Emberdark',
      authors: 'Brandon Sanderson',
      series: 'Secret Projects',
      seriesIndex: 5,
    },
    {
      id: 2,
      title: 'Isles of the Emberdark',
      authors: 'Brandon Sanderson',
      series: 'Secret Projects',
      seriesIndex: 5,
    },
  ];
  const index = buildWorkIndex(emberdark);

  it('main #4 — the printed title reaches BOTH recordings, not neither', () => {
    assert.deepEqual(
      matchIndexedWorkAll(index, 'Isles of the Emberdark', 'Brandon Sanderson').map((m) => [
        m.work.id,
        m.via,
      ]),
      [
        [1, 'exact'],
        [2, 'exact'],
      ],
    );
  });

  it('padhard #348 — the subtitled title reaches nothing, its recorded ALIAS reaches both', () => {
    // ⚠️ The printed title is genuinely out of reach and that is correct, not a
    // gap this change papers over: folded, "isles of the emberdark" is 22
    // characters against 38, a containment ratio of 0.58 under a floor of 0.6.
    // The alias is what bridges it — which is exactly what `work_alias` is for.
    assert.deepEqual(
      matchIndexedWorkAll(index, 'Isles of the Emberdark: A Cosmere Novel', 'Brandon Sanderson'),
      [],
    );
    assert.deepEqual(
      matchIndexedWorkAll(index, 'Isles of the Emberdark', 'Brandon Sanderson').map(
        (m) => m.work.id,
      ),
      [1, 2],
    );
  });

  it('⚠️ keeps `lookupAll(...)[0] === lookup(...)` — the invariant the sweep relies on', () => {
    const all = matchIndexedWorkAll(index, 'Isles of the Emberdark', 'Brandon Sanderson');
    const one = matchIndexedWork(index, 'Isles of the Emberdark', 'Brandon Sanderson');
    assert.equal(one?.work.id, all[0]?.work.id);
    assert.equal(one?.via, 'exact');
  });

  it('the author gate still applies to every member', () => {
    assert.deepEqual(matchIndexedWorkAll(index, 'Isles of the Emberdark', 'Some Other Author'), []);
    assert.equal(matchIndexedWork(index, 'Isles of the Emberdark', 'Some Other Author'), null);
  });

  it('⚠️ DIFFERENT VOLUMES are still refused — the rule reads the number, it does not ignore it', () => {
    // The protection this must not weaken. Same title, same series, DIFFERENT
    // volume numbers: not an edition set, and the whole-fold refusal stands
    // exactly as it did for The Eminence in Shadow.
    const volumes = buildWorkIndex(
      [1, 2, 3].map((v) => ({
        id: v,
        title: 'Space Knight',
        authors: 'Ivan Kal',
        series: 'Space Knight',
        seriesIndex: v,
      })),
    );
    assert.deepEqual(matchIndexedWorkAll(volumes, 'Space Knight', 'Ivan Kal'), []);
    // Our own volume number still narrows it to exactly one — unchanged.
    assert.deepEqual(
      matchIndexedWorkAll(volumes, 'Space Knight', 'Ivan Kal', 2).map((m) => m.work.id),
      [2],
    );
  });

  it('⚠️ a fold with no SERIES is not an edition set either', () => {
    // Series agreement is the second half of the discriminator, and it is what
    // stops two unrelated books that share a title, an author and a volume
    // number from being called recordings of each other. With the series
    // dropped, the same rows refuse exactly as before.
    const seriesless = buildWorkIndex([
      { id: 1, title: 'Gold', authors: 'Raven Kennedy', seriesIndex: 1 },
      { id: 2, title: 'Gold', authors: 'Raven Kennedy', seriesIndex: 1 },
    ]);
    assert.deepEqual(matchIndexedWorkAll(seriesless, 'Gold', 'Raven Kennedy'), []);
  });

  it('⚠️ a fold whose members state DIFFERENT series is not an edition set', () => {
    const crossSeries = buildWorkIndex([
      { id: 1, title: 'Gold', authors: 'Raven Kennedy', series: 'The Plated Prisoner', seriesIndex: 1 },
      { id: 2, title: 'Gold', authors: 'Raven Kennedy', series: 'Something Else', seriesIndex: 1 },
    ]);
    assert.deepEqual(matchIndexedWorkAll(crossSeries, 'Gold', 'Raven Kennedy'), []);
  });

  it('the dramatized multi-part case, measured on the real ACOTAR rows', () => {
    // The other thing the rule unblocked, and the reason `docs/DONE.md`'s
    // 2026-08-25 note "do not try to fix this in the matcher" is superseded:
    // Audible splits one dramatization across parts, `cleanTitleWithSeries`
    // strips the part/series decoration, and the halves fold to one string with
    // one series and one volume number. They are two files of one recording,
    // not two volumes.
    const acotar = buildWorkIndex([
      {
        id: 1,
        title: 'A Court of Mist and Fury',
        authors: 'Sarah J. Maas',
        series: 'A Court of Thorns and Roses',
        seriesIndex: 2,
      },
      {
        id: 2,
        title: 'A Court of Mist and Fury',
        authors: 'Sarah J. Maas',
        series: 'A Court of Thorns and Roses',
        seriesIndex: 2,
      },
    ]);
    assert.deepEqual(
      matchIndexedWorkAll(acotar, 'A Court of Mist and Fury', 'Sarah J. Maas').map((m) => m.work.id),
      [1, 2],
    );
  });
});

describe('matching — the bare-series-name rule, tier 2 (review-only)', () => {
  /*
   * The 2026-08-13 incident in miniature: *Space Knight* and *Tamer* are series
   * names, and Open Library answered scanned barcodes with records titled with
   * the bare name. Tier 1 (the aggregate refusal in @lc/isbn) catches the
   * multi-ISBN and /works/ shapes; this predicate is tier 2, marking the
   * single-record shape for a person's eye — never refusing, because 18 of 341
   * real works ARE legitimately titled with a series name (volume 1s, picture
   * books like Bizzy Bear).
   */
  const seriesKeys = foldSeriesNames([
    'Space Knight',
    'Tamer: King of Dinosaurs',
    'Bizzy Bear',
    'The Wandering Inn',
  ]);

  it('flags a bare series name with no volume number', () => {
    assert.equal(isBareSeriesTitle('Space Knight', seriesKeys), true);
    // Folded like everything else: punctuation and case cannot dodge it.
    assert.equal(isBareSeriesTitle('TAMER: King of Dinosaurs', seriesKeys), true);
  });

  it('does not flag a title carrying a volume number — that names one book', () => {
    assert.equal(isBareSeriesTitle('Space Knight Book 3', seriesKeys), false);
    assert.equal(isBareSeriesTitle('Tamer: King of Dinosaurs 7', seriesKeys), false);
  });

  it('does not flag a title that is not a known series name', () => {
    assert.equal(isBareSeriesTitle('The Book Thief', seriesKeys), false);
    assert.equal(isBareSeriesTitle('Oathbound Healer', seriesKeys), false);
  });

  it('still flags the legitimate volume-1 shape — review-only means a person decides', () => {
    // The Wandering Inn book 1 is titled exactly "The Wandering Inn". The flag
    // is CORRECT there too: the row says "check", the person says "it really is
    // called that", one tap. This test pins the review-only stance — if someone
    // "fixes" the predicate to skip such titles, the Space Knight shape walks
    // straight back in wearing volume 1's clothes.
    assert.equal(isBareSeriesTitle('The Wandering Inn', seriesKeys), true);
  });

  it('folds out blanks and near-empty names rather than matching everything', () => {
    const keys = foldSeriesNames(['', '  ', '한국어']);
    // Non-Latin folds to "" (the known CJK gap) — must not become a key that
    // flags every unparseable title.
    assert.equal(keys.size, 0);
    assert.equal(isBareSeriesTitle('', seriesKeys), false);
  });
});

/* --------------------------------------------------------------------------
 * Covers — migration 0040
 *
 * Every rule below guards something that fails SILENTLY. A wrongly-accepted
 * upload is served from our own origin forever; a wrongly-cleared "cover
 * needed" mark retires a book from the only list that would have got it fixed.
 * ------------------------------------------------------------------------ */

/** A file of `size` bytes whose first bytes are `head`. */
function fileOf(head: number[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(head.slice(0, size));
  return bytes;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('covers — what a file actually is', () => {
  it('reads the five accepted formats off their own bytes', () => {
    assert.equal(sniffImageType(fileOf(JPEG, 32)), 'image/jpeg');
    assert.equal(sniffImageType(fileOf(PNG, 32)), 'image/png');
    assert.equal(sniffImageType(new TextEncoder().encode('GIF89a...........')), 'image/gif');
    // RIFF container: "RIFF", four size bytes, then "WEBP".
    assert.equal(sniffImageType(new TextEncoder().encode('RIFF1234WEBPVP8 ')), 'image/webp');
    assert.equal(sniffImageType(new TextEncoder().encode('1234ftypavif....')), 'image/avif');
  });

  it('⚠️ refuses a file that merely CLAIMS to be an image', () => {
    // The whole reason the sniff exists. A multipart part can declare any type
    // it likes, and every one of these would otherwise be stored and served
    // from our own origin under a name ending in .jpg.
    const html = new TextEncoder().encode('<!doctype html><html><body>404 Not Found</body></html>');
    assert.equal(sniffImageType(html), null);
    const check = checkCoverUpload(html, 'image/jpeg');
    assert.equal(check.ok, false);
    assert.equal(check.contentType, null);

    assert.equal(sniffImageType(new TextEncoder().encode('%PDF-1.7\n%....')), null);
    // SVG is deliberately not an accepted cover: it is a document that can
    // carry script, and nothing here needs a vector cover.
    assert.equal(sniffImageType(new TextEncoder().encode('<svg xmlns="http://...')), null);
    // HEIC lands in the same ISO-BMFF container as AVIF and is NOT accepted —
    // an iPhone would happily upload one that half of browsers cannot render.
    assert.equal(sniffImageType(new TextEncoder().encode('1234ftypheic....')), null);
  });

  it('⚠️ refuses a 43-byte placeholder even though it IS an image', () => {
    // The trap `verifyCoverUrl` was written for, arriving down the upload path
    // instead. Open Library serves exactly this as HTTP 200. A real, tiny,
    // valid image is still not a book cover.
    const tiny = fileOf(JPEG, 43);
    assert.equal(sniffImageType(tiny), 'image/jpeg');
    const check = checkCoverUpload(tiny);
    assert.equal(check.ok, false);
    assert.match(check.reason ?? '', /placeholder/);
  });

  it('accepts a plausible cover, and reports the type it read', () => {
    const check = checkCoverUpload(fileOf(PNG, 40_000), 'image/jpeg');
    assert.equal(check.ok, true);
    // ⚠️ The BYTES win over the declaration. Browsers get the type wrong on
    // drag-and-drop, and the file itself is the authority.
    assert.equal(check.contentType, 'image/png');
    assert.equal(check.bytes, 40_000);
  });

  it('refuses an empty file and a full-size photograph', () => {
    assert.equal(checkCoverUpload(new Uint8Array(0)).ok, false);
    const check = checkCoverUpload(fileOf(JPEG, MAX_COVER_BYTES + 1));
    assert.equal(check.ok, false);
    assert.match(check.reason ?? '', /limit/);
  });
});

describe('covers — where an upload is stored', () => {
  it('⚠️ hashes the CONTENT, so a replacement is a different URL', () => {
    const a = coverObjectKey('the hobbit|tolkien', 'abc123def456789012345', 'image/jpeg');
    const b = coverObjectKey('the hobbit|tolkien', 'ffffffffffffffffffffff', 'image/jpeg');
    assert.notEqual(a, b);
    // The opposite of apps/web/public/covers/, whose names hash the work key —
    // which is why those can only be cached for a day. See covers-and-series.md.
    assert.equal(a, 'covers/the-hobbit-tolkien-abc123def4567890.jpg');
  });

  it('maps types to the extension a browser expects', () => {
    assert.equal(extensionFor('image/jpeg'), 'jpg');
    assert.equal(extensionFor('image/png'), 'png');
    assert.equal(extensionFor('image/webp'), 'webp');
  });
});

describe('covers — which books still need one', () => {
  it('⚠️ a stand-in still needs a cover, even though it HAS one', () => {
    // The five Illumicrate Percy Jackson works. They have a URL, the image
    // loads, `cover_url IS NOT NULL` says yes — and it is the wrong picture.
    // Every check written before migration 0040 called this book finished.
    assert.equal(
      coverNeeded({ coverUrl: 'https://us.illumicrate.com/x.jpg', coverStatus: 'standin' }),
      true,
    );
  });

  it('a book with no cover needs one', () => {
    assert.equal(coverNeeded({ coverUrl: null, coverStatus: null }), true);
  });

  it('⚠️ an UNASSESSED cover does not need one', () => {
    // NULL means nobody has looked, which is true of nearly every row in this
    // catalog. Treating it as suspect would put all 224 works on the list and
    // make the feature useless. Only a positive 'standin' counts.
    assert.equal(coverNeeded({ coverUrl: 'https://covers/x.jpg', coverStatus: null }), false);
    assert.equal(coverNeeded({ coverUrl: 'https://covers/x.jpg', coverStatus: 'ok' }), false);
  });
});

/**
 * The cover picker's assembly — which covers a book is offered, and how they
 * are described. Ported as an idea from the board game catalog's
 * listCoverCandidates; these tests pin what survived the port.
 */
describe('covers — the picker offers every cover the book could wear', () => {
  const edition = (over: Partial<CoverCandidateEdition> & { id: number }): CoverCandidateEdition => ({
    coverUrl: null,
    isbn13: null,
    format: 'paperback',
    editionName: null,
    publisher: null,
    publishedYear: null,
    source: 'manual',
    ...over,
  });

  it('dedupes by URL, and the edition wins the description', () => {
    // The common case: the work's cover IS one of its editions' covers.
    const out = assembleCoverCandidates({
      currentUrl: 'https://img/a.jpg',
      openlibraryWorkId: null,
      editions: [
        edition({ id: 7, coverUrl: 'https://img/a.jpg', publisher: 'Tor', publishedYear: 2019 }),
      ],
      history: [{ url: 'https://img/a.jpg', at: '2026-08-01 00:00:00' }],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.source, 'edition');
    assert.equal(out[0]!.selected, true);
    assert.equal(out[0]!.caption, 'Tor · 2019');
    assert.equal(out[0]!.editionId, 7);
  });

  it('⚠️ a current cover nothing explains is still offered — never swap-away-only', () => {
    // A hand-pasted URL, or a cover set before the audit log existed. Losing
    // it from the grid would make the picker able to swap away from something
    // it could not offer back.
    const out = assembleCoverCandidates({
      currentUrl: 'https://elsewhere/hand-pasted.jpg',
      openlibraryWorkId: null,
      editions: [edition({ id: 1, coverUrl: 'https://img/b.jpg' })],
      history: [],
    });
    assert.deepEqual(
      out.map((c) => [c.url, c.source, c.selected]),
      [
        ['https://elsewhere/hand-pasted.jpg', 'current', true],
        ['https://img/b.jpg', 'edition', false],
      ],
    );
  });

  it('history rows become "Previous cover" cards that say when they stopped', () => {
    const out = assembleCoverCandidates({
      currentUrl: 'https://img/new.jpg',
      openlibraryWorkId: null,
      editions: [],
      history: [{ url: 'https://img/old.jpg', at: '2026-08-10 12:00:00' }],
    });
    const prev = out.find((c) => c.source === 'history');
    assert.ok(prev);
    assert.equal(prev.label, 'Previous cover');
    assert.equal(prev.caption, 'until 2026-08-10');
    assert.equal(prev.derived, false);
  });

  it('⚠️ a swap-back is described as what it is now, not "Previous cover · in use"', () => {
    // Found by exercising the live endpoint: after swapping back, the current
    // cover deduped into its own history card and read as a contradiction.
    const out = assembleCoverCandidates({
      currentUrl: 'https://img/old.jpg',
      openlibraryWorkId: null,
      editions: [],
      history: [
        { url: 'https://img/newer.jpg', at: '2026-08-13 01:00:00' },
        { url: 'https://img/old.jpg', at: '2026-08-12 00:00:00' },
      ],
    });
    const current = out.find((c) => c.selected);
    assert.ok(current);
    assert.equal(current.label, 'Current cover');
    assert.equal(current.source, 'current');
    assert.equal(current.caption, null);
    // The genuinely-previous one still reads as history.
    assert.equal(out.find((c) => !c.selected)?.label, 'Previous cover');
  });

  it('⚠️ Open Library candidates are guesses, marked derived, sorted last, 404-not-placeholder', () => {
    // `?default=false` is load-bearing: without it their API answers a
    // 43-byte 1×1 as HTTP 200 (the exact thing MIN_COVER_BYTES exists for),
    // and a wrong guess would render as a broken-looking blank instead of
    // failing so the UI can drop the card.
    const out = assembleCoverCandidates({
      currentUrl: 'https://img/a.jpg',
      openlibraryWorkId: 'OL123W',
      editions: [edition({ id: 3, isbn13: '9781638493457' })],
      history: [],
    });
    const guesses = out.filter((c) => c.source === 'guess');
    assert.equal(guesses.length, 2);
    assert.ok(guesses.every((g) => g.derived));
    assert.ok(guesses.every((g) => g.url.endsWith('?default=false')));
    assert.ok(guesses[0]!.url.includes('/olid/OL123W-'));
    assert.ok(guesses[1]!.url.includes('/isbn/9781638493457-'));
    // Guesses after facts, current first. (Edition 3 carries no cover of its
    // own here, so its only contribution is the ISBN guess.)
    assert.equal(out[0]!.selected, true);
    assert.deepEqual(
      out.map((c) => c.source),
      ['current', 'guess', 'guess'],
    );
  });

  it('a coverless book with no history and no OL id gets an empty grid, not an invented one', () => {
    assert.deepEqual(
      assembleCoverCandidates({
        currentUrl: null,
        openlibraryWorkId: null,
        editions: [edition({ id: 1 })],
        history: [],
      }),
      [],
    );
  });

  it('blank and whitespace URLs never become cards', () => {
    const out = assembleCoverCandidates({
      currentUrl: '   ',
      openlibraryWorkId: null,
      editions: [edition({ id: 1, coverUrl: '' })],
      history: [{ url: '  ', at: '2026-08-01' }],
    });
    assert.deepEqual(out, []);
  });
});

/**
 * The rule behind "Owned more than once", rewritten 2026-08-11.
 *
 * Every case here is a real production row. The old rule counted **editions**
 * and got all three of its hits wrong; these tests are the measurement written
 * down so it cannot come back.
 */
describe('owned more than once — copies, not editions', () => {
  const copy = (status: string) => ({ status });

  it('⚠️ two owned copies is the whole rule', () => {
    assert.equal(ownedMoreThanOnce([copy('owned'), copy('owned')]), true);
  });

  it('⚠️ ONE copy is not, however many editions the work has', () => {
    // *Dinosaur Dance!* — two edition rows, one with an ISBN and no copy, one
    // with no ISBN and a copy. One board book, recorded twice by two different
    // scan paths. The old rule called it "bought more than once".
    assert.equal(ownedMoreThanOnce([copy('owned')]), false);
  });

  it('⚠️ ZERO copies is not, and this is what the old rule fired on', () => {
    // *The Pout-Pout Fish* and *How the Grinch Stole Christmas*: two genuine
    // ISBNs each, no copies at all. Two printings exist in the world; nothing
    // says we hold either of them twice.
    assert.equal(ownedMoreThanOnce([]), false);
  });

  it('a lent copy still counts — the book is ours, it is just elsewhere', () => {
    assert.equal(ownedMoreThanOnce([copy('owned'), copy('lent')]), true);
  });

  it('⚠️ a wish for a book we hold is NOT a duplicate', () => {
    // "We have the EPUB and want the hardcover" is the ordinary wishlist case
    // and shows up as a wanted copy against a book that is also owned.
    assert.equal(ownedMoreThanOnce([copy('owned'), copy('wanted')]), false);
    assert.equal(ownedMoreThanOnce([copy('owned'), copy('preordered')]), false);
  });

  it('a copy that has left, or was never ours, does not count', () => {
    assert.equal(ownedMoreThanOnce([copy('owned'), copy('sold')]), false);
    assert.equal(ownedMoreThanOnce([copy('owned'), copy('borrowed')]), false);
  });

  it('heldCopies keeps the rows themselves, so the page can show them', () => {
    const kept = heldCopies([
      { status: 'owned', id: 1 },
      { status: 'wanted', id: 2 },
      { status: 'lent', id: 3 },
    ]);
    assert.deepEqual(
      kept.map((c) => c.id),
      [1, 3],
    );
  });
});

/**
 * The delete button's hard stop — work #139's lesson written as a rule.
 *
 * Two edition rows there looked like duplicates, but the two COPIES under
 * them were real books the owner owns. A duplicate edition and a duplicate
 * copy are different bugs, and a delete that quietly takes owned copies with
 * it destroys the record of physical property.
 */
describe('deletion blockers — everything except a plain wish', () => {
  it('⚠️ every property-recording status blocks, with no force flag anywhere', () => {
    for (const status of ['owned', 'lent', 'preordered', 'borrowed', 'sold']) {
      assert.equal(copyBlocksDeletion({ status }), true, `${status} must block`);
    }
  });

  it('a plain wish does not block — no object, no money, nothing destroyed', () => {
    assert.equal(copyBlocksDeletion({ status: 'wanted' }), false);
    assert.equal(copyBlocksDeletion({ status: 'wanted', isSigned: false }), false);
  });

  it('⚠️ a signed copy blocks whatever its status — a signature cannot be re-scanned', () => {
    assert.equal(copyBlocksDeletion({ status: 'wanted', isSigned: true }), true);
  });

  it('deletionBlockers keeps the rows, so the refusal can NAME the objects', () => {
    const blockers = deletionBlockers([
      { status: 'wanted', id: 1 },
      { status: 'owned', id: 2 },
      { status: 'lent', id: 3 },
    ]);
    assert.deepEqual(
      blockers.map((c) => c.id),
      [2, 3],
    );
  });

  it('a work with no copies at all has no blockers — the phantom-scan case', () => {
    // The realistic delete target: a work created by a bad scan, editions but
    // nothing owned. (A phantom whose scan also wrote an owned copy still
    // blocks, and that is correct — someone must look before it goes.)
    assert.deepEqual(deletionBlockers([]), []);
  });
});

/**
 * The scan-time overlap warning — the wording, and which way round it reads.
 *
 * ⚠️ `contains` is directional. A sentence built from the wrong end is not
 * untidy, it is false: it would tell somebody they own an omnibus inside one of
 * its own chapters. Migration 0004 makes the same point about the row itself.
 */
describe('overlap — you already own this, inside something else', () => {
  it('says nothing when there is nothing to say', () => {
    assert.equal(overlapSentence([]), null);
  });

  it('⚠️ scanning a volume whose omnibus we hold reads "inside"', () => {
    assert.equal(
      overlapSentence([
        { workId: 103, title: 'The Divine Dungeon Complete Series', direction: 'inside' },
      ]),
      'You already own this inside The Divine Dungeon Complete Series.',
    );
  });

  it('⚠️ scanning the omnibus of a volume we hold reads the other way', () => {
    assert.equal(
      overlapSentence([{ workId: 24, title: 'Dungeon Born', direction: 'holds' }]),
      'This collects Dungeon Born, which you already own.',
    );
  });

  it('an omnibus over several books we hold names all of them', () => {
    assert.equal(
      overlapSentence([
        { workId: 24, title: 'Dungeon Born', direction: 'holds' },
        { workId: 25, title: 'Dungeon Madness', direction: 'holds' },
      ]),
      'This collects Dungeon Born and Dungeon Madness, which you already own.',
    );
  });

  it('both directions at once is possible and both are said', () => {
    const said = overlapSentence([
      { workId: 103, title: 'The Complete Series', direction: 'inside' },
      { workId: 24, title: 'Dungeon Born', direction: 'holds' },
    ]);
    assert.equal(
      said,
      'You already own this inside The Complete Series. ' +
        'This collects Dungeon Born, which you already own.',
    );
  });
});

/**
 * ⚠️ `collects` is a third axis, not a tidier edition name.
 *
 * Migration 0050 refused to make `omnibus` an `edition_kind` and said, in
 * writing, that the axis would need its own column. 0060 is that column. This
 * test is the one that fails if somebody folds them back together.
 */
describe('edition contents — what is printed inside the object', () => {
  it('travels beside the name and the kind, independently', () => {
    const parsed = updateEditionSchema.parse({
      editionName: 'Omnibus - collects volumes 1-3',
      collects: 'Volumes 1-3',
    });
    assert.equal(parsed.collects, 'Volumes 1-3');
    // Untouched: an omnibus is an ordinary trade printing.
    assert.equal(parsed.editionKind, undefined);
  });

  it('an explicit null clears it, which an absent key does not', () => {
    assert.equal(updateEditionSchema.parse({ collects: null }).collects, null);
    assert.equal(Object.hasOwn(updateEditionSchema.parse({ pages: 490 }), 'collects'), false);
  });

  it('an empty box is a clear, not the string ""', () => {
    assert.equal(updateEditionSchema.parse({ collects: '   ' }).collects, null);
  });
});

describe('which catalog wrote a review, including the 869 that never said', () => {
  it('⚠️ a document with neither source nor workKey is an AUDIOBOOK review', () => {
    // Measured against the live collection 2026-08-11: 869 documents, 0 with
    // `source`, 0 with `workKey`. Reading `doc.source` alone answers "unknown"
    // for the entire corpus, which would derive 869 read states with no format
    // — for an owner who listens to far more than they read. Only two writers
    // touch that collection, and this catalog always stamps both fields.
    assert.equal(reviewSourceOf({ bookId: 'firefight', displayName: 'x' } as never), 'audio');
  });

  it('an explicit source is believed over the inference', () => {
    assert.equal(reviewSourceOf({ source: 'library', workKey: 'a|b' }), 'library');
    assert.equal(reviewSourceOf({ source: 'audio', workKey: 'a|b' }), 'audio');
    // The backfill stamps both together, so a library review is never mistaken.
    assert.equal(reviewSourceOf({ source: 'library' }), 'library');
  });

  it('⚠️ a workKey with no source is UNKNOWN, not assumed', () => {
    // Unreachable today — the key backfill writes `source` in the same merge.
    // Whatever produced it is something this rule has never seen, so it says so.
    assert.equal(reviewSourceOf({ workKey: 'firefight|brandon sanderson' }), null);
  });

  it('⚠️ THE INVARIANT: a document this catalog writes always carries both', () => {
    // `reviewSourceOf` is only sound while this stays true. Make `workKey`
    // conditional in `reviewDocFor` and the inference starts calling print
    // reviews audiobooks, silently, on every book page. Nothing else fails.
    const { doc } = reviewDocFor({
      title: 'Firefight',
      authors: 'Brandon Sanderson',
      displayName: 'Nick',
      rating: 4,
      text: '',
    });
    assert.equal(typeof doc.workKey, 'string');
    assert.equal(doc.source, 'library');
    assert.equal(reviewSourceOf(doc), 'library');
  });
});

describe('read state from a rating — whose rating it is', () => {
  it('⚠️ a housemate’s review does NOT mark my book read', () => {
    // The refinement the whole feature turns on: "ratings should be for the
    // logged in person. so if its a rating i left mark it read for me." Both
    // people review into the same Firestore collection.
    assert.equal(
      isMyReview({ displayName: 'Gabi' }, { email: 'nb@example.com', reviewName: 'Nick' }),
      false,
    );
  });

  it('matches on email when the document has one', () => {
    assert.equal(
      isMyReview(
        { displayName: 'Nicholas B', email: 'NB@Example.com' },
        { email: 'nb@example.com', reviewName: 'Nick' },
      ),
      true,
    );
  });

  it('⚠️ email WINS over the name, so a renamed Google account is not two people', () => {
    // displayName is a Google profile string and can change at any time. When
    // both sides carry an email, the name is not consulted at all.
    assert.equal(
      isMyReview(
        { displayName: 'Nick', email: 'someone.else@example.com' },
        { email: 'nb@example.com', reviewName: 'Nick' },
      ),
      false,
    );
  });

  it('⚠️ falls back to the folded display name — the ONLY key that reaches the 860', () => {
    // Reviews written on the audiobook site carry no email: that site signs out
    // of Firebase before storing anything and attributes by displayName. A
    // stricter rule here would see none of the existing reviews.
    assert.equal(isMyReview({ displayName: '  nIcK ' }, { reviewName: 'Nick' }), true);
  });

  it('an empty name matches nobody', () => {
    // Otherwise a document with no displayName would belong to every user whose
    // reviewName has never been set, which is all of them at first sign-in.
    assert.equal(isMyReview({ displayName: '' }, { reviewName: '' }), false);
    assert.equal(isMyReview({}, { email: 'nb@example.com' }), false);
  });
});

describe('read state from a rating — what counts as evidence', () => {
  it('⚠️ 0.5 is a rating: a book somebody hated is still a book they read', () => {
    // There is deliberately no floor. A threshold would silently un-read the
    // worst books in the house.
    assert.equal(ratingImpliesRead(0.5), true);
    assert.equal(ratingImpliesRead(1), true);
    assert.equal(ratingImpliesRead(5), true);
  });

  it('a value off the shared half-star scale is not a rating', () => {
    assert.equal(ratingImpliesRead(0), false);
    assert.equal(ratingImpliesRead(3.7), false);
    assert.equal(ratingImpliesRead(6), false);
    assert.equal(ratingImpliesRead(null), false);
    assert.equal(ratingImpliesRead(undefined), false);
  });

  it('⚠️ an audiobook review is evidence of LISTENING, and that is the common case', () => {
    // The owner reads far more audiobooks than physical books. Dropping this
    // would make the page say "read" against a paperback never opened.
    assert.equal(readFormatFromReviewSource('audio'), 'audio');
  });

  it('a library review is evidence of no particular format', () => {
    // This catalog holds EPUBs and Kindle editions too, and the review form
    // asks for a rating, not a format. Guessing 'print' would be a fabrication.
    assert.equal(readFormatFromReviewSource('library'), null);
    assert.equal(readFormatFromReviewSource(null), null);
    assert.equal(readFormatFromReviewSource(undefined), null);
  });
});

describe('read state from a rating — what it may overwrite', () => {
  it('a rated book with no user_book row at all becomes read', () => {
    // ⚠️ The case that happens ~860 times. `user_book` held zero rows when this
    // was built, so this is not gap-filling — it establishes the read history.
    assert.deepEqual(deriveReadState({ rating: 4.5, source: 'audio' }, null), {
      readState: 'read',
      readFormat: 'audio',
      readStateHow: 'rating',
    });
  });

  it('a row cacheRating minted — unread, no recorded how — is fair game', () => {
    assert.deepEqual(
      deriveReadState(
        { rating: 3, source: 'audio' },
        { readState: 'unread', readStateHow: null, readFormat: null },
      ),
      { readState: 'read', readFormat: 'audio', readStateHow: 'rating' },
    );
  });

  it('⚠️ NEVER overrules a person, even one who has just marked it unread', () => {
    // The reason migration 0070 exists. Without this, every page view would put
    // 'read' back over the correction and the feature would be untrustworthy.
    assert.equal(
      deriveReadState(
        { rating: 5, source: 'audio' },
        { readState: 'unread', readStateHow: 'human', readFormat: null },
      ),
      null,
    );
  });

  it('⚠️ never promotes a did-not-finish, which can carry a rating of its own', () => {
    // 'dnf' is strictly more informative than 'read'. Overwriting it would
    // replace the specific truth with a vaguer one. Same for 'reference'.
    assert.equal(
      deriveReadState(
        { rating: 1, source: 'audio' },
        { readState: 'dnf', readStateHow: null, readFormat: null },
      ),
      null,
    );
    assert.equal(
      deriveReadState(
        { rating: 4, source: 'audio' },
        { readState: 'reference', readStateHow: null, readFormat: null },
      ),
      null,
    );
  });

  it('is idempotent — a second look at the same rating writes nothing', () => {
    // Load-bearing three times over: it keeps the backfill's "would write"
    // count honest, keeps the browser from writing on every page view, and is
    // what makes `marked: []` mean "nothing to reload for".
    assert.equal(
      deriveReadState(
        { rating: 4, source: 'audio' },
        { readState: 'read', readStateHow: 'rating', readFormat: 'audio' },
      ),
      null,
    );
  });

  it('⚠️ refines its OWN earlier answer when the audiobook review turns up later', () => {
    // A library review derived a read with no format; the audiobook review for
    // the same book arrives afterwards and is better evidence. Allowed because
    // the row is stamped 'rating' — ours to improve, unlike a human's.
    assert.deepEqual(
      deriveReadState(
        { rating: 4, source: 'audio' },
        { readState: 'read', readStateHow: 'rating', readFormat: null },
      ),
      { readState: 'read', readFormat: 'audio', readStateHow: 'rating' },
    );
  });

  it('never overwrites a format already recorded', () => {
    // Someone said they read this in print. An audio rating adds the read state
    // it did not have, and leaves their answer about format alone.
    assert.deepEqual(
      deriveReadState(
        { rating: 4, source: 'audio' },
        { readState: 'unread', readStateHow: null, readFormat: 'print' },
      ),
      { readState: 'read', readFormat: 'print', readStateHow: 'rating' },
    );
  });

  it('a non-rating changes nothing, whatever the row says', () => {
    assert.equal(deriveReadState({ rating: 0 }, null), null);
    assert.equal(deriveReadState({ rating: 3.3 }, null), null);
  });
});

/**
 * The whole-library sweep's half of the rule. What it *refuses* is the part
 * worth guarding: every one of these was a way to mark the wrong person's books
 * read, or to mark the right person's wrong book read.
 */
describe('a sweep of one person’s ratings', () => {
  const me = { email: 'nb@example.com', reviewName: 'Skylar' };

  it('keeps my ratings and drops everybody else’s', () => {
    const out = observedRatingsFromReviews(
      [
        { displayName: 'Skylar', rating: 4, workKey: 'dungeon born|dakota krout', source: 'audio' },
        // ⚠️ The housemate case. 457 of the 869 documents belong to people who
        // have never signed in here, and this is the whole point of the owner's
        // refinement: their rating must not mark MY book read.
        { displayName: 'Samantha Hardman', rating: 5, workKey: 'moonfall|k f breene' },
      ],
      me,
    );
    assert.deepEqual(out, [
      { workKey: 'dungeon born|dakota krout', rating: 4, source: 'audio' },
    ]);
  });

  it('matches on email where the document has one, and on the folded name where it does not', () => {
    const out = observedRatingsFromReviews(
      [
        { email: 'NB@Example.com', displayName: 'someone else entirely', rating: 3, workKey: 'a|b' },
        { displayName: '  skylar ', rating: 2, workKey: 'c|d' },
      ],
      me,
    );
    assert.deepEqual(out.map((o) => o.workKey), ['a|b', 'c|d']);
  });

  it('⚠️ drops a review with no workKey — a sweep has no book to fall back on', () => {
    // The per-book path can ask Firestore for the audiobook site's `bookId`
    // because it knows which book it is looking at. This starts from the person,
    // so a document the review-key backfill has not stamped names nothing.
    assert.deepEqual(
      observedRatingsFromReviews(
        [
          { displayName: 'Skylar', rating: 4, bookId: 'firefight-the-reckoners-book-2' } as never,
          // Nor is a bare title a key: `workKeyFor` always joins with a `|`, and
          // two different books called "Gold" would share the half of it.
          { displayName: 'Skylar', rating: 4, workKey: 'gold' },
        ],
        me,
      ),
      [],
    );
  });

  it('drops anything that is not a rating on the shared scale', () => {
    assert.deepEqual(
      observedRatingsFromReviews(
        [
          { displayName: 'Skylar', rating: 0, workKey: 'a|b' },
          { displayName: 'Skylar', rating: 3.3, workKey: 'c|d' },
          { displayName: 'Skylar', rating: '5' as never, workKey: 'e|f' },
          { displayName: 'Skylar', workKey: 'g|h' },
        ],
        me,
      ),
      [],
    );
    // ⚠️ But 0.5 is a rating. A book somebody hated is a book they finished.
    assert.equal(observedRatingsFromReviews([{ displayName: 'Skylar', rating: 0.5, workKey: 'a|b' }], me).length, 1);
  });

  it('⚠️ one key twice: an audio source anywhere wins, because format is what the choice changes', () => {
    const out = observedRatingsFromReviews(
      [
        { displayName: 'Skylar', rating: 4, workKey: 'tamer|michael james ploof', source: 'library' },
        { displayName: 'Skylar', rating: 5, workKey: 'tamer|michael james ploof', source: 'audio' },
      ],
      me,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].source, 'audio');
  });

  it('reads an unstamped document as an audiobook review, exactly as the per-book path does', () => {
    // Belt and braces on `reviewSourceOf`: no `source` AND no `workKey` means
    // the audiobook site wrote it. Such a document is dropped for having no key
    // — so the only way a *kept* document is unsourced is one carrying a key
    // this catalog wrote, which is answered `null` rather than guessed at.
    const out = observedRatingsFromReviews(
      [{ displayName: 'Skylar', rating: 4, workKey: 'a|b' }],
      me,
    );
    assert.equal(out[0].source, null);
  });

  it('nobody matches nobody — an unsigned-in reader sweeps nothing', () => {
    assert.deepEqual(
      observedRatingsFromReviews([{ displayName: 'Skylar', rating: 4, workKey: 'a|b' }], {
        email: null,
        reviewName: null,
      }),
      [],
    );
  });
});

describe('the sweep’s write contract', () => {
  const one = { workKey: 'dungeon born|dakota krout', rating: 4, source: 'audio' as const };

  it('accepts what the browser sends', () => {
    assert.equal(observedRatingsSchema.safeParse({ ratings: [one] }).success, true);
    assert.equal(
      observedRatingsSchema.safeParse({ ratings: [{ workKey: 'a|b', rating: 0.5 }] }).success,
      true,
    );
  });

  it('⚠️ refuses a key that is not a key', () => {
    assert.equal(observedRatingsSchema.safeParse({ ratings: [{ ...one, workKey: 'gold' }] }).success, false);
  });

  it('refuses a rating off the shared half-star scale', () => {
    assert.equal(observedRatingsSchema.safeParse({ ratings: [{ ...one, rating: 3.3 }] }).success, false);
    assert.equal(observedRatingsSchema.safeParse({ ratings: [{ ...one, rating: 6 }] }).success, false);
  });

  it('⚠️ refuses a field it does not model rather than stripping it', () => {
    // The `.strict()` lesson from `submitReviewSchema`: zod silently *stripped* a
    // stray `rating` once, and the endpoint looked like it worked.
    assert.equal(
      observedRatingsSchema.safeParse({ ratings: [{ ...one, userId: 3 }] }).success,
      false,
    );
    assert.equal(observedRatingsSchema.safeParse({ ratings: [one], userId: 3 }).success, false);
  });

  it('refuses an empty list and one longer than the stated cap', () => {
    assert.equal(observedRatingsSchema.safeParse({ ratings: [] }).success, false);
    const many = Array.from({ length: 501 }, (_, i) => ({ ...one, workKey: `k${i}|a` }));
    assert.equal(observedRatingsSchema.safeParse({ ratings: many }).success, false);
  });
});
