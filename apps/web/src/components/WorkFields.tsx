import { useState } from 'react';
import { api } from '../api.js';
import { describeError } from '../lib/errors.js';

/**
 * The four researched fields, editable where you read them.
 *
 * ## ⚠️ Why this exists at all
 *
 * It is the other half of auto-apply, and without it that feature is a
 * regression. The details queue used to ask before writing anything; it now
 * writes unread, on the owner's explicit instruction — *"I'd rather come across
 * a book with a wrong desc and fix it then, than confirm each possible item."*
 *
 * That bargain only holds if **fixing it then** is genuinely quick. Before this
 * component there was no way to edit a description in the app at all: the book
 * page rendered `work.description` as a paragraph, `PATCH /api/works/:id`
 * existed and nothing called it, and the honest cost of correcting a wrong value
 * was a `wrangler d1 execute`. Removing a gate and leaving that as the remedy
 * would have been the worst of both.
 *
 * So: open, type, save, on the page where you noticed. No modal, no separate
 * edit screen, no navigation.
 *
 * ## What it deliberately cannot reach
 *
 * `title` and `authors`. `updateWork` re-derives `work_key` from those two, and
 * `work_key` is the join to 860 audiobook reviews in the sibling catalog —
 * renaming a book here silently orphans its reviews. Same rule `applyFinding`
 * follows, and for the same reason: the patch object below names its fields
 * explicitly and cannot name `title`.
 *
 * ## ⚠️ `subtitle` IS reachable, and it is the answer to "which one is this?"
 *
 * Added 2026-08-13, and the distinction is the whole reason it is allowed where
 * `title` is not: **`work_key` derives from `title` and `authors` only.** A
 * subtitle displays under the title, says which book this is, and moves no join.
 *
 * It exists because of a real and repeating case. Board books are shelved under
 * a bare series line — three separate *Bizzy Bear* rows, a *Touch and Explore*,
 * an *I love you, little bear* — so a lookup returns the range rather than the
 * volume, and the shelf shows several identical titles. `docs/TODO.md` records
 * the fix as *"adding the subtitle, not re-running"*, and until now there was
 * nowhere to type one: the remedy was a `wrangler d1 execute`, which is exactly
 * what this component's header says it exists to avoid.
 *
 * ⚠️ **Not the same field as a series.** *Ambulance Rescue* is which Bizzy Bear
 * this is; *Bizzy Bear* is the series. Recording the subtitle in `title` would
 * move `work_key`; recording it in `series` would file one book as its own
 * series. Both were considered and both are wrong.
 *
 * ⚠️ `seriesIndexDisplay` is also absent, and that is not an oversight. It is
 * what the COVER says — "Book 2", "Volume 07", "Prequel" — while
 * `seriesIndexSort` is where it sorts. Offering them as one box would invite
 * typing "Book 2" into a numeric column. The sort value is editable here; the
 * display string stays with whatever read the cover.
 */

/** Blank means "clear it". A cleared field goes back onto the details queue. */
function orNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

export function WorkFields({
  workId,
  work,
  canEdit,
  onSaved,
}: {
  workId: number;
  work: {
    subtitle: string | null;
    /**
     * The illustrator credit (migration 0130). Editable HERE and not in
     * EditTitleAuthor, because it is a **free field**: `work_key` derives from
     * title and authors only, so correcting an illustrator moves no key and
     * must not go through that panel's ceremony.
     */
    illustrator: string | null;
    series: string | null;
    seriesIndexSort: number | null;
    firstPublished: number | null;
    description: string | null;
  };
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subtitle, setSubtitle] = useState(work.subtitle ?? '');
  const [illustrator, setIllustrator] = useState(work.illustrator ?? '');
  const [series, setSeries] = useState(work.series ?? '');
  const [index, setIndex] = useState(
    work.seriesIndexSort == null ? '' : String(work.seriesIndexSort),
  );
  const [year, setYear] = useState(work.firstPublished == null ? '' : String(work.firstPublished));
  const [description, setDescription] = useState(work.description ?? '');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  // A book with nothing recorded still needs somewhere to put it, so the panel
  // renders even when every field is blank. The old page hid the whole section
  // behind `work.description &&`, which meant the books most in need of a
  // description were the ones with nowhere to type one.
  const nothingYet =
    !work.description &&
    !work.series &&
    work.firstPublished == null &&
    !work.subtitle &&
    !work.illustrator;

  if (!canEdit) {
    return work.description ? (
      <section className="panel">
        <h3>About</h3>
        <p className="description">{work.description}</p>
      </section>
    ) : null;
  }

  const save = async () => {
    setBusy(true);
    setSaid(null);
    try {
      // ⚠️ A bad year is refused here rather than silently dropped by the
      // server's schema, which would report success and change nothing.
      const y = year.trim() === '' ? null : Number(year.trim());
      if (y != null && (!Number.isInteger(y) || y < 1000 || y > 2200)) {
        setSaid('That is not a four-digit year.');
        return;
      }
      const i = index.trim() === '' ? null : Number(index.trim());
      if (i != null && !Number.isFinite(i)) {
        setSaid('That is not a volume number. 1, 2, 2.5 — the position, not "Book 2".');
        return;
      }

      await api.updateWork(workId, {
        // ⚠️ `subtitle` and NOT `title` — see the header. This patch object is
        // the guard: `work_key` follows title and authors, so naming either here
        // would orphan the book's reviews on the audiobook side.
        subtitle: orNull(subtitle),
        // A free field, like subtitle: work_key derives from title and authors
        // only, so this never moves the review join. Migration 0130.
        illustrator: orNull(illustrator),
        series: orNull(series),
        seriesIndexSort: i,
        firstPublished: y,
        description: orNull(description),
      });
      setSaid('Saved.');
      setOpen(false);
      onSaved();
    } catch (err) {
      setSaid(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="section-head">
        <h3>About</h3>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Cancel' : work.description || !nothingYet ? 'Edit' : 'Add details'}
        </button>
      </div>

      {!open && work.description && <p className="description">{work.description}</p>}
      {!open && !work.description && (
        <p className="muted small">
          No description recorded. A lookup on the <em>what is missing</em> page will fill this
          in, or write it yourself.
        </p>
      )}

      {open && (
        <div className="stack">
          {/* First, because it is the only field here that answers "which book is
              this?" rather than describing one. A bare series line on the shelf
              is the case it exists for. */}
          <label className="field">
            <span className="field__label">Subtitle</span>
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Ambulance Rescue"
            />
            <span className="muted small">
              Which one this is, when the title is only the series line. Shown under the title.
              {/* ⚠️ Said here because the restriction looks arbitrary on screen,
                  and somebody will otherwise try to fix the title from this
                  panel and conclude the app is broken. */}{' '}
              The title itself is not editable — it is the join to your audiobook reviews.
            </span>
          </label>

          {/* Here and not in the title/author panel, because it is a FREE
              field: work_key never contains the illustrator, so correcting one
              needs no ceremony and must not be given one. On a board book it is
              often the only human credited — that is why the column exists. */}
          <label className="field">
            <span className="field__label">Illustrator</span>
            <input
              value={illustrator}
              onChange={(e) => setIllustrator(e.target.value)}
              placeholder="Shannon Hays"
            />
            <span className="muted small">
              Shown with the credits. Leave blank for a book without one — most novels — and
              nothing is shown at all.
            </span>
          </label>

          <label className="field">
            <span className="field__label">Description</span>
            <textarea
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the book is about."
            />
          </label>

          <div className="controls">
            <label className="field">
              <span className="field__label">Series</span>
              <input
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                placeholder="Cradle"
              />
            </label>
            <label className="field">
              <span className="field__label">Volume</span>
              <input
                value={index}
                onChange={(e) => setIndex(e.target.value)}
                inputMode="decimal"
                placeholder="3"
              />
            </label>
            <label className="field">
              <span className="field__label">First published</span>
              <input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
                placeholder="2016"
              />
            </label>
          </div>

          <p className="muted small">
            {/* Said out loud, because clearing a field has a second effect that
                is invisible and would otherwise be a surprise. */}
            Emptying a field clears it, and puts that question back on the{' '}
            <em>what is missing</em> list.
          </p>

          <div className="controls">
            <button className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {said && <p className="muted small">{said}</p>}
    </section>
  );
}
