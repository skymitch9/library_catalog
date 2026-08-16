import { useCallback, useEffect, useState } from 'react';
import { pledgeItemMedium, rewardFlags, type Medium } from '@lc/core';
import { api, type Provenance as ProvenanceRow } from '../api.js';
import { describeError } from '../lib/errors.js';
import { formatLabel } from '../lib/formats.js';

/**
 * Where this book came from, when it did not come from a shop.
 *
 * ## ⚠️ Two rows for one book is CORRECT — do not collapse them
 *
 * *"Kickstarter stuff generally has a mix of physical and digital books so make
 * sure when youre auditing you're really looking close."* — the owner,
 * 2026-08-10. One pledge routinely delivers a deluxe hardcover **and** an EPUB of
 * the same novel, and migration 0010 stores those as two `pledge_item` rows so
 * neither disappears. This panel renders them as two lines for the same reason: a
 * summary saying "from the Kickstarter" would hide exactly the fact the owner
 * asked to be able to check.
 *
 * ## The medium beside each line, and where it comes from
 *
 * `pledgeItemMedium` in `@lc/core` — the same function the audit and the import
 * script use, so a line the script called physical cannot read as digital here.
 * Four answers, and two of them are jobs:
 *
 * | | |
 * |---|---|
 * | physical / digital | settled, from `edition.format` or the campaign's own words |
 * | **both** | one reward line naming a hardcover *and* an ebook — somebody has to split it into two |
 * | **unknown** | nothing could classify it. Go and look at the campaign page. |
 *
 * ⚠️ There is deliberately no fifth rung guessing from the tier or the amount
 * paid. `isbn-ladder.md` §4.4: a wrong answer scored 1.00 on title and author,
 * twice. An `unknown` sends a person to look; a confident guess sends nobody.
 *
 * ## What this panel does NOT do
 *
 * It shows no money. `amount_cents` never leaves the owner-gated
 * `/api/crowdfunding` routes. Recording a pledge is done by
 * `npm run import:crowdfunding`, not by hand here — the scan is the source, and a
 * form that could mint a campaign row beside an imported one is how the two get
 * out of step. Unlinking a wrong line is offered, because a scan makes mistakes.
 */

const PLATFORM_LABEL: Record<string, string> = {
  kickstarter: 'Kickstarter',
  backerkit: 'BackerKit',
  indiegogo: 'Indiegogo',
};

const MEDIUM_LABEL: Record<Medium, string> = {
  physical: 'physical',
  digital: 'digital',
  both: 'needs splitting',
  unknown: 'unclassified',
};

const STATUS_LABEL: Record<string, string> = {
  pledged: 'Pledged',
  delivered: 'Delivered',
  partial: 'Partly delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

function mediumOf(row: ProvenanceRow): Medium {
  return pledgeItemMedium({
    format: row.format,
    formatHint: row.formatHint,
    title: row.title,
  });
}

export function Provenance({ workId, canEdit }: { workId: number; canEdit: boolean }) {
  const [rows, setRows] = useState<ProvenanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      .provenance(workId)
      .then((r) => setRows(r.provenance))
      .catch((err: unknown) => setError(describeError(err)));
  }, [workId]);

  useEffect(load, [load]);

  async function unlink(itemId: number) {
    setBusy(itemId);
    setError(null);
    try {
      await api.deletePledgeItem(itemId);
      setArmed(null);
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  // ⚠️ Silent when there is nothing to say. Almost every book in this catalog
  // came from a shop or a file, and an empty "Where it came from" panel on 120
  // pages is noise — the rule the Related and Aliases panels already follow, and
  // stricter here because there is no add form to justify the empty state.
  if (!rows || rows.length === 0) return null;

  return (
    <section className="panel">
      <h3>Where it came from</h3>

      <ul className="plain">
        {rows.map((r) => {
          const medium = mediumOf(r);
          const flags = rewardFlags([r.title, r.formatHint].filter(Boolean).join(' '));
          return (
            <li key={r.itemId}>
              <div className="row-tight">
                <span className={`mark mark--medium mark--medium-${medium}`}>
                  {MEDIUM_LABEL[medium]}
                </span>
                <strong>
                  {r.format ? formatLabel(r.format) : (r.formatHint ?? r.title ?? 'One reward')}
                </strong>
                {/* The campaign page is the only authoritative record a pledge
                    ever had — the sibling project's migration 0012 says so, and
                    it is truer for books, half of which are absent from Open
                    Library altogether. */}
                {r.campaignUrl ? (
                  <a href={r.campaignUrl} target="_blank" rel="noreferrer noopener">
                    {r.campaignName} ↗
                  </a>
                ) : (
                  <span>{r.campaignName}</span>
                )}
                <span className="muted small">
                  {[
                    PLATFORM_LABEL[r.pledgePlatform] ?? r.pledgePlatform,
                    r.account,
                    r.tier,
                    r.pledgedOn,
                    STATUS_LABEL[r.status] ?? r.status,
                    r.quantity > 1 ? `× ${r.quantity}` : null,
                    r.fulfilled ? 'arrived' : 'not yet arrived',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {/* ⚠️ Kept on screen even once the edition is matched: it is the
                    evidence for the match, and the only thing re-readable when a
                    match turns out to be wrong. */}
                {r.format && r.formatHint && (
                  <span className="muted small">campaign said “{r.formatHint}”</span>
                )}
                {/* ⚠️ Three different states, and only one of them is a job.
                    An audiobook reward carries `editionVerdict: 'none'` — no
                    printing CAN exist for it, because `EDITION_FORMATS` has no
                    audiobook value and never will. Rendering that as "not
                    matched yet" would put a permanent item on a to-do list. */}
                {r.editionId == null && r.editionVerdict === 'none' && (
                  <span className="muted small">no printing to match — nothing to do</span>
                )}
                {r.editionId == null && r.editionVerdict === 'unknown' && (
                  <span className="muted small">printing unknown — looked, and could not tell</span>
                )}
                {r.editionId == null && r.editionVerdict == null && (
                  <span className="muted small">no printing matched yet</span>
                )}
                {/* Signed and numbered are never a field on a campaign page —
                    they are prose in the reward title. Surfaced as a prompt, not
                    written: `copy.is_signed` is where the answer belongs and a
                    person ticks it. */}
                {flags.signed && (
                  <span className="muted small">
                    reward says signed{flags.numbered ? ' and numbered' : ''} — record it on the copy
                  </span>
                )}
                {r.notes && <span className="muted small">{r.notes}</span>}

                {canEdit &&
                  (armed === r.itemId ? (
                    <>
                      <button
                        className="chip"
                        disabled={busy === r.itemId}
                        onClick={() => void unlink(r.itemId)}
                      >
                        Really unlink?
                      </button>
                      <button className="chip" onClick={() => setArmed(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="chip"
                      disabled={busy === r.itemId}
                      onClick={() => setArmed(r.itemId)}
                      aria-label="Unlink this reward from this book"
                    >
                      Unlink
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>

      {error && <p className="notice notice--bad small">{error}</p>}
    </section>
  );
}
