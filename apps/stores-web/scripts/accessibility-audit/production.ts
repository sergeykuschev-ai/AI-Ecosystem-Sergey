/**
 * Accessibility audit for the stores-web production build (issue #94).
 *
 * Boots the production server (the `output: "standalone"` build) with the
 * explicit mock content source on an ephemeral loopback port and audits every
 * public page:
 *
 *   - axe-core — the accessibility engine behind Lighthouse's accessibility
 *     category — over the server-rendered production DOM (WCAG 2.1/2.2 AA +
 *     best-practice tags): names, roles, landmarks, headings, links, lists;
 *   - keyboard contract: skip link is the first Tab stop and targets a
 *     focusable #main-content, no positive tabindex anywhere;
 *   - landmark and heading outline;
 *   - carousel structure: focusable grouped viewport, labelled slides, named
 *     arrows and dots, a single aria-current dot;
 *   - touch target sizes for the site's interactive control classes (WCAG 2.2
 *     target-size minimum, 24x24 CSS px) from the served stylesheet;
 *   - carousel behavior (client-rendered in jsdom): ArrowRight moves to slide
 *     2, autoplay advances when idle, pauses on hover, and stops entirely
 *     under prefers-reduced-motion;
 *   - reduced-motion stylesheet support.
 *
 * Color contrast is verified by the component-level regression tests in
 * tests/accessibility.test.ts (exact WCAG luminance math). axe's
 * color-contrast rule requires layout information that this environment does
 * not provide, so the audit does not guess at it.
 *
 * The audit is read-only. It never writes to production, Directus, the
 * database, or any external service, and it requires no credentials.
 *
 * Run manually (after `npm run build`):
 *   npm run audit:accessibility
 *
 * Optional: AUDIT_BASE_URL=https://staging.example.com npm run audit:accessibility
 * (skips the local server boot and audits the given origin instead)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import axeCore from "axe-core";
import { JSDOM, type DOMWindow } from "jsdom";

interface AuditFinding {
  ok: boolean;
  severity: "error" | "warning";
  scope: string;
  message: string;
}

interface AxeViolationSummary {
  id: string;
  impact: string | null;
  nodes: Array<{ target: string[]; summary: string }>;
}

interface PageAuditResult {
  path: string;
  axeViolations: AxeViolationSummary[];
  findings: AuditFinding[];
}

const DEFAULT_BASE_URL = "http://127.0.0.1:4120";
const REQUEST_TIMEOUT_MS = 30_000;
const SERVER_BOOT_TIMEOUT_MS = 60_000;
const SERVER_POLL_INTERVAL_MS = 500;
const TARGET_SIZE_MIN_PX = 24;
const AUTOPLAY_INTERVAL_MS = 6_500;
const AUTOPLAY_PROBE_MS = AUTOPLAY_INTERVAL_MS + 1_500;

const PAGE_PATHS = [
  "/",
  "/amper/",
  "/ventil/",
  "/metiz-market/",
  "/miska/",
  "/kontakty/",
  "/bonus/",
  "/akcii/",
  "/vakansii/",
  "/faq/",
  "/o-kompanii/",
  "/stores/",
  "/stores/amursk/",
  "/stores/amursk/amper-amursk/",
];

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function resolveBaseUrl(): URL {
  const raw = process.env.AUDIT_BASE_URL ?? DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`AUDIT_BASE_URL is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`AUDIT_BASE_URL must use http or https: "${raw}"`);
  }
  return url;
}

async function fetchText(baseUrl: URL, path: string): Promise<string> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "text/html,text/css,*/*" },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} returned ${response.status}`);
  }
  return response.text();
}

async function waitForServer(baseUrl: URL): Promise<void> {
  const deadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/api/health", baseUrl), { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL_MS));
  }
  throw new Error(`server at ${baseUrl.origin} did not become healthy within ${SERVER_BOOT_TIMEOUT_MS}ms`);
}

async function startLocalServer(): Promise<{ baseUrl: URL; child: ChildProcess }> {
  const baseUrl = resolveBaseUrl();
  // The production build uses `output: "standalone"`, so boot the bundled
  // server directly (`next start` refuses standalone output). Mirror the
  // Dockerfile layout first: the standalone server serves static chunks and
  // public files only from its own directory.
  const standaloneRoot = fileURLToPath(new URL("../../.next/standalone", import.meta.url));
  cpSync(fileURLToPath(new URL("../../.next/static", import.meta.url)), join(standaloneRoot, ".next", "static"), { recursive: true });
  const publicSource = fileURLToPath(new URL("../../public", import.meta.url));
  if (existsSync(publicSource)) {
    cpSync(publicSource, join(standaloneRoot, "public"), { recursive: true });
  }

  const child = spawn("node", [join(standaloneRoot, "server.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: baseUrl.port,
      NEXT_PUBLIC_SITE_URL: baseUrl.origin,
      CONTENT_SOURCE: "mock",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[server] ${chunk}`));
  await waitForServer(baseUrl);
  return { baseUrl, child };
}

/** Load a production page into jsdom (DOM only; scripts are not executed). */
async function bootPage(baseUrl: URL, path: string): Promise<JSDOM> {
  const html = await fetchText(baseUrl, path);
  const dom = new JSDOM(html, {
    url: new URL(path, baseUrl).href,
    runScripts: "outside-only",
    resources: "usable",
    pretendToBeVisual: true,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`loading subresources timed out for ${path}`)), REQUEST_TIMEOUT_MS);
    if (dom.window.document.readyState === "complete") {
      clearTimeout(timer);
      resolve();
    } else {
      dom.window.addEventListener("load", () => {
        clearTimeout(timer);
        resolve();
      });
    }
  });
  return dom;
}

async function runAxe(dom: JSDOM): Promise<AxeViolationSummary[]> {
  dom.window.eval(axeCore.source);
  const axe = (dom.window as unknown as { axe: typeof axeCore }).axe;
  const results = await axe.run(dom.window.document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    resultTypes: ["violations"],
  });
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    nodes: violation.nodes.map((node) => ({ target: node.target.map(String), summary: node.failureSummary ?? "" })),
  }));
}

/** Sequential focus navigation order as defined by HTML (no positive tabindex). */
function focusOrder(document: Document): string[] {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex], [contenteditable]"),
  ).filter((element) => {
    if (element.hasAttribute("disabled")) return false;
    const tabindex = element.getAttribute("tabindex");
    if (tabindex !== null && Number.parseInt(tabindex, 10) < 0) return false;
    return true;
  });
  const explicit: HTMLElement[] = [];
  const implicit: HTMLElement[] = [];
  for (const element of candidates) {
    const tabindex = element.getAttribute("tabindex");
    if (tabindex !== null && Number.parseInt(tabindex, 10) > 0) explicit.push(element);
    else implicit.push(element);
  }
  explicit.sort((a, b) => Number(a.getAttribute("tabindex")) - Number(b.getAttribute("tabindex")));
  return [...explicit, ...implicit].map(
    (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${(element.className.split(" ")[0] ?? "").toString()}`,
  );
}

function auditKeyboardSkipLinkAndLandmarks(dom: JSDOM, path: string, cssSource: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const { document } = dom.window;
  const add = (ok: boolean, message: string) => findings.push({ ok, severity: "error", scope: `${path} keyboard/landmarks`, message });

  const order = focusOrder(document);
  add(order.length > 0, "page must have at least one keyboard-focusable element");
  add(order[0] === "a.skip-link", `first Tab stop must be the skip link, got ${order[0] ?? "none"}`);

  const skipLink = document.querySelector("a.skip-link");
  add(skipLink?.getAttribute("href") === "#main-content", "skip link must point to #main-content");
  const target = document.getElementById("main-content");
  add(target?.getAttribute("tabindex") === "-1", "#main-content must be programmatically focusable (tabindex=-1)");
  add(Boolean(skipLink) && cssSource.includes(".skip-link:focus"), "stylesheet must reveal the skip link when focused");

  const positiveTabindex = Array.from(document.querySelectorAll("[tabindex]"))
    .map((element) => ({ element, value: Number.parseInt(element.getAttribute("tabindex") ?? "0", 10) }))
    .filter(({ value }) => value > 0)
    .map(({ element, value }) => `${element.tagName.toLowerCase()}[tabindex=${value}]`);
  add(positiveTabindex.length === 0, `positive tabindex values are forbidden, found: ${positiveTabindex.join(", ") || "none"}`);

  // Per HTML-AAM, <header> is a banner landmark only when it is not scoped to
  // sectioning content; hero headers inside <main> are not banners.
  const banners = Array.from(document.querySelectorAll("header")).filter(
    (header) => !header.closest("main, article, aside, nav, section"),
  );
  add(banners.length === 1, `expected exactly one banner landmark, got ${banners.length}`);
  add(document.querySelectorAll("footer").length === 1, `expected exactly one footer landmark, got ${document.querySelectorAll("footer").length}`);
  add(document.querySelectorAll("h1").length === 1, `expected exactly one h1, got ${document.querySelectorAll("h1").length}`);
  add(Boolean(document.documentElement.lang), `html element must declare lang, got "${document.documentElement.lang}"`);

  const navsMissingLabel = Array.from(document.querySelectorAll("nav")).filter(
    (nav) => !nav.getAttribute("aria-label") && !nav.getAttribute("aria-labelledby"),
  ).length;
  add(navsMissingLabel === 0, `${navsMissingLabel} nav landmark(s) lack an accessible label`);

  return findings;
}

/** Control classes whose CSS box the site is responsible for sizing. */
const TOUCH_TARGET_SELECTORS: Array<{ selector: string; label: string }> = [
  { selector: ".actual-slider__arrows button", label: "carousel arrows" },
  { selector: ".actual-slider__dots button", label: "carousel dots" },
  { selector: ".mobile-nav summary", label: "mobile menu summary" },
  { selector: ".site-footer nav a", label: "footer links" },
  { selector: ".store-navigation__link", label: "store navigation links" },
  { selector: ".desktop-nav a", label: "desktop navigation links" },
];

/** The site leaves the root font size at the browser default (16px). */
const ROOT_FONT_SIZE_PX = 16;

interface CssBoxSizes {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  fontSize?: number;
  lineHeight?: number;
}

function extractBoxSizes(cssSource: string, selector: string): CssBoxSizes | null {
  // Use the last matching rule block (most specific in this flat stylesheet).
  const escaped = selector.replace(/[/.[\]()]/g, "\\$&");
  const blocks = [...cssSource.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  const block = blocks.at(-1);
  if (!block) return null;
  const body = block[1];
  const px = (property: string) => {
    // (?<!-) keeps "width" from matching inside "min-width".
    const match = body.match(new RegExp(`(?<!-)${property}:\\s*([0-9.]+)(px|rem)`));
    if (!match) return undefined;
    const value = Number.parseFloat(match[1]);
    return match[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
  };
  return {
    width: px("width"),
    height: px("height"),
    minWidth: px("min-width"),
    minHeight: px("min-height"),
    paddingTop: px("padding-top"),
    paddingBottom: px("padding-bottom"),
    fontSize: px("font-size"),
    lineHeight: px("line-height"),
  };
}

function auditTouchTargets(path: string, cssSource: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const { selector, label } of TOUCH_TARGET_SELECTORS) {
    const sizes = extractBoxSizes(cssSource, selector);
    if (!sizes) {
      findings.push({ ok: false, severity: "error", scope: `${path} touch-targets`, message: `no stylesheet rule found for ${selector} (${label})` });
      continue;
    }
    // Only a declared box smaller than the minimum is a confirmed violation.
    // A dimension without a declared constraint (width auto, min-width: 0) is
    // content- or layout-sized; the stylesheet alone cannot prove it is too
    // small, so it is reported as auto-sized instead of failing.
    const horizontalDeclared = [sizes.minWidth, sizes.width].filter(
      (value): value is number => value != null && value > 0,
    );
    const verticalDeclared = [sizes.minHeight, sizes.height].filter(
      (value): value is number => value != null && value > 0,
    );
    const verticalPadded =
      sizes.paddingTop != null && sizes.paddingBottom != null
        ? sizes.paddingTop + sizes.paddingBottom + (sizes.lineHeight ?? sizes.fontSize ?? 0)
        : 0;
    const horizontalFailing = horizontalDeclared.some((value) => value < TARGET_SIZE_MIN_PX);
    const verticalFailing =
      (verticalDeclared.length > 0 && Math.max(...verticalDeclared) < TARGET_SIZE_MIN_PX && verticalPadded < TARGET_SIZE_MIN_PX) ||
      (verticalDeclared.length === 0 && verticalPadded > 0 && verticalPadded < TARGET_SIZE_MIN_PX);
    const autoSized =
      horizontalDeclared.length === 0 || (verticalDeclared.length === 0 && verticalPadded === 0);
    findings.push({
      ok: !horizontalFailing && !verticalFailing,
      severity: "error",
      scope: `${path} touch-targets`,
      message:
        horizontalFailing || verticalFailing
          ? `${selector} (${label}) declares a box below the ${TARGET_SIZE_MIN_PX}px minimum (declared: ${JSON.stringify(sizes)})`
          : autoSized
            ? `${selector} (${label}) has no declared sub-${TARGET_SIZE_MIN_PX}px constraint (auto-sized dimension(s), declared: ${JSON.stringify(sizes)})`
            : `${selector} (${label}) meets the ${TARGET_SIZE_MIN_PX}px minimum`,
    });
  }
  return findings;
}

function auditCarouselStructure(dom: JSDOM, path: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const { document } = dom.window;
  if (!document.querySelector(".actual-slider__viewport")) return findings;

  const add = (ok: boolean, message: string) => findings.push({ ok, severity: "error", scope: `${path} carousel`, message });

  const viewport = document.querySelector(".actual-slider__viewport");
  add(viewport?.getAttribute("role") === "group" && viewport.getAttribute("tabindex") === "0", "keyboard viewport must be a focusable group");
  add(Boolean(viewport?.getAttribute("aria-label")), "keyboard viewport must have an accessible name");

  const slides = document.querySelectorAll("[data-slide-index]");
  const labelledSlides = Array.from(slides).filter(
    (slide) => slide.getAttribute("role") === "group" && slide.getAttribute("aria-roledescription") === "slide" && slide.hasAttribute("aria-label"),
  ).length;
  add(slides.length > 0 && labelledSlides === slides.length, `${labelledSlides}/${slides.length} slides expose group/slide roles with labels`);

  const slideImages = Array.from(document.querySelectorAll(".actual-slide img"));
  add(
    slideImages.length > 0 && slideImages.every((image) => Boolean(image.getAttribute("alt"))),
    "every slide image must have non-empty alternative text",
  );

  const arrows = Array.from(document.querySelectorAll(".actual-slider__arrows button"));
  add(arrows.length === 2 && arrows.every((arrow) => Boolean(arrow.getAttribute("aria-label"))), "arrow controls must be two named buttons");
  const dots = Array.from(document.querySelectorAll(".actual-slider__dots button"));
  add(dots.length === slides.length && dots.every((dot) => Boolean(dot.getAttribute("aria-label"))), "every dot button must have an accessible name");
  add(document.querySelectorAll('.actual-slider__dots [aria-current="true"]').length === 1, "exactly one dot must expose aria-current");

  return findings;
}

/** DOM APIs jsdom does not implement but the client components require. */
function installDomPolyfills(window: DOMWindow, reducedMotion: boolean): void {
  window.matchMedia = ((query: string) => {
    const matches = query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  }) as typeof window.matchMedia;

  const noopScroll = () => undefined;
  window.scrollTo = noopScroll as typeof window.scrollTo;
  window.HTMLElement.prototype.scrollTo = noopScroll as typeof window.HTMLElement.prototype.scrollTo;
  window.HTMLElement.prototype.scroll = noopScroll as typeof window.HTMLElement.prototype.scroll;
  window.HTMLElement.prototype.scrollIntoView = noopScroll;
}

/** Expose one jsdom window as the global DOM for a component render. */
function activateWindowGlobals(window: DOMWindow): void {
  const globals = globalThis as Record<string, unknown>;
  // Node 21+ exposes `navigator` (and potentially other DOM globals) as
  // getter-only properties on globalThis, so plain assignment throws.
  const expose = (name: string, value: unknown) => {
    Object.defineProperty(globals, name, { value, configurable: true, writable: true });
  };
  expose("window", window);
  expose("self", window);
  expose("document", window.document);
  expose("navigator", window.navigator);
  expose("HTMLElement", window.HTMLElement);
  expose("HTMLAnchorElement", window.HTMLAnchorElement);
  expose("HTMLButtonElement", window.HTMLButtonElement);
  expose("MouseEvent", window.MouseEvent);
  expose("KeyboardEvent", window.KeyboardEvent);
  expose("CustomEvent", window.CustomEvent);
  expose("getComputedStyle", window.getComputedStyle?.bind(window));
  expose("requestAnimationFrame", window.requestAnimationFrame?.bind(window));
  expose("cancelAnimationFrame", window.cancelAnimationFrame?.bind(window));
  expose("IS_REACT_ACT_ENVIRONMENT", true);
}

/** Client-render the real carousel in jsdom and probe its runtime behavior. */
async function auditCarouselBehavior(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const scope = "carousel behavior (client render)";
  const add = (ok: boolean, message: string) => findings.push({ ok, severity: "error", scope, message });

  const { ActualSlider } = await import("@/components/actual/ActualSlider");
  const { mockActualItems, mockBrands } = await import("@/lib/data/mock-data");
  const { createRoot } = await import("react-dom/client");

  const brands = mockBrands.map(({ id, slug, name, primary_color, secondary_color }) => ({ id, slug, name, primary_color, secondary_color }));

  async function renderSlider(reducedMotion: boolean): Promise<{ dom: JSDOM; container: HTMLElement; activeLabel: () => string | null }> {
    const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
      url: "http://localhost/",
      pretendToBeVisual: true,
    });
    installDomPolyfills(dom.window, reducedMotion);
    activateWindowGlobals(dom.window);
    const container = dom.window.document.getElementById("root") as HTMLElement;
    const root = createRoot(container);
    await new Promise<void>((resolve) => {
      root.render(h(ActualSlider, { items: mockActualItems, brands }));
      // Effects (autoplay interval, external store) attach after a tick.
      setTimeout(resolve, 50);
    });
    return {
      dom,
      container,
      activeLabel: () => dom.window.document.querySelector(".actual-slider__dots .is-active")?.getAttribute("aria-label") ?? null,
    };
  }

  // Keyboard: ArrowRight on the viewport moves to slide 2.
  {
    const { dom, container, activeLabel } = await renderSlider(false);
    try {
      add(activeLabel() === "Перейти к слайду 1", `initial active dot must be slide 1, got ${activeLabel() ?? "none"}`);
      const viewport = container.querySelector(".actual-slider__viewport");
      viewport?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      add(activeLabel() === "Перейти к слайду 2", `ArrowRight must move to slide 2, got ${activeLabel() ?? "none"}`);
    } finally {
      dom.window.close();
    }
  }

  // Autoplay: advances when idle, pauses on hover.
  {
    const { dom, container, activeLabel } = await renderSlider(false);
    try {
      const before = activeLabel();
      await new Promise((resolve) => setTimeout(resolve, AUTOPLAY_PROBE_MS));
      const after = activeLabel();
      add(before !== null && after !== null && before !== after, `autoplay must advance when idle (before: ${before}, after: ${after})`);

      const section = container.querySelector(".actual-section");
      // React synthesizes onMouseEnter/onMouseLeave from native
      // mouseover/mouseout (mouseenter itself does not bubble).
      section?.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
      const hoverBefore = activeLabel();
      await new Promise((resolve) => setTimeout(resolve, AUTOPLAY_PROBE_MS));
      const hoverAfter = activeLabel();
      section?.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true, relatedTarget: null }));
      add(hoverBefore === hoverAfter, `autoplay must pause on hover (before: ${hoverBefore}, after: ${hoverAfter})`);
    } finally {
      dom.window.close();
    }
  }

  // Reduced motion: autoplay must not run at all.
  {
    const { dom, activeLabel } = await renderSlider(true);
    try {
      const before = activeLabel();
      await new Promise((resolve) => setTimeout(resolve, AUTOPLAY_PROBE_MS));
      const after = activeLabel();
      add(before !== null && before === after, `autoplay must not advance under prefers-reduced-motion (before: ${before}, after: ${after})`);
    } finally {
      dom.window.close();
    }
  }

  return findings;
}

function auditReducedMotionStylesheet(cssSource: string): AuditFinding {
  return {
    ok: /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/.test(cssSource),
    severity: "error",
    scope: "reduced-motion stylesheet",
    message: "stylesheet must provide a prefers-reduced-motion: reduce block",
  };
}

/** Fetch the stylesheet URL referenced by the served HTML (hashed per build). */
async function fetchCssSource(baseUrl: URL): Promise<string> {
  const html = await fetchText(baseUrl, "/");
  const href =
    html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1] ??
    html.match(/<link[^>]*href="([^"]+\.css)"[^>]*rel="stylesheet"/)?.[1];
  if (!href) return "";
  return fetchText(baseUrl, new URL(href, baseUrl).pathname);
}

async function auditPage(baseUrl: URL, path: string, cssSource: string): Promise<PageAuditResult> {
  const dom = await bootPage(baseUrl, path);
  try {
    const axeViolations = await runAxe(dom);
    const findings = [
      ...auditKeyboardSkipLinkAndLandmarks(dom, path, cssSource),
      ...auditTouchTargets(path, cssSource),
      ...auditCarouselStructure(dom, path),
    ];
    return { path, axeViolations, findings };
  } finally {
    dom.window.close();
  }
}

async function main(): Promise<void> {
  const started = process.env.AUDIT_BASE_URL == null;
  let server: { baseUrl: URL; child: ChildProcess } | null = null;
  const baseUrl = resolveBaseUrl();

  try {
    if (started) {
      console.log(`Starting production server at ${baseUrl.origin} (CONTENT_SOURCE=mock)`);
      server = await startLocalServer();
    }
    console.log(`Accessibility audit against ${baseUrl.origin} (read-only)`);

    const cssSource = await fetchCssSource(baseUrl).catch(() => "");
    if (!cssSource) {
      console.warn("WARN could not fetch the served stylesheet; touch-target and skip-link CSS checks will fail");
    }

    const results: PageAuditResult[] = [];
    for (const path of PAGE_PATHS) {
      process.stdout.write(`auditing ${path} ... `);
      const result = await auditPage(baseUrl, path, cssSource);
      const errorCount = result.axeViolations.length + result.findings.filter((finding) => !finding.ok).length;
      console.log(errorCount === 0 ? "PASS" : `${errorCount} finding(s)`);
      results.push(result);
    }
    results.push({ path: "carousel", axeViolations: [], findings: await auditCarouselBehavior() });

    let errors = 0;
    for (const result of results) {
      for (const violation of result.axeViolations) {
        errors += 1;
        for (const node of violation.nodes.slice(0, 3)) {
          console.error(`FAIL ${result.path} axe[${violation.impact ?? "unknown"}] ${violation.id} ${node.target.join(" ")}: ${node.summary.split("\n")[0]}`);
        }
        if (violation.nodes.length > 3) {
          console.error(`FAIL ${result.path} axe ${violation.id}: ... and ${violation.nodes.length - 3} more`);
        }
      }
      for (const finding of result.findings) {
        if (finding.ok) continue;
        errors += 1;
        console.error(`FAIL ${finding.scope}: ${finding.message}`);
      }
    }
    const reducedMotionStyles = auditReducedMotionStylesheet(cssSource);
    if (!reducedMotionStyles.ok) {
      errors += 1;
      console.error(`FAIL ${reducedMotionStyles.scope}: ${reducedMotionStyles.message}`);
    }

    console.log(`\n${PAGE_PATHS.length} pages audited, ${errors} accessibility finding(s)`);
    console.log("Note: color contrast is verified by the luminance regression tests in tests/accessibility.test.ts.");
    if (errors > 0) {
      console.error("Audit result: FAIL");
      process.exitCode = 1;
    } else {
      console.log("Audit result: PASS");
    }
  } finally {
    if (server) {
      server.child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (server.child.exitCode == null) server.child.kill("SIGKILL");
    }
  }
}

main().catch((error: unknown) => {
  console.error(`Accessibility audit aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
