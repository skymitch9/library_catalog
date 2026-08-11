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
