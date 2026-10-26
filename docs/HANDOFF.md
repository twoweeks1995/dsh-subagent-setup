# 交接文档（HANDOFF）

> 新会话接手时**先读这一页**，再按需读 `DESIGN.md` / `analysis.md`。
> 项目：`E:\DeepSeek\dsh-subagent-setup`　上游参考：`E:\DeepSeek\upstream-dsh-subagent-model-router`

---

## 1. 目标

为 DeepSeek Harness 写一个**中文界面的子代理模型路由插件**：按别名把子代理委派到指定
`provider/model`，每条路由可写标签、用途描述、默认推理档位；配置存本地 JSON。

参考上游 `pumbleblock/dsh-subagent-model-router@0.10.0`（MIT）**重写**，不是 fork。
等待能力**自己实现**（`subagent_route_wait` + 简化 tracker）；不复刻它的自消息守卫与 Better Sidebar 集成。

## 2. 当前状态（2026-10-25）

- **已在真实 DSH 装机运行并通过全部验证**（委派、后台汇合、设置页、两个界面组件）
- 单测 **135 项**全绿（config 21 / catalog 8 / delegation 10 / policy 4 / paths 4 / observe 6 /
  store 7 / routes 26 / tracker 19 / plugin 30）
- `src/`（7 个纯逻辑模块）+ `plugin/`（**15 个模块**，`index.js` 481 行，最大模块 `tools.mjs` 258 行）
  + `skills/subagent-route-setup/SKILL.md`
- **五个工具**：`subagent_route` / `_catalog` / `_configure` / `_wait` / `close_subagent`
- **两个 Cordis 条目**：主+设置（给模型和设置页用）+ 会话（给会话头部两个组件用，见 §2.5）
- **三个界面挂载点**：设置页、会话头部路由胶囊、会话头部释放按钮；后两者各有开关
- **未做**：`git` 尚未 init；未发布
- 客户端 `client.js` **879 行、只能单文件**：实测宿主模块表不解析相对 `require`（见 §7），此结论已闭环，不再尝试

## 2.5 架构：两个条目与模块地图

**为什么是两个条目**：Cordis 里 `inject` 的服务不存在时该条目**永不加载**。设置路由并入主条目后，
主条目依赖 `webServer`，headless 环境不再加载；本机只有桌面应用、无 CLI，故接受此取舍。
停用「会话」条目只影响会话头部两个组件（路由胶囊、终止按钮），设置页完全不受影响。

| 条目 | id | inject | 职责 |
|---|---|---|---|
| 主+设置 | `subagent-setup` | tools / subagents / agents / systemPrompt / skills / llm / webServer | 五个工具、系统提示段、技能、tracker、list_agents 过滤；`/settings`（GET/PUT）、`/catalog` |
| 会话 | `subagent-setup-session` | webServer / subagents / agents / llm | `/subagent-model`、`/close-subagent`（含 GET 可用性探针） |

两个条目各写一块启动诊断到**同一个** `last-startup.log`，用 `appendFile` 追加、以 `timestamp:` 分块；
日志里能直接看出谁注册了什么（两条目都有 `webServer` 与 `http routes` 行）。

**模块地图**（`plugin/`）：`index.js`（主+设置条目 apply + 挂载状态机 + 设置/目录路由）、`session.mjs`（会话条目，由 `ui.mjs` 改名）、`tools.mjs`（schema 与工具工厂）、
`config-io.mjs`（配置读写 + 跨条目变更通知总线）、`session-observe.mjs`（读会话路由 / 释放子代理）、
`catalog-runtime.mjs`、`delegation-runtime.mjs`、`activity.mjs`、`startup-log.mjs`、`constants.mjs`、
`util.mjs`、`tracker.mjs`、`routes.mjs`、`client.js`、`cordis.patch.yml`。

## 3. 已定决策

| 项 | 决定 | 理由 |
|---|---|---|
| npm 包名 / 仓库名 | `dsh-subagent-setup` | npm 空闲、GitHub 全局无同名、账号 `twoweeks1995` 下可用 |
| Cordis 插件 id | `subagent-setup` | 与包名区分，patch 行 id 用它 |
| 配置目录 | `<DSH_HOME>/subagent-setup/config.json` | 见下条 |
| **配置存储** | **自己的 JSON，不写 `cordis.patch.yml`** | 上游写 YAML 出过两次"DSH 起不来"事故：①正则替换吞掉整段 `- insert:`；②PowerShell 写 `package.json` 带 BOM，Node `JSON.parse` 拒绝 |
| 写入方式 | 临时文件 + rename 原子替换，**永不带 BOM** | 见 `src/store.mjs`，有单测钉住"首字节必须是 `{`" |
| 中文范围 | 设置页、日志、校验错误 = 中文；**给模型看的 description / 工具说明 = 英文** | 模型按语义选路，翻译不会更准 |
| 子代理 API | **特性探测**：有 `startActivation` 用新的，否则回落 `start/startContinuable` | DSH 0.2.1 换过接口，上游硬调用导致工具直接不可用 |
| 等待能力 | **自己做** `subagent_route_wait` + 简化 tracker | 实测本机宿主的 wait 是上游插件注册的，卸载后就没；追踪器必须自备（含 10s 有界重扫；paused 判定要有 aborted 证据） |
| 不做 | `send_message` 自指拦截、Better Sidebar 标签页、`orchestrate` 模式 | 与路由无关或属宿主职责 |
| 条目拆分 | **主+设置 / 会话** 两个条目 | 会话条目只服务头部胶囊与释放按钮，停用它不影响设置页与工具。**代价**：设置路由并入主条目后，主条目必须 inject webServer，headless 环境将不加载任何东西——本机只有桌面应用、无 CLI，故接受；若将来要用 CLI，拆回三条目（主 / 设置 / 会话） |
| 界面开关 | `showRouteDock` / `showCloseAction` 两个布尔字段 | 比拆三个插件便宜，效果等价于功能可单独停用 |

## 4. 工具（Tool）与技能（Skill）的区别 ⚠️ 关键

这两个概念容易混，做错会导致"只有说明书、没有执行能力"的插件。

| | 工具 Tool | 技能 Skill |
|---|---|---|
| 本质 | **可执行函数** | **操作说明书**（Markdown） |
| 谁写 | 插件代码（`ctx.tools.register`） | 插件附带或用户自己写（`~/.agents/skills`） |
| 何时生效 | 模型每轮自动决定是否调用 | 模型按需加载全文；或用户 `/技能名` 触发 |
| 副作用 | **有**（读写文件、联网、调模型、花钱） | **没有**，只是往上下文塞文字 |
| 受权限约束 | 是（沙箱 / 审批） | 否 |
| 冲突方式 | 同名工具注册失败 | 同名技能注册失败 |
| 本会话例子 | `read`、`pwsh`、`subagent_model` | `model-subagent-setup`、`office-xlsx` |

**上游同时提供两类**：
- 工具：`subagent_model`（委派）、`model_subagent_catalog`（查目录）、
  `configure_subagent_models`（改配置）、`wait-for-subagents`（等待）
- 技能：`model-subagent-setup`（教 agent 怎么配这个插件——本会话开头用户敲的
  `/model-subagent-setup` 就是它）

**我们的计划**：工具名用 `subagent_route`（避开上游的 `subagent_model`，可共存测试）；
技能先不做，等设置页能用了再评估是否需要。

## 5. 待决问题结论（2026-10-23 已由用户裁决，全部作废不再重问）

1. **配置变更何时生效** → **每次委派时重读 config.json**。不做热重挂监听。
   注意：挂载时的快照只影响"模型看到的路由清单与参数描述"，执行期永远以磁盘为准；
   设置页写盘与 `configure` 工具写入后都必须主动重挂，否则新别名对模型不可见。
2. **是否提供让模型改配置的工具** → **做**（`subagent_route_configure`）。
3. **是否附带技能** → **做**（`skills/subagent-route-setup/SKILL.md`）。
4. **是否保留 `listingInactivityTurns`** → **保留**（因此要接管 `list_agents` 输出过滤）。
5. **设置页形态** → 模型选择**只能二级下拉**（一级 provider → 二级 model），
   禁止手打 provider/model；二级下拉**末尾加「其他…」**，选中后可手填。
6. **与上游并存时不做任何"优先级"改造**（2026-10-24 定）：DSH 没有插件优先级设置，
   工具按名字注册——同名后注册者被拒（先注册者赢），不同名则共存、由模型自选。
   可用的排序杠杆只有"系统提示段的 `order`"和"`bundles` 加载顺序"，但**都治不了真正的坑**：
   两个追踪器各自只认自己派出的子代理，用我们的工具派活、用上游的 wait 去收 → 上游名下没记录 →
   立刻返回空数组 → 子代理永远没人收。这是数据归属问题，不是排序问题。
   **结论**：并存仅作临时 A/B，验证时在指令里写明"用 `subagent_route` 派、用 `subagent_route_wait` 收"；
   正式使用只留一套。不为此改代码、不加提示噪音、不动 `bundles`。
7. **工具名（四件套，与上游全部错开以便并存）**：
   `subagent_route` / `subagent_route_catalog` / `subagent_route_configure` / `subagent_route_wait`；
   技能名 `subagent-route-setup`。

## 6. v0.2.0 宿主实现（已完成，保留作验收对照）

1. `plugin/index.js`：补 `inject = ['tools', 'subagents']`；
2. 实现 `subagent_route` 工具：
   - 参数：`model`（别名，枚举）、`prompt`、`description`、`run_in_background`、`reasoning_effort`；
   - 委派时读 config，找不到别名要给出可用别名列表；
   - **API 特性探测**：
     ```js
     const hasNew = typeof ctx.subagents.startActivation === 'function'
     // 新：startActivation({ provider, label, request, signal, delivery })
     // 旧：delivery==='parent' ? startContinuable({...}) : start(provider, request)
     ```
   - 前台要等结果并回收；后台返回 `childId`；
3. 系统提示注入：一段英文指引 + 路由清单（仿上游 `index.js:1904`）；
4. 单测：用假 ctx 覆盖"按别名解析""未知名报错""特性探测两条分支"；
5. 验收：本机装上后，让 agent 用 `subagent_route` 跑四条别名各一次。

## 6.5 路由判别力实测（2026-10-23，v0.2.0 装机后）

方法：把**与运行时完全相同**的四行路由文本交给 4 位裁判（正好是这四条路由本身），
对 8 个人工场景各选一个别名，只许输出 JSON。

结果：明确题 16/16、重叠题 8/8 落在允许集、陷阱题 0/4 被带偏、全体一致率 31/32。
三位裁判输出逐字节相同；唯一分歧出现在故意设计的"无唯一正解"题上。

**局限（复测时必须修）**：
1. 场景用语**复述了描述用语**（"自相矛盾"↔`self-contradictory`），可能抬高准确率；
2. 别名暴露模型身份，**"自我偏好率"在本设计下无效**，需盲测（别名换成 `route-a..d` 并打乱）。

若要做第二轮：盲测 + 真实口吻改写场景 + 每题跑 3 次 + 加"不该派"的琐事场景。

### 6.5.1 真实调用层实测（2026-10-25，B 层）

上面那轮是**判断层**（裁判看路由文本选一个）。这轮测**行为层**：派一个 fresh 调度者，
要求它用 `subagent_route` 真派一次，再用 `GET /subagent-model` 查**孙代理实际跑在哪个 provider/model**
（客观取证，不采信自述）。调度者模型故意选成"不是该题正确答案"的那个，排除自我偏好。

结果（4 场景）：
- 扫描定位 → `glm53flash`：**答案键原本写 gemini38flash，是错的**。
  `gemini38flash` 描述带限定语「whose raw output another route will judge」，独立扫描任务不满足它。
  **按字面该由 glm53flash 接手**，模型是对的。教训：答案键必须逐字对照描述，不能凭直觉。
- 需求矛盾审查 → 两次独立测试（调度者分别是 v4pro 与 glm53flash）**都选了 v4pro**，理由都是
  「V4-Pro 定位是复杂/质量敏感推理」——而 v4pro 的描述里**根本没有"推理"二字**（只有 follow the spec to the letter）。
  即：**模型在按模型名脑补能力，没有在读描述**。

**为此加过的插件级修复（保留，但未证明有效）**：系统提示里加了「选择程序」——先按 description 的适用条件选，
tags/effort 只在选定后决定参数，且不得拿推理档位当选路理由。复测 S2 **仍未修好**，
说明靠提示约束不住按名称推断。

### 6.5.2 中性别名对照实验（2026-10-26，同一 S2 场景）

起因：S2 两次失败都选了 `v4pro`，怀疑「别名本身就是拉力」。做法：只把配置里的 `alias` 改成 `1..4`
（**描述、displayName、provider/model 一律不动**），用与基线相同的调度者重跑，再查孙代理实际路由。

| 条件 | 调度者 | 结果 |
|---|---|---|
| 基线（别名 `v4pro` / `glm53flash` / …） | v4pro、glm53flash | **0/2**，两次都选 v4pro |
| 遮蔽（别名 `1`/`2`/`3`/`4`） | v4pro、glm53flash、gemini38flash、glm53flash | **6/6**，全部选到描述匹配的 `1` |

关键观察：遮蔽后调度者的理由里**仍然准确说出「GPT-6.1 Sol」「cherryin/openai/gpt-6.1-sol」**——
它们看得见模型名，`displayName` 与 `provider/model` 并没有挡住判断。真正起作用的是**别名这个句柄**：
`v4pro` 同时暗示「同族」和「专业版」；换成 `3` 之后，模型退回到读描述。

**实践结论**：不需要改代码做「完整遮蔽」。把 `alias` 取成中性词（`a1`…`aN`）、可读名放进 `displayName`，
就能显著改善选择。这条已写进技能 `subagent-route-setup` 与 README。

诚实保留：0/2 对 6/6，样本仍小（置换检验约 p≈0.036）；机制解释与结果一致，故采信。

**结论**：描述准确 ≠ 会被遵守。插件只能影响文本，无法保证选择；
重要任务应**由调用方显式指定别名**（本工具本来就必须给 `model`），不要指望模型自动选对。
若哪天要再试：给描述加**排除句**（「本路由是照规格执行者，不用于审查矛盾需求」）比加提示规则更可能有效。

## 7. 已知的坑（都是真踩过的）

| 坑 | 现象 | 规避 |
| **客户端拆文件** | 手写 CJS bundle 里 `require('./x.js')` 报 `client-modules: … missed the module table — not a platform seed word, not a materialized module, and no registered package factory` | 宿主客户端模块表只认**平台种子 / 已物化模块 / 注册过的包工厂**，不做路径解析。`client.js` 只能保持单文件；真要拆必须迁移到 director 那种 ESM 多文件约定（由构建期物化） |
|---|---|---|
| **UTF-8 BOM** | PowerShell `Set-Content -Encoding UTF8` 写 JSON 带 BOM → Node `JSON.parse` 抛错 → **DSH 起不来** | 只用 `[IO.File]::WriteAllText(..., UTF8Encoding($false))`；写完检查前 3 字节 |
| **`Get-Content` 编码** | PS 5.1 的 `Get-Content` 默认按 GBK 读 UTF-8 文件 → 中文变 `涓枃鐣岄溃`，`ConvertFrom-Json` 报错 | 验证时用 `[IO.File]::ReadAllText` 或 Node；别用裸 `Get-Content` |
| **YAML 正则太贪** | 替换配置条目时吃到下一个 `- id:` 或文件尾，吞掉中间 `- insert:` 块 → DSH 起不来 | 本插件不碰 YAML |
| **patch 条目替换是整段** | 同 id 的后续条目会整体覆盖前面条目的 `config:` | 改配置要在原条目里改，不要新起同 id 条目 |
| **工具重名** | Cordis 同作用域内同名注册失败 | 与上游共存时用不同工具名/技能名 |
| **profile `package.json` 决定启动** | 它坏了整个应用打不开（比功能失效更严重） | 不要手改；必须改时校验 JSON 可解析且无 BOM |

事故完整过程见 `E:\DeepSeek\dsh-subagent-router\README.md` 的「4.1 事故记录」。

## 8. 环境

- DSH 桌面版 **0.2.1-rc.2**；`DSH_HOME = D:\DSH-Home`；profile `desktop`
- 上游插件**已安装并在用**（四条路由：`v4pro` / `gpt61sol` / `glm53flash` / `gemini38flash`）
  → 我们的插件要和它**并存测试**，所以工具名、技能名必须错开
- ⚠️ **上游能用是因为被手工 patch 过**：`profiles\desktop\node_modules\dsh-subagent-model-router\lib\index.js`
  里的 `start/startContinuable` 已被改成 `startActivation`（见 `notes\subagent-model-router-0.2.1.md`）。
  该 patch 在 `node_modules` 内，**重装或升级插件即失效**，需要重打。上游未修复此问题。
- Node / pnpm：`D:\DSH-Home\dsh-runtimes\dsh-primary-runtime\dependencies\{node\bin\node.exe,pnpm\bin\pnpm.mjs}`
- `gh` 已登录 `twoweeks1995`（scopes: `read:org`, `repo` — **没有 `workflow`**，
  若以后加 GitHub Actions 需要 `gh auth refresh -s workflow`）
- npm 身份 `twoweeks1995`，已发布 `dsh-appdata-scanner@0.7.0`
- 既有插件源码参考（**不要修改**）：`E:\DeepSeek\appdata-scanner`（`src/` 纯逻辑 + `plugin/` 胶水的目录约定就来自它）

### 8.1 兼容性：只在 0.2.1-rc.2 上验证过

`package.json` 声明 `dsh.engines.dsh: ">=0.2.1-rc.2"`、`engines.node: ">=20"`。
**除本机这一个版本外，没有在任何旧版 DSH 上实测过**，宿主是否强制检查 `dsh.engines` 也未验证。

代码里做了降级，但要分清「不崩」和「能用」：

| 依赖 | 旧版缺它时 |
|---|---|
| `subagents.startActivation` | 探测到没有就回落 `start` / `startContinuable`（legacy 路径有单测） |
| `sessionQuery` | 回落到 `agents.get`，**只能读到仍在内存里的子代理**；已结束的会话读不到路由 |
| `agentPreset` 能力 | 能力探测拦截，带 `agentPreset` 的路由报错，其余路由不受影响 |
| `webServer` | 界面条目整条不加载（设置页、胶囊、按钮全无），主条目与工具照常 |
| 客户端槽位 `settings.section`、`conversation.session.header.actions` | 组件静默不渲染，工具不受影响 |
| `dsh.bundle.patch` + `dsh.client` | 这是插件管理器时代的 manifest 约定；太老的宿主可能压根装不上 |

**结论**：老版本能否用，取决于它如何提供上面这几项——没有试过就不能承诺。
真要支持旧版，最省事的判断方式是装上去看 `last-startup.log`：它逐行记录 tracker / wait / close /
sessionQuery / webServer / 能力的探测结果，缺什么一目了然。

## 9. 验证与发布

```powershell
cd E:\DeepSeek\dsh-subagent-setup
& "<node>" --test        # 135 项
& "<node>" --check plugin/index.js
& "<node>" --check plugin/session.mjs
```

### 9.1 已经发布（2026-10-26，v0.2.0）

| 渠道 | 位置 | 状态 |
|---|---|---|
| npm | https://www.npmjs.com/package/dsh-subagent-setup | `0.2.0` 为 latest，26 个文件 / 解开 169 KB |
| GitHub | https://github.com/twoweeks1995/dsh-subagent-setup | 40 个文件，tag `v0.2.0` |
| Release | …/releases/tag/v0.2.0 | 挂了 `dsh-subagent-setup-0.2.0.tgz`（49,904 B） |

发布时踩到的两件事，下次照抄：

1. **`github.com:443` 可能不通，但 `api.github.com` / `uploads.github.com` 通**。
   此时 `git push` 会 21 秒超时。替代方案：用 Git Data API 写入（blobs → tree → commit → ref），
   再用 `gh release create` 上传 tgz。注意**空仓库不允许创建 blob**（`409 Git Repository is empty`），
   必须先用 Contents API（`PUT /contents/<path>`）建出第一个提交。
2. **npm 首次发布会走暂存（staged）**，线上先出现一个 `0.0.0-stage` 占位包，
   过一会儿正式版本才生效；`npm stage approve` 需要 2FA，命令行拿不到口令，等即可。

### 9.2 如果本地/远程历史又不一致

用 API 写入会产生与本地不同的提交哈希（内容相同）。网络恢复后一条命令对齐：

```powershell
git fetch origin
git reset --hard origin/main
git tag -f v0.2.0 origin/main
```

（本次已于 2026-10-26 修复：本地 HEAD 与远程 `a6718ec` 一致，tag 已在。）

### 9.3 今后发布

```powershell
pnpm publish --access public        # npm
git push origin main --tags         # GitHub（打包会用 pnpm pack）
gh release create v0.2.1 ./dsh-subagent-setup-0.2.1.tgz --title v0.2.1
```

## 10. 一句话给新会话

> 读 `docs/HANDOFF.md`（尤其 §2.5 双条目架构）。插件已完整可用、135 项测试全绿；
> 剩余工作只有发布准备，以及可选的客户端文件拆分（需先做 require 相对路径探针）。
