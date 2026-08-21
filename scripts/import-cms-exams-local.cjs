#!/usr/bin/env node

/**
 * Import CMS exam content into LOCAL Supabase.
 *
 * This script:
 * 1. Fetches LOCAL Supabase configuration
 * 2. Generates CMS seed
 * 3. Imports in correct FK order
 * 4. Prevents accidental production import
 * 5. Is idempotent (safe to rerun)
 * 6. Sets current_version_id for initial publication
 * 7. Never stores secrets on disk
 *
 * Usage:
 *   node scripts/import-cms-exams-local.cjs [--force] [--dry-run]
 */

const { execSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const root = process.cwd();

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logSection(title) {
  log(`\n${'='.repeat(70)}`, 'cyan');
  log(title, 'cyan');
  log(`${'='.repeat(70)}\n`, 'cyan');
}

function logError(msg) {
  log(`ERROR: ${msg}`, 'red');
}

/**
 * Safety: Verify LOCAL Supabase only
 */
function getLocalSupabaseConfig() {
  log('Fetching Supabase configuration...', 'yellow');

  try {
    const statusJson = execSync('npx supabase status -o json', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const status = JSON.parse(statusJson);
    const endpoint = status.API?.endpoint || status.API_URL;

    // CRITICAL: Prevent production import
    if (!endpoint) {
      throw new Error('No API endpoint found. Is Supabase running locally?');
    }

    const isLocal = endpoint.includes('localhost') || endpoint.includes('127.0.0.1');
    if (!isLocal) {
      logError('ABORT: Supabase endpoint is NOT local!');
      log(`Endpoint: ${endpoint}`, 'red');
      log('This script only works with LOCAL Supabase.', 'red');
      log('To use remote Supabase, implement proper safeguards.', 'red');
      process.exit(1);
    }

    const serviceRoleKey = status.API?.service_role_key || status.API?.serviceRoleKey || status.API?.service_role || status.SERVICE_ROLE_KEY || status.SECRET_KEY;
    if (!serviceRoleKey) {
      throw new Error('No local service role key found in Supabase CLI status output.');
    }

    const config = {
      url: endpoint,
      anonKey: status.API?.apikey || status.ANON_KEY || status.PUBLISHABLE_KEY,
      serviceRoleKey,
    };

    log(`✓ LOCAL confirmed: ${config.url}`, 'green');

    return config;
  } catch (error) {
    logError(`Failed to fetch Supabase config: ${error.message}`);
    log('Make sure Supabase is running: npx supabase start', 'yellow');
    process.exit(1);
  }
}

/**
 * Load and generate CMS seed
 */
async function loadModule(relativePath) {
  return import(pathToFileURL(path.join(root, relativePath)).href);
}

function genDeterministicId(namespace, name) {
  const hash = crypto.createHash('sha256').update(`${namespace}:${name}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join('-');
}

function buildExamContent(exam, examKey) {
  const masterSeries = [];
  const versionSeries = [];
  const masterQuestions = [];
  const versionQuestions = [];
  const choices = [];

  const seriesIds = {};

  exam.series.forEach((item, index) => {
    const mId = genDeterministicId('exam-series', `${examKey}:${item.id}`);
    const vId = genDeterministicId('exam-series-version', `${examKey}:${item.id}:v1`);
    seriesIds[item.id] = mId;

    masterSeries.push({
      id: mId,
      exam_key: examKey,
      code: item.id,
      current_version_id: null // Will set after version insert
    });

    versionSeries.push({
      id: vId,
      series_id: mId,
      status: 'published',
      version_number: 1,
      title: item.title || item.id,
      sort_order: index + 1
    });
  });

  exam.series.forEach((seriesItem) => {
    const sId = seriesIds[seriesItem.id];
    seriesItem.questions.forEach((question, index) => {
      const qmId = genDeterministicId('exam-question', question.id);
      const qvId = genDeterministicId('exam-question-version', `${question.id}:v1`);

      masterQuestions.push({
        id: qmId,
        legacy_id: question.id,
        exam_key: examKey,
        series_id: sId,
        current_version_id: null // Will set after version insert
      });

      versionQuestions.push({
        id: qvId,
        question_id: qmId,
        status: 'published',
        version_number: 1,
        question_text: question.text || '',
        explanation: question.explanation || null,
        image_path: question.image || null,
        sort_order: index + 1,
        metadata: buildQuestionMetadata(question)
      });

      buildQuestionChoices(question).forEach((choice) => {
        choices.push({
          id: genDeterministicId('exam-choice', `${question.id}:${choice.choice_key}`),
          question_version_id: qvId,
          ...choice
        });
      });
    });
  });

  return { masterSeries, versionSeries, masterQuestions, versionQuestions, choices };
}

function buildQuestionChoices(question) {
  if (question.optionType === 'type3') {
    return [
      {
        choice_key: 'A',
        label: `${question.type3Q1Title || ''} - ${question.type3Q1Text1 || ''}`.trim(),
        is_correct: question.type3CorrectAnswer1 === 'A',
        sort_order: 1
      },
      {
        choice_key: 'B',
        label: `${question.type3Q1Title || ''} - ${question.type3Q1Text2 || ''}`.trim(),
        is_correct: question.type3CorrectAnswer1 === 'B',
        sort_order: 2
      },
      {
        choice_key: 'C',
        label: `${question.type3Q2Title || ''} - ${question.type3Q2Text1 || ''}`.trim(),
        is_correct: question.type3CorrectAnswer2 === 'C',
        sort_order: 3
      },
      {
        choice_key: 'D',
        label: `${question.type3Q2Title || ''} - ${question.type3Q2Text2 || ''}`.trim(),
        is_correct: question.type3CorrectAnswer2 === 'D',
        sort_order: 4
      }
    ].filter((choice) => choice.label);
  }

  if (question.optionType === 'type4') {
    return ['type4Text1', 'type4Text2', 'type4Text3', 'type4Text4']
      .map((field, index) => {
        const key = String.fromCharCode(65 + index);
        return {
          choice_key: key,
          label: question[field] || '',
          is_correct: question.correctAnswer === key,
          sort_order: index + 1
        };
      })
      .filter((choice) => choice.label);
  }

  if (question.optionType === 'type4_multiple') {
    const correctAnswers = new Set(Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer]);
    return ['type4Text1', 'type4Text2', 'type4Text3', 'type4Text4']
      .map((field, index) => {
        const key = String.fromCharCode(65 + index);
        return {
          choice_key: key,
          label: question[field] || '',
          is_correct: correctAnswers.has(key),
          sort_order: index + 1
        };
      })
      .filter((choice) => choice.label);
  }

  return [
    { choice_key: 'A', label: 'OUI', is_correct: question.correctAnswer === 'A', sort_order: 1 },
    { choice_key: 'B', label: 'NON', is_correct: question.correctAnswer === 'B', sort_order: 2 }
  ];
}

function buildQuestionMetadata(question) {
  const metadata = {
    optionType: question.optionType || 'type2',
    legacyId: question.id || null
  };

  if (question.optionType === 'type3') {
    metadata.type3Q1Title = question.type3Q1Title || '';
    metadata.type3Q2Title = question.type3Q2Title || '';
    metadata.type3CorrectAnswer1 = question.type3CorrectAnswer1 || null;
    metadata.type3CorrectAnswer2 = question.type3CorrectAnswer2 || null;
  }

  if (question.optionType === 'type4_multiple') {
    metadata.correctAnswer = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer].filter(Boolean);
  }

  return metadata;
}

/**
 * HTTP request helper
 */
function makeRequest(config, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(options.path || '/', config.url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.authHeader || config.serviceRoleKey}`,
        'apikey': config.anonKey,
        'Prefer': 'return=representation',
        ...options.headers,
      },
    };

    Object.keys(reqOptions.headers).forEach(
      (key) => reqOptions.headers[key] === undefined && delete reqOptions.headers[key]
    );

    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json: (() => { try { return JSON.parse(data); } catch { return null; } })(),
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

/**
 * Upsert records safely (idempotent)
 */
async function upsertRecords(config, table, records, options = {}) {
  if (records.length === 0) return { inserted: 0, error: null };

  const dryRun = options.dryRun;
  const chunkSize = 1000;

  let inserted = 0;

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);

    if (dryRun) {
      log(`[DRY RUN] Would insert ${chunk.length} records into ${table}`, 'yellow');
      inserted += chunk.length;
      continue;
    }

    try {
      const res = await makeRequest(config, {
        path: `/rest/v1/${table}`,
        method: 'POST',
        body: chunk,
        headers: {
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
      });

      if (res.status >= 400) {
        return { inserted, error: `HTTP ${res.status}: ${res.body}` };
      }

      inserted += chunk.length;
    } catch (error) {
      return { inserted, error: error.message };
    }
  }

  return { inserted, error: null };
}

/**
 * Update current_version_id pointers (publication)
 */
async function publishVersions(config, options = {}) {
  const dryRun = options.dryRun;

  if (dryRun) {
    log('[DRY RUN] Would publish all series and question versions', 'yellow');
    return { published: 0, error: null };
  }

  let published = 0;

  // Get all series versions to update master pointers
  try {
    const seriesRes = await makeRequest(config, {
      path: '/rest/v1/exam_series_versions?select=id,series_id,status,version_number&status=eq.published&version_number=eq.1',
      method: 'GET',
    });

    if (seriesRes.status !== 200) {
      return { published: 0, error: `Failed to fetch series versions: ${seriesRes.body}` };
    }

    const versions = seriesRes.json || [];
    const seriesByVersionId = {};
    versions.forEach((v) => {
      seriesByVersionId[v.id] = v.series_id;
    });

    // Update series current_version_id
    for (const [versionId, seriesId] of Object.entries(seriesByVersionId)) {
      const currentRes = await makeRequest(config, {
        path: `/rest/v1/exam_series?id=eq.${seriesId}&select=current_version_id`,
        method: 'GET',
      });

      if (currentRes.status !== 200) {
        return { published, error: `Failed to inspect series pointer: ${currentRes.body}` };
      }

      if (currentRes.json?.[0]?.current_version_id) {
        continue;
      }

      const res = await makeRequest(config, {
        path: `/rest/v1/exam_series?id=eq.${seriesId}`,
        method: 'PATCH',
        body: { current_version_id: versionId },
      });

      if (res.status >= 400) {
        return { published, error: `Failed to update series: ${res.body}` };
      }

      published++;
    }

    // Same for questions
    const qversionsRes = await makeRequest(config, {
      path: '/rest/v1/exam_question_versions?select=id,question_id,status,version_number&status=eq.published&version_number=eq.1',
      method: 'GET',
    });

    if (qversionsRes.status !== 200) {
      return { published, error: `Failed to fetch question versions: ${qversionsRes.body}` };
    }

    const qversions = qversionsRes.json || [];
    const questionsByVersionId = {};
    qversions.forEach((v) => {
      questionsByVersionId[v.id] = v.question_id;
    });

    for (const [versionId, questionId] of Object.entries(questionsByVersionId)) {
      const currentRes = await makeRequest(config, {
        path: `/rest/v1/exam_questions?id=eq.${questionId}&select=current_version_id`,
        method: 'GET',
      });

      if (currentRes.status !== 200) {
        return { published, error: `Failed to inspect question pointer: ${currentRes.body}` };
      }

      if (currentRes.json?.[0]?.current_version_id) {
        continue;
      }

      const res = await makeRequest(config, {
        path: `/rest/v1/exam_questions?id=eq.${questionId}`,
        method: 'PATCH',
        body: { current_version_id: versionId },
      });

      if (res.status >= 400) {
        return { published, error: `Failed to update question: ${res.body}` };
      }

      published++;
    }

    return { published, error: null };
  } catch (error) {
    return { published, error: error.message };
  }
}

/**
 * Main import
 */
(async () => {
  try {
    logSection('CMS Exams Import → LOCAL Supabase');

    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');

    if (isDryRun) {
      log('DRY RUN MODE: No data will be written', 'yellow');
    }

    // Safety: LOCAL only
    const config = getLocalSupabaseConfig();

    // Generate seed
    log('\nGenerating CMS seed from legacy data...', 'yellow');
    const [{ EXAM_LIGHT_DATA }, { EXAM_HEAVY_DATA }] = await Promise.all([
      loadModule('assets/js/data/exam-light-data.js'),
      loadModule('assets/js/data/exam-heavy-data.js'),
    ]);

    const light = buildExamContent(EXAM_LIGHT_DATA, 'light');
    const heavy = buildExamContent(EXAM_HEAVY_DATA, 'heavy');

    log('✓ Seed generated', 'green');
    log(`  Light: ${light.masterSeries.length} series, ${light.masterQuestions.length} Q, ${light.choices.length} choices`, 'cyan');
    log(`  Heavy: ${heavy.masterSeries.length} series, ${heavy.masterQuestions.length} Q, ${heavy.choices.length} choices`, 'cyan');

    // Import in order (respecting FK constraints)
    logSection('IMPORT SEQUENCE');

    // 1. Series masters
    log('1. Inserting exam series masters...', 'yellow');
    const seriesResult = await upsertRecords(config, 'exam_series', [
      ...light.masterSeries,
      ...heavy.masterSeries
    ], { dryRun: isDryRun });

    if (seriesResult.error) {
      logError(`Series insert failed: ${seriesResult.error}`);
      process.exit(1);
    }
    log(`   ✓ ${seriesResult.inserted} series inserted`, 'green');

    // 2. Series versions
    log('2. Inserting exam series versions...', 'yellow');
    const seriesVersionResult = await upsertRecords(config, 'exam_series_versions', [
      ...light.versionSeries,
      ...heavy.versionSeries
    ], { dryRun: isDryRun });

    if (seriesVersionResult.error) {
      logError(`Series version insert failed: ${seriesVersionResult.error}`);
      process.exit(1);
    }
    log(`   ✓ ${seriesVersionResult.inserted} series versions inserted`, 'green');

    // 3. Question masters
    log('3. Inserting exam question masters...', 'yellow');
    const questionResult = await upsertRecords(config, 'exam_questions', [
      ...light.masterQuestions,
      ...heavy.masterQuestions
    ], { dryRun: isDryRun });

    if (questionResult.error) {
      logError(`Question insert failed: ${questionResult.error}`);
      process.exit(1);
    }
    log(`   ✓ ${questionResult.inserted} questions inserted`, 'green');

    // 4. Question versions
    log('4. Inserting exam question versions...', 'yellow');
    const questionVersionResult = await upsertRecords(config, 'exam_question_versions', [
      ...light.versionQuestions,
      ...heavy.versionQuestions
    ], { dryRun: isDryRun });

    if (questionVersionResult.error) {
      logError(`Question version insert failed: ${questionVersionResult.error}`);
      process.exit(1);
    }
    log(`   ✓ ${questionVersionResult.inserted} question versions inserted`, 'green');

    // 5. Choices
    log('5. Inserting choices...', 'yellow');
    const choicesResult = await upsertRecords(config, 'exam_question_choices', [
      ...light.choices,
      ...heavy.choices
    ], { dryRun: isDryRun });

    if (choicesResult.error) {
      logError(`Choices insert failed: ${choicesResult.error}`);
      process.exit(1);
    }
    log(`   ✓ ${choicesResult.inserted} choices inserted`, 'green');

    // 6. Publish (set current_version_id)
    log('6. Publishing versions (setting current_version_id)...', 'yellow');
    const publishResult = await publishVersions(config, { dryRun: isDryRun });

    if (publishResult.error) {
      logError(`Publishing failed: ${publishResult.error}`);
      process.exit(1);
    }
    log(`   ✓ ${publishResult.published} pointers updated`, 'green');

    logSection('IMPORT COMPLETE');

    log('✓ CMS exams successfully imported into LOCAL Supabase', 'green');
    log('\nStudent will now see:', 'cyan');
    log('  - 12 light series (300 questions, 834 choices)', 'cyan');
    log('  - 5 heavy series (50 questions, 120 choices)', 'cyan');
    log('  - All versions marked as "published" (visible to students)', 'cyan');
    log('\nAdmin can now create drafts and new versions.', 'cyan');

    if (isDryRun) {
      log('\n⚠ This was a DRY RUN. Run without --dry-run to actually import.', 'yellow');
    }

    process.exit(0);
  } catch (error) {
    logError(`Import failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
})();
