const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
let baseUrl = '';
let indexUrl = '';
let adminUrl = '';

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(root, safePath === path.sep ? 'index.html' : safePath);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    }[ext] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function expectText(page, selector, text) {
  const value = await page.locator(selector).first().textContent({ timeout: 8000 });
  if (!value || !value.includes(text)) {
    throw new Error(`${selector} does not contain ${text}. Actual: ${value}`);
  }
}

async function expectCount(page, selector, count) {
  const actual = await page.locator(selector).count();
  if (actual !== count) throw new Error(`${selector} expected ${count}, got ${actual}`);
}

async function expectVisible(page, selector) {
  if (!(await page.locator(selector).first().isVisible({ timeout: 8000 }))) {
    throw new Error(`${selector} is not visible`);
  }
}

async function expectHidden(page, selector) {
  if (await page.locator(selector).first().isVisible({ timeout: 8000 })) {
    throw new Error(`${selector} is visible`);
  }
}

async function expectNoText(page, selector, text) {
  const value = await page.locator(selector).first().textContent({ timeout: 8000 });
  if (value && value.includes(text)) {
    throw new Error(`${selector} unexpectedly contains ${text}`);
  }
}

async function clickFirstAnswer(page) {
  const groups = page.locator('.exam-option-group');
  const groupCount = await groups.count();
  if (groupCount) {
    for (let index = 0; index < groupCount; index += 1) {
      await groups.nth(index).locator('[data-exam-answer]').first().click();
    }
  } else {
    await page.locator('[data-exam-answer]').first().click();
  }
  await page.locator('[data-validate-exam-answer]').click();
}

async function getTemporaryPin(page) {
  return page.evaluate(() => window.EXAM_PREVIEW_CONFIG.pin);
}

async function submitPin(page, value) {
  await page.locator('[data-open-dev-access]').click();
  await page.locator('#examAccessPin').fill(value);
  await page.locator('[data-exam-pin-form] button[type="submit"]').click();
}

async function verifyStudentSpa(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.EAUTO_TEST_HOSTNAME = 'example.com';
  });
  await page.route('**/assets/js/supabase.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      window.sbGetSession = async () => ({ user: { app_metadata: {} } });
      window.sbGetProfile = async () => ({ prenom: 'Eleve', telephone: '770000000', status: 'active', isAdmin: false, isSupabaseUser: true });
      window.sbIsAdmin = () => false;
      window.sbLogout = async () => {};
      window.sbSubscribe = () => ({});
    `
  }));
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-exam-card]');
  await expectText(page, '.exam-status-badge', 'En vérification');
  await expectText(page, '.exam-preview-label', 'Accéder');
  await page.locator('[data-exam-card]').first().click();
  await expectText(page, '#modal-root', 'Examen en vérification');
  await submitPin(page, '9999');
  await expectText(page, '#modal-root', "Code d'accès incorrect");
  await page.locator('[data-close-modal]').first().click();
  await page.goto(`${indexUrl}#/exam/light`, { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'est en vérification');
  await expectText(page, '#modal-root', 'Examen en vérification');
  await expectCount(page, '[data-route="/exam-image-review/light"]', 0);
  await submitPin(page, await getTemporaryPin(page));
  await page.waitForSelector('[data-start-exam-series="B1"]');
  await expectText(page, 'body', '300');
  await expectText(page, 'body', '12');
  await expectNoText(page, 'body', 'Images 280');
  await expectVisible(page, '[data-route="/exam-image-review/light"]');
  await page.reload();
  await page.waitForSelector('[data-start-exam-series="B1"]');
  await expectVisible(page, '[data-route="/exam-image-review/light"]');
  await page.goto(`${indexUrl}#/exam-image-review/light`, { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'Outil temporaire image review');
  await page.evaluate(() => {
    sessionStorage.setItem(window.EXAM_PREVIEW_CONFIG.storageKey, JSON.stringify({
      grantedAt: Date.now() - window.EXAM_PREVIEW_CONFIG.durationMs - 1,
      expiresAt: Date.now() - 1
    }));
  });
  await page.goto(`${indexUrl}#/exam/heavy`, { waitUntil: 'domcontentloaded' });
  await expectText(page, '#modal-root', 'Examen en vérification');
  await page.close();
}

async function verifyAdminSpa(browser) {
  const page = await browser.newPage();
  await page.goto(`${indexUrl}?dev=admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-exam-card]');
  await expectText(page, '.exam-preview-label', 'Accéder');
  await page.waitForTimeout(100);
  await page.locator('[data-exam-card]').first().click();
  await page.waitForURL(/#\/exam\/light/);
  await expectText(page, 'body', 'Poids léger');
  await page.waitForSelector('[data-start-exam-series="B1"]');
  await page.close();
}

async function verifyAdminPanel(browser) {
  const page = await browser.newPage();
  await page.goto(`${adminUrl}?dev=admin`, { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'Accéder Poids Léger');
  await expectText(page, 'body', 'Accéder Poids Lourd');
  await page.close();
}

async function verifyExamFlow(browser) {
  const page = await browser.newPage();
  await page.goto(`${indexUrl}?dev=admin#/exam/light/series/B1`, { waitUntil: 'domcontentloaded' });
  await expectHidden(page, '#bottom-nav');
  await expectText(page, 'body', 'Poids léger · B1');
  for (let index = 0; index < 25; index += 1) {
    await clickFirstAnswer(page);
    if (index < 24) {
      await page.locator('[data-next-exam-question]').click();
    }
  }
  await page.locator('[data-next-exam-question]').click();
  await expectText(page, 'body', 'Résultat');
  await expectText(page, 'body', '/ 25');
  await page.locator('[data-show-corrections]').click();
  await expectText(page, 'body', 'Correction');
  await page.close();
}

async function verifyReview(browser) {
  const page = await browser.newPage();
  await page.addInitScript((key, session) => {
    sessionStorage.setItem(key, JSON.stringify(session));
  }, 'eauto_exam_preview', { grantedAt: Date.now(), expiresAt: Date.now() + 7200000 });
  await page.goto(`${indexUrl}?dev=admin#/exam-image-review/light`, { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'Outil temporaire image review');
  await expectText(page, 'body', '0 / 300 contrôlées');
  await expectText(page, 'body', 'Toutes 300');
  await expectText(page, 'body', 'À vérifier 300');
  await expectText(page, 'body', 'Images à remplacer 0');
  await expectText(page, 'body', 'Vérifiées 0');
  await expectText(page, 'body', 'Question 1 / 300');
  await expectVisible(page, '.exam-question-image');
  await page.locator('[data-image-review-status="correct"]').click();
  await expectText(page, 'body', '1 / 300 contrôlées');
  await expectText(page, 'body', 'À vérifier 299');
  await expectText(page, 'body', 'Vérifiées 1');
  await expectText(page, 'body', 'Question 2 / 300');
  await page.locator('[data-image-review-status="wrong_image"]').click();
  await expectText(page, 'body', '2 / 300 contrôlées');
  await expectText(page, 'body', 'À vérifier 298');
  await expectText(page, 'body', 'Images à remplacer 1');
  await expectText(page, 'body', 'Question 3 / 300');
  await page.locator('[data-image-review-filter="wrong_image"]').click();
  await page.waitForFunction(() => location.hash.includes('filter=wrong_image'));
  await page.locator('.wrong-image-list button').first().click();
  await page.locator('[data-image-review-status="correct"]').click();
  await expectText(page, 'body', 'Images à remplacer 0');
  await expectText(page, 'body', 'Vérifiées 2');
  await page.locator('[data-image-review-filter="all"]').click();
  await page.waitForFunction(() => !location.hash.includes('filter='));
  await page.locator('[data-image-review-go]').last().click();
  await page.locator('[data-image-review-status="wrong_image"]').click();
  await expectText(page, 'body', 'Images à remplacer 1');
  await page.reload();
  await expectText(page, 'body', 'Images à remplacer');
  await page.locator('[data-image-review-filter="wrong_image"]').click();
  await page.waitForFunction(() => location.hash.includes('filter=wrong_image'));
  await expectText(page, 'body', 'Images à remplacer : 1');
  await page.locator('[data-export-wrong-images]').click();
  const exportJson = await page.locator('[data-export-buffer]').inputValue();
  const parsed = JSON.parse(exportJson);
  if (parsed.length !== 1 || parsed[0].questionId !== 'PL-003') throw new Error(`Unexpected export JSON: ${exportJson}`);
  await page.goto(`${indexUrl}?dev=admin#/exam-image-review/heavy`, { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'Poids lourd');
  await expectText(page, 'body', 'Question 1 / 50');
  await page.close();
}

async function verifyResponsiveScroll(browser) {
  const viewports = [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 }
  ];
  const routes = [
    '#/exam/light',
    '#/exam-image-review/light',
    '#/exam-image-review/light/PL-001',
    '#/exam/light/series/B1'
  ];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    for (const route of routes) {
      await page.goto(`${indexUrl}?dev=admin${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#app-view');
      const issue = await page.evaluate(() => {
        const widthOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
        const internalScrollers = [...document.querySelectorAll('#app-view *')]
          .filter((element) => {
            const style = getComputedStyle(element);
            const canScroll = ['auto', 'scroll'].includes(style.overflowY);
            return canScroll && element.scrollHeight > element.clientHeight + 2;
          })
          .map((element) => element.className || element.id || element.tagName);
        return { widthOverflow, internalScrollers };
      });
      if (issue.widthOverflow) throw new Error(`${route} overflows horizontally at ${viewport.width}x${viewport.height}`);
      if (issue.internalScrollers.length) {
        throw new Error(`${route} has internal scrollers at ${viewport.width}x${viewport.height}: ${issue.internalScrollers.join(', ')}`);
      }
    }
    await page.close();
  }
}

(async () => {
  const server = await startStaticServer();
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  indexUrl = `${baseUrl}/index.html`;
  adminUrl = `${baseUrl}/admin.html`;
  const browser = await chromium.launch();
  try {
    await verifyStudentSpa(browser);
    await verifyAdminSpa(browser);
    await verifyAdminPanel(browser);
    await verifyExamFlow(browser);
    await verifyReview(browser);
    await verifyResponsiveScroll(browser);
    console.log('exam preview verification passed');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
