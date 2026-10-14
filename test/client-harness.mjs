/* Self-check harness for ../client.js.
 *
 * It drives the *real* bundle against a stub of the *official* client Remote
 * namespace `settings` (the one `@deepseek-ai/dsh-api-settings-controller`
 * exposes), in every state the page has to draw:
 *
 *   N1  activation safety        — inject is empty, no self-built namespace
 *   N2  lazy service acquisition — callback form of ctx.inject
 *   N3  registration + wire face — keyed Plugins-page seat, settings.section gone
 *   N4  no settings service      — tagged rejection + degraded view
 *   N5  envelope handling        — describe/update/reset, refusal, conflict
 *   N6  healthy page             — read, save, reset, refused write
 *   N7  namespace states         — not registered, read-only, provider gone
 *
 * No install, no network, no real DOM.
 *
 * Run: node test/client-harness.mjs
 */
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

let captured;
global.window = { __ModuleLoader__: { load: (m) => { captured = m; } } };
/* The bundle paints its own stylesheet through document; give it a bare DOM. */
global.document = {
  createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
  head: { append() {} },
};
/* The bundle is an ES module (the package is `type: module`) that only
 * touches globals, so a plain dynamic import executes it. Its text is read
 * first: the wire face it may reference is part of what gets asserted. */
const bundle = new URL('../client.js', import.meta.url);
const source = await readFile(bundle, 'utf8');
await import(bundle.href);

/* ---- minimal React with a real hook runtime ---- */
function makeReact() {
  const hooks = [];
  let cursor = 0;
  let schedule = () => {};
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(init) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init;
      return [
        hooks[i],
        (v) => {
          const next = typeof v === 'function' ? v(hooks[i]) : v;
          if (!Object.is(next, hooks[i])) {
            hooks[i] = next;
            schedule();
          }
        },
      ];
    },
    useRef(init) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { current: init };
      return hooks[i];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      const prev = hooks[i];
      if (!prev || !same(prev.deps, deps)) hooks[i] = { kind: 'callback', fn, deps };
      return hooks[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const prev = hooks[i];
      if (!prev) hooks[i] = { kind: 'effect', fn, deps, cleanup: undefined, ran: false };
      else if (!same(prev.deps, deps)) {
        prev.fn = fn;
        prev.deps = deps;
        prev.ran = false;
      }
    },
    /** Run pending effects (React's commit phase). */
    _flush() {
      for (const h of hooks) {
        if (h && h.kind === 'effect' && !h.ran) {
          h.ran = true;
          if (typeof h.cleanup === 'function') h.cleanup();
          const c = h.fn();
          h.cleanup = typeof c === 'function' ? c : undefined;
        }
      }
    },
    /** Start a render pass: hooks are keyed by call index, as in React. */
    _beginRender() {
      cursor = 0;
    },
    _setSchedule(fn) {
      schedule = fn;
    },
    /** Fresh hook store, as a new mount would get. */
    _reset() {
      hooks.length = 0;
      cursor = 0;
    },
  };
  return React;
}

/* ---- element-tree helpers ---- */
function walk(node, visit) {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== 'object') return;
  visit(node);
  if (Array.isArray(node.children)) node.children.forEach((c) => walk(c, visit));
}
const findAll = (tree, pred) => {
  const out = [];
  walk(tree, (n) => {
    if (pred(n)) out.push(n);
  });
  return out;
};
const byClass = (tree, cls) => findAll(tree, (n) => n.props && n.props.className === cls);
const textOf = (n) => {
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (!n || typeof n !== 'object' || !Array.isArray(n.children)) return '';
  return n.children.map(textOf).join('');
};
const buttonsOf = (tree) => findAll(tree, (n) => n.type === 'button');
const statusOf = (tree) => byClass(tree, 'dsh-daily-config-status')[0];
const noticeOf = (tree) => byClass(tree, 'dsh-daily-config-notice')[0];
const editorOf = (tree) => byClass(tree, 'dsh-daily-config-editor')[0];

const React = makeReact();
const mod = captured.factory((id) => {
  assert.strictEqual(id, 'react', `unexpected require(${id})`);
  return React;
});

/* ---- activation, dictionaries, and the rendered session ---- */

/** Reflect maps are built from this so a check can swap the Remote mid-session. */
function remoteHolder(initial) {
  const box = { current: initial };
  const remotes = {
    get 'remote.settings'() {
      return box.current;
    },
  };
  return { box, remotes };
}

/**
 * Run one activation of the bundle against `remotes` and hand back the page's
 * registration face, Component, and the dictionaries it registered (the real
 * copy, so assertions can quote the shipped Chinese text).
 */
function activate(remotes) {
  const lookups = [];
  const dictionaries = {};
  const registrations = [];
  const ctx = {
    reflect: {
      get: (name) => {
        lookups.push(name);
        return remotes[name];
      },
    },
    effect: (fn) => fn(),
    inject: (deps, cb) => {
      ctx.deferred = { deps, cb };
      return { deps, cb };
    },
  };
  mod.apply(ctx);
  const scoped = {
    reflect: ctx.reflect,
    effect: (fn) => fn(),
    locale: {
      register: (ns, dicts) => {
        dictionaries[ns] = dicts;
      },
      bind: (ns) => (key) => (dictionaries[ns] && dictionaries[ns].zh[key]) || key,
    },
    slots: {
      inject: (name, cb) => cb(),
      register: (options, Component) => registrations.push({ options, Component }),
    },
  };
  ctx.deferred.cb(scoped);
  const registration = registrations[0];
  return {
    lookups,
    dictionaries,
    deferred: ctx.deferred,
    registration,
    Component: registration.Component,
    face: registration.options.inject(),
  };
}

const copyOf = (page) => Object.values(page.dictionaries)[0];
const translator = (page) => {
  const zh = copyOf(page).zh;
  return (key) => (key in zh ? zh[key] : key);
};

/**
 * Mount `Component` on the shared hook runtime with `props`, then drive it:
 * `settle()` lets pending promises land, `type()` edits the textarea, and
 * `click()` presses a labelled button.
 */
function mount(page, props) {
  React._reset();
  let dirty = true;
  React._setSchedule(() => {
    dirty = true;
  });
  const session = { tree: undefined };
  const pass = () => {
    React._beginRender();
    session.tree = page.Component(props);
    React._flush();
  };
  session.settle = async (rounds = 16) => {
    for (let round = 0; round < rounds; round += 1) {
      await new Promise((r) => setImmediate(r));
      dirty = false;
      pass();
      if (!dirty) break;
    }
    return session.tree;
  };
  session.type = async (value) => {
    editorOf(session.tree).props.onChange({ target: { value } });
    return session.settle();
  };
  session.click = async (label) => {
    const button = buttonsOf(session.tree).find((b) => textOf(b) === label);
    if (!button) throw new Error(`no button labelled ${label}`);
    if (button.props.disabled) throw new Error(`button ${label} is disabled`);
    button.props.onClick();
    return session.settle();
  };
  pass();
  return session;
}

/* ---- a stub of the official settings Remote ---- */

const NAMESPACE = 'daily-chat-config';

/** One namespace view exactly as `describe`/`update` answer it. */
const nsView = (yaml, revision, extra = {}) => ({
  ns: NAMESPACE,
  autoGenerate: false,
  schema: { type: 'object', dict: { yaml: { type: 'string', meta: { default: '' } } } },
  value: { yaml },
  base: { yaml: '' },
  applies: 'live',
  secrets: [],
  revision,
  ...extra,
});

const described = (namespaces, writable = true) => ({
  ok: true,
  value: { writable, hasDocument: true, namespaces },
});

/**
 * A stateful settings Remote: `stored` is what a save writes, `refuse` makes
 * every write answer a failure envelope, and `calls` records the wire traffic.
 */
function settingsServer(initial) {
  const server = {
    stored: initial,
    revision: 7,
    refuse: undefined,
    calls: [],
  };
  server.remote = {
    describe: async () => {
      server.calls.push({ op: 'describe', revision: server.revision });
      return described([nsView(server.stored, server.revision)]);
    },
    update: async (ns, patch, revision) => {
      server.calls.push({ op: 'update', ns, patch, revision });
      if (server.refuse !== undefined) return { ok: false, error: { ...server.refuse } };
      server.stored = patch.yaml;
      server.revision += 1;
      return { ok: true, value: nsView(server.stored, server.revision) };
    },
    replace: async (ns, section, revision) => {
      server.calls.push({ op: 'replace', ns, section, revision });
      return { ok: true, value: nsView(server.stored, server.revision) };
    },
  };
  return server;
}

(async () => {
  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push(`PASS  ${name}`);
    } catch (error) {
      results.push(`FAIL  ${name}\n      ${error.message}`);
      process.exitCode = 1;
    }
  };

  /* N1 — the entry requires nothing, and depends on no namespace of its own. */
  await check('N1 inject is empty (no service can leave the entry pending)', () => {
    assert.ok(Array.isArray(mod.inject), 'inject must be an array');
    assert.strictEqual(mod.inject.length, 0, `inject = ${JSON.stringify(mod.inject)}`);
  });
  await check('N1b the bundle reaches only the built-in settings namespace', () => {
    const referenced = [...source.matchAll(/remote\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]);
    assert.deepStrictEqual(
      [...new Set(referenced)],
      ['settings'],
      `remote namespaces referenced: ${JSON.stringify(referenced)}`,
    );
    assert.ok(!/dailyConfig/.test(source), 'the retired self-built namespace must be gone');
  });

  /* N2 — apply() never throws when nothing at all is mounted. */
  const effects = [];
  const bare = {
    reflect: { get: () => undefined },
    effect: (fn, name) => {
      effects.push(name);
      return fn();
    },
    inject: (deps, cb) => {
      bare.deferred = { deps, cb };
      return { deps, cb };
    },
  };
  let applyError;
  try {
    mod.apply(bare);
  } catch (error) {
    applyError = error;
  }
  await check('N2 apply() with an empty runtime does not throw', () => {
    assert.strictEqual(applyError, undefined, `threw: ${applyError && applyError.message}`);
  });
  await check('N2b deferred services are taken via the callback form of ctx.inject', () => {
    assert.ok(bare.deferred, 'ctx.inject was never called');
    assert.deepStrictEqual(
      [...bare.deferred.deps].sort(),
      ['locale', 'slots'],
      `deps = ${JSON.stringify(bare.deferred.deps)}`,
    );
  });

  /* N3 — the keyed plugins-page seat and the wire face's lookup name. */
  const offlineHolder = remoteHolder(undefined);
  const offline = activate(offlineHolder.remotes);
  await check('N3 registration is the keyed plugins.bundle.config seat', () => {
    assert.ok(offline.registration, 'the page never registered');
    const { options } = offline.registration;
    assert.strictEqual(options.name, 'plugins.bundle.config');
    assert.strictEqual(options.key, 'dsh-daily-chat-config');
    assert.strictEqual(options.label(), copyOf(offline).zh.nav);
    assert.strictEqual(options.id, undefined, 'a keyed seat carries no list id');
    assert.strictEqual(options.order, undefined, 'a keyed seat carries no list order');
  });
  await check('N3b the old settings.section seat is gone', () => {
    assert.notStrictEqual(offline.registration.options.name, 'settings.section');
    assert.ok(!/['"]settings\.section['"]/.test(source), 'client.js still registers the settings section slot');
  });
  await check('N3c the face resolves its service by the built-in name only', async () => {
    await offline.face.describe().catch(() => {});
    assert.deepStrictEqual([...new Set(offline.lookups)], ['remote.settings'], JSON.stringify(offline.lookups));
  });

  /* N4 — no settings service: tagged rejection, degraded view, honest status. */
  const offlineCodes = [];
  for (const [method, run] of [
    ['describe', () => offline.face.describe()],
    ['update', () => offline.face.update({ yaml: 'x' }, 1)],
    ['reset', () => offline.face.reset('yaml', 1)],
  ]) {
    try {
      await run();
      offlineCodes.push(`${method}:resolved`);
    } catch (error) {
      offlineCodes.push(`${method}:${error && error.code}`);
    }
  }
  await check('N4 with no settings service every call rejects with daily-config-no-settings', () => {
    assert.deepStrictEqual(offlineCodes, [
      'describe:daily-config-no-settings',
      'update:daily-config-no-settings',
      'reset:daily-config-no-settings',
    ]);
  });

  const offlineSession = mount(offline, { t: translator(offline), ...offline.face });
  await offlineSession.settle();
  await check('N4b the degraded view shows the 「宿主未提供设置服务」 notice with disabled controls', () => {
    const zh = copyOf(offline).zh;
    const notice = noticeOf(offlineSession.tree);
    assert.ok(notice, 'no notice node');
    assert.strictEqual(textOf(notice), zh.noService, textOf(notice));
    assert.strictEqual(editorOf(offlineSession.tree).props.disabled, true, 'editor must be disabled');
    const buttons = buttonsOf(offlineSession.tree);
    assert.ok(buttons.length >= 1, 'expected a save button');
    for (const button of buttons) {
      assert.strictEqual(button.props.disabled, true, `button ${textOf(button)} must be disabled`);
    }
  });
  await check('N4c the degraded status line speaks Chinese and leaks no internals', () => {
    const zh = copyOf(offline).zh;
    const status = statusOf(offlineSession.tree);
    if (!status) throw new Error('no status node');
    assert.strictEqual(status.props['data-tone'], 'error', 'tone must be error');
    assert.strictEqual(textOf(status), zh.loadFailed, textOf(status));
    assert.ok(!/settings|dailyConfig|daily-chat-config/.test(textOf(status)), `internals leaked: ${textOf(status)}`);
  });

  /* N5 — the wire face against a live Remote: payloads, refusals, conflict. */
  const wire = settingsServer('name: daily');
  const wireHolder = remoteHolder(wire.remote);
  const live = activate(wireHolder.remotes);
  await check('N5 describe() unwraps the official envelope', async () => {
    const view = await live.face.describe();
    assert.strictEqual(wire.calls[0].op, 'describe', JSON.stringify(wire.calls));
    assert.strictEqual(view.writable, true);
    assert.strictEqual(view.namespaces[0].ns, NAMESPACE);
    assert.strictEqual(view.namespaces[0].value.yaml, 'name: daily');
  });
  await check('N5b update() sends the patch and the revision that was read', async () => {
    const view = await live.face.update({ yaml: 'name: typed' }, 7);
    const call = wire.calls.filter((c) => c.op === 'update').at(-1);
    assert.strictEqual(call.ns, NAMESPACE, `ns = ${call.ns}`);
    assert.deepStrictEqual(call.patch, { yaml: 'name: typed' });
    assert.strictEqual(call.revision, 7, 'expectedRevision must be the revision read from describe');
    assert.strictEqual(view.value.yaml, 'name: typed');
  });
  await check('N5c a refusal keeps the Host code and message', async () => {
    wire.refuse = { code: 'settings/rejected', message: '服务端拒绝：yaml 不是合法的子列表 YAML' };
    let caught;
    try {
      await live.face.update({ yaml: 'x' }, 8);
    } catch (error) {
      caught = error;
    }
    wire.refuse = undefined;
    assert.ok(caught, 'a refused write must reject');
    assert.strictEqual(caught.code, 'settings/rejected');
    assert.strictEqual(caught.message, '服务端拒绝：yaml 不是合法的子列表 YAML');
  });
  await check('N5d a stale revision keeps settings/conflict', async () => {
    wire.refuse = { code: 'settings/conflict', message: 'settings namespace "daily-chat-config" changed since it was read' };
    let caught;
    try {
      await live.face.update({ yaml: 'x' }, 8);
    } catch (error) {
      caught = error;
    }
    wire.refuse = undefined;
    assert.ok(caught, 'a stale write must reject');
    assert.strictEqual(caught.code, 'settings/conflict');
  });
  await check('N5e reset() writes the field empty and never needs replace()', async () => {
    await live.face.reset('yaml', 7);
    const call = wire.calls.filter((c) => c.op === 'update').at(-1);
    assert.deepStrictEqual(call.patch, { yaml: '' }, JSON.stringify(call.patch));
    assert.strictEqual(call.revision, 7);
    assert.ok(!wire.calls.some((c) => c.op === 'replace'), 'replace must stay unused');
  });

  /* N6 — the healthy page: read, save, reset, refused write, conflict. */
  const server = settingsServer('name: daily\nplugins:\n  - local-x');
  const holder = remoteHolder(server.remote);
  const page = activate(holder.remotes);
  const props = { t: translator(page), ...page.face };
  const session = mount(page, props);
  await session.settle();
  const zh = copyOf(page).zh;

  await check('N6 the healthy view holds the effective text and shows no notice', () => {
    assert.strictEqual(noticeOf(session.tree), undefined, 'no notice expected');
    const editor = editorOf(session.tree);
    assert.strictEqual(editor.props.value, server.stored);
    assert.strictEqual(editor.props.disabled, false, 'editor must be editable');
    assert.strictEqual(
      buttonsOf(session.tree).find((b) => textOf(b) === zh.save).props.disabled,
      false,
      'save must be enabled',
    );
  });
  await check('N6b save writes the draft with the revision read from describe', async () => {
    const typed = 'name: daily\nplugins:\n  - local-y';
    await session.type(typed);
    await session.click(zh.save);
    const call = server.calls.filter((c) => c.op === 'update').at(-1);
    assert.deepStrictEqual(call.patch, { yaml: typed }, JSON.stringify(call.patch));
    assert.strictEqual(call.revision, 7, 'the write must carry the revision that describe returned');
    assert.strictEqual(statusOf(session.tree).props['data-tone'], 'ok');
    assert.strictEqual(textOf(statusOf(session.tree)), zh.saved);
    assert.strictEqual(editorOf(session.tree).props.value, typed);
  });
  await check('N6c reset writes empty, reports it, and hides itself again', async () => {
    assert.ok(
      buttonsOf(session.tree).some((b) => textOf(b) === zh.reset),
      'a custom text must offer reset',
    );
    await session.click(zh.reset);
    const call = server.calls.filter((c) => c.op === 'update').at(-1);
    assert.deepStrictEqual(call.patch, { yaml: '' }, JSON.stringify(call.patch));
    assert.strictEqual(call.revision, 8, 'the reset must use the revision the save returned');
    assert.strictEqual(textOf(statusOf(session.tree)), zh.resetDone);
    assert.strictEqual(editorOf(session.tree).props.value, '');
    assert.ok(
      !buttonsOf(session.tree).some((b) => textOf(b) === zh.reset),
      'no reset button once the field is empty again',
    );
  });
  await check('N6d a refused write shows the Host reason and never claims success', async () => {
    const reason = '服务端拒绝：yaml 第 2 行缺少 "-"';
    server.refuse = { code: 'settings/rejected', message: reason };
    const typed = 'name: daily\nplugins:\n  broken';
    await session.type(typed);
    await session.click(zh.save);
    server.refuse = undefined;
    const status = statusOf(session.tree);
    assert.strictEqual(status.props['data-tone'], 'error', 'a refused save is an error');
    assert.strictEqual(textOf(status), `${zh.saveFailed}: ${reason}`, textOf(status));
    assert.ok(!textOf(status).includes(zh.saved), 'a refused save must not read as saved');
    assert.strictEqual(editorOf(session.tree).props.value, typed, 'the draft must survive the refusal');
  });
  await check('N6e a conflict re-reads the revision, keeps the draft, and re-arms the write', async () => {
    const before = server.calls.filter((c) => c.op === 'describe').length;
    const typed = 'name: daily\nplugins:\n  broken';
    server.refuse = {
      code: 'settings/conflict',
      message: 'settings namespace "daily-chat-config" changed since it was read (expected revision 9, now 10)',
    };
    await session.click(zh.save);
    server.refuse = undefined;
    const status = statusOf(session.tree);
    assert.strictEqual(status.props['data-tone'], 'error');
    assert.ok(textOf(status).includes(zh.conflict), textOf(status));
    assert.ok(textOf(status).includes(zh.saveFailed), textOf(status));
    assert.strictEqual(
      server.calls.filter((c) => c.op === 'describe').length,
      before + 1,
      'the conflict path must re-read the namespace',
    );
    assert.strictEqual(
      editorOf(session.tree).props.value,
      typed,
      'the draft must survive the conflict refresh',
    );
    await session.click(zh.save);
    const call = server.calls.filter((c) => c.op === 'update').at(-1);
    assert.strictEqual(call.revision, 9, 'the next write must carry the revision the refresh returned');
    assert.strictEqual(textOf(statusOf(session.tree)), zh.saved);
  });

  /* N7 — namespace states: not registered, read-only, provider gone. */
  const otherHolder = remoteHolder({
    describe: async () => described([nsView('x', 1, { ns: 'other-plugin' })]),
  });
  const other = activate(otherHolder.remotes);
  const otherSession = mount(other, { t: translator(other), ...other.face });
  await otherSession.settle();
  await check('N7 an unregistered namespace degrades with the 「宿主半未启用」 notice', () => {
    const zhOther = copyOf(other).zh;
    assert.strictEqual(textOf(noticeOf(otherSession.tree)), zhOther.noEntry);
    assert.strictEqual(textOf(statusOf(otherSession.tree)), zhOther.noEntry);
    assert.strictEqual(statusOf(otherSession.tree).props['data-tone'], 'error');
    assert.strictEqual(editorOf(otherSession.tree).props.disabled, true);
    for (const button of buttonsOf(otherSession.tree)) {
      assert.strictEqual(button.props.disabled, true, `button ${textOf(button)} must be disabled`);
    }
  });

  const readOnlyHolder = remoteHolder({
    describe: async () => described([nsView('name: daily', 3)], false),
  });
  const readOnly = activate(readOnlyHolder.remotes);
  const readOnlySession = mount(readOnly, { t: translator(readOnly), ...readOnly.face });
  await readOnlySession.settle();
  await check('N7b a read-only document keeps the text visible but disables saving', () => {
    const zhReadOnly = copyOf(readOnly).zh;
    assert.strictEqual(textOf(noticeOf(readOnlySession.tree)), zhReadOnly.readonly);
    const editor = editorOf(readOnlySession.tree);
    assert.strictEqual(editor.props.value, 'name: daily', 'the effective text stays visible');
    assert.strictEqual(editor.props.disabled, true);
    const save = buttonsOf(readOnlySession.tree).find((b) => textOf(b) === zhReadOnly.save);
    assert.strictEqual(save.props.disabled, true, 'save must be disabled');
  });

  const goneHolder = remoteHolder({
    describe: async () => ({
      ok: false,
      error: {
        code: 'gateway/internal',
        message: 'settings service is absent: mount @deepseek-ai/dsh-settings with @deepseek-ai/dsh-config-editor',
      },
    }),
  });
  const gone = activate(goneHolder.remotes);
  const goneSession = mount(gone, { t: translator(gone), ...gone.face });
  await goneSession.settle();
  await check('N7c a provider-less Host is degraded, with its own diagnostic quoted', () => {
    const zhGone = copyOf(gone).zh;
    assert.strictEqual(textOf(noticeOf(goneSession.tree)), zhGone.noService);
    assert.strictEqual(editorOf(goneSession.tree).props.disabled, true);
    const status = statusOf(goneSession.tree);
    assert.strictEqual(status.props['data-tone'], 'error');
    assert.ok(
      textOf(status).includes('settings service is absent'),
      `the Host diagnostic must be quoted: ${textOf(status)}`,
    );
  });

  console.log(`bundle: ${bundle.pathname}`);
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} checks passed`);
})();
