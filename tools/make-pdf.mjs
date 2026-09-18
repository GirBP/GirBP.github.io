#!/usr/bin/env node
// Піднімає локальний статичний сервер (без залежностей) і друкує обидві
// сторінки сайту безголовим системним Chrome (--print-to-pdf) у assets/.
// Node 18+, без зовнішніх залежностей. Chrome береться системний.

import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Системний Chrome не знайдено. Встанови /Applications/Google Chrome.app або задай CHROME_PATH."
  );
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let reqPath = decodeURIComponent(url.pathname);
      if (reqPath.endsWith("/")) reqPath += "index.html";
      const filePath = path.join(ROOT, reqPath);
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const ext = path.extname(filePath);
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Безголовий Chrome сам не завершується після друку (лишається висіти в
// фоні через власні службові процеси), тому чекаємо на повідомлення
// "bytes written to file" або на появу стабільного файлу, а тоді самі
// вбиваємо групу процесів, яку сам і запустили (свій --user-data-dir, свій PID).
function printPage(chrome, userDataDir, url, outPath, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      chrome,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-component-update",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-client-side-phishing-detection",
        "--no-pdf-header-footer",
        `--print-to-pdf=${outPath}`,
        "--virtual-time-budget=10000",
        url,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    let settled = false;
    let output = "";

    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      clearInterval(poll);
      // від'ємний pid убиває всю групу процесів, яку створив цей самий spawn.
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // процес уже міг завершитись сам
      }
      if (err) reject(err);
      else resolve();
    }

    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => {
      output += d;
      if (output.includes("bytes written to file")) {
        setTimeout(() => finish(), 150); // невелика пауза, щоб дописати файл
      }
    });

    child.on("error", (err) => finish(err));
    child.on("exit", () => {
      if (existsSync(outPath)) finish();
      else finish(new Error(`Chrome завершився без запису ${outPath}:\n${output}`));
    });

    // резервний спосіб виявити завершення: файл з'явився і його розмір стабільний.
    let lastSize = -1;
    let stableTicks = 0;
    const poll = setInterval(() => {
      if (!existsSync(outPath)) return;
      const size = statSync(outPath).size;
      if (size > 0 && size === lastSize) {
        stableTicks++;
        if (stableTicks >= 2) finish();
      } else {
        stableTicks = 0;
      }
      lastSize = size;
    }, 400);

    const hardTimeout = setTimeout(() => {
      finish(new Error(`Тайм-аут друку ${url} (${timeoutMs} мс)`));
    }, timeoutMs);
  });
}

async function main() {
  const chrome = findChrome();
  const server = await startServer();
  const port = server.address().port;
  const userDataDir = await mkdtemp(path.join(tmpdir(), "cv-site-chrome-"));

  try {
    const targets = [
      { url: `http://127.0.0.1:${port}/`, out: path.join(ROOT, "assets/cv-hirianskyi-uk.pdf") },
      { url: `http://127.0.0.1:${port}/en/`, out: path.join(ROOT, "assets/cv-hirianskyi-en.pdf") },
    ];
    for (const t of targets) {
      console.log(`друк: ${t.url} -> ${path.relative(ROOT, t.out)}`);
      await printPage(chrome, userDataDir, t.url, t.out);
    }
    console.log("готово.");
  } finally {
    server.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
