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
  await page.goto(indexUrl);
  await page.waitForSelector('[data-exam-card]');
  await expectText(page, '.exam-status-badge', 'En correction');
  await expectCount(page, '.exam-preview-label', 0);
  await page.locator('[data-exam-card]').first().click({ force: true });
  await expectText(page, '#modal-root', 'Examen en cours de correction');
  await page.goto(`${indexUrl}#/exam/light`);
  await expectText(page, 'body', 'est en correction');
  await page.goto(`${indexUrl}#/exam-review/light`);
  await expectText(page, 'body', 'Review indisponible');
  await page.close();
}

async function verifyAdminSpa(browser) {
  const page = await browser.newPage();
  await page.goto(`${indexUrl}?dev=admin`);
  await page.waitForSelector('[data-exam-card]');
  await expectCount(page, '.exam-preview-label', 2);
  await page.waitForTimeout(100);
  await page.locator('[data-exam-card]').first().click();
  await page.waitForURL(/#\/exam\/light/);
  await expectText(page, 'body', 'Poids léger');
  await page.waitForSelector('[data-start-exam-series="B1"]');
  await page.close();
}

async function verifyAdminPanel(browser) {
  const page = await browser.newPage();
  await page.goto(`${adminUrl}?dev=admin`);
  await expectText(page, 'body', 'Prévisualiser Poids Léger');
  await expectText(page, 'body', 'Prévisualiser Poids Lourd');
  await page.close();
}

async function verifyExamFlow(browser) {
  const page = await browser.newPage();
  await page.goto(`${indexUrl}?dev=admin#/exam/light/series/B1`);
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
  await page.goto(`${indexUrl}?dev=admin#/exam-review/light`);
  await expectText(page, 'body', 'Révision des questions');
  await expectText(page, 'body', '300');
  await page.locator('[data-review-question="PL-001"]').click();
  await page.waitForURL(/#\/exam-review\/light\/PL-001/);
  await expectText(page, 'body', 'PL-001');
  await expectText(page, 'code', 'Images/');
  await expectVisible(page, '.exam-question-image');
  await page.locator('[data-review-status="image_issue"]').click();
  await expectText(page, 'body', 'Image à corriger');
  await page.locator('[data-route="/exam-review/light/PL-002"]').click();
  await page.waitForURL(/#\/exam-review\/light\/PL-002/);
  await page.locator('[data-route="/exam-review/light/PL-001"]').click();
  await page.waitForURL(/#\/exam-review\/light\/PL-001/);
  await expectText(page, 'body', 'Image à corriger');
  await page.reload();
  await expectText(page, 'body', 'Image à corriger');
  await page.goto(`${indexUrl}?dev=admin#/exam-review/heavy`);
  await expectText(page, 'body', 'Poids lourd');
  await expectText(page, 'body', '50');
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
    '#/exam-review/light',
    '#/exam-review/light/PL-001',
    '#/exam/light/series/B1'
  ];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    for (const route of routes) {
      await page.goto(`${indexUrl}?dev=admin${route}`);
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
