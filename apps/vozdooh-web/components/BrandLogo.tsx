import Image from 'next/image'
import Link from 'next/link'

export function BrandLogo() {
  return (
    <Link className="brandLogo" href="/" aria-label="VOZDOOH — на главную">
      <Image src="/brand/vozdooh-horizontal.webp" alt="VOZDOOH" width={900} height={118} priority />
    </Link>
  )
}
