/** Use the host menu material where available; older public hosts retain a styled div. */
import { forwardRef, type ComponentPropsWithoutRef, type ComponentType } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import css from './MenuSurface.module.css'

const HostSurface = (primitives as unknown as { MenuSurface?: ComponentType<ComponentPropsWithoutRef<'div'> & { ref?: import('react').Ref<HTMLDivElement> }> }).MenuSurface
export const MenuSurface = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function MenuSurface(props, ref) {
  if (HostSurface) return <HostSurface {...props} ref={ref} />
  return <div {...props} ref={ref} data-menu-material="translucent" className={[css.surface, props.className].filter(Boolean).join(' ')} />
})
