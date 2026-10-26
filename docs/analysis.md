# dsh-subagent-model-router 源码分析（重写依据）

- 分析对象：`pumbleblock/dsh-subagent-model-router`，版本 **0.10.0**（MIT）
- 上游快照：`E:\DeepSeek\upstream-dsh-subagent-model-router`（从 `codeload` 拉取的 `main` 分支 tar.gz，445 KB）
- 目的：判断"参考它重写一个更贴合我们习惯的版本"的代价与切入点

---

## 1. 仓库结构

| 文件 | 大小 | 作用 |
|---|---|---|
| `lib/index.js` | 76 KB / 1942 行 | **宿主侧**：注册工具、系统提示、设置、HTTP 路由、会话投影、技能 |
| `lib/client.js` | 46 KB / 923 行 | **界面侧**：手写 CJS bundle（`window.__ModuleLoader__.load`），设置页 |
| `lib/model-catalog.js` | 5.5 KB | 模型目录的校验/渲染纯函数 |
| `cordis.patch.yml` | 4 行 | 只做 mount，**不带默认 config** |
| `skills/model-subagent-setup/SKILL.md` | 6 KB | 给模型看的路由配置技能 |
| `test/*.test.js` | 130 KB | 单测，`node --test` 直接跑，**不依赖 DSH 运行时** |
| `docs/screenshots/*.png` | 385 KB | 仅文档用，运行时无关 |

依赖极少：**运行时只有 `zod`**，其余是 DSH 宿主提供的 peer。

---

## 2. 宿主侧架构（`apply()`，index.js:1804-1930）

```
apply(ctx, config)
├─ ctx.sessionProjections.register(...)      # 会话投影：当前子代理路由
├─ registerSetupSkill(ctx)                   # 注册 model-subagent-setup 技能
├─ registerCatalogTool(ctx)                  # 工具 model_subagent_catalog（只读）
├─ registerConfigurationTool(ctx, access)    # 工具 configure_subagent_models
├─ registerSettingsRoute(ctx, access)        # HTTP /dsh-subagent-model-router/settings
├─ registerSelfMessageGuard(ctx)             # 拦截 send_message 指向自己
├─ registerWaitTool(ctx, tracker)            # 工具 wait-for-subagents
├─ registerToolExecutionPolicies(...)        # 工具执行前后的钩子（跟踪、列表过滤）
├─ reconcile(current)                        # 按配置挂载/卸载 subagent_model
└─ ctx.systemPrompt.section({...})           # 注入路由指引（index.js:1904）
```

关键接缝（fork 时主要动这几处）：

| 接缝 | 位置 | 说明 |
|---|---|---|
| 委派工具注册 | `index.js:1859` | 每次配置变化都 unmount/mount，工具名固定 `subagent_model` |
| 委派实现 | `index.js:1511-1651` | **两个 API 调用点**：`startContinuable`(1618)、`start`(1647) |
| 推理档位发现 | `index.js:1459-1510` | `ctx.llm.resolveModelInfo` + `resolveCallConfig` |
| 设置读写 | `index.js:161-200` | 走 `ctx.settings`，写入 profile 的 `cordis.patch.yml` |
| 系统提示 | `index.js:1904-1913` | 一段英文指令 + 路由清单 |
| 会话投影 schema | `index.js:70-84` | **唯一使用 zod 的地方** |

### 0.2.1 兼容问题的精确位置

上游仍在调用旧接口，这是它在 DSH 0.2.1 上直接报错的唯一原因：

- `index.js:1618` `ctx.subagents.startContinuable({...})` → 应为
  `startActivation({..., delivery: 'parent' })`
- `index.js:1647` `ctx.subagents.start(provider, request)` → 应为
  `startActivation({..., delivery: 'caller' })` 并把返回的 activation 适配成
  `{ id, result, dispose }`

外层 `request` 里的 `label` / `signal` 也要提到激活参数上（`index.js:1600-1612`）。

**结论：fork 的核心改动只有 3 处、约 20 行**，其余全部是可选增强。

---

## 3. 界面侧（`client.js`）

- 形式：`window.__ModuleLoader__.load({ id, factory })`，手写 CJS、`React.createElement`，**无构建步骤**。
- 设置页通过 `settings.section` 注册，标题 `'Subagent Models'`（`client.js:906`）。
- 数据通过 `fetch('/dsh-subagent-model-router/settings')` 拿。

### 汉化清单（用户可见字符串，约 20 处）

| 位置 | 现有文案 |
|---|---|
| `client.js:826` | `Subagent Models`（页面标题） |
| `client.js:807-815` | `Alias` / `Display name` / `Provider route` / `Model ID` / `Tags (comma-separated)` / `Max tokens (optional)` / `Default reasoning effort (optional)` / `When to use this model` |
| `client.js:808-820` | 占位符：`fast` / `Fast model` / `provider-id` / `model-id` / `fast, routine` 等 |
| `client.js:840-842` | `Subagent provider` / `Maximum depth` / `Hide from lists after inactive turns` |
| `client.js:862` | Settings 服务不可写时的提示 |
| `client.js:906` | section 注册名 |

**可行做法**：文件顶部加一个 `t()` + `zh` 字典（不用引 i18n 库），把上述字符串换成 `t('alias')`。

### 不建议汉化的部分

`index.js` 里的工具描述、系统提示段、`SKILL.md` —— 这些是**给模型读的**。
模型按语义选路，翻译不会更准，反而和现有英文技能文档不一致。错误信息可以汉化
（给人看），但要注意测试里可能断言了英文文案（见下）。

---

## 4. 关于 `zod` 依赖

`zod` 只用于 `index.js:70-84` 的**会话投影 schema**，没参与工具参数校验。

交叉验证：同环境的 `dsh-plugin-subagent-director` 注册投影时用的也是
`z.object({...})` 作为 `stateSchema` 与 `wire.viewSchema`
（`lib/orchestrate.js:262`、`:273`）。也就是说 **`sessionProjections` 的契约是
zod 形状的**，不是随便一个对象都能顶替。

因此"去掉 zod"不是改一行的事，需要先确认宿主如何使用 schema
（是否只调用 `safeParse`、是否在恢复路径之外也用）。三种可能：

| 方案 | 可行性 | 风险 |
|---|---|---|
| 保留 zod | 确定可用 | 离线安装要带 511 KB 的 vendor 副本 |
| 写一个最小兼容对象（实现 `safeParse`/`parse`） | 需实测 | 宿主若调用其它 zod API 会崩；丢失校验 |
| 不注册这个投影 | 需确认影响 | `subagentModelRouteProjectionDefinition` 供 UI 显示当前路由，去掉会少一个展示位 |

**结论**：先保留 zod。去依赖是一项独立的小实验，适合在 fork 跑通之后单独做，
不要和"修 0.2.1 兼容"混在一起。

---

## 5. 测试与可维护性

- `test/plugin.test.js` 3159 行、`client.test.js` 19 KB，覆盖工具注册、配置归一、
  后台跟踪、等待工具、设置路由等。
- 测试直接 `import '../lib/index.js'`，用假的 ctx，**不需要启动 DSH**；但需要
  `pnpm install` 装 devDependencies（`@deepseek-ai/cordis` 等）。
- 这意味着：**fork 之后每次改动都能跑测试回归**，不必靠三台机器手工验证。

注意：测试里有大量英文文案断言（例如 `index.js` 的日志与工具描述）。汉化若动到
这些字符串，需要同步改测试，否则 `pnpm test` 会红。

---

## 6. fork 的改造清单（按价值排序）

| # | 改动 | 价值 | 代价 |
|---|---|---|---|
| 1 | `startActivation` 适配（带特性探测，新旧 API 都支持） | 不再需要 node_modules 补丁 | 小 |
| 2 | 四条路由写进 `cordis.patch.yml` 默认 config | 装完即配好，三台一条命令 | 极小 |
| 3 | 设置页汉化（约 20 处） | 使用体验 | 小 |
| 4 | 尝试移除 `zod` | 载荷从 675 KB 降到 ~62 KB | 中（需先确认投影 API） |
| 5 | 错误信息汉化 | 排错体验 | 小（要同步改测试） |
| 6 | 离线包 / 一键迁移等工具收进插件 | 部署便利 | 中 |

---

## 7. 风险

1. **DSH 内部 API 变动**：0.2.1 已经断过一次。fork 里做**特性探测**能吸收一部分，
   但接口语义变化仍然要跟。好在改动集中，届时只需改一个文件。
2. **与上游分叉**：上游 0.10.0 之后如果继续更新，需要 rebase。建议
   - 保持"上游原样 + 最小补丁层"的结构（`PATCHES.md` 记录每处差异）；
   - 每次上游更新只重放这几处。
3. **命名冲突**：fork 若沿用同名 `dsh-subagent-model-router`，两台机器混装会冲突。
   建议改包名（如 `dsh-subagent-router-cn`）并同步改工具名以外的标识。
4. **许可**：MIT，允许 fork 与再发布，保留原版权声明即可。

---

## 8. 建议的下一步

1. 先在本目录复制 `upstream/` 为 `src/`，做**最小 fork**（只有第 1、2 项改动），
   跑通 `pnpm test`；
2. 在第三台机器上以 `github:<你的仓库>#v0.1.0` 安装验证；
3. 通过后再做汉化（第 3 项）与 zod 移除（第 4 项）。
