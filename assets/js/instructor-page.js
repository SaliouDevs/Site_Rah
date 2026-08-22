import { requireAuthenticatedUser, logoutCurrentUser } from './services/auth-service.js';
import { loadSchoolSettings } from './services/school-service.js';
import {
  addInstructorNote,
  createInstructorGoal,
  loadAssignmentWorkspace,
  loadInstructorStudents,
  replyCoachingQuestion,
  scheduleDrivingSession,
  updateDrivingSession,
  updateInstructorGoalStatus
} from './services/instructor-service.js';

const state = {
  user: null,
  school: null,
  students: [],
  selectedId: null,
  workspace: { notes: [], goals: [], sessions: [], questions: [] },
  search: '',
  loadingWorkspace: false
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const auth = await requireAuthenticatedUser({ allowInstructor: true, allowAdmin: true });
  if (!auth) return;
  if (!auth.profile?.isInstructor && !auth.profile?.isAdmin) {
    await window.sbLogout().catch(() => {});
    window.location.href = 'auth.html?instructor=denied';
    return;
  }
  state.user = auth.profile;
  state.school = await loadSchoolSettings().catch(() => window.EAUTO_SCHOOL_SETTINGS || {});
  applyBrand();
  bindShell();
  await refreshStudents();
}

function applyBrand() {
  document.querySelector('[data-brand-app]').textContent = state.school?.app_name || 'eAutoecole';
  document.querySelector('[data-brand-school]').textContent = `${state.school?.school_name || 'Auto-école'} · Espace Moniteur`;
}

function bindShell() {
  document.querySelector('[data-instructor-logout]')?.addEventListener('click', () => logoutCurrentUser(state.user));
  document.querySelector('[data-student-search]')?.addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderStudentList();
  });
}

async function refreshStudents({ keepSelection = true } = {}) {
  try {
    const students = await loadInstructorStudents();
    state.students = students;
    if (!keepSelection || !students.some((student) => student.assignmentId === state.selectedId)) {
      state.selectedId = students[0]?.assignmentId || null;
    }
    renderStudentList();
    if (state.selectedId) await selectStudent(state.selectedId, { force: true });
    else renderEmptyWorkspace();
  } catch (error) {
    renderFatal(error.message || 'Impossible de charger les élèves.');
  }
}

function renderStudentList() {
  const root = document.querySelector('[data-student-list]');
  const count = document.querySelector('[data-student-count]');
  if (!root || !count) return;
  const filtered = state.students.filter((student) => {
    const haystack = `${student.prenom || ''} ${student.telephone || ''}`.toLowerCase();
    return !state.search || haystack.includes(state.search);
  });
  count.textContent = String(state.students.length);
  root.innerHTML = filtered.length ? filtered.map((student) => `
    <button class="student-item ${student.assignmentId === state.selectedId ? 'active' : ''}" type="button" data-student-id="${escapeAttr(student.assignmentId)}">
      <span class="student-avatar">${escapeHTML(initials(student.prenom))}</span>
      <span class="student-item-copy"><strong>${escapeHTML(student.prenom || 'Élève')}</strong><small>${escapeHTML(formatPhone(student.telephone))}</small></span>
      <span class="student-score">${Number(student.accuracy || 0)}%</span>
    </button>`).join('') : '<div class="empty-panel"><i class="fas fa-user-group"></i>Aucun élève trouvé.</div>';
  root.querySelectorAll('[data-student-id]').forEach((button) => button.addEventListener('click', () => selectStudent(button.dataset.studentId)));
}

async function selectStudent(assignmentId, { force = false } = {}) {
  if (!assignmentId || (state.loadingWorkspace && !force)) return;
  state.selectedId = assignmentId;
  renderStudentList();
  state.loadingWorkspace = true;
  const view = document.getElementById('instructor-view');
  view.innerHTML = '<div class="instructor-loading"><span class="spinner"></span><p>Préparation du dossier élève...</p></div>';
  try {
    state.workspace = await loadAssignmentWorkspace(assignmentId);
    renderWorkspace();
  } catch (error) {
    view.innerHTML = `<div class="empty-panel"><i class="fas fa-triangle-exclamation"></i><strong>Dossier indisponible</strong><p>${escapeHTML(error.message || 'Erreur inconnue')}</p><button class="secondary-button" data-retry>Réessayer</button></div>`;
    view.querySelector('[data-retry]')?.addEventListener('click', () => selectStudent(assignmentId, { force: true }));
  } finally {
    state.loadingWorkspace = false;
  }
}

function renderWorkspace() {
  const student = selectedStudent();
  if (!student) return renderEmptyWorkspace();
  const weak = Array.isArray(student.weakTopics) ? student.weakTopics : [];
  const nextSession = [...state.workspace.sessions].filter((session) => session.status === 'planned' && new Date(session.scheduled_at) >= new Date()).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0];
  const activeGoals = state.workspace.goals.filter((goal) => goal.status === 'active').length;
  const openQuestions = state.workspace.questions.filter((question) => question.status === 'open').length;
  const view = document.getElementById('instructor-view');
  view.innerHTML = `
    <section class="workspace-stack">
      <div class="instructor-toolbar"><div><p class="eyebrow">Dossier pédagogique</p><span>${escapeHTML(state.school?.school_name || 'Auto-école')}</span></div><button class="refresh-button" data-refresh-workspace><i class="fas fa-rotate"></i> Actualiser</button></div>
      <section class="student-hero">
        <div class="student-hero-top">
          <div class="student-identity"><span class="student-avatar">${escapeHTML(initials(student.prenom))}</span><div><p class="eyebrow" style="color:#cfe0f8">Élève suivi</p><h1>${escapeHTML(student.prenom || 'Élève')}</h1><p>${escapeHTML(formatPhone(student.telephone))}</p></div></div>
          <span class="readiness-pill"><i class="fas fa-route"></i> ${Number(student.accuracy || 0)}% précision</span>
        </div>
        <div class="metrics-row">
          <div class="hero-metric"><span>Points</span><strong>${Number(student.points || 0)}</strong></div>
          <div class="hero-metric"><span>Réponses</span><strong>${Number(student.answered || 0)}</strong></div>
          <div class="hero-metric"><span>Objectifs actifs</span><strong>${activeGoals}</strong></div>
          <div class="hero-metric"><span>Questions élève</span><strong>${openQuestions}</strong></div>
        </div>
      </section>
      <div class="coach-grid">
        <div class="workspace-stack">
          <section class="coach-card">
            <div class="card-heading"><div><h2>Priorités pédagogiques</h2><p>Les thèmes les plus fragiles selon les réponses enregistrées.</p></div></div>
            <div class="weak-list">${weak.length ? weak.map(renderWeakTopic).join('') : '<div class="empty-panel"><i class="fas fa-chart-line"></i>Pas encore assez de réponses pour détecter des faiblesses.</div>'}</div>
          </section>
          <section class="coach-card">
            <div class="card-heading"><div><h2>Questions de l’élève</h2><p>Réponds ici, la réponse apparaît dans son Espace Moniteur.</p></div><span class="goal-status">${openQuestions} ouverte${openQuestions > 1 ? 's' : ''}</span></div>
            <div class="question-list">${state.workspace.questions.length ? state.workspace.questions.map(renderQuestion).join('') : '<div class="empty-panel"><i class="fas fa-comments"></i>Aucune question envoyée.</div>'}</div>
          </section>
          <section class="coach-card">
            <div class="card-heading"><div><h2>Objectifs</h2><p>Donne un cap concret avant la prochaine séance.</p></div></div>
            <form class="coach-form" data-goal-form><input name="title" maxlength="220" placeholder="Ex. Maîtriser les priorités à droite" required><div class="form-grid"><input name="dueDate" type="date"><input name="details" maxlength="500" placeholder="Consigne courte (optionnel)"></div><button class="primary-button" type="submit">Ajouter l’objectif</button></form>
            <div class="goal-list" style="margin-top:14px">${state.workspace.goals.length ? state.workspace.goals.map(renderGoal).join('') : '<div class="empty-panel">Aucun objectif pour le moment.</div>'}</div>
          </section>
        </div>
        <div class="workspace-stack">
          <section class="coach-card">
            <div class="card-heading"><div><h2>Prochaine conduite</h2><p>${nextSession ? formatDateTime(nextSession.scheduled_at) : 'Aucune séance planifiée'}</p></div></div>
            <form class="coach-form" data-session-form><input name="scheduledAt" type="datetime-local" required><div class="form-grid"><select name="duration"><option value="45">45 min</option><option value="60" selected>1 h</option><option value="90">1 h 30</option><option value="120">2 h</option></select><input name="location" maxlength="180" placeholder="Lieu de rendez-vous"></div><textarea name="focus" maxlength="800" placeholder="Point principal de la séance"></textarea><button class="primary-button" type="submit">Planifier la séance</button></form>
            <div class="session-list" style="margin-top:14px">${state.workspace.sessions.length ? state.workspace.sessions.slice(0, 8).map(renderSession).join('') : '<div class="empty-panel">Aucune séance enregistrée.</div>'}</div>
          </section>
          <section class="coach-card">
            <div class="card-heading"><div><h2>Compte-rendu</h2><p>Une note visible par l’élève peut l’aider à réviser après la conduite.</p></div></div>
            <form class="coach-form" data-note-form><textarea name="note" maxlength="3000" required placeholder="Ex. Bon placement dans les ronds-points. Revoir le contrôle angle mort avant changement de voie."></textarea><label style="display:flex;align-items:center;gap:8px;font-size:.82rem;font-weight:700"><input type="checkbox" name="visible" checked style="width:auto;min-height:auto"> Visible par l’élève</label><button class="primary-button" type="submit">Enregistrer le compte-rendu</button></form>
            <div class="note-list" style="margin-top:14px">${state.workspace.notes.length ? state.workspace.notes.slice(0, 8).map(renderNote).join('') : '<div class="empty-panel">Aucun compte-rendu.</div>'}</div>
          </section>
        </div>
      </div>
    </section>`;
  bindWorkspaceActions(view);
}

function bindWorkspaceActions(root) {
  root.querySelector('[data-refresh-workspace]')?.addEventListener('click', () => selectStudent(state.selectedId, { force: true }));
  root.querySelector('[data-goal-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    await runForm(form, () => createInstructorGoal(state.selectedId, { title: data.get('title'), details: data.get('details'), dueDate: data.get('dueDate') || null }), 'Objectif ajouté.');
  });
  root.querySelector('[data-session-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const local = data.get('scheduledAt');
    await runForm(form, () => scheduleDrivingSession(state.selectedId, { scheduledAt: new Date(local).toISOString(), durationMinutes: Number(data.get('duration') || 60), location: data.get('location'), focus: data.get('focus') }), 'Séance planifiée.');
  });
  root.querySelector('[data-note-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    await runForm(form, () => addInstructorNote(state.selectedId, data.get('note'), data.get('visible') === 'on'), 'Compte-rendu enregistré.');
  });
  root.querySelectorAll('[data-goal-status]').forEach((button) => button.addEventListener('click', () => runAction(button, () => updateInstructorGoalStatus(button.dataset.goalId, button.dataset.goalStatus), 'Objectif mis à jour.')));
  root.querySelectorAll('[data-session-status]').forEach((button) => button.addEventListener('click', () => openSessionUpdate(button.dataset.sessionId, button.dataset.sessionStatus)));
  root.querySelectorAll('[data-reply-question]').forEach((button) => button.addEventListener('click', () => openReply(button.dataset.replyQuestion)));
}

async function runForm(form, action, success) {
  const button = form.querySelector('[type="submit"]'); setBusy(button, true);
  try { await action(); toast(success); await selectStudent(state.selectedId, { force: true }); }
  catch (error) { toast(error.message || 'Action refusée.', true); setBusy(button, false); }
}
async function runAction(button, action, success) {
  setBusy(button, true); try { await action(); toast(success); await selectStudent(state.selectedId, { force: true }); } catch (error) { toast(error.message || 'Action refusée.', true); setBusy(button, false); }
}

function openReply(questionId) {
  const question = state.workspace.questions.find((item) => item.id === questionId); if (!question) return;
  modal(`<form class="coach-form" data-reply-form><p class="eyebrow">Question de l’élève</p><h2>${escapeHTML(question.question)}</h2>${question.instructor_reply ? `<div class="reply-box">${escapeHTML(question.instructor_reply)}</div>` : ''}<textarea name="reply" maxlength="3000" required placeholder="Ta réponse au point pédagogique..."></textarea><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="close" style="width:auto;min-height:auto"> Clôturer après réponse</label><div class="action-row"><button class="secondary-button" type="button" data-close-modal>Annuler</button><button class="primary-button" type="submit">Envoyer la réponse</button></div></form>`);
  const form = document.querySelector('[data-reply-form]');
  form?.addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(form); await runModalForm(form, () => replyCoachingQuestion(questionId, data.get('reply'), data.get('close') === 'on'), 'Réponse envoyée.'); });
}

function openSessionUpdate(sessionId, nextStatus) {
  const session = state.workspace.sessions.find((item) => item.id === sessionId); if (!session) return;
  modal(`<form class="coach-form" data-session-update><p class="eyebrow">Séance ${escapeHTML(nextStatus === 'completed' ? 'terminée' : 'annulée')}</p><h2>${escapeHTML(formatDateTime(session.scheduled_at))}</h2><textarea name="comment" maxlength="1500" placeholder="Compte-rendu de la séance (optionnel)">${escapeHTML(session.instructor_comment || '')}</textarea><div class="action-row"><button class="secondary-button" type="button" data-close-modal>Annuler</button><button class="primary-button" type="submit">Confirmer</button></div></form>`);
  const form = document.querySelector('[data-session-update]');
  form?.addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(form); await runModalForm(form, () => updateDrivingSession(sessionId, nextStatus, data.get('comment')), 'Séance mise à jour.'); });
}

async function runModalForm(form, action, success) {
  const button = form.querySelector('[type="submit"]'); setBusy(button, true);
  try { await action(); closeModal(); toast(success); await selectStudent(state.selectedId, { force: true }); }
  catch (error) { toast(error.message || 'Action refusée.', true); setBusy(button, false); }
}

function renderWeakTopic(item) { const accuracy = Math.max(0, Math.min(100, Number(item.accuracy || 0))); return `<div class="weak-row"><div><strong>${escapeHTML(item.topic || 'Thème')}</strong><br><small>${Number(item.attempts || 0)} réponses analysées</small></div><strong>${accuracy}%</strong><div class="weak-meter"><span style="width:${accuracy}%"></span></div></div>`; }
function renderGoal(goal) { return `<article class="goal-row ${goal.status === 'done' ? 'done' : ''}"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${escapeHTML(goal.title)}</strong><span class="goal-status">${goal.status === 'done' ? 'Terminé' : goal.status === 'cancelled' ? 'Annulé' : 'Actif'}</span></div>${goal.details ? `<p>${escapeHTML(goal.details)}</p>` : ''}<small>${goal.due_date ? `Échéance ${formatDate(goal.due_date)}` : 'Sans échéance'}</small>${goal.status === 'active' ? `<div class="action-row"><button class="mini-button" data-goal-id="${goal.id}" data-goal-status="done">Marquer terminé</button><button class="mini-button" data-goal-id="${goal.id}" data-goal-status="cancelled">Annuler</button></div>` : ''}</article>`; }
function renderSession(session) { return `<article class="session-row"><div style="display:flex;justify-content:space-between;gap:8px"><span class="session-time">${formatDateTime(session.scheduled_at)}</span><span class="session-status ${escapeAttr(session.status)}">${session.status === 'planned' ? 'Planifiée' : session.status === 'completed' ? 'Terminée' : 'Annulée'}</span></div><small>${Number(session.duration_minutes || 60)} min${session.location ? ` · ${escapeHTML(session.location)}` : ''}</small>${session.focus ? `<p>${escapeHTML(session.focus)}</p>` : ''}${session.instructor_comment ? `<div class="reply-box">${escapeHTML(session.instructor_comment)}</div>` : ''}${session.status === 'planned' ? `<div class="action-row"><button class="mini-button" data-session-id="${session.id}" data-session-status="completed">Terminer</button><button class="mini-button" data-session-id="${session.id}" data-session-status="cancelled">Annuler</button></div>` : ''}</article>`; }
function renderNote(note) { return `<article class="note-row"><small>${formatDateTime(note.created_at)} · ${note.visible_to_student ? 'Visible élève' : 'Interne'}</small><p>${escapeHTML(note.note)}</p></article>`; }
function renderQuestion(question) { return `<article class="question-row ${escapeAttr(question.status)}"><div style="display:flex;justify-content:space-between;gap:8px"><small>${formatDateTime(question.created_at)}</small><span class="goal-status">${question.status === 'open' ? 'À répondre' : question.status === 'answered' ? 'Répondu' : 'Clos'}</span></div><p>${escapeHTML(question.question)}</p>${question.instructor_reply ? `<div class="reply-box"><strong>Réponse</strong><br>${escapeHTML(question.instructor_reply)}</div>` : ''}<div class="action-row"><button class="mini-button" data-reply-question="${question.id}">${question.instructor_reply ? 'Modifier la réponse' : 'Répondre'}</button></div></article>`; }

function renderEmptyWorkspace() { document.getElementById('instructor-view').innerHTML = '<div class="empty-panel" style="margin-top:40px"><i class="fas fa-user-check"></i><strong>Aucun élève affecté</strong><p>L’administrateur peut affecter des élèves depuis le dashboard.</p></div>'; }
function renderFatal(message) { document.getElementById('instructor-view').innerHTML = `<div class="empty-panel" style="margin-top:40px"><i class="fas fa-circle-exclamation"></i><strong>Impossible d’ouvrir l’espace Moniteur</strong><p>${escapeHTML(message)}</p></div>`; }
function selectedStudent() { return state.students.find((student) => student.assignmentId === state.selectedId) || null; }
function initials(name) { return String(name || 'É').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'É'; }
function formatPhone(value) { const digits = String(value || '').replace(/\D/g, ''); return digits.length === 9 ? `${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5,7)} ${digits.slice(7)}` : String(value || ''); }
function formatDate(value) { try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value)); } catch { return String(value || ''); } }
function formatDateTime(value) { try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return String(value || ''); } }
function setBusy(button, busy) { if (!button) return; if (busy) { button.dataset.label = button.textContent; button.disabled = true; button.textContent = 'Patiente...'; } else { button.disabled = false; button.textContent = button.dataset.label || 'Valider'; } }
function modal(html) { const root = document.getElementById('instructor-modal-root'); root.innerHTML = `<div class="instructor-modal-backdrop"><div class="instructor-modal">${html}</div></div>`; root.querySelector('[data-close-modal]')?.addEventListener('click', closeModal); root.querySelector('.instructor-modal-backdrop')?.addEventListener('click', (event) => { if (event.target.classList.contains('instructor-modal-backdrop')) closeModal(); }); }
function closeModal() { document.getElementById('instructor-modal-root').innerHTML = ''; }
function toast(message, error = false) { const root = document.getElementById('instructor-toast-root'); root.innerHTML = `<div class="toast ${error ? 'error' : ''}">${escapeHTML(message)}</div>`; clearTimeout(root.timer); root.timer = setTimeout(() => { root.innerHTML = ''; }, 2800); }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
function escapeAttr(value) { return escapeHTML(value); }
