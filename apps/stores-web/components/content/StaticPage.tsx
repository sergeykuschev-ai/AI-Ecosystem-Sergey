import type { PropsWithChildren } from "react";
import { Container } from "@/components/ui/Container";

interface StaticPageProps extends PropsWithChildren {
  className?: string;
  eyebrow?: string;
  title: string;
  intro: string;
  breadcrumbs?: React.ReactNode;
}

export function StaticPage({ className, eyebrow, title, intro, breadcrumbs, children }: StaticPageProps) {
  return (
    <main className={className}>
      <Container>
        {breadcrumbs}
        <header className="page-hero">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          <p className="lead">{intro}</p>
        </header>
        {children}
      </Container>
    </main>
  );
}
