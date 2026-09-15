export type ReportLogo = { contentType: 'image/png'; base64: string; sha256: string }
export type ReportBranding = { accentColor: string; logo: ReportLogo | null }
export const DEFAULT_REPORT_ACCENT = '#176646'

export function reportAccent(value?: string | null) {
  return value && /^#[a-f0-9]{6}$/i.test(value) ? value : DEFAULT_REPORT_ACCENT
}
export function contrastText(color: string) {
  const channels = reportAccent(color).slice(1).match(/../g)!.map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  return (luminance + 0.05) / 0.05 >= 4.5 ? '#000000' : '#ffffff'
}
