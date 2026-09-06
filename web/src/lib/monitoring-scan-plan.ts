export const MONITORING_AGENTS_PER_CHUNK = 5

type ScanAgent = { id: string; kind: string; clientId: string | null; enabled: boolean }
type ScanClient = { id: string; active: boolean; isManager: boolean }

export function monitoringDataset(kind: string) {
  switch (kind) {
    case 'pacing_variance':
    case 'forecast_overrun': return 'pacing'
    case 'wasted_search_terms': return 'search_terms'
    case 'low_quality_keywords': return 'keywords'
    case 'weak_responsive_ads': return 'ads'
    case 'tracking_gap': return 'tracking'
    default: return 'campaigns'
  }
}

/** Stable batches share one dataset and never cross a client boundary. */
export function monitoringScanPlan(agents: ScanAgent[], clients: ScanClient[]) {
  const chunks: Array<{ clientId: string; dataset: string; agentIds: string[] }> = []
  for (const client of clients.filter((item) => item.active && !item.isManager).sort((a, b) => a.id.localeCompare(b.id))) {
    const families = new Map<string, string[]>()
    for (const agent of agents.filter((item) => item.enabled && (!item.clientId || item.clientId === client.id)).sort((a, b) => a.id.localeCompare(b.id))) {
      const dataset = monitoringDataset(agent.kind)
      families.set(dataset, [...(families.get(dataset) ?? []), agent.id])
    }
    for (const [dataset, agentIds] of families) {
      for (let offset = 0; offset < agentIds.length; offset += MONITORING_AGENTS_PER_CHUNK) {
        chunks.push({ clientId: client.id, dataset, agentIds: agentIds.slice(offset, offset + MONITORING_AGENTS_PER_CHUNK) })
      }
    }
  }
  return chunks
}
