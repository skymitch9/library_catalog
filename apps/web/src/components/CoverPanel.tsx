import { useEffect, useRef, useState } from 'react';
import { MAX_COVER_BYTES, coverNeeded } from '@lc/core';
import { api } from '../api.js';
import { CoverSwap } from './CoverSwap.js';

/**
 * Give this book the right cover — or say out loud that it has the wrong one.
 *
 * ## ⚠️ Why an app that already has a cover ladder needs a manual path
 *
 * Because the ladder has a measured floor and this catalog sits on it. Four
 * works cannot be reached by any rung — a Paw Patrol shaped board book, *Home
 * Sweet Home*, a Korean Tinyping board book, *The Nightmare Before Christmas* —
 * and `docs/info/isbn-ladder.md` §4.2 measured that half this library has no
 * free metadata at all. Open Library, Google Books and a paid LLM search have
 * each already been asked. What is left is a person with the book in their hand.
 *
 * ## Three ways, and the middle one is the one people forget
 *
 *   **Link** an image somebody else hosts. Needs nothing of us, and is how the
 *   Percy Jackson stand-in is stored — the Illumicrate CDN already serves that
 *   photograph.
 *
 *   **Say it is a stand-in.** No new image at all. This is the case the whole
 *   feature exists for: five books share one marketing shot on purpose, and
 *   without a way to record that, "we used the wrong picture knowingly" and
 *   "this book is done" are the same state.
 *
 *   **Upload** a file we then serve. ⚠️ Needs an R2 bucket bound to the Worker,
 *   and there is not one yet — `coverStorage()` says so and the control is
 *   hidden rather than offered and then failing.
 *
 * Every path verifies before it writes. A link is fetched by the Worker; a file
 * is checked against its own magic bytes. `docs/info/covers-and-series.md` gives
 * the reason: **nothing in this system ever revisits a cover column**, so a bad
 * value is permanent in a way a blank is not.
 */
export function CoverPanel({
  workId,
  work,
  canEdit,
  onChanged,
}: {
  workId: number;
  work: { coverUrl: string | null; coverStatus: 'ok' | 'standin' | null };
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** The side-by-side grid of known covers — loaded only when asked for. */
  const [swapping, setSwapping] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ enabled: boolean; reason?: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const needed = coverNeeded(work);

  // Asked once, and only by somebody who could act on the answer. A reader who
  // cannot edit never sees the panel, so never makes the request.
  useEffect(() => {
    if (!canEdit) return;
    api
      .coverStorage()
      .then((s) => setStorage(s))
      .catch(() => setStorage({ enabled: false }));
  }, [canEdit]);

  /**
   * ⚠️ A reader sees the mark and no controls.
   *
   * Not nothing, though: "this is a stand-in" is a fact about what they are
   * looking at, and hiding it from them would mean the picture on their screen
   * silently claims to be the book's cover.
   */
  //
  // `notice--bad` and not a new modifier: it is the stylesheet's existing
  // terracotta left rule, the same `--warm` the mark wears, and inventing
  // `notice--warn` would be a third tone for the two this app has.
  if (!canEdit) {
    return work.coverStatus === 'standin' ? (
      <p className="notice notice--bad">
        The image above is a <b>stand-in</b>, not this book&rsquo;s own cover.
      </p>
    ) : null;
  }

  async function run(what: () => Promise<unknown>, done: string) {
    setBusy(true);
    setSaid(null);
    try {
      await what();
      setSaid(done);
      onChanged();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const link = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setSaid('Paste a link to the image file itself — not to the page it is on.');
      return;
    }
    return run(async () => {
      await api.setCover(workId, { url: trimmed, status: 'ok' });
      setUrl('');
      setOpen(false);
    }, 'Cover set.');
  };

  const upload = (file: File) => {
    // Refused here as well as on the server, so a phone on a slow connection is
    // not asked to send six megabytes before being told no.
    if (file.size > MAX_COVER_BYTES) {
      setSaid(
        `${(file.size / (1024 * 1024)).toFixed(1)}MB is over the ${MAX_COVER_BYTES / (1024 * 1024)}MB limit. Crop or shrink it first.`,
      );
      return;
    }
    return run(async () => {
      await api.uploadCover(workId, file);
      setOpen(false);
    }, 'Cover uploaded.');
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h3>Cover</h3>
        {needed && (
          <span className="mark mark--needs" style={{ position: 'static' }}>
            Cover needed
          </span>
        )}
      </div>

      {work.coverStatus === 'standin' && (
        <p className="muted small">
          Marked as a <b>stand-in</b> — the image above is not this book's own cover, and this
          book stays on the "cover needed" list until a real one replaces it.
        </p>
      )}
      {!work.coverUrl && (
        <p className="muted small">
          No cover found. Every automatic source has already been asked; this one needs a person.
        </p>
      )}

      <div className="row-tight">
        <button onClick={() => setOpen(!open)} aria-expanded={open} disabled={busy}>
          {open ? 'Cancel' : work.coverUrl ? 'Replace cover' : 'Add a cover'}
        </button>

        {/* The picker — for when the right cover already exists somewhere the
            catalog can see: another printing's, a previous one, an Open
            Library guess. Lazy: nothing is fetched until this is opened. */}
        <button onClick={() => setSwapping(!swapping)} aria-expanded={swapping} disabled={busy}>
          {swapping ? 'Close covers' : 'Choose from known covers'}
        </button>

        {/* ⚠️ The toggle, both ways. Marking a good cover as a stand-in is the
            rarer press and the one nobody would guess exists, so it is a plain
            button with the whole sentence on it rather than a checkbox. */}
        {work.coverUrl &&
          (work.coverStatus === 'standin' ? (
            <button
              disabled={busy}
              onClick={() => run(() => api.setCoverStatus(workId, 'ok'), 'Marked as the real cover.')}
            >
              This is the real cover
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() =>
                run(() => api.setCoverStatus(workId, 'standin'), 'Marked as a stand-in.')
              }
            >
              Not the right cover
            </button>
          ))}

        {work.coverUrl && (
          <button
            className="chip danger"
            disabled={busy}
            onClick={() => run(() => api.removeCover(workId), 'Cover removed.')}
          >
            Remove
          </button>
        )}
      </div>

      {swapping && <CoverSwap workId={workId} onChanged={onChanged} />}

      {open && (
        <div className="stack">
          <label className="field">
            <span className="field__label">Link to an image</span>
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/cover.jpg"
              disabled={busy}
            />
          </label>
          <p className="muted small">
            The link to the image <b>file</b>, not the page it sits on. It is fetched and checked
            before anything is saved, so a dead link is refused rather than stored.
          </p>
          <div className="row-tight">
            <button className="primary" onClick={link} disabled={busy}>
              {busy ? 'Checking…' : 'Use this link'}
            </button>
          </div>

          {/* ⚠️ Offered only when there is somewhere to put the bytes. A button
              that can only 501 is worse than no button — see `env.ts` on
              `COVERS`, and note that this is NOT the scan-photo bucket that
              must never exist. */}
          {storage?.enabled ? (
            <>
              <hr />
              <div className="row-tight">
                {/* `capture` is deliberately absent: the realistic source is a
                    picture already taken, or a file downloaded on the phone, and
                    forcing the camera would hide both behind an extra step. */}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Cleared so choosing the same file twice fires again — a
                    // retry after a failure otherwise does nothing at all.
                    e.target.value = '';
                    if (file) void upload(file);
                  }}
                />
              </div>
              <p className="muted small">
                JPEG, PNG, WebP, GIF or AVIF, up to {MAX_COVER_BYTES / (1024 * 1024)}MB. The file
                is checked by its own contents, not by what it claims to be.
              </p>
            </>
          ) : (
            storage && (
              <p className="muted small">
                {storage.reason ??
                  'Uploading a file is not switched on for this deployment. A link works.'}
              </p>
            )
          )}
        </div>
      )}

      {said && <p className="muted small">{said}</p>}
    </section>
  );
}
