/**
 * yoga-wasm-web 兼容 shim（bun --compile 单文件打包专用）
 *
 * 背景：ink 的布局引擎 yoga-wasm-web/auto 在运行时通过
 *   createRequire(import.meta.url).resolve('./yoga.wasm') + readFile 加载 wasm 文件，
 * 编译成单文件二进制后该文件不存在（报错 Cannot find module './yoga.wasm'）。
 *
 * 方案：将 yoga.wasm 以 base64 内嵌（./yoga-wasm-b64.ts），启动时解码后
 *   直接调用 initYoga(ArrayBuffer) 完成同样的初始化，导出与 auto 入口
 *   完全一致的 Yoga 实例（已 await）。
 *
 * 通过 cli/tsconfig.json 的 paths 将 'yoga-wasm-web/auto' 重定向到本模块。
 * 开发模式（node dist/bin.js）不受影响：tsc 编译产物仍引用原包，
 * 只有 bun 打包时 paths 才会把 node_modules 内部的引用解析到本 shim。
 */

import initYoga, { type Yoga } from 'yoga-wasm-web'
import { WASM_BASE64 } from './yoga-wasm-b64.js'

const bytes = Uint8Array.from(atob(WASM_BASE64), c => c.charCodeAt(0))
const yoga: Yoga = await initYoga(bytes)

export default yoga
