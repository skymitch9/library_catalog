import { preorderQuestionText, preorderSentence } from '@lc/core';
import type { PreorderAnswer } from '@lc/core';
import type { PreorderQuestion } from '../lib/preorders.js';

/**
 * "This one is already on pre-order — is this it arriving, or another copy?"
 *
 * ## ⚠️ One prompt, two callers, and that is the whole design
 *
 * The scan review screen and the manual Add form both raise it, from the same
 * component with the same words, because the repo has already learned what two
 * spellings of one question cost: `STATUS_LABEL` in `lib/statuses.ts` exists
 * because "Preordered" and "Pre-ordered" were being written in two places and read
 * as two statuses. The wording itself is one level further down again, in
 * `@lc/core/preorders.ts`, beside the rule that decides when to ask.
 *
 * ## ⚠️ There is no default and no dismissal
 *
 * Both answers are buttons and neither is pre-selected. Every other prompt in this
 * app offers a way to walk past it — "Leave it", "Not wanted" — and this one does
 * not, because it is not asking whether to do something. It is asking *which*
 * thing the person is already doing, and both answers write. Walking away is the
 * Cancel on the form that raised it, which writes nothing at all.
 *
 * ⚠️ **One button per pre-ordered copy, not one button.** A work can have several
 * — production has one with three, one per variant cover — and picking for the
 * person is exactly the guess this feature exists to refuse.
 */
export function PreorderPrompt({
  question,
  busy,
  onAnswer,
}: {
  question: PreorderQuestion;
  busy: boolean;
  onAnswer: (answer: PreorderAnswer) => void;
}) {
  const many = question.options.length > 1;

  return (
    <div className="stack notice" style={{ gap: '0.3rem' }}>
      <div>
        <span className="mark mark--gap" style={{ position: 'static' }}>
          already on pre-order
        </span>
      </div>
      <strong>{preorderSentence(question.options.length, question.title)}</strong>
      <div className="muted small">{preorderQuestionText(question.options.length)}</div>

      <div className="stack" style={{ gap: '0.3rem' }}>
        {question.options.map((option) => (
          <button
            key={option.copyId}
            className="primary"
            disabled={busy}
            onClick={() =>
              onAnswer({ kind: 'arrived', copyId: option.copyId, acquiredOn: option.acquiredOn })
            }
          >
            {/* The label carries the confirmation, the way "Add 2nd copy" does on
                the duplicate row. With several pre-orders the label has to say
                WHICH one, or the three variant covers are three identical
                buttons. */}
            {many ? `This one arrived — ${option.label}` : 'This is the pre-order arriving'}
          </button>
        ))}
        <button disabled={busy} onClick={() => onAnswer({ kind: 'another' })}>
          {/* Says what it leaves alone as well as what it does. Without the second
              half this reads as "replace the pre-order", which is the other
              outcome. */}
          A different copy — leave the pre-order on the way
        </button>
      </div>

      {many && (
        <div className="muted small">
          {/* Only when it can bite. One pre-order needs no warning about picking
              the wrong one. */}
          Pick the wrong one and nothing is lost — the copies panel on the book page
          can put it back.
        </div>
      )}
    </div>
  );
}
