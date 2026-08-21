#!/usr/bin/env node

const { execSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

function getConfig() {
  const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
  const url = status.API_URL || status.API?.endpoint;
  if (!url || (!url.includes('127.0.0.1') && !url.includes('localhost'))) {
    throw new Error(`Refusing non-local Supabase URL: ${url}`);
  }
  return {
    url,
    anonKey: status.ANON_KEY || status.API?.apikey || status.PUBLISHABLE_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY || status.SECRET_KEY,
    jwtSecret: status.JWT_SECRET
  };
}

function jwt(userId, role, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated',
    sub: userId,
    role: 'authenticated',
    email: `${role || 'student'}@local.test`,
    app_metadata: role ? { role } : {},
    user_metadata: {},
    iat: now,
    exp: now + 3600
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function req(config, { path, method = 'GET', body, token, prefer = 'return=representation' }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.url);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${token || config.serviceRoleKey}`,
        'content-type': 'application/json',
        prefer
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: res.statusCode, raw, json, headers: res.headers });
      });
    });
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

async function allRows(config, table, query = '', token) {
  const res = await req(config, { path: `/rest/v1/${table}?select=*${query}`, token });
  if (res.status >= 400) throw new Error(`${table} failed ${res.status}: ${res.raw}`);
  return res.json || [];
}

async function rpc(config, name, body, token) {
  return req(config, { path: `/rest/v1/rpc/${name}`, method: 'POST', body, token });
}

function authReq(config, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('/auth/v1/admin/users', config.url);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        'content-type': 'application/json'
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: res.statusCode, raw, json });
      });
    });
    request.on('error', reject);
    request.write(JSON.stringify(body));
    request.end();
  });
}

async function createLocalUser(config, role) {
  const token = crypto.randomBytes(4).toString('hex');
  const res = await authReq(config, {
    email: `${role || 'student'}-${token}@local.test`,
    password: `Local-${token}-password`,
    email_confirm: true,
    app_metadata: role ? { role } : {},
    user_metadata: {
      prenom: role === 'admin' ? 'Admin B1' : 'Student B1',
      telephone: `98${Date.now().toString().slice(-7)}`,
      formule: 'Formule Illimitee',
      prix: 2000
    }
  });
  if (res.status >= 400) throw new Error(`Auth user create failed ${res.status}: ${res.raw}`);
  return res.json.id;
}

function ok(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

(async () => {
  const config = getConfig();
  if (process.argv.includes('--check-pl001-v2')) {
    const questions = await allRows(config, 'exam_questions', '&legacy_id=eq.PL-001');
    const question = questions[0];
    const current = await allRows(config, 'exam_question_versions', `&id=eq.${question.current_version_id}`);
    const history = await allRows(config, 'exam_question_versions', `&question_id=eq.${question.id}`);
    ok('PL-001 current remains admin V2 after import rerun', current[0]?.question_text === 'PL-001 Phase B1 V2 draft', current[0]?.question_text);
    ok('PL-001 history intact', history.length >= 3, String(history.length));
    return;
  }

  const adminId = await createLocalUser(config, 'admin');
  const studentId = await createLocalUser(config, null);
  const adminToken = jwt(adminId, 'admin', config.jwtSecret);
  const studentToken = jwt(studentId, null, config.jwtSecret);

  const [series, questions, versions, choices] = await Promise.all([
    allRows(config, 'exam_series'),
    allRows(config, 'exam_questions'),
    allRows(config, 'exam_question_versions'),
    allRows(config, 'exam_question_choices')
  ]);
  for (const examKey of ['light', 'heavy']) {
    const s = series.filter((row) => row.exam_key === examKey);
    const q = questions.filter((row) => row.exam_key === examKey);
    const vIds = new Set(q.map((row) => row.current_version_id).filter(Boolean));
    const c = choices.filter((choice) => vIds.has(choice.question_version_id));
    ok(`${examKey} series/current`, s.length === (examKey === 'light' ? 12 : 5) && s.every((row) => row.current_version_id), `${s.length}/${s.filter((row) => row.current_version_id).length}`);
    ok(`${examKey} questions/current`, q.length === (examKey === 'light' ? 300 : 50) && q.every((row) => row.current_version_id), `${q.length}/${q.filter((row) => row.current_version_id).length}`);
    ok(`${examKey} choices`, c.length === (examKey === 'light' ? 834 : 120), String(c.length));
  }

  const spoofId = '00000000-0000-0000-0000-000000000123';
  const spoofInsert = await req(config, {
    path: '/rest/v1/exam_series',
    method: 'POST',
    token: adminToken,
    body: { exam_key: 'light', code: `RLS-SPOOF-${Date.now()}`, updated_by: spoofId }
  }, adminToken);
  ok('admin spoof insert accepted for trigger test', spoofInsert.status === 201, String(spoofInsert.status));
  if (spoofInsert.status === 201) {
    ok('updated_by overwritten with auth.uid()', spoofInsert.json?.[0]?.updated_by === adminId, spoofInsert.json?.[0]?.updated_by);
    await req(config, {
      path: `/rest/v1/exam_series?id=eq.${spoofInsert.json[0].id}`,
      method: 'DELETE',
      token: adminToken,
      prefer: 'return=minimal'
    });
  }

  const pl001 = questions.find((row) => row.legacy_id === 'PL-001');
  const pl002 = questions.find((row) => row.legacy_id === 'PL-002');
  const initialCurrent = pl001.current_version_id;
  const createDrafts = await Promise.all([
    rpc(config, 'create_exam_question_draft', { p_question_id: pl001.id }, adminToken),
    rpc(config, 'create_exam_question_draft', { p_question_id: pl001.id }, adminToken)
  ]);
  ok('PL-001 found for workflow', Boolean(pl001?.id), pl001?.id || 'missing');
  ok('concurrent createDraft calls accepted/idempotent', createDrafts.every((res) => res.status === 200), createDrafts.map((res) => `${res.status}:${res.raw}`).join(' | '));
  const drafts = (await allRows(config, 'exam_question_versions', `&question_id=eq.${pl001.id}&status=eq.draft`, adminToken));
  ok('single active draft after concurrency', drafts.length === 1, String(drafts.length));
  const draft = drafts[0];

  const originalDraftText = draft.question_text;
  const originalDraftChoices = await allRows(config, 'exam_question_choices', `&question_version_id=eq.${draft.id}`, adminToken);
  const badSaveRes = await rpc(config, 'save_exam_question_draft', {
    p_question_id: pl001.id,
    p_version_id: draft.id,
    p_question_text: 'SHOULD ROLLBACK',
    p_explanation: draft.explanation || null,
    p_image_path: draft.image_path || null,
    p_metadata: { ...(draft.metadata || {}), optionType: 'type3' },
    p_choices: [
      { choice_key: 'A', label: 'dup 1', is_correct: true, sort_order: 1 },
      { choice_key: 'A', label: 'dup 2', is_correct: false, sort_order: 2 }
    ]
  }, adminToken);
  ok('atomic save rejects invalid duplicate choices', badSaveRes.status >= 400, String(badSaveRes.status));
  const afterBadDraft = (await allRows(config, 'exam_question_versions', `&id=eq.${draft.id}`, adminToken))[0];
  const afterBadChoices = await allRows(config, 'exam_question_choices', `&question_version_id=eq.${draft.id}`, adminToken);
  ok('atomic save rollback keeps draft text', afterBadDraft.question_text === originalDraftText, afterBadDraft.question_text);
  ok('atomic save rollback keeps choices', afterBadChoices.length === originalDraftChoices.length, String(afterBadChoices.length));

  const saveRes = await rpc(config, 'save_exam_question_draft', {
    p_question_id: pl001.id,
    p_version_id: draft.id,
    p_question_text: 'PL-001 Phase B1 V2 draft',
    p_explanation: draft.explanation || null,
    p_image_path: draft.image_path || null,
    p_metadata: { ...(draft.metadata || {}), optionType: 'type3' },
    p_choices: originalDraftChoices.map((choice) => ({
      choice_key: choice.choice_key,
      label: choice.label,
      is_correct: choice.is_correct,
      sort_order: choice.sort_order
    }))
  }, adminToken);
  ok('save draft only', saveRes.status === 200, String(saveRes.status));
  const afterSaveMaster = (await allRows(config, 'exam_questions', `&id=eq.${pl001.id}`, adminToken))[0];
  ok('current unchanged while draft saved', afterSaveMaster.current_version_id === initialCurrent, afterSaveMaster.current_version_id);

  const studentDraft = await allRows(config, 'exam_question_versions', `&id=eq.${draft.id}`, studentToken);
  ok('student cannot read draft by UUID', studentDraft.length === 0, String(studentDraft.length));

  const publishRes = await rpc(config, 'publish_exam_question_version', { p_question_id: pl001.id, p_version_id: draft.id }, adminToken);
  ok('admin publish draft', publishRes.status === 200, String(publishRes.status));
  const afterPublishMaster = (await allRows(config, 'exam_questions', `&id=eq.${pl001.id}`, adminToken))[0];
  ok('current switched to V2', afterPublishMaster.current_version_id === draft.id, afterPublishMaster.current_version_id);

  const restored = await rpc(config, 'restore_exam_question_version_as_draft', { p_question_id: pl001.id, p_source_version_id: initialCurrent }, adminToken);
  ok('restore old as draft', restored.status === 200, String(restored.status));
  const afterRestoreMaster = (await allRows(config, 'exam_questions', `&id=eq.${pl001.id}`, adminToken))[0];
  ok('restore leaves current unchanged', afterRestoreMaster.current_version_id === draft.id, afterRestoreMaster.current_version_id);

  const studentCreate = await rpc(config, 'create_exam_question_draft', { p_question_id: pl002.id }, studentToken);
  ok('student create draft refused', studentCreate.status >= 400, String(studentCreate.status));
  const studentPublish = await rpc(config, 'publish_exam_question_version', { p_question_id: pl002.id, p_version_id: pl002.current_version_id }, studentToken);
  ok('student publish refused', studentPublish.status >= 400, String(studentPublish.status));
  const studentRestore = await rpc(config, 'restore_exam_question_version_as_draft', { p_question_id: pl002.id, p_source_version_id: pl002.current_version_id }, studentToken);
  ok('student restore refused', studentRestore.status >= 400, String(studentRestore.status));

  const cross = await rpc(config, 'publish_exam_question_version', { p_question_id: pl002.id, p_version_id: draft.id }, adminToken);
  ok('cross-master publish refused', cross.status >= 400, String(cross.status));

  const studentPublished = await allRows(config, 'exam_question_versions', `&id=eq.${draft.id}`, studentToken);
  ok('student sees published V2 after publish', studentPublished.length === 1, String(studentPublished.length));
})();
