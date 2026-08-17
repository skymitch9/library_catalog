/**
 * The cross-catalog content-warning join, pinned.
 *
 * ⚠️ **The first describe block is the point of this file.** Everything else
 * here is ordinary shape-checking; that block is the one that fails when
 * somebody "simplifies" the key derivation into `bookIdFromTitle(work.title)`,
 * which is the mistake this feature exists to avoid and which is invisible in a
 * browser — a note written under the wrong key still saves, still renders on
 * the page that wrote it, and is simply never seen on the other site or by the
 * other site's readers. There is no error to notice.
 *
 * The fixtures are REAL rows, read out of production D1 on 2026-08-17
 * (`SELECT w.title, ah.title FROM audiobook_holding ah JOIN work w …`): 92
 * holdings, 33 of them spelled differently by the two catalogs.
 *
 * Run with `npm test` (Node 22+ strips the types; no framework).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_WARNING_LABEL, UNKNOWN_AUTHOR } from '../src/constants.ts';
import { bookIdFromTitle, reviewDocId } from '../src/reviews.ts';
import { readingListDocId } from '../src/tbr.ts';
import {
  publishedWarningsFor,
  userWarningDocId,
  warningDeleteVerdict,
  warningDocFor,
  warningKeysFor,
} from '../src/warnings.ts';

/**
 * Real pairs, production D1, 2026-08-17. `ours` is `work.title`, `theirs` is
 * `audiobook_holding.title` — what the audiobook catalog calls the same book.
 */
const REAL_PAIRS = [
  {
    ours: 'Sunrise on the Reaping',
    theirs: 'Sunrise on the Reaping - A Hunger Games Novel',
  },
  {
    ours: "World's Only Hero",
    theirs: "World's Only Hero: An Apocalyptic LitRPG Adventure",
  },
  {
    ours: 'All The Skills - 5',
    theirs: 'All the Skills 5: A Deck-Building LitRPG',
  },
  {
    ours: 'Tamer: King of Dinosaurs Book 7',
    theirs: 'Tamer: King of Dinosaurs 7',
  },
];

describe('⚠️ the identity join — a note must be filed under the AUDIOBOOK spelling', () => {
  for (const pair of REAL_PAIRS) {
    it(`"${pair.ours}" writes under the audiobook catalog's key`, () => {
      const keys = warningKeysFor({ title: pair.ours, audiobookTitle: pair.theirs });

      // THE assertion. The audiobook site's book page queries
      // `where bookId == bookIdFromTitle(<its own title>)` and nothing else, so
      // this equality IS "the note is visible on both sites".
      assert.equal(
        keys.writeBookId,
        bookIdFromTitle(pair.theirs),
        'the write key is not the audiobook catalog\'s — this note would be invisible there',
      );

      // And the mutation this file exists to catch: keying on our own title.
      assert.notEqual(
        keys.writeBookId,
        bookIdFromTitle(pair.ours),
        `"${pair.ours}" and "${pair.theirs}" slug the same — pick a different fixture, this one proves nothing`,
      );
    });

    it(`"${pair.ours}" still FINDS a note filed under our own title`, () => {
      const keys = warningKeysFor({ title: pair.ours, audiobookTitle: pair.theirs });
      // The read side is a union, not a swap: a note written before this
      // catalog knew the audiobook spelling (or while the holding was missing)
      // sits under our slug and must not disappear.
      assert.ok(
        keys.bookIds.includes(bookIdFromTitle(pair.ours)),
        'the fallback candidate is gone — notes written before the holding existed would vanish',
      );
      assert.ok(keys.bookIds.includes(bookIdFromTitle(pair.theirs)));
      assert.equal(keys.bookIds[0], keys.writeBookId, 'the write key must be asked first');
    });
  }

  it('with no audiobook holding, our own title is the only key there is', () => {
    const keys = warningKeysFor({ title: 'Goodnight Moon' });
    assert.equal(keys.writeBookId, 'goodnight-moon');
    assert.deepEqual(keys.bookIds, ['goodnight-moon']);
    assert.equal(keys.publishedTitle, null);
  });

  /**
   * ⚠️ Not every differently-spelled pair is a differently-KEYED pair, and this
   * was measured rather than assumed — the first draft of the fixture list
   * above used this pair and the guard above rejected it. `bookIdFromTitle`
   * turns every run of non-alphanumerics into one hyphen, so a colon and a
   * spaced dash produce the identical slug. Measured against production
   * 2026-08-17: of the 33 titles the two catalogs spell differently, **6 slug
   * the same anyway** (the *He Who Fights with Monsters* run) and **27 do
   * not**. It is those 27 the join exists for; stated here so nobody reads
   * "33 differ" as "33 were broken".
   */
  it('a punctuation-only difference is not a different key', () => {
    assert.equal(
      bookIdFromTitle('He Who Fights with Monsters 2: A LitRPG Adventure'),
      bookIdFromTitle('He Who Fights with Monsters 2 - A LitRPG Adventure'),
    );
  });

  it('deduplicates when the two catalogs agree on the spelling', () => {
    const keys = warningKeysFor({ title: 'Project Hail Mary', audiobookTitle: 'Project Hail Mary' });
    assert.deepEqual(keys.bookIds, ['project-hail-mary']);
  });

  /**
   * ⚠️ The stale split, both halves. `stale_at` means the audiobook catalog no
   * longer confirms the match, so a NEW note must not be filed under a spelling
   * that side has stopped confirming — but an OLD one filed there must still be
   * found, for the reason `OtherVersions.tsx` still shows a stale holding.
   */
  it('a stale holding is read but never written to', () => {
    const keys = warningKeysFor({
      title: 'Sunrise on the Reaping',
      audiobookTitle: 'Sunrise on the Reaping - A Hunger Games Novel',
      audiobookTitleStale: true,
    });
    assert.equal(keys.writeBookId, 'sunrise-on-the-reaping', 'a stale title must not be written to');
    assert.ok(
      keys.bookIds.includes(bookIdFromTitle('Sunrise on the Reaping - A Hunger Games Novel')),
      'a stale title must still be READ — notes already filed there would vanish',
    );
  });

  it('the published file is keyed by the audiobook title verbatim, not a slug', () => {
    const keys = warningKeysFor({
      title: 'Sunrise on the Reaping',
      audiobookTitle: 'Sunrise on the Reaping - A Hunger Games Novel',
    });
    // Measured 2026-08-17 against the live content_warnings.json (339 keys):
    // this exact string is a key and carries ten warnings; the library's own
    // spelling is not a key at all.
    assert.equal(keys.publishedTitle, 'Sunrise on the Reaping - A Hunger Games Novel');
  });
});

describe('the document id, ported verbatim from site/user-warnings.js', () => {
  it('is bookId _ name _ topic — and the topic is the label slugged', () => {
    assert.equal(
      userWarningDocId('the-sunlit-man', 'Skylar', 'Gun violence'),
      'the-sunlit-man_skylar_gun-violence',
    );
  });

  /**
   * ⚠️ One document per person per TOPIC is the whole dedupe rule. Two people
   * may warn about the same thing; one person may not warn about it twice.
   */
  it('re-adding the same topic lands on the same document', () => {
    assert.equal(
      userWarningDocId('x', 'Skylar', 'Animal cruelty'),
      userWarningDocId('x', 'skylar', '  Animal cruelty  '.trim()),
    );
  });

  it('two different topics from one person are two documents', () => {
    assert.notEqual(
      userWarningDocId('x', 'Skylar', 'Animal cruelty'),
      userWarningDocId('x', 'Skylar', 'War'),
    );
  });

  /**
   * ⚠️ Three collections, three id orders, none interchangeable. `tbr.ts` §2
   * makes the same assertion for its pair; a warning is the third and its topic
   * segment is what stops a person's two notes overwriting each other.
   */
  it('is not a review id and not a reading-list id', () => {
    const bookId = 'defiant';
    const warning = userWarningDocId(bookId, 'Skylar', 'War');
    assert.notEqual(warning, reviewDocId(bookId, 'Skylar'));
    assert.notEqual(warning, readingListDocId('Skylar', bookId));
  });

  it('clamps to Firestore-safe length', () => {
    const id = userWarningDocId('b'.repeat(600), 'n'.repeat(400), 'l'.repeat(400));
    assert.equal(id.length, 900);
  });
});

describe('the document this catalog writes', () => {
  const base = {
    title: 'Sunrise on the Reaping',
    authors: 'Suzanne Collins',
    label: 'Child death',
    displayName: 'Skylar',
    audiobookTitle: 'Sunrise on the Reaping - A Hunger Games Novel',
  };

  it('carries their key, their title, and our workKey', () => {
    const { id, doc } = warningDocFor({ ...base, email: 'x@example.com', authorUid: 'uid-1' });
    assert.equal(doc.bookId, bookIdFromTitle(base.audiobookTitle));
    // ⚠️ `bookTitle` is the spelling the key came from — the audiobook site
    // prints this string beside the note, on its own record for that title.
    assert.equal(doc.bookTitle, base.audiobookTitle);
    assert.equal(doc.label, 'Child death');
    assert.equal(doc.source, 'library');
    assert.equal(doc.workKey, 'sunrise on the reaping|suzanne collins');
    assert.equal(doc.authorUid, 'uid-1');
    assert.equal(doc.email, 'x@example.com');
    assert.equal(id, userWarningDocId(doc.bookId, 'Skylar', 'Child death'));
  });

  it('omits authorUid rather than inventing one', () => {
    const { doc } = warningDocFor({ ...base, authorUid: null });
    assert.equal('authorUid' in doc, false, 'a null uid must be ABSENT — the rules test for the key');
  });

  it('uses our own title when there is no holding', () => {
    const { doc } = warningDocFor({ ...base, audiobookTitle: null });
    assert.equal(doc.bookId, 'sunrise-on-the-reaping');
    assert.equal(doc.bookTitle, 'Sunrise on the Reaping');
  });

  /**
   * ⚠️ The provisional-key refusal, the same one `reviewDocFor` and `tbrDocFor`
   * make. Zero Firestore documents may carry `?unknown`, because that is the
   * entire proof that filling an author in later is a free key move.
   */
  it('refuses a provisional work', () => {
    assert.throws(
      () => warningDocFor({ ...base, authors: UNKNOWN_AUTHOR }),
      /provisional/,
    );
  });

  it('refuses a note firestore.rules would reject anyway', () => {
    assert.throws(() => warningDocFor({ ...base, label: '   ' }), /empty/);
    assert.throws(
      () => warningDocFor({ ...base, label: 'x'.repeat(MAX_WARNING_LABEL + 1) }),
      /80 characters/,
    );
    // The bound itself is the rules' bound, not a rounder number.
    assert.equal(MAX_WARNING_LABEL, 80);
  });
});

describe('who may take a note down', () => {
  const mine = { authorUid: 'uid-1', displayName: 'Skylar' };
  const theirs = { authorUid: 'uid-2', displayName: 'Amber Mitchell' };
  const unstamped = { displayName: 'Skylar' };

  it('the author may, on the uid and never on the name', () => {
    assert.deepEqual(warningDeleteVerdict(mine, { uid: 'uid-1', displayName: 'Skylar' }), {
      allowed: true,
      via: 'author',
    });
    // ⚠️ A NAME match is not authorship. Google lets anyone set their display
    // name to any string, and firestore.rules compares the uid for exactly this
    // reason — a name-based affordance would offer a button the rules refuse.
    const impostor = warningDeleteVerdict(mine, { uid: 'uid-9', displayName: 'Skylar' });
    assert.equal(impostor.allowed, false);
  });

  it('a moderator may, on anyone', () => {
    assert.deepEqual(
      warningDeleteVerdict(theirs, { uid: 'uid-1', displayName: 'Skylar', canModerate: true }),
      { allowed: true, via: 'moderator' },
    );
  });

  it('everybody else is refused in words, and told what would help', () => {
    const other = warningDeleteVerdict(theirs, { uid: 'uid-1', displayName: 'Skylar' });
    assert.equal(other.allowed, false);
    assert.match(other.allowed === false ? other.reason : '', /only remove notes you added/i);

    // The pre-binding case: their name, no authorUid. Not a dead end — the
    // sentence says how to make it theirs again.
    const legacy = warningDeleteVerdict(unstamped, { uid: 'uid-1', displayName: 'Skylar' });
    assert.equal(legacy.allowed, false);
    assert.match(legacy.allowed === false ? legacy.reason : '', /moderator/i);
    assert.match(legacy.allowed === false ? legacy.reason : '', /add it again/i);

    // No live uid at all: never silently refused, always told to sign in.
    const signedOut = warningDeleteVerdict(mine, { uid: null, displayName: 'Skylar' });
    assert.equal(signedOut.allowed, false);
    assert.match(signedOut.allowed === false ? signedOut.reason : '', /sign in/i);
  });

  it('no refusal is a bare code — every one is a sentence', () => {
    for (const v of [
      warningDeleteVerdict(theirs, { uid: 'uid-1', displayName: 'Skylar' }),
      warningDeleteVerdict(unstamped, { uid: 'uid-1', displayName: 'Skylar' }),
      warningDeleteVerdict(mine, { uid: null, displayName: 'Skylar' }),
    ]) {
      assert.equal(v.allowed, false);
      const reason = v.allowed === false ? v.reason : '';
      assert.ok(reason.length > 20 && /[a-z] [a-z]/i.test(reason), `not a sentence: ${reason}`);
    }
  });
});

describe('the published pipeline warnings', () => {
  const file = {
    'Defiant': { warnings: [{ label: 'War', source_url: 'https://example.com/1' }], checked_at: 1 },
    'All the Skills: A Deck-Building LitRPG - All the Skills, Book 1': { warnings: [], checked_at: 2 },
  };

  it('finds them under the audiobook title', () => {
    const got = publishedWarningsFor(file, 'Defiant');
    assert.equal(got.checked, true);
    assert.equal(got.warnings.length, 1);
  });

  /**
   * ⚠️ "Looked and found none" and "nobody looked" are different facts, and the
   * page says which. Collapsing them would tell a reader a book is clear when
   * nothing has ever checked it.
   */
  it('distinguishes an empty entry from a missing one', () => {
    const empty = publishedWarningsFor(file, 'All the Skills: A Deck-Building LitRPG - All the Skills, Book 1');
    assert.equal(empty.checked, true);
    assert.equal(empty.warnings.length, 0);

    const missing = publishedWarningsFor(file, 'A Book Nobody Checked');
    assert.equal(missing.checked, false);
  });

  it('answers nothing rather than throwing when the file never arrived', () => {
    assert.deepEqual(publishedWarningsFor(null, 'Defiant'), { checked: false, warnings: [] });
    assert.deepEqual(publishedWarningsFor(file, null), { checked: false, warnings: [] });
  });

  it('drops a malformed entry instead of rendering a blank chip', () => {
    const junk = { X: { warnings: [{ label: '  ' }, null, { label: 'Real' }] } } as never;
    const got = publishedWarningsFor(junk, 'X');
    assert.deepEqual(got.warnings.map((w) => w.label), ['Real']);
  });
});
