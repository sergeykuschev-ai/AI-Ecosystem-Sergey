/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node tooling. */
// Node tooling only: reuse the installed compiler, without a test framework dependency.
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  })
  module._compile(outputText, filename)
}
