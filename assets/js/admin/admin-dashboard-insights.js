const insightState = { loading: false, cache: null };

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('admin-view');
  if (!root) return;
  const observer = new MutationObserver(() => queueMicrotask(() => enhanceDashboard(root)));
  observer.observe(root, { childList: true, subtree: true });
  enhanceDashboard(root);
});

async function enhanceDashboard(root) {
  if (!isDashboard(root) || root.querySelector('[data-admin-insights]') || insightState.loading) return;
  insightState.loading = true;
  const anchor = root.querySelector('.admin-heading');
  if (!anchor) { insightState.loading = false; return; }
  const shell = document.createElement('section');
  shell.className = 'admin-dashboard-insights';
  shell.dataset.adminInsights = 'true';
  shell.innerHTML = '<div class="admin-card">Chargement des indicateurs produit...</div>';
  anchor.insertAdjacentElement('afterend', shell);
  try {
    const data = await loadInsights();
    shell.innerHTML = renderInsights(data);
    bindQuickLinks(shell);
  } catch (error) {
    shell.innerHTML = `<div class="admin-alert-strip">Les indicateurs avancés sont momentanément indisponibles : ${escapeHTML(error.message || 'erreur inconnue')}.</div>`;
  } finally {
    insightState.loading = false;
  }
}

function isDashboard(root) {
  return Boolean(root.querySelector('.admin-heading h1')?.textContent?.trim() === 'Tableau de bord');
}

async function loadInsights() {
  if (!window.sb) throw new Error('Supabase indisponible');
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const queries = await Promise.allSettled([
    window.sb.from('profiles').select('id,status,account_role', { count: 'exact' }),
    window.sb.from('instructor_assignments').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    window.sb.from('learning_attempts').select('id', { count: 'exact', head: true }).gte('created_at', start.toISOString()),
    window.sb.from('cms_lessons').select('id,current_version_id'),
    window.sb.from('cms_panels').select('id,current_version_id'),
    window.sb.from('exam_questions').select('id,current_version_id,exam_key'),
    window.sb.from('student_coaching_questions').select('id', { count: 'exact', head: true }).eq('status', 'open')
  ]);
  const value = (index, fallback) => queries[index].status === 'fulfilled' && !queries[index].value.error ? queries[index].value : fallback;
  const profilesRes = value(0, { data: [], count: 0 });
  const profiles = profilesRes.data || [];
  const lessons = value(3, { data: [] }).data || [];
  const panels = value(4, { data: [] }).data || [];
  const questions = value(5, { data: [] }).data || [];
  const students = profiles.filter((p) => p.account_role !== 'instructor');
  const instructors = profiles.filter((p) => p.account_role === 'instructor' && p.status === 'active');
  const lessonPublished = lessons.filter((item) => item.current_version_id).length;
  const panelPublished = panels.filter((item) => item.current_version_id).length;
  const examPublished = questions.filter((item) => item.current_version_id).length;
  const contentChecks = [lessonPublished >= 9, panelPublished > 0, examPublished >= 350];
  const health = Math.round((contentChecks.filter(Boolean).length / contentChecks.length) * 70 + (instructors.length ? 15 : 0) + (students.length ? 15 : 0));
  return {
    total: profilesRes.count ?? profiles.length,
    students: students.length,
    instructors: instructors.length,
    assignments: value(1, { count: 0 }).count || 0,
    attemptsToday: value(2, { count: 0 }).count || 0,
    openQuestions: value(6, { count: 0 }).count || 0,
    lessonPublished,
    lessonTotal: lessons.length,
    panelPublished,
    panelTotal: panels.length,
    examPublished,
    examTotal: questions.length,
    health: Math.max(0, Math.min(100, health))
  };
}

function renderInsights(data) {
  const contentReady = data.lessonPublished >= 9 && data.panelPublished > 0 && data.examPublished >= 350;
  return `
    <div class="admin-command-center">
      <section class="admin-command-main">
        <p class="eyebrow">Centre de pilotage</p>
        <h2>${escapeHTML(window.EAUTO_SCHOOL_SETTINGS?.school_name || 'Auto-école')}</h2>
        <p>Comptes, contenus, moniteurs et activité élève réunis dans un seul cockpit.</p>
        <div class="admin-health-score"><div class="health-ring" style="--health:${data.health}"><strong>${data.health}%</strong></div><div><strong>Santé produit</strong><br><span>${contentReady ? 'Contenus publiés et prêts à être pilotés.' : 'Quelques modules doivent encore être publiés dans le CMS.'}</span></div></div>
      </section>
      <div class="admin-command-side">
        ${metric('fa-user-graduate', 'Élèves', data.students)}
        ${metric('fa-chalkboard-user', 'Moniteurs', data.instructors)}
        ${metric('fa-user-check', 'Affectations', data.assignments)}
        ${metric('fa-bolt', 'Réponses aujourd’hui', data.attemptsToday)}
      </div>
    </div>
    <div class="${data.openQuestions ? 'admin-alert-strip' : 'admin-alert-strip good'}">${data.openQuestions ? `${data.openQuestions} question${data.openQuestions > 1 ? 's' : ''} d’élève attendent une réponse d’un moniteur.` : 'Aucune question élève en attente côté moniteurs.'}</div>
    <div class="admin-quick-grid">
      ${quick('instructors','fa-chalkboard-user','Moniteurs',`${data.assignments} affectation${data.assignments > 1 ? 's' : ''} active${data.assignments > 1 ? 's' : ''}`)}
      ${quick('lessons','fa-book-open','Leçons',`${data.lessonPublished}/${Math.max(data.lessonTotal,9)} publiées`)}
      ${quick('panels','fa-traffic-light','Panneaux',`${data.panelPublished}/${data.panelTotal || '—'} publiés`)}
      ${quick('branding','fa-wand-magic-sparkles','Identité','Marque blanche & contacts')}
    </div>`;
}

function metric(icon, label, value) {
  return `<div class="command-metric"><i class="fas ${icon}"></i><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`;
}
function quick(view, icon, title, text) {
  return `<button class="admin-quick-card" type="button" data-insight-view="${view}"><i class="fas ${icon}"></i><strong>${escapeHTML(title)}</strong><span>${escapeHTML(text)}</span></button>`;
}
function bindQuickLinks(root) {
  root.querySelectorAll('[data-insight-view]').forEach((button) => button.addEventListener('click', () => document.querySelector(`[data-admin-view="${button.dataset.insightView}"]`)?.click()));
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
}
