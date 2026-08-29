interface MobileNavigationProps {
  links: ReadonlyArray<readonly [string, string]>;
}

export function MobileNavigation({ links }: MobileNavigationProps) {
  return (
    <details className="mobile-nav">
      <summary aria-label="Открыть меню">Меню</summary>
      <nav aria-label="Мобильная навигация">
        {links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
      </nav>
    </details>
  );
}
