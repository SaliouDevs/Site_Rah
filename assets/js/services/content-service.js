const CMS_TABLES = Object.freeze({
  examSeries: 'exam_series',
  examQuestions: 'exam_questions',
  lessons: 'cms_lessons',
  lessonQuestions: 'cms_lesson_questions',
  panels: 'cms_panels',
  media: 'cms_media_assets'
});

export const CMS_AUDIO_CONFIG = Object.freeze({
  bucket: 'content-audio',
  paths: {
    panelFrench: 'panels/<panel-id>/fr/',
    panelWolof: 'panels/<panel-id>/wo/'
  },
  allowedTypes: ['audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg']
});

export const CMS_UNAVAILABLE_MESSAGE = "Le backend CMS n'est pas encore installé. Les contenus historiques restent utilisés.";

let cmsOverviewCache = null;

export async function loadCmsOverview({ force = false } = {}) {
  if (!force && cmsOverviewCache) return cmsOverviewCache;
  if (!window.sb) {
    cmsOverviewCache = unavailableOverview('Supabase indisponible');
    return cmsOverviewCache;
  }

  try {
    const [series, lessons, panels, media] = await Promise.all([
      countCmsEntity(CMS_TABLES.examSeries),
      countCmsEntity(CMS_TABLES.lessons),
      countCmsEntity(CMS_TABLES.panels),
      countRows(CMS_TABLES.media)
    ]);

    cmsOverviewCache = {
      available: true,
      examSeriesCount: series.total,
      examSeriesPublished: series.published,
      lessonsCount: lessons.total,
      lessonsPublished: lessons.published,
      panelsCount: panels.total,
      panelsPublished: panels.published,
      mediaCount: media,
      audio: CMS_AUDIO_CONFIG,
      error: ''
    };
  } catch (error) {
    console.warn('Erreur détection CMS', error);
    cmsOverviewCache = unavailableOverview(error.message || 'Tables CMS indisponibles');
  }

  return cmsOverviewCache;
}

export function clearCmsOverviewCache() {
  cmsOverviewCache = null;
}

function unavailableOverview(error) {
  return {
    available: false,
    examSeriesCount: 0,
    examSeriesPublished: 0,
    lessonsCount: 0,
    lessonsPublished: 0,
    panelsCount: 0,
    panelsPublished: 0,
    mediaCount: 0,
    audio: CMS_AUDIO_CONFIG,
    error
  };
}

async function countCmsEntity(table) {
  const [totalRes, publishedRes] = await Promise.all([
    window.sb.from(table).select('id', { count: 'exact', head: true }),
    window.sb.from(table).select('id', { count: 'exact', head: true }).not('current_version_id', 'is', null)
  ]);
  
  if (totalRes.error) throw totalRes.error;
  if (publishedRes.error) throw publishedRes.error;

  return {
    total: totalRes.count || 0,
    published: publishedRes.count || 0
  };
}

async function countRows(table) {
  const { error, count } = await window.sb
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}
