/**
 * daily-chat-config · 宿主半边
 *
 * 用户要改的是 `daily` agent preset 的子条目列表（`config.plugins`，persona 就在那一层）。
 * 宿主半边把它作为一个字符串字段交给**官方设置存储**，不再自己解析、自己写 profile 覆盖文件：
 *
 *   - `Config.yaml` 是 `.volatile()` 字段：DSH 的 settings 服务按本插件条目 id
 *     （`daily-chat-config`）派生设置表单，用户在设置页里编辑的就是它；值由官方的配置编辑器
 *     写进当前 profile 的 `cordis.patch.yml` 覆盖记录，本插件不碰任何文件。
 *   - 值的含义 = entry-list YAML 文本（`preset/daily.patch.yml` 里 `config.plugins` 的字面单位，
 *     也是 registry `readDocument('daily')` 渲染出来的那一份子列表）。空文本 = 用上游默认。
 *   - 生效只走 loader 的**内存挂载**：找到 `preset-daily` 行后 `entry.fiber.update(next, true)`
 *     （`noSave`）重挂 preset。挂载时推一次，之后每次 volatile 提交（`loader/volatile-update`）
 *     再推一次。不用 `loader.update('preset-daily', …)`：行住在 include 子树的 store 里（`resolve`
 *     按 `:` 分段，行 id 是 `include:preset-daily`），而 `EntryTree.update` 会先调
 *     `tree.write()`——那会把用户的 profile patch 重写成一份完整组合列表（注释、结构都变）。
 *     fiber 直挂既不落盘也不动行选项。不写 override 行——持久化只有上面那一个来源。
 *   - 非法文本在 schema 层被拒：配置编辑器写盘前会先校验目标 Config，所以「拒绝且一个字节不动」
 *     由官方层保证；apply 侧再兜一次，手工改坏的 patch 文件不会把运行中的 preset 带崩。
 *   - 可观测日志（headless 集成验证与事后排障用）：每条都带 `[daily-chat-config]` 前缀，只含条目标识、
 *     子条目行数与来源（`mount` / `volatile-update` / `entry-init` / `reset-to-base`），**不含用户文本**；
 *     同时写 `ctx.logger.<level>` 与 `process.stderr`（本运行期的 Logger 没有 exporter，stderr 是唯一留痕通道）。
 */
import z from '@deepseek-ai/schemastery'
import { isSeq, parseDocument } from 'yaml'

/** preset 的 id 与它在 loader 里的行 id（规则：`preset-` + config.id）。 */
const PRESET_ID = 'daily'
const PRESET_ROW_ID = `preset-${PRESET_ID}`

/**
 * `!!js` 表达式按 dsh-app-boot 的做法构造成表达式节点，由 loader 在条目激活时求值；
 * 降级成普通字符串会让条件恒真，反倒害得对应条目被禁掉。
 */
const PARSE_OPTIONS = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => ({ __jsExpr: value }) }] }

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** `!!js` 表达式在解析结果里的形状；当 name 用是合法的。 */
const isExpression = (value) => isRecord(value) && typeof value.__jsExpr === 'string'

/** 逐行校验一个子条目；返回可读中文原因，'' 表示通过。label 会出现在原因里。 */
function entryProblem(row, label) {
  if (!isRecord(row)) return `${label}必须是映射（形如 “- name: …”）。`
  const name = row.name
  if (typeof name !== 'string' || name.trim().length === 0) {
    if (!isExpression(name)) return `${label}缺少 name：每个条目都要有 name（组件名，或 group 用的 cordis:group）。`
  }
  const group = row.group === true || name === 'cordis:group'
  if (group) {
    if (!Array.isArray(row.config)) return `${label}是 group 行，config 必须是它的子条目列表。`
  } else if (row.config !== undefined && row.config !== null && !isRecord(row.config) && !Array.isArray(row.config)) {
    return `${label}的 config 必须是映射（该条目的参数）。`
  }
  if (Array.isArray(row.config)) {
    for (const [index, child] of row.config.entries()) {
      const problem = entryProblem(child, `${label}的子列表第 ${index + 1} 行`)
      if (problem !== '') return problem
    }
  }
  return ''
}

/**
 * 校验用户文本；返回可读中文原因，'' 表示通过。空文本合法——它表示「用上游默认」。
 * 规则与配置编辑器写盘前的校验一致（顶层是行列表、每行有 name、group 行的 config 是嵌套列表）。
 * YAML 报错只取首行：yaml 的完整消息里可能带一段用户原文（snippet + 脱字符行），首行已含原因与位置。
 */
export function presetTextProblem(text) {
  if (typeof text !== 'string') return '配置文本必须是字符串。'
  if (text.trim().length === 0) return ''
  const document = parseDocument(text, PARSE_OPTIONS)
  const problem = document.errors[0]
  if (problem !== undefined) return `不是合法的 YAML：${String(problem.message).split('\n')[0]}`
  if (!isSeq(document.contents)) return '顶层必须是子条目列表：每一行形如 “- name: …”。'
  const rows = document.toJS()
  if (!Array.isArray(rows)) return '顶层必须是子条目列表：每一行形如 “- name: …”。'
  for (const [index, row] of rows.entries()) {
    const reason = entryProblem(row, `第 ${index + 1} 行`)
    if (reason !== '') return reason
  }
  return ''
}

/**
 * 唯一的设置字段：子条目列表的 YAML 文本。
 * `z.transform` 在写入前抛错拒绝非法文本（配置编辑器的写盘校验会把它变成一个可读的失败），
 * `.volatile()` 让它变更后实时生效，`.default('')` 表示「没设置 = 用上游默认」。
 */
const YamlText = z.transform(z.string(), (text) => {
  const problem = presetTextProblem(text)
  if (problem !== '') throw new Error(problem)
  return text
}).default('').volatile()

export const Config = z.object({ yaml: YamlText })

/** 只依赖 loader：它是宿主必然在场的服务，不会让本条目停在 pending 上。 */
export const inject = ['loader']

export function apply(ctx, config) {
  /** 当前字段值：resolved config 里的 volatile 字段是 cosmokit 的 Volatile 引用。 */
  const currentText = () => {
    const field = config?.yaml
    const value = typeof field?.get === 'function' ? field.get() : field
    return typeof value === 'string' ? value : ''
  }

  /**
   * 可观测日志：统一前缀，只输出条目标识/行数/来源，绝不输出用户文本。
   * 双通道 —— `ctx.logger.<level>` 留给别的部署里可能存在的文件型 exporter；同时镜像到 `process.stderr`，
   * 因为本运行期的 Logger 根本没有 exporter：cordis 的 Logger 只写内部 buffer，归档里唯一的 exporter 是
   * `dsh-app-boot` 的启动诊断收集器（`levels: { default: 2 }`，只在抛出的 StartupError 上挂载、从不打印），
   * 实测 warn 级在真机日志里同样零命中。stderr 是唯一能留痕的通道：app-boot 自己的诊断
   *（`skipping profile bundle …` / `disabling profile plugin …`）也是 `process.stderr.write` 写的。
   * 功能信号走 warn 而不是 info：别的部署里文件型 exporter 会按 levels 过滤，warn/error 才是稳的。
   * 瞬时状态（等待行）只走 logger，不镜像 stderr —— 免得每次启动都往 stderr 刷两行。
   */
  const log = (level, message, { stderr = true } = {}) => {
    const line = `[daily-chat-config] ${message}`
    ctx.logger?.[level]?.(line)
    if (stderr) {
      try {
        process.stderr.write(`${line}\n`)
      } catch {
        // stderr 被关掉（或写入抛错）不能影响应用本身
      }
    }
  }

  /** 挂载时从 preset 行捕获的原始 config；清空文本时原样写回。只捕获一次，避免捕获到自己的结果。 */
  let base
  /** 上一次推给 preset 的 config 指纹：同值重复挂载会白白重启 preset 一次。 */
  let pushed
  /** preset 行还没出现/还没激活时的重试次数（每个 apply 生命期最多 40 × 50ms）。 */
  let attempts = 0
  /** 已在日志里报过的等待状态：50ms 重试链只报一次状态变化，不刷屏。 */
  let waiting = ''

  const presetRow = () => {
    const loader = ctx.get('loader')
    const entries = loader?.entries?.()
    if (entries === undefined) return undefined
    for (const entry of entries) if (entry?.options?.id === PRESET_ROW_ID) return entry
    return undefined
  }

  /** source = 本次应用的触发来源（mount / volatile-update / entry-init），重试链沿用同一个来源。 */
  const applyText = (source) => {
    const entry = presetRow()
    // 行还没挂上，或还没激活（本插件的 apply 常跑在 daily-chat 的 bundle 行之前）：稍后再试；
    // loader/entry-init 也会在行出现时再叫一次。
    const fiber = entry?.fiber
    if (fiber?.state !== 2) {
      const state = entry === undefined ? 'row not mounted yet' : `row mounted but not active (state=${fiber?.state})`
      if (waiting !== state) {
        waiting = state
        log('info', `waiting for ${PRESET_ROW_ID}: ${state} — nothing applied yet (source=${source})`, { stderr: false })
      }
      if (attempts < 40) {
        attempts += 1
        setTimeout(() => schedule(source), 50)
      } else if (attempts === 40) {
        attempts = 41
        log('warn', `${PRESET_ROW_ID} 一直没出现或没激活，停止重试（source=${source}）`)
      }
      return
    }
    attempts = 0
    waiting = ''
    if (base === undefined) base = structuredClone(entry.options.config ?? {})
    if (!isRecord(base) || Object.keys(base).length === 0) {
      log('warn', `${PRESET_ROW_ID} 行没有可用的 config，跳过应用（source=${source}）`)
      return
    }
    const text = currentText()
    const empty = text.trim().length === 0
    if (empty && pushed === undefined) {
      log('warn', `text is empty and nothing was applied before — nothing to restore (source=${source})`)
      return
    }
    let next
    if (empty) {
      next = structuredClone(base)
    } else {
      const problem = presetTextProblem(text)
      if (problem !== '') {
        log('warn', `文本不合法（${problem}），保持现状（source=${source}）`)
        return
      }
      next = { ...structuredClone(base), plugins: parseDocument(text, PARSE_OPTIONS).toJS() }
    }
    const fingerprint = JSON.stringify(next)
    if (fingerprint === pushed) {
      log('warn', `${PRESET_ROW_ID} 已经是这份 config — no remount (source=${source})`)
      return
    }
    // noSave：把新 config 挂到运行中的 preset 上（跑 schema 校验与 `!!js` 插值），不落盘、不改行选项。
    fiber.update(next, true)
    pushed = fingerprint
    const rows = Array.isArray(next.plugins) ? next.plugins.length : 0
    log(
      'warn',
      empty
        ? `text is empty — restored the captured config: ${rows} rows (source=reset-to-base, trigger=${source})`
        : `applied ${rows} rows to ${PRESET_ROW_ID} (source=${source})`,
    )
  }

  const schedule = (source = 'mount') => {
    try {
      applyText(source)
    } catch (error) {
      // 只取首行并截断：子插件的校验错误可能引用用户文本里的值，日志里不留原文。
      const detail = String(error?.message ?? error).split('\n')[0].slice(0, 200)
      log('warn', `应用 ${PRESET_ROW_ID} 失败（${detail}）`)
    }
  }

  // 保存后：loader 的 volatile 提交路径通知本条目，即时重推。
  ctx.on('loader/volatile-update', () => schedule('volatile-update'))
  // 挂载顺序兜底：preset 行晚于本插件出现时，它一 init 我们就补上。entry-init 在 Entry 构造里就
  // 发出、此时 options 还没赋值（cordis-plugin-loader/lib/index.js:323），所以只能延后一拍重扫。
  let scanning = false
  ctx.on('loader/entry-init', () => {
    if (scanning) return
    scanning = true
    setTimeout(() => {
      scanning = false
      schedule('entry-init')
    }, 0)
  })
  schedule('mount')
}
