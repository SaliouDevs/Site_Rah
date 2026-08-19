(function () {
  const EXAM_ROUTES = {
    light: '/exam/light',
    heavy: '/exam/heavy'
  };

  const LEGACY_IDS = {
    poids_leger: 'light',
    poids_lourd: 'heavy',
    permis_b: 'light',
    permis_c: 'heavy'
  };

  function isLocalhost() {
    const hostname = window.EAUTO_TEST_HOSTNAME || window.location.hostname;
    return ['localhost', '127.0.0.1', '::1', ''].includes(hostname);
  }

  function isAdminContext(context) {
    const user = context?.user || context?.profile || context || window.EAUTO_CURRENT_USER || null;
    if (user?.isAdmin) return true;
    if (user?.app_metadata?.role === 'admin') return true;
    return false;
  }

  function normalizeExamId(examId) {
    const id = String(examId || '').toLowerCase().replace(/[-\s]/g, '_');
    return LEGACY_IDS[id] || id;
  }

  function isExamEnabled(examId) {
    const id = normalizeExamId(examId);
    const config = window.EXAMS_CONFIG || {};
    if (config[id] && typeof config[id].enabled === 'boolean') return config[id].enabled;
    if (id === 'light') return Boolean(config.poidsLegerEnabled);
    if (id === 'heavy') return Boolean(config.poidsLourdEnabled);
    return false;
  }

  function canPreviewExam(examId, context) {
    const id = normalizeExamId(examId);
    if (!EXAM_ROUTES[id]) return false;
    return isExamEnabled(id) || isLocalhost() || isAdminContext(context);
  }

  async function resolveExamPreviewContext() {
    if (window.EAUTO_CURRENT_USER) return window.EAUTO_CURRENT_USER;
    if (isLocalhost()) {
      window.EAUTO_CURRENT_USER = { isDevUser: true, isLocalPreview: true };
      return window.EAUTO_CURRENT_USER;
    }
    if (typeof window.sbGetSession === 'function' && typeof window.sbIsAdmin === 'function') {
      const session = await window.sbGetSession();
      window.EAUTO_CURRENT_USER = {
        isAdmin: window.sbIsAdmin(session?.user),
        isSupabaseUser: !!session?.user
      };
      return window.EAUTO_CURRENT_USER;
    }
    return null;
  }

  function getExamPreviewUrl(examId) {
    const id = normalizeExamId(examId);
    const route = EXAM_ROUTES[id];
    if (!route) return '#/home';
    return `#${route}`;
  }

  window.canPreviewExam = canPreviewExam;
  window.canAccessExam = canPreviewExam;
  window.isExamEnabled = isExamEnabled;
  window.normalizeExamId = normalizeExamId;
  window.resolveExamPreviewContext = resolveExamPreviewContext;
  window.getExamPreviewUrl = getExamPreviewUrl;
  window.EAUTO_EXAM_ROUTES = EXAM_ROUTES;
})();
