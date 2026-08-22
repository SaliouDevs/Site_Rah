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

    const currentPath = window.location.hash.replace(/^#/, '') || '/home';
    if (currentPath === '/home') {
      window.EAUTO_RENDER_HOME?.();
      return;
    }

    // Les vues Leçons/Panneaux peuvent avoir été rendues avec le fallback local
    // pendant que le CMS se chargeait. Une fois le contenu publié disponible,
    // on rejoue la route courante pour afficher immédiatement les versions CMS
    // (textes, images et médias audio/vidéo) sans demander un rechargement manuel.
    if (/^\/(lessons|lesson|panels)(\/|$)/.test(currentPath)) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  })
  .catch((error) => {
    console.warn('Hydratation CMS différée, fallback historique conservé', error);
  });
