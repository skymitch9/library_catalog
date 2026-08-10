/**
 * Read metadata and the cover image out of an EPUB, with no dependencies.
 *
 * ## Why a hand-rolled zip reader
 *
 * An EPUB is a zip with an XML manifest inside it. Node ships `zlib` but not a
 * zip reader, and the alternative was a dependency for ~70 lines of well-
 * specified format. The backfill this serves runs on 116 local files once; the
 * dependency would outlive the need for it.
 *
 * Only the parts an EPUB actually uses are implemented: stored (0) and deflate
 * (8). Zip64 is not — an EPUB does not reach 4GB, and a file that did would
 * throw here rather than silently return the wrong bytes.
 *
 * ## What it is for
 *
 * `edition.source_url` holds the file's path relative to the ebook root, so the
 * file is on disk and it already knows three things the catalog does not:
 * its cover, and — for Calibre-managed files — its series and volume number.
 * Reading them is strictly better than guessing them from a filename, which is
 * the mistake `scripts/import-ebooks.mjs` documents having made once already.
 */

import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Every entry in the archive, by name, with enough to read it back. */
function readCentralDirectory(fd, size) {
  // The EOCD is last, followed only by an optional comment of up to 64KB.
  const tailLen = Math.min(size, 0x10000 + 22);
  const tail = Buffer.alloc(tailLen);
  readSync(fd, tail, 0, tailLen, size - tailLen);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');

  const count = tail.readUInt16LE(eocd + 10);
  const cenSize = tail.readUInt32LE(eocd + 12);
  const cenOffset = tail.readUInt32LE(eocd + 16);
  if (cenOffset === 0xffffffff) throw new Error('zip64 is not supported');

  const cen = Buffer.alloc(cenSize);
  readSync(fd, cen, 0, cenSize, cenOffset);

  const entries = new Map();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cen.length; n++) {
    if (cen.readUInt32LE(p) !== CEN_SIG) break;
    const method = cen.readUInt16LE(p + 10);
    const compressedSize = cen.readUInt32LE(p + 20);
    const nameLen = cen.readUInt16LE(p + 28);
    const extraLen = cen.readUInt16LE(p + 30);
    const commentLen = cen.readUInt16LE(p + 32);
    const localOffset = cen.readUInt32LE(p + 42);
    const name = cen.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(fd, entry) {
  // The central directory's name/extra lengths are allowed to differ from the
  // local header's, so the data offset must come from the local header.
  const head = Buffer.alloc(30);
  readSync(fd, head, 0, 30, entry.localOffset);
  if (head.readUInt32LE(0) !== LOC_SIG) throw new Error('bad local header');
  const dataAt = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);

  const raw = Buffer.alloc(entry.compressedSize);
  readSync(fd, raw, 0, entry.compressedSize, dataAt);

  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported compression method ${entry.method}`);
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
    ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return m ? m[1] : null;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function textOf(opf, tagName) {
  const m = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tagName}>`, 'i').exec(opf);
  return m ? decodeEntities(m[1].replace(/<[^>]*>/g, '')).trim() : null;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

/**
 * Everything this project wants out of one EPUB.
 *
 * Returns `null` for anything the file does not say. ⚠️ A missing series is a
 * real answer — most standalone books have none — and must not be guessed at
 * here; guessing belongs in the caller's ladder where it can be labelled.
 */
export function readEpub(filePath, { cover: wantCover = true } = {}) {
  const fd = openSync(filePath, 'r');
  try {
    const size = statSync(filePath).size;
    const entries = readCentralDirectory(fd, size);

    // container.xml names the OPF; a few files in this library get it wrong, so
    // fall back to whatever .opf is present rather than giving up.
    let opfPath = null;
    const container = entries.get('META-INF/container.xml');
    if (container) {
      const xml = readEntry(fd, container).toString('utf8');
      const m = /<rootfile\b[^>]*full-path\s*=\s*["']([^"']+)["']/i.exec(xml);
      if (m) opfPath = m[1];
    }
    if (!opfPath || !entries.has(opfPath)) {
      opfPath = [...entries.keys()].find((k) => k.toLowerCase().endsWith('.opf')) ?? null;
    }
    if (!opfPath) return null;

    const opf = readEntry(fd, entries.get(opfPath)).toString('utf8');
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    // Calibre writes the series as OPF2 <meta name content>, which is where
    // every file in this library that has one keeps it.
    const metas = opf.match(/<meta\b[^>]*\/?>/gi) ?? [];
    let series = null;
    let seriesIndex = null;
    for (const tag of metas) {
      const name = (attr(tag, 'name') ?? '').toLowerCase();
      if (name === 'calibre:series') series = decodeEntities(attr(tag, 'content') ?? '').trim() || null;
      if (name === 'calibre:series_index') {
        const v = Number(attr(tag, 'content'));
        if (Number.isFinite(v)) seriesIndex = v;
      }
    }

    // The cover, by the three conventions in the wild, in order of how much the
    // file is actually asserting: an explicit properties="cover-image" item,
    // then <meta name="cover" content="ID">, then a manifest id or href that
    // says "cover".
    const items = (opf.match(/<item\b[^>]*\/?>/gi) ?? []).map((tag) => ({
      id: attr(tag, 'id'),
      href: attr(tag, 'href'),
      type: attr(tag, 'media-type') ?? '',
      props: attr(tag, 'properties') ?? '',
    }));

    const metaCoverId = metas
      .map((t) => ((attr(t, 'name') ?? '').toLowerCase() === 'cover' ? attr(t, 'content') : null))
      .find(Boolean);

    const isImage = (it) => it.href && (it.type.startsWith('image/') || IMAGE_EXT.test(it.href));
    const coverItem =
      items.find((it) => /cover-image/i.test(it.props) && isImage(it)) ??
      items.find((it) => metaCoverId && it.id === metaCoverId && isImage(it)) ??
      items.find((it) => isImage(it) && /cover/i.test(it.id ?? '')) ??
      items.find((it) => isImage(it) && /cover/i.test(it.href ?? '')) ??
      null;

    let cover = null;
    if (coverItem && wantCover) {
      // hrefs are relative to the OPF and may be percent-encoded.
      const candidates = [
        base + coverItem.href,
        base + decodeURIComponent(coverItem.href),
        coverItem.href,
        decodeURIComponent(coverItem.href),
      ];
      for (const cand of candidates) {
        const norm = cand.replace(/\\/g, '/').replace(/^\.\//, '');
        if (entries.has(norm)) {
          cover = { name: norm, data: readEntry(fd, entries.get(norm)) };
          break;
        }
      }
    }

    return {
      title: textOf(opf, 'title'),
      author: textOf(opf, 'creator'),
      language: textOf(opf, 'language'),
      description: textOf(opf, 'description'),
      series,
      seriesIndex,
      cover,
    };
  } finally {
    closeSync(fd);
  }
}
