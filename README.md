# daily-chat-config

给 DSH 的 `daily` agent preset 加一个编辑入口：**「插件」页 → 本插件那一栏 →「日常配置」**。卡片里显示
当前生效的子条目列表（`preset-daily` 行的 `config.plugins`）的 entry-list YAML 文本，persona 与工具组合
都在这一层。点「保存」把它写进本插件的设置字段（走官方设置服务，落在 profile patch 层里本插件那一行），
点「恢复默认」把字段写空，宿主半随即把上游默认挂回运行中的 preset。

整个过程不碰任何已发布的文件：上游包 `@local/dsh-daily-chat`、`node_modules` 与 DSH 安装目录都保持原样。

## 环境要求

- **DSH `0.2.0-rc.2`** 或更高 —— 用到这一版的 volatile 设置字段、插件页 keyed 根槽 `plugins.bundle.config`，
  以及 `loader/volatile-update` 事件；更早的 0.1.x 契约不同，装上不会生效；
- 上游插件 [`dsh-daily-chat`](https://github.com/corlinniu/dsh-daily-chat) —— 本插件编辑的就是它声明的 `daily` preset；
- 许可证 [MIT](./LICENSE)。

## 它做什么

| 半边 | 文件 | 作用 |
| --- | --- | --- |
| 宿主 | `index.js` | 设置字段 `yaml`（`.volatile()` 字符串 = 子条目列表 YAML）+ 把它应用到 `preset-daily` 行（`entry.fiber.update(config, true)` 内存挂载；不碰任何文件） |
| 宿主 | `cordis.patch.yml` | bundle 补丁层，只插入宿主半边一行（客户端半边由 `package.json` 的 `dsh.client` 声明，不需要另开一行） |
| 宿主 | `package.json` | 包名 `dsh-daily-chat-config`、`dsh.bundle.patch`、`dsh.client`（web 平台 + 客户端模块依赖） |
| 客户端 | `client.js` | **插件页**本插件那一栏的「日常配置」卡片（keyed 根槽 `plugins.bundle.config`）：textarea + 保存 / 恢复默认 + 状态行；值走**内置** `remote.settings`，设置服务或本插件设置项缺失时降级为只读提示 |
| 客户端 | `test/client-harness.mjs` | `client.js` 的自检 harness（stub loader + 手写 hook 运行时 + 官方 `settings` remote 桩，不安装、不联网） |

卡片里显示的值来自：字段有文本 → 该文本；没有 → 空（= 用上游默认）。文本的基线是挂载时从 `preset-daily`
行捕获的 `config`，清空字段时原样挂回去。

## 安装

profile 在 `$DSH_HOME/profiles/<name>`（桌面的默认 profile 是 `~/.dsh/profiles/desktop`）。推荐走「插件」页：

1. 「插件」页添加插件，填 `github:Shiro-Design-16/dsh-daily-chat-config`（也可以填本地克隆目录 —— 后者会被写成 `link:` 依赖）；
2. 重启 DSH；
3. 「插件」页 → 本插件那一栏 →「日常配置」。

命令行等价做法：

```sh
dsh plugin --profile desktop add github:Shiro-Design-16/dsh-daily-chat-config
```

它装依赖，并把包名同步进 `$DSH_HOME/profiles/<name>/package.json` 的 `dsh.profile.bundles`。如果你不用命令行、
而是自己动手改 manifest（依赖写 `github:` 还是本地 `link:` / `file:` 都行），那这两处都要照顾到：`dependencies`
里有一条同名依赖，`dsh.profile.bundles` 里也要有这个名字。只改了依赖没进 bundle 清单、或者清单里留着旧名字，
启动日志会报一行 `skipping profile bundle …`：插件不生效，也不影响启动（这行警告是 stderr 打的，日志里能找到）。

装完 `yaml` 会出现在 profile 的 `node_modules` 里；`@deepseek-ai/schemastery` 与 `@deepseek-ai/cordis` 由宿主运行时
提供、**故意不声明成依赖** —— 一旦声明就会从公共 registry 装一份普通包，而只有 DSH 的 schemastery 会把
`.volatile()` 字段包成 cosmokit `Volatile` 引用（见「已知限制」）。

## 契约

契约分两面：宿主半边 = 本插件的设置字段（见下），客户端半边 = 用**内置**的 remote 命名空间 `settings` 读写它。

面板的坐席是**插件页**：注册进 keyed 根槽 `plugins.bundle.config`，key = 本包 `package.json` 里的 `name`
（`dsh-daily-chat-config`，就是本包的包名），由插件管理器按 bundle 行派发；owner 传下来的 props（`view` / `entryKey`）
用不到就忽略。它**故意不占设置页**：`settings.section` 是设置外壳给自己那排页面（account / general / models /
Agent 预设）用的列表槽，第三方 bundle 不该在中间插一个导航坐席，而「插件」条目本来就是展示与配置各 bundle 的地方。

客户端**故意不把任何 remote 命名空间写进 `inject`**：宿主半没装配时那条 inject 永远无法满足，条目就停在
pending，而渲染器把**任何**未激活条目当致命错误，整个界面起不来。所以客户端 `inject: []`，服务改用
`ctx.reflect.get('remote.settings')` —— 官方**内置**命名空间，第三方 bundle 无需自建 —— 在每次调用时现查；
拿不到服务、或本插件的设置项没注册，就以「宿主未提供设置服务 / 宿主半未启用」降级视图呈现
（横幅 + 编辑器和按钮禁用 + 状态行）。写用
`remote.settings.update('daily-chat-config', { yaml: text }, revision)`（`daily-chat-config` 就是本插件的
loader entry id），「恢复默认」= 写空字符串；被拒时状态行显示宿主返回的原文，绝不显示成功。
`slots` / `locale` 同样走 `ctx.inject([...], cb)` 的回调形式，不占用模块级 `inject`。

**动手加回 `inject` 之前请先读这一段。** 同样是「条目没激活」，宿主侧和渲染器侧的处置完全相反：

| | 宿主侧 `auditStartupEntries`（`dsh-app-boot/lib/index.js`） | 渲染器侧 `eM`（`dsh-web-frontend/dist/assets/index-*.js`） |
| --- | --- | --- |
| 判定 | 先收集**所有**未激活条目，再筛出 `requiredStartupEntryIds` 里的那些 | 遍历 `ctx.loader.entries()`，把 `fiber.state` 映射成状态名后判 `!== "active"` |
| 白名单 | 有：`requiredStartupEntryIds` 那 7 个 id（`agent-loop`、`webserver`、`modules`、`connection`、`headless-runner`、`acp`、`sdk-jsonrpc-server`），判定时还会并入当前 bootstrap 自己那一条 `bootstrapIncludes.get(ctx)` | **没有** |
| 动作 | 只对白名单里的 `throw`（`required.size > 0`）；其余**只打一行 warning，照常启动** | `o.length > 0` 就 `throw`，一条都不放过 |

所以本插件在宿主侧从来只是 warning（`daily-chat-config` 不在那 7 个 id 里），真正把应用打死的是渲染器
那一侧 —— 崩溃日志里的 `web boot: 1 entry did not activate` 就是这么来的。

渲染器内联的状态表是 `PENDING:0 / LOADING:1 / ACTIVE:2 / FAILED:3 / DISPOSED:4 / UNLOADING:5`，
因此那条判定式等价于 **`fiber.state !== 2`**（`ACTIVE` 是 `2`；`4` 是 `DISPOSED`，不要记错）。

宿主半边对外只有一个设置字段：命名空间 = 本插件的 loader entry id **`daily-chat-config`**，字段名 **`yaml`**。

```
Config = z.object({ yaml: z.transform(z.string(), …).default('').volatile() })
```

- `yaml` 的**内容单位**是子条目列表（`preset-daily` 行 `config.plugins` 那一段的 entry-list YAML），不是整份
  `daily.patch.yml`：行级元数据（`id`/`name`/`description`/`order`）留在 loader 行里，用户改不到 —— persona
  就在子列表里，这才是用户真正要改的东西。
- 值由**官方设置存储**承载：`.volatile()` 字段由 DSH 的设置服务按条目 id 派生成表单，用户在插件页里编辑，
  官方配置编辑器把改动写进当前 profile 的 `cordis.patch.yml` 覆盖记录 —— 宿主半边不碰任何文件。
- 写入前官方先校验目标 `Config`（`resolveConfig` 在 `readFile`/写盘之前），非法文本连文件都碰不到；`apply`
  侧再兜一次，手工改坏的 patch 文件不会把运行中的 preset 带崩。空文本 / 字段未设置 = 用上游默认。
- 生效只走内存：把新子列表挂到 `preset-daily` 行（`entry.fiber.update(next, true)`，`noSave`），不落盘、
  不改行选项，也从不删除 profile patch 里的任何一行。
- 可观测日志：每次应用 / 等待行 / 跳过 / 还原都打一行 `[daily-chat-config] …`，含子条目行数与来源
  （`mount` / `volatile-update` / `entry-init`，还原时标 `source=reset-to-base`），**不含用户文本** ——
  headless 集成验证就 grep 这几行（YAML 报错的 snippet 里会带原文，所以拒因只取首行）。
- **功能信号走 `warn`，并镜像到 `process.stderr`**：本运行期的 Logger 根本没有 exporter —— cordis 的 Logger
  只写内部 buffer，归档里唯一的 exporter 是 `dsh-app-boot` 的启动诊断收集器（`levels: { default: 2 }`，只在
  抛出的 `StartupError` 上挂载、从不打印）。实测两级都零命中：`info` 抓不到，改 `warn` 后仍然
  `grep -F '[daily-chat-config]'` 零命中（真机启动日志里只有 node 自己的 deprecation 警告），于是「apply 没
  跑到」和「跑到了但没人导出日志」分不开。所以结果行走双通道：`ctx.logger.<level>`（留给别的部署里可能存在
  的文件型 exporter）+ `process.stderr.write`（唯一真能留痕的通道；app-boot 自己的诊断
  `skipping profile bundle …` / `disabling profile plugin …` 也是 stderr 写的），两条文本逐字一致。
  这是可观测性取舍、不是「出错了」：等待行只走 logger（每次启动不往 stderr 刷噪音），只有「一直等不到」
  的收尾是 `warn`。

校验规则（任一不通过就拒绝，运行中的 preset 一个字节不动）：文本能解析成 YAML；顶层是行列表；每一行是映射
且有非空 `name`（或 `!!js` 表达式）；`group: true`（或 `name: cordis:group`）的行其 `config` 必须是**嵌套
子列表**；非 group 行的 `config` 必须是映射。拒因写成可读中文 —— 卡片的状态行直接显示它。

### 契约出处

| 结论 | 出处 |
| --- | --- |
| 覆盖记录文件名 | `dsh-app-boot/lib/index.js:487` 定义 `PROFILE_PATCH_FILENAME = "cordis.patch.yml"`，`:4137` 导出 |
| 覆盖是整份替换、不深合并 | `dsh-app-boot/README.md:205`「A user patch replaces the whole matched config — an id-targeted patch does not deep-merge, so a profile override restates the bundle fields it keeps」 |
| 空文件会让启动失败 | `dsh-app-boot/README.md:61`（空或只剩注释的 patch 层让 boot 失败，用 `[]` 关掉这一层） |
| 设置字段的官方形态 | `dsh-settings/README.md`「Edit fields that plugins declare with `.volatile()`… Forms identify each plugin by its profile entry id」；活例 `dsh-better-sidebar/lib/index.js:56-63`：只有 **DSH 的** schemastery 会把 `meta.volatile` 字段包成 cosmokit `Volatile` 引用，Loader 的 volatile 提交路径遍历的就是这些引用（公共包产生普通值 ⇒ 实时写入被静默丢弃） |
| 写入前先校验、且由官方写盘 | `dsh-config-editor/lib/index.js`：`next = change(current, inherited)` → `resolveConfig(fiber.runtime, resolved)` → 之后才 `readFile`/`parseDocument`/`writeFileAtomic`（`entry.fiber === undefined` 的条目路由到 insert 行，绝不覆盖既有行） |
| 生效路径 | `cordis-plugin-loader/lib/index.js:393-425` `Entry._commitVolatile()`：schema 校验失败只 warn、运行中的引用不动；成功则 `fiber.ctx.emit(self, "loader/volatile-update", paths)` |
| 挂载顺序 | 同文件 `:310-332`：`Entry` 构造函数里就发 `loader/entry-init`，而**此刻 `options` 还没赋值** ⇒ 监听端只能延后一拍用 `loader.entries()` 重扫，不能按行 id 判断 |
| 为什么不调 `loader.update` | 同文件 `:201-211` `EntryTree.update` 先 `source.tree.write()`；`dsh-app-boot/lib/index.js:245-248` `Include.write()` → `writeFile(this.root.data)` 会把用户的 profile patch 重写成一份完整组合列表（注释与结构都变） |
| 内存重挂 | `cordis/lib/index.js:1419-1440` `Fiber.update(config, noSave)`：`_resolveConfig`（`internal/config` 插值 + `resolveConfig` 校验）后 `restart()`；`noSave` 不触发 `internal/update` 的落盘 hook |
| 客户端 bundle 不需要单独一行 | `dsh-client-modules/lib/index.js:104-105`：扫描 **host Loader 的条目**里声明 `dsh.client` 的包；`:719` 缺 `./client` 导出会报错 |

> 上表行号已逐处对着**运行中的 App 归档（0.2.0-rc.2）**核过：`dsh-app-boot/lib/index.js:245-248`/`:487`/`:4137`、
> `dsh-app-boot/README.md:61`/`:205`、`cordis-plugin-loader/lib/index.js:201-211`/`:310-332`/`:393-425`、
> `cordis/lib/index.js:1419-1440`、`dsh-client-modules/lib/index.js:104-105`/`:719` 全部命中原文。归档里 `.d.ts`
> 数量为 **0**，凡涉及类型的引用在本版无法核实；`loader.update(id, …)` 的旧签名只存在于 0.1.7 副本，本版按
> `lib/*.js` 的实际行为复核，因此改走 `fiber.update`。

## 为什么改完要开新会话

保存后宿主把新子列表挂到运行中的 `preset-daily` 行上（`entry.fiber.update(config, true)` 内存重挂，
**不需要重启 DSH**；`!!js` 表达式也照常即时求值）。但已经开着的会话早就生成了自己的系统提示词，不会回填：
要看到新的 persona / 工具组合，请**新开一个会话**。

「恢复默认」= 清空设置字段：`apply` 把挂载时捕获的上游 base 挂回去，同样不需要重启。禁用本插件后
`daily` 立刻回到上游原样 —— 我们从不写 `preset-daily` 行的 override，没有需要清理的持久状态。

## 与上游更新的关系

子列表只挂在运行中的 preset 上，**不写**覆盖记录，所以 profile patch 始终保持原样（不会被重写成一份
完整组合列表、注释也不会丢）。代价是：文本一旦设置，它就是那份 `plugins` 的唯一来源 ——
`@local/dsh-daily-chat` 以后在 bundle 补丁里改默认 `plugins`，不会自动合并进你的文本；想拿新版默认，
先清空字段（恢复上游默认）再重新编辑。`plugins` 之外的行级字段仍随上游更新（重启后重新捕获 base 生效）。

## 已知限制

- loader 里没有 `preset-daily` 行时（daily-chat 未装或被禁用）不推任何东西、只留一行 warning；行出现或激活后
  由 `loader/entry-init` 重扫补上（短时重试 40 × 50ms，之后交给事件）。
- **包名换过之后**（`0.2.0` 起叫 `dsh-daily-chat-config`，之前是 `@local/dsh-daily-chat-config`）：用户层 patch
  里那一行如果还写着旧 `name`，会因为名字断言不匹配被跳过（启动日志只有一行警告）。你保存过的文本仍在文件里，
  但不会生效 —— 把那行的 `name` 改成 `dsh-daily-chat-config`（或直接删掉这个字段），或者到插件页里重新保存一次。
- 宿主运行时依赖：`index.js` 从 `yaml` 与 `@deepseek-ai/schemastery` import。`.volatile()` 必须用 **DSH 的**
  schemastery —— 公共包会产生普通值，写入报成功而生效值不变（活例注释见 `dsh-better-sidebar/lib/index.js:56-63`）。
  已在 DSH `0.2.0-rc.2` 真机验证：装进隔离 profile 后启动无未激活条目，设置字段被读取，子列表被应用到
  `preset-daily` 行（宿主日志 `applied N rows to preset-daily (source=mount)`）。
- 应用是**内存挂载**（不写 override）：禁用/卸载本插件后，运行中的 preset 仍持有上一次推送的 config，直到
  重启 DSH 才回到上游原样。同理，如果你在 profile patch 里手工改了 `preset-daily` **行本身**（行级覆盖，
  不是本插件的字段），行级覆盖会赢到下一次保存或重启。
- 文本编辑：提交的是子条目列表的 YAML 文本，注释只活在设置字段里（不会被写进任何文件）；`!!js` 表达式构造成
  `{ __jsExpr }` 节点，由 loader 在条目激活时求值，**即时生效**。

## 离线验证（装机前）

```sh
node --check index.js                      # 语法
node --check client.js
```

两个 harness 都在 `test/` 下；都不安装、不联网、不碰真实文件，路径按 `import.meta.url` 解析，任何 cwd 下都能跑。
夹具默认从 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 提取；App 装在别处时用
`DCC_APP_ASAR=<app.asar 的绝对路径>` 覆盖（夹具根与农场根另有 `DCC_FIXTURE_ROOT` / `DCC_FARM_ROOT`）。

### 宿主半边：`test/host-harness.mjs`

```sh
cd <本仓库目录>
node test/fetch-fixtures.mjs     # ① 夹具：从运行中的 App 归档提取依赖闭包（先跑一次）
node test/host-harness.mjs       # ② 断言，期望最后一行 ALL CHECKS PASSED（当前 85 条）
```

#### 夹具必须来自运行中的 App（不许换源）

夹具从 **`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`** 里提取，包树前缀 `dsh/node_modules/`。
**禁止任何 `dsh-tauri` 或其它陈旧副本路径** —— 0.1.x 与 0.2.x 的契约面不同（导出名与行号都对不上），夹具指向旧副本
会让断言「全绿但全错」。本仓出现过一次：67 条断言全绿，实际加载的是 `dsh-tauri` 里的 0.1.7-rc.1 代码。
`test/fetch-fixtures.mjs` 把这条规则做成硬校验：任何路径里出现 `dsh-tauri` / `io.github.hairyf.deepseek-harness-desktop`
就直接拒绝运行，夹具目录也必须落在临时目录内。

- 夹具落点 `$TMPDIR/daily-chat-config-fixtures/node_modules`（`DCC_FIXTURE_ROOT` 可覆盖）
- 解析农场 `<仓库上级目录>/node_modules`（`DCC_FARM_ROOT` 可覆盖）：**完全由
  `fetch-fixtures.mjs` 重建和管理**，随时可整体删除（删掉那个目录即可），下次运行会重新建。
  它只替换自己创建的软链：谁**解析结果落在夹具根之外**（陈旧链接、悬空链接）就删掉重建，并逐条打印 `replaced stale link …`；
  遇到**真实条目**（不是本脚本建的，可能来自一次装机）则保留，但打印 `WARNING … outranks the fixtures` —— 它会在解析上
  压过夹具，需要人自己决定删不删。
- 归档路径可用 `DCC_APP_ASAR` 覆盖

#### 夹具版本自查

`fetch-fixtures.mjs` 末尾打印闭包内每个包的 `version`；`host-harness.mjs` 开头打印每个夹具的**解析路径 + 版本**，并断言：
不是旧副本、都落在夹具根内、`dsh-app-boot` 是 `0.2.x`、且**插件与 harness 解析到同一份**（防止祖先目录里残留别的
`node_modules` 让 `index.js` 加载另一个副本）。基线：

| 夹具 | 版本 | 归档内路径 |
| --- | --- | --- |
| `yaml` | 2.9.1 | `dsh/node_modules/yaml` |
| `@deepseek-ai/cordis` | 4.0.4 | `dsh/node_modules/@deepseek-ai/cordis` |
| `@deepseek-ai/schemastery` | 3.18.4 | `dsh/node_modules/@deepseek-ai/schemastery` |
| `@deepseek-ai/cosmokit` | 1.8.5 | `dsh/node_modules/@deepseek-ai/cosmokit` |

顺手确认的办法：`node -p "require('<夹具路径>/package.json').version"`，或者直接看 harness 开头那几行。

一个**输入快照**不是 App 包，由 `fetch-fixtures.mjs` 从真实文件复制到 `<夹具根>/presets/`：`daily.patch.yml`
（`daily` preset 的上游默认，来自第三方 bundle `@local/dsh-daily-chat` —— App 归档里没有 `daily` preset）。
覆盖：`DCC_UPSTREAM_PRESET`；运行目录 `DCC_RUN_ROOT`（默认 `$TMPDIR/daily-chat-config-harness/`），产物写在它的 `artifacts/` 下。

#### 断言清单（85 条）

| 组 | 条数 | 覆盖 |
| --- | --- | --- |
| 夹具来源 | 4 | 非旧副本、落在夹具根、插件与 harness 同源、上游 `daily.patch.yml` 快照在位 |
| 设置字段 schema | 6 | `Config` 是 schemastery schema（`toJSON` 可供设置服务派生表单）、`inject` 只有 `loader`、`yaml` 带 `meta.volatile`、解析出的值是 cosmokit `Volatile` 引用、空配置 = 空串、显式值原样进入引用 |
| 负例 | 10 | YAML 语法错 / 顶层不是列表 / 条目缺 `name` / group 行 `config` 不是列表 / 子列表条目缺 `name`：`presetTextProblem` 与 `Config()`（= 配置编辑器写盘前的校验）两条路径都拒绝，且给可读中文 |
| 正例 | 4 | 上游默认子列表、空文本、追加一行、含 `!!js` 的文本都判合法 |
| 应用语义 | 18 | volatile 提交后精确推一次、`fiber.update(config, true)` 的 `noSave`、行选项里的 config 不被改、行级元数据保留、persona 逐字段不变、同值指纹跳过、`!!js` 以表达式节点推送、清空还原 base、非法文本零改动 + 可读 warning |
| 挂载顺序 | 6 | 行未出现不推、`entry-init` 后重扫仍无行、行出现但未激活不推、激活后由重试补推、重复 `entry-init` 不重复挂载 |
| 可观测日志 | 21 | 「空文本 + 从未应用」明说没事可做、成功应用含行数与 `source=`、同值跳过、还原标 `reset-to-base`、等待/未激活各一行、重试耗尽留一条 `warn`、统一前缀；级别/通道断言：功能信号走 `warn`、等待行仍是 `info`、四条结果行**逐字镜像到 stderr**、瞬时等待行不进 stderr；隐私断言：logger 与 stderr 里都不出现用户文本（连 YAML 报错的 snippet 都被截掉）、每条 ≤ 240 字符 |
| 没有文件写入 | 16 | 源码审计（无 `node:fs`/`withFileLock`/`writeFileAtomic`/`writeFile`/`profileContext`/`TypertRemoteService`/`Remote(`/`settings.register`/旧 `loader.update` 调用）、`yaml` 只用于解析、`fiber.update` 在、双通道都在（`ctx.logger` 保留 + `process.stderr` 镜像、无新 import）、导出面只剩 `apply`+`Config` |


### 客户端半边：`test/client-harness.mjs`

```sh
node test/client-harness.mjs            # 期望最后一行 23/23 checks passed，退出码 0
```

它用 **stub module loader + 手写 hook 运行时驱动真实的 `client.js`**：先架一个 `window.__ModuleLoader__`
接住 bundle 注册的 factory（bundle 只注册，不执行），再补一个最小的 `document`；然后用一份手写的
React 运行时（`useState` / `useRef` / `useCallback` / `useEffect` 加一个 commit 阶段）把组件函数真正
渲染成元素树。宿主侧接缝只有一处 —— **官方 `settings` remote**（`ctx.reflect.get('remote.settings')`），
harness 在它上面伪造两种在场状态（有设置服务 / 没有）与三种写答复（成功 / 被拒 / 冲突），
文本断言钉在 bundle 自己注册的中文字典上（不是另抄一份字符串）。
不安装、不联网、不碰真实 DOM；bundle 路径按 `import.meta.url` 解析，任何 cwd 下都能跑。

23 条断言分七组：激活安全、延迟取服务、坐席与接缝名、无设置服务的降级、信封语义、健康页读写、
命名空间缺位。全部服务于同一条要求 —— **宿主半不可用时不能拖死应用启动，写失败不能假装成功**：

| # | 断言 |
| --- | --- |
| N1 | `inject` 为空：没有任何服务能让条目停在 pending |
| N1b | 源码里出现的 remote 命名空间只有内置的 `remote.settings`（自建 ns 已彻底消失） |
| N2 | 在**什么服务都没有**的 ctx 上 `apply()` 不抛 |
| N2b | 延迟服务确实是通过 `ctx.inject([...], cb)` 回调形式取用的 |
| N3 | 注册进 keyed 根槽 `plugins.bundle.config`，`key` 恰为 `dsh-daily-chat-config`，label「日常配置」 |
| N3b | 旧的 `settings.section` 坐席已彻底消失（源码与注册项都不再出现） |
| N3c | 取服务只查 `remote.settings` 这一个名字 |
| N4 | 没有设置服务时 `describe` / `update` / `reset` 全部 reject，`error.code === 'daily-config-no-settings'` |
| N4b | 降级视图出现 `dsh-daily-config-notice` 横幅，编辑区与按钮全部 `disabled` |
| N4c | 状态行显示本地化文案，且**不泄露**内部标识（`settings` / `dailyConfig` / 条目 id） |
| N5 | `describe()` 解官方信封 `{ ok, value }`，拿到 `writable` + `namespaces` |
| N5b | `update()` 发出的 patch 与 `revision` 正是 describe 读到的那一份 |
| N5c | 被拒保留 `settings/rejected` 与宿主原文 |
| N5d | 过期写保留 `settings/conflict` |
| N5e | 「恢复默认」= 写空字符串，且全程不调用 `replace` |
| N6 | 健康视图无横幅、编辑区载入真实文本、保存可用 |
| N6b | 保存把草稿与 describe 返回的 revision 一起发出，成功后状态行报「已保存」 |
| N6c | 恢复默认写空、报「已恢复默认」，并自动隐藏「恢复默认」按钮 |
| N6d | 写被拒时状态行显示「保存失败：<宿主原文>」，且绝不出现「已保存」 |
| N6e | 冲突时自动重读 revision、保留用户草稿，下一次写用新 revision 成功 |
| N7 | 设置项未注册 → 「宿主半未启用」降级 + 按钮禁用 |
| N7b | profile 配置文件不可写 → 文本可见但保存禁用 |
| N7c | 宿主没有设置服务（provider 缺失）→ 降级横幅 + 引用宿主自己的诊断 |
