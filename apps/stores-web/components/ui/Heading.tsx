import type { PropsWithChildren } from "react";

interface HeadingProps extends PropsWithChildren {
  level?: 1 | 2 | 3;
  id?: string;
}

export function Heading({ level = 2, id, children }: HeadingProps) {
  const Tag = `h${level}` as const;
  return <Tag id={id}>{children}</Tag>;
}
