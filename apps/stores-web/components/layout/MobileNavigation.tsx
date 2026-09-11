import Link from "next/link";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import type { PrimaryNavLink } from "./Header";

interface MobileNavigationProps {
  links: ReadonlyArray<PrimaryNavLink>;
}

export function MobileNavigation({ links }: MobileNavigationProps) {
  return (
    <details className="mobile-nav">
      <summary>Меню</summary>
      <nav aria-label="Мобильная навигация">
        {links.map(({ label, href, event }) =>
          event ? (
            <TrackedLink key={href} event={event} payload={{ source: "mobile_nav" }} href={href}>
              {label}
            </TrackedLink>
          ) : (
            <Link key={href} href={href}>{label}</Link>
          ),
        )}
      </nav>
    </details>
  );
}
