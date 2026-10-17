import Link from "next/link"
import { ChevronLeft } from "lucide-react"

const STEPS = ["Trip", "Interests", "Videos", "Itinerary"]

export function PageShell({
  step,
  title,
  subtitle,
  back,
  children,
  footer,
}: {
  step: number // 1-based
  title: string
  subtitle?: string
  back?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col px-4 pt-4 pb-6">
      <header className="mb-6">
        <div className="mb-4 flex h-8 items-center gap-2">
          {back ? (
            <Link href={back} aria-label="Back" className="-ml-2 rounded-lg p-1.5 hover:bg-muted">
              <ChevronLeft className="size-5" />
            </Link>
          ) : null}
          <div className="flex flex-1 gap-1.5" aria-label={`Step ${step} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>
      <main className="flex-1">{children}</main>
      {footer ? (
        <div className="sticky bottom-0 -mx-4 mt-6 bg-background/95 px-4 pt-3 pb-2 backdrop-blur">
          {footer}
        </div>
      ) : null}
    </div>
  )
}
