/* global require, module, __dirname */
/**
 * `nest build` webpack override.
 *
 * The workspace packages (`@gungi/engine`, `@gungi/shared`) are consumed as
 * TypeScript sources (their `main` points at `src/index.ts`), so plain `tsc`
 * output cannot `require` them at runtime. They are bundled into
 * `dist/main.js`; every other dependency stays external and is resolved from
 * `node_modules` (hoisted to the repository root by npm workspaces).
 */
const path = require('node:path');
const nodeExternals = require('webpack-node-externals');

module.exports = (options) => ({
  ...options,
  externals: [
    nodeExternals({
      allowlist: [/^@gungi\//],
      additionalModuleDirs: [path.resolve(__dirname, '../node_modules')],
    }),
  ],
});
