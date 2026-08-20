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
        deleted: [],
        subscriptions: [],
        refreshCount: 0,
        statusUpdateCount: 0,
        runtimeUpdateCount: 0
      };
      const nativeSetInterval = window.setInterval.bind(window);
      const nativeClearInterval = window.clearInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        const id = nativeSetInterval(callback, delay, ...args);
        mockState.intervals = mockState.intervals || [];
        mockState.intervals.push({ id, delay, active: true });
        return id;
      };
      window.clearInterval = (id) => {
        mockState.intervals = (mockState.intervals || []).map((item) => (
          item.id === id ? { ...item, active: false } : item
        ));
        return nativeClearInterval(id);
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
                mockState.runtimeUpdateCount += 1;
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
              if (this.updatePayload) {
                mockState.statusUpdateCount += 1;
                mockState.statuses[examKey] = this.updatePayload.status;
              }
              return { exam_key: examKey, status: this.updatePayload?.status || mockState.statuses[examKey] || 'verification' };
            }
            if (table === 'exam_question_images') return this.upsertPayload || mockState.overrides[0] || null;
            return null;
          },
          _result() {
            if (table === 'app_settings') return { data: { id: 'global' }, error: null };
            if (table === 'runtime_settings') {
              if (this.updatePayload) {
                mockState.runtimeUpdateCount += 1;
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
                mockState.statusUpdateCount += 1;
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
      window.sbLogin = async () => {
        if (!user) throw new Error('Invalid login credentials');
        return { user, session: { user } };
      };
      window.sbGetProfile = async () => {
        if (!user) return null;
        if (mockState.role === 'admin') {
          return { id: user.id, prenom: 'Admin', telephone: '760000000', status: 'active', isAdmin: true, isSupabaseUser: true };
        }
        return { id: user.id, prenom: 'Eleve', telephone: '770000000', status: mockState.auth, isAdmin: false, isSupabaseUser: true };
      };
      window.sbIsAdmin = (candidate) => candidate?.app_metadata?.role === 'admin';
      window.sbRefreshSession = async () => {
        mockState.refreshCount += 1;
        return user ? ({ user }) : null;
      };
      window.sbLogout = async () => {
        mockState.logoutCount += 1;
        sessionStorage.setItem('mock_logout_count', String(mockState.logoutCount));
      };
      window.sbSubscribe = (channelName, config, callback) => {
        mockState.subscription = { channelName, config, callback };
        mockState.subscriptions.push({ channelName, config });
        mockState.subscriptionCallbacks = mockState.subscriptionCallbacks || {};
        mockState.subscriptionCallbacks[config.table] = callback;
        return {};
      };
      window.sbRemoveChannel = () => {
        mockState.removeChannelCount = (mockState.removeChannelCount || 0) + 1;
      };
      window.__triggerTable = (table, row = {}) => {
        const callback = mockState.subscriptionCallbacks?.[table];
        if (!callback) throw new Error('No subscription for ' + table);
        callback({ new: row });
      };
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

async function verifyExamSettingsLive(browser) {
  const on = await browser.newPage();
  await installSupabaseMock(on, { statuses: { light: 'verification', heavy: 'verification' } });
  await on.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  await on.evaluate(() => {
    window.__liveMarker = 'kept';
    window.__examSettingsEventCount = 0;
    window.addEventListener('exam-settings-updated', () => {
      window.__examSettingsEventCount += 1;
    });
  });
  await expectCount(on, 'button[data-exam-card][data-exam-id="light"]', 0);
  await on.evaluate(() => {
    window.__mockState.statuses.light = 'online';
    window.__triggerTable('exam_settings', { exam_key: 'light', status: 'online' });
  });
  await on.waitForSelector('button[data-exam-card][data-exam-id="light"]');
  await expectText(on, 'body', 'En ligne');
  const onState = await on.evaluate(() => ({
    marker: window.__liveMarker,
    events: window.__examSettingsEventCount
  }));
  if (onState.marker !== 'kept') throw new Error('Exam live ON caused a reload');
  if (onState.events < 1) throw new Error('exam-settings-updated event was not emitted');
  await on.locator('button[data-exam-card][data-exam-id="light"]').click();
  await on.waitForURL(/#\/exam\/light/);
  await on.close();

  const off = await browser.newPage();
  await installSupabaseMock(off, { statuses: { light: 'online', heavy: 'verification' } });
  await off.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  await off.waitForSelector('button[data-exam-card][data-exam-id="light"]');
  await off.evaluate(() => {
    window.__liveMarker = 'kept';
    window.__mockState.statuses.light = 'verification';
    window.__triggerTable('exam_settings', { exam_key: 'light', status: 'verification' });
  });
  await off.waitForFunction(() => !document.querySelector('button[data-exam-card][data-exam-id="light"]'));
  await expectText(off, 'body', 'En vérification');
  const offMarker = await off.evaluate(() => window.__liveMarker);
  if (offMarker !== 'kept') throw new Error('Exam live OFF caused a reload');
  await off.close();

  const active = await browser.newPage();
  await installSupabaseMock(active, { statuses: { light: 'online', heavy: 'verification' } });
  await active.goto(`${indexUrl}#/exam/light/series/B1`, { waitUntil: 'domcontentloaded' });
  await expectText(active, 'body', 'Question 1 / 25');
  await active.evaluate(() => {
    localStorage.setItem('eautoecole.learningProgress', '{"kept":true}');
    window.__mockState.statuses.light = 'verification';
    window.__triggerTable('exam_settings', { exam_key: 'light', status: 'verification' });
  });
  await active.waitForURL(/#\/home/);
  await expectText(active, '#toast-root', "Cet examen n'est plus disponible.");
  const activeState = await active.evaluate(() => ({
    logoutCount: window.__mockState.logoutCount,
    progress: localStorage.getItem('eautoecole.learningProgress')
  }));
  if (activeState.logoutCount !== 0) throw new Error(`Exam disable signed out student: ${activeState.logoutCount}`);
  if (activeState.progress !== '{"kept":true}') throw new Error('Exam disable removed local progress');
  await active.close();

  const admin = await browser.newPage();
  await installSupabaseMock(admin, { role: 'admin', statuses: { light: 'online', heavy: 'verification' } });
  await admin.goto(`${indexUrl}#/exam/light/series/B1`, { waitUntil: 'domcontentloaded' });
  await expectText(admin, 'body', 'Question 1 / 25');
  await admin.evaluate(() => {
    window.__mockState.statuses.light = 'verification';
    window.__triggerTable('exam_settings', { exam_key: 'light', status: 'verification' });
  });
  await admin.waitForTimeout(250);
  if (!admin.url().includes('#/exam/light/series/B1')) throw new Error('Admin was removed from exam after status change');
  const adminLogoutCount = await admin.evaluate(() => window.__mockState.logoutCount);
  if (adminLogoutCount !== 0) throw new Error(`Admin was signed out by exam live guard: ${adminLogoutCount}`);
  await admin.close();

  const heavy = await browser.newPage();
  await installSupabaseMock(heavy, { statuses: { light: 'verification', heavy: 'verification' } });
  await heavy.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  await heavy.evaluate(() => {
    window.__mockState.statuses.heavy = 'online';
    window.__triggerTable('exam_settings', { exam_key: 'heavy', status: 'online' });
  });
  await heavy.waitForSelector('button[data-exam-card][data-exam-id="heavy"]');
  await expectCount(heavy, 'button[data-exam-card][data-exam-id="light"]', 0);
  await heavy.close();

  const lifecycle = await browser.newPage();
  await installSupabaseMock(lifecycle, { statuses: { light: 'verification', heavy: 'verification' } });
  await lifecycle.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  const beforeLifecycle = await lifecycle.evaluate(() => ({
    examSubscriptions: window.__mockState.subscriptions.filter((item) => item.config.table === 'exam_settings').length,
    activeIntervals: window.__mockState.intervals.filter((item) => item.active).length
  }));
  if (beforeLifecycle.examSubscriptions !== 1) throw new Error(`Expected one exam_settings subscription, got ${beforeLifecycle.examSubscriptions}`);
  await lifecycle.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const afterEvents = await lifecycle.evaluate(() => ({
    examSubscriptions: window.__mockState.subscriptions.filter((item) => item.config.table === 'exam_settings').length,
    activeIntervals: window.__mockState.intervals.filter((item) => item.active).length
  }));
  if (afterEvents.examSubscriptions !== beforeLifecycle.examSubscriptions) throw new Error('Focus/online/visibility created exam subscriptions');
  if (afterEvents.activeIntervals !== beforeLifecycle.activeIntervals) throw new Error('Focus/online/visibility created polling timers');
  const afterStop = await lifecycle.evaluate(async () => {
    const module = await import('/assets/js/services/exam-settings-sync.js');
    module.stopExamSettingsSync();
    return {
      removeChannelCount: window.__mockState.removeChannelCount || 0,
      activeIntervals: window.__mockState.intervals.filter((item) => item.active).length
    };
  });
  if (afterStop.removeChannelCount < 1) throw new Error('Exam settings cleanup did not remove channel');
  if (afterStop.activeIntervals !== beforeLifecycle.activeIntervals - 1) throw new Error('Exam settings cleanup did not clear one polling timer');
  await lifecycle.close();

  const polling = await browser.newPage();
  await installSupabaseMock(polling, { statuses: { light: 'verification', heavy: 'verification' } });
  await polling.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  await polling.evaluate(async () => {
    const module = await import('/assets/js/services/exam-settings-sync.js');
    module.stopExamSettingsSync();
    window.__mockState.statuses.light = 'online';
    module.startExamSettingsSync({ pollIntervalMs: 50 });
  });
  await polling.waitForSelector('button[data-exam-card][data-exam-id="light"]');
  await polling.close();
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

async function verifyAdminExamReturn(browser) {
  for (const [examKey, expectedSeries] of [['light', 'B1'], ['heavy', 'C1']]) {
    const page = await browser.newPage();
    await installSupabaseMock(page, {
      role: 'admin',
      statuses: { light: 'verification', heavy: 'offline' },
      profiles: []
    });
    await page.goto(`${adminUrl}?view=exams`, { waitUntil: 'domcontentloaded' });
    await expectText(page, 'body', 'Gestion des examens');
    await page.locator(`[data-open-exam-preview="${examKey}"]`).click();
    await page.waitForURL(new RegExp(`#\\/exam\\/${examKey}`));
    await expectText(page, 'body', expectedSeries);
    await page.getByRole('button', { name: '← Retour' }).click();
    await page.waitForURL(/admin\.html/);
    await expectText(page, 'body', 'Gestion des examens');
    const origin = await page.evaluate(() => sessionStorage.getItem('examNavigationOrigin'));
    if (origin) throw new Error('Admin exam return origin was not cleaned');
    await page.close();
  }

  const reload = await browser.newPage();
  await installSupabaseMock(reload, {
    role: 'admin',
    statuses: { light: 'verification', heavy: 'verification' },
    profiles: []
  });
  await reload.goto(`${adminUrl}?view=exams`, { waitUntil: 'domcontentloaded' });
  await reload.locator('[data-open-exam-preview="light"]').click();
  await reload.waitForURL(/#\/exam\/light/);
  await reload.reload({ waitUntil: 'domcontentloaded' });
  await reload.getByRole('button', { name: '← Retour' }).click();
  await reload.waitForURL(/admin\.html/);
  await expectText(reload, 'body', 'Gestion des examens');
  await reload.close();

  const dashboard = await browser.newPage();
  await installSupabaseMock(dashboard, {
    role: 'admin',
    statuses: { light: 'verification', heavy: 'verification' },
    profiles: []
  });
  await dashboard.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  await expectText(dashboard, 'body', 'Tableau de bord');
  await dashboard.locator('[data-open-exam="light"]').click();
  await dashboard.waitForURL(/#\/exam\/light/);
  await dashboard.getByRole('button', { name: '← Retour' }).click();
  await dashboard.waitForURL(/admin\.html/);
  await expectText(dashboard, 'body', 'Gestion des examens');
  await dashboard.close();
}

async function verifyStudentExamReturn(browser) {
  const page = await browser.newPage();
  await installSupabaseMock(page, { statuses: { light: 'online', heavy: 'verification' } });
  await page.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  await page.locator('button[data-exam-card][data-exam-id="light"]').click();
  await page.waitForURL(/#\/exam\/light/);
  await page.locator('[data-exam-back]').click();
  await page.waitForURL(/#\/home/);
  await expectText(page, 'body', 'Bonjour');
  await page.close();

  const stale = await browser.newPage();
  await installSupabaseMock(stale, { statuses: { light: 'online', heavy: 'verification' } });
  await stale.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  await stale.evaluate(() => {
    sessionStorage.setItem('examNavigationOrigin', 'admin');
    sessionStorage.setItem('examAdminReturnSection', 'exams');
  });
  await stale.reload({ waitUntil: 'domcontentloaded' });
  const origin = await stale.evaluate(() => sessionStorage.getItem('examNavigationOrigin'));
  if (origin) throw new Error('Non-admin did not clear stale admin exam origin');
  await stale.goto(`${indexUrl}#/exam/light`, { waitUntil: 'domcontentloaded' });
  await stale.locator('[data-exam-back]').click();
  await stale.waitForURL(/#\/home/);
  await stale.close();
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
    window.__triggerTable('runtime_settings', {
      id: 'global',
      maintenance_enabled: true,
      maintenance_message: 'Maintenance test'
    });
  });
  await page.waitForURL(/auth\.html\?maintenance=1/);
  await expectText(page, 'body', 'Maintenance test');
  const progress = await page.evaluate(() => localStorage.getItem('eautoecole.learningProgress'));
  if (progress !== '{"kept":true}') throw new Error('Maintenance logout removed local progress');
  const logoutCount = await page.evaluate(() => Number(sessionStorage.getItem('mock_logout_count') || 0));
  if (logoutCount < 1) throw new Error('Maintenance did not sign out Supabase session');
  await page.close();

  const fallback = await browser.newPage();
  await installSupabaseMock(fallback, {
    statuses: { light: 'online', heavy: 'online' },
    maintenance: { enabled: false, message: 'Maintenance fallback' }
  });
  await fallback.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  const runtimeSubscriptions = await fallback.evaluate(() => window.__mockState.subscriptions.filter((item) => item.config.table === 'runtime_settings').length);
  if (runtimeSubscriptions !== 1) throw new Error(`Expected one runtime_settings subscription, got ${runtimeSubscriptions}`);
  await fallback.evaluate(() => {
    window.__mockState.maintenance.enabled = true;
    window.__mockState.maintenance.message = 'Maintenance fallback';
    window.dispatchEvent(new Event('focus'));
  });
  await fallback.waitForURL(/auth\.html\?maintenance=1/);
  await expectText(fallback, 'body', 'Maintenance fallback');
  await fallback.close();

  const polling = await browser.newPage();
  await installSupabaseMock(polling, {
    statuses: { light: 'online', heavy: 'online' },
    maintenance: { enabled: false, message: 'Maintenance polling' }
  });
  await polling.goto(`${indexUrl}#/home`, { waitUntil: 'domcontentloaded' });
  await polling.evaluate(async () => {
    const module = await import('/assets/js/services/maintenance-guard.js');
    module.stopMaintenanceGuard();
    window.__mockState.maintenance.enabled = true;
    window.__mockState.maintenance.message = 'Maintenance polling';
    module.startMaintenanceGuard({
      user: { isAdmin: false },
      pollIntervalMs: 50
    });
  });
  await polling.waitForURL(/auth\.html\?maintenance=1/);
  await expectText(polling, 'body', 'Maintenance polling');
  await polling.close();

  const admin = await browser.newPage();
  await installSupabaseMock(admin, {
    role: 'admin',
    maintenance: { enabled: true, message: 'Maintenance test' }
  });
  await admin.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  await expectText(admin, 'body', 'Tableau de bord');
  await admin.close();
}

async function verifyLoginDuringMaintenance(browser) {
  const student = await browser.newPage();
  await installSupabaseMock(student, {
    maintenance: { enabled: true, message: 'Maintenance login test' }
  });
  await student.goto(`${baseUrl}/auth.html`, { waitUntil: 'domcontentloaded' });
  const maintenanceDom = await student.evaluate(() => document.documentElement.outerHTML);
  for (const forbidden of ['rah@admin', '762572877@siterah.sn']) {
    if (maintenanceDom.includes(forbidden)) throw new Error(`Maintenance auth DOM exposes ${forbidden}`);
  }
  const adminFieldPresentation = await student.evaluate(() => {
    const label = document.querySelector('label[for="loginIdentifier"]')?.textContent || '';
    const placeholder = document.getElementById('loginIdentifier')?.getAttribute('placeholder') || '';
    return `${label} ${placeholder}`;
  });
  if (adminFieldPresentation.includes('+221')) throw new Error('Maintenance admin login field displays +221');
  await student.locator('#loginIdentifier').fill('77 000 00 00');
  await student.locator('#loginPassword').fill('secret12');
  await student.locator('[data-login-form]').evaluate((form) => form.requestSubmit());
  await expectText(student, '[data-auth-alert]', 'Maintenance login test');
  if (student.url().includes('index.html')) throw new Error('Student entered app during maintenance login');
  const logoutCount = await student.evaluate(() => Number(sessionStorage.getItem('mock_logout_count') || 0));
  if (logoutCount < 1) throw new Error('Student login during maintenance did not sign out session');
  await student.close();

  const admin = await browser.newPage();
  await installSupabaseMock(admin, {
    role: 'admin',
    maintenance: { enabled: true, message: 'Maintenance login test' }
  });
  await admin.goto(`${baseUrl}/auth.html`, { waitUntil: 'domcontentloaded' });
  await admin.locator('#loginIdentifier').fill('rah@admin');
  await admin.locator('#loginPassword').fill('secret12');
  await admin.locator('[data-login-form]').evaluate((form) => form.requestSubmit());
  await admin.waitForURL(/admin\.html/);
  await expectText(admin, 'body', 'Tableau de bord');
  const adminSessionUser = await admin.evaluate(async () => (await window.sbGetSession())?.user?.id);
  if (adminSessionUser !== 'admin-user') throw new Error(`Admin session not persisted after login: ${adminSessionUser}`);
  await admin.locator('[data-maintenance-enabled]').uncheck();
  await admin.getByRole('button', { name: 'Désactiver la maintenance' }).click();
  await expectText(admin, '#modal-root', 'Remettre le site en ligne ?');
  await admin.locator('#modal-root').getByRole('button', { name: 'Remettre en ligne' }).click();
  await expectText(admin, '#toast-root', 'Site remis en ligne.');
  const adminState = await admin.evaluate(async () => ({
    sessionUser: (await window.sbGetSession())?.user?.id,
    logoutCount: window.__mockState.logoutCount,
    runtimeUpdateCount: window.__mockState.runtimeUpdateCount
  }));
  if (adminState.sessionUser !== 'admin-user') throw new Error('Admin session lost after maintenance mutation');
  if (adminState.logoutCount !== 0) throw new Error(`Admin was signed out during maintenance: ${adminState.logoutCount}`);
  if (adminState.runtimeUpdateCount !== 1) throw new Error(`Maintenance mutation count mismatch: ${adminState.runtimeUpdateCount}`);
  await admin.close();

  const normal = await browser.newPage();
  await installSupabaseMock(normal, {
    maintenance: { enabled: false, message: 'Maintenance login test' }
  });
  await normal.goto(`${baseUrl}/auth.html`, { waitUntil: 'domcontentloaded' });
  await normal.locator('#loginIdentifier').fill('77 000 00 00');
  await normal.locator('#loginPassword').fill('secret12');
  await normal.locator('[data-login-form]').evaluate((form) => form.requestSubmit());
  await normal.waitForURL(/index\.html/);
  await normal.close();
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
  await expectText(page, 'body', 'Mode maintenance');
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
  const statusUpdateCount = await page.evaluate(() => window.__mockState.statusUpdateCount);
  if (statusUpdateCount !== 1) throw new Error(`Expected one exam status update, got ${statusUpdateCount}`);
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
  await page.locator('[data-maintenance-enabled]').check();
  await page.getByRole('button', { name: 'Activer la maintenance' }).click();
  await expectText(page, '#modal-root', 'Activer le mode maintenance ?');
  await page.locator('#modal-root').getByRole('button', { name: 'Activer la maintenance', exact: true }).click();
  await expectText(page, '#toast-root', 'Maintenance activée.');
  await expectText(page, 'body', 'Maintenance active');
  await page.locator('[data-maintenance-enabled]').uncheck();
  await page.getByRole('button', { name: 'Désactiver la maintenance' }).click();
  await expectText(page, '#modal-root', 'Remettre le site en ligne ?');
  await page.locator('#modal-root').getByRole('button', { name: 'Remettre en ligne' }).click();
  await expectText(page, '#toast-root', 'Site remis en ligne.');
  await page.close();
}

async function verifyResponsive(browser) {
  const viewports = [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
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
    await verifyExamSettingsLive(browser);
    await verifyAdminQuestionLink(browser);
    await verifyAdminExamReturn(browser);
    await verifyStudentExamReturn(browser);
    await verifyMaintenance(browser);
    await verifyLoginDuringMaintenance(browser);
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
