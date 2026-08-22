let homeObserver;
let homeTimer = 0;
let homeBusy = false;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHomeStability, { once: true });
else initHomeStability();
window.addEventListener('hashchange', scheduleHomeStability);

function initHomeStability() {
  const root = document.getElementById('app-view');
  if (!root) return;
  homeObserver = new MutationObserver(scheduleHomeStability);
  homeObserver.observe(root, { childList: true, subtree: true });
  scheduleHomeStability();
}

function scheduleHomeStability() {
  clearTimeout(homeTimer);
  homeTimer = setTimeout(stabilizeHome, 70);
}

function stabilizeHome() {
  if (homeBusy) return;
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/home';
  if (path !== '/home') return;
  const root = document.querySelector('.home-view');
  if (!root) return;
  homeBusy = true;
  try {
    const hub = keepOne(root, '[data-learning-hub]');
    const readiness = keepOne(root, '[data-readiness-strip]');
    const coach = keepOne(root, '[data-student-coach-card]');
    if (hub) keepOne(hub, '[data-monitor-card]');

    const hero = root.querySelector('.dashboard-hero');
    const continueCard = root.querySelector('.continue-card');
    let anchor = hero;
    [readiness, continueCard, hub, coach].forEach((node) => {
      if (!node || !anchor || node === anchor) return;
      if (anchor.nextElementSibling !== node) anchor.insertAdjacentElement('afterend', node);
      anchor = node;
    });

    if (window.EAUTO_CURRENT_USER?.isAdmin) renderAdminPreviewBanner(root, hero);
  } finally {
    homeBusy = false;
  }
}

function keepOne(root, selector) {
  const nodes = [...root.querySelectorAll(selector)];
  if (!nodes.length) return null;
  const keeper = nodes[0];
  nodes.slice(1).forEach((node) => node.remove());
  return keeper;
}

function renderAdminPreviewBanner(root, hero) {
  if (!root.querySelector('[data-admin-student-preview]')) {
    const banner = document.createElement('section');
    banner.className = 'admin-student-preview-banner';
    banner.dataset.adminStudentPreview = 'true';
    banner.innerHTML = '<i class="fas fa-eye"></i><div><strong>Aperçu côté élève</strong><span>Tu es connecté comme administrateur. Les points et la progression affichés ici ne représentent pas un vrai élève.</span></div><a href="admin.html">Retour admin</a>';
    hero?.insertAdjacentElement('beforebegin', banner);
  }
  if (hero && hero.dataset.adminPreview !== '1') {
    hero.dataset.adminPreview = '1';
    const title = hero.querySelector('h1');
    if (title) title.textContent = 'Aperçu côté élève';
  }
}
