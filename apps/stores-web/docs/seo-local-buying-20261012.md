# Local buying content — 2026-10-12

Added visible purchase questions on the Miska and Metiz Market landing pages, linking to existing category pages. Answers use existing store facts and explicitly distinguish category coverage from real-time stock and prices. Miska metadata now puts the store type and city first. No new stock, price, delivery or medical claims, and no rich-result promises.

Baseline live audit: 817/817 hard checks passed. Yandex Webmaster status retrieval failed with a connection error; indexation remains unverified.

Verified release: TypeScript passed; 203 application tests and 91 SEO regression tests passed. Docker production build passed. Only the web service was recreated. Both live landing pages returned HTTP 200 and included the new buying sections; Miska title was verified in HTML. Post-deployment audit passed 817/817 hard checks. Rollback source and prior image are retained on the deployment host.
