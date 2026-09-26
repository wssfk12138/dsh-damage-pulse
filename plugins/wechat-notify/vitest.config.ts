import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'
import { standardDecoratorPlugin } from '../../vitest.shared.ts'

export default defineConfig({
  resolve: {
    alias: {
      // 插件不在 pnpm workspace 的 node_modules 暴露范围内，base paths 未映射裸包名。
      '@deepseek-ai/dsh-tools': resolve(__dirname, '../../packages/core/tools/src/index.ts'),
    },
  },
  plugins: [tsconfigPaths({ projects: ['../../tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
