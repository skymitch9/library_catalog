/**
 * Leaf module: what an intake sweep remembers between one tap and the next.
 *
 * Imports `constants.ts` only. No I/O.
 *
 * ## Why the job exists at all
 *
 * `ScanPage` kept its results in React state, which is fine right up to the
 * moment a phone locks in the middle of a shelf. For barcodes that costs a
 * re-scan and nothing else — a barcode is free. For a **shelf photograph** it
 * costs an API call, so the reading has to survive a reload before anything is
 * allowed to pay for one. That ordering is the whole reason this file precedes
 * the vision route.
 *
 * ## One line shape, two producers
 *
 * A barcode and a spine arrive by completely different routes and end up in the
 * same review list, so they must agree on a row. `via` is the only field that
 * says which produced it, and the review screen keys most of its wording off
 * `state` rather than `via` — a person sorting a stack does not care how the
 * title was read, only whether it is right.
 *
 * ## ⚠️ Nothing in here is a decision
 *
 * The first lookup is automatic — see `needsLookup` — and that changes nothing
 * about this. An automatic search fills a line *in*; it never ticks one, never
 * adds one, and never discards a weak match to make the list look tidier.
 *
 * Every line is a **proposal**, exactly as the barcode screen has always
 * treated them. `addedWorkId` is the only field that records a person having
 * acted, and only the client sets it, after the ordinary `POST /api/works`.
 * Phase 0 measured that a wrong ISBN resolves to a confident, well-formed,
 * wrong book; a spine read is weaker evidence than an ISBN, not stronger.
 */

import type { ScanMode, ScanStatus } from './constants.js';

/**
 * The marker written into `scan_job.photo_key`.
 *
 * The column is `NOT NULL` and predates the decision never to store a photo, so
 * it stays and says so. **There is no R2 bucket in this app and there must not
 * be one** — a photo goes from the upload request into the vision call and is
 * dropped. The sibling Board Game Catalog deleted its bucket after noticing the
 * objects were write-only: their entire purpose was to be deleted later, and
 * one code path forgetting to delete was all it would have taken to keep
 * photographs of someone's home indefinitely. Not writing it is a guarantee;
 * remembering to delete it was a habit.
 */
export const PHOTO_NOT_STORED = 'not-stored';

/** How a line got onto a job. */
export const SCAN_LINE_SOURCES = ['barcode', 'spine', 'manual'] as const;
export type ScanLineSource = (typeof SCAN_LINE_SOURCES)[number];

/**
 * What happened when we tried to resolve one line.
 *
 * `owned` and `skipped` are terminal without anyone doing anything, which is
 * what `isOutstanding` below keys on. The rest need a person.
 */
export const SCAN_LINE_STATES = [
  /** Already on our shelf — answered from D1, no network call. */
  'owned',
  /** Resolved to a candidate. A proposal, never an answer. */
  'found',
  /** Looked, found nothing. Half this library is not in Open Library. */
  'not_found',
  /** A Kindle ASIN. No free database indexes these; a different importer's job. */
  'unresolvable',
  /** Not a book code — a price add-on or a retail UPC. */
  'skipped',
  /** The lookup itself failed. Retryable, unlike the four above. */
  'error',
] as const;
export type ScanLineState = (typeof SCAN_LINE_STATES)[number];

/**
 * A book we already hold whose text overlaps the one being scanned.
 *
 * ⚠️ **Not a duplicate, and the difference is the reason this exists.** A
 * duplicate is the same *object* twice. An overlap is the same *text* reached
 * two ways — an omnibus and one of the volumes printed inside it — and the
 * catalog records it as `work_relation.contains`, which is directional and whose
 * direction is the entire meaning.
 *
 * One `contains` row reads as two different warnings depending on which end the
 * scanned book is standing on, and both are worth saying out loud:
 */
export interface ScanOverlap {
  workId: number;
  title: string;
  /**
   * - `inside` — we already hold that book, and **this one is printed inside
   *   it**. Scanning volume 1 of something whose omnibus is already on the
   *   shelf.
   * - `holds` — this one is the bundle, and **we already hold that book**, which
   *   is one of the things inside it. Scanning the omnibus of a volume we own.
   */
  direction: 'inside' | 'holds';
}

/**
 * What to tell somebody standing at the shelf with the book in their hand.
 *
 * ⚠️ One sentence, no verdict. The owner's position all session has been *tell
 * me, then let me decide* — they own volume 1 **and** the omnibus deliberately
 * in some cases — so this names the book and stops. It is the same shape as the
 * duplicate prompt's "Scanned again — add a second owned copy if you have two,
 * or leave it", because it raises the same prompt for a second reason.
 *
 * Lives here rather than in the component so the wording and the rule that
 * produces it cannot drift apart, exactly as `gapEvidenceLabel` does for the
 * series ladder.
 */
export function overlapSentence(overlaps: readonly ScanOverlap[]): string | null {
  if (overlaps.length === 0) return null;
  const names = (list: readonly ScanOverlap[]) =>
    list.length === 1
      ? list[0]!.title
      : `${list.slice(0, -1).map((o) => o.title).join(', ')} and ${list[list.length - 1]!.title}`;

  const inside = overlaps.filter((o) => o.direction === 'inside');
  const holds = overlaps.filter((o) => o.direction === 'holds');

  const parts: string[] = [];
  if (inside.length > 0) {
    parts.push(`You already own this inside ${names(inside)}.`);
  }
  if (holds.length > 0) {
    parts.push(`This collects ${names(holds)}, which you already own.`);
  }
  return parts.join(' ');
}

/**
 * One book on one sweep.
 *
 * Stored as JSON in `scan_job.enriched` rather than as rows in a table, and
 * deliberately: a line is only ever read as part of its job, never queried
 * across jobs, and a table would buy indexes nothing needs at the cost of a
 * migration every time the review screen learns a new field.
 */
export interface ScanLine {
  /** 1-based, in arrival order — left to right along a shelf. */
  position: number;
  via: ScanLineSource;
  /** The scanned ISBN-13, when there was one. Null for a spine read. */
  code: string | null;
  /** Exactly what was read: the printed spine text, or the code itself. */
  text: string;
  /** The author as printed on the spine. Null when the spine showed none. */
  author: string | null;
  /** How sure the read was. Null for a barcode, which is not a reading. */
  confidence: 'high' | 'medium' | 'low' | null;
  /** Why the read is uncertain — glare, occlusion, worn lettering. */
  note: string | null;

  state: ScanLineState;
  /** A sentence for the person, when `state` alone would not explain itself. */
  detail: string | null;

  /** The work we already hold, if this line names one. */
  existingWorkId: number | null;
  existingTitle: string | null;
  /**
   * The edition whose identifier answered the scan, when one did. An `owned`
   * barcode line matched a specific printing — `edition.isbn13` or `.asin` —
   * and this remembers WHICH, so "Add 2nd copy" can write `copy.edition_id`
   * instead of another NULL. 177 of 265 production copies cannot say which
   * printing they are; a scan that just proved the printing is the one moment
   * that fact is free, and dropping it here is how those NULLs were minted.
   *
   * Null for a spine match (title evidence names a work, never a printing).
   * ⚠️ Optional on the wire, like `overlap`: jobs written before this field
   * existed have no key for it, and `undefined` reads as "printing unknown".
   */
  existingEditionId?: number | null;

  /**
   * Books already on the shelf whose text overlaps this one. Usually empty.
   *
   * ⚠️ **Never a refusal, and never a state.** `state` says whether the *object*
   * is already ours; this says whether the *text* already reached us some other
   * way, and the two are independent — a book can be neither, either or both. It
   * is carried on the line so the warning arrives with the row rather than as a
   * second request per book, and so it survives the phone locking mid-shelf,
   * which is the whole reason `scan_job` persists lines at all.
   *
   * ⚠️ Optional on the wire, like `lookedUp`: jobs written before this field
   * existed have no key for it, and `undefined` correctly reads as "nothing
   * known to overlap".
   */
  overlap?: ScanOverlap[];

  /** The best proposal from the free rungs. All null when nothing resolved. */
  isbn13: string | null;
  resolvedTitle: string | null;
  resolvedAuthors: string | null;
  publisher: string | null;
  publishedYear: number | null;
  coverUrl: string | null;
  /**
   * The blurb the lookup found, when a rung carried one.
   *
   * ⚠️ **This is what makes `bestCandidate`'s description borrow do anything.**
   * The borrow shipped on 2026-08-25 with no consumer at all: the line had no
   * field for it, so a description Google Books had already handed us for free
   * was dropped here and bought again later from the paid ladder (F4). It rides
   * the line so the ADD can write it into the new work.
   *
   * ⚠️ Optional on the wire, like `overlap` and `lookedUp`: jobs written before
   * this field existed have no key for it, and `undefined` reads correctly as
   * "nothing found". `null` means the lookup answered and had none.
   */
  description?: string | null;
  /**
   * How close the resolved title is to what was read, 0..1. Null when nothing
   * resolved, and **carried rather than enforced**: below
   * `MIN_SPINE_SIMILARITY` the review screen shows the match and declines to
   * dress it up, which tells the truth about what was found instead of quietly
   * dropping a name that is visibly on the shelf.
   */
  similarity: number | null;
  /** Set when a person retyped the title and asked again. */
  relookedUpAs: string | null;
  /**
   * Has an external search been made for this line yet?
   *
   * ⚠️ This is the flag the **automatic first pass** keys on, and it means
   * "asked", not "answered". A search that came back with nothing sets it —
   * `not_found` is an answer, and re-asking the same question gets the same
   * answer. A search that never reached Open Library does **not** set it, so a
   * transport failure stays retryable.
   *
   * Never reset. Editing the text is a new question, but the client asks it
   * straight away (see `ScanLines.saveEdit`), so re-arming the automatic pass
   * would fire a second, identical search alongside that one.
   *
   * ⚠️ Optional on the wire, required in the type: jobs written before this
   * field existed have no key for it, and `undefined` reads as "not yet asked".
   * That is the right default — an old job that still has unanswered lines gets
   * them answered when it is reopened.
   */
  lookedUp?: boolean;

  /** The work this line became. Only a person's action sets this. */
  addedWorkId: number | null;
  /** "I have looked at it and I do not want it." Also a person's action. */
  dismissed: boolean;
}

/** A sweep, as the API hands it back. */
export interface ScanJob {
  id: number;
  status: ScanStatus;
  mode: ScanMode;
  lines: ScanLine[];
  error: string | null;
  createdBy: number | null;
  createdAt: string;
  processedAt: string | null;
  reviewedAt: string | null;
}

/**
 * A blank line, so the two producers cannot disagree about the defaults.
 *
 * ⚠️ A `barcode` line gets its `code` set here, from the same string as its
 * `text`. That pairing is what `searchText` reads to tell "the only words on
 * this row are the code that was scanned" from "somebody has typed a title in",
 * and leaving `code` null until the caller filled it in made the answer depend
 * on how far through the barcode ladder the line happened to be.
 */
export function blankLine(
  position: number,
  via: ScanLineSource,
  text: string,
): ScanLine {
  return {
    position,
    via,
    code: via === 'barcode' ? text : null,
    text,
    author: null,
    confidence: null,
    note: null,
    state: 'not_found',
    detail: null,
    existingWorkId: null,
    existingTitle: null,
    existingEditionId: null,
    overlap: [],
    isbn13: null,
    resolvedTitle: null,
    resolvedAuthors: null,
    publisher: null,
    publishedYear: null,
    coverUrl: null,
    description: null,
    similarity: null,
    relookedUpAs: null,
    lookedUp: false,
    addedWorkId: null,
    dismissed: false,
  };
}

/**
 * The create body for a brand-new work, out of a reviewed line.
 *
 * ⚠️ **Lives here, beside `proposedTitle`/`proposedAuthors`, and is exported so
 * a test can NAME the fields it carries** — which is the only test shape that
 * catches the bug this object literal has now had TWICE, both times an absence
 * and both times silent:
 *
 *  1. **The cover.** The work was created from `{ title, authors }` alone while
 *     the edition beside it took `line.coverUrl`. Every list renders
 *     `work.cover_url`, so a barcode scan produced a book with a perfectly good
 *     cover URL stored one table away and a blank tile on screen. Measured
 *     before the fix: 143 editions carried 20 covers, all 20 on works showing
 *     none.
 *  2. **The description** (F4, 2026-08-25). `bestCandidate` was taught to borrow
 *     a blurb from whichever lookup rung carries one (Open Library's
 *     `jscmd=data` carries none) and nothing on this path read it — so a free
 *     description was dropped at the scan and bought from the paid details
 *     ladder minutes later. Nothing threw.
 *
 * ⚠️ **A CREATE, never an update.** The caller uses this only when no work
 * matched; a book already on the shelf keeps every column it has ("gaps only,
 * never overwrite") and the free ladder fills its blanks.
 *
 * ⚠️ `title`/`authors` are the caller's — the strings the work was MATCHED on,
 * not the line's raw fields. `work_key` is derived from them and joins ~870
 * audiobook reviews, so the value the key was computed from is the value stored.
 * `undefined` (not `null`) for anything the lookup could not answer: absence
 * means "nobody recorded one", which is a statement a scan is entitled to make;
 * `null` is not.
 */
export function workCreateFrom(
  line: ScanLine,
  title: string,
  authors: string | null,
): {
  title: string;
  authors: string | null;
  coverUrl: string | undefined;
  firstPublished: number | undefined;
  description: string | undefined;
} {
  return {
    title,
    authors,
    coverUrl: line.coverUrl ?? undefined,
    firstPublished: line.publishedYear ?? undefined,
    description: line.description ?? undefined,
  };
}

/**
 * The title this line would be filed under if it were added right now.
 *
 * ⚠️ **Null means "nobody has said what this book is called yet"**, and the
 * subtle case it exists for is a barcode. `blankLine` seeds `text` with the
 * scanned code, so a barcode line whose lookup found nothing has a `text` of
 * "9780241361221" — a truthy string that is not a title. Treating it as one
 * files a book called 9780241361221, and searching Open Library for it is a
 * wasted call.
 *
 * The moment a person retypes that line, `text` stops being the code and this
 * starts answering — which is precisely what makes an unresolved board book
 * addable, and what lets the automatic pass pick it up.
 */
export function proposedTitle(line: ScanLine): string | null {
  return line.resolvedTitle?.trim() || searchText(line);
}

/**
 * The words a title search would actually be made with — `null` when there are
 * none, because the only text on the row is the code that was scanned.
 *
 * Separate from `proposedTitle` because the two answer different questions.
 * A barcode that resolved has a perfectly good `resolvedTitle` and still has
 * nothing to *search* with that would beat the ISBN it was found by; the Look
 * up button and the automatic pass both key on this one.
 */
export function searchText(line: ScanLine): string | null {
  const text = line.text.trim();
  if (!text) return null;
  return line.code && text === line.code.trim() ? null : text;
}

/** The authors half of the same question. Null when nobody has said. */
export function proposedAuthors(line: ScanLine): string | null {
  const resolved = line.resolvedAuthors?.trim();
  if (resolved) return resolved;
  return line.author?.trim() || null;
}

/**
 * Could this line become catalog rows as it stands?
 *
 * ⚠️ Keyed on **what the row has**, never on how it arrived. The bug this
 * replaces was gating the Add button on `state === 'found'`, which quietly
 * meant "only books an external service recognised" — so a board book whose
 * ISBN Open Library has never heard of was a row with no buttons on it at all,
 * and the only way to catalog it was to abandon the sweep and type it in
 * somewhere else. Board books and picture books are the *common* case in this
 * house and they resolve worst upstream, so the dead end landed exactly where
 * it hurt most.
 *
 * A line that already names a work is addable with no title of its own: that is
 * the second-copy path, and the work supplies the naming.
 */
export function isAddable(line: ScanLine): boolean {
  if (line.dismissed || line.addedWorkId !== null) return false;
  if (line.existingWorkId !== null) return true;
  return proposedTitle(line) !== null && proposedAuthors(line) !== null;
}

/**
 * Is this line still waiting for its **first** external search?
 *
 * ⚠️ The automatic pass reads this and nothing else, so every reason not to
 * spend a search is in one place. Ported from the sibling Board Game Catalog,
 * whose first pass is automatic and whose review screen is better for it — the
 * complaint this answers is "we keep having to manually engage the lookup".
 *
 * A freshly scanned barcode is excluded, and `proposedTitle` is what excludes
 * it rather than a test on `via`. Its ladder already ran, against an
 * identifier; the only thing this pass can do is search **by title**, and it
 * has none. Once a person types one in, the same rule lets the line back in —
 * which is the behaviour you want and a `via === 'barcode'` test would forbid.
 *
 * `unresolvable` and `skipped` are excluded for the opposite reason: they are
 * answers, not gaps. `owned` is excluded because the catalog already settled it
 * for free, which is the answer that prevents duplicates.
 */
export function needsLookup(line: ScanLine): boolean {
  if (line.lookedUp) return false;
  if (line.dismissed || line.addedWorkId !== null) return false;
  if (line.existingWorkId !== null) return false;
  if (line.state === 'owned' || line.state === 'skipped' || line.state === 'unresolvable') {
    return false;
  }
  return searchText(line) !== null;
}

export function hasPendingLookups(lines: readonly ScanLine[]): boolean {
  return lines.some(needsLookup);
}

/**
 * How far the automatic pass has got: `done of total`.
 *
 * **Progress, not a spinner** — the sibling's rule, and the reason it holds is
 * that a shelf arrives over several passes. A number that moves is the
 * difference between "working" and the stall that used to look identical to it.
 *
 * `total` counts only the lines the pass is responsible for, so a shelf of
 * fifteen spines of which three are already on our shelves reads "12 of 12" and
 * not "12 of 15 (three will never move)".
 */
export function lookupProgress(lines: readonly ScanLine[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of lines) {
    if (needsLookup(line)) {
      total += 1;
      continue;
    }
    // A barcode's ladder ran inside the scan, before this pass existed as far
    // as the person is concerned. Counting it would report "12 of 12 looked up"
    // over a sweep in which this pass did nothing at all.
    if (line.via === 'barcode') continue;
    if (line.lookedUp) {
      done += 1;
      total += 1;
    }
  }
  return { done, total };
}

/**
 * Is this line still waiting for a person?
 *
 * ⚠️ **`owned` used to be settled here and no longer is.** The old rule read
 * "a book we already hold needs no decision", and the owner overruled it with
 * the case it did not cover: *"if a duplicate book is scanned, instead of
 * rejecting it right away, ask the user if they want to add another owned copy.
 * It is up to the end user to deal with duplicates, not just the system —
 * because currently we have to leave the scan page, find the book, and add a
 * second copy instead of using the already-built features."*
 *
 * That is exactly right, and the old rule made the row a **dead end**: the
 * review screen printed "Already yours" and offered no button at all, so the
 * one legitimate reason to have scanned it — a second physical copy — could
 * only be recorded by abandoning the sweep. A duplicate is now a *question*
 * ("another copy, or leave it?"), and a question is outstanding until somebody
 * answers it either way.
 *
 * `skipped` stays settled. A five-digit price barcode is not a book and never
 * becomes one, so there is no question to ask.
 *
 * Everything else has always been outstanding until somebody adds it or
 * dismisses it, including `not_found` and `error`. That is the point: the rows
 * worth coming back to are exactly the ones that did not resolve cleanly, and
 * an earlier version of this rule in the sibling project closed the job when
 * the *easy* ones were added, taking the hard ones with it.
 */
export function isOutstanding(line: ScanLine): boolean {
  if (line.dismissed || line.addedWorkId !== null) return false;
  return line.state !== 'skipped';
}

export function outstandingCount(lines: readonly ScanLine[]): number {
  return lines.reduce((n, line) => n + (isOutstanding(line) ? 1 : 0), 0);
}

/**
 * A one-line summary for the queue, so a person can tell two sweeps apart
 * without opening either.
 *
 * Counts rather than titles: a shelf photo produces a dozen names and none of
 * them is *the* name of the job, whereas "14 read · 3 to sort" is the only
 * thing that decides whether it is worth reopening.
 */
export function jobSummary(job: Pick<ScanJob, 'lines' | 'status'>): string {
  const total = job.lines.length;
  if (total === 0) {
    return job.status === 'failed' ? 'nothing read' : 'nothing yet';
  }
  const left = outstandingCount(job.lines);
  const noun = total === 1 ? 'book' : 'books';
  return left === 0 ? `${total} ${noun} · all sorted` : `${total} ${noun} · ${left} to sort`;
}
