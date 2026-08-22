/**
 * Exam CMS Service
 *
 * Provides high-level API for:
 * - Reading published exam content
 * - Admin: Managing drafts and publishing
 * - Admin: Version history and restoration
 *
 * Uses Supabase client with proper error handling.
 * Does NOT use service_role in frontend.
 */

const EXPECTED_EXAM_COUNTS = {
  light: { series: 12, questions: 300, choices: 834 },
  heavy: { series: 5, questions: 50, choices: 120 }
};

export const EXAM_CMS_UNAVAILABLE_MESSAGE = 'Gestion de contenu indisponible pour le moment. Les contenus historiques restent utilisés.';
export const EXAM_CMS_UNAVAILABLE_REASON = 'CMS backend unavailable';

function getSupabaseClient() {
  if (!window.sb) throw new Error('Client Supabase indisponible');
  return window.sb;
}

/**
 * List all exam series for a given exam type
 */
export async function listExamSeries(examKey) {
  try {
    const { data, error } = await getSupabaseClient()
      .from('exam_series')
      .select('id, exam_key, code, current_version_id, created_at')
      .eq('exam_key', examKey)
      .order('code');

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    return normalizeServiceError(error);
  }
}

/**
 * Get series version details (published or draft)
 */
export async function getSeriesVersion(seriesVersionId) {
  try {
    const { data, error } = await getSupabaseClient()
      .from('exam_series_versions')
      .select('*')
      .eq('id', seriesVersionId)
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return normalizeServiceError(error, null);
  }
}

/**
 * List all questions in a series
 */
export async function listSeriesQuestions(seriesId) {
  try {
    const { data, error } = await getSupabaseClient()
      .from('exam_questions')
      .select('id, legacy_id, exam_key, series_id, current_version_id, created_at')
      .eq('series_id', seriesId)
      .order('created_at');

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    return normalizeServiceError(error);
  }
}

/**
 * Get current published version of a question
 */
export async function getCurrentQuestionVersion(questionId) {
  try {
    // Get question's current_version_id
    const { data: question, error: qError } = await getSupabaseClient()
      .from('exam_questions')
      .select('current_version_id, legacy_id, exam_key, series_id')
      .eq('id', questionId)
      .single();

    if (qError) throw qError;
    if (!question.current_version_id) {
      return { data: null, error: 'No published version' };
    }

    // Get the version details
    const { data: version, error: vError } = await getSupabaseClient()
      .from('exam_question_versions')
      .select('*')
      .eq('id', question.current_version_id)
      .single();

    if (vError) throw vError;

    // Get choices
    const { data: choices, error: cError } = await getSupabaseClient()
      .from('exam_question_choices')
      .select('*')
      .eq('question_version_id', question.current_version_id)
      .order('sort_order');

    if (cError) throw cError;

    return {
      data: {
        question,
        version,
        choices: choices || []
      },
      error: null
    };
  } catch (error) {
    return normalizeServiceError(error, null);
  }
}

/**
 * ADMIN: Get draft version of a question (if exists)
 */
export async function getDraftQuestionVersion(questionId) {
  try {
    // Get draft version
    const { data: versions, error: vError } = await getSupabaseClient()
      .from('exam_question_versions')
      .select('*')
      .eq('question_id', questionId)
      .eq('status', 'draft')
      .limit(1);

    if (vError) throw vError;
    if (!versions || versions.length === 0) {
      return { data: null, error: null }; // No draft yet
    }

    const version = versions[0];

    // Get choices
    const { data: choices, error: cError } = await getSupabaseClient()
      .from('exam_question_choices')
      .select('*')
      .eq('question_version_id', version.id)
      .order('sort_order');

    if (cError) throw cError;

    return {
      data: {
        version,
        choices: choices || []
      },
      error: null
    };
  } catch (error) {
    return normalizeServiceError(error, null);
  }
}

/**
 * ADMIN: Create or get existing draft
 */
export async function createOrGetDraft(questionId) {
  try {
    const { data, error } = await getSupabaseClient()
      .rpc('create_exam_question_draft', { p_question_id: questionId });

    if (error) throw error;

    // Return the draft details
    return getDraftQuestionVersion(questionId);
  } catch (error) {
    return normalizeServiceError(error, null);
  }
}

/**
 * ADMIN: Save draft changes
 */
export async function saveDraft(versionId, updates) {
  try {
    const sb = getSupabaseClient();
    const { data: draft, error: draftError } = await sb
      .from('exam_question_versions')
      .select('question_id')
      .eq('id', versionId)
      .eq('status', 'draft')
      .single();

    if (draftError) throw draftError;

    const choices = Array.isArray(updates.choices) ? updates.choices.map((choice, index) => ({
      choice_key: choice.choice_key,
      label: choice.label,
      is_correct: Boolean(choice.is_correct),
      sort_order: Number(choice.sort_order || index + 1)
    })) : [];

    const { error } = await sb.rpc('save_exam_question_draft', {
      p_question_id: draft.question_id,
      p_version_id: versionId,
      p_question_text: updates.question_text || '',
      p_explanation: updates.explanation || null,
      p_image_path: updates.image_path || null,
      p_metadata: updates.metadata || {},
      p_choices: choices
    });

    if (error) throw error;

    return { error: null };
  } catch (error) {
    const normalized = normalizeServiceError(error, null);
    return { error: normalized.error };
  }
}

/**
 * ADMIN: Publish draft (make it current version)
 */
export async function publishDraft(questionId, versionId) {
  try {
    const { data, error } = await getSupabaseClient()
      .rpc('publish_exam_question_version', {
        p_question_id: questionId,
        p_version_id: versionId
      });

    if (error) throw error;

    return { error: null, published: data };
  } catch (error) {
    const normalized = normalizeServiceError(error, null);
    return { error: normalized.error, published: false };
  }
}

/**
 * ADMIN: Get version history
 */
export async function getQuestionHistory(questionId) {
  try {
    const { data, error } = await getSupabaseClient()
      .from('exam_question_versions')
      .select('id, status, version_number, question_text, updated_at, updated_by, created_at')
      .eq('question_id', questionId)
      .order('version_number', { ascending: false });

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    return normalizeServiceError(error);
  }
}

/**
 * ADMIN: Restore old version as new draft
 */
export async function restoreVersionAsDraft(questionId, sourceVersionId) {
  try {
    const { data, error } = await getSupabaseClient()
      .rpc('restore_exam_question_version_as_draft', {
        p_question_id: questionId,
        p_source_version_id: sourceVersionId
      });

    if (error) throw error;

    // Return new draft details
    return getDraftQuestionVersion(questionId);
  } catch (error) {
    return normalizeServiceError(error, null);
  }
}

/**
 * Completeness check: Verify if all expected questions are published
 *
 * Returns true if:
 * - Light: 12 series, 300 questions, all have current_version_id
 * - Heavy: 5 series, 50 questions, all have current_version_id
 */
export async function checkCMSCompleteness(examKey) {
  try {
    // Count series
    const expected = EXPECTED_EXAM_COUNTS[examKey];
    if (!expected) {
      return { isComplete: false, reason: `Unknown exam key: ${examKey}` };
    }

    const sb = getSupabaseClient();

    const { count: seriesCount, error: sError } = await sb
      .from('exam_series')
      .select('id', { count: 'exact' })
      .eq('exam_key', examKey);

    if (sError) throw sError;

    if (seriesCount !== expected.series) {
      return { isComplete: false, reason: `Expected ${expected.series} series, found ${seriesCount}` };
    }

    const { data: seriesRows, error: svError } = await sb
      .from('exam_series')
      .select('id,current_version_id')
      .eq('exam_key', examKey);

    if (svError) throw svError;
    const publishedSeriesCount = (seriesRows || []).filter((s) => s.current_version_id).length;
    if (publishedSeriesCount !== expected.series) {
      return { isComplete: false, reason: `Expected ${expected.series} published series, found ${publishedSeriesCount}` };
    }

    const { data: questions, error: qError } = await sb
      .from('exam_questions')
      .select('id, current_version_id')
      .eq('exam_key', examKey);

    if (qError) throw qError;

    const publishedCount = (questions || []).filter((q) => q.current_version_id).length;
    const totalCount = (questions || []).length;

    if (totalCount !== expected.questions || publishedCount !== expected.questions) {
      return {
        isComplete: false,
        reason: `Expected ${expected.questions} published questions, found ${publishedCount}/${totalCount}`
      };
    }

    const versionIds = (questions || []).map((q) => q.current_version_id).filter(Boolean);
    const choicesCount = await countInChunks(sb, 'exam_question_choices', 'question_version_id', versionIds);
    if (choicesCount !== expected.choices) {
      return { isComplete: false, reason: `Expected ${expected.choices} choices, found ${choicesCount}` };
    }

    return { isComplete: true };
  } catch (error) {
    return { isComplete: false, reason: formatCmsError(error) };
  }
}

/**
 * Student data source selector
 *
 * Use CMS if complete, otherwise fall back to legacy JS
 */
export async function getExamDataSource(examKey) {
  try {
    const complete = await checkCMSCompleteness(examKey);

    if (!complete.isComplete) {
      return { source: 'legacy', reason: complete.reason };
    }

    return { source: 'cms', reason: 'CMS complete and published' };
  } catch (error) {
    return { source: 'legacy', reason: `Fallback due to error: ${formatCmsError(error)}` };
  }
}

/**
 * Load exam data for student (CMS or legacy)
 */
export async function loadStudentExamData(examKey) {
  try {
    const source = await getExamDataSource(examKey);

    if (source.source === 'cms') {
      const cms = await loadFromCMS(examKey);
      if (cms.data?.series?.length && !cms.error) return cms;
      const fallback = await loadLegacyExamData(examKey);
      return { ...fallback, error: cms.error || 'CMS read returned no data' };
    }

    return await loadLegacyExamData(examKey);
  } catch (error) {
    const fallback = await loadLegacyExamData(examKey);
    return { ...fallback, error: error.message };
  }
}

async function loadLegacyExamData(examKey) {
  if (examKey === 'light') {
    const mod = await import('../data/exam-light-data.js');
    return { data: mod.EXAM_LIGHT_DATA, source: 'legacy' };
  }
  const mod = await import('../data/exam-heavy-data.js');
  return { data: mod.EXAM_HEAVY_DATA, source: 'legacy' };
}

/**
 * Load exam from CMS
 */
async function loadFromCMS(examKey) {
  try {
    // Fetch all series
    const sb = getSupabaseClient();
    const { data: series, error: sError } = await sb
      .from('exam_series')
      .select('id, exam_key, code, current_version_id')
      .eq('exam_key', examKey)
      .order('code');

    if (sError) throw sError;

    const seriesVersionIds = series.map((s) => s.current_version_id).filter(Boolean);

    // Fetch all series versions
    const versionSeries = await selectInChunks(sb, 'exam_series_versions', '*', 'id', seriesVersionIds, 'sort_order');

    // Fetch all questions in exam
    const { data: questions, error: qError } = await sb
      .from('exam_questions')
      .select('id, legacy_id, current_version_id, series_id')
      .eq('exam_key', examKey);

    if (qError) throw qError;

    const questionVersionIds = questions.map((q) => q.current_version_id).filter(Boolean);

    // Fetch all question versions
    const versions = await selectInChunks(sb, 'exam_question_versions', '*', 'id', questionVersionIds, 'sort_order');

    // Fetch all choices
    const choices = await selectInChunks(sb, 'exam_question_choices', '*', 'question_version_id', questionVersionIds, 'sort_order');

    return {
      data: rebuildExamData(examKey, series || [], versionSeries, questions || [], versions, choices),
      source: 'cms'
    };
  } catch (error) {
    return { data: null, source: 'cms', error: formatCmsError(error) };
  }
}

export function isCmsBackendUnavailableError(error) {
  const text = `${error?.message || error || ''} ${error?.code || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return text.includes('pgrst')
    || text.includes('schema cache')
    || text.includes('relation') && text.includes('does not exist')
    || text.includes('table') && text.includes('does not exist')
    || text.includes('table') && text.includes('not found')
    || text.includes('could not find the table');
}

function formatCmsError(error) {
  return isCmsBackendUnavailableError(error) ? EXAM_CMS_UNAVAILABLE_REASON : (error?.message || String(error || 'Erreur CMS'));
}

function normalizeServiceError(error, emptyData = []) {
  const unavailable = isCmsBackendUnavailableError(error);
  return {
    data: emptyData,
    error: unavailable ? EXAM_CMS_UNAVAILABLE_MESSAGE : (error?.message || String(error || 'Erreur CMS')),
    unavailable
  };
}

async function selectInChunks(sb, table, columns, column, values, orderColumn, chunkSize = 50) {
  const rows = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    const chunk = values.slice(index, index + chunkSize);
    if (chunk.length === 0) continue;
    let query = sb.from(table).select(columns).in(column, chunk);
    if (orderColumn) query = query.order(orderColumn);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

async function countInChunks(sb, table, column, values, chunkSize = 50) {
  let total = 0;
  for (let index = 0; index < values.length; index += chunkSize) {
    const chunk = values.slice(index, index + chunkSize);
    if (chunk.length === 0) continue;
    const { count, error } = await sb
      .from(table)
      .select('id', { count: 'exact', head: true })
      .in(column, chunk);
    if (error) throw error;
    total += count || 0;
  }
  return total;
}

function rebuildExamData(examKey, seriesMasters, seriesVersions, questionMasters, questionVersions, choices) {
  const seriesVersionById = new Map(seriesVersions.map((version) => [version.id, version]));
  const questionVersionById = new Map(questionVersions.map((version) => [version.id, version]));
  const choicesByVersionId = new Map();
  choices.forEach((choice) => {
    const list = choicesByVersionId.get(choice.question_version_id) || [];
    list.push(choice);
    choicesByVersionId.set(choice.question_version_id, list);
  });
  choicesByVersionId.forEach((list) => list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));

  const questionsBySeriesId = new Map();
  questionMasters.forEach((master) => {
    const version = questionVersionById.get(master.current_version_id);
    if (!version) return;
    const list = questionsBySeriesId.get(master.series_id) || [];
    list.push(toLegacyQuestion(master, version, choicesByVersionId.get(version.id) || [], seriesMasters.find((series) => series.id === master.series_id)?.code || ''));
    questionsBySeriesId.set(master.series_id, list);
  });
  questionsBySeriesId.forEach((list) => list.sort((a, b) => (a.number || 0) - (b.number || 0)));

  const series = seriesMasters.map((master) => {
    const version = seriesVersionById.get(master.current_version_id);
    const questions = questionsBySeriesId.get(master.id) || [];
    return {
      id: master.code,
      name: version?.title || master.code,
      title: version?.title || master.code,
      level: examKey === 'light' ? 'Permis B' : 'Permis C',
      questionCount: questions.length,
      passingScore: Math.max(0, questions.length - 4),
      durationMinutes: 30,
      questions
    };
  }).sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true }));

  return {
    id: examKey,
    title: examKey === 'light' ? 'Poids Léger' : 'Poids Lourd',
    license: examKey === 'light' ? 'Permis B' : 'Permis C',
    passingScore: 21,
    historyKey: `examHistory:${examKey}`,
    series
  };
}

function toLegacyQuestion(master, version, choices, seriesCode) {
  const metadata = version.metadata || {};
  const optionType = metadata.optionType || inferOptionType(choices);
  const question = {
    id: master.legacy_id,
    legacy_id: master.legacy_id,
    seriesId: seriesCode,
    number: version.sort_order,
    text: version.question_text,
    explanation: version.explanation || '',
    image: version.image_path || '',
    optionType
  };

  if (optionType === 'type3') {
    const byKey = new Map(choices.map((choice) => [choice.choice_key, splitType3Label(choice.label)]));
    question.type3Q1Title = metadata.type3Q1Title || byKey.get('A')?.title || '';
    question.type3Q1Text1 = byKey.get('A')?.text || '';
    question.type3Q1Text2 = byKey.get('B')?.text || '';
    question.type3CorrectAnswer1 = choices.find((choice) => choice.is_correct && ['A', 'B'].includes(choice.choice_key))?.choice_key || metadata.type3CorrectAnswer1 || '';
    question.type3Q2Title = metadata.type3Q2Title || byKey.get('C')?.title || '';
    question.type3Q2Text1 = byKey.get('C')?.text || '';
    question.type3Q2Text2 = byKey.get('D')?.text || '';
    question.type3CorrectAnswer2 = choices.find((choice) => choice.is_correct && ['C', 'D'].includes(choice.choice_key))?.choice_key || metadata.type3CorrectAnswer2 || '';
    return question;
  }

  if (optionType === 'type4' || optionType === 'type4_multiple') {
    choices.forEach((choice, index) => {
      question[`type4Text${index + 1}`] = choice.label;
    });
    const correct = choices.filter((choice) => choice.is_correct).map((choice) => choice.choice_key);
    question.correctAnswer = optionType === 'type4_multiple' ? correct : correct[0] || '';
    return question;
  }

  question.correctAnswer = choices.find((choice) => choice.is_correct)?.choice_key || '';
  return question;
}

function inferOptionType(choices) {
  if (choices.length > 2) return choices.filter((choice) => choice.is_correct).length > 1 ? 'type4_multiple' : 'type4';
  return 'type2';
}

function splitType3Label(label) {
  const [title, ...rest] = String(label || '').split(' - ');
  return { title: title || '', text: rest.join(' - ') || title || '' };
}
