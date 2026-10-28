/**
 * dsh-subagent-setup —— 界面半。
 *
 * 手写 CJS bundle（无构建步骤、无 JSX、无 npm 依赖）。
 * 通过宿主 HTTP 路由读写 <DSH_HOME>/subagent-setup/config.json：
 *   GET /dsh-subagent-setup/settings
 *   PUT /dsh-subagent-setup/settings
 *   GET /dsh-subagent-setup/catalog
 *
 * 二级下拉：一级 provider（显示「名称（id）」），二级 model（输入过滤 + 末尾「其他…」）。
 * 目录查询失败按 provider 单独降级，绝不清空已存值；保存失败保留用户输入。
 */
window.__ModuleLoader__.load({
  id: 'dsh-subagent-setup',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement


    const SETTINGS_ROUTE = '/dsh-subagent-setup/settings'
    const CATALOG_ROUTE = '/dsh-subagent-setup/catalog'
    const SUBAGENT_MODEL_ROUTE = '/dsh-subagent-setup/subagent-model'
    const CLOSE_SUBAGENT_ROUTE = '/dsh-subagent-setup/close-subagent'

    const ALIAS_RE = /^[a-z0-9][a-z0-9_-]*$/
    const TAG_RE = /^[a-z0-9][a-z0-9-]*$/

    // DSH 内置的两个执行后端；存了其他值时作为「当前值」保留在下拉里。
    const SUBAGENT_PROVIDER_OPTIONS = ['spawn', 'fork']

    const styles = {
      section: { maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 16, color: 'var(--dsw-alias-label-primary)' },
      heading: { margin: 0, fontSize: 18, lineHeight: '26px' },
      intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 14, lineHeight: '22px' },
      tip: { margin: 0, padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: '20px' },
      code: { color: 'var(--dsw-alias-label-primary)', fontFamily: 'monospace', fontWeight: 600 },
      panel: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12 },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 },
      field: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
      label: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
      input: { boxSizing: 'border-box', width: '100%', minHeight: 36, padding: '7px 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit' },
      textarea: { boxSizing: 'border-box', width: '100%', minHeight: 76, resize: 'vertical', padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit' },
      rowHead: { display: 'flex', alignItems: 'center', gap: 8 },
      rowTitle: { margin: 0, fontSize: 15, flex: 1 },
      separator: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 },
      separatorTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
      separatorLine: { flex: 1, borderTop: '1px solid var(--dsw-alias-border-l2)' },
      actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      button: { minHeight: 34, padding: '0 13px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 17, background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', font: 'inherit' },
      primaryButton: { minHeight: 36, padding: '0 16px', border: 0, borderRadius: 18, background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)', cursor: 'pointer', font: 'inherit' },
      dangerButton: { minHeight: 32, padding: '0 11px', border: '1px solid var(--dsw-alias-state-error-primary)', borderRadius: 16, background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', font: 'inherit' },
      smallButton: { minHeight: 28, padding: '0 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 14, background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', font: 'inherit', fontSize: 12 },
      // 会话头部空间窄，按钮与旁边胶囊同高（24px），不再用表单里那套 32px 的大按钮
      closeActionButton: { minHeight: 24, padding: '0 10px', border: '1px solid var(--dsw-alias-state-error-primary)', borderRadius: 12, background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', font: 'inherit', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' },
      error: { margin: 0, color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 },
      success: { margin: 0, color: 'var(--dsw-alias-state-success-primary)', fontSize: 13 },
      checkbox: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
      hint: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px' },
      pickerWrap: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
      grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 },
      grid2: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
      tagsArea: { boxSizing: 'border-box', width: '100%', minHeight: 56, resize: 'vertical', padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', lineHeight: '20px' },
      modeRow: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
      modeOption: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
      selectTrigger: { boxSizing: 'border-box', width: '100%', minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', cursor: 'pointer', textAlign: 'left' },
      selectValue: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      caret: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
      dropdownPanel: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 },
      inlineError: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

      optionList: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflow: 'auto', padding: 4, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8 },
      optionRow: { boxSizing: 'border-box', width: '100%', minHeight: 32, padding: '5px 8px', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-primary)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 13, lineHeight: '18px' },
      optionRowSelected: { background: 'var(--dsw-alias-bg-layer-1)', fontWeight: 600 },
      routeChip: { display: 'inline-flex', alignItems: 'center', padding: '2px 9px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 11, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', font: 'inherit', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' },
      otherRow: { boxSizing: 'border-box', width: '100%', minHeight: 32, padding: '5px 8px', border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 13 },
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    let uiFlags = null
    let uiFlagsPromise = null

    async function fetchUiFlags() {
      const flags = { showRouteDock: true, showCloseAction: true }
      try {
        const response = await fetch(SETTINGS_ROUTE, { headers: { accept: 'application/json' } })
        if (response.ok) {
          let value
          try {
            value = await response.json()
          } catch {
            value = undefined
          }
          const config = value !== null && typeof value === 'object' && !Array.isArray(value) ? value.config : undefined
          if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
            if (config.showRouteDock === false) flags.showRouteDock = false
            if (config.showCloseAction === false) flags.showCloseAction = false
          }
        }
      } catch {
        // 取不到设置就当作 true：宁可显示，也不要整块消失。
      }
      uiFlags = flags
      return uiFlags
    }

    async function loadUiFlags() {
      if (uiFlags !== null) return uiFlags
      if (uiFlagsPromise === null) uiFlagsPromise = fetchUiFlags()
      return uiFlagsPromise
    }

    async function requestSettings(method, body) {
      const response = await fetch(SETTINGS_ROUTE, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      let value
      try {
        value = await response.json()
      } catch {
        throw new Error('设置接口返回状态码 ' + response.status + '。')
      }
      if (!response.ok) {
        throw new Error(typeof value.error === 'string' ? value.error : '设置接口返回状态码 ' + response.status + '。')
      }
      return value
    }

    async function requestSubagentModel(childId) {
      const response = await fetch(SUBAGENT_MODEL_ROUTE + '?id=' + encodeURIComponent(childId), { headers: { accept: 'application/json' } })
      if (!response.ok) return null
      let value
      try {
        value = await response.json()
      } catch {
        return null
      }
      if (value !== null && typeof value === 'object'
        && value.found === true
        && typeof value.provider === 'string' && value.provider.length > 0
        && typeof value.model === 'string' && value.model.length > 0) {
        return value
      }
      return null
    }

    async function requestClose(parentSessionId, childSessionId) {
      const response = await fetch(CLOSE_SUBAGENT_ROUTE, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ parentSessionId, childSessionId }),
      })
      let value
      try {
        value = await response.json()
      } catch {
        throw new Error('释放接口返回状态码 ' + response.status + '。')
      }
      if (!response.ok) {
        throw new Error(typeof value.error === 'string' ? value.error : '释放接口返回状态码 ' + response.status + '。')
      }
      return value
    }

    async function requestCatalog() {
      const response = await fetch(CATALOG_ROUTE, { headers: { accept: 'application/json' } })
      let value
      try {
        value = await response.json()
      } catch {
        throw new Error('子智能体模型目录接口返回状态码 ' + response.status + '。')
      }
      if (!response.ok) {
        throw new Error(typeof value.error === 'string' ? value.error : '子智能体模型目录接口返回状态码 ' + response.status + '。')
      }
      return value
    }

    function parseTags(value) {
      return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))]
    }

    let nextRowKey = 0

    function newRowKey() {
      nextRowKey += 1
      return 'model-' + nextRowKey
    }

    function emptyModelRow() {
      return {
        rowKey: newRowKey(),
        alias: '',
        provider: '',
        model: '',
        displayName: '',
        tags: '',
        description: '',
        maxTokens: '',
        reasoningEffort: '',
        agentPreset: '',
        manual: false,
      }
    }

    function draftFromSettings(config) {
      const source = typeof config === 'object' && config !== null && !Array.isArray(config) ? config : {}
      return {
        subagentProvider: typeof source.subagentProvider === 'string' && source.subagentProvider.trim().length > 0 ? source.subagentProvider : 'spawn',
        maxDepth: source.maxDepth === undefined || source.maxDepth === null ? '3' : String(source.maxDepth),
        enableRunInBackground: source.enableRunInBackground !== false,
        listingInactivityTurns: source.listingInactivityTurns === undefined || source.listingInactivityTurns === null ? '20' : String(source.listingInactivityTurns),
        showRouteDock: source.showRouteDock !== false,
        showCloseAction: source.showCloseAction !== false,
        models: Array.isArray(source.models)
          ? source.models.map((entry) => ({
            ...emptyModelRow(),
            alias: typeof entry.alias === 'string' ? entry.alias : '',
            provider: typeof entry.provider === 'string' ? entry.provider : '',
            model: typeof entry.model === 'string' ? entry.model : '',
            displayName: typeof entry.displayName === 'string' ? entry.displayName : '',
            tags: Array.isArray(entry.tags) ? entry.tags.join(', ') : '',
            description: typeof entry.description === 'string' ? entry.description : '',
            maxTokens: entry.maxTokens === undefined || entry.maxTokens === null ? '' : String(entry.maxTokens),
            reasoningEffort: typeof entry.reasoningEffort === 'string' ? entry.reasoningEffort : '',
            agentPreset: typeof entry.agentPreset === 'string' ? entry.agentPreset : '',
          }))
          : [],
      }
    }

    function settingsFromDraft(draft) {
      return {
        subagentProvider: draft.subagentProvider.trim(),
        maxDepth: Number(draft.maxDepth),
        enableRunInBackground: draft.enableRunInBackground,
        listingInactivityTurns: Number(draft.listingInactivityTurns),
        showRouteDock: draft.showRouteDock,
        showCloseAction: draft.showCloseAction,
        models: draft.models.map((row) => ({
          alias: row.alias.trim(),
          provider: row.provider.trim(),
          model: row.model.trim(),
          ...(row.displayName.trim().length === 0 ? {} : { displayName: row.displayName.trim() }),
          tags: parseTags(row.tags),
          description: row.description.trim(),
          ...(row.maxTokens.trim().length === 0 ? {} : { maxTokens: Number(row.maxTokens) }),
          ...(row.reasoningEffort.trim().length === 0 ? {} : { reasoningEffort: row.reasoningEffort.trim() }),
          ...(row.agentPreset.trim().length === 0 ? {} : { agentPreset: row.agentPreset.trim() }),
        })),
      }
    }

    function validateDraft(draft) {
      if (draft.subagentProvider.trim().length === 0) return '执行方式不能为空。'
      const maxDepth = Number(draft.maxDepth)
      if (draft.maxDepth.trim().length === 0 || !Number.isSafeInteger(maxDepth) || maxDepth < 0) {
        return '最大委派深度必须是非负整数。'
      }
      const listingInactivityTurns = Number(draft.listingInactivityTurns)
      if (draft.listingInactivityTurns.trim().length === 0 || !Number.isSafeInteger(listingInactivityTurns) || listingInactivityTurns < 0) {
        return '闲置多少轮后从列表隐藏必须是非负整数。'
      }
      const aliases = new Set()
      for (let index = 0; index < draft.models.length; index += 1) {
        const row = draft.models[index]
        const label = '第 ' + (index + 1) + ' 个子智能体'
        const alias = row.alias.trim()
        if (!ALIAS_RE.test(alias)) {
          return label + '：别名只能使用小写字母、数字、下划线或连字符，且以字母或数字开头。'
        }
        if (aliases.has(alias)) return label + '：别名「' + alias + '」重复。'
        aliases.add(alias)
        if (row.provider.trim().length === 0) return label + '：子智能体代理不能为空。'
        if (row.model.trim().length === 0) return label + '：子智能体模型不能为空。'
        if (row.description.trim().length === 0) return label + '：用途描述不能为空。'
        const tags = parseTags(row.tags)
        for (const tag of tags) {
          if (!TAG_RE.test(tag)) return label + '：标签「' + tag + '」只能使用小写字母、数字或连字符。'
        }
        if (row.maxTokens.trim().length > 0) {
          const maxTokens = Number(row.maxTokens)
          if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) return label + '：最大令牌数必须是正整数。'
        }
        // 同一 provider/model 允许多条别名（不同推理档位），这里不做路由去重。
      }
      return undefined
    }

    function modelLabel(entry) {
      const name = typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id
      return name === entry.id ? entry.id : name + '（' + entry.id + '）'
    }

    // 用 div 而非 label：卡片里会出现 radio 的 label，嵌套 label 是无效结构。
    function Field(props) {
      return h('div', { style: styles.field },
        h('span', { style: styles.label }, props.label),
        props.children)
    }

    function textInput(value, onChange, options = {}) {
      return h('input', {
        style: styles.input,
        value,
        onChange: (event) => onChange(event.target.value),
        ...options,
      })
    }

    function ProviderPicker({ value, catalog, onChange, onRetry }) {
      const providers = Array.isArray(catalog.providers) ? catalog.providers : []
      const status = catalog.status

      if (status === 'loading') {
        return h('div', { style: styles.pickerWrap },
          h('select', { style: styles.input, disabled: true, value: '' },
            h('option', { value: '' }, value.length > 0 ? '当前值：' + value : '目录加载中…')),
          h('span', { style: styles.hint }, '子智能体模型目录加载中…'))
      }

      if (status === 'error') {
        return h('div', { style: styles.pickerWrap },
          h('select', { style: styles.input, disabled: true, value: '' },
            h('option', { value: '' }, value.length > 0 ? '当前值：' + value : '目录不可用')),
          h('div', { style: styles.inlineError },
            h('span', { style: styles.error }, '目录加载失败：' + (catalog.error ?? '未知错误')),
            h('button', { type: 'button', style: styles.smallButton, onClick: onRetry }, '重试')))
      }

      const known = providers.some((entry) => entry.id === value)
      return h('div', { style: styles.pickerWrap },
        h('select', {
          style: styles.input,
          value,
          onChange: (event) => onChange(event.target.value),
        },
          h('option', { value: '' }, '请选择子智能体代理'),
          !known && value.length > 0 ? h('option', { key: '__saved__', value }, value + '（目录中未找到）') : null,
          providers.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name + '（' + entry.id + '）'))))
    }

    // 模型下拉：点开后在文档流内展开；列表超过 10 条时才在面板底部出现筛选框。
    function ModelPicker({ providerId, value, catalog, onPickModel, onRetry }) {
      const [open, setOpen] = React.useState(false)
      const [filter, setFilter] = React.useState('')
      const providers = Array.isArray(catalog.providers) ? catalog.providers : []
      const provider = providers.find((entry) => entry.id === providerId)

      const toggle = () => {
        setFilter('')
        setOpen(!open)
      }

      const trigger = h('button', {
        type: 'button',
        style: styles.selectTrigger,
        onClick: toggle,
        'aria-expanded': open,
      },
        h('span', { style: styles.selectValue }, value.length === 0 ? '请选择子智能体模型' : value),
        h('span', { style: styles.caret }, open ? '▴' : '▾'))

      const wrap = (panel) => h('div', { style: styles.pickerWrap }, trigger, open ? panel : null)

      if (providerId.length === 0) {
        return wrap(h('div', { style: styles.dropdownPanel },
          h('div', { style: styles.hint }, '请先在「子智能体代理」里选择一个代理。')))
      }

      if (provider === undefined) {
        return wrap(h('div', { style: styles.dropdownPanel },
          h('div', { style: styles.hint }, providerId + '（目录中未找到）'),
          h('div', { style: styles.hint }, '可把「子智能体模型」切到「其他」手动填写。')))
      }

      if (provider.error !== undefined && provider.error !== null && provider.error !== '') {
        return wrap(h('div', { style: styles.dropdownPanel },
          h('div', { style: styles.inlineError },
            h('span', { style: styles.error }, '目录不可用：' + provider.error),
            h('button', { type: 'button', style: styles.smallButton, onClick: onRetry }, '重试')),
          value.length > 0 ? h('div', { style: styles.hint }, '当前值：' + value + '（已保留）') : null))
      }

      const models = Array.isArray(provider.models) ? provider.models : []
      const query = filter.trim().toLowerCase()
      const filtered = query.length === 0
        ? models
        : models.filter((entry) => entry.id.toLowerCase().includes(query) || (entry.name ?? '').toLowerCase().includes(query))
      const needFilter = models.length > 10

      return wrap(h('div', { style: styles.dropdownPanel },
        h('div', { style: styles.optionList },
          filtered.map((entry) => h('button', {
            key: entry.id,
            type: 'button',
            style: { ...styles.optionRow, ...(entry.id === value ? styles.optionRowSelected : {}) },
            onClick: () => {
              setFilter('')
              setOpen(false)
              onPickModel(entry.id)
            },
          }, modelLabel(entry))),
          filtered.length === 0 ? h('div', { key: '__empty__', style: styles.hint }, '没有匹配的子智能体模型') : null),
        needFilter
          ? h('input', {
            style: styles.input,
            value: filter,
            onChange: (event) => setFilter(event.target.value),
            placeholder: '输入以筛选子智能体模型…',
          })
          : null))
    }

    function ModelCard({ row, index, catalog, onChange, onRemove, onRetryCatalog }) {
      const title = row.displayName.trim().length > 0
        ? row.displayName.trim()
        : (row.alias.trim().length > 0 ? row.alias.trim() : '子智能体 ' + (index + 1))

      const routeText = row.provider.trim().length > 0 && row.model.trim().length > 0
        ? '代理 / 模型：' + row.provider.trim() + ' / ' + row.model.trim()
        : '尚未选择子智能体代理与模型'

      const changeProvider = (providerId) => {
        if (providerId !== row.provider) {
          onChange('provider', providerId)
          onChange('model', '')
          onChange('manual', false)
        }
      }

      return h('div', { style: styles.panel },
        h('div', { style: styles.rowHead },
          h('div', null,
            h('h3', { style: styles.rowTitle }, title),
            h('p', { style: { margin: '2px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' } }, routeText)),
          h('button', { type: 'button', style: styles.dangerButton, onClick: onRemove }, '删除')),
        h('div', { style: styles.grid3 },
          h(Field, { label: '别名' },
            textInput(row.alias, (value) => onChange('alias', value), { placeholder: '小写字母、数字、下划线' })),
          h(Field, { label: '显示名' },
            textInput(row.displayName, (value) => onChange('displayName', value), { placeholder: '快速模型' })),
          h(Field, { label: '子智能体代理' },
            h(ProviderPicker, {
              value: row.provider,
              catalog,
              onChange: changeProvider,
              onRetry: onRetryCatalog,
            }))),
        h(Field, { label: '子智能体模型' },
          h('div', { style: styles.modeRow },
            h('label', { style: styles.modeOption },
              h('input', {
                type: 'radio',
                name: 'subagent-model-mode-' + index,
                checked: !row.manual,
                onChange: () => onChange('manual', false),
              }),
              '从列表中选择'),
            h('label', { style: styles.modeOption },
              h('input', {
                type: 'radio',
                name: 'subagent-model-mode-' + index,
                checked: row.manual,
                onChange: () => onChange('manual', true),
              }),
              '其他（手动填写模型标识）')),
          row.manual
            ? textInput(row.model, (value) => onChange('model', value), { placeholder: '手动填写模型标识，例如 openai/gpt-6.1-sol' })
            : h(ModelPicker, {
              key: row.provider,
              providerId: row.provider,
              value: row.model,
              catalog,
              onPickModel: (modelId) => onChange('model', modelId),
              onRetry: onRetryCatalog,
            })),
        h('div', { style: styles.grid2 },
          h(Field, { label: '最大令牌数（可不填）' },
            textInput(row.maxTokens, (value) => onChange('maxTokens', value), { type: 'number', min: 1, step: 1, placeholder: '留空使用默认值' })),
          h(Field, { label: '默认思考档位（可不填）' },
            textInput(row.reasoningEffort, (value) => onChange('reasoningEffort', value), { placeholder: '留空使用默认档位' }))),
        h(Field, { label: 'Agent 预设（可不填）' },
          textInput(row.agentPreset, (value) => onChange('agentPreset', value), { placeholder: '留空表示用默认代理形态' })),
        h(Field, { label: '标签（逗号分隔）' },
          h('textarea', {
            style: styles.tagsArea,
            value: row.tags,
            onChange: (event) => onChange('tags', event.target.value),
            placeholder: '小写字母、数字、连字符，用逗号分隔；标签较多时会自动换行',
          })),
        h(Field, { label: '何时使用这个子智能体' },
          h('textarea', {
            style: styles.textarea,
            value: row.description,
            onChange: (event) => onChange('description', event.target.value),
            placeholder: '例如：适合边界清晰的机械性工作，延迟低。',
          })))
    }

    function SettingsSection() {
      const [snapshot, setSnapshot] = React.useState({ status: 'loading', revision: '', error: null, saved: false })
      const [draft, setDraft] = React.useState(() => draftFromSettings({}))
      const [catalog, setCatalog] = React.useState({ status: 'loading', error: null, providers: [] })
      const alive = React.useRef(true)
      const settingsGeneration = React.useRef(0)
      const catalogGeneration = React.useRef(0)

      const loadSettings = React.useCallback(async () => {
        const own = ++settingsGeneration.current
        setSnapshot((previous) => ({ ...previous, status: 'loading', error: null, saved: false }))
        try {
          const value = await requestSettings('GET')
          if (!alive.current || own !== settingsGeneration.current) return
          setDraft(draftFromSettings(value.config))
          setSnapshot({
            status: 'ready',
            revision: typeof value.revision === 'string' ? value.revision : '',
            error: null,
            saved: false,
          })
        } catch (error) {
          if (!alive.current || own !== settingsGeneration.current) return
          setSnapshot((previous) => ({ ...previous, status: 'error', error: messageOf(error), saved: false }))
        }
      }, [])

      const loadCatalog = React.useCallback(async () => {
        const own = ++catalogGeneration.current
        setCatalog((previous) => ({ ...previous, status: 'loading', error: null }))
        try {
          const value = await requestCatalog()
          if (!alive.current || own !== catalogGeneration.current) return
          setCatalog({ status: 'ready', error: null, providers: Array.isArray(value.providers) ? value.providers : [] })
        } catch (error) {
          if (!alive.current || own !== catalogGeneration.current) return
          setCatalog((previous) => ({ ...previous, status: 'error', error: messageOf(error) }))
        }
      }, [])

      React.useEffect(() => {
        alive.current = true
        void loadSettings()
        void loadCatalog()
        return () => {
          alive.current = false
          settingsGeneration.current += 1
          catalogGeneration.current += 1
        }
      }, [loadSettings, loadCatalog])

      const updateGlobal = (field, value) => {
        setDraft((previous) => ({ ...previous, [field]: value }))
        setSnapshot((previous) => ({ ...previous, saved: false }))
      }

      const updateModel = (index, field, value) => {
        setDraft((previous) => ({
          ...previous,
          models: previous.models.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
        }))
        setSnapshot((previous) => ({ ...previous, saved: false }))
      }

      const addModel = () => {
        setDraft((previous) => ({ ...previous, models: [...previous.models, emptyModelRow()] }))
        setSnapshot((previous) => ({ ...previous, saved: false }))
      }

      const removeModel = (index) => {
        setDraft((previous) => ({ ...previous, models: previous.models.filter((_row, rowIndex) => rowIndex !== index) }))
        setSnapshot((previous) => ({ ...previous, saved: false }))
      }

      const save = async () => {
        const failure = validateDraft(draft)
        if (failure !== undefined) {
          setSnapshot((previous) => ({ ...previous, status: 'ready', error: failure, saved: false }))
          return
        }
        setSnapshot((previous) => ({ ...previous, status: 'saving', error: null, saved: false }))
        try {
          const value = await requestSettings('PUT', {
            config: settingsFromDraft(draft),
            expectedRevision: snapshot.revision,
          })
          setSnapshot((previous) => ({ ...previous, status: 'ready', revision: value.revision, error: null, saved: true }))
        } catch (error) {
          // 保存失败：只显示错误，draft 不动，用户输入不滚回。
          setSnapshot((previous) => ({ ...previous, status: 'ready', error: messageOf(error), saved: false }))
        }
      }

      const providerOptions = SUBAGENT_PROVIDER_OPTIONS.slice()
      if (draft.subagentProvider.length > 0 && !providerOptions.includes(draft.subagentProvider)) {
        providerOptions.unshift(draft.subagentProvider)
      }

      const modelCards = draft.models.map((row, index) => h(ModelCard, {
        key: row.rowKey,
        row,
        index,
        catalog,
        onChange: (field, value) => updateModel(index, field, value),
        onRemove: () => removeModel(index),
        onRetryCatalog: () => { void loadCatalog() },
      }))

      const saving = snapshot.status === 'saving'

      return h('section', { style: styles.section },
        h('h2', { style: styles.heading }, '子智能体设置'),
        h('p', { style: styles.intro },
          '为子智能体按别名配置子智能体模型。配置保存在 ',
          h('code', { style: styles.code }, '<DSH_HOME>/subagent-setup/config.json'),
          '，保存后立即生效。'),
        h('div', { style: styles.panel },
          h('h3', { style: styles.rowTitle }, '委派默认值'),
          h('div', { style: styles.grid },
            h(Field, { label: '执行方式' },
              h('select', {
                style: styles.input,
                value: draft.subagentProvider,
                title: 'spawn（每次新建，独立上下文）；fork（继承当前会话的上下文）。',
                onChange: (event) => updateGlobal('subagentProvider', event.target.value),
              },
                providerOptions.map((value) => h('option', { key: value, value },
                  SUBAGENT_PROVIDER_OPTIONS.includes(value) ? value + (value === 'spawn' ? '（每次新建，独立上下文）' : '（继承当前会话的上下文）') : '原值（本次未识别）')))),
            h(Field, { label: '最大委派深度' },
              textInput(draft.maxDepth, (value) => updateGlobal('maxDepth', value), { type: 'number', min: 0, step: 1 })),
            h(Field, { label: '闲置多少轮后从列表隐藏' },
              textInput(draft.listingInactivityTurns, (value) => updateGlobal('listingInactivityTurns', value), {
                type: 'number',
                min: 0,
                step: 1,
                title: '父智能体连续多少轮没有联系该子智能体后，把它从列表里隐藏；0 表示永不过滤。',
              }))),
          h('label', { style: styles.checkbox },
            h('input', {
              type: 'checkbox',
              checked: draft.enableRunInBackground,
              onChange: (event) => updateGlobal('enableRunInBackground', event.target.checked),
            }),
            '允许后台运行子智能体'),
          h('label', { style: styles.checkbox },
            h('input', {
              type: 'checkbox',
              checked: draft.showRouteDock,
              onChange: (event) => updateGlobal('showRouteDock', event.target.checked),
            }),
            '在子代理会话中显示实际运行的路由'),
          h('label', { style: styles.checkbox },
            h('input', {
              type: 'checkbox',
              checked: draft.showCloseAction,
              onChange: (event) => updateGlobal('showCloseAction', event.target.checked),
            }),
            '在子代理会话头部显示『终止可持续状态』按钮')),
        h('div', { style: styles.separator },
          h('h3', { style: styles.separatorTitle }, '子智能体列表'),
          h('span', { style: styles.separatorLine, 'aria-hidden': true })),
        ...modelCards,
        h('div', { style: styles.actions },
          h('button', { type: 'button', style: styles.button, onClick: addModel, disabled: saving }, '添加子智能体'),
          h('button', {
            type: 'button',
            style: styles.primaryButton,
            onClick: save,
            disabled: saving || snapshot.status === 'loading',
          }, saving ? '保存中…' : '保存')),
        h('p', { style: styles.tip }, '把列表清空即等同于关闭委派能力：宿主在列表为空时不会注册委派工具，模型将无法再派发子智能体。'),
        snapshot.status === 'loading' ? h('p', { style: styles.intro }, '正在加载配置…') : null,
        snapshot.error !== null ? h('p', { style: styles.error }, snapshot.error) : null,
        snapshot.saved ? h('p', { style: styles.success }, '已保存。') : null)
    }

    const inject = ['slots']

    function RouteDock({ useSession, sessionId }) {
      const [route, setRoute] = React.useState(null)
      const [hidden, setHidden] = React.useState(false)
      const session = typeof useSession === 'function' ? useSession((state) => state) : undefined
      const childId = session?.subagent?.address?.childSessionId

      React.useEffect(() => {
        let alive = true
        loadUiFlags().then((flags) => {
          if (alive && flags.showRouteDock === false) setHidden(true)
        }).catch(() => {})
        return () => {
          alive = false
        }
      }, [])

      React.useEffect(() => {
        if (typeof childId !== 'string' || childId.length === 0) {
          setRoute(null)
          return undefined
        }
        let alive = true
        requestSubagentModel(childId).then((value) => {
          if (alive) setRoute(value)
        }).catch(() => {
          if (alive) setRoute(null)
        })
        return () => {
          alive = false
        }
      }, [childId])

      if (hidden) return null
      if (typeof childId !== 'string' || childId.length === 0) return null
      if (route === null) return null
      // 头部空间有限：优先显示配置里的别名，鼠标悬停显示完整 provider/model。
      // 优先显示给人看的名字：别名可能是中性句柄（a1/a2…），人看上去没有意义。
      const short = typeof route.displayName === 'string' && route.displayName.length > 0
        ? route.displayName
        : typeof route.alias === 'string' && route.alias.length > 0
          ? route.alias
          : route.provider + '/' + route.model
      return h('span', {
        style: styles.routeChip,
        role: 'status',
        title: '子代理实际运行于 ' + route.provider + '/' + route.model,
      }, '运行于 ' + short)
    }

    function CloseAction({ useSession, sessionId }) {
      const session = typeof useSession === 'function' ? useSession((s) => s) : undefined
      const address = session?.subagent?.address
      const [state, setState] = React.useState('idle')
      const [error, setError] = React.useState(null)
      const [hidden, setHidden] = React.useState(false)
      const [available, setAvailable] = React.useState(false)

      React.useEffect(() => {
        setState('idle')
        setError(null)
      }, [sessionId])

      React.useEffect(() => {
        let alive = true
        loadUiFlags().then((flags) => {
          if (alive && flags.showCloseAction === false) setHidden(true)
        }).catch(() => {})
        return () => {
          alive = false
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        let timer = null
        let attempts = 0

        // 有界重试：条目被停用/启用后按钮能自己跟上，不必刷新整个页面。
        const schedule = () => {
          if (!alive || attempts >= 6) return
          timer = setTimeout(probe, 5000)
        }

        const probe = () => {
          attempts += 1
          fetch(CLOSE_SUBAGENT_ROUTE, { headers: { accept: 'application/json' } })
            .then((response) => {
              if (!alive) return
              if (!response.ok) {
                setAvailable(false)
                schedule()
                return
              }
              response.json().then((value) => {
                if (!alive) return
                const ok = value !== null && typeof value === 'object' && value.available === true
                setAvailable(ok)
                if (!ok) schedule()
              }).catch(() => {
                if (!alive) return
                setAvailable(false)
                schedule()
              })
            })
            .catch(() => {
              if (!alive) return
              setAvailable(false)
              schedule()
            })
        }

        probe()
        // 切回窗口时重置重试预算并立刻再探：用户可能刚在插件管理页动过条目。
        const onFocus = () => { attempts = 0; probe() }
        const canListen = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
        if (canListen) window.addEventListener('focus', onFocus)
        return () => {
          alive = false
          if (timer !== null) clearTimeout(timer)
          if (canListen) window.removeEventListener('focus', onFocus)
        }
      }, [sessionId])

      if (hidden) return null
      if (!available) return null
      if (address?.mode !== 'continuable') return null

      const onClose = async () => {
        if (state === 'closing') return
        setState('closing')
        setError(null)
        try {
          const value = await requestClose(address.parentSessionId, address.childSessionId)
          if (value !== null && typeof value === 'object' && value.closed === true) {
            setState('closed')
          } else {
            setState('failed')
            setError(value !== null && typeof value === 'object' && typeof value.reason === 'string' ? value.reason : '释放失败。')
          }
        } catch (requestError) {
          setState('failed')
          setError(messageOf(requestError))
        }
      }

      if (state === 'closed') {
        return h('span', { style: styles.success, role: 'status' }, '已释放')
      }
      return h('div', { style: styles.inlineError },
        h('button', {
          type: 'button',
          // 破坏性动作：用红色描边+红字，与界面里其它危险操作一致，也更容易被看见
          style: state === 'closing'
            ? { ...styles.closeActionButton, opacity: 0.6, cursor: 'default' }
            : styles.closeActionButton,
          disabled: state === 'closing',
          onClick: () => { void onClose() },
        }, state === 'closing' ? '释放中…' : '终止可持续状态'),
        state === 'failed' ? h('span', { style: styles.error, role: 'alert' }, error ?? '释放失败。') : null)
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'subagent-setup',
        order: 25,
        label: '子智能体设置',
      }, SettingsSection))
      // 放在会话头部而非底部输入框窄带：只读会话里输入框会被占位提示替换，
      // 连带 composer.dock 槽位一起消失，导致那行路由看不到。头部槽位不受影响。
      slots.inject('conversation.session.header.actions', () => slots.register({
        name: 'conversation.session.header.actions',
        id: 'subagent-setup-route',
        order: 20,
      }, RouteDock))
      slots.inject('conversation.session.header.actions', () => slots.register({
        name: 'conversation.session.header.actions',
        id: 'subagent-setup-close',
        order: 21,
      }, CloseAction))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    module.exports.SettingsSection = SettingsSection
    module.exports.RouteDock = RouteDock
    module.exports.CloseAction = CloseAction
    return module.exports
  },
})
