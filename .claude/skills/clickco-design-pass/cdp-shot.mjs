// Headless Chrome screenshots + layout probes over CDP. No dependencies (Node 22 WebSocket).
// usage: node cdp-shot.mjs <outDir> <jobs.json>
// A job: { name, url, width, height, reduced?, full?, chunk?, scale?, wait?, probe? }
//   reduced  emulate prefers-reduced-motion (scroll reveals off, so full pages are not blank)
//   chunk    walk the page (lazy images load), then save it in slices of this many px
//   probe    a JS expression; its value lands in report.json under the job's `extra`
// Writes <name>.jpg (or <name>-NN.jpg) and report.json (overflow, fold words, labels, fonts).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const [outDir, jobsFile] = process.argv.slice(2);
const jobs = JSON.parse(readFileSync(jobsFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/clickco-tools/profile',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageWs() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('chrome did not start');
}

const PROBE = `(() => {
  const W = innerWidth, H = innerHeight;
  const de = document.documentElement;
  const over = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect(); return r.width && r.right > W + 1 && getComputedStyle(e).position !== 'fixed';
  }).slice(0, 6).map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : '') + ' r=' + Math.round(e.getBoundingClientRect().right));
  const inFold = (e) => { const r = e.getBoundingClientRect(); return r.top < H && r.bottom > 0 && r.width > 0; };
  const amber = [...document.querySelectorAll('body *')].filter((e) => inFold(e) && getComputedStyle(e).backgroundColor === 'rgb(255, 182, 61)').map((e) => e.tagName.toLowerCase() + '.' + (e.className || ''));
  const upper = [...document.querySelectorAll('body *')].filter((e) => e.childElementCount === 0 && e.textContent.trim() && getComputedStyle(e).textTransform === 'uppercase').slice(0, 12).map((e) => e.textContent.trim().slice(0, 30));
  const small = [...document.querySelectorAll('body *')].filter((e) => e.childElementCount === 0 && e.textContent.trim().length > 20 && parseFloat(getComputedStyle(e).fontSize) < 14).slice(0, 8).map((e) => getComputedStyle(e).fontSize + ' ' + e.textContent.trim().slice(0, 40));
  const h1 = document.querySelector('h1');
  const cta = [...document.querySelectorAll('a,button')].filter((e) => /waitlist|book|get|price|quote/i.test(e.textContent)).slice(0, 4).map((e) => e.textContent.trim().slice(0, 30) + ' top=' + Math.round(e.getBoundingClientRect().top));
  const foldWords = (() => { let n = 0; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) { const p = tw.currentNode.parentElement; if (p && inFold(p) && getComputedStyle(p).visibility !== 'hidden') n += tw.currentNode.textContent.trim().split(/\\s+/).filter(Boolean).length; } return n; })();
  const sections = [...document.querySelectorAll('main > *, main section')].length;
  return { W, H, scrollWidth: de.scrollWidth, docHeight: de.scrollHeight, htmlOverflowX: getComputedStyle(de).overflowX,
    bodyOverflowX: getComputedStyle(document.body).overflowX, overflowing: over, amberFillsInFold: amber,
    uppercase: upper, smallText: small, h1: h1 && h1.textContent.trim(), h1Bottom: h1 && Math.round(h1.getBoundingClientRect().bottom),
    ctas: cta, foldWords, sections, imgs: document.images.length,
    fonts: [...new Set([...document.querySelectorAll('h1,h2,h3,p,a,button,label')].map((e) => getComputedStyle(e).fontFamily.split(',')[0]))] };
})()`;

const ws = new WebSocket(await pageWs());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const waiters = new Map();
const events = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiters.has(msg.id)) {
    waiters.get(msg.id)(msg);
    waiters.delete(msg.id);
  } else if (msg.method) events.push(msg.method);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    waiters.set(n, (msg) =>
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result),
    );
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const report = {};
try {
  await send('Page.enable');
  for (const job of jobs) {
    const mobile = job.width < 600;
    await send('Emulation.setDeviceMetricsOverride', {
      width: job.width,
      height: job.height,
      deviceScaleFactor: 1,
      mobile,
    });
    await send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: job.reduced ? 'reduce' : 'no-preference' },
      ],
    });
    await send('Page.navigate', { url: job.url });
    await sleep(job.wait ?? 2500);
    const probe = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    report[job.name] = probe.result.value ?? probe.exceptionDetails?.text;
    if (job.probe) {
      const extra = await send('Runtime.evaluate', { expression: job.probe, returnByValue: true });
      report[job.name].extra = extra.result.value ?? extra.exceptionDetails?.text;
    }
    if (job.chunk) {
      // Walk the page once so lazy images load before the beyond-viewport capture.
      await send('Runtime.evaluate', {
        awaitPromise: true,
        expression: `(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        scrollTo(0, 0); })()`,
      });
      await sleep(2500);
      const imgs = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `[...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src'))`,
      });
      report[job.name].unloadedImages = imgs.result.value;
      const total = Math.min(report[job.name].docHeight, 30000);
      for (let y = 0, i = 1; y < total; y += job.chunk, i++) {
        const clip = {
          x: 0,
          y,
          width: job.width,
          height: Math.min(job.chunk, total - y),
          scale: job.scale ?? 1,
        };
        const part = await send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 70,
          captureBeyondViewport: true,
          clip,
        });
        writeFileSync(
          join(outDir, `${job.name}-${String(i).padStart(2, '0')}.jpg`),
          Buffer.from(part.data, 'base64'),
        );
      }
      continue;
    }
    let clip;
    if (job.full) {
      const h = Math.min(report[job.name].docHeight || job.height, 16000);
      clip = { x: 0, y: 0, width: job.width, height: h, scale: job.scale ?? 1 };
    }
    const shot = await send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 70,
      captureBeyondViewport: Boolean(job.full),
      ...(clip ? { clip } : {}),
    });
    writeFileSync(join(outDir, `${job.name}.jpg`), Buffer.from(shot.data, 'base64'));
  }
} catch (err) {
  console.error('cdp-shot failed:', err.message);
  process.exitCode = 1;
} finally {
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  ws.close();
  chrome.kill();
}
console.log(JSON.stringify(report, null, 1));
