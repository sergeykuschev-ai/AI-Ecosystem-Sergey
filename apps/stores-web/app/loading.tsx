import { Container } from "@/components/ui/Container";

export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Загрузка страницы">
      <Container>
        <div className="page-hero">
          <p className="eyebrow loading-skeleton loading-skeleton--line" aria-hidden="true">&nbsp;</p>
          <div className="loading-skeleton loading-skeleton--title" aria-hidden="true" />
          <div className="loading-skeleton loading-skeleton--lead" aria-hidden="true" />
        </div>
      </Container>
    </main>
  );
}
