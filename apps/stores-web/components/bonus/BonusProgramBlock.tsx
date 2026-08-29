import type { BonusProgram } from "@/types/bonus-program";

export function BonusProgramBlock({ program }: { program: BonusProgram }) {
  return (
    <article className="feature-panel">
      <h2>{program.title}</h2>
      <p className="lead">{program.short_description}</p>
      <p>{program.description}</p>
      {program.rules.length > 0 && <ul>{program.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>}
    </article>
  );
}
