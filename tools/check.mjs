#!/usr/bin/env node
// Перевірка згенерованого сайту: внутрішні посилання, якорі, наявність файлів,
// унікальність id, порядок заголовків. Node 18+, без зовнішніх залежностей.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PAGES = ["index.html", "en/index.html", "404.html"];

let errors = 0;

function fail(file, message) {
  console.error(`FAIL  ${file}: ${message}`);
  errors++;
}

function ok(message) {
  console.log(`ok    ${message}`);
}

function extractAttr(html, tag, attr) {
  // Повертає масив {value, index} для всіх входжень attr="..." у тегах <tag ...>.
  const results = [];
  const tagRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  let m;
  while ((m = tagRe.exec(html))) {
    const attrRe = new RegExp(`${attr}=["']([^"']*)["']`, "i");
    const am = attrRe.exec(m[0]);
    if (am) {
      results.push({ value: am[1], index: m.index });
    }
  }
  return results;
}

function checkIds(file, html) {
  const idMatches = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  const seen = new Set();
  for (const id of idMatches) {
    if (seen.has(id)) {
      fail(file, `дубльований id="${id}"`);
    }
    seen.add(id);
  }
  return seen;
}

function checkHeadingOrder(file, html) {
  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  if (headings.length === 0) {
    fail(file, "немає жодного заголовка");
    return;
  }
  if (headings[0] !== 1) {
    fail(file, `перший заголовок має бути h1, знайдено h${headings[0]}`);
  }
  const h1Count = headings.filter((h) => h === 1).length;
  if (h1Count !== 1) {
    fail(file, `має бути рівно один h1, знайдено ${h1Count}`);
  }
  let prev = headings[0];
  for (const level of headings.slice(1)) {
    if (level > prev + 1) {
      fail(file, `пропущено рівень заголовка: h${prev} -> h${level}`);
    }
    prev = level;
  }
}

function checkLinks(file, html, ids) {
  const hrefs = extractAttr(html, "a", "href");
  const dir = path.dirname(path.join(ROOT, file));
  for (const { value } of hrefs) {
    if (value.startsWith("#")) {
      const anchor = value.slice(1);
      if (anchor === "") continue; // "#" саме по собі
      if (!ids.has(anchor)) {
        fail(file, `якір href="${value}" не має відповідного id`);
      }
      continue;
    }
    if (/^(https?:)?\/\//.test(value) || value.startsWith("mailto:")) {
      continue; // зовнішнє посилання — не перевіряємо мережею
    }
    // внутрішнє посилання (відносне або кореневе "/...") -> файл на диску
    const cleanPath = value.split("#")[0].split("?")[0];
    if (cleanPath === "") continue;
    let target = cleanPath.startsWith("/")
      ? path.resolve(ROOT, cleanPath.slice(1))
      : path.resolve(dir, cleanPath);
    if (cleanPath.endsWith("/")) {
      target = path.join(target, "index.html");
    }
    if (!existsSync(target)) {
      fail(file, `внутрішнє посилання href="${value}" веде на неіснуючий файл (${path.relative(ROOT, target)})`);
    }
  }
}

function checkAssetRefs(file, html) {
  const dir = path.dirname(path.join(ROOT, file));
  // canonical/alternate/sitemap посилання законно абсолютні (https://girbp.github.io/...);
  // перевіряємо на локальну наявність і заборону зовнішніх ресурсів лише stylesheet/icon.
  const linkTags = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  for (const tag of linkTags) {
    const relMatch = /rel=["']([^"']*)["']/i.exec(tag);
    const hrefMatch = /href=["']([^"']*)["']/i.exec(tag);
    if (!relMatch || !hrefMatch) continue;
    const rel = relMatch[1];
    const href = hrefMatch[1];
    if (rel === "canonical" || rel === "alternate") continue; // абсолютні за задумом
    if (/^(https?:)?\/\//.test(href)) {
      fail(file, `зовнішній ресурс заборонено: <link rel="${rel}" href="${href}">`);
      continue;
    }
    const target = path.resolve(dir, href);
    if (!existsSync(target)) {
      fail(file, `не знайдено файл ресурсу: ${href}`);
    }
  }
  const scriptSrcs = extractAttr(html, "script", "src").map((x) => x.value);
  for (const src of scriptSrcs) {
    fail(file, `сторінка не повинна підвантажувати зовнішній скрипт: ${src}`);
  }
}

for (const file of PAGES) {
  const fullPath = path.join(ROOT, file);
  if (!existsSync(fullPath)) {
    fail(file, "файл відсутній");
    continue;
  }
  const html = readFileSync(fullPath, "utf8");
  const ids = checkIds(file, html);
  checkHeadingOrder(file, html);
  checkLinks(file, html, ids);
  checkAssetRefs(file, html);
}

// Перевірка PDF-файлів, на які посилаються дані.
for (const dataFile of ["data/cv.uk.json", "data/cv.en.json"]) {
  const data = JSON.parse(readFileSync(path.join(ROOT, dataFile), "utf8"));
  const base =
    dataFile.includes("uk") ? ROOT : path.join(ROOT, "en");
  const target = path.resolve(base, data.pdf);
  if (!existsSync(target)) {
    fail(dataFile, `PDF не знайдено: ${data.pdf} (${path.relative(ROOT, target)})`);
  }
}

if (!existsSync(path.join(ROOT, "assets/css/style.css"))) {
  fail("assets/css/style.css", "файл стилів відсутній");
}

if (errors > 0) {
  console.error(`\nЗнайдено помилок: ${errors}`);
  process.exit(1);
}
ok("усі перевірки пройдено");
