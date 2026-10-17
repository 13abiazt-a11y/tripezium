import Image from "next/image"

/** Small logo + name, shown at the top of every page. */
export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <Image src="/tripezium-mark.png" alt="" width={32} height={32} className="size-7" />
      <span className="text-lg font-bold tracking-tight text-foreground">Tripezium</span>
    </div>
  )
}
