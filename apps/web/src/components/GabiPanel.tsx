/**
 * "Ask GABI" — the site chat panel, and the loop that runs inside it.
 *
 * The owner's ask, verbatim (2026-08-16): *"in the future i want Sam to be able
 * to ask gabi to fix books for her like id ask you. it'd be done through api but
 * it would have the needed context to fix things."* Surface order settled
 * 2026-08-17: **this panel first, Discord DM the phase after.**
 *
 * ## ⚠️ THE LOOP RUNS HERE, AND THAT IS THE WHOLE ARCHITECTURE
 *
 * `docs/info/gabi-fixer-design.md` §3.1 refuses the obvious shape — a Worker
 * that loops internally — on subrequest arithmetic: a six-turn conversation that
 * researches one book and patches two fields is ~40 of the **50 subrequests** an
 * invocation gets, and going over **terminates the invocation rather than
 * throwing**. A conversation whose failure mode is "the reply never comes and
 * nothing is logged" is the worst possible place for that risk.
 *
 * So: the Worker makes one model call and returns; this component executes the
 * tools it asked for, each through `api.ts`, each its own request with its own
 * fresh budget, and posts the next turn. Which buys the thing that matters most:
 *
 * > **Authority is not simulated — it is the session.** Every tool call is a
 * > request this browser was already permitted to make. `requireAuth` verifies
 * > her Firebase ID token, `requireCapability` checks her role, `change_log`
 * > records her id. There is no impersonation layer to get wrong, because there
 * > is no impersonation layer.
 *
 * ## ⚠️ A TOOL CARD FOR EVERY tool_use BLOCK. NO EXCEPTIONS.
 *
 * §8's last row is the one this component exists to satisfy. With thinking
 * disabled, Opus 5 can write a tool call into its visible TEXT — the turn
 * succeeds, the call never runs, nothing errors. The model config leaves
 * thinking on precisely to avoid that; the cards are the second line of defence,
 * because **a claimed action with no card is visibly a claim**. The raw result
 * sits under each card, verbatim, so a paraphrase is visible as one.
 *
 * ## ⚠️ Phase 0 is READ-ONLY
 *
 * `@lc/core`'s allowlist holds four tools and none of them can change anything —
 * `packages/core/test/gabi-tools.test.ts` fails the build if that stops being
 * true. So nothing in this file needs a confirm lane, a manifest or an undo yet.
 * When phase 1 adds `set_book_details`, those arrive with it (§6).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type GabiTurnResponse } from '../api.js';
import { describeError } from '../lib/errors.js';
import { executeGabiTool, type GabiReadApi, type GabiToolOutcome } from '../lib/gabi.js';

/**
 * A hard client-side ceiling on tool round-trips within one send.
 *
 * The Worker refuses past 24 messages and that is the real fuse (§3.2 — "a
 * server-side count is the only place a browser bug cannot bypass"). This is the
 * courtesy stop that keeps a confused model from burning the whole allowance
 * before the server's counter catches up.
 */
const MAX_TOOL_ROUNDS = 6;

/** The six read calls the executor needs, wired to the one authenticated client. */
const READ_API: GabiReadApi = {
  searchCollection: (query) => api.collection({ q: query, pageSize: 12 }),
  work: (workId) => api.work(workId),
  queue: () => api.queue(),
  autoApplied: (limit) => api.autoApplied(limit),
  workChanges: (workId) => api.workChanges(workId),
};

interface Block {
  type: string;
  [key: string]: unknown;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string | Block[];
}

/** What one send cost, accumulated. §7.3's measured figure, on the face of it. */
interface Spend {
  turns: number;
  cents: number;
  cacheReadTokens: number;
}

function textOf(content: string | Block[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text')
    .map((b) => String(b['text'] ?? ''))
    .join('\n\n')
    .trim();
}

function toolUseOf(content: string | Block[]): Block[] {
  return typeof content === 'string' ? [] : content.filter((b) => b.type === 'tool_use');
}

/** The top-bar control. Icon-only, exactly as the estate-search toggle is. */
export function GabiToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="gabi-toggle"
      aria-expanded={open}
      aria-controls="gabi-panel"
      aria-label="Ask GABI about these books"
      title="Ask GABI about these books"
      onClick={onToggle}
    >
      {/* Drawn inline so it inherits currentColor in every theme — the rule the
          cog and the search toggle both follow. A speech bubble: this is a
          conversation, not a search and not a setting. */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V16H5.5A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function GabiPanel({ hidden }: { hidden: boolean }) {
  /**
   * The conversation, in the API's own message shape. ⚠️ It is the transcript —
   * the Worker persists nothing (§3.2, stateless) — so closing the tab ends it.
   * That is a real property, not an oversight: it is what makes conversation
   * state cost nothing, and it is the thing a Discord front end would have to
   * build (§10.2, blocker 4).
   */
  const [messages, setMessages] = useState<Turn[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, GabiToolOutcome>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spend, setSpend] = useState<Spend>({ turns: 0, cents: 0, cacheReadTokens: 0 });

  // One id per conversation, minted here. It is the join that turns per-turn
  // `gabi_turn` rows into a cost-per-CONVERSATION — the figure §7 owes an
  // answer for. `randomUUID` needs a secure context, which both hostnames are.
  const conversationId = useRef(
    typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `gabi-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      setError(null);
      setDraft('');
      let history: Turn[] = [...messages, { role: 'user', content: trimmed }];
      setMessages(history);

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          setBusy(round === 0 ? 'Thinking…' : 'Looking…');

          const turn: GabiTurnResponse = await api.gabiTurn(conversationId.current, history);

          setSpend((s) => ({
            turns: s.turns + 1,
            cents: s.cents + turn.usage.estimatedCents,
            cacheReadTokens: s.cacheReadTokens + turn.usage.cacheReadTokens,
          }));

          history = [...history, { role: 'assistant', content: turn.content as Block[] }];
          setMessages(history);

          const calls = toolUseOf(turn.content as Block[]);
          if (calls.length === 0) return;

          if (round === MAX_TOOL_ROUNDS) {
            setError(
              'GABI kept looking things up without reaching an answer, so this stopped. Ask again, more narrowly.',
            );
            return;
          }

          setBusy('Looking…');
          // ⚠️ SERIALLY, never Promise.all. §6.4 gives two reasons and both are
          // already recorded in this repo: two calls against one book read and
          // write the same row, and the per-invocation subrequest ceiling is
          // real. Phase 0 only reads, so only the second bites today — but the
          // shape is the one phase 3's batches need, and getting it right once
          // is cheaper than remembering it later.
          const results: GabiToolOutcome[] = [];
          for (const call of calls) {
            const outcome = await executeGabiTool(
              READ_API,
              { id: String(call['id'] ?? ''), name: String(call['name'] ?? ''), input: call['input'] },
              describeError,
            );
            results.push(outcome);
            setOutcomes((all) => ({ ...all, [outcome.toolUseId]: outcome }));
          }

          history = [
            ...history,
            {
              role: 'user',
              content: results.map((r) => ({
                type: 'tool_result',
                tool_use_id: r.toolUseId,
                // ⚠️ is_error travels. §8 row 1: the loop continues and GABI
                // says what happened in the app's own words, rather than the
                // turn dying and the panel going quiet.
                is_error: r.isError,
                content: JSON.stringify(r.result),
              })),
            },
          ];
          setMessages(history);
        }
      } catch (err) {
        // ⚠️ Through `describeError`, the ONE place an ApiError becomes a
        // sentence. Nobody sees a bare status here either: a 404 says GABI is
        // not switched on, a 503 says no key is configured and names the fix, a
        // 403 names the capability and the role that holds it.
        setError(describeError(err));
      } finally {
        setBusy(null);
      }
    },
    [busy, messages],
  );

  return (
    <section
      id="gabi-panel"
      className="gabi-panel"
      aria-label="Ask GABI about these books"
      /**
       * ⚠️ HIDDEN, not unmounted — unlike the estate-search panel, which
       * unmounts on close so its element aborts in-flight requests. The
       * difference is what the two hold: that one holds a query, this one holds
       * a conversation the Worker does not persist (§3.2 — stateless, no
       * transcript). Unmounting would throw the transcript away every time
       * somebody closed the box to go and look at a book, which is exactly the
       * moment a conversation is worth keeping.
       *
       * ⚠️ `styles.css` restates `display: none` for `[hidden]` on this class.
       * An author `display` rule beats the UA stylesheet's `[hidden]`, which is
       * the upstream bug `EstateSearch.tsx`'s `guardHiddenScanRow` exists to
       * patch — the same trap, one file away.
       */
      hidden={hidden}
    >
      <div className="gabi-log" ref={log} role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="gabi-intro">
            <p className="muted small">
              Ask about these books — what is missing, what a book says, what changed lately.
            </p>
            {/* ⚠️ Says what it CANNOT do, up front. Phase 0 is read-only, and a
                panel that let somebody discover that by being refused would be
                the worst version of this. */}
            <p className="muted small">
              GABI can look things up. It cannot change anything yet — edits are still
              made on a book&rsquo;s own page.
            </p>
            <ul className="gabi-suggestions">
              {[
                'What still needs fixing?',
                'What do we know about Unsouled?',
                'What changed lately?',
              ].map((s) => (
                <li key={s}>
                  <button type="button" className="chip" onClick={() => void send(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((turn, i) => {
          const said = textOf(turn.content);
          const calls = toolUseOf(turn.content);
          // A tool_result turn carries no prose and no cards; its content is
          // rendered under the call that produced it, which is where somebody
          // reading the conversation would look for it.
          if (!said && calls.length === 0) return null;

          return (
            <div key={i} className={`gabi-turn gabi-turn--${turn.role}`}>
              {said && <p className="gabi-said">{said}</p>}
              {calls.map((call) => {
                const id = String(call['id'] ?? '');
                const outcome = outcomes[id];
                return (
                  <details key={id} className="gabi-tool">
                    <summary>
                      <span className="gabi-tool__name">{String(call['name'] ?? 'tool')}</span>
                      <span className="muted small">
                        {outcome ? (outcome.isError ? ' — refused' : ' — looked') : ' — running…'}
                      </span>
                    </summary>
                    {/* ⚠️ VERBATIM, and under the card rather than in the prose.
                        §8: the panel renders the raw tool result beneath the
                        message so a paraphrase is visible as one. */}
                    <pre className="gabi-tool__raw">
                      {JSON.stringify(call['input'] ?? {}, null, 1)}
                      {outcome ? `\n\n${JSON.stringify(outcome.result, null, 1)}` : ''}
                    </pre>
                  </details>
                );
              })}
            </div>
          );
        })}

        {busy && <p className="muted small gabi-busy">{busy}</p>}
        {error && (
          <p className="gabi-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <form
        className="gabi-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about a book…"
          aria-label="Ask GABI"
          disabled={busy !== null}
        />
        <button type="submit" className="primary" disabled={busy !== null || !draft.trim()}>
          Ask
        </button>
      </form>

      {/* ⚠️ The cost readout is not decoration — it is §7.3 arriving on screen.
          Phase 0 is supposed to END with a MEASURED cost-per-conversation
          replacing the design's arithmetic, and `gabi_turn` holds the durable
          record; this is the same number where the person spending it can see
          it. `cached` is the half that proves the cheap-prefix claim rather
          than assuming it. */}
      {spend.turns > 0 && (
        <p className="muted small gabi-spend">
          {spend.turns} model call{spend.turns === 1 ? '' : 's'} this conversation · about{' '}
          {spend.cents < 1 ? '<1' : Math.round(spend.cents)}¢ · {spend.cacheReadTokens.toLocaleString()}{' '}
          cached tokens re-read
        </p>
      )}
    </section>
  );
}
