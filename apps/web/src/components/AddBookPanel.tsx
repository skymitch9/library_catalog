import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PHOTO_LONG_EDGE, SHELF_LONG_EDGE, type EditionFormat, type ScanJob } from '@lc/core';
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
import { formatLabel } from '../lib/formats.js';
import {
  DEFAULT_SCAN_FORMAT,
  SCAN_FORMATS,
  loadScanFormat,
  saveScanFormat,
} from '../lib/scan-format.js';
import { intentFor, type ScanTarget } from '../lib/scan-target.js';
import { addModeSpec, firstUsableMode, type AddModeGlyph } from '../lib/add-modes.js';
import { AddWork } from './AddWork.js';
import { ScanLines } from './ScanLines.js';
import type { AddMode } from '../router.js';

/**
 * The tabs and the machinery behind them: barcode, shelf photo, one book, or
 * typing it in — and the review list everything lands in.
 *
 * ## ⚠️ WHY THIS WAS EXTRACTED FROM `ScanPage`, 2026-09-04
 *
 * The owner, after being told the board-game catalog adds to its wishlist from
 * the wishlist page itself rather than from a switch on its scanner:
 * *"We should mimic that shape so keep reusable components"*.
 *
 * So there are now two doors — `/add`, and the **+ Add something** panel on
 * `/wishlist` — and everything between the tab strip and the review list is
 * this component, rendered by both. The alternative was a second scanner beside
 * the first, which is the failure `lib/catalog-add.ts`'s own header names: *"a
 * second copy in the photo path is how one of them quietly stops attaching to
 * existing works"*. There is exactly one camera loop, one `addLineToCatalog`
 * call and one `copyStatusFor` in this app, and this extraction is what keeps
 * that true now that two screens add books.
 *
 * ## ⚠️ WHAT EACH CALLER STILL OWNS
 *
 * Everything ABOVE the tabs, because that is where the two screens genuinely
 * differ and pretending otherwise would mean a prop for every heading:
 *
 * | | `/add` (`ScanPage`) | the wishlist door (`WishlistAdd`) |
 * |---|---|---|
 * | the target | its Shelf \| Wishlist switch, passed in | **pinned `wishlist`** |
 * | tabs offered | all four, paid ones hidden when they cannot spend | three, unusable ones disabled with a sentence |
 * | the URL | keeps `?mode=` and `?job=` in step via `onNav` | nothing — it is a panel on a page, not a route |
 * | a typed save | leaves for the collection | refreshes the list and shuts the door |
 *
 * ## ⚠️ Nothing here writes to the catalog on its own
 *
 * Every row is a **proposal**. Phase 0 measured that a wrong ISBN returns a
 * confident, well-formed, wrong book — three of ten ISBNs typed from memory
 * resolved to entirely different titles, with covers and page counts, and
 * nothing in the response marks them. A spine read is weaker evidence than an
 * ISBN, not stronger. The person looking at the cover and the title is the only
 * check that exists, which is why "Add" is per row.
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
 * Tab glyphs — same SVG paths as the estate's canonical `estate-search.js`
 * ES_ICONS (owner order 2026-08-15: barcode modes show a BARCODE, photo modes
 * show a CAMERA, so the two never read backwards again — the apex once had
 * the camera emoji on the barcode scanner). If the canonical set changes,
 * change these to match; the convention is estate-wide.
 */
const MODE_GLYPHS: Record<AddModeGlyph, ReactNode> = {
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
};

export function AddBookPanel({
  target,
  modes,
  blocked,
  initialMode,
  initialJobId = null,
  onNav,
  onAdded,
  onFinished,
  onCancel,
  underTabs,
}: {
  /**
   * Where everything this panel creates LANDS — `shelf` writes `owned` copies,
   * `wishlist` writes `wanted` ones.
   *
   * ⚠️ Passed in, never read from storage here, for the reason `ScanLines`
   * states about `format`: exactly ONE live value on the screen. `/add` hands
   * over the value of its switch (already forced to `shelf` for anybody without
   * `suggestWishlist`); the wishlist door hands over the constant `wishlist`.
   * `lib/scan-target.ts` owns the mapping to a `copy.status` and is the only
   * place it is written.
   */
  target: ScanTarget;
  /** The tabs to offer, in the order to render them. `lib/add-modes.ts`. */
  modes: readonly AddMode[];
  /**
   * Offered tabs this person cannot use, mapped to the sentence saying why.
   *
   * ⚠️ A tab named here still renders — disabled, with its sentence underneath
   * at full opacity, exactly as the Shelf|Wishlist switch's refusal does. `/add`
   * passes nothing and hides its paid tabs instead; see `lib/add-modes.ts` for
   * why the two screens differ.
   */
  blocked?: Partial<Record<AddMode, string>>;
  /** The tab to open on. Ignored if it is blocked — see `firstUsableMode`. */
  initialMode?: AddMode;
  /** From `?job=`. Reopens a sweep left half-finished. */
  initialJobId?: number | null;
  /**
   * The tab or the sweep changed. `/add` keeps `?mode=` and `?job=` in step
   * with it; the wishlist door passes nothing, because a panel on a page has no
   * URL of its own to keep honest.
   */
  onNav?: (mode: AddMode, jobId: number | null) => void;
  /**
   * A book landed in the catalog.
   *
   * ⚠️ The SOURCE is passed rather than the two being collapsed, because the
   * two callers treat them differently and that difference has to be visible at
   * the call site: on `/add` a typed save leaves for the collection (it always
   * has) while a scanned row does not, and on the wishlist door a typed save
   * shuts the door while a scanned row keeps the sweep going.
   */
  onAdded?: (from: 'typed' | 'row') => void;
  /** "Finish this sweep" pressed and the job closed on the server. */
  onFinished: () => void;
  /**
   * Backing out of the typing form entirely.
   *
   * ⚠️ Optional, and its absence is the `/add` behaviour: with no `onCancel`,
   * Cancel returns to the first other usable tab, because on that screen
   * "cancel" means *"I'll scan it after all"*, not *"leave"*. The wishlist door
   * passes one, because there the panel itself is the thing being backed out of.
   */
  onCancel?: () => void;
  /**
   * Rendered between the tab strip and the binding toggle: what this sweep is
   * about to do. `/add` puts its Shelf|Wishlist switch here; the wishlist door
   * puts the one sentence saying the target is pinned.
   *
   * ⚠️ A FUNCTION of the tab, not a node, because `/add`'s switch says
   * *"Scanned books go on your wishlist"* on three tabs and *"Books you add…"*
   * on the typing one — and the tab is this component's state. Handing the
   * caller a node to render would have quietly dropped that distinction, which
   * is a sentence about something the person is not doing.
   */
  underTabs?: (mode: AddMode) => ReactNode;
}) {
  const [mode, setMode] = useState<AddMode>(() => firstUsableMode(modes, blocked ?? {}, initialMode));
  /*
   * ⚠️ The binding every row of this sweep will write — Kiro's scan-time
   * toggle (`docs/TODO.md`, built 2026-09-02). ONE choice for the whole sweep,
   * not one per book: this screen's entire standing complaint is too many taps,
   * and somebody emptying a box of paperbacks is doing one thing.
   *
   * ⚠️ Lazy initialiser, not `useState(loadScanFormat())`. The eager form calls
   * localStorage on EVERY render and throws away the result — cheap here, but
   * it is the same accessor a private-mode browser throws on, and this file's
   * camera effects have already taught the codebase what a per-render side
   * effect costs.
   *
   * It defaults to `paperback` and REMEMBERS itself between visits — see
   * `lib/scan-format.ts` for what "auto-open persistence" was read as and, more
   * usefully, the three bigger things it was read as NOT meaning.
   */
  const [scanFormat, setScanFormat] = useState<EditionFormat>(() => loadScanFormat());
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
  /*
   * The caller's navigation callback, read from inside effects and loop
   * callbacks that must not re-run when it changes identity. Same reason
   * `jobRef` exists below: a parent that re-creates the function every render
   * would otherwise restart the sweep's effects.
   */
  const onNavRef = useRef(onNav);
  useEffect(() => {
    onNavRef.current = onNav;
  }, [onNav]);

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
    onNavRef.current?.(mode, next.id);
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
        if (live) onNavRef.current?.(mode, null);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  /**
   * Keep the caller's URL in step with the tab, so a refresh — or a link —
   * reopens the one you were on.
   *
   * ⚠️ `/add` answers this with `replaceUrl`, and the path never changes. Two
   * separate reasons, both load-bearing:
   *
   * - A **path** change would remount this screen, and a standalone PWA on iOS
   *   re-prompts for camera permission on every route change (WebKit #215884).
   *   That is why `/add` is one flat route with the tab in the query string.
   * - A **push** would make the phone's Back button undo a tab switch rather
   *   than leave the screen, which is not what a person who tapped "Type it in"
   *   and then pressed Back is asking for.
   */
  useEffect(() => {
    onNavRef.current?.(mode, jobIdRef.current);
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
      onFinished();
    } catch (err) {
      setCameraError(describeError(err));
      setBusy(null);
    }
  }

  /**
   * Backing out of the typing form.
   *
   * ⚠️ The `/add` behaviour is the fallback, unchanged: return to the first
   * other usable tab, because there "cancel" means *"I'll scan it after all"*.
   * A caller that owns something bigger than a tab — the wishlist door owns a
   * panel — passes `onCancel` and gets the whole thing shut instead.
   */
  function cancelTyping() {
    if (onCancel) {
      onCancel();
      return;
    }
    const other = modes.find((m) => m !== 'type' && !blocked?.[m]);
    if (other) setMode(other);
  }

  const tabs = (
    <div className="scan-modes" role="tablist" aria-label="How to add">
      {modes.map((id) => {
        const m = addModeSpec(id);
        const why = blocked?.[id];
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            /* ⚠️ Disabled, never absent, when the caller says this person cannot
               use it — and the sentence is rendered below at full opacity, not
               inside a control the theme dims to 45%. See `lib/add-modes.ts`. */
            disabled={why !== undefined}
            className={mode === m.id ? 'scan-mode scan-mode--on' : 'scan-mode'}
            onClick={() => setMode(m.id)}
          >
            <strong>{MODE_GLYPHS[m.glyph]}{m.label}</strong>
            <span className="muted">{m.blurb}</span>
          </button>
        );
      })}
    </div>
  );

  /* One line per refused tab: what happened, what it needs, how to get it. */
  const refusals = modes
    .map((id) => blocked?.[id])
    .filter((sentence): sentence is string => sentence !== undefined);

  /*
   * ⚠️ **The guess became a choice**, and this control is the whole of it.
   *
   * `lib/catalog-add.ts` has written `format: 'paperback'` on every scanned
   * edition since the feature existed, with a comment admitting the guess was
   * "wrong often enough to be reported from the shelf" and defensible only
   * because the Editions panel could correct it afterwards. That comment ends
   * *"if this ever stops being a one-tap correction, ask at scan time instead"*
   * — this is asking at scan time, at a cost of zero taps per book.
   *
   * ⚠️ **Not rendered on the `type` tab.** That tab is `AddWork`, which has its
   * own fields and does not go through `addLineToCatalog` at all; a control
   * there would sit above a form it cannot reach.
   *
   * ⚠️ It IS rendered on the wishlist door, where no edition is written when a
   * want attaches to a book we already hold — because the format is still kept,
   * as the `wanted as …` note on the copy (`recordArrival`). Dropping the
   * control there would silently throw away the one thing that note records.
   *
   * ⚠️ The sentence under it is not decoration. A person needs to know this
   * applies to the books they are ABOUT to add and not retroactively to the
   * ones already in the list, or the honest reading of a mid-sweep change is
   * ambiguous — and `line.addedWorkId` makes an added row unreachable anyway.
   */
  const formatToggle = (
    <div className="scan-format">
      <span className="scan-format__label" id="scan-format-label">
        Adding as
      </span>
      <div className="scan-format__opts" role="group" aria-labelledby="scan-format-label">
        {SCAN_FORMATS.map((f) => (
          <button
            key={f}
            aria-pressed={scanFormat === f}
            onClick={() => {
              setScanFormat(f);
              // Written on the tap, not on unmount: a phone that locks
              // mid-sweep is the case this whole screen is built around, and an
              // unmount handler is exactly what that does not run.
              saveScanFormat(f);
            }}
          >
            {formatLabel(f)}
          </button>
        ))}
      </div>
      <span className="muted small">
        {scanFormat === DEFAULT_SCAN_FORMAT
          ? 'Applies to books you add next. Any row can disagree, and each book’s page can fix it.'
          : 'Applies to books you add next — remembered for next time too.'}
      </span>
    </div>
  );

  const head = (
    <>
      {tabs}
      {/* The caller's own line about where this sweep is going — above the
          binding toggle, because WHERE a book lands is a bigger claim than
          which printing it is recorded as. */}
      {underTabs?.(mode)}
      {refusals.map((sentence) => (
        <p className="muted small" key={sentence}>
          {sentence}
        </p>
      ))}
      {mode !== 'type' && formatToggle}
    </>
  );

  if (mode === 'type') {
    return (
      <>
        {head}
        {/* Already a plain panel rather than a dialog, so it drops onto a screen
            unchanged. */}
        {/* ⚠️ `defaultIntent` DEFAULTS the dropdown, it does not replace it.
            The form can still say "just catalogue it — record no copy", which
            a two-state switch cannot express and which is a real answer. */}
        <AddWork
          onClose={cancelTyping}
          onAdded={() => onAdded?.('typed')}
          defaultIntent={intentFor(target)}
        />
      </>
    );
  }

  return (
    <>
      {head}

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
            format={scanFormat}
            target={target}
            onAdded={() => onAdded?.('row')}
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
    </>
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
