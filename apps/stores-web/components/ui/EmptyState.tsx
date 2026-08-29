export function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><h2>{title}</h2><p>{text}</p></div>;
}
