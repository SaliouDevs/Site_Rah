(function () {
  const APP_CONFIG = {
    name: 'eAutoecole',
    schoolName: 'Auto-école',
    storagePrefix: 'eautoecole'
  };

  const DEV_CONFIG = {
    enabled: true,
    autoLogin: false,
    role: 'normal',
    skipWelcome: true,
    allowedRoles: ['student', 'admin', 'normal']
  };

  const DEMO_CONFIG = {
    enabled: false,
    autoLoginStudent: false,
    showBadge: false
  };

  const ADMIN_CONFIG = {
    alias: 'rah@admin',
    aliasEmail: '762572877@siterah.sn'
  };

  const EXAMS_CONFIG = {
    light: { status: 'verification' },
    heavy: { status: 'verification' },
    poidsLegerEnabled: false,
    poidsLourdEnabled: false
  };

  // TEMPORARY EXAM REVIEW ACCESS
  // REMOVE BEFORE PUBLIC EXAM RELEASE
  const EXAM_PREVIEW_CONFIG = {
    enabled: true,
    pin: '0011',
    durationMs: 2 * 60 * 60 * 1000,
    storageKey: 'eauto_exam_preview'
  };

  const LEARNING_CONFIG = {
    masteryThreshold: 80,
    totalLessons: 9,
    storageKey: 'eautoecole.learningProgress'
  };

  const CONTACT_CONFIG = {
    phone: '77 583 20 37',
    phoneHref: '+221775832037',
    whatsapp: '221775832037',
    email: 'eautoecole1@gmail.com',
    address: 'Dakar HLM5, Castors Parc Nadio, Keurmassar'
  };

  window.APP_CONFIG = APP_CONFIG;
  window.DEV_CONFIG = DEV_CONFIG;
  window.DEMO_CONFIG = DEMO_CONFIG;
  window.ADMIN_CONFIG = ADMIN_CONFIG;
  window.EXAMS_CONFIG = EXAMS_CONFIG;
  window.EXAM_PREVIEW_CONFIG = EXAM_PREVIEW_CONFIG;
  window.LEARNING_CONFIG = LEARNING_CONFIG;
  window.CONTACT_CONFIG = CONTACT_CONFIG;

  window.EAUTO_CONFIG = {
    app: APP_CONFIG,
    dev: DEV_CONFIG,
    demo: DEMO_CONFIG,
    admin: ADMIN_CONFIG,
    exams: EXAMS_CONFIG,
    examPreview: EXAM_PREVIEW_CONFIG,
    learning: LEARNING_CONFIG,
    contact: CONTACT_CONFIG,
    lessons: {
      total: LEARNING_CONFIG.totalLessons,
      storageKey: LEARNING_CONFIG.storageKey
    }
  };
})();
