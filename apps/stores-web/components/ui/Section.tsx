import type { PropsWithChildren } from "react";

interface SectionProps extends PropsWithChildren {
  className?: string;
  labelledBy?: string;
}

export function Section({ children, className = "", labelledBy }: SectionProps) {
  return <section aria-labelledby={labelledBy} className={`section ${className}`.trim()}>{children}</section>;
}
