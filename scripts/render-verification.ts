import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium, type Browser } from '@playwright/test';

function usage(): never {
  console.error('Usage: npm run verify:screenshot -- FIXTURE.json OUTPUT.png [WIDTH HEIGHT]');
  process.exit(2);
}

const [fixtureArgument, outputArgument, widthArgument = '1440', heightArgument = '900', ...extra] = process.argv.slice(2);
if (!fixtureArgument || !outputArgument || extra.length) usage();
const width = Number(widthArgument);
const height = Number(heightArgument);
if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) usage();

const fixturePath = resolve(fixtureArgument);
const outputPath = resolve(outputArgument);
const fixtureJson = readFileSync(fixturePath, 'utf8');
const fixture: unknown = JSON.parse(fixtureJson); // Fail before starting Chromium.
const port = 43_000 + Math.floor(Math.random() * 5_000);
const url = `http://localhost:${port}/?verify=1`;
let vite: ChildProcess | undefined;
let browser: Browser | undefined;

async function waitForVite() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (vite?.exitCode != null) throw new Error(`Vite exited with code ${vite.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite has not bound its socket yet.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error('Timed out waiting for Vite');
}

try {
  vite = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', '--host', 'localhost', '--port', String(port), '--strictPort',
  ], { stdio: 'ignore', env: process.env });
  await waitForVite();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const pageErrors: Error[] = [];
  page.on('pageerror', error => pageErrors.push(error));

  await page.goto(url, { waitUntil: 'load' });
  await page.locator('body[data-verification-ready="true"]').waitFor();
  await page.evaluate(input => {
    const verification = (globalThis as typeof globalThis & {
      __VRC3D_VERIFY__?: { render(value: unknown): void };
    }).__VRC3D_VERIFY__;
    if (!verification) throw new Error('Renderer verification API is unavailable');
    verification.render(input);
  }, fixture);
  await page.locator('body[data-render-ready="true"]').waitFor();
  if (pageErrors.length) throw pageErrors[0];
  await page.screenshot({ path: outputPath });
  await context.close();
  console.log(outputPath);
} finally {
  await browser?.close();
  vite?.kill('SIGTERM');
}
