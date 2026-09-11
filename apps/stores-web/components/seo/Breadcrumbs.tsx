import { Fragment } from "react";
import { createBreadcrumbJsonLd, type BreadcrumbTrailItem } from "@/lib/seo/json-ld";
import { JsonLd } from "./JsonLd";

interface BreadcrumbsProps {
  trail: BreadcrumbTrailItem[];
}

export function Breadcrumbs({ trail }: BreadcrumbsProps) {
  return (
    <>
      <JsonLd data={createBreadcrumbJsonLd(trail)} />
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        {trail.map((item, index) => {
          const isCurrentPage = index === trail.length - 1;
          return (
            <Fragment key={item.path}>
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {isCurrentPage ? (
                <span aria-current="page">{item.name}</span>
              ) : (
                <a href={item.path}>{item.name}</a>
              )}
            </Fragment>
          );
        })}
      </nav>
    </>
  );
}
