/**
 * Cover rules: is this really an image, and does this book still need one?
 *
 * ⚠️ **Nothing here does I/O.** It decides about bytes and about rows that have
 * already been fetched, so the same rules run in the Worker, in a script and in
 * a test. The fetching half lives in `verifyCoverUrl` (`@lc/isbn`), and the two
 * share `MIN_COVER_BYTES` rather than each keeping a floor of their own.
 *
 * ⚠️ Imports `./constants.js` and nothing else from this package. See the note
 * at the top of `index.ts`: a module under `src/` that imports the barrel
 * reintroduces a cycle that makes `z.enum()` receive `undefined` and every write
 * endpoint return 500, and typecheck does not catch it.
 */

import { COVER_IMAGE_TYPES, type CoverImageType, type CoverStatus } from './constants.js';

/**
 * The size floor, shared by the fetch check and the upload check.
 *
 * ⚠️ It exists because `covers.openlibrary.org` answers **HTTP 200 with a 43-byte
 * 1×1 placeholder** when it has no cover — see the long note on `verifyCoverUrl`.
 * The same floor catches an error page served as 200, a "no image available"
 * gif, and a truncated upload, which is why it guards a local file as well as a
 * remote URL.
 */
export const MIN_COVER_BYTES = 1000;

/**
 * The ceiling on an upload.
 *
 * A cover at the size this app renders it (150px in the grid, 190px in the
 * detail panel, so 360px for a 2× display) is a few tens of KB; the whole
 * committed cover set is **4.2MB for 114 images**. 6MB is therefore roughly a
 * hundred times what a cover needs and is aimed at a straight-off-the-phone
 * photograph, which is the realistic input for the four books no rung can reach.
 *
 * ⚠️ It is a refusal, not a resize. Nothing in the Worker re-encodes an image —
 * `sharp` is a devDependency used by scripts on a real machine, and there is no
 * equivalent inside a Worker. A file that is too big is rejected with a sentence
 * saying so, rather than stored at a size that would make every page slow.
 */
export const MAX_COVER_BYTES = 6 * 1024 * 1024;

/** The first bytes of a file, as a hex string, for magic-number comparison. */
function hexHead(bytes: Uint8Array, length: number): string {
  let out = '';
  for (let i = 0; i < length && i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * What this file actually is, read from its own first bytes.
 *
 * ⚠️ **The browser's declared `Content-Type` is a claim, not evidence.** A
 * multipart part can say `image/jpeg` over an HTML error page, a PDF, a zip or a
 * script, and every one of those would then be stored and served from our own
 * origin under a name ending in `.jpg`. Storing a file because it said it was an
 * image is the whole class of bug this function exists to remove.
 *
 * Returns null for anything not in `COVER_IMAGE_TYPES` — including SVG, which is
 * deliberately not an accepted cover type: it is a document that can carry
 * script, and a vector cover has no use here.
 */
export function sniffImageType(bytes: Uint8Array): CoverImageType | null {
  // JPEG: SOI marker.
  if (hexHead(bytes, 3) === 'ffd8ff') return 'image/jpeg';
  // PNG: the 8-byte signature, including the CRLF/EOF traps it was designed with.
  if (hexHead(bytes, 8) === '89504e470d0a1a0a') return 'image/png';
  // GIF87a / GIF89a.
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  // RIFF container: "RIFF" ....size.... "WEBP".
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  // ISO-BMFF: "....ftyp" then a brand. AVIF's brands are 'avif' (a still) and
  // 'avis' (a sequence); an iPhone's HEIC lands here too and is NOT accepted,
  // because it would be stored and then fail to render in half the browsers
  // that could have uploaded it.
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/** The file extension an object of this type is stored under. */
export function extensionFor(type: CoverImageType): string {
  return type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length);
}

export interface UploadCheck {
  ok: boolean;
  /** The type read from the bytes — never the one the client declared. */
  contentType: CoverImageType | null;
  bytes: number;
  /** A sentence to show a person. Absent when `ok`. */
  reason?: string;
}

/**
 * Decide whether these bytes may be stored as a cover.
 *
 * The upload-side twin of `verifyCoverUrl`, and it applies the same two defences
 * in the same order, because they fail differently: **what it is** (sniffed, not
 * declared) and **how big it is** (a floor that catches placeholders and
 * truncation, a ceiling that catches a raw camera roll).
 *
 * `declaredType` is used only to fail fast with a clearer message; it never
 * decides. A file whose bytes say PNG while the browser said JPEG is accepted as
 * a PNG — browsers get this wrong on drag-and-drop and the bytes are right.
 */
export function checkCoverUpload(bytes: Uint8Array, declaredType?: string | null): UploadCheck {
  const size = bytes.byteLength;

  if (size === 0) {
    return { ok: false, contentType: null, bytes: 0, reason: 'That file is empty.' };
  }
  if (size > MAX_COVER_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      contentType: null,
      bytes: size,
      reason: `${mb}MB is larger than the ${MAX_COVER_BYTES / (1024 * 1024)}MB limit. Covers are a few tens of KB — this looks like a full-size photograph. Crop or shrink it first.`,
    };
  }

  const contentType = sniffImageType(bytes);
  if (!contentType) {
    const said = declaredType && declaredType.trim() !== '' ? ` It claimed to be ${declaredType}.` : '';
    return {
      ok: false,
      contentType: null,
      bytes: size,
      reason: `That is not an image this app can serve — the file's own bytes are not ${COVER_IMAGE_TYPES.map((t) => t.slice(6).toUpperCase()).join(', ')}.${said}`,
    };
  }

  // ⚠️ After the sniff, not before: a 43-byte file that is a real (tiny) GIF and
  // a 43-byte file that is HTML both fail, and the person deserves to be told
  // which. Open Library's placeholder is the former.
  if (size < MIN_COVER_BYTES) {
    return {
      ok: false,
      contentType,
      bytes: size,
      reason: `${size} bytes is a placeholder, not a cover.`,
    };
  }

  return { ok: true, contentType, bytes: size };
}

/**
 * Where an uploaded cover is stored.
 *
 * ⚠️ **Hashed on the BYTES, not on the work key** — the opposite of the
 * committed `apps/web/public/covers/` names, and the difference is deliberate.
 * `docs/info/covers-and-series.md` records the cost of the other choice: those
 * names hash the work key, so re-running the backfill serves different bytes
 * from the same URL, which is why `_headers` can only give them one day of
 * cache. An object named after its own content can never do that, so a hosted
 * cover can be cached hard and forever, and replacing one is simply a new URL.
 *
 * The work key stays in the name in front of the digest so a person looking at a
 * bucket listing can tell what a file is.
 */
export function coverObjectKey(workKey: string, digestHex: string, type: CoverImageType): string {
  const slug =
    workKey
      .replace(/\|/g, '-')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'cover';
  return `covers/${slug}-${digestHex.slice(0, 16)}.${extensionFor(type)}`;
}

/**
 * Does this book still need somebody to find it a cover?
 *
 * ⚠️ **Two states, not one, and the second is the whole point.** A missing cover
 * is obvious from the page; a stand-in looks finished and is not. Both belong on
 * the same list, because both end the same way — somebody supplies the real
 * image — and a list that showed only the empty ones would quietly retire the
 * five Percy Jackson works the moment the marketing photograph was applied.
 *
 * A `cover_status` of NULL over a filled `cover_url` is **not** needed: nobody
 * has assessed it, and treating unassessed as wrong would put all 224 works on
 * the list and make it useless. Only a positive 'standin' counts.
 */
export function coverNeeded(work: {
  coverUrl: string | null;
  coverStatus: CoverStatus | string | null;
}): boolean {
  return !work.coverUrl || work.coverStatus === 'standin';
}

// ---------------------------------------------------------------------------
// The cover picker — every cover this book could wear, side by side
// ---------------------------------------------------------------------------

/** Where a candidate's URL was found. */
export type CoverCandidateSource =
  /** An edition row carries it — the richest kind, it names a printing. */
  | 'edition'
  /** The work wore it once; `change_log` remembers when it stopped. */
  | 'history'
  /** The work wears it now and no edition or history row explains it. */
  | 'current'
  /** A computed Open Library URL — a guess, not a recorded fact. */
  | 'guess';

export interface CoverCandidate {
  url: string;
  /** What to call it in the grid — a printing's name, or its provenance. */
  label: string;
  /** A second line: publisher · year, or when it was replaced. */
  caption: string | null;
  source: CoverCandidateSource;
  /** The work is wearing this URL right now (saved, not merely picked). */
  selected: boolean;
  /**
   * ⚠️ A derived candidate is a guess about what a CDN might hold, not a fact
   * this catalog recorded. The UI hides a derived card whose image fails —
   * a wrong guess is noise — but renders a RECORDED candidate's failure as
   * "image no longer loads", because that is a fact worth seeing.
   */
  derived: boolean;
  /** The edition carrying it, when one does. */
  editionId: number | null;
}

/** The slice of an edition row the assembly needs. */
export interface CoverCandidateEdition {
  id: number;
  coverUrl: string | null;
  isbn13: string | null;
  format: string;
  editionName: string | null;
  publisher: string | null;
  publishedYear: number | null;
  source: string;
}

export interface CoverCandidateInputs {
  /** The cover the work wears now — `work.cover_url`. */
  currentUrl: string | null;
  /** `work.openlibrary_work_id`, for the work-level guess. */
  openlibraryWorkId: string | null;
  editions: CoverCandidateEdition[];
  /**
   * Every URL the cover column has held before, newest first — the OLD values
   * of `change_log` rows with `field = 'coverUrl'`. ⚠️ This is why swapping
   * back is cheap: uploaded objects are content-addressed and DELETE never
   * removes them from the bucket, so a URL that was ever right is still
   * serving. `at` is when the column stopped holding it.
   */
  history: { url: string; at: string }[];
}

/** "ebook_epub" → "ebook epub" — readable without importing a label map. */
function formatWord(format: string): string {
  return format.replace(/_/g, ' ');
}

const OL_COVERS = 'https://covers.openlibrary.org/b';

/**
 * Every cover this work could wear, deduplicated, current first.
 *
 * Pure assembly over rows already fetched — the queries live in `@lc/db`, the
 * decisions live here where a test can reach them. Ported as an *idea* from
 * the board game catalog's `listCoverCandidates`: an item has several known
 * printings, each has artwork, and a person picks the one that matches the
 * object on the shelf. The schemas differ (their campaign-edition machinery
 * has no counterpart here; our change_log history has none there), so the
 * code is this catalog's own.
 *
 * Rules:
 *
 * - **Dedupe by URL, richest description wins**: an edition row explains a
 *   picture better than "previous cover", which explains it better than a
 *   guess. The current cover is usually also an edition's or history's URL,
 *   and gets `selected` wherever it lands.
 * - **A current cover nothing explains is still a candidate** — a hand-pasted
 *   URL must not vanish from the very grid that could swap away from it.
 * - **Guesses go last and say they are guesses.** The `?default=false` query
 *   makes Open Library answer 404 instead of its 43-byte placeholder, so a
 *   wrong guess fails visibly in the browser and the UI can drop the card.
 * - Nothing here fetches. Applying a pick goes through the existing verified
 *   PUT, which refuses anything that does not serve a real image.
 */
export function assembleCoverCandidates(inputs: CoverCandidateInputs): CoverCandidate[] {
  const currentUrl = inputs.currentUrl?.trim() || null;
  const byUrl = new Map<string, CoverCandidate>();

  const add = (candidate: CoverCandidate) => {
    const url = candidate.url.trim();
    if (!url || byUrl.has(url)) return;
    byUrl.set(url, { ...candidate, url, selected: url === currentUrl });
  };

  // Editions first: they carry the year and publisher that make a choice
  // meaningful, so they win the description when a URL appears twice.
  for (const e of inputs.editions) {
    if (!e.coverUrl?.trim()) continue;
    add({
      url: e.coverUrl,
      label: e.editionName?.trim() || formatWord(e.format),
      caption:
        [e.publisher, e.publishedYear].filter(Boolean).join(' · ') ||
        (e.source !== 'manual' ? e.source : null),
      source: 'edition',
      selected: false,
      derived: false,
      editionId: e.id,
    });
  }

  // Covers the work wore before. Still retrievable: R2 objects are named for
  // their own bytes and never deleted by a swap, and third-party URLs either
  // still serve or fail visibly in the grid.
  for (const h of inputs.history) {
    if (!h.url.trim()) continue;
    // ⚠️ A history URL that is ALSO the current cover is a swap-back that
    // already happened — "Previous cover · in use" would contradict itself,
    // so it is described as what it is now, not as what it once was.
    const wornAgain = h.url.trim() === currentUrl;
    add({
      url: h.url,
      label: wornAgain ? 'Current cover' : 'Previous cover',
      caption: wornAgain ? null : h.at ? `until ${h.at.slice(0, 10)}` : null,
      source: wornAgain ? 'current' : 'history',
      selected: false,
      derived: false,
      editionId: null,
    });
  }

  // The cover on the work but explained by nothing — a hand-typed URL, or one
  // set before the audit log existed. Losing it from this list would make the
  // picker able to swap away from something it could not offer back.
  if (currentUrl && !byUrl.has(currentUrl)) {
    add({
      url: currentUrl,
      label: 'Current cover',
      caption: null,
      source: 'current',
      selected: true,
      derived: false,
      editionId: null,
    });
  }

  // Guesses last: computed Open Library URLs. `?default=false` turns their
  // placeholder into an honest 404 — see MIN_COVER_BYTES for what the
  // placeholder otherwise costs.
  const olid = inputs.openlibraryWorkId?.trim();
  if (olid) {
    add({
      url: `${OL_COVERS}/olid/${olid}-L.jpg?default=false`,
      label: 'Open Library',
      caption: 'their cover for this work',
      source: 'guess',
      selected: false,
      derived: true,
      editionId: null,
    });
  }
  for (const e of inputs.editions) {
    if (!e.isbn13) continue;
    add({
      url: `${OL_COVERS}/isbn/${e.isbn13}-L.jpg?default=false`,
      label: 'Open Library',
      caption: `from ISBN ${e.isbn13}`,
      source: 'guess',
      selected: false,
      derived: true,
      editionId: e.id,
    });
  }

  // Current first, then recorded facts, then guesses; ties keep insertion
  // order, which already runs editions → history.
  const rank = (c: CoverCandidate) => (c.selected ? 0 : c.derived ? 2 : 1);
  return [...byUrl.values()].sort((a, b) => rank(a) - rank(b));
}
