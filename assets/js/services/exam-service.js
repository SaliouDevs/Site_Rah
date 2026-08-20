const EXAM_IMAGE_BUCKET = 'exam-images';
const MAX_EXAM_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXAM_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const overrideCache = new Map();
let settingsCache = null;

export function getExamImageRules() {
  return {
    bucket: EXAM_IMAGE_BUCKET,
    maxSize: MAX_EXAM_IMAGE_SIZE,
    allowedTypes: [...ALLOWED_EXAM_IMAGE_TYPES]
  };
}

export async function loadExamSettings({ force = false, emit = false } = {}) {
  if (!force && settingsCache) return settingsCache;
  const fallback = [
    { exam_key: 'light', status: 'verification' },
    { exam_key: 'heavy', status: 'verification' }
  ];
  if (!window.sb) {
    return applyExamSettings(fallback, { emit });
  }
  try {
    const { data, error } = await window.sb
      .from('exam_settings')
      .select('exam_key,status,updated_at,updated_by')
      .order('exam_key', { ascending: true });
    if (error) throw error;
    return applyExamSettings(data || fallback, { emit });
  } catch (_) {
    return applyExamSettings(fallback, { emit });
  }
}

export function getCachedExamSettings() {
  return settingsCache || [
    { exam_key: 'light', status: window.getExamStatus?.('light') || 'verification' },
    { exam_key: 'heavy', status: window.getExamStatus?.('heavy') || 'verification' }
  ];
}

export async function updateExamStatus(examKey, status) {
  const user = await window.sbGetUser();
  if (!user) throw new Error('Non connecté');
  const normalizedExamKey = normalizeExamKey(examKey);
  if (!['verification', 'online', 'offline'].includes(status)) {
    throw new Error('Statut invalide');
  }
  const { data, error } = await window.sb
    .from('exam_settings')
    .update({ status, updated_by: user.id })
    .eq('exam_key', normalizedExamKey)
    .select()
    .single();
  if (error) throw error;
  applyExamSettings(getCachedExamSettings().map((item) => (
    item.exam_key === normalizedExamKey ? data : item
  )));
  return data;
}

export function applyExamSettings(settings, { emit = true } = {}) {
  const previous = settingsSignature(settingsCache);
  settingsCache = mergeExamSettings(settings);
  applyExamSettingsToConfig(settingsCache);
  const next = settingsSignature(settingsCache);
  if (emit && previous !== next) {
    window.dispatchEvent(new CustomEvent('exam-settings-updated', {
      detail: { settings: settingsCache }
    }));
  }
  return settingsCache;
}

export async function loadExamImageOverrides(examKey, { force = false } = {}) {
  const normalizedExamKey = normalizeExamKey(examKey);
  if (!force && overrideCache.has(normalizedExamKey)) {
    return overrideCache.get(normalizedExamKey);
  }
  const map = new Map();
  if (!window.sb) {
    overrideCache.set(normalizedExamKey, map);
    return map;
  }
  const { data, error } = await window.sb
    .from('exam_question_images')
    .select('question_id,exam_key,series_id,storage_path,updated_at,updated_by')
    .eq('exam_key', normalizedExamKey);
  if (error) throw error;
  (data || []).forEach((row) => {
    map.set(row.question_id, {
      ...row,
      publicUrl: getExamImagePublicUrl(row.storage_path)
    });
  });
  overrideCache.set(normalizedExamKey, map);
  return map;
}

export async function getExamWithImageOverrides(exam, { force = false } = {}) {
  const overrides = await loadExamImageOverrides(exam.id, { force });
  return applyImageOverrides(exam, overrides);
}

export async function uploadQuestionImage({ examKey, questionId, seriesId, file }) {
  validateExamImageFile(file);
  const user = await window.sbGetUser();
  if (!user) throw new Error('Non connecté');
  const normalizedExamKey = normalizeExamKey(examKey);
  const oldOverride = (await loadExamImageOverrides(normalizedExamKey)).get(questionId);
  const storagePath = buildStoragePath(normalizedExamKey, questionId, file.type);
  const { error: uploadError } = await window.sb.storage
    .from(EXAM_IMAGE_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '31536000',
      contentType: file.type,
      upsert: false
    });
  if (uploadError) throw uploadError;

  const { data, error } = await window.sb
    .from('exam_question_images')
    .upsert({
      question_id: questionId,
      exam_key: normalizedExamKey,
      series_id: seriesId || null,
      storage_path: storagePath,
      updated_by: user.id
    }, { onConflict: 'question_id' })
    .select()
    .single();
  if (error) throw error;

  if (oldOverride?.storage_path && oldOverride.storage_path !== storagePath) {
    await removeStorageObject(oldOverride.storage_path);
  }
  overrideCache.delete(normalizedExamKey);
  return {
    ...data,
    publicUrl: getExamImagePublicUrl(data.storage_path)
  };
}

export async function restoreQuestionOriginalImage(examKey, questionId) {
  const normalizedExamKey = normalizeExamKey(examKey);
  const oldOverride = (await loadExamImageOverrides(normalizedExamKey)).get(questionId);
  const { error } = await window.sb
    .from('exam_question_images')
    .delete()
    .eq('question_id', questionId)
    .eq('exam_key', normalizedExamKey);
  if (error) throw error;
  if (oldOverride?.storage_path) {
    await removeStorageObject(oldOverride.storage_path);
  }
  overrideCache.delete(normalizedExamKey);
}

export function getExamImagePublicUrl(storagePath) {
  if (!storagePath || !window.sb) return '';
  return window.sb.storage.from(EXAM_IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

export function validateExamImageFile(file) {
  if (!file) throw new Error('Image requise');
  if (!ALLOWED_EXAM_IMAGE_TYPES.has(file.type)) {
    throw new Error('Format accepté : JPEG, PNG ou WebP');
  }
  if (file.size > MAX_EXAM_IMAGE_SIZE) {
    throw new Error('Image trop lourde : maximum 5 Mo');
  }
}

function applyImageOverrides(exam, overrides) {
  return {
    ...exam,
    series: exam.series.map((series) => ({
      ...series,
      questions: series.questions.map((question) => {
        const override = overrides.get(question.id);
        return {
          ...question,
          originalImage: question.originalImage || question.image || '',
          image: override?.publicUrl || question.image || '',
          imageOverride: override || null
        };
      })
    }))
  };
}

function applyExamSettingsToConfig(settings) {
  if (!window.EXAMS_CONFIG) return;
  settings.forEach((setting) => {
    const status = setting.status || 'verification';
    window.EXAMS_CONFIG[setting.exam_key] = {
      ...(window.EXAMS_CONFIG[setting.exam_key] || {}),
      status,
      enabled: status === 'online'
    };
  });
  window.EXAMS_CONFIG.poidsLegerEnabled = window.EXAMS_CONFIG.light?.status === 'online';
  window.EXAMS_CONFIG.poidsLourdEnabled = window.EXAMS_CONFIG.heavy?.status === 'online';
}

function mergeExamSettings(rows) {
  const byKey = new Map((rows || []).map((row) => [row.exam_key, row]));
  return ['light', 'heavy'].map((examKey) => ({
    exam_key: examKey,
    status: byKey.get(examKey)?.status || 'verification',
    updated_at: byKey.get(examKey)?.updated_at || null,
    updated_by: byKey.get(examKey)?.updated_by || null
  }));
}

function settingsSignature(settings) {
  return (settings || [])
    .map((setting) => `${setting.exam_key}:${setting.status || 'verification'}`)
    .sort()
    .join('|');
}

function buildStoragePath(examKey, questionId, mimeType) {
  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  }[mimeType] || 'img';
  const token = Math.random().toString(36).slice(2, 8);
  return `${examKey}/${questionId}/${Date.now()}-${token}.${extension}`;
}

function normalizeExamKey(examKey) {
  return window.normalizeExamId?.(examKey) || String(examKey || '').toLowerCase();
}

async function removeStorageObject(storagePath) {
  try {
    await window.sb.storage.from(EXAM_IMAGE_BUCKET).remove([storagePath]);
  } catch (_) {
    // The database override is the source of truth; stale files must not block restore.
  }
}
