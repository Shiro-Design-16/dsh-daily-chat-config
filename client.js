/**
 * Client half of the daily-chat-config plugin.
 *
 * The product idea: the `daily` agent preset (see the sibling plugin
 * `@local/dsh-daily-chat`) is a *user-editable* configuration, but today the
 * only way to change it is to hand-edit the YAML inside the DSH install. This
 * half adds one card to this bundle's own row on the Plugins page — 「日常配置」
 * — that shows the effective preset text and lets the user save or reset it:
 *
 *   textarea   = the YAML the settings entry holds right now
 *   「保存」    writes the text into this plugin's settings namespace
 *   「恢复默认」 writes that field empty, which the Host reads as "upstream as-is"
 *   a status line reports the last outcome, host reasons included
 *
 * Key contract — the keyed root SlotMap key `plugins.bundle.config`. The plugin
 * manager declares it and dispatches one entry per bundle, keyed by that
 * bundle's `package.json` name, so the card lands in this bundle's own row on
 * the Plugins page. `key` must stay byte-identical to the package name, or the
 * owner's dispatch finds nothing; `label` is the registrant-localized text the
 * owner may show. It deliberately takes no page in Settings: `settings.section`
 * is the settings shell's own list slot (account, general, models, agent
 * presets), and a bundle outside that shell has no business adding a nav seat
 * beside them.
 *
 * Activating this page must never be able to stop the app. An entry whose
 * `inject` cannot be satisfied stays pending, and the renderer's boot audit
 * treats *any* inactive entry as fatal ("web boot: N entries did not
 * activate"), so `inject` below is deliberately empty and every service is
 * taken lazily instead: `slots` and `locale` through the callback form of
 * `ctx.inject`, which starts a nested plugin rather than suspending this
 * entry, and the settings namespace through a fresh lookup per call.
 *
 * Values travel on the *built-in* client Remote namespace `settings`
 * (`@deepseek-ai/dsh-api-settings-controller`), which every DSH build already
 * mounts; a bundle outside that build cannot add a namespace of its own, so
 * nothing here depends on one. `remote.settings` addresses a plugin by the
 * loader entry id of its Host half — for this bundle `daily-chat-config`, the
 * `id` in `cordis.patch.yml` — and only exposes entries whose Config declares
 * at least one live (`volatile`) field; Settings' own forms have no multiline
 * control, which is why this page paints its own textarea.
 *
 * The Host half's writable field is `yaml` (the contract). {@link fieldOf}
 * still adapts when the described value carries exactly one string field, so
 * a renamed field keeps working instead of silently writing a foreign key.
 *
 * Wire shape — `describe()` answers
 *   { writable, hasDocument, namespaces: [{ ns, schema, value, base?, user?,
 *     applies, secrets, revision, autoGenerate }] }
 * and `update(ns, patch, revision)` answers one such namespace view. (The
 * namespace also answers `replace` and `mutate`; this page writes the one text
 * field and resets it by writing empty, so `update` is all it needs.) Every
 * call resolves a result envelope:
 *   { ok: true, value }  |  { ok: false, error: { code, message } }
 * where `code` is `settings/conflict` for a stale `revision` and
 * `settings/rejected` (or `gateway/*`) otherwise, with the Host's own message
 * kept verbatim. A refusal is therefore always reported in words — never as a
 * silent success — and `settings/conflict` re-reads before asking again.
 *
 * The page styles itself with `--dsw-*` design tokens only (no
 * `@deepseek-ai/dsh-client-ui-primitives` request), so the bundle's module
 * graph stays at React alone and `dsh.client.external` needs no entry.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-daily-chat-config',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace for this plugin's own copy. */
    const LOCALE_NS = 'plugin.daily-chat-config';
    /**
     * The Plugins-page seat: a keyed root slot the plugin manager declares, one
     * entry per bundle, dispatched with that bundle's own package name.
     */
    const PLUGINS_SLOT = 'plugins.bundle.config';
    /**
     * The dispatch key — byte-identical to this bundle's `package.json` name,
     * because the owner keys every entry by `pkg.name`.
     */
    const PLUGIN_KEY = '@local/dsh-daily-chat-config';
    /** Class prefix for every node this page paints. */
    const CLASS = 'dsh-daily-config';
    /** Marks the injected style element so a reload can find it. */
    const STYLE_MARKER = 'data-plugin-css';
    const STYLE_NAME = 'daily-chat-config';
    /**
     * The settings namespace: the Host half's loader entry id, i.e. the `id` in
     * this bundle's `cordis.patch.yml`. Keep the two in step.
     */
    const SETTINGS_NS = 'daily-chat-config';
    /** The Host half's writable Config field (see {@link fieldOf}). */
    const SETTINGS_FIELD = 'yaml';
    /** The built-in client Remote namespace that reaches `@deepseek-ai/dsh-settings`. */
    const SETTINGS_REMOTE = 'remote.settings';
    /** Error code: no settings service, or no writable namespace, to talk to. */
    const NO_SETTINGS = 'daily-config-no-settings';
    /** The settings remote's stale-revision code. */
    const CONFLICT = 'settings/conflict';

    const CSS = [
      `.${CLASS}{display:flex;flex-direction:column;gap:12px;min-width:0;max-width:100%;}`,
      `.${CLASS}-title{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);}`,
      `.${CLASS}-description{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);}`,
      `.${CLASS}-notice{margin:0;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;`,
      `border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}`,
      `.${CLASS}-editor{width:100%;min-height:360px;box-sizing:border-box;padding:10px 12px;`,
      `resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;`,
      `background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);`,
      `font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);`,
      `font-size:var(--dsw-font-xs-13,13px);line-height:1.6;tab-size:2;white-space:pre;overflow:auto;}`,
      `.${CLASS}-editor:focus{outline:none;border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color);}`,
      `.${CLASS}-editor:disabled{opacity:.6;}`,
      `.${CLASS}-actions{display:flex;align-items:center;gap:8px;}`,
      `.${CLASS}-button{appearance:none;padding:7px 14px;border:1px solid var(--dsw-alias-border-l2);`,
      `border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);`,
      `font-family:inherit;font-size:13px;line-height:1;cursor:pointer;}`,
      `.${CLASS}-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}`,
      `.${CLASS}-button:disabled{opacity:.5;cursor:default;}`,
      `.${CLASS}-button-primary{border-color:transparent;`,
      `background:var(--dsw-alias-brand-primary-new-colorprimary-new-color);color:#fff;}`,
      `.${CLASS}-status{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;`,
      `font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);}`,
      `.${CLASS}-status[data-tone="ok"] .${CLASS}-status-message{color:var(--dsw-alias-state-business-primary);}`,
      `.${CLASS}-status[data-tone="error"] .${CLASS}-status-message{color:var(--dsw-alias-state-error-primary);}`,
    ].join('');

    const zh = {
      nav: '日常配置',
      title: '日常配置',
      description:
        '这里编辑的是 daily 预设的完整配置文本（YAML）。「保存」写入本插件的设置项，新建的日常会话随即使用新配置；「恢复默认」把该设置项重置为插件自带的默认值。',
      editorLabel: 'daily 预设配置文本',
      loading: '正在读取当前配置…',
      loadFailed: '读取配置失败',
      save: '保存',
      reset: '恢复默认',
      saving: '正在保存…',
      resetting: '正在恢复默认…',
      saved: '已保存',
      saveFailed: '保存失败',
      resetDone: '已恢复默认',
      resetFailed: '恢复默认失败',
      noService:
        '宿主未提供设置服务：本部署的 DSH 没有可用的官方「设置」服务，读取和保存都不可用。',
      noEntry:
        '宿主半未启用：本插件在宿主侧还没有可写的设置项（宿主部分尚未声明可写配置），读取和保存都不可用。启用宿主部分后重新加载即可。',
      readonly: '当前 profile 的配置文件不可写：可以查看当前生效的配置文本，但无法保存。',
      unavailable: '设置服务暂时不可用：读取失败，保存已禁用。',
      conflict: '设置已在别处被修改：已重新读取最新值，请确认后再保存。',
      idle: '尚未操作',
    };

    const en = {
      nav: 'Daily config',
      title: 'Daily config',
      description:
        'Edit the full configuration text (YAML) of the daily agent preset. Save writes this plugin\'s settings entry, so new daily chats pick it up; Reset restores that entry to the shipped defaults.',
      editorLabel: 'daily preset configuration text',
      loading: 'Reading the current configuration…',
      loadFailed: 'Reading the configuration failed',
      save: 'Save',
      reset: 'Reset to default',
      saving: 'Saving…',
      resetting: 'Resetting…',
      saved: 'Saved',
      saveFailed: 'Saving failed',
      resetDone: 'Reset to default',
      resetFailed: 'Reset failed',
      noService:
        'This deployment offers no settings service: the official Settings service is missing, so reading and saving are unavailable.',
      noEntry:
        'The Host half is not enabled: this plugin has no writable settings entry on the Host side yet (no live Config field declared), so reading and saving are unavailable. Enable the Host part and reload.',
      readonly:
        'The current profile\'s configuration file is not writable: the effective text stays visible, but it cannot be saved.',
      unavailable: 'The settings service is temporarily unavailable: reading failed, saving is disabled.',
      conflict: 'The settings entry changed elsewhere: the latest value has been re-read, please review before saving again.',
      idle: 'No action yet',
    };

    /** A thrown value as display text. */
    function reasonText(reason) {
      if (reason instanceof Error && reason.message !== '') return reason.message;
      if (typeof reason === 'string' && reason !== '') return reason;
      return String(reason);
    }

    /** The Remote result envelope's failure face: `{ code, message }`, or undefined on success. */
    function failureOf(response) {
      if (response === null || typeof response !== 'object' || response.ok !== false) return undefined;
      const error = response.error !== null && typeof response.error === 'object' ? response.error : {};
      return {
        code: typeof error.code === 'string' && error.code !== '' ? error.code : 'remote/unknown',
        message: typeof error.message === 'string' && error.message !== '' ? error.message : '',
      };
    }

    /** The envelope's payload; a bare value (no envelope) passes through. */
    function payloadOf(response) {
      return response !== null && typeof response === 'object' && response.ok === true
        ? response.value
        : response;
    }

    /** A failure envelope as an Error carrying the Host's own message and code. */
    function refused(failure) {
      const error = new Error(failure.message === '' ? failure.code : failure.message);
      error.code = failure.code;
      return error;
    }

    /** An Error saying this deployment has no settings service to talk to. */
    function noSettings() {
      const error = new Error(`daily-chat-config: the remote namespace "settings" is unavailable`);
      error.code = NO_SETTINGS;
      return error;
    }

    /** A rejection as one of the four states the page draws, from its code. */
    function degradedReason(reason) {
      if (reason instanceof Error && reason.code === NO_SETTINGS) return 'noService';
      // An absent provider surfaces as gateway/internal from the settings
      // controller; either way the page can only say the service is missing.
      if (reason instanceof Error && reason.code === 'gateway/internal') return 'noService';
      return 'unavailable';
    }

    /** The descriptor this page edits — the namespace matching the entry id. */
    function namespaceOf(described, ns) {
      const list =
        described !== null && typeof described === 'object' && Array.isArray(described.namespaces)
          ? described.namespaces
          : [];
      return list.find((entry) => entry !== null && typeof entry === 'object' && entry.ns === ns);
    }

    /** String-typed field names the described schema declares. */
    function stringFieldsOf(schema) {
      const dict = schema !== null && typeof schema === 'object' ? schema.dict : undefined;
      if (dict === null || typeof dict !== 'object') return [];
      return Object.entries(dict)
        .filter(([, node]) => node !== null && typeof node === 'object' && node.type === 'string')
        .map(([key]) => key);
    }

    /**
     * The field this page edits: the `yaml` contract when the namespace has it,
     * else the namespace's only string field, else the contract name (an
     * unknown key is refused by the Host with a readable reason, not silently
     * dropped).
     */
    function fieldOf(entry) {
      const value = entry !== null && typeof entry === 'object' ? entry.value : undefined;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const keys = Object.keys(value).filter((key) => typeof value[key] === 'string');
        if (keys.includes(SETTINGS_FIELD)) return SETTINGS_FIELD;
        if (keys.length === 1) return keys[0];
        const declared = stringFieldsOf(entry.schema);
        if (declared.includes(SETTINGS_FIELD)) return SETTINGS_FIELD;
        if (declared.length === 1) return declared[0];
        if (keys.length > 1) return keys[0];
        if (declared.length > 1) return declared[0];
      }
      return SETTINGS_FIELD;
    }

    /** One described container's text for `field`: the string itself, or a readable dump. */
    function textFrom(container, field) {
      if (typeof container === 'string') return container;
      if (container === null || typeof container !== 'object') return '';
      const raw = container[field];
      if (typeof raw === 'string') return raw;
      return raw === undefined ? '' : JSON.stringify(raw, null, 2);
    }

    /** One field as a patch for `update()`. */
    function patchOf(field, text) {
      return { [field]: text };
    }

    /**
     * The page's settings access face — the built-in `settings` Remote.
     *
     * The namespace is looked up on every call rather than captured once at
     * registration: nothing orders the settings service ahead of this bundle,
     * and a deployment may not mount it at all (see the header). An absent
     * service rejects with a {@link noSettings} error so the page can say so in
     * words, while a service that *is* there still lets real refusals through
     * with the Host's own message, so those stay visible instead of being
     * mistaken for a missing half.
     *
     * `ctx.reflect.get` reads a service without the `inject` requirement and
     * answers `undefined` when nothing provides it.
     */
    function settingsAccess(ctx, ns) {
      const remote = () => {
        const found = ctx.reflect.get(SETTINGS_REMOTE);
        return found === undefined || found === null ? undefined : found;
      };

      /** Run one method against a present service and normalize its envelope. */
      const perform = async (api, method, run) => {
        let response;
        try {
          response = await run(api);
        } catch (reason) {
          throw reason instanceof Error ? reason : new Error(reasonText(reason));
        }
        const failure = failureOf(response);
        if (failure !== undefined) throw refused(failure);
        return payloadOf(response);
      };

      const call = (method, run) => {
        const api = remote();
        if (api === undefined || typeof api[method] !== 'function') return Promise.reject(noSettings());
        return perform(api, method, run);
      };

      return {
        ns,
        describe: () => call('describe', (api) => api.describe()),
        update: (patch, revision) => call('update', (api) => api.update(ns, patch, revision)),
        // 「恢复默认」 writes the field empty: the Host half reads empty as "use
        // the upstream preset as-is". The Remote has no "drop the stored
        // override" operation, so an empty text *is* the reset this contract
        // defines, and the Host applies it without persisting anything.
        reset: (field, revision) =>
          call('update', (api) => api.update(ns, patchOf(field, ''), revision)),
      };
    }

    /** One Plugins-page card. All settings access arrives as props from the registration's inject face. */
    function DailyConfigSection(props) {
      const t = props.t;
      const [text, setText] = React.useState('');
      const [field, setField] = React.useState(SETTINGS_FIELD);
      const [revision, setRevision] = React.useState(undefined);
      const [overridden, setOverridden] = React.useState(false);
      const [loaded, setLoaded] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      /** '' while the page can write; else the degraded reason it draws. */
      const [blocked, setBlocked] = React.useState('');
      const [status, setStatus] = React.useState(undefined);
      const alive = React.useRef(true);

      React.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);

      // The registration's inject face is cached per entry, so `props.describe`
      // / `props.update` / `props.reset` keep one identity across renders (the
      // props object itself does not — depending on it would re-run the mount
      // effect every render).
      /** Adopt one described namespace, returning the degraded reason it draws ('' when writable). */
      const adoptEntry = React.useCallback((entry, writable) => {
        if (entry === undefined) {
          setBlocked('noEntry');
          setLoaded(true);
          return 'noEntry';
        }
        const name = fieldOf(entry);
        setField(name);
        setText(textFrom(entry.value, name));
        setRevision(entry.revision);
        setOverridden(
          entry.base !== undefined && textFrom(entry.value, name) !== textFrom(entry.base, name),
        );
        const reason = writable === false ? 'readonly' : '';
        setBlocked(reason);
        setLoaded(true);
        return reason;
      }, []);

      const load = React.useCallback(async () => {
        const described = await props.describe();
        if (!alive.current) return '';
        return adoptEntry(namespaceOf(described, props.ns), described && described.writable);
      }, [adoptEntry, props.describe, props.ns]);

      /**
       * A conflict refresh: take the new revision — and whether the stored text
       * still differs from the default — without overwriting the draft the user
       * is holding, so a refused save is never silently undone.
       */
      const refreshRevision = React.useCallback((entry) => {
        if (entry === undefined) return;
        const name = fieldOf(entry);
        setRevision(entry.revision);
        setOverridden(
          entry.base !== undefined && textFrom(entry.value, name) !== textFrom(entry.base, name),
        );
      }, []);

      React.useEffect(() => {
        setStatus({ tone: 'info', text: t('loading') });
        load()
          .then((blockedReason) => {
            if (!alive.current) return;
            // A namespace that is not there, or a read-only document, is a state
            // the notice spells out; the status line repeats it rather than idle.
            setStatus(
              blockedReason === undefined || blockedReason === ''
                ? undefined
                : { tone: 'error', text: t(blockedReason) },
            );
          })
          .catch((reason) => {
            if (!alive.current) return;
            // A missing service is this half's own diagnostic; the notice below
            // says it in the user's language rather than leaking the namespace
            // name into the UI. Any other failure carries the Host's own words.
            const synthetic = reason instanceof Error && reason.code === NO_SETTINGS;
            setBlocked(degradedReason(reason));
            setLoaded(true);
            setStatus({
              tone: 'error',
              text: synthetic ? t('loadFailed') : `${t('loadFailed')}: ${reasonText(reason)}`,
            });
          });
      }, [load, t]);

      /** Save or reset, then adopt the Host's answer so the editor shows the stored text. */
      const run = React.useCallback(
        async (kind) => {
          setBusy(true);
          setStatus({ tone: 'info', text: t(kind === 'save' ? 'saving' : 'resetting') });
          try {
            const entry =
              kind === 'save'
                ? await props.update(patchOf(field, text), revision)
                : await props.reset(field, revision);
            if (!alive.current) return;
            adoptEntry(entry, true);
            setStatus({ tone: 'ok', text: kind === 'save' ? t('saved') : t('resetDone') });
          } catch (reason) {
            if (!alive.current) return;
            // A stale revision is its own outcome: re-read before asking again,
            // and never report the refused write as saved. The draft stays put —
            // only the revision and the default-comparison are refreshed, so the
            // next attempt writes the user's text against the current state.
            if (reason instanceof Error && reason.code === CONFLICT) {
              try {
                const described = await props.describe();
                if (alive.current) refreshRevision(namespaceOf(described, props.ns));
              } catch (refreshFailure) {
                // A failed refresh must not hide the conflict itself.
              }
              if (alive.current) {
                setStatus({
                  tone: 'error',
                  text: `${t('saveFailed')}: ${t('conflict')} (${reasonText(reason)})`,
                });
              }
              return;
            }
            setStatus({
              tone: 'error',
              text: `${t(kind === 'save' ? 'saveFailed' : 'resetFailed')}: ${reasonText(reason)}`,
            });
          } finally {
            if (alive.current) setBusy(false);
          }
        },
        [
          adoptEntry,
          field,
          props.describe,
          props.ns,
          props.reset,
          props.update,
          refreshRevision,
          revision,
          t,
          text,
        ],
      );

      const disabled = busy || blocked !== '';

      return h('section', { className: CLASS }, [
        h('h2', { key: 'title', className: `${CLASS}-title` }, t('title')),
        h('p', { key: 'description', className: `${CLASS}-description` }, t('description')),
        blocked === '' ? null : h('p', { key: 'notice', className: `${CLASS}-notice` }, t(blocked)),
        h('textarea', {
          key: 'editor',
          className: `${CLASS}-editor`,
          value: text,
          disabled,
          spellCheck: false,
          'aria-label': t('editorLabel'),
          onChange: (event) => setText(event.target.value),
        }),
        h('div', { key: 'actions', className: `${CLASS}-actions` }, [
          h(
            'button',
            {
              key: 'save',
              type: 'button',
              className: `${CLASS}-button ${CLASS}-button-primary`,
              disabled: disabled || !loaded,
              onClick: () => {
                void run('save');
              },
            },
            busy ? t('saving') : t('save'),
          ),
          overridden && blocked === ''
            ? h(
                'button',
                {
                  key: 'reset',
                  type: 'button',
                  className: `${CLASS}-button`,
                  disabled,
                  onClick: () => {
                    void run('reset');
                  },
                },
                t('reset'),
              )
            : null,
        ]),
        h(
          'div',
          {
            key: 'status',
            className: `${CLASS}-status`,
            'data-tone': status === undefined ? 'idle' : status.tone,
          },
          [
            h(
              'span',
              { key: 'message', className: `${CLASS}-status-message` },
              status === undefined ? t('idle') : status.text,
            ),
          ],
        ),
      ]);
    }

    return {
      // Deliberately empty. A declared dependency that nothing satisfies leaves
      // this entry pending, and the renderer reports any inactive entry as a
      // fatal boot error — naming a remote namespace here is what took the app
      // down before. The services are taken lazily instead; see the header.
      inject: [],

      apply(ctx) {
        // Callback form: this starts a nested plugin that waits for `slots` and
        // `locale` on its own instead of holding up — or failing — the entry
        // this bundle was loaded as.
        ctx.inject(['slots', 'locale'], (scoped) => {
          scoped.effect(
            () => scoped.locale.register(LOCALE_NS, { zh, en }),
            'daily-chat-config: dictionaries',
          );
          const t = scoped.locale.bind(LOCALE_NS);

          scoped.effect(() => {
            const style = document.createElement('style');
            style.setAttribute(STYLE_MARKER, STYLE_NAME);
            style.textContent = CSS;
            document.head.append(style);
            return () => style.remove();
          }, 'daily-chat-config: page styles');

          // `plugins.bundle.config` is declared by the plugin manager, which may
          // load after this bundle: inject() waits for the declaration instead
          // of failing on an undeclared slot. The owner dispatches this keyed
          // slot with props of its own (`view`, `entryKey`) — the card ignores
          // both and reads only the inject face below.
          scoped.slots.inject(PLUGINS_SLOT, () =>
            scoped.slots.register(
              {
                name: PLUGINS_SLOT,
                key: PLUGIN_KEY,
                label: () => t('nav'),
                locale: LOCALE_NS,
                inject: () => settingsAccess(scoped, SETTINGS_NS),
              },
              DailyConfigSection,
            ),
          );
        });
      },
    };
  },
});
