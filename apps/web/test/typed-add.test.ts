/**
 * The three 2026-08-13 intake bugs, pinned.
 *
 * `docs/TODO.md` recorded three defects found by adding five books by hand at
 * `/add?mode=type` and reading the rows back. The 2026-09-05 audit repaired the
 * five ROWS and said in as many words that it had **not** re-tested the bugs —
 * *"this measurement says nothing about them"*. This file is the re-test.
 *
 * ## What was measured before any fix (2026-09-07, against `AddWork.tsx` at
 * `ed827f1`, the save sequence transcribed verbatim): **3 properties held, 4
 * reproduced.**
 *
 * | | Bug | Before |
 * |---|---|---|
 * | 1a | typed ISBN-13 is stored | ✅ held — fixed 2026-08-13 |
 * | 1b | typed **ISBN-10** is stored | 🔴 reproduced — dropped, silently |
 * | 1c | a mistyped 13-digit code is refused **and said** | 🔴 reproduced — stored, silently |
 * | 2 | "And we…" defaults to *have it* | ✅ held — fixed 2026-08-13 |
 * | 3a | a failed ISBN step leaves a readable message | 🔴 reproduced — `setNote` then `onAdded()` |
 * | 3b | a failed copy step says the book IS in already | 🔴 reproduced — threw; Save again ⇒ 2nd work |
 *
 * ⚠️ **Bug 2 did not reproduce and nothing was "fixed" for it.** The default was
 * changed to `owned` on 2026-08-13 and is still `owned`; what is new here is
 * that the value has one home (`DEFAULT_TYPED_INTENT`) and a test, so it cannot
 * drift back through a JSX default somebody edits in passing.
 *
 * ⚠️ **What this file does NOT cover.** There is no jsdom and no vitest in this
 * repo (see `add-modes.test.ts`), and `AddWork.tsx` reaches `api.js` →
 * `lib/firebase.ts`, which reads `import.meta.env` at module scope. So the JSX
 * — that the dropdown still offers three answers, that the panel renders the
 * partial-save sentences — is NOT tested here; only the decisions the component
 * now imports are.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_TYPED_INTENT,
  readTypedIsbn,
  saveTypedWork,
  typedAddOutcome,
  typedAddProblemSentence,
  type TypedAddDeps,
  type TypedAddInput,
} from '../src/lib/typed-add.ts';

/** Records every call; anything named in `failing` throws instead. */
function stubDeps(failing: string[] = []) {
  const calls: { name: string; body: unknown }[] = [];
  const mk =
    (name: string, ok: unknown) =>
    async (body: unknown) => {
      calls.push({ name, body });
      if (failing.includes(name)) throw new Error(`stub: ${name} failed`);
      return ok;
    };
  const deps: TypedAddDeps & { calls: typeof calls } = {
    calls,
    createWork: mk('createWork', { work: { id: 999 } }) as TypedAddDeps['createWork'],
    createEdition: mk('createEdition', { edition: { id: 1 } }),
    createCopy: mk('createCopy', {}),
    describeError: () => 'Something went wrong on our side.',
  };
  return deps;
}

/** #269 *Who Goes Roar?* — the board book that produced two of the three bugs. */
function input(overrides: Partial<TypedAddInput> = {}): TypedAddInput {
  return {
    title: 'Who Goes Roar?',
    authors: 'Make Believe Ideas',
    series: null,
    isbn: '',
    intent: DEFAULT_TYPED_INTENT,
    ...overrides,
  };
}

const editionOf = (deps: ReturnType<typeof stubDeps>) =>
  deps.calls.find((c) => c.name === 'createEdition')?.body as { isbn13?: string } | undefined;

describe('BUG 1 — the typed ISBN is not stored', () => {
  it('stores the 13-digit form printed on the book (held before the fix)', async () => {
    const deps = stubDeps();
    await saveTypedWork(deps, input({ isbn: '9781836422808' }));
    assert.equal(editionOf(deps)?.isbn13, '9781836422808');
  });

  it('stores the ISBN-10 printed beside it — 1-83642-280-6 is 9781836422808', async () => {
    // 🔴 REPRODUCED before the fix: `/^97[89]\d{10}$/` against the digits of
    // `1836422806` matched nothing, no edition was written, and the person was
    // told nothing. docs/TODO.md prints both forms for this exact book.
    const deps = stubDeps();
    const result = await saveTypedWork(deps, input({ isbn: '1-83642-280-6' }));
    assert.equal(editionOf(deps)?.isbn13, '9781836422808');
    assert.equal(result.isbn13, '9781836422808');
    assert.deepEqual(result.problems, []);
  });

  it('refuses a mistyped 13-digit code, and SAYS so', async () => {
    // 🔴 REPRODUCED before the fix: the old predicate never checked the check
    // digit, so one wrong keystroke stored a well-formed ISBN belonging to
    // nothing — on a row that will now never re-match.
    const deps = stubDeps();
    const result = await saveTypedWork(deps, input({ isbn: '9781836422807' }));
    assert.equal(editionOf(deps), undefined, 'nothing may be stored');
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0]?.kind, 'isbn-not-an-isbn');
    const outcome = typedAddOutcome(result);
    assert.equal(outcome.kind, 'partial');
  });

  it('an empty box is not a problem — nothing was claimed', async () => {
    const deps = stubDeps();
    const result = await saveTypedWork(deps, input({ isbn: '   ' }));
    assert.equal(editionOf(deps), undefined);
    assert.deepEqual(result.problems, []);
    assert.equal(typedAddOutcome(result).kind, 'clean');
  });

  it('classifies the shapes a person actually types', () => {
    assert.deepEqual(readTypedIsbn(''), { kind: 'none' });
    assert.deepEqual(readTypedIsbn('9781836422808'), { kind: 'isbn13', isbn13: '9781836422808' });
    assert.deepEqual(readTypedIsbn('1-83642-280-6'), { kind: 'isbn13', isbn13: '9781836422808' });
    // The price add-on beside the barcode — the commonest mis-scan.
    assert.deepEqual(readTypedIsbn('50499'), { kind: 'unusable', typed: '50499', reason: 'price_addon' });
    assert.equal(readTypedIsbn('9781836422807').kind, 'unusable');
  });
});

describe('BUG 2 — "And we…" defaulted to record-no-copy', () => {
  it('opens on "have it", not on "record no copy"', () => {
    // Did NOT reproduce: fixed 2026-08-13. Pinned so it cannot drift back.
    assert.equal(DEFAULT_TYPED_INTENT, 'owned');
  });

  it('the default save writes an owned copy', async () => {
    const deps = stubDeps();
    await saveTypedWork(deps, input());
    const copy = deps.calls.find((c) => c.name === 'createCopy')?.body as { status?: string };
    assert.equal(copy?.status, 'owned');
  });

  it('"just catalogue it" is still sayable, and still writes no copy', async () => {
    const deps = stubDeps();
    await saveTypedWork(deps, input({ intent: '' }));
    assert.equal(deps.calls.some((c) => c.name === 'createCopy'), false);
  });
});

describe('BUG 3 — a save can fail silently', () => {
  it('a failed ISBN step comes back as a problem, not a swallow', async () => {
    // 🔴 REPRODUCED before the fix: `setNote(...)` was written to state that
    // `onAdded()` unmounted on the very next line.
    const deps = stubDeps(['createEdition']);
    const result = await saveTypedWork(deps, input({ isbn: '9781836422808' }));
    assert.equal(result.workId, 999, 'the book is still added — losing the ISBN is a nuisance');
    assert.equal(result.isbn13, null);
    assert.equal(result.problems[0]?.kind, 'isbn-not-recorded');
  });

  it('a failed copy step does NOT throw, and warns against pressing Save again', async () => {
    // 🔴 REPRODUCED before the fix: it threw out of the handler, the person saw
    // a bare request error with no mention of the book, and pressing Save again
    // created a SECOND work — `POST /api/works` does not dedupe (migration 0001).
    const deps = stubDeps(['createCopy']);
    const result = await saveTypedWork(deps, input());
    assert.equal(result.workId, 999);
    assert.equal(result.problems[0]?.kind, 'copy-not-recorded');
    const outcome = typedAddOutcome(result);
    assert.equal(outcome.kind, 'partial');
    assert.ok(
      outcome.kind === 'partial' && outcome.sentences[0]?.includes('Do not press Save again'),
      'the sentence must name the duplicate-work risk',
    );
  });

  it('a failed WORK still throws — nothing was written, the form is still standing', async () => {
    const deps = stubDeps(['createWork']);
    await assert.rejects(() => saveTypedWork(deps, input()));
  });

  it('a clean save is reported clean, and only a clean save is', async () => {
    const deps = stubDeps();
    const clean = typedAddOutcome(await saveTypedWork(deps, input({ isbn: '9781836422808' })));
    assert.deepEqual(clean, { kind: 'clean', workId: 999 });
  });

  it('every problem sentence leads with the book being in, and says what to do', () => {
    const sentences = [
      typedAddProblemSentence({ kind: 'isbn-not-an-isbn', typed: '50499', reason: 'price_addon' }),
      typedAddProblemSentence({ kind: 'isbn-not-recorded', detail: 'x.' }),
      typedAddProblemSentence({ kind: 'copy-not-recorded', detail: 'x.', intent: 'owned' }),
    ];
    for (const s of sentences) {
      assert.ok(s.startsWith('The book was added'), `must not read as a total failure: ${s}`);
      assert.ok(/book page/.test(s), `must say where to finish the job: ${s}`);
      // The estate rule: nobody sees a bare HTTP status.
      assert.ok(!/\bHTTP \d\d\d\b/.test(s), `bare status in: ${s}`);
    }
  });
});
