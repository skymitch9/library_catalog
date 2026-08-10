/**
 * A cover, or something that looks deliberate when there is not one.
 *
 * ⚠️ The fallback is not decoration. 114 of 115 works have a cover after
 * `npm run backfill:covers`, so a placeholder marks the genuinely unusual row —
 * and the one book with no cover in its EPUB should look like a book that has
 * no cover, not like an app that failed to load an image. Spelling the title out
 * on the spine is what makes those two states tell themselves apart at a glance.
 *
 * `onError` matters more than it looks: `cover_url` can point at a file that a
 * deploy has not shipped yet, which is the documented hazard of running the
 * backfill against production before deploying. Falling back keeps that a
 * cosmetic problem instead of a page of broken-image icons.
 */

import { useEffect, useState } from 'react';

export function Cover({
  src,
  title,
  authors,
  size = 'grid',
}: {
  src: string | null;
  title: string;
  authors?: string;
  size?: 'row' | 'grid' | 'large';
}) {
  const [failed, setFailed] = useState(false);

  // A different book in the same slot must retry its own image.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div className={`cover cover--${size} cover--blank`} aria-hidden="true">
        <span className="cover__title">{title}</span>
        {authors && size !== 'row' && <span className="cover__author">{authors}</span>}
      </div>
    );
  }

  return (
    <img
      className={`cover cover--${size}`}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
