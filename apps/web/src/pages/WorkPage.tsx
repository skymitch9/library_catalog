import { useEffect, useState } from 'react';
import { api, type Me, type Watch } from '../api.js';
import { Accessories } from '../components/Accessories.js';
import { Aliases } from '../components/Aliases.js';
import { Copies, type CopyView } from '../components/Copies.js';
import { Cover } from '../components/Cover.js';
import { CoverPanel } from '../components/CoverPanel.js';
import { DriveLinks } from '../components/DriveLinks.js';
import { Editions, type EditionView } from '../components/Editions.js';
import { Enrich } from '../components/Enrich.js';
import { Provenance } from '../components/Provenance.js';
import { Related } from '../components/Related.js';
import { Reviews } from '../components/Reviews.js';
import { Watches } from '../components/Watches.js';
import { WorkFields } from '../components/WorkFields.js';
import { formatLabel, shouldShowDriveLinks } from '../lib/formats.js';

/**
 * One book: what it is, where the file is, which printings we hold, and what we
 * thought.
 *
 * The three catalog sections mirror the schema's three layers deliberately —
 * work / edition / copy — because that split is the thing a person has to
 * understand to use this app correctly. "I own the paperback but not the ebook"
 * is only answerable if the page shows editions and copies as different things.
 *
 * The Drive links sit directly under the title, above all of that, because for
 * this collection they are the *action*: 118 of 118 editions are ebook files,
 * and what you almost always want from a book page is the book.
 */

interface WorkDetail {
  work: {
    id: number;
    title: string;
    subtitle: string | null;
    authors: string;
    series: string | null;
    seriesIndexDisplay: string | null;
    /** Where it sorts. `seriesIndexDisplay` is what the cover says; see WorkFields. */
    seriesIndexSort: number | null;
    firstPublished: number | null;
    description: string | null;
    coverUrl: string | null;
    /** 'ok' | 'standin' | null. ⚠️ null is "nobody has looked", not "fine". */
    coverStatus: 'ok' | 'standin' | null;
    workKey: string;
  };
  editions: EditionView[];
  copies: CopyView[];
  /** Open and resolved both — see `listWatchesForWork`. Rides along with the work. */
  watches: Watch[];
  reading: {
    read_state: string;
    started_on: string | null;
    finished_on: string | null;
    read_format: string | null;
    /**
     * `'human' | 'rating' | null`. Migration 0070.
     *
     * ⚠️ NULL is "unrecorded", not "asserted" — the same reading as
     * `cover_status`. Only a positive `'rating'` may be labelled as derived;
     * captioning a NULL row would put a claim on screen that nothing observed.
     */
    read_state_how: string | null;
  } | null;
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

  function load() {
    api
      .work(workId)
      .then((d) => setDetail(d as unknown as WorkDetail))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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

  const { work, editions, copies, reading } = detail;
  const watches = detail.watches ?? [];
  const canTrack = me.capabilities.includes('trackReading');
  // The first edition that names a file. Whichever format it is, its name is the
  // best search term Drive will ever get for this book.
  const fileEdition = editions.find((e) => e.source_url) ?? null;
  const showDrive = shouldShowDriveLinks(editions);

  return (
    <main>
      <button className="back" onClick={onBack}>
        ← {backLabel}
      </button>

      <div className="work-head">
        <Cover src={work.coverUrl} title={work.title} authors={work.authors} size="large" />
        <div className="work-head__text">
          <h2>{work.title}</h2>
          {work.subtitle && <p className="muted">{work.subtitle}</p>}
          <p className="work-head__authors">{work.authors}</p>
          {work.series && (
            <p className="series-tag">
              {/* A way into "what am I missing" from the book that prompted the
                  question, which is where it is actually asked. */}
              <button className="link series-tag__link" onClick={() => onOpenSeries(work.series!)}>
                {work.series}
                {work.seriesIndexDisplay ? <b> {work.seriesIndexDisplay}</b> : null}
              </button>
            </p>
          )}
          {work.firstPublished && <p className="muted small">First published {work.firstPublished}</p>}
          {/* ⚠️ Not shown for a book that only exists on paper — it is on a
              shelf, and there is no file to open. `shouldShowDriveLinks` carries
              the rule and, more importantly, why an ISBN is not part of it. */}
          {showDrive && (
            <DriveLinks
              title={work.title}
              authors={work.authors}
              sourceUrl={fileEdition?.source_url ?? null}
            />
          )}
        </div>
      </div>

      {/* ⚠️ Editable in place, and that is load-bearing rather than a nicety.
          The details queue now writes these four fields without asking — see
          `components/WorkFields.tsx` and `lib/research-run.ts`. The owner traded
          confirming each value for correcting a wrong one when they meet it, so
          meeting it has to lead somewhere. Until this, it did not: the page
          printed the description and the app had no way to change it. */}
      {/* ⚠️ Directly under the head, above every other panel, and that
          placement is the point of both of them. They are the two things that
          say "what you just read may be wrong" — a cover that is a stand-in,
          and a note somebody left about the record. Put below the editions and
          the copies they would be found by somebody who had already believed
          the page. */}
      <Watches
        workId={workId}
        watches={watches}
        canEdit={me.capabilities.includes('editCatalog')}
        onChanged={load}
      />

      <CoverPanel
        workId={workId}
        work={work}
        canEdit={me.capabilities.includes('editCatalog')}
        onChanged={load}
      />

      <WorkFields
        workId={workId}
        work={work}
        canEdit={me.capabilities.includes('editCatalog')}
        onSaved={load}
      />

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
          {/* ⚠️ Says where the answer came from, and says it plainly, because
              nobody set this state by hand and a page that implies they did is
              lying to them. Pressing any chip above replaces it with 'human'
              and this line disappears — which is also the undo: a rating never
              overrules a person. Only a positive 'rating' is captioned; NULL
              means unrecorded and must stay silent. */}
          {reading?.read_state_how === 'rating' && (
            <p className="muted small">
              Marked read from your{' '}
              {reading.read_format === 'audio' ? 'audiobook rating' : 'rating'} — change it
              above and it stays changed.
            </p>
          )}
        </section>
      )}

      <Editions
        editions={editions}
        canEdit={me.capabilities.includes('editCatalog')}
        onChanged={load}
      />

      <Copies
        workId={workId}
        copies={copies}
        editions={editions}
        canEdit={me.capabilities.includes('editCatalog')}
        onChanged={load}
      />

      {/* Directly under Copies, because an accessory belongs to a copy — a
          plushie arrived in a specific box, not with the novel as an idea. See
          migration 0011 and the panel's own header.

          ⚠️ This is the ONLY place accessories are shown. The owner asked for the
          count to stay off the collection page, and nothing on that page (or in
          `/api/collection`, or `collectionStats`) knows the table exists. */}
      <Accessories
        workId={workId}
        copies={copies}
        canEdit={me.capabilities.includes('editCatalog')}
      />

      {/* Where it came from, when it did not come from a shop. Below the copies
          and the extras because it explains both of them — and it renders one
          line per reward, so a campaign that delivered a hardcover AND an EPUB of
          this novel shows two. That pair is the thing the owner asked to be able
          to check; a panel that summarised it away would defeat the feature. */}
      <Provenance workId={workId} canEdit={me.capabilities.includes('editCatalog')} />

      {/* Above Related and below Copies deliberately: an alias is a fact about
          THIS book's identity, like its editions, whereas a relation points at a
          different row. It also sits directly above Enrich, which is the panel
          an alias exists to unblock — add the pen name, then ask Open Library
          again. */}
      <Aliases workId={workId} canEdit={me.capabilities.includes('editCatalog')} />

      <Related
        workId={workId}
        workTitle={work.title}
        canEdit={me.capabilities.includes('editCatalog')}
        onOpen={onOpen}
      />

      {me.capabilities.includes('editCatalog') && (
        <Enrich workId={workId} hasCover={!!work.coverUrl} onApplied={load} />
      )}

      {/* ⚠️ `onReadStateDerived` is not optional wiring. Reviews is the only
          thing here that can see Firestore, so it is where "you rated this, so
          you read it" is discovered — and when it fires, the "Your reading"
          panel above is already on screen showing the stale answer. Reloading
          is what stops the page contradicting itself. It fires only when
          something actually changed, so there is no loop. */}
      <Reviews workId={workId} me={me} onReadStateDerived={load} />
    </main>
  );
}
