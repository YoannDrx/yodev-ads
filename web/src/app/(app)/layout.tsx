import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import {
  BellRing,
  Bot,
  ChartNoAxesCombined,
  ClipboardCheck,
  CreditCard,
  Crosshair,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  LifeBuoy,
  RadioTower,
  Radar,
  Rocket,
  Settings,
  Share2,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import { requireWorkspace } from '@/lib/workspace'
import { isControlledBrandLogoUrl } from '@/lib/branding-assets'
import { getPublicPlatformStatus } from '@/lib/public-status'
import { workspaceAccessAllowsPath } from '@/lib/workspace-access'
import { AccountMenu } from '@/components/account-menu'
import { permissionsForRole, type Permission } from '@/lib/permissions'

const navigation = [
  { href: '/getting-started', key: 'gettingStarted', icon: Rocket, permission: 'portfolio:read' },
  { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard, permission: 'portfolio:read' },
  { href: '/accounts', key: 'accounts', icon: UsersRound, permission: 'portfolio:read' },
  { href: '/analysis', key: 'analysis', icon: ChartNoAxesCombined, permission: 'portfolio:read' },
  { href: '/insights', key: 'insights', icon: Crosshair, permission: 'portfolio:read' },
  { href: '/history', key: 'history', icon: TrendingUp, permission: 'portfolio:read' },
  { href: '/alerts', key: 'alerts', icon: BellRing, permission: 'portfolio:read' },
  { href: '/tasks', key: 'tasks', icon: ListTodo, permission: 'portfolio:read' },
  { href: '/agents', key: 'agents', icon: Bot, permission: 'portfolio:read' },
  { href: '/approvals', key: 'approvals', icon: ClipboardCheck, permission: 'portfolio:read' },
  { href: '/reports', key: 'reports', icon: Share2, permission: 'portfolio:read' },
  { href: '/support', key: 'support', icon: LifeBuoy, permission: 'support:read' },
  { href: '/audit', key: 'audit', icon: ListChecks, permission: 'workspace:admin' },
  { href: '/billing', key: 'billing', icon: CreditCard, permission: 'billing:manage' },
  { href: '/settings', key: 'settings', icon: Settings, permission: 'workspace:admin' },
] as const satisfies ReadonlyArray<{ href: string; key: string; icon: typeof Rocket; permission: Permission }>

const navigationLabels = {
  fr: { gettingStarted: 'Démarrage', dashboard: 'Cockpit', accounts: 'Comptes clients', analysis: 'Analyse 360', insights: 'Insights étendus', history: 'Historique', alerts: 'Alertes', tasks: 'Tâches', agents: 'Vigies autonomes', approvals: 'Approbations', reports: 'Rapports clients', support: 'Support', audit: 'Journal d’audit', billing: 'Abonnement', settings: 'Réglages' },
  en: { gettingStarted: 'Getting started', dashboard: 'Cockpit', accounts: 'Client accounts', analysis: '360 analysis', insights: 'Extended insights', history: 'History', alerts: 'Alerts', tasks: 'Tasks', agents: 'Autonomous monitors', approvals: 'Approvals', reports: 'Client reports', support: 'Support', audit: 'Audit log', billing: 'Subscription', settings: 'Settings' },
} as const

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Authenticated pages require a real request. This also prevents build-time
  // authentication/database access during Next.js prerender validation.
  await connection()
  const [{ workspace, role }, status, requestHeaders] = await Promise.all([
    requireWorkspace(),
    getPublicPlatformStatus().catch(() => null),
    headers(),
  ])
  const pathname = requestHeaders.get('x-yodev-pathname') ?? '/dashboard'
  const rolePermissions = permissionsForRole(role)
  if (!workspaceAccessAllowsPath(workspace.accessState, pathname)) {
    redirect(`/billing?notice=${encodeURIComponent(workspace.locale === 'en' ? 'Your current access is limited to billing and stored data.' : 'Votre accès actuel est limité à la facturation et aux données stockées.')}`)
  }
  const requestedNavigation = navigation.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
  if (requestedNavigation && !rolePermissions.has(requestedNavigation.permission)) {
    redirect('/support?error=Accès%20non%20autorisé')
  }
  const locale = workspace.locale === 'en' ? 'en' : 'fr'
  const labels = navigationLabels[locale]
  const statusLabel = status?.summary.overall === 'operational'
    ? locale === 'en' ? 'All systems operational' : 'Système opérationnel'
    : status
      ? locale === 'en'
        ? `${status.summary.activeIncidentCount} active incident${status.summary.activeIncidentCount === 1 ? '' : 's'}`
        : `${status.summary.activeIncidentCount} incident${status.summary.activeIncidentCount > 1 ? 's' : ''} actif${status.summary.activeIncidentCount > 1 ? 's' : ''}`
      : locale === 'en' ? 'Status unavailable' : 'Statut indisponible'
  const accessibleNavigation = navigation.filter(({ href, permission }) =>
    workspaceAccessAllowsPath(workspace.accessState, href) && rolePermissions.has(permission),
  )
  const homeHref = rolePermissions.has('portfolio:read') ? '/dashboard' : '/support'
  const mobileNavigation = accessibleNavigation.filter(({ href }) => ['/dashboard', '/analysis', '/alerts', '/approvals', '/billing', '/settings'].includes(href))
  return (
    <div
      className="min-h-screen bg-[#f3f6f8]"
      style={{ '--brand-accent': workspace.accentColor } as React.CSSProperties}
    >
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/8 bg-[#0d1722] px-4 py-5 text-white lg:flex lg:flex-col">
        <Link href={homeHref} className="flex items-center gap-3 px-2 font-semibold tracking-tight">
          {isControlledBrandLogoUrl(workspace.logoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={workspace.logoUrl!} alt="" className="size-9 rounded-xl object-cover" />
          ) : (
            <span className="grid size-9 place-items-center rounded-xl bg-[#19A58F] text-[#0d1722] shadow-lg shadow-emerald-500/10">
              <Radar className="size-5" />
            </span>
          )}
          <span className="truncate text-lg">{workspace.brandName}</span>
        </Link>
        <nav className="mt-9 space-y-1">
          {accessibleNavigation.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/58 transition hover:bg-white/8 hover:text-white"
            >
              <Icon className="size-[18px]" />
              {labels[key]}
            </Link>
          ))}
          {workspace.accessState === 'internal' && <Link href="/operations" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-amber-200/80 transition hover:bg-white/8 hover:text-amber-100"><RadioTower className="size-[18px]" />{locale === 'en' ? 'Operations' : 'Opérations'}</Link>}
        </nav>
        <div className="mt-auto rounded-2xl border border-white/8 bg-white/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#19A58F]">{locale === 'en' ? 'Your monitor' : 'Votre vigie'}</p>
          <p className="mt-2 text-sm font-medium text-white/80">{workspace.brandTagline}</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-black/6 bg-white/90 px-4 backdrop-blur sm:px-7">
          <Link href={homeHref} className="flex items-center gap-2 font-semibold lg:hidden">
            <Radar className="size-5 text-[var(--brand-accent)]" />
            {workspace.brandName}
          </Link>
          <div className="hidden text-sm font-medium text-slate-600 lg:block">{workspace.name}</div>
          <div className="flex items-center gap-4">
            <Link href="/status" className={`hidden items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium sm:flex ${status?.summary.overall === 'operational' ? 'bg-emerald-50 text-emerald-700' : status ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
              <span className={`size-1.5 rounded-full ${status?.summary.overall === 'operational' ? 'bg-emerald-500' : status ? 'bg-amber-500' : 'bg-slate-400'}`} /> {statusLabel}
            </Link>
            <AccountMenu locale={locale} />
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-7 sm:px-7 sm:pt-9 lg:pb-10">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-white px-2 py-2 lg:hidden">
          {mobileNavigation.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex min-w-14 flex-col items-center gap-1 py-1 text-[10px] text-muted-foreground"
            >
              <Icon className="size-5" />
              <span>{labels[key].split(' ')[0]}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
}
