import { defineConfig } from 'vitest/config'

/**
 * The UI primitives package ships CSS-module imports alongside its compiled
 * JavaScript.  Keep that package inside Vite's transform pipeline so Vitest
 * handles those imports as CSS modules instead of asking Node to load `.css`
 * files as external ESM.
 */
export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
  },
})
