type DigestCadence = 'none' | 'daily' | 'weekly'

function localParts(date: Date, timezone: string) {
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
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour), weekday: values.weekday }
}

export function taskDigestRunKey(input: { cadence: string; digestHour: number; timezone: string }, now = new Date()) {
  if (!['none', 'daily', 'weekly'].includes(input.cadence)) throw new Error('Cadence de digest invalide.')
  if (input.cadence === 'none') return null
  const local = localParts(now, input.timezone)
  if (local.hour < input.digestHour || (input.cadence === 'weekly' && local.weekday !== 'Mon')) return null
  return `${input.cadence}:${local.date}`
}

export function normalizedMentionHandles(mentions: string[]) {
  return [...new Set(mentions.map((mention) => mention.replace(/^@/, '').toLowerCase()).filter(Boolean))]
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]!)
}

export function taskMentionEmail(input: { locale: string; displayName: string; taskTitle: string; comment: string; taskUrl: string }) {
  const name = escapeHtml(input.displayName)
  const title = escapeHtml(input.taskTitle)
  const comment = escapeHtml(input.comment)
  const url = escapeHtml(input.taskUrl)
  if (input.locale === 'en') return {
    subject: `You were mentioned · ${input.taskTitle}`.replace(/[\r\n]+/g, ' ').slice(0, 240),
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#12202b"><h1 style="font-size:22px">Hello ${name}, you were mentioned</h1><p style="color:#52626f">Task: <strong>${title}</strong></p><blockquote style="margin:24px 0;border-left:3px solid #19A58F;padding-left:16px">${comment}</blockquote><a href="${url}">Open tasks</a></div>`,
  }
  return {
    subject: `Vous avez été mentionné·e · ${input.taskTitle}`.replace(/[\r\n]+/g, ' ').slice(0, 240),
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#12202b"><h1 style="font-size:22px">Bonjour ${name}, vous avez été mentionné·e</h1><p style="color:#52626f">Tâche : <strong>${title}</strong></p><blockquote style="margin:24px 0;border-left:3px solid #19A58F;padding-left:16px">${comment}</blockquote><a href="${url}">Ouvrir les tâches</a></div>`,
  }
}

export function taskDigestEmail(input: { locale: string; displayName: string; workspaceName: string; timezone: string; total: number; taskUrl: string; tasks: Array<{ title: string; status: string; dueAt: Date | null }> }) {
  if (!Number.isSafeInteger(input.total) || input.total < input.tasks.length) throw new Error('Invalid task digest total')
  const english = input.locale === 'en', locale = english ? 'en-GB' : 'fr-FR'
  const statusLabels: Record<string, string> = english ? { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked' } : { todo: 'À faire', in_progress: 'En cours', blocked: 'Bloquée' }
  const formatDate = new Intl.DateTimeFormat(locale, { timeZone: input.timezone, dateStyle: 'medium', timeStyle: 'short' })
  const rows = input.tasks.map((task) => `<li style="margin:14px 0;overflow-wrap:anywhere"><strong>${escapeHtml(task.title)}</strong> · ${escapeHtml(statusLabels[task.status] ?? task.status)}${task.dueAt ? ` · ${english ? 'Due' : 'Échéance'} ${escapeHtml(formatDate.format(task.dueAt))}` : ''}</li>`).join('')
  const name = escapeHtml(input.displayName), workspace = escapeHtml(input.workspaceName), url = escapeHtml(input.taskUrl)
  const total = input.total.toLocaleString(locale), shown = input.tasks.length.toLocaleString(locale)
  const coverage = input.total > input.tasks.length
    ? english ? `Preview: ${shown} of ${total} tasks, earliest deadlines first. Open the full list to see the remaining tasks.` : `Aperçu : ${shown} tâches sur ${total}, par échéance la plus proche. Ouvrez la liste complète pour consulter les autres tâches.`
    : english ? `All ${total} tasks are listed below, earliest deadlines first.` : `Les ${total} tâches figurent ci-dessous, par échéance la plus proche.`
  return {
    subject: english ? `Your task digest · ${total} open` : `Votre récapitulatif de tâches · ${total} ouverte${input.total > 1 ? 's' : ''}`,
    html: `<!doctype html><html lang="${english ? 'en' : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#12202b;overflow-wrap:anywhere"><h1 style="font-size:22px">${english ? 'Hello' : 'Bonjour'} ${name}</h1><p>${workspace}</p><p>${english ? `${total} open task(s) are assigned to you.` : `${total} tâche(s) ouverte(s) vous sont assignées.`}</p><p>${coverage}</p><p style="color:#52626f">${english ? 'Deadline timezone' : 'Fuseau des échéances'} : ${escapeHtml(input.timezone)}</p><ul style="padding-left:20px">${rows}</ul><a href="${url}">${english ? 'View all my open tasks' : 'Voir toutes mes tâches ouvertes'}</a><p style="font-size:12px;color:#52626f">${english ? 'Assignments and statuses may have changed since this digest was prepared.' : 'Les assignations et les statuts peuvent avoir changé depuis la préparation de ce récapitulatif.'}</p></div></body></html>`,
  }
}

export type { DigestCadence }
