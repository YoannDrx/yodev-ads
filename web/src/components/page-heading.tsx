export function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand-accent)]">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold tracking-[-.035em] text-[#252134] sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#777182] sm:text-base">{description}</p>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}
