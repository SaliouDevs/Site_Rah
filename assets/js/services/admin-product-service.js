import { loadSchoolSettings, saveSchoolSettings } from './school-service.js';
import { LESSONS_DATA } from '../data/lessons-data.js';
import { PANELS_DATA } from '../data/panels-data.js';

const MEDIA_BUCKET = 'cms-media';

export { loadSchoolSettings, saveSchoolSettings };

export async function loadPeopleWorkspace() {
  ensureClient();
  const [profilesRes, assignmentsRes] = await Promise.all([
    window.sb.from('profiles').select('*').order('created_at', { ascending: false }),
    window.sb.from('instructor_assignments').select('*').order('created_at', { ascending: false })
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;
  return { profiles: profilesRes.data || [], assignments: assignmentsRes.data || [] };
}

export async function setAccountRole(userId, role) {
  const { data, error } = await window.sb.rpc('admin_set_account_role', { target_user_id: userId, new_role: role });
  if (error) throw error;
  return Boolean(data);
}

export async function assignInstructor(instructorId, studentId) {
  const { data, error } = await window.sb.rpc('admin_assign_instructor', { p_instructor_id: instructorId, p_student_id: studentId });
  if (error) throw error;
  return data;
}

export async function endInstructorAssignment(assignmentId) {
  const { data, error } = await window.sb.rpc('admin_end_instructor_assignment', { p_assignment_id: assignmentId });
  if (error) throw error;
  return Boolean(data);
}

export async function loadCmsLessons() {
  ensureClient();
  const [mastersRes, versionsRes] = await Promise.all([
    window.sb.from('cms_lessons').select('*').order('legacy_id'),
    window.sb.from('cms_lesson_versions').select('*').order('version_number', { ascending: false })
  ]);
  if (mastersRes.error) throw mastersRes.error;
  if (versionsRes.error) throw versionsRes.error;
  return { masters: mastersRes.data || [], versions: versionsRes.data || [] };
}

export async function loadLessonVersion(versionId) {
  const [versionRes, stepsRes] = await Promise.all([
    window.sb.from('cms_lesson_versions').select('*').eq('id', versionId).single(),
    window.sb.from('cms_lesson_steps').select('*').eq('lesson_version_id', versionId).order('sort_order')
  ]);
  if (versionRes.error) throw versionRes.error;
  if (stepsRes.error) throw stepsRes.error;
  return { version: versionRes.data, steps: stepsRes.data || [] };
}

export async function seedLegacyLessons(onProgress) {
  let done = 0;
  for (const lesson of LESSONS_DATA) {
    const { error } = await window.sb.rpc('admin_seed_lesson', {
      p_legacy_id: String(lesson.id),
      p_title: lesson.title,
      p_description: lesson.description || '',
      p_html: lesson.html,
      p_sort_order: Number(lesson.id || done + 1)
    });
    if (error) throw error;
    done += 1;
    onProgress?.(done, LESSONS_DATA.length);
  }
  return done;
}

export async function createLessonDraft(lessonId) {
  const { data, error } = await window.sb.rpc('create_cms_lesson_draft', { p_lesson_id: lessonId });
  if (error) throw error;
  return data;
}
export async function saveLessonDraft(lessonId, versionId, { title, description, html }) {
  const { data, error } = await window.sb.rpc('save_cms_lesson_draft', {
    p_lesson_id: lessonId,
    p_version_id: versionId,
    p_title: title,
    p_description: description || '',
    p_steps: [{ title: null, content: html, sort_order: 1 }]
  });
  if (error) throw error;
  return Boolean(data);
}
export async function publishLesson(lessonId, versionId) { return callBoolean('publish_cms_lesson_version', { p_lesson_id: lessonId, p_version_id: versionId }); }
export async function restoreLessonVersion(lessonId, versionId) { const { data, error } = await window.sb.rpc('restore_cms_lesson_version_as_draft', { p_lesson_id: lessonId, p_source_version_id: versionId }); if (error) throw error; return data; }
export async function deleteLessonVersion(lessonId, versionId) { return callBoolean('delete_cms_lesson_version', { p_lesson_id: lessonId, p_version_id: versionId }); }

export async function loadCmsPanels() {
  ensureClient();
  const [mastersRes, versionsRes] = await Promise.all([
    window.sb.from('cms_panels').select('*').order('category').order('legacy_id'),
    window.sb.from('cms_panel_versions').select('*').order('version_number', { ascending: false })
  ]);
  if (mastersRes.error) throw mastersRes.error;
  if (versionsRes.error) throw versionsRes.error;
  return { masters: mastersRes.data || [], versions: versionsRes.data || [] };
}

export async function seedLegacyPanels(onProgress) {
  const items = PANELS_DATA.flatMap((category) => category.signs.map((sign, index) => ({ category: category.id, sign, index })));
  let done = 0;
  for (let offset = 0; offset < items.length; offset += 8) {
    const batch = items.slice(offset, offset + 8);
    const results = await Promise.all(batch.map(({ category, sign, index }) => window.sb.rpc('admin_seed_panel', {
      p_legacy_id: sign.id,
      p_category: category,
      p_title: sign.name,
      p_description: sign.description || '',
      p_image_path: sign.image || '',
      p_sort_order: index + 1
    })));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    done += batch.length;
    onProgress?.(done, items.length);
  }
  return done;
}

export async function createPanelDraft(panelId) { const { data, error } = await window.sb.rpc('create_cms_panel_draft', { p_panel_id: panelId }); if (error) throw error; return data; }
export async function savePanelDraft(panelId, versionId, values) {
  const { data, error } = await window.sb.rpc('save_cms_panel_draft', {
    p_panel_id: panelId,
    p_version_id: versionId,
    p_category: values.category,
    p_title: values.title,
    p_description: values.description || '',
    p_image_path: values.imagePath || '',
    p_audio_fr_path: values.audioFrPath || '',
    p_audio_wo_path: values.audioWoPath || ''
  });
  if (error) throw error;
  return Boolean(data);
}
export async function publishPanel(panelId, versionId) { return callBoolean('publish_cms_panel_version', { p_panel_id: panelId, p_version_id: versionId }); }
export async function restorePanelVersion(panelId, versionId) { const { data, error } = await window.sb.rpc('restore_cms_panel_version_as_draft', { p_panel_id: panelId, p_source_version_id: versionId }); if (error) throw error; return data; }
export async function deletePanelVersion(panelId, versionId) { return callBoolean('delete_cms_panel_version', { p_panel_id: panelId, p_version_id: versionId }); }

export async function loadMediaAssets() {
  const { data, error } = await window.sb.from('cms_media_assets').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function uploadMediaAsset(file, { title = '', altText = '', language = null } = {}) {
  ensureClient();
  validateMedia(file);
  const kind = file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'other';
  const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const safeBase = slug(file.name.replace(/\.[^.]+$/, '')).slice(0, 60) || 'media';
  const storagePath = `library/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safeBase}.${ext}`;
  const { error: uploadError } = await window.sb.storage.from(MEDIA_BUCKET).upload(storagePath, file, { upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;
  const { data: publicData } = window.sb.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
  const { data, error } = await window.sb.from('cms_media_assets').insert({
    bucket: MEDIA_BUCKET,
    storage_path: storagePath,
    media_kind: kind,
    mime_type: file.type || 'application/octet-stream',
    language: language || null,
    title: title || file.name,
    alt_text: altText || null,
    status: 'published'
  }).select().single();
  if (error) {
    await window.sb.storage.from(MEDIA_BUCKET).remove([storagePath]).catch(() => {});
    throw error;
  }
  return { ...data, publicUrl: publicData.publicUrl };
}

export async function deleteMediaAsset(asset) {
  if (!asset?.id) return false;
  if (asset.storage_path) {
    const { error: storageError } = await window.sb.storage.from(asset.bucket || MEDIA_BUCKET).remove([asset.storage_path]);
    if (storageError) throw storageError;
  }
  const { error } = await window.sb.from('cms_media_assets').delete().eq('id', asset.id);
  if (error) throw error;
  return true;
}

export function getMediaPublicUrl(asset) {
  if (!asset?.storage_path) return '';
  return window.sb.storage.from(asset.bucket || MEDIA_BUCKET).getPublicUrl(asset.storage_path).data.publicUrl;
}

export function legacyLessonCount() { return LESSONS_DATA.length; }
export function legacyPanelCount() { return PANELS_DATA.reduce((sum, category) => sum + category.signs.length, 0); }

async function callBoolean(name, args) { const { data, error } = await window.sb.rpc(name, args); if (error) throw error; return Boolean(data); }
function validateMedia(file) { if (!file) throw new Error('Fichier requis'); if (file.size > 15 * 1024 * 1024) throw new Error('Fichier trop lourd (15 Mo max).'); if (!/^(image\/(jpeg|png|webp|gif)|audio\/(mpeg|mp4|wav|ogg|webm))$/.test(file.type)) throw new Error('Format non accepté.'); }
function slug(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function ensureClient() { if (!window.sb) throw new Error('Supabase indisponible'); }
