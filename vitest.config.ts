import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

/**
 * The UI primitives package ships CSS-module imports alongside its compiled
 * JavaScript.  Keep that package inside Vite's transform pipeline so Vitest
 * handles those imports as CSS modules instead of asking Node to load `.css`
 * files as external ESM.
 */
export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  resolve: { alias: [
    { find: /^@deepseek-ai\/dsh-token-monitor-contract\/src\//, replacement: fileURLToPath(new URL('./packages/util/token-monitor-contract/src/', import.meta.url)) },
    { find: /^@deepseek-ai\/dsh-token-monitor-contract$/, replacement: fileURLToPath(new URL('./packages/util/token-monitor-contract/src/index.ts', import.meta.url)) },
  ] },
  test: {
    execArgv: vitestExecArgv,
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
  },
})
