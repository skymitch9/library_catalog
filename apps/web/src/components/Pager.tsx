/**
 * First / prev / next / last, and where you are.
 *
 * Rendered above and below the results, as the audiobook catalog does: with 100
 * rows on screen, a control that only exists at the top means scrolling back up
 * to turn the page.
 *
 * ⚠️ Every number here comes from the response — `total`, `page`, `pageSize` —
 * and none is computed from an assumption about how many rows "should" have come
 * back. A page count derived from a client-side guess is how a paginator starts
 * offering page 5 of a 4-page list.
 */

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <nav className="pager" aria-label="Pages">
      <button onClick={() => onPage(0)} disabled={page === 0} aria-label="First page">
        «
      </button>
      <button onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        ‹
      </button>
      <span className="pager__info muted small">
        {first}–{last} of {total}
        {pages > 1 && <> · page {page + 1}/{pages}</>}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= pages - 1}
        aria-label="Next page"
      >
        ›
      </button>
      <button
        onClick={() => onPage(pages - 1)}
        disabled={page >= pages - 1}
        aria-label="Last page"
      >
        »
      </button>
    </nav>
  );
}
