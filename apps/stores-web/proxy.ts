import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPageWithoutSlash =
    pathname !== "/" &&
    !pathname.endsWith("/") &&
    !pathname.startsWith("/api/") &&
    !pathname.includes(".");

  if (!isPublicPageWithoutSlash) return NextResponse.next();

  // request.nextUrl is a NextURL whose pathname setter silently drops the
  // trailing slash in Next 16, which turned this redirect into an infinite
  // 308 loop; build the target with the standard URL constructor instead.
  const canonicalUrl = new URL(`${pathname}/`, request.url);
  return NextResponse.redirect(canonicalUrl, 308);
}

export const config = {
  matcher: "/((?!_next/).*)",
};
