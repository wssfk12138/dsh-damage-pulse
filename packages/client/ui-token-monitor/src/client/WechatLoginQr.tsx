/** Locally renders the short-lived login payload; owned by the removable WeChat channel. */
import { useEffect, useState } from 'react'
import { toString as renderQrSvg } from 'qrcode/lib/browser.js'
export function WechatLoginQr({ payload, loadingLabel, imageLabel }: { payload: string; loadingLabel: string; imageLabel: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let cancelled = false
    setSrc(undefined)
    void renderQrSvg(payload, { type: 'svg', width: 180, margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => {
        if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
      })
      .catch(() => { if (!cancelled) setSrc(undefined) })
    return () => { cancelled = true }
  }, [payload])
  if (src === undefined) return <span>{loadingLabel}</span>
  return <img aria-label={imageLabel} data-wechat-qr-image="" src={src} alt={imageLabel} width="180" height="180" />
}
