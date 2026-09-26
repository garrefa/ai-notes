import type { ReactNode } from "react"

// A titled block of a detail pane (PR, agent).
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

// One label/value row; place inside a two-column <FieldList>.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

export function FieldList({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">{children}</dl>
}

// The heading for one group of cards in a list view: a label and how many it holds.
export function ListGroupHeading({ label, count, unit }: { label: ReactNode; count: number; unit: [string, string] }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-1 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      <span>{label}</span>
      <span className="normal-case text-muted-foreground/70">
        {count} {count === 1 ? unit[0] : unit[1]}
      </span>
    </div>
  )
}
