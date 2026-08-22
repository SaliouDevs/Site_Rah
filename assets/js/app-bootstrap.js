import { hydrateStudentCmsContent } from './services/student-content-service.js';

try {
  window.EAUTO_CONTENT_SOURCE = await hydrateStudentCmsContent();
} catch (error) {
  console.warn('Hydratation CMS différée, fallback historique conservé', error);
  window.EAUTO_CONTENT_SOURCE = { lessons: 'legacy', panels: 'legacy' };
}

await import('./app.js');
