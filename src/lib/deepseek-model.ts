/**
 * DeepSeek 模型配置（全局唯一来源）
 *
 * - 默认 deepseek-flash = DeepSeek-V4.1-Flash（text+image 输入，1M 上下文）
 * - 可通过 .env 的 DEEPSEEK_MODEL 覆盖（如切换 deepseek-v4-pro）
 * - 模型升级时只需改这一处（或改 .env），无需发版改代码
 */
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash'
