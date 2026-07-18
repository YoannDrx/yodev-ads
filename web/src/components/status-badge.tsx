import { Badge } from '@/components/ui/badge'

const labels: Record<string, string> = {
  ENABLED: 'Active',
  PAUSED: 'En pause',
  active: 'Connecté',
  pending: 'À approuver',
  executing: 'En cours',
  executed: 'Exécutée',
  rejected: 'Rejetée',
  expired: 'Expirée',
  failed: 'Échec',
  paused: 'En pause',
  open: 'À traiter',
  acknowledged: 'Acquittée',
  resolved: 'Résolue',
  revoked: 'Révoqué',
}

export function StatusBadge({ status }: { status: string }) {
  const positive = ['ENABLED', 'active', 'executed', 'resolved'].includes(status)
  const warning = ['PAUSED', 'paused', 'pending', 'executing', 'open'].includes(status)
  return <Badge variant={positive ? 'default' : warning ? 'secondary' : 'outline'}>{labels[status] ?? status}</Badge>
}
