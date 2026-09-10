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
            <a key={href} href={href}>{label}</a>
          ),
        )}
      </nav>
    </details>
  );
}
