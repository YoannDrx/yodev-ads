export type ReportCadence = 'weekly' | 'monthly'

type ReportSchedule = {
  cadence: string
  scheduleWeekday: number | null
  scheduleMonthday: number | null
  sendHour: number
  timezone: string
}

function localScheduleParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
  if (weekday < 0) throw new Error('Jour local impossible à déterminer.')
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    day: Number(values.day),
    hour: Number(values.hour),
    weekday: weekday === 0 ? 7 : weekday,
  }
}

export function reportScheduleRunKey(schedule: ReportSchedule, now = new Date()) {
  const local = localScheduleParts(now, schedule.timezone)
  if (local.hour < schedule.sendHour) return null
  if (schedule.cadence === 'weekly' && local.weekday !== schedule.scheduleWeekday) return null
  if (schedule.cadence === 'monthly' && local.day !== schedule.scheduleMonthday) return null
  if (schedule.cadence !== 'weekly' && schedule.cadence !== 'monthly') throw new Error('Cadence de rapport invalide.')
  return `${schedule.cadence}:${local.date}`
}

export function assertTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0))
  } catch {
    throw new Error('Fuseau horaire invalide.')
  }
  return timezone
}

export function normalizeReportRecipients(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))]
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]!)
}

export function scheduledReportEmail(input: {
  locale: 'fr' | 'en'
  brandName: string
  reportName: string
  clientName: string
  reportUrl: string
}) {
  const subject = `${input.reportName} · ${input.clientName}`.replace(/[\r\n]+/g, ' ').slice(0, 240)
  const brand = escapeHtml(input.brandName)
  const report = escapeHtml(input.reportName)
  const client = escapeHtml(input.clientName)
  const url = escapeHtml(input.reportUrl)
  if (input.locale === 'en') return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#12202b"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#19A58F">${brand} · Google Ads report</p><h1 style="font-size:24px">${report}</h1><p style="line-height:1.65;color:#52626f">The latest report for <strong>${client}</strong> is ready.</p><p style="margin:28px 0"><a href="${url}" style="display:inline-block;border-radius:10px;background:#176646;color:white;padding:12px 18px;text-decoration:none">Open the report</a></p><p style="font-size:12px;color:#80909b">This read-only link can be revoked by the workspace at any time.</p></div>`,
  }
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#12202b"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#19A58F">${brand} · rapport Google Ads</p><h1 style="font-size:24px">${report}</h1><p style="line-height:1.65;color:#52626f">Le dernier rapport de <strong>${client}</strong> est prêt.</p><p style="margin:28px 0"><a href="${url}" style="display:inline-block;border-radius:10px;background:#176646;color:white;padding:12px 18px;text-decoration:none">Ouvrir le rapport</a></p><p style="font-size:12px;color:#80909b">Ce lien en lecture seule peut être révoqué à tout moment par l’espace de travail.</p></div>`,
  }
}
