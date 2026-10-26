# 设计说明

上游分析见 [analysis.md](analysis.md)（对象是 `pumbleblock/dsh-subagent-model-router` 0.10.0）。

## 一句话

**只重写我们实际会用的那部分**：按别名委派 + 中文设置 + 可靠的配置存储；
不复刻上游的等待追踪、自消息守卫、Better Sidebar 集成等外围能力。

## 与上游的关键差异

### 1. 配置不进 `cordis.patch.yml`

上游通过 DSH Settings 服务读写 profile 的 Cordis patch。这条路我们出过两次事故：

- 替换配置条目时正则过贪，把相邻的 `- insert:` 整段删掉，DSH 起不来；
- 改写 `package.json` 时 PowerShell 写入 UTF-8 BOM，Node 的 `JSON.parse` 拒绝，整个应用打不开。

本插件把配置放在 `<DSH_HOME>/subagent-setup/config.json`：

- 写入是 **临时文件 + rename** 的原子替换；
- **永不写 BOM**，读取时容忍 BOM；
- 配置坏了只影响本插件（启动日志报错、插件空转），**不会拖垮宿主启动**；
- 三台机器之间要同步，只需要拷这一个文件。

代价：DSH 设置页里不会出现"标准设置表单"（本来也不需要，我们有自己的页面）。

### 2. 子代理启动 API 做特性探测

DSH 0.2.1 把 `ctx.subagents.start/startContinuable` 换成了 `startActivation`。上游硬调用旧接口，
于是整个工具直接报 `is not a function`。

本插件的委派实现（v0.2.0）按能力选择：

```
有 startActivation  → startActivation({ provider, label, request, signal, delivery })
只有旧接口          → delivery=parent 走 startContinuable，否则走 start
```

这样同一份代码在 0.2.0 与 0.2.1 上都能用，升级 DSH 不必再打补丁。

### 3. 中文只覆盖"给人看"的文本

| 文本 | 语言 | 理由 |
|---|---|---|
| 设置页标题、字段名、按钮、错误 | 中文 | 使用者看 |
| 启动日志、配置校验错误 | 中文 | 排错时看 |
| `description`（路由描述）、工具说明、SKILL.md | **英文** | 模型按语义选路；与既有英文技能文档保持一致 |

### 4. 不在别人家里打架

- 工具名与上游**全部错开**，可与之并存做 A/B 对比：
  `subagent_route` / `subagent_route_catalog` / `subagent_route_configure` / `subagent_route_wait`
  （对应上游 `subagent_model` / `model_subagent_catalog` / `configure_subagent_models` / `wait-for-subagents`），
  技能名 `subagent-route-setup`（上游 `model-subagent-setup`）。
  代价：并存时模型会同时看到两个等待工具，验收时需指明用我们的。
- 不做 `wait-for-subagents` 的复刻：DSH 宿主本身已有等待/汇总能力，上游那套追踪器
  是它自己的历史包袱（含 watchdog、断线重连、父代理迁移等复杂逻辑）。

## 目录结构

```
plugin/
  index.js            宿主入口：name / inject / apply
  client.js           界面 bundle（window.__ModuleLoader__）
  cordis.patch.yml    只做 mount，不带 config
src/
  config.mjs          归一化与校验（纯函数，中文错误信息）
  store.mjs           原子读写 config.json（无 BOM）
  paths.mjs           DSH_HOME 解析（纯函数）
test/                 node --test，不依赖 DSH
```

`plugin/` 与 `src/` 分离的好处：逻辑可以脱离 DSH 运行测试。上游把两者混在一个文件里，
测试必须借助一整套假 ctx 才能跑。

## 配置格式

见 README 示例。字段与上游保持兼容（`alias/provider/model/displayName/tags/description/maxTokens/reasoningEffort`），
这样从上游迁移时只需要把 YAML 里的 `models:` 原文转成 JSON，不用重命名任何字段。

## 路线图

| 版本 | 内容 | 验证 |
|---|---|---|
| 0.1.0 | 配置模型 + 原子存储 + 中文设置页占位 | `node --test` 23 项 |
| 0.2.0 | `subagent_model` 工具（含 API 特性探测），系统提示注入 | 三台机器实跑四个别名 |
| 0.3.0 | 设置页读写 `config.json`（增删改、保存即生效） | 界面操作 + 重启后仍在 |
| 0.4.0 | 发布 tag、三台机器安装、README 补图 | GitHub 安装一条命令 |

## 已决问题（v0.2.0，不再变更）

1. **工具名**：四件套与上游全部错开并可共存 —— `subagent_route` / `subagent_route_catalog` /
   `subagent_route_configure` / `subagent_route_wait`；技能 `subagent-route-setup`。
2. **配置生效**：每次委派重读 `config.json`。**不**监听外部文件变更；
   但设置页写盘与 `configure` 工具写入后会主动重挂，否则新别名对模型不可见
   （挂载快照决定"模型看到什么"，磁盘决定"执行时用什么"）。
3. **让模型改配置**：**做**（`subagent_route_configure`），前提是工具描述里写死
   "只有用户明确要求并确认完整列表后才能 update"。
4. **技能**：**做**。技能正文用英文（给模型看），纪律照抄上游：禁止空话描述。
5. **`listingInactivityTurns`**：保留 → 因此接管 `list_agents` 输出过滤。
6. **设置页**：二级下拉（provider → model）只选不填，末尾「其他…」可手填；
   已存值不在目录中必须保留并标注，不得静默清空。
7. **`model` 参数不再用 enum**：静态枚举追不上人工改配置，改为执行期校验 +
   报错时列出当前可用别名。
