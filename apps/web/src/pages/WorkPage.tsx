import { useEffect, useRef, useState } from 'react';
import { api, type Me } from '../api.js';
import { describeError } from '../lib/errors.js';
import { Changes } from '../components/Changes.js';
import { ContentNotes } from '../components/ContentNotes.js';
import { Cover } from '../components/Cover.js';
import { DeleteWork } from '../components/DeleteWork.js';
import { DriveLinks } from '../components/DriveLinks.js';
import { EditBox } from '../components/EditBox.js';
import { OnYourShelf } from '../components/OnYourShelf.js';
import { OtherVersions } from '../components/OtherVersions.js';
import { PeerLibraries } from '../components/PeerLibraries.js';
import { Reviews } from '../components/Reviews.js';
import { Tbr } from '../components/Tbr.js';
import { Watches } from '../components/Watches.js';
import { deriveWorkView, type WorkDetail } from '../lib/work-view.js';
import { Link, universePath, workPath } from '../router.js';

/**
 * One book: what it is, what we thought of it, what we have, and where else to
 * get it.
 *
 * ## The redesigned order (2026-08-24)
 *
 * The page used to be twenty stacked panels in schema order (work → edition →
 * copy → …), with eleven separate edit surfaces and the ratings buried at #18.
 * It is now built around the questions a person actually opens a book page to
 * ask, in that order:
 *
 *   1. **Identity** — the cover (clickable), title, author, series, universe,
 *      and one **Edit** button, not eleven.
 *   2. **Ratings & reviews** — hoisted to right under the identity.
 *   3. **On your shelf** — one hero holding (the format, big, with the
 *      special-edition badges) and an availability row: also on audio? as an
 *      ebook? at a peer library? (`OnYourShelf` / `deriveShelfView`).
 *   4. **Your reading**, then **content warnings**, then a demoted **More**
 *      cluster for the detailed record.
 *
 * The eleven edit panels are consolidated into one `EditBox` (Overview + tabs)
 * behind the single Edit button. Each panel keeps its own data guard — the split
 * is one of surface, not of logic; see `EditBox`'s header.
 *
 * ⚠️ **The `/api/works/:id` response contract is unchanged.** `deriveWorkView`
 * reads exactly the same `detail.<field>` set it did before, so the worker
 * contract test (`work-detail-contract.test.ts`) and the render smoke test
 * (`work-page-render.test.ts`) are untouched by this reorg.
 */

// ⚠️ `WorkDetail` — the shape of the `/api/works/:id` response — now lives in
// `../lib/work-view.ts`, beside `deriveWorkView`, so the worker's contract test
// can read the exact fields this page consumes. Moved 2026-08-24 with the
// outage guards; the render-critical `editions.find(...)` moved with it.

/**
 * The book's number — `#269` — the identifier this household actually uses in
 * conversation and queries, which until now existed only in the URL.
 *
 * ⚠️ Its entire purpose is being quoted somewhere else, so it must be EASY TO
 * TAKE: a click copies it, and the markup is a real text node with
 * `user-select: all` (one tap selects the whole token), never a `::before`
 * that cannot be highlighted. `<code role="button">` rather than `<button>`,
 * because several browsers make button text unselectable and the selection is
 * the fallback when the clipboard API is unavailable.
 *
 * Visually quiet on purpose — small, muted, monospace, above the title. It is
 * a catalog number, not a rival heading.
 */
function WorkIdTag({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);
  const tag = `#${id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tag);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be refused (permissions, non-secure context). Say
      // nothing: the click also selected the text, so Ctrl+C still works.
    }
  };
  return (
    <p className="work-id-row">
      <code
        className="work-id"
        role="button"
        tabIndex={0}
        title="Book number — click to copy"
        aria-label={`Book number ${id} — click to copy`}
        onClick={() => void copy()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void copy();
          }
        }}
      >
        {tag}
      </code>
      {/* aria-live so a screen reader hears the confirmation it cannot see. */}
      <span className="muted small work-id__said" aria-live="polite">
        {copied ? 'copied' : ''}
      </span>
    </p>
  );
}

const READ_STATES = [
  ['unread', 'Unread'],
  ['reading', 'Reading'],
  ['read', 'Read'],
  ['dnf', 'Did not finish'],
  ['reference', 'Reference'],
] as const;

export function WorkPage({
  workId,
  me,
  onBack,
  backLabel,
  onOpen,
  onOpenSeries,
}: {
  workId: number;
  me: Me;
  onBack: () => void;
  /** Where back goes. A book opened from a series ladder returns to it. */
  backLabel: string;
  /** Follow a link to another book — the related-books panel needs it. */
  onOpen: (id: number) => void;
  onOpenSeries: (name: string) => void;
}) {
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The one edit box, opened by the one Edit button. */
  const [editOpen, setEditOpen] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  function load() {
    api
      .work(workId)
      .then((d) => setDetail(d as unknown as WorkDetail))
      .catch((err: unknown) => setError(describeError(err)));
  }

  useEffect(() => {
    setDetail(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  async function setReadState(state: string) {
    if (!detail) return;
    // A PUT replaces the whole read-state, so the dates have to travel with it —
    // sending only `readState` silently clears them, which is the schema's
    // documented behaviour and easy to get wrong here.
    await api.setReading(workId, {
      readState: state,
      startedOn: detail.reading?.started_on ?? null,
      finishedOn:
        state === 'read' && !detail.reading?.finished_on
          ? new Date().toISOString().slice(0, 10)
          : (detail.reading?.finished_on ?? null),
      readFormat: detail.reading?.read_format ?? null,
    });
    load();
  }

  if (error) return <main>Could not load that book: {error}</main>;
  if (!detail) return <main className="muted">Loading…</main>;

  // ⚠️ Every field the page renders is read out of the response HERE, in one
  // firebase-free helper, so it can be exercised without a DOM — see
  // `../lib/work-view.ts`. `fileEdition` is the `editions.find(...)` the
  // 2026-08-24 outage crashed on; it lives behind `deriveWorkView` and its
  // render smoke-test now.
  const {
    work,
    editions,
    copies,
    reading,
    watches,
    fileEdition,
    showDrive,
    canTrack,
    audioEditions,
    audioEditionCount,
    peerHoldings,
    audiobookHolding,
    ebookHolding,
    universe,
  } = deriveWorkView(detail, me);

  const canEdit = me.capabilities.includes('editCatalog');

  function openEdit() {
    setEditOpen(true);
    // Let the box mount, then bring it into view.
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  // Closing the focused editor restores every section AND makes sure the identity
  // card (title / author / description) reflects any saved edits immediately.
  // `onChanged={load}` already refreshes `detail` on each save while editing; the
  // extra `load()` here covers a close made right after an edit, so the restored
  // page is never a beat stale (owner 2026-08-24).
  function closeEdit() {
    setEditOpen(false);
    load();
  }

  return (
    <main className="book-detail">
      <button className="back" onClick={onBack}>
        ← {backLabel}
      </button>

      {/* 1 — IDENTITY. The mockup's "beautiful top bar": a big 2/3 cover on the
          left (gradient placeholder when there is no art), the title in the
          Fraunces display serif with an italic subtitle and byline, a row of
          metadata chips (series / universe / first published), and one Edit
          button — not eleven. The cover is a real link to the work (the owner's
          ask to make covers clickable everywhere they render). */}
      <div className="panel">
        <div className="bd-identity">
          <div className="bd-cover">
            <Cover
              src={work.coverUrl}
              title={work.title}
              authors={work.authors ?? undefined}
              size="large"
              to={workPath(work.id)}
            />
          </div>
          <div className="bd-id-main">
            {/* Above the title rather than beside it: it must be near the title
                (the owner's ask) without competing with it, and a corner
                placement collides with the title's wrap on a phone. */}
            <WorkIdTag id={work.id} />
            <h1 className="bd-title">{work.title}</h1>
            {work.subtitle && <p className="bd-subtitle">{work.subtitle}</p>}
            {/* An authorless book says so in words, here where the byline would
                be — the one place its absence would otherwise read as a broken
                page rather than a recorded fact. */}
            <p className="bd-byline">
              {work.authors ? (
                <>
                  by <b>{work.authors}</b>
                </>
              ) : (
                <span className="muted">Author not recorded yet</span>
              )}
            </p>
            {work.illustrator && (
              <p className="bd-illustrator">Illustrated by {work.illustrator}</p>
            )}

            {/* Metadata as chips — series (opens the ladder), universe (opens the
                universe page), first published. The same data the old stacked
                <p> tags carried, now the mockup's `.metagrid`. */}
            {(work.series || universe || work.firstPublished) && (
              <div className="bd-metagrid">
                {universe && (
                  <Link
                    to={universePath(universe)}
                    className="bd-chip bd-chip--uni"
                    title={`Everything this catalog holds from ${universe}`}
                  >
                    ✦ {universe}
                  </Link>
                )}
                {work.series && (
                  <button
                    type="button"
                    className="bd-chip"
                    onClick={() => onOpenSeries(work.series!)}
                    title={`Open the ${work.series} series`}
                  >
                    {work.series}
                    {work.seriesIndexDisplay ? (
                      <b>&nbsp;{work.seriesIndexDisplay}</b>
                    ) : null}
                  </button>
                )}
                {work.firstPublished && (
                  <span className="bd-chip">
                    First published <span className="mono">{work.firstPublished}</span>
                  </span>
                )}
              </div>
            )}

            {/* The description as read-only primary content, right in the head —
                the reading-decision text a person opens the page for. Editing it
                lives in the Edit box (WorkFields); this is its view. */}
            {work.description && <p className="bd-desc">{work.description}</p>}
            {/* ⚠️ Not shown for a book that only exists on paper — it is on a
                shelf, and there is no file to open. `shouldShowDriveLinks`
                carries the rule and, more importantly, why an ISBN is not part
                of it. */}
            {showDrive && (
              <DriveLinks
                title={work.title}
                authors={work.authors ?? ''}
                sourceUrl={fileEdition?.source_url ?? null}
              />
            )}
            {/* THE one Edit button, replacing the eleven scattered edit panels. */}
            <div className="row-tight bd-actions">
              <button
                className={editOpen ? 'chip' : 'chip primary'}
                onClick={editOpen ? closeEdit : openEdit}
              >
                {editOpen ? '✕ Close editor' : canEdit ? '✎ Edit this book' : 'Book details'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* THE ONE EDIT BOX — Overview + tabs, all eleven former panels inside,
          each with its guard intact. Opened by the single Edit button above.

          ⚠️ When it is open the page becomes a FOCUSED FULL-SCREEN EDITOR (owner
          2026-08-24): only the identity card above and this editor remain —
          Ratings & reviews, On your shelf, Your reading, Content warnings and the
          Record Control cluster are all hidden below on `!editOpen`. The editor
          opens right where Ratings & reviews normally sits and extends down. */}
      {editOpen && (
        <div ref={editRef}>
          <EditBox
            workId={workId}
            work={work}
            me={me}
            editions={editions}
            copies={copies}
            ebookHolding={ebookHolding}
            onChanged={load}
            onOpen={onOpen}
          />
        </div>
      )}

      {/* Everything from here down is hidden while the editor is open, so the
          edit view is exactly identity card + editor. On close `closeEdit`
          reloads the record and these sections return with fresh data. */}
      {!editOpen && (
        <>
      {/* 2 — RATINGS & REVIEWS, hoisted to right under the identity (it used to
          be #18 of 20). Reviews is still the only thing here that can see
          Firestore, so `onReadStateDerived` still reloads the reading panel when
          a rating implies a read state. Its browser-side write path is unchanged. */}
      <Reviews workId={workId} me={me} onReadStateDerived={load} />

      {/* 3 — ON YOUR SHELF: one hero holding (format big + special-edition
          badges) and the availability row (also on audio? as an ebook? at a
          peer?). A summary of the detailed panels in the More cluster below;
          `deriveShelfView` feeds both so they cannot disagree. */}
      <OnYourShelf
        title={work.title}
        copies={copies}
        editions={editions}
        audiobookHolding={audiobookHolding}
        audioEditions={audioEditions}
        audioEditionCount={audioEditionCount}
        ebookHolding={ebookHolding}
        peerHoldings={peerHoldings}
      />

      {/* 4 — YOUR READING. */}
      {canTrack && (
        <section className="panel">
          <h3>Your reading</h3>
          <div className="row-tight" role="group" aria-label="Read state">
            {READ_STATES.map(([value, label]) => (
              <button
                key={value}
                className={reading?.read_state === value ? 'primary chip' : 'chip'}
                aria-pressed={reading?.read_state === value}
                onClick={() => void setReadState(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {reading?.finished_on && (
            <p className="muted small">
              Finished {reading.finished_on}
              {reading.read_format ? ` (${reading.read_format})` : ''}
            </p>
          )}
          {reading?.read_state_how === 'rating' && (
            <p className="muted small">
              Marked read from your{' '}
              {reading.read_format === 'audio' ? 'audiobook rating' : 'rating'} — change it
              above and it stays changed.
            </p>
          )}
          <Tbr workId={workId} readState={reading?.read_state ?? null} />
        </section>
      )}

      {/* CONTENT WARNINGS — read BEFORE the book, so above the demoted detail.
          The "Request content warnings" button is a Stage-3 scaffold: the
          propagate-to-matching-titles + dedup backend is follow-on. */}
      <ContentNotes workId={workId} me={me} />
      <RequestContentWarnings canEdit={canEdit} />

      {/* WARNING: RECORD CONTROL — the record-management drawer, collapsed by
          default. Renamed + recoloured danger-red (owner 2026-08-24): it holds the
          "flag this record" watch and the delete control, so it reads as a warning,
          not "more info". */}
      <details className="more-cluster more-cluster--danger">
        <summary>⚠️ Warning: Record Control</summary>

        {/* A watch says "what you just read may be wrong" — moved in here from up
            top (owner 2026-08-24) as a record-control action. */}
        <Watches workId={workId} watches={watches} canEdit={canEdit} onChanged={load} />

        {/* The audiobook detail — narrator, provenance, staleness — the rows the
            "Also on audio" chip summarises. */}
        <OtherVersions
          holding={audiobookHolding}
          editions={audioEditions}
          audioEditionCount={audioEditionCount}
          ourSeries={work.series}
        />

        <PeerLibraries holdings={peerHoldings} />

        {/* The record OF the page — who changed what, when, and what it said
            before. Loads on demand. */}
        <Changes workId={workId} />

        {/* The one control whose accidental press matters most — moved in here
            (owner 2026-08-24). Refused by the server while any copy records
            property; the panel's header comment carries the #139 story. */}
        <DeleteWork workId={workId} canEdit={canEdit} onDeleted={onBack} />
      </details>
        </>
      )}
    </main>
  );
}

/**
 * "Request content warnings" — Stage-3 scaffold. The button is real; the backend
 * that would propagate a request to every matching title and dedup it is a
 * deliberate follow-on (see `docs/info/content-warnings.md` and the redesign
 * brief). It says so rather than pretending to queue work that nothing consumes.
 */
function RequestContentWarnings({ canEdit }: { canEdit: boolean }) {
  const [asked, setAsked] = useState(false);
  if (!canEdit) return null;
  return (
    <div className="stack request-scaffold">
      <div className="row-tight">
        <button onClick={() => setAsked(true)}>Request content warnings</button>
      </div>
      {asked && (
        <p className="muted small">
          Noted. Automatically gathering content warnings and propagating them to matching titles is
          designed but not yet built — for now, add them by hand above. See
          <code> docs/info/content-warnings.md</code>.
        </p>
      )}
    </div>
  );
}
