const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const root = process.cwd();

/**
 * Generates a deterministic UUID v4-like string from a namespace and name.
 * Uses SHA-256 to ensure reproducibility.
 */
function genDeterministicId(namespace, name) {
  const hash = crypto.createHash('sha256').update(`${namespace}:${name}`).digest('hex');
  // Format as UUID: 8-4-4-4-12
  // We use bits from the hash. To be "proper", we should set version 4 bits,
  // but for deterministic internal IDs, a simple slice of the hash is sufficient and unique enough.
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

  const seriesIds = {}; // code -> master_id

  exam.series.forEach((item, index) => {
    const mId = genDeterministicId('exam-series', `${examKey}:${item.id}`);
    const vId = genDeterministicId('exam-series-version', `${examKey}:${item.id}:v1`);
    seriesIds[item.id] = mId;

    masterSeries.push({
      id: mId,
      exam_key: examKey,
      code: item.id,
      current_version_id: null // initially draft
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
        sort_order: index + 1
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

  if (question.optionType === 'type4' || question.optionType === 'type4_multiple') {
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

function buildLessonContent(lessons) {
  const masterLessons = [];
  const versionLessons = [];
  const steps = [];

  lessons.forEach((lesson, index) => {
    const mlId = genDeterministicId('lesson', lesson.id);
    const vlId = genDeterministicId('lesson-version', `${lesson.id}:v1`);

    masterLessons.push({
      id: mlId,
      legacy_id: String(lesson.id),
      current_version_id: null
    });

    versionLessons.push({
      id: vlId,
      lesson_id: mlId,
      status: 'draft',
      version_number: 1,
      title: lesson.title,
      description: lesson.description || null,
      sort_order: index + 1
    });

    steps.push({
      id: genDeterministicId('lesson-step', `${lesson.id}:1`),
      lesson_version_id: vlId,
      title: lesson.title,
      content: lesson.html,
      sort_order: 1
    });
  });

  return { masterLessons, versionLessons, steps };
}

function buildPanelContent(categories) {
  const masterPanels = [];
  const versionPanels = [];

  categories.forEach((category) => {
    category.signs.forEach((sign, index) => {
      const mpId = genDeterministicId('panel', sign.id);
      const vpId = genDeterministicId('panel-version', `${sign.id}:v1`);

      masterPanels.push({
        id: mpId,
        legacy_id: sign.id,
        category: category.id,
        current_version_id: null
      });

      versionPanels.push({
        id: vpId,
        panel_id: mpId,
        status: 'draft',
        version_number: 1,
        title: sign.name,
        description: sign.description || null,
        image_path: sign.image || null,
        audio_fr_path: null,
        audio_wo_path: null,
        sort_order: index + 1
      });
    });
  });

  return { masterPanels, versionPanels };
}

function assertContent({ light, heavy, lessons, panels }) {
  const lightQuestions = light.masterQuestions.length;
  const heavyQuestions = heavy.masterQuestions.length;
  const lightSeries = light.masterSeries.length;
  const heavySeries = heavy.masterSeries.length;
  if (lightQuestions !== 300) throw new Error(`Expected 300 light questions, got ${lightQuestions}`);
  if (heavyQuestions !== 50) throw new Error(`Expected 50 heavy questions, got ${heavyQuestions}`);
  if (lightSeries !== 12) throw new Error(`Expected 12 light series, got ${lightSeries}`);
  if (heavySeries !== 5) throw new Error(`Expected 5 heavy series, got ${heavySeries}`);
  if (lessons.masterLessons.length !== 9) throw new Error(`Expected 9 lessons, got ${lessons.masterLessons.length}`);
  if (panels.masterPanels.length !== 232) throw new Error(`Expected 232 panels, got ${panels.masterPanels.length}`);
}

(async () => {
  const [{ EXAM_LIGHT_DATA }, { EXAM_HEAVY_DATA }, { LESSONS_DATA }, { PANELS_DATA }] = await Promise.all([
    loadModule('assets/js/data/exam-light-data.js'),
    loadModule('assets/js/data/exam-heavy-data.js'),
    loadModule('assets/js/data/lessons-data.js'),
    loadModule('assets/js/data/panels-data.js')
  ]);

  const light = buildExamContent(EXAM_LIGHT_DATA, 'light');
  const heavy = buildExamContent(EXAM_HEAVY_DATA, 'heavy');
  const lessons = buildLessonContent(LESSONS_DATA);
  const panels = buildPanelContent(PANELS_DATA);

  assertContent({ light, heavy, lessons, panels });

  const seed = { light, heavy, lessons, panels };
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(seed, null, 2)}\n`);
    return;
  }

  console.log('CMS seed build check passed');
  console.log(`light: ${light.masterSeries.length} series, ${light.masterQuestions.length} questions, ${light.choices.length} choices`);
  console.log(`heavy: ${heavy.masterSeries.length} series, ${heavy.masterQuestions.length} questions, ${heavy.choices.length} choices`);
  console.log(`lessons: ${lessons.masterLessons.length} lessons, ${lessons.steps.length} steps`);
  console.log(`panels: ${panels.masterPanels.length} panels`);

  // Show a few IDs for visual verification of determinism
  console.log(`Determinism check (PL-001): ${light.masterQuestions[0].id}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
