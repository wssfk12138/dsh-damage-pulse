/** Pet assets use the same independently removable lifetime as pet UI. */
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleServices } from '../module-services.ts'

// Rendering runs in the client; the permanent asset gate follows the pet tombstone.
export function apply(_ctx: Context, _services: ModuleServices): void {}
