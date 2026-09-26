import { describe, expect, it, vi } from 'vitest'
import { createGatedWechatSender } from '../src/wechat-gate.ts'

describe('shared WeChat notification master gate', () => {
  it('blocks budget, peak-period, and cache anomaly delivery while disabled', async () => {
    let enabled = false
    const send = vi.fn().mockResolvedValue({ ok: true })
    const gated = createGatedWechatSender(() => enabled, () => ({ send }))

    for (const message of ['budget', 'peak-period', 'cache-anomaly']) {
      await expect(gated.send(message)).resolves.toEqual({ ok: true })
    }
    expect(send).not.toHaveBeenCalled()

    enabled = true
    await gated.send('budget')
    await gated.send('peak-period')
    await gated.send('cache-anomaly')
    expect(send.mock.calls.map(call => call[0])).toEqual(['budget', 'peak-period', 'cache-anomaly'])
  })

  it("stays fail-soft when the optional sender is unavailable", async () => {
    const gated = createGatedWechatSender(() => true, () => undefined)
    await expect(gated.send('budget')).resolves.toEqual({ ok: true })
  })
})
