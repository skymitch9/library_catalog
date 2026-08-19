/**
 * ⚠️ **The named residue.** Owner rule, 2026-08-19: *"a book missing details
 * either gets them filled automatically within a day, or sits in a NAMED
 * residue category that the queue page displays with those words — never an
 * anonymous count that looks like a bug."*
 *
 * The queue does not converge to zero and is not supposed to: per
 * `isbn-ladder.md` §4.2 roughly half this library has no free record anywhere,
 * so a run that honestly comes back with nothing leaves the gap exactly where
 * it was. **That row then looks identical to a row nobody has got to yet**, and
 * a count that never falls is indistinguishable from a broken feature — which
 * is precisely what happened: the owner reported *"the button didnt fix"* about
 * a button that had worked forty times that afternoon.
 *
 * So a row whose open questions have all been PUT gets a sentence saying so,
 * naming what would actually close it. Pure, and exported, because it is the
 * page's one piece of judgement and belongs under a test rather than inside a
 * render.
 *
 * ⚠️ Deliberately reads only a FINISHED run. An error asked nothing (it never
 * got an answer), and a book whose lookup failed is still waiting its turn —
 * saying "we looked" about it would be the opposite lie from the one this fixes.
 */
export function residueSentence(
  missing: readonly string[],
  run: { status: string; asked: readonly string[] } | undefined,
): string | null {
  if (!run || run.status !== 'done') return null;
  const asked = new Set(run.asked);
  const unanswered = missing.filter((field) => asked.has(field));
  if (unanswered.length === 0) return null;
  // Not every open question was put — the book is still genuinely queued for
  // the rest, so it is not residue and must not be labelled as settled.
  if (unanswered.length < missing.length) return null;

  if (unanswered.length === 1 && unanswered[0] === 'seriesIndex') {
    return (
      'Research asked which volume this is and no source says. ' +
      'Somebody who knows the series can set it on the book page — another lookup will not help.'
    );
  }
  return (
    'Research looked and could not identify this book. ' +
    'About half this library has no free record anywhere, so this is an answer rather than a failure — ' +
    'it needs a person, not another lookup.'
  );
}

