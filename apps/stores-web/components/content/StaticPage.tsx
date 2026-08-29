import type { PropsWithChildren } from "react";
import { Container } from "@/components/ui/Container";

interface StaticPageProps extends PropsWithChildren {
  eyebrow?: string;
  title: string;
  intro: string;
}

export function StaticPage({ eyebrow, title, intro, children }: StaticPageProps) {
  return (
    <main>
      <Container>
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
