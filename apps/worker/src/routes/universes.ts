import { Hono } from 'hono';
import { listCollection } from '@lc/db';
import { membersOf, universesDocument } from '@lc/universes';
import type { AppBindings } from '../env.js';
import { canonicalUniverse, universeIdsFor } from '../lib/universes.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * One shared world, and everything this catalog holds from it.
 *
 * ⚠️ **Not a second series page.** `/api/series/:name` answers "what is missing
 * from this run of books", with a ladder, volume numbers and gaps. This answers
 * a question that one cannot: which books across *different* series are the
 * same world. The Cosmere is five series plus ten individually named books, and
 * that spread is the entire reason this endpoint exists. Nothing here computes
 * completeness, and nothing here should — a universe has no volume numbering to
 * be complete against.
 *
 * ## Everything, in one response
 *
 * No paging, following `/api/series`, which returns every series for the same
 * reason: the shape of the answer is the whole set, and a universe of this
 * catalog's books is tens of rows and not thousands. `LIMIT` is a guard rail
 * rather than a page — if it ever bites, `total` says so and the page says so
 * out loud rather than quietly showing a prefix.
 *
 * The rows come back through `listCollection`, so a book on this page carries
 * the same cover, marks, formats and read-state it carries in the collection,
 * and the client can hand them straight to the same `WorkList`. Ordered by the
 * existing `series` sort, which groups a series together and orders it by
 * volume — the grouping the page draws falls out of it for free.
 */

/**
 * The guard rail, not a page size.
 *
 * A universe would have to be five times the size of the largest one in the
 * list to reach it. It exists so a future mistake in the shared list — a series
 * name that sweeps in half the catalog — costs a truncated page and a visible
 * "showing N of M" rather than a payload of everything.
 */
const UNIVERSE_LIMIT = 500;

export const universeRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('read'))

  /**
   * ⚠️ The name is the id, folded onto the owner's spelling.
   * `/api/universes/cosmere` and `/api/universes/The%20Cosmere` are the same
   * page, because `canonicalNames` in the shared list says so — and the
   * response always names the canonical form, so the client never has to guess
   * which spelling it was given.
   *
   * A name that is not one of the six is a 404 and not an empty page: unlike a
   * series name, which comes from the catalog and can legitimately match
   * nothing, the universe vocabulary is closed and a miss means the address is
   * wrong.
   */
  .get('/:name', async (c) => {
    const name = canonicalUniverse(decodeURIComponent(c.req.param('name')));
    if (!name) return c.json({ error: 'not_found' }, 404);

    const base = {
      readerId: c.get('user').id,
      sort: 'series' as const,
      dir: 'asc' as const,
      limit: UNIVERSE_LIMIT,
      offset: 0,
    };
    const universeIds = await universeIdsFor(c.env.DB, base, name);
    const { rows, total } = await listCollection(c.env.DB, { ...base, universeIds });

    const declared = membersOf(universesDocument, name);
    return c.json({
      name,
      rows,
      total,
      /**
       * How big the universe is *in the shared list*, which is a different
       * number from how much of it is on this shelf — and saying both is the
       * honest way to show a catalog holding six Cosmere books out of a list
       * naming five series and ten titles. Both catalogs read the same list, so
       * most of a universe is often in the other one.
       *
       * ⚠️ Counts, not the arrays. The page renders a sentence, and shipping
       * the names would invite somebody to render a checklist of the series
       * this catalog does not hold — which is a wishlist wearing a universe's
       * clothes, and not what was asked for.
       */
      declared: { series: declared.series.length, titles: declared.titles.length },
    });
  });
