/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free Node 24 test loader. */
const { registerHooks } = require('node:module')

// Native type stripping needs explicit extensions for the app's relative TS imports.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})
