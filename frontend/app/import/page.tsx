"use client"

import Link from "next/link"
import { Link2 } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageShell } from "@/components/page-shell"

// Placeholder — B owns this screen (link box, loading state, review list).
export default function ImportPage() {
  return (
    <PageShell
      step={3}
      back="/interests"
      title="Add video ideas"
      subtitle="Paste a YouTube or TikTok link and we'll pull out the places."
      footer={
        <Link href="/itinerary" className={buttonVariants({ size: "lg", className: "h-12 w-full text-base" })}>
          Build my itinerary
        </Link>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="https://youtube.com/..." className="h-11 pl-9" inputMode="url" />
        </div>
        <p className="text-xs text-muted-foreground">Import coming soon — skip for now.</p>
      </div>
    </PageShell>
  )
}
