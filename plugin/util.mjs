/** 错误对象 → 可展示文本；非 Error 也统一转字符串。 */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
