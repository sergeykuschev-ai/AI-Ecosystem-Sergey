"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { trackEvent, type AnalyticsEventName, type AnalyticsPayload } from "@/lib/analytics";

interface TrackedLinkProps {
  event: AnalyticsEventName;
  payload?: AnalyticsPayload;
  href: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  target?: string;
  rel?: string;
  ariaLabel?: string;
  title?: string;
  dataAttributes?: Record<string, string>;
}

const EXTERNAL_HREF_PATTERN = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;

export function TrackedLink({
  event,
  payload,
  href,
  children,
  className,
  style,
  target,
  rel,
  ariaLabel,
  title,
  dataAttributes,
}: TrackedLinkProps) {
  const handleClick = () => {
    trackEvent(event, payload);
  };

  if (EXTERNAL_HREF_PATTERN.test(href)) {
    return (
      <a
        href={href}
        className={className}
        style={style}
        target={target}
        rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)}
        aria-label={ariaLabel}
        title={title}
        {...dataAttributes}
        onClick={handleClick}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      href={href}
      className={className}
      style={style}
      target={target}
      rel={rel}
      aria-label={ariaLabel}
      title={title}
      {...dataAttributes}
      onClick={handleClick}
    >
      {children}
    </Link>
  );
}
