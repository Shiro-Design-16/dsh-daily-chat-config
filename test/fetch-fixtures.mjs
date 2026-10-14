/* Fixture builder for host-harness.mjs.
 *
 * The host half imports `yaml` plus four `@deepseek-ai/*` packages. Those imports
 * must resolve to the code the *running app* actually ships, so this script lifts
 * the whole dependency closure out of the app archive and links it into a
 * throw-away farm that both ../index.js and host-harness.mjs resolve through.
 *
 *   node test/fetch-fixtures.mjs
 *
 * Provenance rule: fixtures come from the app archive and nothing else. Never
 * point the farm at `dsh-tauri` or another retired copy - the 0.1.x line has a
 * different contract surface, and a stale farm silently poisons every assertion
 * (that already happened once: 67 checks passed against 0.1.7-rc.1 code).
 */
import { lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const APP_ASAR = process.env.DCC_APP_ASAR
  ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
/** Archive-relative prefix of the app's own dependency tree (harness root is `/dsh/`). */
const ARCHIVE_PREFIX = 'dsh/node_modules/'
/** Packages the plugin imports directly; the closure is walked from here. */
const ROOTS = [
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/cordis',
  'yaml',
]
const FIXTURE_ROOT = resolve(process.env.DCC_FIXTURE_ROOT ?? join(tmpdir(), 'daily-chat-config-fixtures'))
const FARM_ROOT = resolve(process.env.DCC_FARM_ROOT ?? fileURLToPath(new URL('../../node_modules/', import.meta.url)))
/** Paths that must never appear anywhere in this flow. */
const RETIRED = ['dsh-tauri', 'io.github.hairyf.deepseek-harness-desktop']

for (const needle of RETIRED) {
  for (const [label, path] of [['DCC_FIXTURE_ROOT', FIXTURE_ROOT], ['DCC_FARM_ROOT', FARM_ROOT], ['DCC_APP_ASAR', APP_ASAR]]) {
    if (path.includes(needle)) throw new Error(`${label} 指到了已废弃的副本（${path}）；夹具必须来自正在运行的 App`)
  }
}
if (!existsSync(APP_ASAR)) throw new Error(`找不到 App 归档：${APP_ASAR}（用 DCC_APP_ASAR 覆盖）`)
const TEMP_ROOTS = [...new Set([tmpdir(), '/tmp', '/private/tmp'].map((path) => resolve(path)))]
const insideTmp = TEMP_ROOTS.some((root) => FIXTURE_ROOT.startsWith(root + '/'))
if (!insideTmp) {
  throw new Error(`夹具目录必须落在临时目录（${TEMP_ROOTS.join(' 或 ')}）里，拒绝操作 ${FIXTURE_ROOT}`)
}

const buffer = await readFile(APP_ASAR)
const u32 = (offset) => buffer.readUInt32LE(offset)

/* ---- asar header (same probing the throw-away reader used) ---- */
let header
for (const [start, candidate] of [[16, u32(12)], [12, u32(8)], [8, u32(4) - 4]]) {
  if (candidate <= 0 || start + candidate > buffer.length) continue
  try {
    const parsed = JSON.parse(buffer.subarray(start, start + candidate).toString('utf8'))
    if (parsed?.files) {
      header = parsed
      break
    }
  } catch {}
}
if (header === undefined) throw new Error(`无法解析 asar 头：${APP_ASAR}`)
const base = 8 + u32(4)

const entries = new Map()
const walk = (node, prefix) => {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (child.files) walk(child, path)
    else entries.set(path, { offset: Number(child.offset), size: child.size, unpacked: child.unpacked === true })
  }
}
walk(header, '')

const readEntry = (path) => {
  const entry = entries.get(path)
  if (entry === undefined || entry.unpacked) return undefined
  return buffer.subarray(base + entry.offset, base + entry.offset + entry.size)
}

/* ---- dependency closure, resolved inside the archive only ---- */
const manifests = new Map()
const missing = new Set()
const queue = [...ROOTS]
while (queue.length > 0) {
  const name = queue.shift()
  if (manifests.has(name) || missing.has(name)) continue
  const raw = readEntry(`${ARCHIVE_PREFIX}${name}/package.json`)
  if (raw === undefined) {
    missing.add(name)
    continue
  }
  const manifest = JSON.parse(raw.toString('utf8'))
  manifests.set(name, manifest)
  for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    if (!manifests.has(dep) && !missing.has(dep)) queue.push(dep)
  }
}

/* ---- extract every closure package, keeping nested node_modules as they are ---- */
await rm(FIXTURE_ROOT, { recursive: true, force: true })
const extracted = new Map()
const unpackedSkipped = []
for (const name of manifests.keys()) {
  const prefix = `${ARCHIVE_PREFIX}${name}/`
  let bytes = 0
  let files = 0
  for (const [path, entry] of entries) {
    if (!path.startsWith(prefix)) continue
    if (entry.unpacked) {
      unpackedSkipped.push(path)
      continue
    }
    const target = join(FIXTURE_ROOT, 'node_modules', path.slice(ARCHIVE_PREFIX.length))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, buffer.subarray(base + entry.offset, base + entry.offset + entry.size))
    bytes += entry.size
    files += 1
  }
  extracted.set(name, { files, bytes })
}

/* ---- one live file is an input, not an app package: snapshot it for reproducibility ---- */
const SNAPSHOTS = [
  ['daily.patch.yml', process.env.DCC_UPSTREAM_PRESET ?? join(process.env.HOME ?? '', '.dsh/profiles/desktop/node_modules/@local/dsh-daily-chat/preset/daily.patch.yml')],
]
const snapshots = []
for (const [name, source] of SNAPSHOTS) {
  if (!existsSync(source)) {
    snapshots.push({ name, source, missing: true })
    continue
  }
  const text = await readFile(source, 'utf8')
  const target = join(FIXTURE_ROOT, 'presets', name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text)
  snapshots.push({ name, source, target, md5: createHash('md5').update(text).digest('hex'), lines: text.split('\n').length - 1 })
}

/* ---- link the farm: replace our own symlinks only, never a real directory ---- */
const fixtureReal = await realpath(FIXTURE_ROOT)
const linked = []
const kept = []
const stale = []
for (const name of manifests.keys()) {
  const linkPath = join(FARM_ROOT, name)
  const target = join(FIXTURE_ROOT, 'node_modules', name)
  await mkdir(dirname(linkPath), { recursive: true })
  let existing
  try {
    existing = await lstat(linkPath)
  } catch {}
  if (existing !== undefined && !existing.isSymbolicLink()) {
    // A real entry is not ours (it may come from an install) and it outranks the
    // fixtures, so keep it but never silently: host-harness.mjs also asserts this.
    kept.push(name)
    continue
  }
  if (existing !== undefined) {
    // A stale link that resolves outside the fixture root is exactly the failure
    // this script exists to prevent (0.1.x copy et al.): replace it and say so.
    const current = await realpath(linkPath).catch(() => '')
    if (!current.startsWith(fixtureReal + '/')) stale.push(`${name} -> ${current === '' ? '(dangling)' : current}`)
    await rm(linkPath, { force: true })
  }
  await symlink(target, linkPath, 'dir')
  linked.push(name)
}

/* ---- report ---- */
const digest = createHash('md5').update(buffer).digest('hex')
console.log(`app archive  ${APP_ASAR}`)
console.log(`             md5 ${digest} · ${(buffer.length / 1048576).toFixed(1)} MiB · ${entries.size} entries`)
console.log(`fixtures     ${FIXTURE_ROOT}/node_modules`)
console.log(`farm         ${FARM_ROOT}  (${linked.length} links${kept.length === 0 ? '' : `, ${kept.length} kept in place`})`)
for (const item of stale) console.log(`replaced     stale link pointed outside the fixture root: ${item}`)
for (const name of kept) console.log(`WARNING      ${join(FARM_ROOT, name)} is a real entry (not ours) and outranks the fixtures — remove it if it is not an intentional install`)
console.log('')
console.log('package'.padEnd(40) + 'version'.padEnd(14) + 'files'.padStart(6) + 'KiB'.padStart(8))
for (const name of [...ROOTS, ...[...manifests.keys()].filter((n) => !ROOTS.includes(n)).sort()]) {
  const manifest = manifests.get(name)
  if (manifest === undefined) continue
  const stat = extracted.get(name)
  console.log(name.padEnd(40) + String(manifest.version).padEnd(14) + String(stat.files).padStart(6) + (stat.bytes / 1024).toFixed(0).padStart(8))
}
console.log('')
console.log('input snapshot'.padEnd(26) + 'md5'.padEnd(36) + 'lines'.padStart(6) + '  source')
for (const snap of snapshots) {
  if (snap.missing) {
    console.log(snap.name.padEnd(26) + 'MISSING'.padEnd(36) + ''.padStart(6) + `  ${snap.source}`)
    continue
  }
  console.log(snap.name.padEnd(26) + snap.md5.padEnd(36) + String(snap.lines).padStart(6) + `  ${snap.source}`)
}
if (missing.size > 0) console.log(`\nnot in the archive (skipped): ${[...missing].sort().join(', ')}`)
if (unpackedSkipped.length > 0) console.log(`unpacked in the archive (skipped): ${unpackedSkipped.length} entries`)
console.log('\nnext: node test/host-harness.mjs')
