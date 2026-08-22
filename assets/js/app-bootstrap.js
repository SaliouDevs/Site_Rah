import { hydrateStudentCmsContent } from './services/student-content-service.js';

const HYDRATION_STARTUP_BUDGET_MS = 1200;
window.EAUTO_CONTENT_SOURCE = { lessons: 'legacy', panels: 'legacy' };

const hydrationPromise = hydrateStudentCmsContent()
  .then((source) => {
    window.EAUTO_CONTENT_SOURCE = source || { lessons: 'legacy', panels: 'legacy' };
    window.dispatchEvent(new CustomEvent('cms-content-updated', { detail: window.EAUTO_CONTENT_SOURCE }));
    return window.EAUTO_CONTENT_SOURCE;
  })
  .catch((error) => {
    console.warn('Hydratation CMS différée, fallback historique conservé', error);
    return window.EAUTO_CONTENT_SOURCE;
  });

// Le CMS ne doit jamais bloquer l'affichage de l'application. On lui laisse
// un court budget pour hydrater les données avant le premier rendu, puis on
// démarre quoi qu'il arrive avec le fallback local. La promesse continue en
// arrière-plan et notifiera l'application si les données arrivent ensuite.
await Promise.race([
  hydrationPromise,
  new Promise((resolve) => window.setTimeout(resolve, HYDRATION_STARTUP_BUDGET_MS))
]);

await import('./app.js');
