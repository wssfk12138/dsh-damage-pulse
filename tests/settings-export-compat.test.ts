import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

for (const omitNamespaceHelper of [false, true]) {
  test(`built Host links with settingsNamespace ${omitNamespaceHelper ? 'absent' : 'present'}`, () => {
    const script = `
      import assert from 'node:assert/strict';
      import { registerHooks } from 'node:module';
      const settingsUrl = import.meta.resolve('@deepseek-ai/dsh-settings');
      const settings = await import(settingsUrl);
      assert.equal(typeof settings.SettingsConflictError, 'function');
      assert.equal(typeof settings.settingsNamespace, 'function');
      if (${omitNamespaceHelper}) {
        // Match the removed export without replacing the remaining real Host APIs.
        const exports = Object.keys(settings).filter(name => name !== 'settingsNamespace');
        const source = 'export { ' + exports.join(', ') + ' } from ' + JSON.stringify(settingsUrl);
        const url = 'data:text/javascript,' + encodeURIComponent(source);
        registerHooks({
          resolve(specifier, context, nextResolve) {
            if (specifier === '@deepseek-ai/dsh-settings') return { url, shortCircuit: true };
            return nextResolve(specifier, context);
          },
        });
        assert.equal('settingsNamespace' in await import('@deepseek-ai/dsh-settings'), false);
      }
      const plugin = await import(${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)});
      assert.equal(typeof plugin.apply, 'function');
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      timeout: 15_000,
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  })
}
