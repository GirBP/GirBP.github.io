#!/usr/bin/env node
// Збирач сайту-резюме: JSON -> HTML. Node 18+, без зовнішніх залежностей.
// Вихід детермінований: жодних дат, часу чи випадкових значень.
//
// Використання:
//   node tools/build.mjs           збирає index.html і en/index.html
//   node tools/build.mjs --check   звіряє згенероване з уже закоміченим,
//                                  завершується з кодом 1 за розбіжності

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SITE = "https://girbp.github.io";

const LOCALES = [
  { lang: "uk", file: "data/cv.uk.json", out: "index.html", url: `${SITE}/`, ogLocale: "uk_UA" },
  { lang: "en", file: "data/cv.en.json", out: "en/index.html", url: `${SITE}/en/`, ogLocale: "en_US" },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Текст для читання: після екранування ставить нерозривні пробіли там, де перенос
// на вузькому екрані псує рядок. Число не відривається від слова чи знака «%»,
// однолітерне слово та ініціал не лишаються в кінці рядка, тире не починає рядок.
function prose(value) {
  return escapeHtml(value)
    .replace(/(\d) (?=[\p{L}%])/gu, "$1&nbsp;")
    .replace(/(^|[\s(«„])(\p{L}) (?=\S)/gu, "$1$2&nbsp;")
    .replace(/(\p{Lu}\.) (?=\p{Lu})/gu, "$1&nbsp;")
    .replace(/ ([–—]) /g, "&nbsp;$1 ")
    .replace(/≈ (?=\d)/g, "≈&nbsp;");
}

// Екранування для вмісту JSON-LD <script type="application/ld+json">:
// заборонено закривати тег через "</", інакше HTML-парсер розірве script.
function jsonLdSafe(obj) {
  return JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");
}

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(ROOT, relPath), "utf8"));
}

function findLink(data, label) {
  return (data.links || []).find((l) => l.label === label);
}

function renderLinkItem(l) {
  return `        <li><a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a></li>`;
}

// Два рядки контактів: телефони окремо, профілі разом із перемикачем мови.
// На вузькому екрані рядки переносяться передбачувано, а не там, де скінчилося місце.
function renderLinkRows(data, locale, { withActions }) {
  const links = data.links || [];
  const phones = links.filter((l) => l.url.startsWith("tel:"));
  const profiles = links.filter((l) => !l.url.startsWith("tel:"));
  const langSwitch = `        <li><a class="lang-switch" href="${escapeHtml(
    data.other_lang.url
  )}" hreflang="${locale.lang === "uk" ? "en" : "uk"}">${escapeHtml(data.other_lang.label)}</a></li>`;
  const actions = withActions
    ? [
        { url: `mailto:${data.email}`, label: data.labels.write },
        { url: data.pdf, label: data.labels.download_pdf },
      ].map(renderLinkItem)
    : [];
  const rows = [actions, phones.map(renderLinkItem), [...profiles.map(renderLinkItem), langSwitch]];
  return rows
    .filter((items) => items.length > 0)
    .map((items) => `      <ul>\n${items.join("\n")}\n      </ul>`)
    .join("\n");
}

// Контакти для друку двома рядками: пошта з телефонами, під ними профілі.
function renderPrintContact(data) {
  const links = data.links || [];
  const direct = [`<a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a>`];
  const profiles = [];
  for (const l of links) {
    if (l.url.startsWith("tel:")) {
      // Для телефону в друці показуємо номер, а не адресу tel:
      direct.push(`<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`);
    } else {
      const bare = l.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      profiles.push(`<a href="${escapeHtml(l.url)}">${escapeHtml(bare)}</a>`);
    }
  }
  return [direct, profiles]
    .filter((row) => row.length > 0)
    .map((row) => `<span>${row.join(" · ")}</span>`)
    .join("\n      ");
}

// Назва розділу і його зміст лежать поруч, щоб стилі могли винести назву ліворуч.
function renderSection(id, label, body) {
  return `      <section id="${id}" aria-labelledby="${id}-h">
        <h2 id="${id}-h">${escapeHtml(label)}</h2>
        <div class="section-body">
${body}
        </div>
      </section>`;
}

function renderSummary(data) {
  return renderSection("summary", data.labels.summary, `          <p>${prose(data.summary)}</p>`);
}

function renderSkills(data) {
  const items = data.skills
    .map(
      (s) => `            <div class="entry">
              <h3>${prose(s.label)}</h3>
              <p>${prose(s.text)}</p>
            </div>`
    )
    .join("\n");
  return renderSection(
    "skills",
    data.labels.skills,
    `          <div class="entry-list">
${items}
          </div>`
  );
}

function renderDissertation(data) {
  const d = data.dissertation;
  const methods = d.methods
    .map(
      (m) => `            <div class="entry">
              <h3>${prose(m.name)}</h3>
              <p>${prose(m.text)}</p>
            </div>`
    )
    .join("\n");
  const codeLink = data.dissertation_code
    ? `\n          <p class="dissertation-code"><a href="${escapeHtml(
        data.dissertation_code.url
      )}">${escapeHtml(data.dissertation_code.label)}</a></p>`
    : "";
  return renderSection(
    "dissertation",
    data.labels.dissertation,
    `          <p>${prose(d.lead)}</p>
          <div class="entry-list">
${methods}
          </div>${codeLink}`
  );
}

function renderPublications(data) {
  const p = data.publications;
  const items = p.items
    .map((it) => {
      const desc = it.desc
        ? `\n              <p>${prose(it.desc)}</p>`
        : "";
      // DOI-посилання: якщо бібліографічний запис закінчується власне DOI URL,
      // робимо цей фрагмент клікабельним замість дублювання рядка з посиланням.
      const citeHtml = it.cite.endsWith(it.doi_url)
        ? `${prose(it.cite.slice(0, it.cite.length - it.doi_url.length))}<a href="${escapeHtml(
            it.doi_url
          )}">${escapeHtml(it.doi_url)}</a>`
        : `${prose(it.cite)}</p>\n              <p class="cite"><a href="${escapeHtml(
            it.doi_url
          )}">${escapeHtml(it.doi_url)}</a>`;
      return `          <li class="entry">
            <h3>${prose(it.title)}</h3>${desc}
              <p class="cite">${citeHtml}</p>
          </li>`;
    })
    .join("\n");
  return renderSection(
    "publications",
    data.labels.publications,
    `          <p>${prose(p.lead)}</p>
          <ol class="entry-list">
${items}
          </ol>`
  );
}

function renderProjects(data) {
  const p = data.projects;
  const items = p.items
    .map((it) => {
      const links = [
        `<a href="${escapeHtml(it.url)}">${escapeHtml(data.labels.code)}</a>`,
      ];
      if (it.demo_url) {
        links.push(
          `<a href="${escapeHtml(it.demo_url)}">${escapeHtml(data.labels.demo)}</a>`
        );
      }
      return `          <div class="entry">
            <h3>${prose(it.name)}</h3>
            <p>${prose(it.text)}</p>
            <p class="stack">${prose(it.stack)}</p>
            <div class="entry-links">
${links.map((l) => `              ${l}`).join("\n")}
            </div>
          </div>`;
    })
    .join("\n");
  return renderSection(
    "projects",
    data.labels.projects,
    `          <p>${prose(p.lead)}</p>
          <div class="entry-list">
${items}
          </div>`
  );
}

function renderExperience(data) {
  const items = data.experience
    .map((e) => {
      const text = e.text ? `\n            <p>${prose(e.text)}</p>` : "";
      return `          <div class="entry">
            <h3>${prose(e.title)}</h3>
            <p class="meta">${prose(e.org)} · ${prose(e.date)}</p>${text}
          </div>`;
    })
    .join("\n");
  return renderSection(
    "experience",
    data.labels.experience,
    `          <div class="entry-list">
${items}
          </div>`
  );
}

function renderEducation(data) {
  const ed = data.education;
  const items = ed.items
    .map(
      (it) => `          <div class="entry">
            <h3>${escapeHtml(it.title)}</h3>
            <p class="meta">${prose(it.date)}</p>
            <p>${prose(it.meta)}</p>
          </div>`
    )
    .join("\n");
  return renderSection(
    "education",
    data.labels.education,
    `          <p class="meta">${prose(ed.affil)}</p>
          <div class="entry-list">
${items}
          </div>`
  );
}

function renderLanguages(data) {
  const items = data.languages
    .map(
      (l) =>
        `          <li>${prose(`${l.name} — ${l.level}`)}</li>`
    )
    .join("\n");
  return renderSection(
    "languages",
    data.labels.languages,
    `          <ul class="plain-list">
${items}
          </ul>`
  );
}

function renderHead(data, locale) {
  const title = `${data.name} — ${data.headline}`;
  const description = data.summary;
  const github = findLink(data, "GitHub");
  const orcid = findLink(data, "ORCID");
  const sameAs = [github, orcid].filter(Boolean).map((l) => l.url);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: data.name,
    url: locale.url,
    sameAs,
    alumniOf: {
      "@type": "CollegeOrUniversity",
      name: data.education.affil,
    },
    knowsLanguage: data.languages.map((l) => l.name),
  };

  return `  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(locale.url)}">
  <link rel="alternate" hreflang="uk" href="${SITE}/">
  <link rel="alternate" hreflang="en" href="${SITE}/en/">
  <link rel="alternate" hreflang="x-default" href="${SITE}/">
  <meta property="og:type" content="profile">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(locale.url)}">
  <meta property="og:locale" content="${locale.ogLocale}">
  <meta name="theme-color" content="#1F4E79" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#14191F" media="(prefers-color-scheme: dark)">
  <link rel="icon" type="image/svg+xml" href="${locale.lang === "uk" ? "" : "../"}assets/favicon.svg">
  <link rel="stylesheet" href="${locale.lang === "uk" ? "" : "../"}assets/css/style.css">
  <script type="application/ld+json">
${jsonLdSafe(jsonLd)}
  </script>`;
}

function renderPage(data, locale) {
  const pdfHref = data.pdf;
  const head = renderHead(data, locale);
  const headerLinks = renderLinkRows(data, locale, { withActions: false });
  const footerLinks = renderLinkRows(data, locale, { withActions: true });
  const printContact = renderPrintContact(data);

  const sections = [
    renderSummary(data),
    renderSkills(data),
    renderDissertation(data),
    renderPublications(data),
    renderProjects(data),
    renderExperience(data),
    renderEducation(data),
    renderLanguages(data),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="${locale.lang}">
<head>
${head}
</head>
<body>
  <a class="skip-link" href="#main">${escapeHtml(data.labels.skip)}</a>
  <header class="wrap">
    <div class="identity">
      <h1>${escapeHtml(data.name)}</h1>
      <p class="headline">${prose(data.headline)}</p>
      <p class="location">${escapeHtml(data.location)}</p>
    </div>
    <div class="actions">
      <a class="btn btn-primary" href="mailto:${escapeHtml(data.email)}">${escapeHtml(
        data.labels.write
      )}</a>
      <a class="btn btn-secondary" href="${escapeHtml(pdfHref)}">${escapeHtml(
        data.labels.download_pdf
      )}</a>
    </div>
    <nav class="link-rows" aria-label="${escapeHtml(data.labels.contacts)}">
${headerLinks}
    </nav>
    <p class="print-contact">
      ${printContact}
    </p>
  </header>
  <main id="main">
${sections}
  </main>
  <footer class="wrap">
    <div class="link-rows">
${footerLinks}
    </div>
  </footer>
</body>
</html>
`;
}

function build({ check }) {
  let mismatches = 0;
  for (const locale of LOCALES) {
    const data = readJson(locale.file);
    const html = renderPage(data, locale);
    const outPath = path.join(ROOT, locale.out);

    if (check) {
      if (!existsSync(outPath)) {
        console.error(`[build --check] відсутній файл: ${locale.out}`);
        mismatches++;
        continue;
      }
      const existing = readFileSync(outPath, "utf8");
      if (existing !== html) {
        console.error(
          `[build --check] ${locale.out} відрізняється від згенерованого. Запусти: node tools/build.mjs`
        );
        mismatches++;
      }
    } else {
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, html, "utf8");
      console.log(`written: ${locale.out}`);
    }
  }

  if (check) {
    if (mismatches > 0) {
      console.error(`[build --check] знайдено розбіжностей: ${mismatches}`);
      process.exit(1);
    }
    console.log("[build --check] OK: згенероване збігається із закоміченим.");
  }
}

const args = process.argv.slice(2);
build({ check: args.includes("--check") });
