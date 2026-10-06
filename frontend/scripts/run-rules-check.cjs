// 用 esbuild 的 JS API 把规则测试打成单文件再执行，绕开二进制直接 exec 的环境限制。
const esbuild = require('esbuild')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const out = path.join(__dirname, '.rules-check.mjs')
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'rules-check.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  logLevel: 'warning',
})
execFileSync(process.execPath, [out], { stdio: 'inherit' })
