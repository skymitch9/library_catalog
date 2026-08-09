import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { CameraError, cameraPlausible, closeCamera, openRearCamera } from '../lib/camera.js';
import { preloadDecoder, startScanLoop } from '../lib/scanner.js';
import { formatLabel } from '../lib/formats.js';

/**
 * Scan a stack of books by their ISBNs.
 *
 * ## Why this screen is a *list*, not a single result
 *
 * Because the job is a shelf, not a book. The board game catalog learned the
 * same thing: stopping the camera after every hit means a tap between every box,
 * and a tap between every box is why bulk intake does not get done. So the loop
 * runs `continuous`, results accumulate, and nothing is written until the whole
 * stack has been swept and looked over.
 *
 * ## ⚠️ Nothing here writes to the catalog
 *
 * Every row is a **proposal**. Phase 0 measured that a wrong ISBN returns a
 * confident, well-formed, wrong book — three of ten ISBNs typed from memory
 * resolved to entirely different titles, with covers and page counts, and
 * nothing in the response marks them. The person looking at the cover and the
 * title is the only check that exists, which is why "Add" is per row and why
 * the resolved title is shown large.
 *
 * ## The three answers a scan can give
 *
 * | | |
 * |---|---|
 * | `ignore` | not a book code — the price add-on, a retail UPC. **Silent.** Keep scanning. |
 * | `owned`  | already on our shelf, answered from D1 with no network call |
 * | `found`  | resolved from the ladder, as a proposal |
 *
 * The silence on `ignore` is deliberate and is most of what makes this usable: a
 * back cover carries two or three barcodes, so reading the wrong one is the
 * normal case, not an exception. Surfacing it would mean a warning per book.
 */

interface Row {
  code: string;
  state: 'looking' | 'owned' | 'found' | 'not_found' | 'unresolvable' | 'skipped' | 'error';
  title?: string;
  authors?: string;
  publisher?: string | null;
  year?: number | null;
  coverUrl?: string | null;
  format?: string;
  detail?: string;
  added?: boolean;
}

export function ScanPage({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // Read inside the scan loop's `ignore`, which is created once and would
  // otherwise close over the first render's empty array forever.
  const seenRef = useRef<Set<string>>(new Set());

  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    // ⚠️ `preloadDecoder()` is deliberately NOT called here, unlike the sibling
    // project's version of this page, which warms it on mount.
    //
    // The decoder is a 1MB WebAssembly module and compiling it blocks the main
    // thread — and half the uses of this screen never touch it, because typing
    // an ISBN into the box goes straight to the API. Paying a main-thread stall
    // on every visit to buy nothing on half of them is the wrong trade, most of
    // all on the phone this screen is actually for.
    //
    // It is warmed in `start()` instead: the first moment it is certainly
    // needed, and one the user already expects to wait through because they are
    // being asked for camera permission anyway.
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * @param typed true when a person entered the code by hand.
   *
   * ⚠️ This flag decides what happens to a non-book barcode, and the two answers
   * are opposites for good reason. A **scanned** price add-on or retail UPC is
   * the normal case — a back cover carries two or three codes — so the row is
   * dropped without a word, or bulk intake becomes a warning per book. A
   * **typed** one is a person's deliberate act, and silence would read as the
   * button being broken, so it explains itself.
   *
   * The first version had neither: it did not handle `ignore` at all, so a price
   * code fell through to "Not in Open Library", which is both wrong and the most
   * misleading thing it could have said.
   */
  async function lookup(code: string, typed = false) {
    setRows((prev) =>
      prev.some((r) => r.code === code) ? prev : [{ code, state: 'looking' }, ...prev],
    );
    try {
      const res = (await api.scan(code)) as {
        result: string;
        reason?: string;
        edition?: { format: string };
        candidates?: {
          title: string;
          authors: string;
          publisher: string | null;
          publishedYear: number | null;
          coverUrl: string | null;
        }[];
      };

      if (res.result === 'ignore') {
        if (!typed) {
          setRows((prev) => prev.filter((r) => r.code !== code));
          // Forgotten, so a genuine barcode read a moment later on the same
          // sweep is not suppressed by the streak guard.
          seenRef.current.delete(code);
          return;
        }
        setRows((prev) =>
          prev.map((r) =>
            r.code === code
              ? {
                  ...r,
                  state: 'skipped',
                  detail:
                    res.reason === 'price_addon'
                      ? 'That is the five-digit price code printed beside the barcode. Use the longer one.'
                      : 'Not a book barcode. Books start 978 or 979.',
                }
              : r,
          ),
        );
        return;
      }

      setRows((prev) =>
        prev.map((r) => {
          if (r.code !== code) return r;
          if (res.result === 'owned') {
            return { ...r, state: 'owned', format: res.edition?.format };
          }
          if (res.result === 'unresolvable') {
            return {
              ...r,
              state: 'unresolvable',
              // The Kindle path. Saying which population this falls into beats
              // "not found", because the fix is a different importer, not a
              // retry — see docs/info/isbn-ladder.md §4.2.
              detail: 'Kindle ASIN — no free database indexes these.',
            };
          }
          const first = res.candidates?.[0];
          if (!first) {
            return {
              ...r,
              state: 'not_found',
              detail: 'Not in Open Library. About half this library is not — add it by hand.',
            };
          }
          return {
            ...r,
            state: 'found',
            title: first.title,
            authors: first.authors,
            publisher: first.publisher,
            year: first.publishedYear,
            coverUrl: first.coverUrl,
          };
        }),
      );
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.code === code
            ? { ...r, state: 'error', detail: err instanceof Error ? err.message : String(err) }
            : r,
        ),
      );
    }
  }

  async function start() {
    setCameraError(null);
    // Warm the decoder alongside opening the camera, so the compile overlaps
    // the permission prompt and the first frames rather than following them.
    preloadDecoder();
    try {
      const stream = await openRearCamera();
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // `playsinline` is set on the element; without it iOS takes the video
      // fullscreen and the page disappears. See docs/info/ios-camera.md.
      await video.play();

      stopRef.current = startScanLoop({
        video,
        continuous: true,
        // A book left in front of the lens would otherwise rebuild its two
        // confirmations every few hundred milliseconds and be looked up again.
        ignore: (code) => seenRef.current.has(code),
        onScan: (scan) => {
          seenRef.current.add(scan.code);
          void lookup(scan.code);
        },
        onError: (err) => setCameraError(err instanceof Error ? err.message : String(err)),
      });
      setRunning(true);
    } catch (err) {
      setCameraError(
        err instanceof CameraError
          ? cameraMessage(err)
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  }

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    closeCamera(streamRef.current);
    streamRef.current = null;
    setRunning(false);
  }

  async function add(row: Row) {
    if (!row.title || !row.authors) return;
    try {
      const { work } = await api.createWork({ title: row.title, authors: row.authors });
      await api.createEdition({
        workId: work.id,
        isbn13: row.code,
        format: 'paperback',
        publisher: row.publisher ?? null,
        publishedYear: row.year ?? null,
        coverUrl: row.coverUrl ?? null,
        source: 'openlibrary',
      });
      // A copy, because a person scanning a physical barcode is holding the
      // book. This is the one place that inference is safe — unlike the ebook
      // importer, where a file existing says nothing about a shelf.
      await api.createCopy({ workId: work.id, status: 'owned' });
      setRows((prev) => prev.map((r) => (r.code === row.code ? { ...r, added: true } : r)));
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.code === row.code
            ? { ...r, state: 'error', detail: err instanceof Error ? err.message : String(err) }
            : r,
        ),
      );
    }
  }

  return (
    <main>
      <button onClick={onDone}>← Collection</button>
      <h2>Scan</h2>

      {!cameraPlausible() && (
        <p className="muted small">
          This browser will not give a camera to this page. It needs HTTPS — see
          docs/info/ios-camera.md for the tunnel trick. You can still type an ISBN below.
        </p>
      )}

      <div className={running ? 'camera-stage' : 'camera-stage hidden'}>
        {/* muted + playsinline are load-bearing on iOS, not decoration. */}
        <video ref={videoRef} playsInline muted />
      </div>

      <div className="row">
        {running ? (
          <button onClick={stop}>Stop camera</button>
        ) : (
          <button className="primary" onClick={() => void start()} disabled={!cameraPlausible()}>
            Start camera
          </button>
        )}
      </div>

      {cameraError && <p className="muted small">{cameraError}</p>}

      <div className="row">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="…or type an ISBN"
          inputMode="numeric"
        />
        <button
          onClick={() => {
            const code = manual.trim();
            if (!code) return;
            seenRef.current.add(code);
            void lookup(code, true);
            setManual('');
          }}
        >
          Look up
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="muted small">
          Point the camera at the barcode on the back. The five-digit price code beside
          it is skipped automatically.
        </p>
      ) : (
        <ul className="works">
          {rows.map((r) => (
            <li key={r.code}>
              {r.coverUrl ? (
                <img src={r.coverUrl} alt="" width={44} height={66} loading="lazy" />
              ) : (
                <span className="cover-placeholder" aria-hidden="true" />
              )}
              <div style={{ flex: 1 }}>
                {r.state === 'looking' && <span className="muted small">Looking up {r.code}…</span>}

                {r.state === 'owned' && (
                  <>
                    <strong>Already yours</strong>
                    <div className="muted small">
                      {r.code}
                      {r.format ? ` · ${formatLabel(r.format)}` : ''}
                    </div>
                  </>
                )}

                {r.state === 'found' && (
                  <>
                    <strong>{r.title}</strong>
                    <div className="muted small">{r.authors}</div>
                    <div className="muted small">
                      {[r.publisher, r.year].filter(Boolean).join(' · ')} · {r.code}
                    </div>
                  </>
                )}

                {(r.state === 'not_found' ||
                  r.state === 'unresolvable' ||
                  r.state === 'skipped' ||
                  r.state === 'error') && (
                  <>
                    <strong>{r.code}</strong>
                    <div className="muted small">{r.detail}</div>
                  </>
                )}
              </div>

              {r.state === 'found' &&
                (r.added ? (
                  <span className="muted small">Added</span>
                ) : (
                  <button onClick={() => void add(r)}>Add</button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function cameraMessage(err: CameraError): string {
  switch (err.reason) {
    case 'insecure-context':
      return 'The camera needs HTTPS. Open the site over https, or use the cloudflared tunnel.';
    case 'denied':
      return 'Camera permission was refused. Allow it in the address bar, then try again.';
    case 'no-camera':
      return 'No camera on this device.';
    case 'in-use':
      return 'Another app is using the camera.';
    case 'unsupported':
      return 'This browser cannot give a camera to a web page.';
    default:
      return err.message;
  }
}
