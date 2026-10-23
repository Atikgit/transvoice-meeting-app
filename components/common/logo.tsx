import Image from 'next/image'
import { BrandWordmark } from '@/components/brand/brand-wordmark'
import { BRAND } from '@/lib/brand'

/** Brand mark + wordmark + tagline used in every page header. */
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
        <p className="leading-tight">
          <BrandWordmark />
        </p>
        <p className="text-[10px] text-slate-500">{BRAND.tagline}</p>
      </div>
    </div>
  )
}
