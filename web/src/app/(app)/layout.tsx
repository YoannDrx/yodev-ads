import { Fragment } from "react";
import { YodevBrand, ProductLinks } from "@/brand/brand";
import { AppearanceToggle } from "@/components/appearance";
import { LocaleSwitcher } from "@/components/locale-switcher";
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
  const groupFor = (key: string) => ['gettingStarted','dashboard','portfolio','accounts'].includes(key) ? (locale === 'fr' ? 'Portefeuille' : 'Portfolio') : ['analysis','insights','history'].includes(key) ? (locale === 'fr' ? 'Analyse' : 'Analysis') : ['alerts','tasks','agents','approvals','reports'].includes(key) ? (locale === 'fr' ? 'Suivi et actions' : 'Monitoring and actions') : (locale === 'fr' ? 'Administration' : 'Administration')
  const ownBrand = ['Ads by Yodev', 'Yodev Ads', 'Yodev', 'Yodev Ads Studio'].includes(workspace.brandName) && !workspace.logoUrl
  const homeHref = accessibleNavigation.some(({ href }) => href === '/dashboard') ? '/dashboard' : accessibleNavigation[0]?.href ?? '/support'
  const mobileNavigation = accessibleNavigation.slice(0, 4)
  return (
    <div
      className="workspace-brand min-h-screen bg-card"
    >
      <SkipToContent>{locale === 'en' ? 'Skip to content' : 'Aller au contenu'}</SkipToContent>
      {!ownBrand && <BrandStyles accentColor={workspace.accentColor} nonce={requestHeaders.get('x-nonce') ?? undefined} scope="workspace" />}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-card px-4 py-5 text-foreground lg:flex lg:flex-col">
        <Link href={homeHref} className="flex shrink-0 items-center gap-3 px-2 font-semibold tracking-tight">
          {ownBrand ? <YodevBrand product="ads" className="text-xl"/> : <>{isControlledBrandLogoUrl(workspace.logoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={workspace.logoUrl!} alt="" className="size-9 rounded-md object-cover"/>
          ) : <Radar className="size-6 text-[var(--brand-accent)]"/>}<span className="truncate text-lg">{workspace.brandName}</span></>}
        </Link>
        <nav aria-label={locale === 'en' ? 'Main navigation' : 'Navigation principale'} className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {accessibleNavigation.map(({ href, key, icon: Icon }, index) => (
            <Fragment key={href}>{(index === 0 || groupFor(accessibleNavigation[index-1].key) !== groupFor(key)) && <p className="y-nav-group">{groupFor(key)}</p>}
            <NavigationLink
              key={href}
              href={href}
              className="y-app-link"
            >
              <Icon className="size-[18px]" />
              {labels[key]}
            </NavigationLink></Fragment>
          ))}
          {workspace.accessState === 'internal' && rolePermissions.has('workspace:admin') && <NavigationLink href="/operations" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-[var(--y-warning)] transition hover:bg-card hover:text-[var(--y-warning)] aria-[current=page]:bg-card aria-[current=page]:text-[var(--y-warning)]"><RadioTower className="size-[18px]" />{locale === 'en' ? 'Operations' : 'Opérations'}</NavigationLink>}
        </nav>
        <div className="mt-4 shrink-0 border-t p-4"><ProductLinks locale={locale} current="ads"/>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{locale === 'en' ? 'Your monitor' : 'Votre vigie'}</p>
          <p className="mt-2 text-sm font-medium text-muted-foreground">{workspace.brandTagline}</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-card px-4  sm:px-7">
          <Link href={homeHref} className="flex min-w-0 items-center gap-2 font-semibold lg:hidden">
            <span className="truncate">{ownBrand ? <YodevBrand product="ads"/> : workspace.brandName}</span>
          </Link>
          <div className="hidden min-w-0 truncate text-sm font-medium text-muted-foreground lg:block" title={workspace.name}>{workspace.name}</div>
          <div className="flex shrink-0 items-center gap-2"><LocaleSwitcher locale={locale}/><AppearanceToggle locale={locale}/>
            <Link href="/status" className={`hidden items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium sm:flex ${hasDeclaredIncident ? 'y-status-warning text-[var(--y-warning)]' : 'bg-muted text-muted-foreground'}`}>
              <span className={`size-1.5 rounded-md ${hasDeclaredIncident ? 'bg-amber-500' : 'bg-slate-400'}`} /> {statusLabel}
            </Link>
            <AccountMenu locale={locale} />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto scroll-mt-20 max-w-[1500px] px-4 pb-24 pt-7 sm:px-7 sm:pt-9 lg:pb-10">{children}</main>
        <nav aria-label={locale === 'en' ? 'Quick navigation' : 'Navigation rapide'} className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-card px-2 py-2 lg:hidden">
          {mobileNavigation.map(({ href, key, icon: Icon }) => (
            <NavigationLink
              key={href}
              href={href}
              className="flex min-w-14 flex-col items-center gap-1 py-1 text-[10px] text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:underline-offset-4"
            >
              <Icon className="size-5" />
              <span>{labels[key].split(' ')[0]}</span>
            </NavigationLink>
          ))}
          <MobileMenu label={locale === 'en' ? 'Full navigation' : 'Navigation complète'}>
              {accessibleNavigation.map(({ href, key, icon: Icon }) => <NavigationLink key={href} href={href} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-semibold aria-[current=page]:ring-1 aria-[current=page]:ring-slate-300"><Icon className="size-5" />{labels[key]}</NavigationLink>)}
              {workspace.accessState === 'internal' && rolePermissions.has('workspace:admin') && <NavigationLink href="/operations" className="flex min-h-11 items-center px-3 text-sm aria-[current=page]:bg-muted aria-[current=page]:font-semibold">{locale === 'en' ? 'Operations' : 'Opérations'}</NavigationLink>}
          </MobileMenu>
        </nav>
      </div>
    </div>
  )
}
