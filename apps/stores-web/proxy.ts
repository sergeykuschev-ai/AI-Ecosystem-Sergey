import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPageWithoutSlash =
    pathname !== "/" &&
    !pathname.endsWith("/") &&
    !pathname.startsWith("/api/") &&
    !pathname.includes(".");

  if (!isPublicPageWithoutSlash) return NextResponse.next();

  const canonicalUrl = request.nextUrl.clone();
  canonicalUrl.pathname = `${pathname}/`;
  return NextResponse.redirect(canonicalUrl, 308);
}

export const config = {
  matcher: "/((?!_next/).*)",
};
