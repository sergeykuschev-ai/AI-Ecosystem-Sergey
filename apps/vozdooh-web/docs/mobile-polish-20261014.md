# VOZDOOH mobile homepage: final layout polish (2026-10-14)

- Mobile footer: two readable vertical link groups with category headings, a compact logo and left-aligned seller/contact details. No legal information removed.
- Homepage contextual link section: collapsible native details/summary. All six curated links and up to three stocked product links remain present as ordinary server-rendered anchors and the non-home page version remains unchanged.
- Category and room horizontal lists now have explicit swipe guidance. Category heading and arrow share a flex row; the arrow no longer overlays the description.
- Homepage brand cards show short purchase-oriented text rather than long location-specific SEO landing descriptions. Brand landing pages are unchanged.
- Production payment, fulfillment, order worker, stock, SEO canonical and metadata remain untouched.

Checks: `npm run test`, `npm run typecheck`, `npm run lint`, production Next build and independent Docker smoke (site routes + HTML assertions). Launch only the `web` service through `/opt/vozdooh/runtime/compose.yml`; rollback image `vozdooh-web:mobile-home-20261014`.
