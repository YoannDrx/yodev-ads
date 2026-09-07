import { BrandStyles } from '@/components/brand-styles'
import { NavigationLink, SkipToContent } from '@/components/navigation-link'
import { MobileMenu } from '@/components/mobile-menu'
import { workspacePermissions } from '@/lib/workspace-decision'
import Link from 'next/link'
import { headers } from 'next/headers'
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
import { getPublicPlatformSummary } from '@/lib/public-status'
import { workspaceAccessAllowsPath } from '@/lib/workspace-access'
import { AccountMenu } from '@/components/account-menu'
import { type Permission } from '@/lib/permissions'

const navigation = [
  { href: '/getting-started', key: 'gettingStarted', icon: Rocket, permission: 'portfolio:read' },
  { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard, permission: 'portfolio:read' },
  { href: '/portfolio', key: 'portfolio', icon: UsersRound, permission: 'portfolio:read' },
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
  { href: '/audit', key: 'audit', icon: ListChecks, permission: 'audit:read' },
  { href: '/billing', key: 'billing', icon: CreditCard, permission: 'billing:manage' },
  { href: '/settings', key: 'settings', icon: Settings, permission: 'workspace:admin' },
] as const satisfies ReadonlyArray<{ href: string; key: string; icon: typeof Rocket; permission: Permission }>

const navigationLabels = {
  fr: { portfolio: 'Portefeuille', gettingStarted: 'Démarrage', dashboard: 'Cockpit', accounts: 'Comptes clients', analysis: 'Analyse 360', insights: 'Insights étendus', history: 'Historique', alerts: 'Alertes', tasks: 'Tâches', agents: 'Vigies autonomes', approvals: 'Approbations', reports: 'Rapports clients', support: 'Support', audit: 'Journal d’audit', billing: 'Abonnement', settings: 'Réglages' },
  en: { portfolio: 'Portfolio', gettingStarted: 'Getting started', dashboard: 'Cockpit', accounts: 'Client accounts', analysis: '360 analysis', insights: 'Extended insights', history: 'History', alerts: 'Alerts', tasks: 'Tasks', agents: 'Autonomous monitors', approvals: 'Approvals', reports: 'Client reports', support: 'Support', audit: 'Audit log', billing: 'Subscription', settings: 'Settings' },
} as const

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Authenticated pages require a real request. This also prevents build-time
  // authentication/database access during Next.js prerender validation.
  await connection()
  const [{ workspace, role }, status, requestHeaders] = await Promise.all([
    requireWorkspace(),
    getPublicPlatformSummary().catch(() => null),
    headers(),
  ])
  const rolePermissions = workspacePermissions(role, workspace.accessState)
  const locale = workspace.locale === 'en' ? 'en' : 'fr'
  const labels = navigationLabels[locale]
  const hasDeclaredIncident = status && status.activeIncidentCount > 0
  const statusLabel = hasDeclaredIncident
    ? locale === 'en' ? `${status.activeIncidentCount} active incident${status.activeIncidentCount === 1 ? '' : 's'}`
      : `${status.activeIncidentCount} incident${status.activeIncidentCount > 1 ? 's' : ''} actif${status.activeIncidentCount > 1 ? 's' : ''}`
    : status ? locale === 'en' ? 'Service health unverified' : 'État du service non vérifié'
      : locale === 'en' ? 'Status unavailable' : 'Statut indisponible'
  const accessibleNavigation = navigation.filter(({ href, permission }) =>
    workspaceAccessAllowsPath(workspace.accessState, href) && rolePermissions.has(permission),
  )
  const homeHref = accessibleNavigation.some(({ href }) => href === '/dashboard') ? '/dashboard' : accessibleNavigation[0]?.href ?? '/support'
  const mobileNavigation = accessibleNavigation.slice(0, 4)
  return (
    <div
      className="workspace-brand min-h-screen bg-[#f3f6f8]"
    >
      <SkipToContent>{locale === 'en' ? 'Skip to content' : 'Aller au contenu'}</SkipToContent>
      <BrandStyles accentColor={workspace.accentColor} nonce={requestHeaders.get('x-nonce') ?? undefined} scope="workspace" />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/8 bg-[#0d1722] px-4 py-5 text-white lg:flex lg:flex-col">
        <Link href={homeHref} className="flex shrink-0 items-center gap-3 px-2 font-semibold tracking-tight">
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
        <nav aria-label={locale === 'en' ? 'Main navigation' : 'Navigation principale'} className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {accessibleNavigation.map(({ href, key, icon: Icon }) => (
            <NavigationLink
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/8 hover:text-white aria-[current=page]:bg-white/12 aria-[current=page]:text-white aria-[current=page]:ring-1 aria-[current=page]:ring-inset aria-[current=page]:ring-white/20 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Icon className="size-[18px]" />
              {labels[key]}
            </NavigationLink>
          ))}
          {workspace.accessState === 'internal' && rolePermissions.has('workspace:admin') && <NavigationLink href="/operations" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-amber-200/80 transition hover:bg-white/8 hover:text-amber-100 aria-[current=page]:bg-white/12 aria-[current=page]:text-amber-100"><RadioTower className="size-[18px]" />{locale === 'en' ? 'Operations' : 'Opérations'}</NavigationLink>}
        </nav>
        <div className="mt-4 shrink-0 rounded-2xl border border-white/8 bg-white/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#19A58F]">{locale === 'en' ? 'Your monitor' : 'Votre vigie'}</p>
          <p className="mt-2 text-sm font-medium text-white/80">{workspace.brandTagline}</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-black/6 bg-white/90 px-4 backdrop-blur sm:px-7">
          <Link href={homeHref} className="flex min-w-0 items-center gap-2 font-semibold lg:hidden">
            <Radar className="size-5 shrink-0 text-[var(--brand-accent)]" />
            <span className="truncate" title={workspace.brandName}>{workspace.brandName}</span>
          </Link>
          <div className="hidden min-w-0 truncate text-sm font-medium text-slate-600 lg:block" title={workspace.name}>{workspace.name}</div>
          <div className="flex shrink-0 items-center gap-4">
            <Link href="/status" className={`hidden items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium sm:flex ${hasDeclaredIncident ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
              <span className={`size-1.5 rounded-full ${hasDeclaredIncident ? 'bg-amber-500' : 'bg-slate-400'}`} /> {statusLabel}
            </Link>
            <AccountMenu locale={locale} />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto scroll-mt-20 max-w-[1500px] px-4 pb-24 pt-7 sm:px-7 sm:pt-9 lg:pb-10">{children}</main>
        <nav aria-label={locale === 'en' ? 'Quick navigation' : 'Navigation rapide'} className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-white px-2 py-2 lg:hidden">
          {mobileNavigation.map(({ href, key, icon: Icon }) => (
            <NavigationLink
              key={href}
              href={href}
              className="flex min-w-14 flex-col items-center gap-1 py-1 text-[10px] text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-slate-950 aria-[current=page]:underline aria-[current=page]:underline-offset-4"
            >
              <Icon className="size-5" />
              <span>{labels[key].split(' ')[0]}</span>
            </NavigationLink>
          ))}
          <MobileMenu label={locale === 'en' ? 'Full navigation' : 'Navigation complète'}>
              {accessibleNavigation.map(({ href, key, icon: Icon }) => <NavigationLink key={href} href={href} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-100 aria-[current=page]:bg-slate-100 aria-[current=page]:font-semibold aria-[current=page]:ring-1 aria-[current=page]:ring-slate-300"><Icon className="size-5" />{labels[key]}</NavigationLink>)}
              {workspace.accessState === 'internal' && rolePermissions.has('workspace:admin') && <NavigationLink href="/operations" className="flex min-h-11 items-center px-3 text-sm aria-[current=page]:bg-slate-100 aria-[current=page]:font-semibold">{locale === 'en' ? 'Operations' : 'Opérations'}</NavigationLink>}
          </MobileMenu>
        </nav>
      </div>
    </div>
  )
}
