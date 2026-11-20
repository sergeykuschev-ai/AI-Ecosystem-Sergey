# Статический раздел «Миска»: архитектура и публикация

## Как обслуживается раздел

`/miska/*`, `/robots.txt` и `/sitemap-miska-pilot.xml` обслуживает Caddy: если в
`/opt/stores-web/data/caddy/data/miska-section` (контейнерный `/data/miska-section`)
есть соответствующий статический файл, отдаётся он; иначе запрос уходит в Next.js
приложение (`web:3000`). Поэтому:

- карточки товаров, категории и главная каталога (`/miska/katalog/…`,
  `/miska/tovary/…`) — статический бандл, а не маршруты Next.js;
- SEO-категории (`/miska/korm-dlya-koshek-i-sobak/` и т.п.) существуют и как
  Next.js-страницы, и как статические копии в бандле — Caddy отдаёт статику;
- живой `robots.txt` — статический файл бандла, а не вывод `app/robots.ts`.

## Источник истины: манифест публикации

`lib/miska/published-catalog.ts` — единственный в репозитории источник истины о
том, какие страницы каталога опубликованы и индексируемы: категории, товары
(slug, проверенное имя, SKU, EAN, принадлежность к категориям, флаг `published`)
и кураторские `shortTitle` (≤ 70 символов).

Правила:

- в любую карту сайта попадают только `published: true`;
- `published: false` не должны отвечать 200 и не должны быть в sitemap;
- манифест сверен с живым сайтом (см. дату в шапке файла) и должен
  пересверяться при каждом изменении бандла.

## Инструменты

```bash
# Сгенерировать sitemap-miska-pilot.xml из манифеста (stdout или --out)
npm run miska:pilot-sitemap -- --out sitemap-miska-pilot.xml

# Собрать и проверить кандидатный бандл из живого (воспроизводимо)
npm run miska:build-candidate -- --bundle <dir> --out <dir>
```

`build-candidate-bundle` — воспроизводимая сборка кандидата: одни и те же
входы дают один и тот же каталог и тот же SHA-256 дерева. Скрипт:

- никогда не пишет в исходный бандл и отказывается перезаписывать
  существующий `--out` (защита обоих каталогов);
- применяет ровно два согласованных изменения: `shortTitle` (≤ 70 символов)
  в `<title>`/`og:title` двадцати опубликованных товарных страниц и узкое
  `Allow: /api/assets/` в `robots.txt` (с сохранением запрета остальных
  `/api/`);
- автоматически доказывает допустимость diff: любое изменение вне этого
  набора — ошибка сборки, равно как отсутствующее/битое изображение,
  неполный pilot-sitemap или потерянная директива robots;
- печатает JSON-вердикт и пишет `<out>.candidate-report.json` (рядом с
  бандлом, не внутри: дерево кандидата остаётся в точности публикуемым
  набором файлов) с SHA-256 дерева источника и кандидата.

## Публикация изменений бандла (вручную, отдельным решением владельца)

Бандл публикуется закреплённым помощником `/usr/local/sbin/miska-section-deploy`
на stores-web1 (SHA-256 пакета зафиксирован, откат восстанавливает Caddyfile).
Обновление бандла = новая итерация этого процесса, а не `deploy-web.sh`.

### Подготовка (не меняет production)

1. Скопировать живой бандл: `rsync -a stores-web1:/opt/stores-web/data/caddy/data/miska-section/ ./bundle-source/`
2. Собрать кандидат: `npm run miska:build-candidate -- --bundle ./bundle-source --out ./bundle-candidate`
   — скрипт сам проверит diff, изображения и robots; вердикт должен быть `OK`.
3. Сохранить кандидат вне рабочего дерева:
   `sudo install -d /var/lib/miska-section-deploy/candidates` и скопировать
   каталог туда вместе с `<out>.candidate-report.json`.
4. Упаковать: `tar -C <каталог-кандидата>/.. -czf pilot-candidate.tar.gz <имя-каталога>`
   и зафиксировать `sha256sum` архива.

### Публикация (только по решению владельца)

1. Резервная копия текущего бандла на stores-web1:
   `sudo cp -a /opt/stores-web/data/caddy/data/miska-section /opt/stores-web/data/caddy/data/miska-section.bak-$(date +%Y%m%d-%H%M%S)`
2. Сформировать release-пакет по образцу `/var/lib/miska-section-deploy/release/`
   из проверенного кандидата и обновить зафиксированный SHA-256 в
   `/usr/local/sbin/miska-section-deploy`.
3. `sudo /usr/local/sbin/miska-section-deploy check` — сверка пакета с пином.
4. `sudo /usr/local/sbin/miska-section-deploy publish` — замена бандла и reload.
5. Пост-проверка: `npm run audit:seo` (должен быть полностью зелёным, включая
   `Allow: /api/assets/`), плюс ручная выборка: `curl -sI` товарной страницы
   (новый `<title>`), `curl -s https://amurskmarket.ru/robots.txt`, доступность
   изображений `/api/assets/…` через прокси приложения.

### Откат

Помощник откатывает только Caddyfile (`miska-section-deploy rollback`), файлы
бандла он не восстанавливает. Полный откат бандла:

```bash
sudo rm -rf /opt/stores-web/data/caddy/data/miska-section
sudo mv /opt/stores-web/data/caddy/data/miska-section.bak-<дата> /opt/stores-web/data/caddy/data/miska-section
docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile
sudo /usr/local/sbin/miska-section-deploy rollback   # вернуть Caddyfile, если менялся
```

После отката повторить `npm run audit:seo` и сверить SHA-256 дерева бандла с
исходной версией из `candidate-report.json` (`sourceTreeSha256`).

## Проверка после публикации

```bash
npm run audit:seo        # read-only, вся совокупность карт из robots.txt
```

Аудит читает все директивы `Sitemap:` из robots.txt, проверяет совокупное
покрытие опубликованных страниц каталога, статусы, canonical, robots-мету и
JSON-LD карточек (Product + BreadcrumbList), а также отсутствие неопубликованных
товаров в картах.
