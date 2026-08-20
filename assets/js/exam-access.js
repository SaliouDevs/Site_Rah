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
    return config[id]?.status === 'online';
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

  function canAccessExam(examId, context) {
    const id = normalizeExamId(examId);
    if (!EXAM_ROUTES[id]) return false;
    const status = getExamStatus(id);
    if (status === 'online') return true;
    return isAdminContext(context) && (status === 'verification' || status === 'offline');
  }

  function getExamUrl(examId) {
    const id = normalizeExamId(examId);
    const route = EXAM_ROUTES[id];
    if (!route) return '#/home';
    return `#${route}`;
  }

  window.canAccessExam = canAccessExam;
  window.isExamEnabled = isExamEnabled;
  window.getExamStatus = getExamStatus;
  window.getExamStatusLabel = getExamStatusLabel;
  window.normalizeExamId = normalizeExamId;
  window.getExamUrl = getExamUrl;
  window.EAUTO_EXAM_ROUTES = EXAM_ROUTES;
})();
