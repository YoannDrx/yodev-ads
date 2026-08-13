// Backward-compatible alias. Scheduling and execution are handled exclusively
// by the durable queue endpoint; no tenant is scanned inline from this route.
export { GET, maxDuration } from '../scheduler/route'
