import Image from 'next/image'

/** Brand mark + wordmark used in every page header. */
export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/brand/logo-192.png"
        alt=""
        width={36}
        height={36}
        loading="eager"
        className="size-9 rounded-xl"
      />
      <div>
        <p className="font-mono text-[10px] font-bold tracking-[.22em] text-cyan-300">TRANSVOICE</p>
        <p className="text-[10px] text-slate-500">Meet without limits</p>
      </div>
    </div>
  )
}
