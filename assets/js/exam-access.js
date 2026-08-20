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
    const actualHostname = window.location.hostname;
    const canUseTestHostname = ['localhost', '127.0.0.1', '::1', ''].includes(actualHostname);
    const hostname = canUseTestHostname ? (window.EAUTO_TEST_HOSTNAME || actualHostname) : actualHostname;
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
    if (config[id]?.status === 'online') return true;
    if (config[id]?.status === 'offline' || config[id]?.status === 'verification') return false;
    if (config[id] && typeof config[id].enabled === 'boolean') return config[id].enabled;
    if (id === 'light') return Boolean(config.poidsLegerEnabled);
    if (id === 'heavy') return Boolean(config.poidsLourdEnabled);
    return false;
  }

  function getExamStatus(examId) {
    const id = normalizeExamId(examId);
    const config = window.EXAMS_CONFIG || {};
    return config[id]?.status || (isExamEnabled(id) ? 'online' : 'verification');
  }

  function getExamStatusLabel(examId) {
    return {
      verification: 'En vérification',
      online: 'En ligne',
      offline: 'Hors ligne'
    }[getExamStatus(examId)] || 'En vérification';
  }

  function getPreviewConfig() {
    return window.EXAM_PREVIEW_CONFIG || {
      enabled: false,
      durationMs: 2 * 60 * 60 * 1000,
      storageKey: 'eauto_exam_preview'
    };
  }

  function readTemporaryPreviewSession() {
    try {
      return JSON.parse(sessionStorage.getItem(getPreviewConfig().storageKey) || 'null');
    } catch (_) {
      return null;
    }
  }

  function hasTemporaryExamPreview() {
    if (!getPreviewConfig().enabled) return false;
    const session = readTemporaryPreviewSession();
    return Boolean(session?.expiresAt && Number(session.expiresAt) > Date.now());
  }

  function grantTemporaryExamPreview() {
    const config = getPreviewConfig();
    if (!config.enabled) return null;
    const grantedAt = Date.now();
    const expiresAt = grantedAt + Number(config.durationMs || 0);
    sessionStorage.setItem(config.storageKey, JSON.stringify({ grantedAt, expiresAt }));
    return { grantedAt, expiresAt };
  }

  function canPreviewExam(examId, context) {
    const id = normalizeExamId(examId);
    if (!EXAM_ROUTES[id]) return false;
    const status = getExamStatus(id);
    if (status === 'online') return true;
    if (status !== 'verification') return false;
    return isLocalhost() || isAdminContext(context) || hasTemporaryExamPreview();
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
  window.getExamStatus = getExamStatus;
  window.getExamStatusLabel = getExamStatusLabel;
  window.hasTemporaryExamPreview = hasTemporaryExamPreview;
  window.grantTemporaryExamPreview = grantTemporaryExamPreview;
  window.readTemporaryPreviewSession = readTemporaryPreviewSession;
  window.normalizeExamId = normalizeExamId;
  window.resolveExamPreviewContext = resolveExamPreviewContext;
  window.getExamPreviewUrl = getExamPreviewUrl;
  window.EAUTO_EXAM_ROUTES = EXAM_ROUTES;
})();
