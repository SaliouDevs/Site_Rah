const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ADMIN_ALIAS = 'rah@admin';
const EXPECTED_SUPABASE_URL = 'http://127.0.0.1:54321';
const PRODUCTION_HOST = 'mhoxpqskssbxuuyzjsqx.supabase.co';

function getRequiredPassword() {
  const password = process.env.EAUTO_LOCAL_DEV_PASSWORD;
  if (!password) {
    throw new Error('Set EAUTO_LOCAL_DEV_PASSWORD before running this login test.');
  }
  return password;
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT, safePath === path.sep ? 'index.html' : safePath);
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    }[ext] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const password = getRequiredPassword();
  const server = await startStaticServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes(PRODUCTION_HOST)) {
      throw new Error(`Production Supabase request blocked: ${url}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  try {
    await page.goto(`${baseUrl}/auth.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.sb?.supabaseUrl), null, { timeout: 15000 });
    const supabaseUrl = await page.evaluate(() => window.sb.supabaseUrl);
    if (supabaseUrl !== EXPECTED_SUPABASE_URL) {
      throw new Error(`Frontend Supabase URL mismatch: ${supabaseUrl}`);
    }

    await page.locator('#loginIdentifier').fill(ADMIN_ALIAS);
    await page.locator('#loginPassword').fill(password);
    await page.locator('[data-login-form]').evaluate((form) => form.requestSubmit());
    await page.waitForURL(/admin\.html/, { timeout: 15000 });
    await page.waitForSelector('[data-admin-view="dashboard"]', { timeout: 15000 });
    const state = await page.evaluate(async () => {
      const session = await window.sbGetSession();
      const profile = await window.sbGetProfile().catch(() => null);
      return {
        supabaseUrl: window.sb.supabaseUrl,
        role: session?.user?.app_metadata?.role || '',
        profileStatus: profile?.status || ''
      };
    });

    if (state.role !== 'admin') throw new Error(`Admin role mismatch: ${state.role}`);
    if (state.profileStatus !== 'active') throw new Error(`Admin profile status mismatch: ${state.profileStatus}`);
    const relevantErrors = consoleErrors.filter((entry) => !entry.includes('Failed to load resource'));
    if (relevantErrors.length) throw new Error(`Console errors: ${relevantErrors.join(' | ')}`);

    console.log(JSON.stringify({
      login: 'PASS',
      alias: ADMIN_ALIAS,
      supabaseUrl: state.supabaseUrl,
      role: state.role,
      profileStatus: state.profileStatus
    }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
