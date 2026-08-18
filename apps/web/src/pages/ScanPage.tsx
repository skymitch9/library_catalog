import { useEffect, useRef, useState } from 'react';
import { PHOTO_LONG_EDGE, SHELF_LONG_EDGE, type ScanJob } from '@lc/core';
import { api } from '../api.js';
import { describeError } from '../lib/errors.js';
import {
  CameraError,
  cameraPlausible,
  captureFrame,
  closeCamera,
  fileToPhoto,
  openRearCamera,
} from '../lib/camera.js';
import { preloadDecoder, startScanLoop } from '../lib/scanner.js';
import { AddWork } from '../components/AddWork.js';
import { ScanLines } from '../components/ScanLines.js';
import { addPath, replaceUrl, scansPath, Link, type AddMode } from '../router.js';

/**
 * Add books: by barcode, by photograph of a shelf, or by hand.
 *
 * ## Why this screen is a *list*, not a single result
 *
 * Because the job is a shelf, not a book. Stopping the camera after every hit
 * means a tap between every book, and a tap between every book is why bulk
 * intake does not get done. So the loop runs `continuous`, results accumulate,
 * and nothing is written until the whole stack has been swept and looked over.
 *
 * ## ⚠️ The list now lives on the server, and that is the change
 *
 * It used to be `useState`, which meant a phone locking mid-sweep lost every
 * result. Tolerable for barcodes — a barcode is free to re-scan — and not
 * tolerable for a shelf photograph, which costs an API call every time. So each
 * scan appends a line to a `scan_job` row, the job id goes into the URL, and a
 * reload picks the sweep up exactly where it was. The queue at `/scans` lists
 * the ones you walked away from.
 *
 * ## ⚠️ Nothing here writes to the catalog
 *
 * Every row is a **proposal**. Phase 0 measured that a wrong ISBN returns a
 * confident, well-formed, wrong book — three of ten ISBNs typed from memory
 * resolved to entirely different titles, with covers and page counts, and
 * nothing in the response marks them. A spine read is weaker evidence than an
 * ISBN, not stronger: it arrives at an angle, half-occluded, with the series
 * name usually printed larger than the volume title. The person looking at the
 * cover and the title is the only check that exists, which is why "Add" is per
 * row and why the resolved title is shown large next to what was read.
 *
 * ## The three answers a barcode scan can give
 *
 * | | |
 * |---|---|
 * | `skipped` | not a book code — the price add-on, a retail UPC. **Silent when scanned.** |
 * | `owned`   | already on our shelf, answered from D1 with no network call |
 * | `found`   | resolved from the ladder, as a proposal |
 *
 * The silence on a scanned non-book code is deliberate and is most of what
 * makes this usable: a back cover carries two or three barcodes, so reading the
 * wrong one is the normal case, not an exception. Surfacing it would mean a
 * warning per book. A *typed* one explains itself, because silence there reads
 * as the button being broken.
 */

/**
 * The four ways in, as a table rather than four hand-written buttons.
 *
 * ⚠️ This is the sibling Board Game Catalog's `ADD_MODES` with book nouns, and
 * copying it rather than re-deriving it is the point — that app settled the
 * shape after its add row "reached five buttons of equal weight by accretion".
 * Same order, same markup, same `.scan-mode` cards, same one-line blurb under
 * each label. A tab with no blurb makes the reader open it to find out what it
 * does, which on a phone is the expensive way to answer a question.
 *
 * `costs` is the only field this app adds: two of the four spend money, and a
 * reader who cannot spend never sees them. Hidden rather than disabled — a
 * control that exists and refuses is worse than one that was never offered.
 */
/**
 * Tab glyphs — same SVG paths as the estate's canonical `estate-search.js`
 * ES_ICONS (owner order 2026-08-15: barcode modes show a BARCODE, photo modes
 * show a CAMERA, so the two never read backwards again — the apex once had
 * the camera emoji on the barcode scanner). If the canonical set changes,
 * change these to match; the convention is estate-wide.
 */
const MODE_GLYPHS = {
  barcode: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M2 5h2v14H2zM5.5 5h1v14h-1zM8 5h2v14H8zM11.5 5h1v14h-1zM14 5h3v14h-3zM18.5 5h1v14h-1zM21 5h1v14h-1z" />
    </svg>
  ),
  photo: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
  type: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
} as const;

const ADD_MODES: { id: AddMode; label: string; blurb: string; glyph: keyof typeof MODE_GLYPHS; costs?: true }[] = [
  { id: 'scan', label: 'Barcode', glyph: 'barcode', blurb: 'Exact, free, and keeps scanning. Best when the book has one.' },
  { id: 'photo', label: 'Shelf photo', glyph: 'photo', blurb: 'Reads every spine at once. Best for bulk.', costs: true },
  { id: 'single', label: 'One book', glyph: 'photo', blurb: 'Reads the title off a single cover.', costs: true },
  { id: 'type', label: 'Type a title', glyph: 'type', // ⚠️ Was "Looks the rest up as you type." There is no title-search endpoint and
// no as-you-type request — verified in a browser: typing a title produced no
// suggestions and no network call. The tab offers an ISBN lookup button and
// free-text fields, which the old blurb both overstated and contradicted (it
// promised "no code" and then the only lookup was by code).
blurb: 'No code, no book to hand. Type what you know and save it.' },
];

export function ScanPage({
  onDone,
  backLabel = 'Collection',
  initialMode = 'scan',
  initialJobId = null,
  canSpend,
}: {
  onDone: () => void;
  /** Where leaving goes, named. Usually the collection; see `backTarget`. */
  backLabel?: string;
  /** 'type' when the caller knows the camera is not available to this user. */
  initialMode?: AddMode;
  /** From `?job=`. Reopens a sweep left half-finished. */
  initialJobId?: number | null;
  /** `runResearch`. A photograph costs money; a barcode does not. */
  canSpend: boolean;
}) {
  const [mode, setMode] = useState<AddMode>(initialMode);
  const [job, setJob] = useState<ScanJob | null>(null);
  const [loading, setLoading] = useState(initialJobId !== null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // Read inside the scan loop's `ignore`, which is created once and would
  // otherwise close over the first render's empty set forever.
  const seenRef = useRef<Set<string>>(new Set());
  // Likewise: the loop's onScan needs the *current* job id, not the one that
  // existed when the camera started — the first scan of a sweep mints it.
  const jobIdRef = useRef<number | null>(initialJobId);

  const [running, setRunning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [cost, setCost] = useState<string | null>(null);
  /** A code this sweep already holds, waiting to be told whether it is a 2nd copy. */
  const [duplicate, setDuplicate] = useState<
    { code: string; title: string | null; position: number } | null
  >(null);
  /**
   * Codes already offered as a possible second copy.
   *
   * ⚠️ Without this the camera asks the same question five times a second. The
   * scan loop's `ignore` runs on every decoded frame, and a book sitting in
   * front of the lens decodes continuously — so the prompt is raised once per
   * code and cleared only when the person answers it.
   */
  const promptedRef = useRef<Set<string>>(new Set());
  /**
   * The current job, readable from inside the scan loop.
   *
   * The loop's callbacks are created once and would otherwise close over the
   * first render's `job` forever — the same reason `seenRef` and `jobIdRef`
   * exist. This one is needed to name the row a repeat scan collided with.
   */
  const jobRef = useRef<ScanJob | null>(null);
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  /** Every server answer arrives as a whole job, so there is one way to accept it. */
  function acceptJob(next: ScanJob) {
    jobIdRef.current = next.id;
    setJob(next);
    for (const line of next.lines) if (line.code) seenRef.current.add(line.code);
    replaceUrl(addPath(mode, next.id));
  }

  // Reopen a sweep named in the URL. This is the whole persistence feature from
  // the user's side: close the phone, come back, the books are still there.
  useEffect(() => {
    if (initialJobId === null) return;
    let live = true;
    void api
      .scanJob(initialJobId)
      .then(({ job: found }) => {
        if (!live) return;
        setJob(found);
        jobIdRef.current = found.id;
        for (const line of found.lines) if (line.code) seenRef.current.add(line.code);
      })
      .catch(() => {
        // A job id that no longer resolves is not worth an error screen — the
        // sweep is gone, and the useful thing to show is an empty new one.
        if (live) replaceUrl(addPath(mode));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  /**
   * Keep `?mode=` in step with the tab, so a refresh — or a link — reopens the
   * one you were on.
   *
   * ⚠️ `replaceUrl`, and the path never changes. Two separate reasons, both
   * load-bearing:
   *
   * - A **path** change would remount this screen, and a standalone PWA on iOS
   *   re-prompts for camera permission on every route change (WebKit #215884).
   *   That is why `/add` is one flat route with the tab in the query string.
   * - A **push** would make the phone's Back button undo a tab switch rather
   *   than leave the screen, which is not what a person who tapped "Type it in"
   *   and then pressed Back is asking for.
   */
  useEffect(() => {
    replaceUrl(addPath(mode, jobIdRef.current));
  }, [mode]);

  // Switching tabs must let go of the camera. The barcode tab and the photo tab
  // both want it, and iOS keeps the indicator light on until every track stops.
  useEffect(() => {
    stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    // ⚠️ `preloadDecoder()` is deliberately NOT called here, unlike the sibling
    // project's version of this page, which warms it on mount.
    //
    // The decoder is a 1MB WebAssembly module and compiling it blocks the main
    // thread — and most visits to this screen never touch it, because the photo
    // tab and the typing tab do not decode barcodes at all. Paying a
    // main-thread stall on every visit to buy nothing on two thirds of them is
    // the wrong trade, most of all on the phone this screen is for.
    //
    // It is warmed in `startBarcode()` instead: the first moment it is
    // certainly needed, and one the user already expects to wait through
    // because they are being asked for camera permission anyway.
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookupCode(code: string, typed = false, allowDuplicate = false) {
    try {
      const res = await api.scanBarcode(code, jobIdRef.current, allowDuplicate);
      acceptJob(res.job);
      /*
       * ⚠️ The sweep already holds this code. Ask, do not swallow.
       *
       * The owner's report: *"if a book is in the open queued scan list and you
       * scan a duplicate it doesn't prompt you, it just rejects the scan."* The
       * server's refusal was already carrying the row it collided with; nothing
       * was reading it, so a deliberate second copy looked exactly like a
       * misfire. Some books here genuinely are owned twice.
       */
      if (res.duplicate) {
        setDuplicate({ code, title: res.line.resolvedTitle ?? res.line.existingTitle, position: res.line.position });
        return;
      }
      setDuplicate(null);
      if (typed && res.line.state === 'skipped') {
        setCameraError(res.line.detail ?? 'Not a book barcode.');
      }
    } catch (err) {
      setCameraError(describeError(err));
    }
  }

  /** "Yes, a second copy" — the only thing that appends a duplicate line. */
  async function addDuplicate() {
    const pending = duplicate;
    if (!pending) return;
    setDuplicate(null);
    // Re-prompting is what makes a *third* copy possible, so the code comes
    // back out of the "already prompted" set the moment the answer is given.
    promptedRef.current.delete(pending.code);
    await lookupCode(pending.code, false, true);
  }

  async function startBarcode() {
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
        /*
         * A book left in front of the lens would otherwise rebuild its two
         * confirmations every few hundred milliseconds and be looked up again.
         * The server refuses duplicates too — see the route — but the cheapest
         * duplicate is the one that never becomes a request.
         *
         * ⚠️ **Suppressing the request must not mean suppressing the person.**
         * This used to return `true` and nothing else, which is why re-scanning
         * a book you own two of did nothing at all: the request never left the
         * phone, so the server never got the chance to say "already on this
         * sweep" and the screen never got the chance to ask. It still sends
         * nothing — it raises the prompt instead, once per code, and the answer
         * is what sends a request.
         */
        ignore: (code) => {
          if (!seenRef.current.has(code)) return false;
          if (!promptedRef.current.has(code)) {
            promptedRef.current.add(code);
            const held = jobRef.current?.lines.find((l) => l.code === code) ?? null;
            setDuplicate({
              code,
              title: held?.resolvedTitle ?? held?.existingTitle ?? null,
              position: held?.position ?? 0,
            });
          }
          return true;
        },
        onScan: (scan) => {
          seenRef.current.add(scan.code);
          void lookupCode(scan.code);
        },
        onError: (err) => setCameraError(describeError(err)),
      });
      setRunning(true);
    } catch (err) {
      setCameraError(cameraMessage(err));
    }
  }

  /** The photo tab's camera: a live preview, no decode loop, no scan interval. */
  async function startPhoto() {
    setCameraError(null);
    try {
      const stream = await openRearCamera();
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setRunning(true);
    } catch (err) {
      setCameraError(cameraMessage(err));
    }
  }

  function stopCamera() {
    stopRef.current?.();
    stopRef.current = null;
    closeCamera(streamRef.current);
    streamRef.current = null;
    setRunning(false);
  }

  /**
   * Send one photograph to be read.
   *
   * ⚠️ **This is the only thing in the app that costs money**, so it is one
   * explicit tap with the price of the last one printed underneath — never
   * automatic, never on a timer, and never retried on your behalf.
   */
  async function sendPhoto(get: () => Promise<{ data: string; mediaType: string }>) {
    setBusy('photo');
    setCameraError(null);
    setCost(null);
    try {
      const photo = await get();
      // One book and a shelf are the same pipeline with different prompts, so
      // the only thing that forks here is which endpoint is asked.
      const res =
        mode === 'single'
          ? await api.scanSingle(photo.data, photo.mediaType)
          : await api.scanShelf(photo.data, photo.mediaType);
      acceptJob(res.job);
      stopCamera();
      setCost(
        `${res.job.lines.length} read · about ${res.usage.estimatedCents.toFixed(1)}p ` +
          `(${res.usage.inputTokens} in / ${res.usage.outputTokens} out)`,
      );
      if (res.unreadable) {
        setCameraError('That photo could not be read. More light, or closer, or straighter on.');
      }
    } catch (err) {
      setCameraError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function finish() {
    const id = jobIdRef.current;
    setBusy('finish');
    try {
      if (id) await api.finishScanJob(id);
      onDone();
    } catch (err) {
      setCameraError(describeError(err));
      setBusy(null);
    }
  }

  const tabs = (
    <div className="scan-modes" role="tablist" aria-label="How to add">
      {ADD_MODES.filter((m) => !m.costs || canSpend).map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={mode === m.id}
          className={mode === m.id ? 'scan-mode scan-mode--on' : 'scan-mode'}
          onClick={() => setMode(m.id)}
        >
          <strong>{MODE_GLYPHS[m.glyph]}{m.label}</strong>
          <span className="muted">{m.blurb}</span>
        </button>
      ))}
    </div>
  );

  const header = (
    <>
      <div className="row-tight">
        <button onClick={onDone}>← {backLabel}</button>
        <Link to={scansPath} className="chip">
          Unfinished sweeps
        </Link>
      </div>
      <h2>Add a book</h2>
      {tabs}
    </>
  );

  if (mode === 'type') {
    return (
      <main>
        {header}
        {/* Already a plain panel rather than a dialog, so it drops onto a screen
            unchanged. `onClose` goes back to the barcode tab instead of
            unmounting, because on this screen "cancel" means "I'll scan it
            after all", not "leave". */}
        <AddWork onClose={() => setMode('scan')} onAdded={onDone} />
      </main>
    );
  }

  return (
    <main>
      {header}

      {/* A worded REFUSAL with its way out — untouchable by the trim rule. The
          2026-08-17 trim removed only the repo path (docs/info/ios-camera.md,
          still the home of record for the HTTPS tunnel trick), which meant
          nothing to the person reading it on a phone. */}
      {!cameraPlausible() && (
        <p className="muted small">
          This browser will not give a camera to this page — it needs HTTPS.{' '}
          {mode === 'scan' ? 'You can still type an ISBN below.' : 'You can still pick a photo below.'}
        </p>
      )}

      <div className={running ? 'camera-stage' : 'camera-stage hidden'}>
        {/* muted + playsinline are load-bearing on iOS, not decoration. */}
        <video ref={videoRef} playsInline muted />
      </div>

      {mode === 'scan' ? (
        <>
          <div className="row">
            {running ? (
              <button onClick={stopCamera}>Stop camera</button>
            ) : (
              <button
                className="primary"
                onClick={() => void startBarcode()}
                disabled={!cameraPlausible()}
              >
                Start camera
              </button>
            )}
          </div>

          <div className="row">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="…or type an ISBN"
              inputMode="numeric"
              aria-label="ISBN"
            />
            <button
              onClick={() => {
                const code = manual.trim();
                if (!code) return;
                seenRef.current.add(code);
                void lookupCode(code, true);
                setManual('');
              }}
            >
              Look up
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            {mode === 'single'
              ? 'Point at the front cover, straight on, filling the frame. A cover also gives the series and volume, which a spine rarely prints.'
              : 'Point at one shelf, straight on, with the spines filling the frame.'}{' '}
            Each photo costs about a penny to read, so it is one deliberate tap — never
            automatic.
          </p>
          <div className="row">
            {running ? (
              <>
                <button
                  className="primary"
                  disabled={busy !== null}
                  onClick={() =>
                    void sendPhoto(async () => {
                      const video = videoRef.current;
                      if (!video) throw new Error('The camera is not ready.');
                      // ⚠️ A live frame grab, not the photo library. It is the
                      // one capture path on iOS that provably writes nothing to
                      // the device — see lib/camera.ts.
                      // ⚠️ A cover is one large, flat piece of text; a shelf is
                      // thirty rotated 15mm ones. Sending a cover at shelf
                      // resolution costs more for nothing.
                      return captureFrame(
                        video,
                        mode === 'single' ? PHOTO_LONG_EDGE : SHELF_LONG_EDGE,
                      );
                    })
                  }
                >
                  {busy === 'photo' ? 'Reading…' : mode === 'single' ? 'Read this book' : 'Read this shelf'}
                </button>
                <button onClick={stopCamera} disabled={busy !== null}>
                  Stop camera
                </button>
              </>
            ) : (
              <button
                className="primary"
                onClick={() => void startPhoto()}
                disabled={!cameraPlausible() || busy !== null}
              >
                Start camera
              </button>
            )}
            {/* The desktop path, and the one this feature was measured with:
                no rear camera on a laptop, and a photo taken on a phone can be
                dropped in from anywhere. Downscaled in the browser before it is
                sent — a 48MP upload is pure waste, since the model resizes it
                anyway after you have paid to send it. */}
            <label className="chip" style={{ cursor: 'pointer' }}>
              Pick a photo
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                disabled={busy !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  void sendPhoto(async () =>
                    fileToPhoto(file, mode === 'single' ? PHOTO_LONG_EDGE : SHELF_LONG_EDGE),
                  );
                }}
              />
            </label>
          </div>
          {cost && <p className="muted small">{cost}</p>}
        </>
      )}

      {cameraError && <p className="notice notice--bad">{cameraError}</p>}

      {/* ⚠️ Already on this sweep — asked, not refused. The whole of the
          owner's report was that this case produced no prompt and no row, so
          a genuine second copy was indistinguishable from a misfire. Both
          answers are one tap, and neither is the default. */}
      {duplicate && (
        <div className="panel">
          <strong>Already on this sweep{duplicate.title ? `: ${duplicate.title}` : ''}</strong>
          <p className="muted small">
            {duplicate.position > 0 ? `Scanned as #${duplicate.position}. ` : ''}
            Do you have a second copy of this one?
          </p>
          <div className="row">
            <button className="primary" onClick={() => void addDuplicate()}>
              Yes — add a 2nd copy
            </button>
            <button onClick={() => setDuplicate(null)}>No, same book</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted small">Reopening that sweep…</p>
      ) : job ? (
        <>
          <ScanLines
            job={job}
            onJob={setJob}
            empty={
              mode === 'scan'
                ? 'Point the camera at the barcode on the back. The five-digit price code beside it is skipped automatically.'
                : 'Nothing read from that photo yet.'
            }
          />
          <div className="row" style={{ marginTop: '0.8rem' }}>
            <button onClick={() => void finish()} disabled={busy !== null}>
              {busy === 'finish' ? 'Finishing…' : 'Finish this sweep'}
            </button>
          </div>
        </>
      ) : (
        <p className="muted small">
          {mode === 'scan'
            ? 'Point the camera at the barcode on the back. The five-digit price code beside it is skipped automatically.'
            : mode === 'single'
              ? 'Photograph one book’s cover, or pick a photo, and what it says is read into a row you can check.'
              : 'Take a photo of a shelf, or pick one, and the books on it are read into a list you can check.'}
        </p>
      )}
    </main>
  );
}

function cameraMessage(err: unknown): string {
  if (!(err instanceof CameraError)) return describeError(err);
  switch (err.reason) {
    case 'insecure-context':
      return 'The camera needs HTTPS. Open the site over https, or use the cloudflared tunnel.';
    case 'denied':
      return 'Camera permission was refused. Allow it in the address bar, then try again.';
    case 'no-camera':
      return 'No camera on this device. Pick a photo instead.';
    case 'in-use':
      return 'Another app is using the camera.';
    case 'unsupported':
      return 'This browser cannot give a camera to a web page.';
    default:
      return err.message;
  }
}
