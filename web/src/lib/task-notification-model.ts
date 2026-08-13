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

export function taskDigestEmail(input: { locale: string; displayName: string; taskUrl: string; tasks: Array<{ title: string; status: string; dueAt: Date | null }> }) {
  const rows = input.tasks.map((task) => `<li style="margin:10px 0"><strong>${escapeHtml(task.title)}</strong> · ${escapeHtml(task.status)}${task.dueAt ? ` · ${escapeHtml(task.dueAt.toISOString().slice(0, 10))}` : ''}</li>`).join('')
  const name = escapeHtml(input.displayName)
  const url = escapeHtml(input.taskUrl)
  if (input.locale === 'en') return {
    subject: `Your task digest · ${input.tasks.length} open`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#12202b"><h1 style="font-size:22px">Hello ${name}</h1><p>${input.tasks.length} assigned task(s) require your attention.</p><ul>${rows}</ul><a href="${url}">Open tasks</a></div>`,
  }
  return {
    subject: `Votre digest de tâches · ${input.tasks.length} ouverte${input.tasks.length > 1 ? 's' : ''}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#12202b"><h1 style="font-size:22px">Bonjour ${name}</h1><p>${input.tasks.length} tâche(s) assignée(s) demandent votre attention.</p><ul>${rows}</ul><a href="${url}">Ouvrir les tâches</a></div>`,
  }
}

export type { DigestCadence }
