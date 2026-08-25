import { useState } from 'react';
import { api } from '../api.js';
import type { CoverFindResult, Me } from '../api.js';
import type { WorkEbookHolding } from '../api.js';
import { describeError } from '../lib/errors.js';
import type { WorkDetail } from '../lib/work-view.js';
import { Accessories } from './Accessories.js';
import { Aliases } from './Aliases.js';
import { AudioSeriesLink } from './AudioSeriesLink.js';
import { Copies } from './Copies.js';
import { CoverPanel } from './CoverPanel.js';
import { EbookShadow } from './EbookShadow.js';
import { Editions, type EditionView } from './Editions.js';
import { EditTitleAuthor } from './EditTitleAuthor.js';
import { Enrich } from './Enrich.js';
import { Provenance } from './Provenance.js';
import { Related } from './Related.js';
import { WorkFields } from './WorkFields.js';
import type { CopyView } from './Copies.js';

/**
 * The ONE edit box — the redesign's replacement for eleven separate edit panels
 * scattered down the page. A single "Edit" button opens it; an **Overview** tab
 * shows every section in one scroll, and fine-control tabs jump to one at a time.
 *
 * ## Why this WRAPS the existing panels rather than rewriting them
 *
 * Every panel it contains carries a load-bearing data guard the codebase learned
 * the hard way — `Copies` must not mint a fake edition for a wish (`reportFor`,
 * `copy.edition_id` nullable); `EditTitleAuthor` guards a review-key move that
 * ~870 shared reviews hang off; `Editions` keeps the write-once provenance
 * ranking; `CoverPanel` never revisits a cover column without re-verifying. So
 * the consolidation is one of SURFACE, not of logic: the eleven panels move
 * inside one box with one entry point and one tab bar, and every guard travels
 * with its panel untouched. Rebuilding them into a single "what you have" widget
 * with new special-edition columns is a migration-bearing change and is
 * deliberately left as follow-on (see the work page's report).
 *
 * The tabs are the fine control; Overview is the "just show me everything" the
 * old page was, minus the scatter.
 */

const TABS = [
  'Overview',
  'Cover',
  'Title & author',
  'Details',
  'Editions & copies',
  'Extras',
  'Related & aliases',
  'Look it up',
] as const;
type Tab = (typeof TABS)[number];

export function EditBox({
  workId,
  work,
  me,
  editions,
  copies,
  ebookHolding,
  onChanged,
  onOpen,
  onRequestCovers,
}: {
  workId: number;
  work: WorkDetail['work'];
  me: Me;
  editions: EditionView[];
  copies: CopyView[];
  ebookHolding: WorkEbookHolding | null;
  onChanged: () => void;
  onOpen: (id: number) => void;
  /** Opens the "request more covers" scaffold (Stage 3). */
  onRequestCovers?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Overview');
  const canEdit = me.capabilities.includes('editCatalog');
  const show = (t: Tab) => tab === 'Overview' || tab === t;

  return (
    <section className="panel edit-box">
      <div className="edit-box__tabs" role="tablist" aria-label="Edit this book">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`chip${tab === t ? ' primary' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="edit-box__body">
        {show('Cover') && (
          <div className="edit-box__section">
            <CoverPanel workId={workId} work={work} canEdit={canEdit} onChanged={onChanged} />
            {canEdit && (
              <RequestCovers
                workId={workId}
                canFind={me.capabilities.includes('runResearch')}
                onChanged={onChanged}
                onRequestCovers={onRequestCovers}
              />
            )}
          </div>
        )}

        {show('Title & author') && (
          <div className="edit-box__section">
            <EditTitleAuthor workId={workId} work={work} canEdit={canEdit} onSaved={onChanged} />
          </div>
        )}

        {show('Details') && (
          <div className="edit-box__section">
            <WorkFields workId={workId} work={work} canEdit={canEdit} onSaved={onChanged} />
            {/* The audio-series equivalence sits under Details because it is keyed
                on the series set just above it. Confirming folds across the whole
                series — see AudioSeriesLink. This is the fix for a book owned on
                audio (507/508) that reads as if it is not, because its title never
                matched the per-work audiobook cache. */}
            <AudioSeriesLink series={work.series} canEdit={canEdit} onChanged={onChanged} />
          </div>
        )}

        {/* ⚠️ EDITIONS and COPIES are ONE tab (owner model, 2026-08-24, corrected):
            "Edition is all-encompassing of copies." The edition is the unit; the
            copies you hold are the nested instances INSIDE it, so editing them
            side by side in one place matches the shelf's copy-driven model rather
            than pretending they are two separate lists. Editions render first
            (the printings, plus the ebook-pool shadow that reads against them),
            then the copies you hold of them — the same order Overview shows. The
            wish guard is untouched: recording a want still mints NO edition
            (`Copies` `reportFor`, `copy.edition_id` nullable). */}
        {show('Editions & copies') && (
          <div className="edit-box__section">
            <Editions workId={workId} editions={editions} canEdit={canEdit} onChanged={onChanged} />
            <EbookShadow editions={editions} holding={ebookHolding} />
            <Copies
              workId={workId}
              copies={copies}
              editions={editions}
              canEdit={canEdit}
              canSuggest={me.capabilities.includes('suggestWishlist')}
              canListMembers={me.capabilities.includes('editCatalog')}
              onChanged={onChanged}
            />
          </div>
        )}

        {show('Extras') && (
          <div className="edit-box__section">
            <CameWith>
              <Accessories workId={workId} copies={copies} canEdit={canEdit} />
            </CameWith>
            <Provenance workId={workId} canEdit={canEdit} />
          </div>
        )}

        {show('Related & aliases') && (
          <div className="edit-box__section">
            <Aliases workId={workId} canEdit={canEdit} />
            <Related workId={workId} workTitle={work.title} canEdit={canEdit} onOpen={onOpen} />
          </div>
        )}

        {show('Look it up') && canEdit && (
          <div className="edit-box__section">
            {/* Open Library enrichment. The free path first; the paid AI rung is
                labelled inside Enrich itself. Consolidating the missing-details
                queue into this same control is follow-on (see the report). */}
            <Enrich workId={workId} hasCover={!!work.coverUrl} onApplied={onChanged} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * "Came with it" — a checkbox that reveals the extras form only when ticked, so
 * the ordinary book (which came with nothing) is not asked about plushies and
 * pins. Owner's spec. Existing extras appear once it is ticked; a household
 * managing a crowdfunded haul ticks it, and the majority of the shelf never
 * sees the form.
 */
function CameWith({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      <label className="row-tight">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        <span>This book came with extra items (plushies, pins, cards, a map…)</span>
      </label>
      {open && children}
    </div>
  );
}

/**
 * Ask for MORE covers than the catalog already knows — the known-covers grid
 * (CoverSwap) is reachable from CoverPanel's "Choose from known covers"; this is
 * the entry point for the paid web search (`findCover`) when the free rungs have
 * nothing.
 *
 * ## ⚠️ The find button spends money, so two things gate it
 *
 * 1. **Capability.** Only shown when the person has `runResearch` — the same
 *    owner/admin/moderator gate the route enforces. An `editCatalog` reader still
 *    sees the "known covers" pointer, just not the paid button.
 * 2. **A confirm before every search.** ~6¢ a run, and the owner asked for the
 *    money-spend to be deliberate. The result is a PROPOSAL: nothing is stored
 *    until "Use this cover" (a free, re-verified `setCover`).
 */
function RequestCovers({
  workId,
  canFind,
  onChanged,
  onRequestCovers,
}: {
  workId: number;
  canFind: boolean;
  onChanged: () => void;
  onRequestCovers?: () => void;
}) {
  const [noted, setNoted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CoverFindResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  async function find() {
    // The confirm IS the money gate — each search costs ~6¢ and the owner asked
    // for the spend to be a deliberate act, not a stray click.
    if (
      !window.confirm(
        'Run a paid web search for a new cover? This asks Claude to search the web ' +
          '(about 6¢ per book) and can take up to a minute and a half. Nothing is saved ' +
          'until you pick the result.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setApplied(false);
    try {
      setResult(await api.findCover(workId));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function useIt(url: string) {
    setBusy(true);
    setError(null);
    try {
      await api.setCover(workId, { url, status: 'ok' });
      setApplied(true);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack request-scaffold">
      <div className="row-tight">
        <button
          onClick={() => {
            setNoted(true);
            onRequestCovers?.();
          }}
        >
          Choose from known covers
        </button>
        {canFind && (
          <button className="primary" onClick={find} disabled={busy}>
            {busy ? 'Searching…' : 'Search the web for a cover'}
          </button>
        )}
      </div>

      {noted && (
        <p className="muted small">
          Use <b>Choose from known covers</b> above to pick from covers the catalog already knows.
        </p>
      )}

      {canFind && !busy && !result && !error && (
        <p className="muted small">
          The web search is the last resort for books the free cover sources cannot supply — it
          spends money (~6¢) and asks before each run.
        </p>
      )}

      {error && <p className="notice notice--bad">Cover search failed: {error}</p>}

      {result && !result.proposal.found && (
        <p className="muted small">
          The search did not find a cover for this book. That is a normal answer for the titles that
          reach this step — a wrong cover would be worse than none.
        </p>
      )}

      {result && result.proposal.found && result.proposal.url && (
        <div className="stack">
          <div className="row-tight" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
            <img
              src={result.proposal.url}
              alt="Proposed cover"
              style={{ maxWidth: '96px', maxHeight: '140px', border: '1px solid var(--et-hairline)' }}
            />
            <div className="stack" style={{ gap: '0.25rem' }}>
              <p className="small">
                {result.verified ? (
                  <b>Found a cover.</b>
                ) : (
                  <b>Found a candidate, but its link would not load.</b>
                )}{' '}
                {result.proposal.confidence === 'low' && (
                  <span className="muted">The search is unsure this is the right book. </span>
                )}
                {result.proposal.note}
              </p>
              {result.proposal.source && (
                <p className="muted small">Source: {result.proposal.source}</p>
              )}
              {!result.verified && result.verifyReason && (
                <p className="muted small">Why it can’t be used: {result.verifyReason}</p>
              )}
              {applied ? (
                <p className="small">Saved as this book’s cover.</p>
              ) : (
                result.verified && (
                  <div className="row-tight">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => useIt(result.proposal.url as string)}
                    >
                      {busy ? 'Saving…' : 'Use this cover'}
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
