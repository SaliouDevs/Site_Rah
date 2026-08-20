const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function installSupabaseMock(page, options = {}) {
  const {
    auth = 'active',
    role = 'student',
    statuses = { light: 'verification', heavy: 'verification' },
    overrides = [],
    profiles = [],
    maintenance = { enabled: false, message: 'Maintenance test' }
  } = options;
  await page.route('**/assets/js/supabase.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const mockState = {
        auth: ${JSON.stringify(auth)},
        role: ${JSON.stringify(role)},
        statuses: ${JSON.stringify(statuses)},
        overrides: ${JSON.stringify(overrides)},
        profiles: ${JSON.stringify(profiles)},
        maintenance: ${JSON.stringify(maintenance)},
        logoutCount: 0,
        deleted: []
      };
      const user = mockState.auth === 'none' ? null : {
        id: mockState.role === 'admin' ? 'admin-user' : 'student-user',
        app_metadata: mockState.role === 'admin' ? { role: 'admin' } : {}
      };
      function tableQuery(table) {
        const query = {
          select() { return this; },
          eq(column, value) {
            this.filters = this.filters || {};
            this.filters[column] = value;
            this.column = column;
            this.value = value;
            return this;
          },
          order() { return this; },
          single() { return Promise.resolve({ data: this._singleData(), error: null }); },
          update(payload) { this.updatePayload = payload; return this; },
          delete() { this.isDelete = true; return this; },
          upsert(payload) { this.upsertPayload = payload; return this; },
          then(resolve) { return Promise.resolve(this._result()).then(resolve); },
          _singleData() {
            if (table === 'app_settings') return { id: 'global' };
            if (table === 'runtime_settings') {
              if (this.updatePayload) {
                mockState.maintenance.enabled = this.updatePayload.maintenance_enabled;
                mockState.maintenance.message = this.updatePayload.maintenance_message;
              }
              return {
                id: 'global',
                maintenance_enabled: mockState.maintenance.enabled,
                maintenance_message: mockState.maintenance.message
              };
            }
            if (table === 'exam_settings') {
              const examKey = this.filters?.exam_key || this.value || 'light';
              if (this.updatePayload) mockState.statuses[examKey] = this.updatePayload.status;
              return { exam_key: examKey, status: this.updatePayload?.status || mockState.statuses[examKey] || 'verification' };
            }
            if (table === 'exam_question_images') return this.upsertPayload || mockState.overrides[0] || null;
            return null;
          },
          _result() {
            if (table === 'app_settings') return { data: { id: 'global' }, error: null };
            if (table === 'runtime_settings') {
              if (this.updatePayload) {
                mockState.maintenance.enabled = this.updatePayload.maintenance_enabled;
                mockState.maintenance.message = this.updatePayload.maintenance_message;
              }
              return {
                data: {
                  id: 'global',
                  maintenance_enabled: mockState.maintenance.enabled,
                  maintenance_message: mockState.maintenance.message
                },
                error: null
              };
            }
            if (table === 'exam_settings') {
              if (this.updatePayload) {
                const examKey = this.filters?.exam_key || this.value;
                mockState.statuses[examKey] = this.updatePayload.status;
                return { data: { exam_key: examKey, status: this.updatePayload.status }, error: null };
              }
              return { data: Object.entries(mockState.statuses).map(([exam_key, status]) => ({ exam_key, status })), error: null };
            }
            if (table === 'exam_question_images') {
              if (this.isDelete) {
                const questionId = this.filters?.question_id;
                const examKey = this.filters?.exam_key;
                mockState.deleted.push(questionId);
                mockState.overrides = mockState.overrides.filter((row) => row.question_id !== questionId || row.exam_key !== examKey);
                return { data: null, error: null };
              }
              const rows = mockState.overrides.filter((row) => (
                (!this.filters?.exam_key || row.exam_key === this.filters.exam_key)
                && (!this.filters?.question_id || row.question_id === this.filters.question_id)
              ));
              return { data: rows, error: null };
            }
            return { data: [], error: null };
          }
        };
        return query;
      }
      window.sb = {
        from: tableQuery,
        storage: {
          from: () => ({
            getPublicUrl: (storagePath) => ({ data: { publicUrl: 'https://mock.supabase.test/storage/v1/object/public/exam-images/' + storagePath } }),
            upload: async () => ({ data: { path: 'mock/path.png' }, error: null }),
            remove: async () => ({ data: [], error: null })
          })
        }
      };
      window.sbGetSession = async () => user ? ({ user }) : null;
      window.sbGetUser = async () => user;
      window.sbGetProfile = async () => {
        if (!user) return null;
        if (mockState.role === 'admin') {
          return { id: user.id, prenom: 'Admin', telephone: '760000000', status: 'active', isAdmin: true, isSupabaseUser: true };
        }
        return { id: user.id, prenom: 'Eleve', telephone: '770000000', status: mockState.auth, isAdmin: false, isSupabaseUser: true };
      };
      window.sbIsAdmin = (candidate) => candidate?.app_metadata?.role === 'admin';
      window.sbLogout = async () => {
        mockState.logoutCount += 1;
        sessionStorage.setItem('mock_logout_count', String(mockState.logoutCount));
      };
      window.sbSubscribe = (channelName, config, callback) => {
        mockState.subscription = { channelName, config, callback };
        return {};
      };
      window.sbRemoveChannel = () => {};
      window.sbGetAllProfiles = async () => mockState.profiles;
      window.sbGetProfilesPage = async ({ page = 1, pageSize = 10, status = 'all', query = '' } = {}) => {
        const q = String(query || '').toLowerCase();
        const filtered = mockState.profiles.filter((profile) => {
          const statusMatch = status === 'all' || profile.status === status;
          const text = String((profile.prenom || '') + ' ' + (profile.telephone || '')).toLowerCase();
          return statusMatch && (!q || text.includes(q));
        });
        const start = (page - 1) * pageSize;
        return { profiles: filtered.slice(start, start + pageSize), total: filtered.length };
      };
      window.sbGetProfileCounts = async () => ({
        total: mockState.profiles.length,
        pending: mockState.profiles.filter((profile) => profile.status === 'pending').length,
        active: mockState.profiles.filter((profile) => profile.status === 'active').length,
        blocked: mockState.profiles.filter((profile) => profile.status === 'blocked').length
      });
      window.sbAdminUpdateStatus = async (id, status) => ({ id, status });
      window.sbAdminRenameUser = async (id, prenom) => ({ id, prenom });
      window.sbAdminResetPassword = async () => {};
      window.__mockState = mockState;
    `
  }));
}

async function expectText(page, selector, text) {
  const value = await page.locator(selector).first().textContent({ timeout: 10000 });
  if (!value || !value.includes(text)) throw new Error(`${selector} does not contain ${text}. Actual: ${value}`);
}

async function expectCount(page, selector, count) {
  const actual = await page.locator(selector).count();
  if (actual !== count) throw new Error(`${selector} expected ${count}, got ${actual}`);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  if (overflow) throw new Error(`${label} has horizontal overflow`);
}

async function verifyAuth(browser) {
  const none = await browser.newPage();
  await installSupabaseMock(none, { auth: 'none' });
  await none.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await none.waitForURL(/auth\.html/);
  await none.close();

  for (const status of ['pending', 'blocked']) {
    const page = await browser.newPage();
    await installSupabaseMock(page, { auth: status });
    await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(new RegExp(`auth\\.html\\?status=${status}`));
    await page.close();
  }

  const admin = await browser.newPage();
  await installSupabaseMock(admin, { role: 'admin' });
  await admin.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  await expectText(admin, 'body', 'Tableau de bord');
  await admin.close();
}

async function verifyExamStatuses(browser) {
  const verification = await browser.newPage();
  await installSupabaseMock(verification, { statuses: { light: 'verification', heavy: 'verification' } });
  await verification.goto(`${indexUrl}#/exams`, { waitUntil: 'domcontentloaded' });
  await expectText(verification, 'body', 'En vérification');
  await expectText(verification, 'body', 'Certaines questions sont encore en cours de contrôle.');
  await expectCount(verification, 'button[data-exam-entry="light"]', 0);
  await expectCount(verification, 'text=Accéder', 0);
  await verification.goto(`${indexUrl}#/exam/light`, { waitUntil: 'domcontentloaded' });
  await expectText(verification, 'body', 'en vérification');
  await verification.close();

  const offline = await browser.newPage();
  await installSupabaseMock(offline, { statuses: { light: 'offline', heavy: 'verification' } });
  await offline.goto(`${indexUrl}#/exams`, { waitUntil: 'domcontentloaded' });
  await expectCount(offline, '[data-exam-entry="light"]', 0);
  await offline.goto(`${indexUrl}#/exam/light`, { waitUntil: 'domcontentloaded' });
  await expectText(offline, 'body', 'hors ligne');
  await offline.close();

  const online = await browser.newPage();
  await installSupabaseMock(online, { statuses: { light: 'online', heavy: 'online' } });
  await online.goto(`${indexUrl}#/exam/light`, { waitUntil: 'domcontentloaded' });
  await online.waitForSelector('[data-start-exam-series="B1"]');
  await expectText(online, 'body', '300');
  await online.goto(`${indexUrl}#/exam/heavy`, { waitUntil: 'domcontentloaded' });
  await online.waitForSelector('[data-start-exam-series="C1"]');
  await expectText(online, 'body', '50');
  await online.goto(`${indexUrl}#/exam/light/series/B1`, { waitUntil: 'domcontentloaded' });
  await expectText(online, 'body', 'Poids léger · B1');
  await expectCount(online, 'text=PL-001', 0);
  await online.goto(`${indexUrl}#/exam/heavy/series/C1`, { waitUntil: 'domcontentloaded' });
  await expectText(online, 'body', 'Poids lourd · C1');
  await expectCount(online, 'text=PLD-001', 0);
  await online.close();
}

async function verifyImageOverride(browser) {
  const page = await browser.newPage();
  await installSupabaseMock(page, {
    statuses: { light: 'online', heavy: 'verification' },
    overrides: [{ question_id: 'PL-001', exam_key: 'light', series_id: 'B1', storage_path: 'light/PL-001/mock.webp' }]
  });
  await page.goto(`${indexUrl}#/exam/light/series/B1?question=PL-001`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.exam-question-image');
  const src = await page.locator('.exam-question-image').getAttribute('src');
  if (!src.includes('exam-images/light/PL-001/mock.webp')) throw new Error(`Override not used: ${src}`);
  await page.close();
}

async function verifyAdminQuestionLink(browser) {
  const page = await browser.newPage();
  await installSupabaseMock(page, {
    role: 'admin',
    statuses: { light: 'verification', heavy: 'verification' },
    profiles: [],
    overrides: [{ question_id: 'PL-001', exam_key: 'light', series_id: 'B1', storage_path: 'light/PL-001/mock.webp' }]
  });
  await page.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Examens', exact: true }).click();
  await page.getByPlaceholder('ID ou texte question').fill('PL-001');
  await page.getByRole('button', { name: "Voir dans l'examen" }).click();
  await page.waitForURL(/#\/exam\/light\/series\/B1\?question=PL-001/);
  await expectText(page, 'body', 'Question 1 / 25');
  const src = await page.locator('.exam-question-image').getAttribute('src');
  if (!src.includes('exam-images/light/PL-001/mock.webp')) throw new Error(`Admin question link did not use override: ${src}`);
  await page.close();
}

async function verifyMaintenance(browser) {
  const page = await browser.newPage();
  await installSupabaseMock(page, {
    statuses: { light: 'online', heavy: 'online' },
    maintenance: { enabled: false, message: 'Maintenance test' }
  });
  await page.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('eautoecole.learningProgress', '{"kept":true}'));
  await page.evaluate(() => {
    window.__mockState.maintenance.enabled = true;
    window.__mockState.subscription.callback({
      new: {
        id: 'global',
        maintenance_enabled: true,
        maintenance_message: 'Maintenance test'
      }
    });
  });
  await page.waitForURL(/auth\.html\?maintenance=1/);
  await expectText(page, 'body', 'Maintenance test');
  const progress = await page.evaluate(() => localStorage.getItem('eautoecole.learningProgress'));
  if (progress !== '{"kept":true}') throw new Error('Maintenance logout removed local progress');
  const logoutCount = await page.evaluate(() => Number(sessionStorage.getItem('mock_logout_count') || 0));
  if (logoutCount < 1) throw new Error('Maintenance did not sign out Supabase session');
  await page.close();

  const admin = await browser.newPage();
  await installSupabaseMock(admin, {
    role: 'admin',
    maintenance: { enabled: true, message: 'Maintenance test' }
  });
  await admin.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  await expectText(admin, 'body', 'Tableau de bord');
  await admin.close();
}

async function verifyAdmin(browser) {
  const profiles = [
    { id: 'u1', prenom: 'Pending', telephone: '771', formule: 'Formule Illimitée', prix: 2000, status: 'pending' },
    { id: 'u2', prenom: 'Active', telephone: '772', formule: 'Formule Illimitée', prix: 2000, status: 'active' },
    { id: 'u3', prenom: 'Blocked', telephone: '773', formule: 'Formule Illimitée', prix: 2000, status: 'blocked' },
    ...Array.from({ length: 23 }, (_, index) => ({
      id: `u${index + 4}`,
      prenom: `User ${index + 4}`,
      telephone: `78${String(index + 4).padStart(7, '0')}`,
      formule: 'Formule Illimitée',
      prix: 2000,
      status: 'active'
    }))
  ];
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  await installSupabaseMock(page, {
    role: 'admin',
    statuses: { light: 'verification', heavy: 'verification' },
    profiles,
    overrides: [{ question_id: 'PL-001', exam_key: 'light', series_id: 'B1', storage_path: 'light/PL-001/mock.webp' }]
  });
  await page.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'Utilisateurs total');
  await expectText(page, 'body', '26');
  await expectText(page, 'body', 'Maintenance du site');
  await page.getByRole('button', { name: 'Utilisateurs', exact: true }).click();
  await expectText(page, 'body', '1–10 sur 26 utilisateurs');
  await expectCount(page, '.admin-table tbody tr', 10);
  await expectText(page, 'body', 'Pending');
  await expectText(page, 'body', 'Active');
  await expectText(page, 'body', 'Blocked');
  await page.getByRole('button', { name: 'Suivant →' }).click();
  await expectText(page, 'body', '11–20 sur 26 utilisateurs');
  await page.getByRole('button', { name: '← Précédent' }).click();
  await page.getByPlaceholder('Prénom ou téléphone').fill('Blocked');
  await expectText(page, 'body', '1–1 sur 1 utilisateur');
  await expectText(page, 'body', 'Blocked');
  await page.getByPlaceholder('Prénom ou téléphone').fill('');
  await page.locator('[data-user-filter]').selectOption('pending');
  await expectText(page, 'body', '1–1 sur 1 utilisateur');
  await page.locator('[data-user-filter]').selectOption('all');
  await page.getByRole('button', { name: 'Examens', exact: true }).click();
  await expectText(page, 'body', 'Disponible aux élèves : OFF');
  await page.locator('[data-exam-availability="light"]').check();
  await expectText(page, '#toast-root', 'Poids Léger est maintenant disponible aux élèves.');
  await page.getByPlaceholder('ID ou texte question').fill('PL-001');
  await expectText(page, 'body', 'PL-001');
  await expectText(page, 'body', 'Personnalisée');
  await expectText(page, 'body', "Voir dans l'examen");
  await page.getByRole('button', { name: "Restaurer l'image originale" }).click();
  await page.getByRole('button', { name: 'Restaurer', exact: true }).click();
  await expectText(page, '#toast-root', 'Image originale restaurée.');
  await expectText(page, 'body', 'Originale');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: "Remplacer l'image" }).click();
  const chooser = await chooserPromise;
  const tmpFile = path.join(os.tmpdir(), 'eauto-exam-upload-test.png');
  await fs.promises.writeFile(tmpFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await chooser.setFiles(tmpFile);
  await expectText(page, 'body', 'Enregistrer');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.locator('[data-exam-availability="light"]').uncheck();
  await expectText(page, '#toast-root', 'Poids Léger est repassé en vérification.');
  await page.getByRole('button', { name: 'Tableau de bord', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-maintenance-enabled]').check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expectText(page, '#toast-root', 'Maintenance activée.');
  await page.close();
}

async function verifyResponsive(browser) {
  const viewports = [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1366, height: 768 }
  ];
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await installSupabaseMock(page, { statuses: { light: 'online', heavy: 'online' } });
    for (const route of ['#/exam/light', '#/exam/light/series/B1']) {
      await page.goto(`${indexUrl}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#app-view');
      await assertNoHorizontalOverflow(page, `${route} ${viewport.width}x${viewport.height}`);
    }
    await page.goto(`${adminUrl}?dev=admin`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Examens', exact: true }).click();
    await assertNoHorizontalOverflow(page, `admin exams ${viewport.width}x${viewport.height}`);
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
    await verifyAuth(browser);
    await verifyExamStatuses(browser);
    await verifyImageOverride(browser);
    await verifyAdminQuestionLink(browser);
    await verifyMaintenance(browser);
    await verifyAdmin(browser);
    await verifyResponsive(browser);
    console.log('permanent exam verification passed');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
