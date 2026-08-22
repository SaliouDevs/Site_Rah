import { hydrateStudentCmsContent } from './services/student-content-service.js';
import './app.js';

window.EAUTO_CONTENT_SOURCE = { lessons: 'legacy', panels: 'legacy' };

// L'application démarre immédiatement avec le contenu local. Le CMS distant
// s'hydrate ensuite en arrière-plan : aucune latence réseau Supabase ne peut
// empêcher le header, le chargement ou la navigation de s'afficher.
hydrateStudentCmsContent()
  .then((source) => {
    window.EAUTO_CONTENT_SOURCE = source || window.EAUTO_CONTENT_SOURCE;
    window.dispatchEvent(new CustomEvent('cms-content-updated', { detail: window.EAUTO_CONTENT_SOURCE }));

    // Si l'élève est encore sur l'accueil, rafraîchir sans casser sa navigation.
    const currentPath = window.location.hash.replace(/^#/, '') || '/home';
    if (currentPath === '/home') window.EAUTO_RENDER_HOME?.();
  })
  .catch((error) => {
    console.warn('Hydratation CMS différée, fallback historique conservé', error);
  });
