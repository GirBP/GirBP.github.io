# cv/site

Статичний двомовний сайт-резюме для GitHub Pages: `https://girbp.github.io/`
(українська версія) і `https://girbp.github.io/en/` (англійська версія).

## Структура

```
index.html, en/index.html      сторінки, які збирач породжує з JSON (комітяться)
assets/css/style.css           єдиний файл стилів, зокрема друк (@media print)
assets/cv-hirianskyi-uk.pdf    PDF-версії резюме
assets/cv-hirianskyi-en.pdf
data/cv.uk.json, data/cv.en.json   джерело змісту
tools/build.mjs                збирач: JSON -> HTML
tools/check.mjs                перевірка посилань, якорів, id, заголовків
tools/make-pdf.mjs             друкує обидві сторінки в PDF безголовим Chrome
404.html, robots.txt, sitemap.xml, .nojekyll
```

## Зміст

Увесь текст про людину лежить у `data/cv.uk.json` і `data/cv.en.json`. Сторінки
й PDF породжуються з цих файлів, тому зміст правиться лише там.

## Команди

Потрібен Node.js 18 або новіший. Зовнішніх залежностей немає.

```bash
node tools/build.mjs           # породжує index.html і en/index.html
node tools/build.mjs --check   # звіряє породжене з закоміченим, код 1 за розбіжність
node tools/check.mjs           # перевіряє посилання, якорі, id, заголовки
node tools/make-pdf.mjs        # друкує обидві сторінки в assets/*.pdf
```

`make-pdf.mjs` бере системний Chrome (`/Applications/Google Chrome.app` на
macOS, або шлях зі змінної `CHROME_PATH`) і піднімає локальний сервер лише на
час друку.

## Перевірка в CI

`.github/workflows/check.yml` під час кожного push запускає
`node tools/build.mjs --check` і `node tools/check.mjs`.
