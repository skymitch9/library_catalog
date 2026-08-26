/**
 * `scripts/op-import-dev-vars.mjs` — the 1Password import (owner decision
 * 2026-08-26, secrets review §5 step 1).
 *
 * ⚠️ **Nothing here runs `op`, and nothing here reads `.dev.vars`.** The units
 * under test are pure: the title convention, the plan, the template renderer and
 * the refusal wording. Every fixture value below is the literal string
 * `placeholder-not-a-secret` — a test fixture that looks like key material is
 * how a repo ends up with key material in it.
 *
 * The property that matters, and that every assertion here is a disguise of:
 * **a VALUE reaches `op` over stdin and appears nowhere else** — not in an argv,
 * not in a printed plan, not in the tracked template.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  BARE_EXTRA,
  CREATE,
  HOLDER,
  SKIP_EMPTY,
  TITLE_SEP,
  UPDATE,
  VAULT,
  createArgs,
  editArgs,
  holdersNote,
  isAuthorizationRefusal,
  isBareTitled,
  itemTemplate,
  itemTitle,
  keyNameFromFile,
  opFailureMessage,
  parseAllPairs,
  planImport,
  renderTemplate,
  secretRef,
  tagsFor,
} from '../op-import-dev-vars.mjs';

/** Never a real value. If this string ever changes, change it to another fake. */
const FAKE = 'placeholder-not-a-secret';

describe('the item-title convention', () => {
  it('gives a shared-by-design key a BARE title — one NAME, one value', () => {
    for (const name of [
      'GOOGLE_BOOKS_API_KEY',
      'HARDCOVER_API_TOKEN',
      'DONOR_TOKEN',
      'PEER_TOKEN',
      'EBOOK_INGEST_TOKEN',
      'AUDIOBOOK_MAPPING_TOKEN',
    ]) {
      assert.ok(isBareTitled(name), `${name} is shared by design`);
      assert.equal(itemTitle(name), name);
    }
  });

  it('⚠️ keeps ESTATE_APP_TOKEN_* BARE — the instance is already in the SUFFIX', () => {
    // push-secrets.mjs calls these per-instance, and that is a different
    // question: "may a bulk run send this to her Worker?" (no). The TITLE asks
    // "does this name identify one value?" (yes). Scoping them would say the
    // instance twice and still not be the estate-auth side's name.
    assert.equal(itemTitle('ESTATE_APP_TOKEN_LIBRARY'), 'ESTATE_APP_TOKEN_LIBRARY');
    assert.equal(itemTitle('ESTATE_APP_TOKEN_LIBRARY2'), 'ESTATE_APP_TOKEN_LIBRARY2');
    assert.equal(itemTitle('ESTATE_APP_TOKEN_SOMETHING_LATER'), 'ESTATE_APP_TOKEN_SOMETHING_LATER');
  });

  it('scopes a key whose NAME means a different value on another holder', () => {
    assert.equal(itemTitle('ANTHROPIC_API_KEY'), 'library.ANTHROPIC_API_KEY');
    assert.equal(itemTitle('INDEX_READ_TOKEN'), 'library.INDEX_READ_TOKEN');
    assert.equal(itemTitle('INDEX_PUSH_TOKEN'), 'library.INDEX_PUSH_TOKEN');
    // …and the SAME name on the second instance is a different item.
    assert.equal(itemTitle('INDEX_READ_TOKEN', 'library2'), 'library2.INDEX_READ_TOKEN');
    assert.notEqual(itemTitle('ANTHROPIC_API_KEY', 'library2'), itemTitle('ANTHROPIC_API_KEY'));
  });

  it('⚠️ defaults an UNCLASSIFIED key to holder-scoped — the safe direction', () => {
    // A key nobody has decided about must never be mistaken for an estate-wide
    // value a later session feels free to push elsewhere.
    assert.equal(isBareTitled('SOMETHING_NOBODY_CLASSIFIED'), false);
    assert.equal(itemTitle('SOMETHING_NOBODY_CLASSIFIED'), 'library.SOMETHING_NOBODY_CLASSIFIED');
    assert.equal(itemTitle('GABI_PANEL'), 'library.GABI_PANEL');
    assert.equal(itemTitle('DEV_EMAIL'), 'library.DEV_EMAIL');
  });

  it('makes an explicit exception for a household-wide vendor key', () => {
    assert.ok(BARE_EXTRA.includes('LIBRARYTHING_API_KEY'));
    assert.equal(itemTitle('LIBRARYTHING_API_KEY'), 'LIBRARYTHING_API_KEY');
  });

  it('⚠️ NEVER puts a `/` in a title — it is the op:// field delimiter', () => {
    // The whole reason the separator is a dot. `op://Estate/library/X/password`
    // would parse as vault=Estate, item=library, section=X, field=password.
    assert.equal(TITLE_SEP, '.');
    for (const name of ['ANTHROPIC_API_KEY', 'DEV_EMAIL', 'HARDCOVER_API_TOKEN']) {
      assert.equal(itemTitle(name).includes('/'), false);
      // A resolvable reference has exactly three segments after `op://`.
      assert.equal(secretRef(name).replace('op://', '').split('/').length, 3);
    }
    assert.equal(secretRef('ANTHROPIC_API_KEY'), `op://${VAULT}/library.ANTHROPIC_API_KEY/password`);
  });
});

describe('planImport', () => {
  it('creates what is absent and updates what is present', () => {
    const vars = { HARDCOVER_API_TOKEN: FAKE, ANTHROPIC_API_KEY: FAKE };
    const plan = planImport(vars, ['HARDCOVER_API_TOKEN']);
    assert.equal(plan.find((r) => r.name === 'HARDCOVER_API_TOKEN').action, UPDATE);
    assert.equal(plan.find((r) => r.name === 'ANTHROPIC_API_KEY').action, CREATE);
  });

  it('⚠️ NEVER imports an empty value — a drop-box is an operation, not storage', () => {
    // `ANTHROPIC_API_KEY_FRIEND_SAM`, `INDEX_READ_TOKEN_FRIEND_PADHARD` and
    // `CLOUDFLARE_API_TOKEN_CI` are all empty in the main .dev.vars, and empty is
    // their correct resting state. An empty item would invite a later session to
    // treat the drop-box as a master.
    const plan = planImport({ ANTHROPIC_API_KEY_FRIEND_SAM: '', PEER_TOKEN: FAKE });
    assert.equal(plan.find((r) => r.name === 'ANTHROPIC_API_KEY_FRIEND_SAM').action, SKIP_EMPTY);
    assert.equal(plan.find((r) => r.name === 'PEER_TOKEN').action, CREATE);
  });

  it('never puts a VALUE in a plan row — name, title and action only', () => {
    const plan = planImport({ PEER_TOKEN: FAKE, DEV_EMAIL: FAKE });
    for (const row of plan) {
      assert.deepEqual(
        Object.keys(row).filter((k) => !['name', 'title', 'action'].includes(k)),
        [],
      );
      assert.equal(JSON.stringify(row).includes(FAKE), false, 'a plan row cannot carry a value');
    }
  });
});

describe('the item template — the ONLY place a value is interpolated', () => {
  it('puts the value in the password field and nowhere else', () => {
    const t = itemTemplate('HARDCOVER_API_TOKEN', FAKE);
    assert.equal(t.title, 'HARDCOVER_API_TOKEN');
    assert.equal(t.category, 'PASSWORD');
    const pw = t.fields.find((f) => f.id === 'password');
    assert.equal(pw.value, FAKE);
    assert.equal(pw.type, 'CONCEALED');
    // The notes carry CUSTODY — which holders receive this value — so the vault
    // item is the custody record rather than a table in a doc that goes stale.
    const notes = t.fields.find((f) => f.id === 'notesPlain');
    assert.match(notes.value, /library-catalog/);
    assert.equal(notes.value.includes(FAKE), false);
  });

  it('⚠️ the value is NOT in the argv — it goes over stdin', () => {
    // `op item create --help`: "Command arguments get logged in your command
    // history, and can be visible to other processes on your machine. If you're
    // assigning sensitive values, use a JSON template instead." Same argument as
    // push-secrets.mjs's spawnBulk, same conclusion.
    for (const args of [createArgs(), editArgs('HARDCOVER_API_TOKEN')]) {
      assert.equal(args.includes(FAKE), false);
      assert.equal(args.join(' ').includes(FAKE), false);
      assert.ok(args.includes('--vault'));
    }
    assert.deepEqual(createArgs('Estate'), ['item', 'create', '--vault', 'Estate']);
  });

  it('tags a dev flag `local-config` and a key `credential`', () => {
    assert.ok(tagsFor('HARDCOVER_API_TOKEN').includes('credential'));
    assert.ok(tagsFor('DEV_EMAIL').includes('local-config'));
    assert.ok(tagsFor('ENVIRONMENT').includes('local-config'));
    for (const name of ['HARDCOVER_API_TOKEN', 'DEV_EMAIL']) {
      assert.ok(tagsFor(name).includes('estate'));
      assert.ok(tagsFor(name).includes('library_catalog'));
    }
  });

  it('says so plainly when a key has no recorded custody', () => {
    assert.match(holdersNote('SOMETHING_NOBODY_CLASSIFIED'), /not yet recorded/);
    assert.match(holdersNote('DEV_EMAIL'), /local dev only/);
    assert.match(holdersNote('DONOR_TOKEN'), /double duty/);
  });
});

describe('renderTemplate — TRACKED, and this repo is PUBLIC', () => {
  const names = ['HARDCOVER_API_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_FRIEND_SAM'];
  const out = renderTemplate(names, ['ANTHROPIC_API_KEY_FRIEND_SAM']);

  it('emits a pointer per key, never a value', () => {
    assert.match(out, /^HARDCOVER_API_TOKEN=\{\{ op:\/\/Estate\/HARDCOVER_API_TOKEN\/password \}\}$/m);
    assert.match(
      out,
      /^ANTHROPIC_API_KEY=\{\{ op:\/\/Estate\/library\.ANTHROPIC_API_KEY\/password \}\}$/m,
    );
  });

  it('⚠️ every non-comment line is NAME= followed by a pointer or nothing at all', () => {
    for (const line of out.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      assert.match(
        t,
        /^[A-Za-z_][A-Za-z0-9_-]*=(\{\{ op:\/\/[^{}]+ \}\})?$/,
        `a template line must be a name and a pointer, got: ${t}`,
      );
    }
  });

  it('leaves a drop-box blank rather than pointing it at an item', () => {
    assert.match(out, /^ANTHROPIC_API_KEY_FRIEND_SAM=$/m);
    assert.equal(out.includes('op://Estate/library.ANTHROPIC_API_KEY_FRIEND_SAM'), false);
  });

  it('⚠️ carries NO bare secret reference outside a {{ }} — it breaks `op inject`', () => {
    // Measured 2026-08-26: the header once read "Names + <a bare reference>
    // pointers", and `op inject` — which scans the WHOLE file, not just the
    // expressions — failed the entire resolve with "invalid secret reference
    // 'op://pointers': too few '/'". One word of prose took the push path down,
    // and the error named a reference nobody had written on purpose.
    const stripped = out.replace(/\{\{[^{}]*\}\}/g, '');
    assert.equal(
      /op:\/\//.test(stripped),
      false,
      'a secret reference outside {{ }} fails the whole `op inject`',
    );
  });

  it('tells a reader how to regenerate the file AND to delete it again', () => {
    assert.match(out, /op inject -i apps\/worker\/\.dev\.vars\.tpl/);
    assert.match(out, /rm apps\/worker\/\.dev\.vars/);
  });
});

describe('parseAllPairs — unlike parseDevVars, it KEEPS the empty ones', () => {
  it('keeps a NAME= line so the template can carry the drop-box', () => {
    const got = parseAllPairs(['# c', '', 'A=1', 'B=', 'C = "x"', 'NOTAPAIR'].join('\n'));
    assert.deepEqual(got, { A: '1', B: '', C: 'x' });
  });

  it('handles the spaced form the real file uses', () => {
    assert.deepEqual(parseAllPairs('ANTHROPIC_API_KEY_FRIEND_SAM = ""'), {
      ANTHROPIC_API_KEY_FRIEND_SAM: '',
    });
  });
});

describe('--keys-dir — the second caller (catalog-platform/docs/access/keys)', () => {
  it('derives the NAME from the FILE name', () => {
    assert.equal(keyNameFromFile('estate-conductor-token.txt'), 'ESTATE_CONDUCTOR_TOKEN');
    assert.equal(keyNameFromFile('estate-events-token.txt'), 'ESTATE_EVENTS_TOKEN');
    assert.equal(keyNameFromFile('claude-usage-token.txt'), 'CLAUDE_USAGE_TOKEN');
  });

  it('⚠️ --bare titles those estate-wide singletons by NAME alone', () => {
    // One FILE is one value there, and the file name IS the secret's name
    // estate-wide — no second holder uses that name for anything else. A falsy
    // holder is how the run says so.
    for (const f of ['estate-conductor-token.txt', 'estate-events-token.txt', 'claude-usage-token.txt']) {
      const name = keyNameFromFile(f);
      assert.equal(itemTitle(name, null), name);
      // …and the DEFAULT is still scoped, because a .dev.vars is one instance's
      // view and an unclassified key there must not look estate-wide.
      assert.equal(itemTitle(name), `library.${name}`);
    }
  });

  it('labels its items with the CALLING repo, not this one', () => {
    assert.ok(tagsFor('ESTATE_EVENTS_TOKEN', 'catalog-platform').includes('catalog-platform'));
    assert.equal(tagsFor('ESTATE_EVENTS_TOKEN', 'catalog-platform').includes('library_catalog'), false);
    assert.ok(tagsFor('ESTATE_EVENTS_TOKEN', 'catalog-platform').includes('estate'));
    // …and the default is unchanged for this repo's own runs.
    assert.ok(tagsFor('HARDCOVER_API_TOKEN').includes('library_catalog'));
  });

  it('carries the value into a bare-titled template just the same', () => {
    const tpl = itemTemplate('ESTATE_EVENTS_TOKEN', FAKE, null, 'catalog-platform');
    assert.equal(tpl.title, 'ESTATE_EVENTS_TOKEN');
    assert.equal(tpl.fields.find((f) => f.id === 'password').value, FAKE);
    assert.deepEqual(tpl.tags, ['estate', 'catalog-platform', 'credential']);
  });
});

describe('⚠️ a person never sees a bare status code', () => {
  it('names the authorization refusal for what it is, and what to do', () => {
    const stderr = '[ERROR] 2026/08/26 16:03:20 authorization prompt dismissed, please try again';
    assert.ok(isAuthorizationRefusal(stderr));
    const msg = opFailureMessage('create', 'HARDCOVER_API_TOKEN', { code: 1, stderr });
    assert.match(msg, /did not authorize/);
    assert.match(msg, /approve it/i);
    assert.match(msg, /Nothing was written/);
    // "exit 1" alone would send someone hunting a bug that is a click.
    assert.equal(/exited 1\.$/.test(msg), false);
  });

  it('recognises the timeout form too — the same human step, unclicked', () => {
    assert.ok(isAuthorizationRefusal('[ERROR] authorization timeout'));
    assert.equal(isAuthorizationRefusal('some unrelated failure'), false);
  });

  it('still says something useful when the cause is NOT authorization', () => {
    const msg = opFailureMessage('create', 'X', { code: 2, stderr: 'vault "Nope" not found' });
    assert.match(msg, /vault "Nope" not found/);
    assert.match(msg, /op exited 2/);
  });
});

describe('the holder default', () => {
  it('is this repo`s MAIN instance as the estate directory knows it', () => {
    assert.equal(HOLDER, 'library');
    assert.equal(VAULT, 'Estate');
  });
});
