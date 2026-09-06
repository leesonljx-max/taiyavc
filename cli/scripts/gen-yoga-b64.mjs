/**
 * 重新生成 src/yoga-wasm-b64.ts（yoga.wasm 的 base64 内嵌）
 *
 * 用途：bun --compile 打包单文件二进制时，yoga-wasm-web 运行时读不到
 * node_modules 里的 wasm 文件，需要内嵌。升级 yoga-wasm-web 后重新执行：
 *
 *   node scripts/gen-yoga-b64.mjs
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const wasmPath = path.join(root, 'node_modules/yoga-wasm-web/dist/yoga.wasm')
const outPath = path.join(root, 'src/yoga-wasm-b64.ts')

const b64 = fs.readFileSync(wasmPath).toString('base64')
const content = `// 自动生成：yoga.wasm 的 base64 内嵌（bun --compile 单文件打包用，勿手改）\n// 重新生成：node scripts/gen-yoga-b64.mjs\nexport const WASM_BASE64 = '${b64}'\n`

fs.writeFileSync(outPath, content)
console.log(`已生成 ${outPath}（wasm ${fs.statSync(wasmPath).size} bytes → base64 ${b64.length} chars）`)
