/** Tracks work owned by a module without stopping shared host services. */
export class ModuleWork {
  private active = true
  private readonly pending = new Set<Promise<unknown>>()

  /** Reject new work after stop begins and retain every admitted operation until settlement. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.active) return Promise.reject(Object.assign(new Error('Module is stopped'), { code: 'UNSUPPORTED' }))
    let request: Promise<T>
    try { request = operation() } catch (error) { return Promise.reject(error) }
    this.pending.add(request)
    void request.then(() => this.pending.delete(request), () => this.pending.delete(request))
    return request
  }

  /** Prevent new operations before waiting; shared connections remain available to their other users. */
  async stop(): Promise<void> {
    this.active = false
    await Promise.allSettled(this.pending)
  }
  /** Wait for admitted operations while ownership checks reject new removed-module writes. */
  async drain(): Promise<void> { await Promise.allSettled(this.pending) }
}
