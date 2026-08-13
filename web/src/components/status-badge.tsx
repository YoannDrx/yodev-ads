import { Badge } from '@/components/ui/badge'
import type { Locale } from '@/lib/i18n'

const labels: Record<Locale, Record<string, string>> = {
  fr: {
    ENABLED: 'Active', PAUSED: 'En pause', active: 'Connecté', inactive: 'Inactif', pending: 'À approuver', executing: 'En cours', executed: 'Exécutée', rejected: 'Rejetée', expired: 'Expirée', failed: 'Échec', paused: 'En pause', open: 'À traiter', acknowledged: 'Acquittée', resolved: 'Résolue', revoked: 'Révoqué', todo: 'À faire', in_progress: 'En cours', blocked: 'Bloquée', done: 'Terminée', cancelled: 'Annulée', awaiting_support: 'En attente du support', awaiting_customer: 'En attente du client', closed: 'Fermé', investigating: 'Investigation', identified: 'Cause identifiée', monitoring: 'Surveillance', scheduled: 'Planifiée', completed: 'Terminée', insufficient_data: 'Données insuffisantes', batched: 'Regroupée',
  },
  en: {
    ENABLED: 'Active', PAUSED: 'Paused', active: 'Connected', inactive: 'Inactive', pending: 'Pending approval', executing: 'In progress', executed: 'Executed', rejected: 'Rejected', expired: 'Expired', failed: 'Failed', paused: 'Paused', open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved', revoked: 'Revoked', todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled', awaiting_support: 'Awaiting support', awaiting_customer: 'Awaiting customer', closed: 'Closed', investigating: 'Investigating', identified: 'Cause identified', monitoring: 'Monitoring', scheduled: 'Scheduled', completed: 'Completed', insufficient_data: 'Insufficient data', batched: 'Batched',
  },
}

export function StatusBadge({ status, locale = 'fr' }: { status: string; locale?: Locale }) {
  const positive = ['ENABLED', 'active', 'executed', 'resolved', 'done', 'completed'].includes(status)
  const warning = ['PAUSED', 'paused', 'pending', 'executing', 'open', 'todo', 'in_progress', 'blocked', 'awaiting_support', 'awaiting_customer', 'investigating', 'identified', 'monitoring', 'scheduled', 'insufficient_data', 'batched'].includes(status)
  return <Badge variant={positive ? 'default' : warning ? 'secondary' : 'outline'}>{labels[locale][status] ?? status}</Badge>
}
