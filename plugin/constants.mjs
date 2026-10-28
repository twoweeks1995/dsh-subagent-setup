/**
 * 跨模块共享的常量：工具名、systemPrompt 段名与技能名。
 * 单独成文件是为了避免 index.js、tools.mjs、delegation-runtime.mjs
 * 为了一个字符串互相 import。
 */
export const DELEGATION_TOOL_NAME = 'subagent_route'
export const CATALOG_TOOL_NAME = 'subagent_route_catalog'
export const CONFIGURE_TOOL_NAME = 'subagent_route_configure'
export const WAIT_TOOL_NAME = 'subagent_route_wait'
export const CLOSE_SUBAGENT_TOOL_NAME = 'close_subagent'
export const SECTION_NAME = 'tool:subagent-route:models'
export const SECTION_ORDER = 116.25
export const SKILL_NAME = 'subagent-route-setup'

export const MODEL_ROUTE_BASE_GUIDANCE = `For model-routed delegation, use \`${DELEGATION_TOOL_NAME}\` and choose \`model\` only from the routes listed in that tool's description.

How to choose, in this order:
1. Match the task against a route's description. The description is the ONLY routing criterion: it states when that route applies, so a route whose stated condition the task does not meet is not a candidate, however attractive its other attributes.
2. Only AFTER a route is chosen, use its tags and its reasoning-effort levels to decide parameters.
Never treat reasoning-effort levels, or a generic phrase such as "deep reasoning", as a reason to prefer a route. A route that advertises higher effort is not a better match, and effort is chosen after the route — not instead of a description match. Likewise, do not let tags override a description that excludes the task.
If no description clearly matches, say so, pick the closest, and state why.

Once you delegate work, do not also perform that work yourself; continue only with independent work.`
export const MODEL_ROUTE_WAIT_GUIDANCE = `After issuing all intended background delegations, call \`${WAIT_TOOL_NAME}\` before synthesizing their results or giving a final answer.`
