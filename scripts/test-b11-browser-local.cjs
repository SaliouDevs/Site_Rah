const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = process.cwd();
const productionHost = 'mhoxpqskssbxuuyzjsqx.supabase.co';
const adminPhone = '762572877';
const studentPhone = '770000001';
const password = 'Local-B11-Test-123!';
const results = {};

function getSupabaseConfig() {
  const raw = execSync('npx supabase status -o json', { cwd: root, encoding: 'utf8' });
  const config = JSON.parse(raw);
  if (config.API_URL !== 'http://127.0.0.1:54321') {
    throw new Error(`Supabase local API_URL expected, got ${config.API_URL}`);
  }
  return {
    url: config.API_URL,
    anonKey: config.ANON_KEY,
    serviceKey: config.SERVICE_ROLE_KEY || config.SECRET_KEY
  };
}

function sqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function findLocalAuthUserId(email) {
  const sql = `select id from auth.users where email = '${sqlLiteral(email)}' limit 1;`;
  return execSync(`docker exec supabase_db_Testrah psql -U postgres -d postgres -t -A -c "${sql}"`, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  }).trim();
}

function execLocalSql(sql) {
  execSync(`docker exec supabase_db_Testrah psql -U postgres -d postgres -c "${sql.replace(/"/g, '\\"')}"`, {
    cwd: root,
    stdio: 'pipe'
  });
}

function queryLocalSql(sql) {
  return execSync(`docker exec supabase_db_Testrah psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  }).trim();
}

function ensureLocalProfilesSchema() {
  execLocalSql("create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, prenom text not null default 'Eleve', telephone text unique not null, formule text not null default 'Formule Illimitee', prix integer not null default 2000, status text not null default 'pending' check (status in ('pending', 'active', 'blocked')), photo_url text, created_at timestamptz not null default now());");
  execLocalSql('alter table public.profiles enable row level security;');
  execLocalSql('drop policy if exists "select_own_or_admin" on public.profiles;');
  execLocalSql("create policy \"select_own_or_admin\" on public.profiles for select to authenticated using ((select auth.uid()) = id or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');");
  execLocalSql('drop policy if exists "update_own_profile" on public.profiles;');
  execLocalSql('create policy "update_own_profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);');
  execLocalSql('revoke update on public.profiles from authenticated;');
  execLocalSql('grant select on public.profiles to authenticated;');
  execLocalSql('grant update (prenom, photo_url) on public.profiles to authenticated;');
  execLocalSql('grant select, insert, update, delete on public.profiles to service_role;');
  execLocalSql("create or replace function public.admin_update_status(target_user_id uuid, new_status text) returns json language plpgsql security definer set search_path = public as $$ declare result json; begin if (select auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin' then raise exception 'Acces refuse'; end if; if new_status not in ('pending', 'active', 'blocked') then raise exception 'Statut invalide'; end if; update public.profiles set status = new_status where id = target_user_id returning row_to_json(profiles.*) into result; return result; end; $$;");
  execLocalSql('revoke execute on function public.admin_update_status(uuid, text) from public;');
  execLocalSql('grant execute on function public.admin_update_status(uuid, text) to authenticated;');
  execLocalSql("notify pgrst, 'reload schema';");
}

async function localFetch(config, pathName, options = {}) {
  const headers = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(`${config.url}${pathName}`, { ...options, headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { res, text, json };
}

async function deleteUserIfExists(config, email) {
  const listed = await localFetch(config, '/auth/v1/admin/users');
  const users = listed.json?.users || listed.json || [];
  const user = users.find((item) => item.email === email);
  if (user?.id) {
    await localFetch(config, `/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  }
}

async function createUser(config, { phone, role, prenom }) {
  const email = `${phone}@siterah.sn`;
  const existingId = findLocalAuthUserId(email);
  const payload = {
      email,
      password,
      email_confirm: true,
      app_metadata: role ? { role } : {},
      user_metadata: {
        prenom,
        telephone: phone,
        formule: 'Formule Illimitee',
        prix: 2000
      }
    };
  const created = existingId
    ? await localFetch(config, `/auth/v1/admin/users/${existingId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    })
    : await localFetch(config, '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  if (!created.res.ok) {
    throw new Error(`Upsert auth user failed ${created.res.status}: ${created.text}`);
  }
  await localFetch(config, '/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      id: created.json.id,
      status: 'active',
      prenom,
      telephone: phone,
      formule: 'Formule Illimitee',
      prix: 2000
    })
  });
  await localFetch(config, `/rest/v1/profiles?id=eq.${created.json.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'active', prenom, telephone: phone })
  });
  return created.json;
}

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

async function installNetworkGuard(page) {
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes(productionHost)) {
      throw new Error(`Production Supabase request blocked: ${url}`);
    }
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function expectText(page, selector, text) {
  await page.waitForFunction(
    ({ selector: targetSelector, text: expectedText }) => {
      const node = document.querySelector(targetSelector);
      return Boolean(node?.textContent?.includes(expectedText));
    },
    { selector, text },
    { timeout: 15000 }
  );
  const value = await page.locator(selector).first().textContent({ timeout: 15000 });
  if (!value || !value.includes(text)) {
    throw new Error(`${selector} missing "${text}". Actual: ${value}`);
  }
}

async function clickUnique(page, selector) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) throw new Error(`${selector} expected 1, got ${count}`);
  await locator.click();
}

async function login(page, baseUrl, identifier) {
  await page.goto(`${baseUrl}/auth.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginIdentifier').fill(identifier);
  await page.locator('#loginPassword').fill(password);
  await page.locator('[data-login-form]').evaluate((form) => form.requestSubmit());
}

async function openAdminCmsQuestion(page, baseUrl, examKey, legacyId) {
  await page.goto(`${baseUrl}/admin.html`, { waitUntil: 'domcontentloaded' });
  await clickUnique(page, '[data-admin-view="exams"]');
  await page.waitForSelector('[data-exam-tab="light"]', { timeout: 15000 });
  if (examKey === 'heavy') {
    await clickUnique(page, '[data-exam-tab="heavy"]');
  }
  await page.waitForSelector('[data-cms-question-search]', { timeout: 20000 });
  await page.locator('[data-cms-question-search]').fill(legacyId);
  await clickUnique(page, `.q-link[title="${legacyId}"]`);
  await expectText(page, 'body', `Édition question: ${legacyId}`);
}

async function getCurrentQuestionText(config, legacyId, token) {
  const headers = token
    ? { Authorization: `Bearer ${token}`, apikey: config.anonKey }
    : { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey };
  const q = await fetch(`${config.url}/rest/v1/exam_questions?legacy_id=eq.${legacyId}&select=id,current_version_id`, { headers });
  const [question] = await q.json();
  const v = await fetch(`${config.url}/rest/v1/exam_question_versions?id=eq.${question.current_version_id}&select=id,question_text,status`, { headers });
  const [version] = await v.json();
  return { question, version };
}

async function setExamStatus(config, examKey, status) {
  const sql = `update public.exam_settings set status = '${sqlLiteral(status)}' where exam_key = '${sqlLiteral(examKey)}';`;
  execLocalSql(sql);
}

async function testAdminWorkflow(browser, page, config, baseUrl) {
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });

  await login(page, baseUrl, 'rah@admin');
  await page.waitForURL(/admin\.html/, { timeout: 15000 });
  results.adminLogin = true;
  await expectText(page, 'body', 'Tableau de bord');
  await clickUnique(page, '[data-admin-view="exams"]');
  await expectText(page, 'body', 'Disponible aux élèves');
  results.existingExamPanel = true;

  await openAdminCmsQuestion(page, baseUrl, 'light', 'PL-001');
  results.cmsLoaded = true;
  const before = await getCurrentQuestionText(config, 'PL-001');
  results.pl001BeforeText = before.version.question_text;

  if (await page.locator('[data-create-draft]').count()) {
    await clickUnique(page, '[data-create-draft]');
  }
  await page.waitForSelector('.draft-form', { timeout: 15000 });
  results.createDraft = true;
  const newText = `PL-001 E2E local ${Date.now()}`;
  await page.locator('.draft-form .question-text').fill(newText);
  await clickUnique(page, '[data-save-draft]');
  await page.waitForFunction(() => !document.querySelector('[data-save-draft]')?.disabled, null, { timeout: 15000 });
  results.save = true;

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openAdminCmsQuestion(page, baseUrl, 'light', 'PL-001');
  await expectText(page, '.draft-panel', newText);
  results.reloadDraft = true;
  await clickUnique(page, '[data-preview-draft]');
  await expectText(page, '.preview-modal', newText);
  results.preview = true;
  await clickUnique(page, '[data-close-preview]');
  const stillBefore = await getCurrentQuestionText(config, 'PL-001');
  if (stillBefore.version.question_text !== before.version.question_text) {
    throw new Error('Published changed before publish');
  }
  await setExamStatus(config, 'light', 'online');
  const studentBefore = await browser.newPage();
  const studentBeforeErrors = await installNetworkGuard(studentBefore);
  await login(studentBefore, baseUrl, studentPhone);
  await studentBefore.waitForURL(/index\.html/, { timeout: 15000 });
  await studentBefore.goto(`${baseUrl}/index.html?b11=${Date.now()}#/exam/light/series/B1`, { waitUntil: 'domcontentloaded' });
  await expectText(studentBefore, 'body', before.version.question_text);
  const leakedDraftBeforePublish = await studentBefore.locator('body').textContent();
  if (leakedDraftBeforePublish.includes(newText)) throw new Error('Student saw draft before publish');
  if (studentBeforeErrors.filter((entry) => !entry.includes('Failed to load resource')).length) {
    throw new Error(`Student-before console errors: ${studentBeforeErrors.join(' | ')}`);
  }
  await studentBefore.close();
  results.studentBeforePublish = true;

  await clickUnique(page, '[data-publish-draft]');
  await page.waitForTimeout(900);
  const after = await getCurrentQuestionText(config, 'PL-001');
  if (after.version.question_text !== newText) throw new Error('Published text did not switch to draft');
  results.publish = true;
  await expectText(page, '.history-panel', 'V');
  results.history = true;

  await page.locator('[data-restore-version]').first().click();
  await page.waitForTimeout(900);
  const afterRestore = await getCurrentQuestionText(config, 'PL-001');
  if (afterRestore.version.question_text !== newText) throw new Error('Restore changed current publication');
  results.restore = true;

  await openAdminCmsQuestion(page, baseUrl, 'heavy', 'PLD-027');
  if (await page.locator('[data-create-draft]').count()) {
    await clickUnique(page, '[data-create-draft]');
    await page.waitForSelector('.draft-form', { timeout: 15000 });
  }
  const correctChoices = await page.locator('.draft-panel .choice-item:has(.is-correct:checked)').count();
  const totalChoices = await page.locator('.draft-panel .choice-item').count();
  if (totalChoices !== 4 || correctChoices !== 3) throw new Error(`PLD-027 choices mismatch: ${correctChoices}/${totalChoices}`);
  results.pld027 = true;

  return newText;
}

async function testStudent(page, config, baseUrl, expectedText) {
  await setExamStatus(config, 'light', 'online');
  await login(page, baseUrl, studentPhone);
  await page.waitForURL(/index\.html/, { timeout: 15000 });
  await page.goto(`${baseUrl}/index.html#/exam/light/series/B1`, { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', expectedText);
  results.studentAfterPublish = true;
  const accessToken = await page.evaluate(async () => {
    const session = await window.sbGetSession();
    return session?.access_token || '';
  });
  const directDraft = await fetch(`${config.url}/rest/v1/exam_question_versions?status=eq.draft&select=id,question_text`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`
    }
  }).catch(() => null);
  const drafts = directDraft ? await directDraft.json() : [];
  results.draftInvisibleStudent = Array.isArray(drafts) && drafts.length === 0;
  if (!results.draftInvisibleStudent) throw new Error(`Student can see drafts: ${JSON.stringify(drafts)}`);
}

async function testSettingsAndFallback(page, config, baseUrl, adminUser) {
  const examUrl = (route) => `${baseUrl}/index.html?b11=${Date.now()}${route}`;
  await setExamStatus(config, 'light', 'online');
  await page.goto(examUrl('#/exam/light'), { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'B1');
  results.online = true;
  await setExamStatus(config, 'light', 'verification');
  await page.goto(examUrl('#/exam/light'), { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'vérification');
  results.verification = true;
  await setExamStatus(config, 'light', 'offline');
  await page.goto(examUrl('#/exam/light'), { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'hors ligne');
  results.offline = true;
  await setExamStatus(config, 'light', 'online');

  execLocalSql(`delete from public.exam_question_images where question_id = 'PL-001';`);
  execLocalSql(`insert into public.exam_question_images (question_id, exam_key, series_id, storage_path, updated_by) values ('PL-001', 'light', 'B1', 'light/PL-001/e2e-override.webp', '${sqlLiteral(adminUser.id)}') on conflict (question_id) do update set exam_key = excluded.exam_key, series_id = excluded.series_id, storage_path = excluded.storage_path, updated_by = excluded.updated_by;`);
  const storedOverride = queryLocalSql("select storage_path from public.exam_question_images where question_id = 'PL-001';");
  if (!storedOverride.includes('e2e-override.webp')) {
    throw new Error(`Image override SQL insert missing: ${storedOverride}`);
  }
  await page.goto(examUrl('#/exam/light/series/B1?question=PL-001'), { waitUntil: 'domcontentloaded' });
  const visibleOverrides = await page.evaluate(async () => {
    const session = await window.sbGetSession();
    const { data, error } = await window.sb
      .from('exam_question_images')
      .select('question_id,exam_key,series_id,storage_path')
      .eq('question_id', 'PL-001');
    return { data, error: error?.message || null, user: session?.user?.id || null };
  });
  if (visibleOverrides.error || !visibleOverrides.data?.length) {
    throw new Error(`Student cannot read image override: ${JSON.stringify(visibleOverrides)}`);
  }
  const imageSrc = await page.locator('.exam-question-image').getAttribute('src', { timeout: 15000 });
  if (!imageSrc || !imageSrc.includes('e2e-override.webp')) throw new Error(`Image override not visible: ${imageSrc}`);
  results.imageOverride = true;

  const lightCurrentVersion = queryLocalSql("select current_version_id from public.exam_questions where legacy_id = 'PL-001';");
  try {
    execLocalSql("update public.exam_questions set current_version_id = null where legacy_id = 'PL-001';");
    await page.goto(examUrl('#/exam/light/series/B1'), { waitUntil: 'domcontentloaded' });
    await expectText(page, 'body', 'Pour aller tout droit,');
  } finally {
    if (lightCurrentVersion) {
      execLocalSql(`update public.exam_questions set current_version_id = '${sqlLiteral(lightCurrentVersion)}' where legacy_id = 'PL-001';`);
    }
  }

  await setExamStatus(config, 'heavy', 'online');
  await page.goto(examUrl('#/exam/heavy'), { waitUntil: 'domcontentloaded' });
  await expectText(page, 'body', 'C1');
  results.fallback = true;
}

(async () => {
  const config = getSupabaseConfig();
  ensureLocalProfilesSchema();
  const adminUser = await createUser(config, { phone: adminPhone, role: 'admin', prenom: 'Admin B11' });
  await createUser(config, { phone: studentPhone, role: null, prenom: 'Student B11' });
  const server = await startStaticServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = await installNetworkGuard(page);
  try {
    await page.goto(`${baseUrl}/auth.html`, { waitUntil: 'domcontentloaded' });
    const endpoint = await page.evaluate(() => window.sb?.supabaseUrl);
    if (endpoint !== 'http://127.0.0.1:54321') throw new Error(`Frontend endpoint mismatch: ${endpoint}`);
    results.endpoint = endpoint;
    const newText = await testAdminWorkflow(browser, page, config, baseUrl);
    const student = await browser.newPage();
    const studentErrors = await installNetworkGuard(student);
    await testStudent(student, config, baseUrl, newText);
    await testSettingsAndFallback(student, config, baseUrl, adminUser);
    results.consoleErrors = [...consoleErrors, ...studentErrors].filter((entry) => !entry.includes('Failed to load resource'));
    if (results.consoleErrors.length) throw new Error(`Console errors: ${results.consoleErrors.join(' | ')}`);
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
