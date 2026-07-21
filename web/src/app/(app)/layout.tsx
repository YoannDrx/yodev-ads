import Link from 'next/link'
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs'
import {
  BellRing,
  Bot,
  ChartNoAxesCombined,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  Radar,
  Settings,
  Share2,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import { requireWorkspace } from '@/lib/workspace'

const navigation = [
  { href: '/dashboard', label: 'Cockpit', icon: LayoutDashboard },
  { href: '/accounts', label: 'Comptes clients', icon: UsersRound },
  { href: '/analysis', label: 'Analyse 360', icon: ChartNoAxesCombined },
  { href: '/history', label: 'Historique', icon: TrendingUp },
  { href: '/alerts', label: 'Alertes', icon: BellRing },
  { href: '/agents', label: 'Vigies autonomes', icon: Bot },
  { href: '/approvals', label: 'Approbations', icon: ClipboardCheck },
  { href: '/reports', label: 'Rapports clients', icon: Share2 },
  { href: '/audit', label: 'Journal d’audit', icon: ListChecks },
  { href: '/billing', label: 'Abonnement', icon: CreditCard },
  { href: '/settings', label: 'Réglages', icon: Settings },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { workspace } = await requireWorkspace()
  return (
    <div
      className="min-h-screen bg-[#f3f6f8]"
      style={{ '--brand-accent': workspace.accentColor } as React.CSSProperties}
    >
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/8 bg-[#0d1722] px-4 py-5 text-white lg:flex lg:flex-col">
        <Link href="/dashboard" className="flex items-center gap-3 px-2 font-semibold tracking-tight">
          {workspace.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={workspace.logoUrl} alt="" className="size-9 rounded-xl object-cover" />
          ) : (
            <span className="grid size-9 place-items-center rounded-xl bg-[#6af0b1] text-[#0d1722] shadow-lg shadow-emerald-500/10">
              <Radar className="size-5" />
            </span>
          )}
          <span className="truncate text-lg">{workspace.brandName}</span>
        </Link>
        <nav className="mt-9 space-y-1">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/58 transition hover:bg-white/8 hover:text-white"
            >
              <Icon className="size-[18px]" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-white/8 bg-white/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6af0b1]">Votre vigie</p>
          <p className="mt-2 text-sm font-medium text-white/80">{workspace.brandTagline}</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-black/6 bg-white/90 px-4 backdrop-blur sm:px-7">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold lg:hidden">
            <Radar className="size-5 text-[var(--brand-accent)]" />
            {workspace.brandName}
          </Link>
          <div className="hidden lg:block">
            <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/dashboard" />
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:flex">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Système opérationnel
            </span>
            <UserButton />
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-7 sm:px-7 sm:pt-9 lg:pb-10">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-white px-2 py-2 lg:hidden">
          {navigation.slice(0, 5).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex min-w-14 flex-col items-center gap-1 py-1 text-[10px] text-muted-foreground"
            >
              <Icon className="size-5" />
              <span>{label.split(' ')[0]}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
}
