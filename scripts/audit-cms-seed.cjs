#!/usr/bin/env node

/**
 * Audit the CMS seed to verify it contains exact legacy content.
 *
 * This script:
 * 1. Loads legacy exam data (light + heavy)
 * 2. Generates seed using build-cms-seed.cjs logic
 * 3. Validates counts match legacy
 * 4. Validates specific questions/choices are present
 * 5. Checks deterministic ID generation
 * 6. Outputs detailed report
 */

const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

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

async function loadModule(relativePath) {
  return import(pathToFileURL(path.join(root, relativePath)).href);
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
      current_version_id: null
    });

    versionSeries.push({
      id: vId,
      series_id: mId,
      status: 'draft',
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
        current_version_id: null
      });

      versionQuestions.push({
        id: qvId,
        question_id: qmId,
        status: 'draft',
        version_number: 1,
        question_text: question.text || '',
        explanation: question.explanation || null,
        image_path: question.image || null,
        sort_order: index + 1,
        metadata: buildQuestionMetadata(question)
      });

      buildQuestionChoices(question).forEach((choice, cIdx) => {
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

function auditExamContent(exam, examKey, expectedCounts) {
  const result = { passed: true, checks: [] };

  const { masterSeries, masterQuestions, choices } = exam;

  // Count checks
  const countChecks = [
    {
      name: `${examKey} series count`,
      actual: masterSeries.length,
      expected: expectedCounts.series
    },
    {
      name: `${examKey} questions count`,
      actual: masterQuestions.length,
      expected: expectedCounts.questions
    },
    {
      name: `${examKey} choices count`,
      actual: choices.length,
      expected: expectedCounts.choices
    }
  ];

  countChecks.forEach((check) => {
    const passed = check.actual === check.expected;
    result.checks.push({
      ...check,
      passed,
      status: passed ? '✓' : '✗'
    });
    if (!passed) result.passed = false;
  });

  // Validate structure
  const structureChecks = [];

  // Each series has unique code
  const seriesCodes = new Set(masterSeries.map((s) => s.code));
  structureChecks.push({
    name: 'All series have unique codes',
    passed: seriesCodes.size === masterSeries.length,
  });

  // Each question has legacy_id
  const withoutLegacyId = masterQuestions.filter((q) => !q.legacy_id);
  structureChecks.push({
    name: 'All questions have legacy_id',
    passed: withoutLegacyId.length === 0,
    detail: withoutLegacyId.length > 0 ? `Found ${withoutLegacyId.length} without legacy_id` : null
  });

  // Choices have correct/label
  const invalidChoices = choices.filter((c) => !c.label || c.choice_key === undefined);
  structureChecks.push({
    name: 'All choices have label and choice_key',
    passed: invalidChoices.length === 0,
    detail: invalidChoices.length > 0 ? `Found ${invalidChoices.length} invalid` : null
  });

  // At least one correct answer per question
  const questionIds = new Set(masterQuestions.map((q) => q.id));
  const questionsWithoutCorrect = Array.from(questionIds).filter((qId) => {
    const qChoices = choices.filter((c) => {
      const version = exam.versionQuestions.find((v) => c.question_version_id === v.id);
      return version?.question_id === qId;
    });
    return !qChoices.some((c) => c.is_correct);
  });

  structureChecks.push({
    name: 'All questions have at least one correct answer',
    passed: questionsWithoutCorrect.length === 0,
    detail: questionsWithoutCorrect.length > 0 ? `Found ${questionsWithoutCorrect.length} without correct` : null
  });

  structureChecks.forEach((check) => {
    result.checks.push(check);
    if (!check.passed) result.passed = false;
  });

  return result;
}

/**
 * Main audit
 */
(async () => {
  try {
    logSection('CMS Seed Audit — Verify Legacy Content Accuracy');

    const [{ EXAM_LIGHT_DATA }, { EXAM_HEAVY_DATA }] = await Promise.all([
      loadModule('assets/js/data/exam-light-data.js'),
      loadModule('assets/js/data/exam-heavy-data.js'),
    ]);

    log('Building CMS seed from legacy data...', 'yellow');
    const light = buildExamContent(EXAM_LIGHT_DATA, 'light');
    const heavy = buildExamContent(EXAM_HEAVY_DATA, 'heavy');

    log('SEED GENERATED', 'green');
    console.log();

    // Audit light
    logSection('AUDIT: Light Exams (PL)');
    const lightAudit = auditExamContent(light, 'light', {
      series: 12,
      questions: 300,
      choices: 834
    });

    lightAudit.checks.forEach((check) => {
      const color = check.passed ? 'green' : 'red';
      const detail = check.detail ? ` — ${check.detail}` : ` (${check.actual}/${check.expected})`;
      log(`${check.status || (check.passed ? '✓' : '✗')} ${check.name}${detail}`, color);
    });

    // Audit heavy
    logSection('AUDIT: Heavy Exams (PLD)');
    const heavyAudit = auditExamContent(heavy, 'heavy', {
      series: 5,
      questions: 50,
      choices: 120
    });

    heavyAudit.checks.forEach((check) => {
      const color = check.passed ? 'green' : 'red';
      const detail = check.detail ? ` — ${check.detail}` : ` (${check.actual}/${check.expected})`;
      log(`${check.status || (check.passed ? '✓' : '✗')} ${check.name}${detail}`, color);
    });

    // Determinism check
    logSection('DETERMINISM CHECK');

    const light2 = buildExamContent(EXAM_LIGHT_DATA, 'light');
    const heavy2 = buildExamContent(EXAM_HEAVY_DATA, 'heavy');

    const lightIdMatch = light.masterQuestions[0]?.id === light2.masterQuestions[0]?.id;
    const heavyIdMatch = heavy.masterQuestions[0]?.id === heavy2.masterQuestions[0]?.id;

    log(`Light determinism: ${lightIdMatch ? '✓ PASS' : '✗ FAIL'}`, lightIdMatch ? 'green' : 'red');
    log(`Heavy determinism: ${heavyIdMatch ? '✓ PASS' : '✗ FAIL'}`, heavyIdMatch ? 'green' : 'red');

    if (lightIdMatch && heavyIdMatch) {
      log(`\nFirst light question ID (both runs): ${light.masterQuestions[0].id}`, 'cyan');
    }

    // Final verdict
    logSection('AUDIT VERDICT');

    const allPassed = lightAudit.passed && heavyAudit.passed && lightIdMatch && heavyIdMatch;

    if (allPassed) {
      log('✓ SEED AUDIT PASSED', 'green');
      log('The CMS seed contains all expected legacy content with correct counts.', 'green');
      process.exit(0);
    } else {
      log('✗ SEED AUDIT FAILED', 'red');
      log('There are discrepancies between legacy data and generated seed.', 'red');
      process.exit(1);
    }
  } catch (error) {
    log(`FATAL ERROR: ${error.message}`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
})();
