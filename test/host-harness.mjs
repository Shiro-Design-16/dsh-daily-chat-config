/* Offline acceptance harness for the host half.
 *
 *   node test/fetch-fixtures.mjs      # once: fixtures from the running app's asar
 *   node test/host-harness.mjs        # then: 设置字段 schema + 应用/还原 + 负例
 *
 * 覆盖四件事：
 *   1. 官方设置存储的形状：`Config.yaml` 必须是 `.volatile()` 字段（schemastery 来自 DSH 的包，
 *      只有它会把 volatile 字段包成 cosmokit 的 Volatile 引用；loader 的 volatile 提交路径遍历
 *      的就是这些引用）。
 *   2. 应用语义：只走 loader 内存挂载，挂载时推一次、volatile 提交后再推一次，空文本还原 base，
 *      非法文本一个字节都不动（schema 层拒绝 + apply 侧兜底）。
 *   3. 可观测日志：headless 集成验证要 grep 的信号（功能信号走 warn —— 本部署 Logger 只导出 warn/error，
 *      info 不可见），且日志里不出现用户文本。
 *   4. 不再有任何文件写入：静态源码审计 + 模块导出面。
 *
 * 一切都在 $TMPDIR 下运行；不碰任何真实 profile。所有路径都从 import.meta.url 或显式绝对路径
 * 出发，因此任何 cwd 下行为一致。
 */
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { isMap, isSeq, parseDocument, stringify } from 'yaml'

const RUN = resolve(process.env.DCC_RUN_ROOT ?? join(tmpdir(), 'daily-chat-config-harness'), 'run')
const ARTIFACTS = join(dirname(RUN), 'artifacts')
/** Fixtures fetched from the running app by test/fetch-fixtures.mjs (realpath: /var vs /private/var). */
const FIXTURE_ROOT_RAW = resolve(process.env.DCC_FIXTURE_ROOT ?? join(tmpdir(), 'daily-chat-config-fixtures'))
const fixtureRoot = existsSync(FIXTURE_ROOT_RAW) ? realpathSync(FIXTURE_ROOT_RAW) : FIXTURE_ROOT_RAW
/** The host half under test; resolved from this file, never from cwd. */
const PLUGIN_ENTRY = new URL('../index.js', import.meta.url)
/** Upstream default config: ships with the third-party `daily` bundle (not an app package). */
const UPSTREAM_PRESET_PATCH = resolve(process.env.DCC_UPSTREAM_PRESET ?? join(fixtureRoot, 'presets', 'daily.patch.yml'))
/** `!!js` 表达式按 dsh-app-boot 的做法解析成表达式节点（harness 只用来读 fixture）。 */
const JS_TAGS = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (v) => ({ __jsExpr: v }) }] }

let failed = 0
let checks = 0
const ok = (label, extra = '') => console.log(`PASS  ${label}${extra ? ' · ' + extra : ''}`)
const bad = (label, extra = '') => { failed += 1; console.log(`FAIL  ${label}${extra ? ' · ' + extra : ''}`) }
const check = (condition, label, extra = '') => { checks += 1; return condition ? ok(label, extra) : bad(label, extra) }
const md5 = (text) => createHash('md5').update(text).digest('hex')
const readText = (file) => readFile(file, 'utf8')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/* stderr 是本运行期唯一能留痕的通道：截住 process.stderr.write 来断言镜像行（harness 自己不写 stderr）。 */
const stderrLines = []
process.stderr.write = (chunk) => { stderrLines.push(String(chunk)); return true }

/* ---------- fixtures: prove where the imports came from before asserting anything ---------- */
const FIXTURE_PACKAGES = ['yaml', '@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/cosmokit']
console.log(`harness      ${fileURLToPath(import.meta.url)}`)
console.log(`run dir      ${RUN}`)
const resolvedFixtures = {}
for (const name of FIXTURE_PACKAGES) {
  const path = fileURLToPath(import.meta.resolve(name))
  const manifest = JSON.parse(await readText(join(dirname(dirname(path)), 'package.json')))
  resolvedFixtures[name] = { path, version: manifest.version }
  console.log(`fixture      ${name.padEnd(32)} ${String(manifest.version).padEnd(12)} ${path}`)
}
console.log('')
check(FIXTURE_PACKAGES.every((name) => resolvedFixtures[name].path.startsWith(fixtureRoot + '/')), 'every fixture resolves inside the fetched fixture root', fixtureRoot)
// The plugin must resolve the same fixtures: a stray symlink in any ancestor node_modules would
// otherwise let index.js load a different schemastery than the harness imports.
const { createRequire } = await import('node:module')
const pluginRequire = createRequire(PLUGIN_ENTRY)
check(FIXTURE_PACKAGES.every((name) => pluginRequire.resolve(name).startsWith(fixtureRoot + '/')), 'the plugin resolves every fixture from the same fetch', pluginRequire.resolve('@deepseek-ai/schemastery'))
check(existsSync(UPSTREAM_PRESET_PATCH), 'upstream preset fixture is present', UPSTREAM_PRESET_PATCH)
if (!existsSync(UPSTREAM_PRESET_PATCH)) {
  console.log(`\nrun \`node test/fetch-fixtures.mjs\` first (app packages + the upstream preset snapshot), or point DCC_UPSTREAM_PRESET at it`)
  process.exit(1)
}

const { isVolatile, updateVolatile } = await import('@deepseek-ai/cosmokit')
const plugin = await import(PLUGIN_ENTRY.href)

/* ---------- upstream default: the `preset-daily` row's config ---------- */
await rm(RUN, { recursive: true, force: true })
await mkdir(RUN, { recursive: true })
await mkdir(ARTIFACTS, { recursive: true })
const upstreamRow = parseDocument(await readText(UPSTREAM_PRESET_PATCH), JS_TAGS).contents.items
  .flatMap((item) => (isMap(item) && isSeq(item.get('insert')) ? item.get('insert').items : []))
  .find((item) => isMap(item) && item.get('id') === 'preset-daily')
check(upstreamRow !== undefined, 'upstream fixture has a preset-daily row')
const base = JSON.parse(JSON.stringify(upstreamRow.get('config')))
const pluginsYaml = stringify(base.plugins, { lineWidth: 0 })
const editedYaml = `${pluginsYaml.trimEnd()}\n- id: tool-bash\n  name: "@deepseek-ai/dsh-tool-bash"\n`
console.log(`fixture: preset-daily config ${base.plugins.length} plugins · base md5 ${md5(JSON.stringify(base))}\n`)

/* ---------- 1. schema shape: the official settings storage contract ---------- */
console.log('--- 1. 设置字段 schema ---')
check(typeof plugin.Config === 'function' && typeof plugin.Config.toJSON === 'function', 'Config 是 schemastery schema（toJSON 可供设置服务派生表单）')
check(same(plugin.inject, ['loader']), '模块级 inject 只有 loader（必然在场的服务）', JSON.stringify(plugin.inject))
const fieldSchema = plugin.Config.toJSON()
const fieldRef = Object.values(fieldSchema.refs).find((node) => node.type === 'transform' && node.meta?.volatile === true)
check(fieldRef !== undefined, 'yaml 字段在 toJSON 里带 meta.volatile = true（dsh-settings 的 volatileForm/validatePaths 判据）', JSON.stringify(fieldRef?.meta))
const emptyConfig = plugin.Config({})
check(isVolatile(emptyConfig.yaml), '空配置解析出的 yaml 是 cosmokit Volatile 引用（loader 才提交得进去）')
check(emptyConfig.yaml.get() === '', '空配置的字段值是空串（= 用上游默认）', JSON.stringify(emptyConfig.yaml.get()))
const sampleText = '- name: "@deepseek-ai/dsh-tool-web"\n'
const withText = plugin.Config({ yaml: sampleText })
check(withText.yaml.get() === sampleText, '显式值原样进入 Volatile 引用（不做任何规范化）')

/* ---------- 2. negatives: schema 层拒绝 + 可读中文原因 ---------- */
console.log('\n--- 2. 负例（schema 层拒绝；配置编辑器写盘前先跑这里）---')
const negatives = [
  ['YAML 语法错误', '- name: [oops', '不是合法的 YAML'],
  ['顶层不是列表', 'id: daily\nname: 日常聊天\n', '顶层必须是子条目列表'],
  ['条目缺 name', '- id: tool-web\n', '缺少 name'],
  ['group 行的 config 不是列表', '- name: cordis:group\n  group: true\n  config:\n    threshold: 1\n', 'config 必须是它的子条目列表'],
  ['子列表里的条目缺 name', '- name: cordis:group\n  config:\n    - id: compaction-basic\n', '子列表第 1 行'],
]
for (const [label, text, expected] of negatives) {
  const problem = plugin.presetTextProblem(text)
  check(typeof problem === 'string' && problem.length > 0 && problem.includes(expected), `presetTextProblem 拒绝 ${label}`, problem)
  let thrown
  try { plugin.Config({ yaml: text }) } catch (error) { thrown = error }
  check(thrown !== undefined && thrown.message.includes(expected), `Config 解析抛错拒绝 ${label}（写入前校验就走这条）`, thrown?.message)
}

/* ---------- 3. positive: 上游默认子列表 + 带 !!js 的文本都算合法 ---------- */
console.log('\n--- 3. 正例 ---')
check(plugin.presetTextProblem(pluginsYaml) === '', '上游默认的 plugins 渲染成 YAML 后通过校验')
check(plugin.presetTextProblem('') === '' && plugin.presetTextProblem('  \n') === '', '空文本合法：表示用上游默认')
check(plugin.presetTextProblem(editedYaml) === '', '追加一行 tool-bash 后仍然合法')
const jsYaml = `${pluginsYaml.trimEnd()}\n- id: tool-bash\n  name: "@deepseek-ai/dsh-tool-bash"\n  config:\n    disabled: !!js process.platform === 'win32'\n`
check(plugin.presetTextProblem(jsYaml) === '', '含 !!js 表达式的文本通过校验')

/* ---------- fake loader + ctx：按 loader 的行/事件契约驱动 apply ---------- */
const makeHarness = ({ present = true, active = true } = {}) => {
  const updates = []
  const warnings = []
  const logs = []
  const listeners = new Map()
  const entry = {
    options: { id: 'preset-daily', name: '@deepseek-ai/dsh-agent-preset', config: structuredClone(base) },
    fiber: {
      state: active ? 2 : 0,
      // Fiber.update(config, noSave)（cordis/lib/index.js:1419-1440）：内存重挂，不落盘、不改行选项。
      update: (config, noSave) => { updates.push({ id: 'preset-daily', config, noSave }) },
    },
  }
  const loader = { entry, updates, present, entries: () => (loader.present ? [entry] : []) }
  const ctx = {
    get: (name) => (name === 'loader' ? loader : undefined),
    on: (name, callback) => { const list = listeners.get(name) ?? []; list.push(callback); listeners.set(name, list) },
    logger: {
      info: (...args) => { logs.push(args.map(String).join(' ')) },
      warn: (...args) => { const line = args.map(String).join(' '); warnings.push(line); logs.push(line) },
    },
  }
  const emit = (name, ...args) => { for (const callback of listeners.get(name) ?? []) callback(...args) }
  return { loader, ctx, updates, warnings, logs, emit, listeners, entry }
}
/** loader 的 volatile 提交路径：把新值写进运行中的引用，再通知本条目（loader/lib/config/entry.ts:190-200）。 */
const commit = async (harness, config, text) => {
  updateVolatile(config.yaml, { get: () => text })
  harness.emit('loader/volatile-update', [['yaml']])
  await tick()
}

/* ---------- 4. 应用：挂载 / volatile 提交 / 还原 / 兜底 ---------- */
console.log('\n--- 4. 应用语义 ---')
const harness = makeHarness()
const config = plugin.Config({ yaml: '' })
plugin.apply(harness.ctx, config)
await tick()
check(harness.listeners.get('loader/volatile-update')?.length === 1, 'apply 挂上了 loader/volatile-update 监听')
check(harness.listeners.get('loader/entry-init')?.length === 1, 'apply 挂上了 loader/entry-init 监听（补挂载顺序）')
check(harness.updates.length === 0, '空文本 + 从未应用过：一个 update 都不发（没有要还原的东西）', `${harness.updates.length} updates`)

await commit(harness, config, editedYaml)
check(harness.updates.length === 1, 'volatile 提交后精确推一次', `${harness.updates.length} updates`)
const pushed = harness.updates[0]
check(pushed?.id === 'preset-daily' && pushed?.noSave === true, 'fiber.update(config, true)：noSave 内存挂载（走 loader.update 会先 tree.write() 重写用户的 patch）', JSON.stringify({ id: pushed?.id, noSave: pushed?.noSave }))
check(same(harness.entry.options.config, base), '行选项里的 config 不被改动：base 始终可还原')
const pushedConfig = pushed?.config
check(['id', 'name', 'description', 'order'].every((key) => same(pushedConfig?.[key], base[key])), '行级元数据（id/name/description/order）原样保留')
check(pushedConfig?.plugins?.length === base.plugins.length + 1, '推送的 plugins = 编辑后的子条目列表', `${pushedConfig?.plugins?.length} 项`)
check(pushedConfig?.plugins?.at(-1)?.name === '@deepseek-ai/dsh-tool-bash', '新行按文本内容进入推送的 config')
check(same(pushedConfig?.plugins?.[0], base.plugins[0]), '原有 persona 行逐字段不变（prefix/suffix 保真）', `${String(base.plugins[0].config?.prefix).length} chars`)
await writeFile(join(ARTIFACTS, 'applied-preset-config.json'), JSON.stringify(pushedConfig, null, 2))

await commit(harness, config, editedYaml)
check(harness.updates.length === 1, '同值再提交不发 update（指纹跳过，避免无谓重新挂载）', `${harness.updates.length} updates`)

await commit(harness, config, jsYaml)
const jsPushed = harness.updates.at(-1)?.config?.plugins?.at(-1)
check(jsPushed?.config?.disabled?.__jsExpr === "process.platform === 'win32'", '!!js 表达式以表达式节点推送（loader 激活时求值，没有降级成字符串）', JSON.stringify(jsPushed?.config))
check(harness.updates.length === 2, '!!js 文本同样即时应用（不再需要重启）', `${harness.updates.length} updates`)

await commit(harness, config, '')
check(harness.updates.length === 3 && same(harness.updates.at(-1).config, base), '清空文本 = 原样挂回挂载时捕获的 base（还原上游默认）')
check(harness.warnings.every((line) => line.startsWith('[daily-chat-config] ')), '功能信号走 warn（本部署 Logger 唯一会导出的级别）：每行都带统一前缀', `${harness.warnings.length} 条可见行`)
check(harness.warnings.filter((line) => /applied \d+ rows|restored the captured config/.test(line)).length === 3, '三次落地各留一行可见记录（两次应用 + 一次清空还原）', harness.warnings.join(' | '))

await commit(harness, config, '- name: [oops')
check(harness.updates.length === 3, '手工改坏的文本被 apply 兜住：运行中的 preset 一个字节不动', `${harness.updates.length} updates`)
check(harness.warnings.at(-1).includes('文本不合法'), '兜底路径留下可读 warning（warn 级，headless 看得见）', harness.warnings.at(-1))

/* ---------- 5. 挂载顺序：preset 行晚于本插件出现 / 行还没激活 ---------- */
console.log('\n--- 5. 挂载顺序（apply 早于 preset-daily 行）---')
const late = makeHarness({ present: false })
const lateConfig = plugin.Config({ yaml: editedYaml })
plugin.apply(late.ctx, lateConfig)
await tick()
check(late.updates.length === 0, 'preset 行还没挂上时不推、也不报错', `${late.updates.length} updates`)
// entry-init 在 Entry 构造里就发出、那一刻 options 还没赋值，监听端只能延后一拍重扫。
late.emit('loader/entry-init', { options: {} })
await tick()
check(late.updates.length === 0, '行还没出现：entry-init 后的重扫仍无行可推', `${late.updates.length} updates`)
late.loader.present = true
late.entry.fiber.state = 0
late.emit('loader/entry-init', { options: {} })
await wait(120)
check(late.updates.length === 0, '行出现了但 fiber 还没激活：不推，等重试', `${late.updates.length} updates`)
late.entry.fiber.state = 2
await wait(200)
check(late.updates.length === 1, '行激活后由重试补推一次', `${late.updates.length} updates`)
check(late.updates[0].config.plugins.length === base.plugins.length + 1, '补推的内容与文本一致')
late.emit('loader/entry-init', { options: {} })
await wait(60)
check(late.updates.length === 1, '再次 entry-init 不会重复挂载（指纹去重）', `${late.updates.length} updates`)

/* ---------- 6. 可观测日志：headless 集成验证要看的就是这几行 ---------- */
console.log('\n--- 6. 可观测日志（真机集成验证的信号）---')
const seen = makeHarness()
const seenConfig = plugin.Config({ yaml: '' })
plugin.apply(seen.ctx, seenConfig)
await tick()
check(seen.logs.some((line) => line.includes('text is empty') && line.includes('nothing to restore')), '空文本 + 从未应用过：日志明说「没事可做」', seen.logs.at(-1))
check(seen.updates.length === 0 && seen.warnings.length === 1 && seen.warnings.at(-1).includes('nothing to restore'), '这种情况下不推 config：只有一行可见 warn 明说「没事可做」', seen.warnings.at(-1))

await commit(seen, seenConfig, editedYaml)
// 注意：等待日志里有「nothing applied yet」，所以这里必须匹配真正的落地行。
const appliedLine = (list) => list.find((line) => /applied \d+ rows/.test(line)) ?? ''
const appliedLog = appliedLine(seen.warnings)
check(appliedLog.includes(`${base.plugins.length + 1} rows to preset-daily`) && appliedLog.includes('source=volatile-update'), '成功应用一行 warn（headless 下唯一的端到端证据）：行数 + 来源（source=volatile-update）', appliedLog)
await commit(seen, seenConfig, editedYaml)
check(seen.warnings.at(-1).includes('no remount'), '同值再提交：可见日志明说跳过（一眼分清「做了事」与「没做事」）', seen.warnings.at(-1))
await commit(seen, seenConfig, '')
const resetLog = seen.warnings.at(-1)
check(resetLog.includes('source=reset-to-base') && resetLog.includes(`${base.plugins.length} rows`), '清空回到 base：来源标成 reset-to-base + 还原的行数', resetLog)
check(stderrLines.includes(`${appliedLog}\n`), '结果行同时写 ctx.logger(warn) 与 stderr，文本逐字一致', JSON.stringify(appliedLog))
check(
  ['applied 5 rows', 'restored the captured config', 'nothing to restore', 'no remount'].every((needle) => stderrLines.some((line) => line.includes(needle))),
  '「应用成功 / 清空还原 / 空且没做事 / 同值跳过」四条结果行都镜像到了 stderr',
)
check(!stderrLines.some((line) => line.includes('waiting for')), '瞬时等待行只走 logger（不往 stderr 刷启动噪音）')
check(stderrLines.every((line) => line.startsWith('[daily-chat-config] ') && line.endsWith('\n')), 'stderr 行同样带统一前缀与换行，可直接 grep')
check(late.logs.some((line) => line.includes('waiting for preset-daily: row not mounted yet')), '行还没挂上：日志明说在等行（没做事）', late.logs.find((line) => line.includes('row not mounted yet')))
check(!late.warnings.some((line) => line.includes('waiting for')), '等待行保持 info：每次启动不刷 warn（headless 看不见是已知取舍，等不到时的收尾才是 warn）')
check(late.logs.some((line) => line.includes('row mounted but not active')), '行在但没激活：日志区分出「在等激活」', late.logs.find((line) => line.includes('not active')))
// 补扫（entry-init）与 50ms 重试是两条并行的链，谁先看到 fiber 激活谁就落地；因此这里断言
// 「落地日志带可辨来源」，entry-init 这条链本身的补推由第 5 组的 updates 断言覆盖。
check(/source=(entry-init|mount|volatile-update)\)$/.test(appliedLine(late.warnings)), '补扫/重试路径同样留下一行可见 warn，且来源可辨', appliedLine(late.warnings))

const privacy = makeHarness()
const privacyConfig = plugin.Config({ yaml: '' })
plugin.apply(privacy.ctx, privacyConfig)
await tick()
// yaml 的完整报错消息里会带一段用户原文（snippet + 脱字符行），日志必须只留首行。
const SECRET = 'PRIVACY_TOKEN_DO_NOT_LOG'
check(plugin.presetTextProblem(`- name: [${SECRET}`).includes(SECRET) === false, '可读原因不含用户文本（yaml 报错只取首行）')
await commit(privacy, privacyConfig, `- name: [${SECRET}`)
check(privacy.warnings.some((line) => line.includes('文本不合法') && line.includes('source=')), '非法文本的可见 warning 带来源，且没有用户文本', privacy.warnings.join(' | '))
check(privacy.logs.every((line) => !line.includes(SECRET)), '隐私：非法文本路径的日志里不出现用户文本')
await commit(privacy, privacyConfig, editedYaml)
check(privacy.logs.every((line) => !line.includes('dsh-tool-bash') && !line.includes('prefix')), '隐私：成功路径的日志只含行数/来源，不含文本内容')
check(stderrLines.every((line) => !line.includes(SECRET) && !line.includes('dsh-tool-bash')), '隐私：stderr 镜像行同样不含用户文本')
check(privacy.logs.every((line) => line.length <= 240), '每条日志都短（没有整段文本被带出去）', `最长 ${Math.max(...privacy.logs.map((line) => line.length))} 字符`)
check(privacy.logs.every((line) => line.startsWith('[daily-chat-config] ')), '每条日志都带统一前缀，便于在真机日志里 grep')

// 「一直等不到 preset 行」的收尾必须是可见级别：40 × 50ms 重试耗尽后留一条 warn。
const gone = makeHarness({ present: false })
plugin.apply(gone.ctx, plugin.Config({ yaml: editedYaml }))
await wait(2400)
check(gone.updates.length === 0 && gone.warnings.some((line) => line.includes('停止重试')), '等不到 preset 行：重试耗尽时留一条可见 warn（"一直等不到"）', gone.warnings.at(-1))

/* ---------- 7. 不再写文件：源码审计 + 导出面 ---------- */
console.log('\n--- 7. 没有文件写入 ---')
const source = await readText(fileURLToPath(PLUGIN_ENTRY))
const lines = source.split('\n').length - 1
for (const needle of ['node:fs', 'withFileLock', 'writeFileAtomic', 'writeFile', 'renderNode', 'profileContext', 'TypertRemoteService', 'Remote(', "ctx.get('loader').update(", 'settings.register']) {
  check(!source.includes(needle), `index.js 里没有 ${needle}`)
}
check(!/stringify\s*\(|\.dump\(/.test(source.replace(/JSON\.stringify\s*\(/g, '')), 'yaml 只用来解析：没有 stringify/dump（JSON.stringify 只用于指纹）')
check(source.includes("from '@deepseek-ai/schemastery'"), 'schemastery 取自 DSH 的包（公共包不会把 volatile 字段包成引用）')
check(source.includes('fiber.update('), '应用到运行中的 preset 走 fiber.update(config, true)')
check(!/inject\s*=\s*\[[^\]]*settings/.test(source), "inject 里没有 'settings'（可能缺席的服务不进模块级 inject）")
check(typeof plugin.apply === 'function' && plugin.DailyConfigService === undefined, '导出面：apply + Config（旧的 TypertRemoteService 已删除）', Object.keys(plugin).join(','))
check(source.includes('process.stderr.write') && source.includes('ctx.logger?.[level]'), '双通道都在：ctx.logger 调用保留 + process.stderr 镜像（没引入新 import）')
console.log(`index.js     ${lines} 行 · md5 ${md5(source)}`)

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} · ${checks} 项断言`)
process.exitCode = failed === 0 ? 0 : 1
