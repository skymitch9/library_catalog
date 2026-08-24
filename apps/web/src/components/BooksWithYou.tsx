import { useEffect, useState } from 'react';
import { api, type LinkedCopy } from '../api.js';
import { Link, workPath } from '../router.js';
import { Cover } from './Cover.js';

/**
 * "Books with you" — the copies of this house's that are linked to whoever is
 * signed in.
 *
 * Owner decision #2, 2026-08-23: *"The linked member sees, on THEIR own page,
 * 'you have <owner>'s copy of <title>'."* This is the other half of the
 * redaction rule in `apps/worker/src/lib/copy-person.ts` — a member cannot see
 * who has what, but they can always see what they themselves have.
 *
 * ## ⚠️ It renders NOTHING when there is nothing
 *
 * Which is almost everybody, almost always. A heading over an empty list would
 * put a permanent, permanently-empty section on the one screen that is about a
 * person rather than about the shelf — the same argument the collection page
 * makes for `universe: null` and the nav makes for a zero chore count. It also
 * renders nothing while loading and nothing on failure: this section is a
 * courtesy beside somebody's reading list, and a red box about a request they
 * did not make would be worse than its absence. The book pages are the
 * authority; nothing here is the only record of anything.
 *
 * ## Three statuses, three sentences
 *
 * ⚠️ `lent` and `borrowed` are OPPOSITE claims about who owns the book and one
 * of them does not belong under a heading that says "with you" — a copy this
 * house `borrowed` from you is with *us*. Rather than filter it out (leaving a
 * member wondering where their book went) each is said plainly, in its own
 * direction. `sold` is included for the same reason it is kept in the
 * database at all: it is a record, and the person it was sold to is the one
 * other person entitled to see it.
 */
export function BooksWithYou() {
  const [rows, setRows] = useState<LinkedCopy[] | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .copiesWithMe()
      .then((r) => {
        if (live) setRows(r.copies);
      })
      // Silence is the correct answer here — see the header. The book's own
      // page is where this fact is authoritative.
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <section className="panel">
      <h3>Books with you</h3>
      <p className="muted small">
        Copies from this catalog that are recorded against your account. If one of
        these is wrong, whoever looks after the catalog can change it on the
        book&rsquo;s own page.
      </p>
      <ul className="works">
        {rows.map((row) => (
          <li key={row.copyId}>
            <div className="wish">
              <Link
                to={workPath(row.workId)}
                className="wish__book"
                aria-label={`Open ${row.title}`}
              >
                <Cover src={row.coverUrl} title={row.title} size="row" />
                <span className="row-open__text">
                  <span className="row-open__head">
                    <strong>{row.title}</strong>
                  </span>
                  {row.authors && <span className="muted small">{row.authors}</span>}
                  <span className="muted small">{saidFor(row)}</span>
                </span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What this row means, as a sentence somebody would say out loud.
 *
 * ⚠️ **Never a bare status word.** "Borrowed" on its own is ambiguous in
 * exactly the way that matters — borrowed by whom, from whom — and this list is
 * read by the person on the other end of the transaction, for whom the
 * catalog's point of view is the wrong way round. Each string is written from
 * the READER's side.
 *
 * The date is only added when there is one; `acquired_on` is frequently NULL on
 * a lend and "since null" is worse than no date.
 */
function saidFor(row: LinkedCopy): string {
  const since = row.acquiredOn ? ` · ${row.acquiredOn}` : '';
  switch (row.status) {
    case 'lent':
      return `You have this copy${since}`;
    case 'borrowed':
      return `This is your copy — the catalog has it${since}`;
    case 'sold':
      return `Sold to you${since}`;
    default:
      // A status that can no longer carry a person (the copy came home, and
      // the record of who had it was kept). Said honestly rather than hidden:
      // the row exists, and pretending otherwise is how a person concludes the
      // catalog forgot.
      return `Recorded against you${since}`;
  }
}
