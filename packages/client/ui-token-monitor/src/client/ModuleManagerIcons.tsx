import { useId } from 'react'
/** Community glyphs copied from the accepted local preview. */
export function ManagerCommunityIcon({ kind }: { kind: 'github' | 'star' | 'qq' }) {
  const maskId = useId()
  if (kind === 'github') return (<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.72.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.5-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.15-.68-.54-.01-.55.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.9-3.64-4.01 0-.89.31-1.62.82-2.19-.08-.2-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.48 7.48 0 0 1 8 3.89c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.96.08 2.16.51.57.82 1.3.82 2.19 0 3.12-1.87 3.8-3.65 4.01.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.47.55.39A8.04 8.04 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z" /></svg>)
  if (kind === 'star') return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9L12 2.6Z" /></svg>)
  if (kind === 'qq') return (<svg viewBox="4 2 24 28" aria-hidden="true">
    <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="4" y="2" width="24" height="28">
      <path d="M4 2h24v28H4Z" fill="white" />
      <path d="M10 15.7c-.7 1.7-.9 3.6-.7 5.7.3 4.1 2.5 6.5 6.7 6.5s6.4-2.4 6.7-6.5c.2-2.1 0-4-.7-5.7Z" fill="black" />
      <ellipse cx="13.6" cy="8.5" rx="1.7" ry="2.35" fill="black" />
      <ellipse cx="18.3" cy="8.5" rx="1.6" ry="2.35" fill="black" />
      <path d="M10.8 11.3q5.2-.7 10.4 0l.2 1.1q-5.4 2.3-10.8 0Z" fill="black" />
      <path d="M7.8 13.8q8.2 2.3 16.4 0" fill="none" stroke="black" strokeWidth="1" />
    </mask></defs>
    <path d="M10.4 26.4c-1.8.2-2.8 1.3-2.9 2.6h7.4l.3-1.7Zm11.2 0c1.8.2 2.8 1.3 2.9 2.6h-7.4l-.3-1.7Z" fill="currentColor" />
    <path d="M16 3c-4.8 0-7.8 4.6-7.8 10.2L7.5 16c-1.6 2.3-2.5 5.3-2.6 8.1-.1.7.2.9.7.4l2-2.3C8 26.8 10.9 29 16 29s8-2.2 8.4-6.8l2 2.3c.5.5.8.3.7-.4-.1-2.8-1-5.8-2.6-8.1l-.7-2.8C23.8 7.6 20.8 3 16 3Z" fill="currentColor" mask={`url(#${maskId})`} />
    <ellipse cx="14.15" cy="8.75" rx=".7" ry=".8" fill="currentColor" />
    <path d="M17.4 8.75q.85-.65 1.65.05" fill="none" stroke="currentColor" strokeWidth=".65" strokeLinecap="round" />
    <path d="M7.7 14.8q8.3 2.1 16.6 0l.6 1.7c-2.9 1.2-6.7 1.6-10.9 1.3l-.2 4.2h-2.9l.1-4.6-3.9-.9Z" fill="currentColor" />
  </svg>)
  return null
}
