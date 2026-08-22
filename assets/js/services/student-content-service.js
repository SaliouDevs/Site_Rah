import { LESSONS_DATA } from '../data/lessons-data.js';
import { PANELS_DATA } from '../data/panels-data.js';

export async function hydrateStudentCmsContent() {
  if (!window.sb) return { lessons: 'legacy', panels: 'legacy' };
  const [lessons, panels] = await Promise.allSettled([hydrateLessons(), hydratePanels()]);
  return {
    lessons: lessons.status === 'fulfilled' && lessons.value ? 'cms' : 'legacy',
    panels: panels.status === 'fulfilled' && panels.value ? 'cms' : 'legacy'
  };
}

async function hydrateLessons() {
  const expectedIds = new Set(LESSONS_DATA.map((lesson) => String(lesson.id)));
  const { data: masters, error } = await window.sb
    .from('cms_lessons')
    .select('id,legacy_id,current_version_id')
    .order('legacy_id');
  if (error) throw error;
  if ((masters || []).length !== expectedIds.size) return false;
  if ((masters || []).some((row) => !expectedIds.has(String(row.legacy_id)) || !row.current_version_id)) return false;

  const versionIds = masters.map((row) => row.current_version_id);
  const [{ data: versions, error: vError }, { data: steps, error: sError }] = await Promise.all([
    window.sb.from('cms_lesson_versions').select('id,lesson_id,title,description,sort_order').in('id', versionIds),
    window.sb.from('cms_lesson_steps').select('lesson_version_id,title,content,sort_order').in('lesson_version_id', versionIds).order('sort_order')
  ]);
  if (vError) throw vError;
  if (sError) throw sError;
  if ((versions || []).length !== masters.length) return false;

  const versionById = new Map((versions || []).map((row) => [row.id, row]));
  const stepsByVersion = new Map();
  (steps || []).forEach((step) => {
    if (!stepsByVersion.has(step.lesson_version_id)) stepsByVersion.set(step.lesson_version_id, []);
    stepsByVersion.get(step.lesson_version_id).push(step);
  });
  if (masters.some((master) => !(stepsByVersion.get(master.current_version_id) || []).length)) return false;

  const legacyById = new Map(LESSONS_DATA.map((lesson) => [String(lesson.id), lesson]));
  const rebuilt = masters.map((master) => {
    const version = versionById.get(master.current_version_id);
    const legacy = legacyById.get(String(master.legacy_id));
    return {
      ...legacy,
      id: Number(master.legacy_id),
      title: version.title,
      description: version.description || '',
      html: (stepsByVersion.get(master.current_version_id) || []).map((step) => step.content).join('')
    };
  }).sort((a, b) => a.id - b.id);

  LESSONS_DATA.splice(0, LESSONS_DATA.length, ...rebuilt);
  return true;
}

async function hydratePanels() {
  const expected = PANELS_DATA.flatMap((category) => category.signs.map((sign) => ({ category: category.id, sign })));
  const expectedIds = new Set(expected.map(({ sign }) => sign.id));
  const { data: masters, error } = await window.sb
    .from('cms_panels')
    .select('id,legacy_id,category,current_version_id');
  if (error) throw error;
  if ((masters || []).length !== expectedIds.size) return false;
  if ((masters || []).some((row) => !expectedIds.has(row.legacy_id) || !row.current_version_id)) return false;

  const versionIds = masters.map((row) => row.current_version_id);
  const { data: versions, error: vError } = await window.sb
    .from('cms_panel_versions')
    .select('id,panel_id,title,description,image_path,audio_fr_path,audio_wo_path,sort_order')
    .in('id', versionIds);
  if (vError) throw vError;
  if ((versions || []).length !== masters.length) return false;

  const versionByPanel = new Map((versions || []).map((version) => [version.panel_id, version]));
  const masterByLegacy = new Map((masters || []).map((master) => [master.legacy_id, master]));
  const rebuiltCategories = PANELS_DATA.map((category) => ({ ...category, signs: [] }));
  const categoryMap = new Map(rebuiltCategories.map((category) => [category.id, category]));

  for (const item of expected) {
    const master = masterByLegacy.get(item.sign.id);
    const version = master && versionByPanel.get(master.id);
    if (!master || !version) return false;
    const targetCategory = categoryMap.get(master.category) || categoryMap.get(item.category);
    if (!targetCategory) return false;
    targetCategory.signs.push({
      ...item.sign,
      name: version.title,
      description: version.description || '',
      image: version.image_path || item.sign.image,
      audioFr: version.audio_fr_path || null,
      audioWo: version.audio_wo_path || null,
      sortOrder: Number(version.sort_order || 0)
    });
  }
  rebuiltCategories.forEach((category) => category.signs.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id.localeCompare(b.id)));
  PANELS_DATA.splice(0, PANELS_DATA.length, ...rebuiltCategories);
  return true;
}
