import {
  assignInstructor,
  createLessonDraft,
  createPanelDraft,
  deleteLessonVersion,
  deleteMediaAsset,
  deletePanelVersion,
  endInstructorAssignment,
  getMediaPublicUrl,
  legacyLessonCount,
  legacyPanelCount,
  loadCmsLessons,
  loadCmsPanels,
  loadLessonVersion,
  loadMediaAssets,
  loadPeopleWorkspace,
  loadSchoolSettings,
  publishLesson,
  publishPanel,
  restoreLessonVersion,
  restorePanelVersion,
  saveLessonDraft,
  savePanelDraft,
  saveSchoolSettings,
  seedLegacyLessons,
  seedLegacyPanels,
  setAccountRole,
  uploadMediaAsset
} from '../services/admin-product-service.js';

const MANAGED_VIEWS = new Set(['instructors', 'lessons', 'panels', 'media', 'branding']);
const state = {
  view: null,
  people: null,
  lessons: null,
  panels: null,
  media: [],
  school: null,
  lessonId: null,
  lessonVersionId: null,
  panelId: null,
  panelVersionId: null,
  panelQuery: '',
  mediaFilter: 'all',
  busy: false
};

document.addEventListener('DOMContentLoaded', initProductSuite);

function initProductSuite() {
  const nav = document.querySelector('.admin-nav');
  if (!nav) return;
  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-view]');
    if (!button || !MANAGED_VIEWS.has(button.dataset.adminView)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openProductView(button.dataset.adminView);
  }, true);
  document.addEventListener('school-settings-ready', (event) => applyAdminBrand(event.detail));
  if (window.EAUTO_SCHOOL_SETTINGS) applyAdminBrand(window.EAUTO_SCHOOL_SETTINGS);
}

async function openProductView(view) {
  if (state.busy) return;
  state.view = view;
  setActiveNav(view);
  showLoader(productTitle(view));
  try {
    if (view === 'instructors') await renderInstructors();
    if (view === 'lessons') await renderLessons();
    if (view === 'panels') await renderPanels();
    if (view === 'media') await renderMedia();
    if (view === 'branding') await renderBranding();
  } catch (error) {
    console.error(`Vue ${view} indisponible`, error);
    renderError(error.message || 'Module indisponible.');
  }
}

function setActiveNav(view) {
  document.querySelectorAll('[data-admin-view]').forEach((button) => button.classList.toggle('active', button.dataset.adminView === view));
}

async function renderInstructors() {
  state.people = await loadPeopleWorkspace();
  const profiles = state.people.profiles;
  const assignments = state.people.assignments;
  const instructors = profiles.filter((profile) => profile.account_role === 'instructor');
  const students = profiles.filter((profile) => profile.account_role !== 'instructor' && profile.status === 'active');
  const activeAssignments = assignments.filter((assignment) => assignment.status === 'active');
  const assignedByStudent = new Map(activeAssignments.map((assignment) => [assignment.student_id, assignment]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  setView(`
    <section class="product-view">
      ${hero('Équipe pédagogique', 'Moniteurs & affectations', 'Transforme les résultats numériques en accompagnement humain : un élève, un moniteur référent, des objectifs et des séances suivies.')}
      <div class="product-stat-grid">
        ${stat('Moniteurs actifs', instructors.filter((p) => p.status === 'active').length)}
        ${stat('Élèves actifs', students.length)}
        ${stat('Élèves affectés', activeAssignments.length)}
        ${stat('Sans moniteur', Math.max(0, students.length - activeAssignments.length))}
      </div>
      <section class="admin-card">
        <div class="card-heading"><div><h2>Affecter un moniteur</h2><p class="product-muted">Une nouvelle affectation remplace automatiquement l’ancienne.</p></div><a class="admin-secondary product-link-button" href="instructor.html" target="_blank" rel="noopener">Aperçu espace Moniteur</a></div>
        <form class="editor-form" data-assignment-form>
          <div class="editor-grid">
            <label>Moniteur<select name="instructor" required><option value="">Choisir...</option>${instructors.filter((p) => p.status === 'active').map((p) => `<option value="${escapeAttr(p.id)}">${escapeHTML(p.prenom)} · ${escapeHTML(formatPhone(p.telephone))}</option>`).join('')}</select></label>
            <label>Élève<select name="student" required><option value="">Choisir...</option>${students.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHTML(p.prenom)} · ${escapeHTML(formatPhone(p.telephone))}${assignedByStudent.has(p.id) ? ' · déjà affecté' : ''}</option>`).join('')}</select></label>
          </div>
          <div class="editor-actions"><button class="primary-product" type="submit" ${!instructors.length ? 'disabled' : ''}>Affecter</button></div>
        </form>
      </section>
      <section>
        <div class="product-toolbar"><div><p class="eyebrow">Comptes moniteurs</p><h2 style="margin:3px 0 0">Équipe</h2></div></div>
        <div class="people-grid" style="margin-top:12px">
          ${instructors.length ? instructors.map((person) => renderInstructorCard(person, activeAssignments, profileById)).join('') : `<div class="empty-product"><i class="fas fa-chalkboard-user"></i><strong>Aucun moniteur</strong><span>Transforme un utilisateur existant en compte Moniteur ci-dessous.</span></div>`}
        </div>
      </section>
      <section class="admin-card">
        <div class="card-heading"><div><h2>Créer l’équipe à partir des utilisateurs</h2><p class="product-muted">Le rôle est appliqué côté Auth Supabase, pas seulement dans l’interface.</p></div></div>
        <div class="people-grid">
          ${profiles.filter((p) => p.account_role !== 'instructor').slice(0, 60).map((person) => `<article class="person-card"><div class="person-head"><span class="person-avatar">${initials(person.prenom)}</span><div class="person-copy"><strong>${escapeHTML(person.prenom)}</strong><small>${escapeHTML(formatPhone(person.telephone))}</small></div><span class="role-pill">Élève</span></div><button class="secondary-product" data-promote-instructor="${escapeAttr(person.id)}" ${person.status !== 'active' ? 'disabled' : ''}>Passer en Moniteur</button></article>`).join('') || '<div class="empty-product">Aucun utilisateur disponible.</div>'}
        </div>
      </section>
    </section>`);

  document.querySelector('[data-assignment-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    await runButton(form.querySelector('[type="submit"]'), async () => { await assignInstructor(data.get('instructor'), data.get('student')); await renderInstructors(); }, 'Élève affecté au moniteur.');
  });
  document.querySelectorAll('[data-promote-instructor]').forEach((button) => button.addEventListener('click', () => confirmAction('Créer un compte Moniteur ?', 'Cet utilisateur ouvrira désormais l’espace Moniteur après connexion.', 'Passer en Moniteur', () => runButton(button, async () => { await setAccountRole(button.dataset.promoteInstructor, 'instructor'); await renderInstructors(); }, 'Rôle Moniteur activé.'))));
  document.querySelectorAll('[data-demote-instructor]').forEach((button) => button.addEventListener('click', () => confirmAction('Repasser ce moniteur en élève ?', 'Ses affectations actives seront terminées automatiquement.', 'Confirmer', () => runButton(button, async () => { await setAccountRole(button.dataset.demoteInstructor, 'student'); await renderInstructors(); }, 'Compte repassé en élève.'))));
  document.querySelectorAll('[data-end-assignment]').forEach((button) => button.addEventListener('click', () => confirmAction('Terminer cette affectation ?', 'L’historique pédagogique reste conservé.', 'Terminer', () => runButton(button, async () => { await endInstructorAssignment(button.dataset.endAssignment); await renderInstructors(); }, 'Affectation terminée.'))));
}

function renderInstructorCard(person, activeAssignments, profileById) {
  const mine = activeAssignments.filter((assignment) => assignment.instructor_id === person.id);
  return `<article class="person-card"><div class="person-head"><span class="person-avatar">${initials(person.prenom)}</span><div class="person-copy"><strong>${escapeHTML(person.prenom)}</strong><small>${escapeHTML(formatPhone(person.telephone))}</small></div><span class="role-pill instructor">Moniteur</span></div><div class="assignment-card"><strong>${mine.length} élève${mine.length > 1 ? 's' : ''} suivi${mine.length > 1 ? 's' : ''}</strong>${mine.slice(0, 5).map((assignment) => { const student = profileById.get(assignment.student_id); return `<div class="assignment-line"><span>${escapeHTML(student?.prenom || 'Élève')}</span><button class="danger-product" style="min-height:31px;padding:0 8px" data-end-assignment="${assignment.id}">Fin</button></div>`; }).join('')}${mine.length > 5 ? `<small>+${mine.length - 5} autres</small>` : ''}</div><button class="secondary-product" data-demote-instructor="${escapeAttr(person.id)}">Repasser en élève</button></article>`;
}

async function renderLessons({ keepSelection = true } = {}) {
  state.lessons = await loadCmsLessons();
  if (!keepSelection || !state.lessons.masters.some((item) => item.id === state.lessonId)) state.lessonId = state.lessons.masters[0]?.id || null;
  setView(`
    <section class="product-view">
      ${hero('Contenu pédagogique', 'Leçons', 'Édite, prévisualise, publie et restaure les leçons sans toucher au code. Une version publiée reste protégée pendant qu’un brouillon évolue.')}
      ${state.lessons.masters.length ? '' : seedCard('Aucune leçon CMS publiée', `Importer les ${legacyLessonCount()} leçons actuellement utilisées par l’application crée une V1 fidèle, sans interrompre les élèves.`, 'Importer les leçons', 'lessons')}
      <div class="product-stat-grid">${stat('Leçons CMS', state.lessons.masters.length)}${stat('Publiées', state.lessons.masters.filter((m) => m.current_version_id).length)}${stat('Brouillons', state.lessons.versions.filter((v) => v.status === 'draft').length)}${stat('Versions archivées', state.lessons.versions.filter((v) => v.status === 'archived').length)}</div>
      ${state.lessons.masters.length ? `<div class="product-workspace"><aside class="product-sidebar">${state.lessons.masters.map(renderLessonListItem).join('')}</aside><section class="product-editor" data-lesson-editor>${emptyEditor('Sélectionne une leçon')}</section></div>` : ''}
    </section>`);
  bindSeedButton('lessons');
  document.querySelectorAll('[data-lesson-id]').forEach((button) => button.addEventListener('click', () => { state.lessonId = button.dataset.lessonId; state.lessonVersionId = null; renderLessons(); }));
  if (state.lessonId) await renderLessonEditor();
}

function renderLessonListItem(master) {
  const versions = state.lessons.versions.filter((v) => v.lesson_id === master.id);
  const current = versions.find((v) => v.id === master.current_version_id);
  const draft = versions.find((v) => v.status === 'draft');
  return `<button class="product-list-item ${master.id === state.lessonId ? 'active' : ''}" data-lesson-id="${master.id}"><strong>${escapeHTML(current?.title || `Leçon ${master.legacy_id}`)}</strong><span class="product-list-status ${draft ? 'draft' : 'published'}">${draft ? 'Brouillon' : 'En ligne'}</span><small>Leçon ${escapeHTML(master.legacy_id || '')} · ${versions.length} version${versions.length > 1 ? 's' : ''}</small></button>`;
}

async function renderLessonEditor() {
  const root = document.querySelector('[data-lesson-editor]'); if (!root) return;
  const master = state.lessons.masters.find((item) => item.id === state.lessonId); if (!master) return;
  const versions = state.lessons.versions.filter((v) => v.lesson_id === master.id).sort((a, b) => b.version_number - a.version_number);
  const draft = versions.find((v) => v.status === 'draft');
  const selectedId = state.lessonVersionId && versions.some((v) => v.id === state.lessonVersionId) ? state.lessonVersionId : (draft?.id || master.current_version_id || versions[0]?.id);
  state.lessonVersionId = selectedId;
  root.innerHTML = '<div class="product-loader"><span class="spinner"></span><span>Chargement de la version...</span></div>';
  const detail = await loadLessonVersion(selectedId);
  const version = detail.version;
  const html = detail.steps.map((step) => step.content).join('');
  const editable = version.status === 'draft';
  root.innerHTML = `
    <div class="editor-head"><div><p class="eyebrow">Leçon ${escapeHTML(master.legacy_id || '')}</p><h2>${escapeHTML(version.title)}</h2></div><span class="product-list-status ${version.status}">${version.status === 'published' ? 'En ligne' : version.status === 'draft' ? 'Brouillon' : 'Archivée'}</span></div>
    <div class="version-strip">${versions.map((item) => `<button class="version-chip ${item.id === master.current_version_id ? 'current' : item.status} ${item.id === selectedId ? 'active' : ''}" data-lesson-version="${item.id}">V${item.version_number} · ${item.id === master.current_version_id ? 'en ligne' : item.status}</button>`).join('')}</div>
    ${editable ? `<form class="editor-form" data-lesson-form><label>Titre<input name="title" maxlength="220" value="${escapeAttr(version.title)}" required></label><label>Description<input name="description" maxlength="500" value="${escapeAttr(version.description || '')}"></label><div><div class="editor-toolbar"><button type="button" data-format="bold"><i class="fas fa-bold"></i></button><button type="button" data-format="italic"><i class="fas fa-italic"></i></button><button type="button" data-format="insertUnorderedList"><i class="fas fa-list-ul"></i></button><button type="button" data-format="formatBlock" data-format-value="h3">Titre</button><button type="button" data-format="formatBlock" data-format-value="p">Texte</button></div><div class="visual-editor" contenteditable="true" data-lesson-html>${sanitizeForEditor(html)}</div></div><div class="editor-actions"><button class="primary-product" type="submit">Enregistrer</button><button class="secondary-product" type="button" data-preview-lesson>Aperçu</button><button class="primary-product" type="button" data-publish-lesson>Publier V${version.version_number}</button><button class="danger-product" type="button" data-delete-lesson-version>Supprimer le brouillon</button></div></form>` : `<div class="preview-panel">${sanitizeForEditor(html)}</div><div class="editor-actions"><button class="secondary-product" type="button" data-preview-lesson>Aperçu plein écran</button>${version.id === master.current_version_id ? `<button class="primary-product" type="button" data-create-lesson-draft>${draft ? 'Ouvrir le brouillon' : 'Créer un brouillon'}</button>` : `<button class="secondary-product" type="button" data-restore-lesson-version>Restaurer comme nouveau brouillon</button><button class="danger-product" type="button" data-delete-lesson-version>Supprimer cette version</button>`}</div>`}`;
  root.querySelectorAll('[data-lesson-version]').forEach((button) => button.addEventListener('click', () => { state.lessonVersionId = button.dataset.lessonVersion; renderLessonEditor(); }));
  root.querySelectorAll('[data-format]').forEach((button) => button.addEventListener('click', () => { document.execCommand(button.dataset.format, false, button.dataset.formatValue || null); root.querySelector('[data-lesson-html]')?.focus(); }));
  root.querySelector('[data-preview-lesson]')?.addEventListener('click', () => previewHtml(root.querySelector('[data-lesson-html]')?.innerHTML || html, version.title));
  root.querySelector('[data-create-lesson-draft]')?.addEventListener('click', async (event) => runButton(event.currentTarget, async () => { const id = draft?.id || await createLessonDraft(master.id); state.lessonVersionId = id; await renderLessons(); }, draft ? 'Brouillon ouvert.' : 'Brouillon créé.'));
  root.querySelector('[data-lesson-form]')?.addEventListener('submit', async (event) => { event.preventDefault(); await saveCurrentLesson(event.currentTarget, false); });
  root.querySelector('[data-publish-lesson]')?.addEventListener('click', async (event) => { const form = root.querySelector('[data-lesson-form]'); await runButton(event.currentTarget, async () => { await persistLessonForm(master.id, version.id, form); await publishLesson(master.id, version.id); state.lessonVersionId = null; await renderLessons(); }, 'Leçon publiée.'); });
  root.querySelector('[data-restore-lesson-version]')?.addEventListener('click', () => confirmAction('Restaurer cette version ?', 'Une nouvelle version brouillon sera créée à partir de ce contenu.', 'Restaurer', () => runButton(root.querySelector('[data-restore-lesson-version]'), async () => { state.lessonVersionId = await restoreLessonVersion(master.id, version.id); await renderLessons(); }, 'Version restaurée en brouillon.')));
  root.querySelector('[data-delete-lesson-version]')?.addEventListener('click', () => confirmAction('Supprimer cette version ?', 'La version actuellement en ligne est protégée. Un snapshot d’audit est conservé.', 'Supprimer', () => runButton(root.querySelector('[data-delete-lesson-version]'), async () => { await deleteLessonVersion(master.id, version.id); state.lessonVersionId = null; await renderLessons(); }, 'Version supprimée.')));
}

async function saveCurrentLesson(form, publish) { const master = state.lessons.masters.find((m) => m.id === state.lessonId); const versionId = state.lessonVersionId; const button = form.querySelector('[type="submit"]'); await runButton(button, async () => { await persistLessonForm(master.id, versionId, form); if (publish) await publishLesson(master.id, versionId); await renderLessons(); }, publish ? 'Leçon publiée.' : 'Brouillon enregistré.'); }
async function persistLessonForm(lessonId, versionId, form) { const title = form.elements.title.value.trim(); const description = form.elements.description.value.trim(); const html = sanitizeLessonHtml(form.querySelector('[data-lesson-html]').innerHTML); if (!title || !html.replace(/<[^>]+>/g, '').trim()) throw new Error('Titre et contenu requis.'); await saveLessonDraft(lessonId, versionId, { title, description, html }); }

async function renderPanels({ keepSelection = true } = {}) {
  state.panels = await loadCmsPanels();
  if (!keepSelection || !state.panels.masters.some((item) => item.id === state.panelId)) state.panelId = state.panels.masters[0]?.id || null;
  const filtered = filteredPanels();
  setView(`
    <section class="product-view">
      ${hero('Signalisation', 'Panneaux & audio', 'Gère le nom, la signification, l’image et les pistes audio Français/Wolof de chaque panneau avec historique de versions.')}
      ${state.panels.masters.length ? '' : seedCard('Aucun panneau CMS publié', `Importer les ${legacyPanelCount()} panneaux actuels crée une V1 fidèle et active le CMS sans casser l’affichage élève.`, 'Importer les panneaux', 'panels')}
      <div class="product-stat-grid">${stat('Panneaux CMS', state.panels.masters.length)}${stat('Publiés', state.panels.masters.filter((m) => m.current_version_id).length)}${stat('Brouillons', state.panels.versions.filter((v) => v.status === 'draft').length)}${stat('Avec audio', state.panels.versions.filter((v) => v.status === 'published' && (v.audio_fr_path || v.audio_wo_path)).length)}</div>
      ${state.panels.masters.length ? `<div class="product-toolbar"><input class="product-search" data-panel-search placeholder="Rechercher panneau ou catégorie" value="${escapeAttr(state.panelQuery)}"><span class="product-muted">${filtered.length} résultat${filtered.length > 1 ? 's' : ''}</span></div><div class="product-workspace"><aside class="product-sidebar">${filtered.map(renderPanelListItem).join('') || '<div class="empty-product">Aucun panneau trouvé.</div>'}</aside><section class="product-editor" data-panel-editor>${emptyEditor('Sélectionne un panneau')}</section></div>` : ''}
    </section>`);
  bindSeedButton('panels');
  document.querySelector('[data-panel-search]')?.addEventListener('input', (event) => { state.panelQuery = event.target.value; renderPanels(); });
  document.querySelectorAll('[data-panel-id]').forEach((button) => button.addEventListener('click', () => { state.panelId = button.dataset.panelId; state.panelVersionId = null; renderPanels(); }));
  if (state.panelId) renderPanelEditor();
}

function filteredPanels() { const query = state.panelQuery.trim().toLowerCase(); if (!query) return state.panels.masters; const currentById = new Map(state.panels.versions.map((v) => [v.id, v])); return state.panels.masters.filter((master) => `${master.legacy_id} ${master.category} ${currentById.get(master.current_version_id)?.title || ''}`.toLowerCase().includes(query)); }
function renderPanelListItem(master) { const versions = state.panels.versions.filter((v) => v.panel_id === master.id); const current = versions.find((v) => v.id === master.current_version_id); const draft = versions.find((v) => v.status === 'draft'); return `<button class="product-list-item ${master.id === state.panelId ? 'active' : ''}" data-panel-id="${master.id}"><strong>${escapeHTML(current?.title || master.legacy_id)}</strong><span class="product-list-status ${draft ? 'draft' : 'published'}">${draft ? 'Brouillon' : 'En ligne'}</span><small>${escapeHTML(master.category)} · ${escapeHTML(master.legacy_id)}</small></button>`; }

function renderPanelEditor() {
  const root = document.querySelector('[data-panel-editor]'); if (!root) return;
  const master = state.panels.masters.find((item) => item.id === state.panelId); if (!master) return;
  const versions = state.panels.versions.filter((v) => v.panel_id === master.id).sort((a, b) => b.version_number - a.version_number);
  const draft = versions.find((v) => v.status === 'draft');
  const selectedId = state.panelVersionId && versions.some((v) => v.id === state.panelVersionId) ? state.panelVersionId : (draft?.id || master.current_version_id || versions[0]?.id);
  state.panelVersionId = selectedId;
  const version = versions.find((v) => v.id === selectedId); const editable = version.status === 'draft';
  root.innerHTML = `<div class="editor-head"><div><p class="eyebrow">${escapeHTML(master.category)} · ${escapeHTML(master.legacy_id)}</p><h2>${escapeHTML(version.title)}</h2></div><span class="product-list-status ${version.status}">${version.id === master.current_version_id ? 'En ligne' : version.status}</span></div><div class="version-strip">${versions.map((item) => `<button class="version-chip ${item.id === master.current_version_id ? 'current' : item.status} ${item.id === selectedId ? 'active' : ''}" data-panel-version="${item.id}">V${item.version_number} · ${item.id === master.current_version_id ? 'en ligne' : item.status}</button>`).join('')}</div>${editable ? panelForm(master, version) : panelReadonly(master, version, draft)}`;
  root.querySelectorAll('[data-panel-version]').forEach((button) => button.addEventListener('click', () => { state.panelVersionId = button.dataset.panelVersion; renderPanelEditor(); }));
  root.querySelector('[data-create-panel-draft]')?.addEventListener('click', async (event) => runButton(event.currentTarget, async () => { state.panelVersionId = draft?.id || await createPanelDraft(master.id); await renderPanels(); }, draft ? 'Brouillon ouvert.' : 'Brouillon créé.'));
  root.querySelector('[data-panel-form]')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; await runButton(form.querySelector('[type="submit"]'), async () => { await persistPanelForm(master.id, version.id, form); await renderPanels(); }, 'Brouillon enregistré.'); });
  root.querySelector('[data-publish-panel]')?.addEventListener('click', async (event) => { const form = root.querySelector('[data-panel-form]'); await runButton(event.currentTarget, async () => { await persistPanelForm(master.id, version.id, form); await publishPanel(master.id, version.id); state.panelVersionId = null; await renderPanels(); }, 'Panneau publié.'); });
  root.querySelector('[data-preview-panel]')?.addEventListener('click', () => previewPanel(root.querySelector('[data-panel-form]') ? readPanelForm(root.querySelector('[data-panel-form]')) : version));
  root.querySelector('[data-restore-panel-version]')?.addEventListener('click', () => confirmAction('Restaurer cette version ?', 'Une copie brouillon sera créée.', 'Restaurer', () => runButton(root.querySelector('[data-restore-panel-version]'), async () => { state.panelVersionId = await restorePanelVersion(master.id, version.id); await renderPanels(); }, 'Version restaurée.')));
  root.querySelector('[data-delete-panel-version]')?.addEventListener('click', () => confirmAction('Supprimer cette version ?', 'La version en ligne ne peut jamais être supprimée.', 'Supprimer', () => runButton(root.querySelector('[data-delete-panel-version]'), async () => { await deletePanelVersion(master.id, version.id); state.panelVersionId = null; await renderPanels(); }, 'Version supprimée.')));
}

function panelForm(master, version) { return `<form class="editor-form" data-panel-form><div class="editor-grid"><label>Catégorie<input name="category" value="${escapeAttr(master.category)}" required></label><label>Titre<input name="title" value="${escapeAttr(version.title)}" required></label></div><label>Signification<textarea name="description">${escapeHTML(version.description || '')}</textarea></label><label>Image · URL ou chemin<input name="imagePath" value="${escapeAttr(version.image_path || '')}" placeholder="Images/... ou URL du gestionnaire Médias"></label><div class="editor-grid"><label>Audio Français<input name="audioFrPath" value="${escapeAttr(version.audio_fr_path || '')}" placeholder="URL audio"></label><label>Audio Wolof<input name="audioWoPath" value="${escapeAttr(version.audio_wo_path || '')}" placeholder="URL audio"></label></div><div class="editor-actions"><button class="primary-product" type="submit">Enregistrer</button><button class="secondary-product" type="button" data-preview-panel>Aperçu</button><button class="primary-product" type="button" data-publish-panel>Publier V${version.version_number}</button><button class="danger-product" type="button" data-delete-panel-version>Supprimer brouillon</button></div></form>`; }
function panelReadonly(master, version, draft) { return `<div class="preview-panel"><div style="display:grid;grid-template-columns:minmax(160px,260px) 1fr;gap:18px;align-items:center">${version.image_path ? `<img src="${escapeAttr(version.image_path)}" alt="" style="width:100%;max-height:220px;object-fit:contain">` : '<div class="empty-product">Sans image</div>'}<div><p class="eyebrow">${escapeHTML(master.category)}</p><h2>${escapeHTML(version.title)}</h2><p>${escapeHTML(version.description || '')}</p>${version.audio_fr_path ? `<audio controls src="${escapeAttr(version.audio_fr_path)}" style="width:100%"></audio>` : ''}${version.audio_wo_path ? `<audio controls src="${escapeAttr(version.audio_wo_path)}" style="width:100%"></audio>` : ''}</div></div></div><div class="editor-actions"><button class="secondary-product" data-preview-panel>Aperçu</button>${version.id === master.current_version_id ? `<button class="primary-product" data-create-panel-draft>${draft ? 'Ouvrir le brouillon' : 'Créer un brouillon'}</button>` : `<button class="secondary-product" data-restore-panel-version>Restaurer</button><button class="danger-product" data-delete-panel-version>Supprimer cette version</button>`}</div>`; }
function readPanelForm(form) { return { category: form.elements.category.value.trim(), title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), imagePath: form.elements.imagePath.value.trim(), audioFrPath: form.elements.audioFrPath.value.trim(), audioWoPath: form.elements.audioWoPath.value.trim() }; }
async function persistPanelForm(panelId, versionId, form) { const values = readPanelForm(form); if (!values.category || !values.title) throw new Error('Catégorie et titre requis.'); await savePanelDraft(panelId, versionId, values); }

async function renderMedia() {
  state.media = await loadMediaAssets();
  const shown = state.media.filter((asset) => state.mediaFilter === 'all' || asset.media_kind === state.mediaFilter);
  setView(`<section class="product-view">${hero('Bibliothèque', 'Médias', 'Centralise les images et audios utilisés par les panneaux et contenus. Les fichiers restent dans Supabase Storage et peuvent être réutilisés partout.')}<div class="product-stat-grid">${stat('Fichiers', state.media.length)}${stat('Images', state.media.filter((a) => a.media_kind === 'image').length)}${stat('Audios', state.media.filter((a) => a.media_kind === 'audio').length)}${stat('Wolof', state.media.filter((a) => a.language === 'wo').length)}</div><section class="media-drop" data-media-drop><i class="fas fa-cloud-arrow-up" style="font-size:1.7rem;color:var(--school-primary)"></i><strong>Dépose des images ou audios ici</strong><span class="product-muted">JPEG, PNG, WebP, GIF, MP3, M4A, WAV, OGG, WebM · 15 Mo max</span><div class="product-toolbar-group"><button class="primary-product" data-pick-media>Choisir des fichiers</button><select class="product-search" style="min-width:150px" data-media-language><option value="">Langue neutre</option><option value="fr">Français</option><option value="wo">Wolof</option></select></div><input type="file" data-media-input hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm"></section><div class="product-toolbar"><div class="product-toolbar-group"><button class="secondary-product" data-media-filter="all">Tous</button><button class="secondary-product" data-media-filter="image">Images</button><button class="secondary-product" data-media-filter="audio">Audios</button></div><span class="product-muted">${shown.length} fichier${shown.length > 1 ? 's' : ''}</span></div><div class="media-grid">${shown.map(renderMediaCard).join('') || '<div class="empty-product"><i class="fas fa-photo-film"></i><strong>Bibliothèque vide</strong><span>Ajoute un premier média.</span></div>'}</div></section>`);
  document.querySelectorAll('[data-media-filter]').forEach((button) => button.addEventListener('click', () => { state.mediaFilter = button.dataset.mediaFilter; renderMedia(); }));
  const input = document.querySelector('[data-media-input]'); const drop = document.querySelector('[data-media-drop]');
  document.querySelector('[data-pick-media]')?.addEventListener('click', () => input.click());
  input?.addEventListener('change', () => uploadSelectedMedia([...input.files]));
  ['dragenter','dragover'].forEach((name) => drop?.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave','drop'].forEach((name) => drop?.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove('dragover'); }));
  drop?.addEventListener('drop', (event) => uploadSelectedMedia([...event.dataTransfer.files]));
  document.querySelectorAll('[data-copy-media]').forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard.writeText(button.dataset.copyMedia); toast('URL copiée.'); }));
  document.querySelectorAll('[data-delete-media]').forEach((button) => button.addEventListener('click', () => { const asset = state.media.find((item) => item.id === button.dataset.deleteMedia); if (!asset) return; confirmAction('Supprimer ce média ?', 'Le fichier sera retiré du Storage. Vérifie qu’aucun contenu publié ne dépend encore de son URL.', 'Supprimer', () => runButton(button, async () => { await deleteMediaAsset(asset); await renderMedia(); }, 'Média supprimé.')); }));
}

function renderMediaCard(asset) { const url = getMediaPublicUrl(asset); return `<article class="media-card"><div class="media-preview">${asset.media_kind === 'image' ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(asset.alt_text || '')}" loading="lazy">` : `<i class="fas fa-wave-square"></i>`}</div><div class="media-body"><strong>${escapeHTML(asset.title || asset.storage_path)}</strong><small>${escapeHTML(asset.media_kind)}${asset.language ? ` · ${escapeHTML(asset.language.toUpperCase())}` : ''}</small>${asset.media_kind === 'audio' ? `<audio controls src="${escapeAttr(url)}" style="width:100%"></audio>` : ''}<div class="media-url">${escapeHTML(url)}</div><div class="editor-actions"><button class="secondary-product" style="min-height:34px" data-copy-media="${escapeAttr(url)}">Copier URL</button><button class="danger-product" style="min-height:34px" data-delete-media="${asset.id}">Supprimer</button></div></div></article>`; }
async function uploadSelectedMedia(files) { if (!files.length) return; const lang = document.querySelector('[data-media-language]')?.value || null; const trigger = document.querySelector('[data-pick-media]'); setBusy(trigger, true); try { let done = 0; for (const file of files) { await uploadMediaAsset(file, { language: lang }); done += 1; trigger.textContent = `${done}/${files.length} envoyé${done > 1 ? 's' : ''}`; } toast(`${done} média${done > 1 ? 's' : ''} ajouté${done > 1 ? 's' : ''}.`); await renderMedia(); } catch (error) { toast(error.message || 'Upload refusé.', true); setBusy(trigger, false); } }

async function renderBranding() {
  state.school = await loadSchoolSettings({ force: true });
  setView(`<section class="product-view">${hero('Marque blanche', 'Identité de l’auto-école', 'Adapte le nom, les contacts, les messages et les couleurs sans modifier le code. C’est la base pour vendre la même plateforme à plusieurs auto-écoles.')}<div class="branding-layout"><form class="admin-card editor-form" data-brand-form><div class="card-heading"><div><h2>Identité & accueil</h2><p class="product-muted">Les changements deviennent visibles sur les prochains chargements.</p></div></div><div class="editor-grid"><label>Nom de l’application<input name="app_name" value="${escapeAttr(state.school.app_name)}" required></label><label>Nom de l’auto-école<input name="school_name" value="${escapeAttr(state.school.school_name)}" required></label></div><label>Slogan<input name="tagline" value="${escapeAttr(state.school.tagline || '')}"></label><label>Titre principal<input name="hero_title" value="${escapeAttr(state.school.hero_title || '')}"></label><label>Message d’accueil<textarea name="hero_message">${escapeHTML(state.school.hero_message || '')}</textarea></label><div class="editor-grid"><label>Couleur principale<input name="primary_color" type="color" value="${escapeAttr(state.school.primary_color || '#155EEF')}"></label><label>Couleur accent<input name="accent_color" type="color" value="${escapeAttr(state.school.accent_color || '#12B76A')}"></label></div><div class="editor-grid"><label>Téléphone<input name="phone" value="${escapeAttr(state.school.phone || '')}"></label><label>Téléphone lien (+221...)<input name="phone_href" value="${escapeAttr(state.school.phone_href || '')}"></label></div><div class="editor-grid"><label>WhatsApp<input name="whatsapp" value="${escapeAttr(state.school.whatsapp || '')}"></label><label>Email<input name="email" type="email" value="${escapeAttr(state.school.email || '')}"></label></div><label>Adresse<input name="address" value="${escapeAttr(state.school.address || '')}"></label><div class="editor-grid"><label>Ville<input name="city" value="${escapeAttr(state.school.city || '')}"></label><label>Logo · URL<input name="logo_url" value="${escapeAttr(state.school.logo_url || '')}" placeholder="https://..."></label></div><button class="primary-product" type="submit">Enregistrer l’identité</button></form><aside class="brand-preview" data-brand-preview></aside></div></section>`);
  const form = document.querySelector('[data-brand-form]'); renderBrandPreview(form);
  form?.addEventListener('input', () => renderBrandPreview(form));
  form?.addEventListener('submit', async (event) => { event.preventDefault(); const button = form.querySelector('[type="submit"]'); await runButton(button, async () => { state.school = await saveSchoolSettings(formObject(form)); applyAdminBrand(state.school); renderBrandPreview(form); }, 'Identité enregistrée.'); });
}

function renderBrandPreview(form) { const root = document.querySelector('[data-brand-preview]'); if (!root || !form) return; const data = formObject(form); root.style.setProperty('--preview-primary', data.primary_color || '#155eef'); root.style.setProperty('--preview-accent', data.accent_color || '#12b76a'); root.innerHTML = `<div class="brand-preview-hero"><div class="brand-preview-mark">${data.logo_url ? `<img src="${escapeAttr(data.logo_url)}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:12px">` : '<i class="fas fa-car-side"></i>'}</div><p class="eyebrow" style="color:#cfe0f8;margin-top:18px">${escapeHTML(data.school_name || 'Auto-école')}</p><h2>${escapeHTML(data.hero_title || 'Votre permis commence ici.')}</h2><p>${escapeHTML(data.hero_message || '')}</p></div><div class="brand-preview-body"><strong>${escapeHTML(data.app_name || 'eAutoecole')}</strong><span class="product-muted">${escapeHTML(data.tagline || '')}</span><div class="brand-preview-action"><i class="fas fa-book-open" style="margin-right:9px"></i> Continuer mon parcours</div><div class="brand-preview-action"><i class="fas fa-bullseye" style="margin-right:9px"></i> Mon entraînement du jour</div></div>`; }

function bindSeedButton(kind) { const button = document.querySelector(`[data-seed="${kind}"]`); if (!button) return; button.addEventListener('click', () => confirmAction(kind === 'lessons' ? 'Importer les leçons actuelles ?' : 'Importer les panneaux actuels ?', 'L’import est idempotent : les contenus déjà créés ne seront pas écrasés.', 'Importer', () => runSeed(button, kind))); }
async function runSeed(button, kind) { const progress = document.querySelector('[data-seed-progress] span'); setBusy(button, true); try { const run = kind === 'lessons' ? seedLegacyLessons : seedLegacyPanels; await run((done, total) => { if (progress) progress.style.width = `${Math.round(done / total * 100)}%`; button.textContent = `Import ${done}/${total}`; }); toast('Import terminé.'); if (kind === 'lessons') await renderLessons({ keepSelection: false }); else await renderPanels({ keepSelection: false }); } catch (error) { toast(error.message || 'Import interrompu.', true); setBusy(button, false); } }

function seedCard(title, text, label, kind) { return `<section class="seed-card"><div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(text)}</p><div class="seed-progress" data-seed-progress><span style="width:0%"></span></div></div><button class="primary-product" data-seed="${kind}">${escapeHTML(label)}</button></section>`; }
function hero(eyebrow, title, text) { return `<section class="product-hero"><p class="eyebrow">${escapeHTML(eyebrow)}</p><h1>${escapeHTML(title)}</h1><p>${escapeHTML(text)}</p></section>`; }
function stat(label, value) { return `<div class="product-stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`; }
function emptyEditor(text) { return `<div class="empty-product"><i class="fas fa-arrow-left"></i><strong>${escapeHTML(text)}</strong><span>Choisis un élément dans la liste.</span></div>`; }
function productTitle(view) { return ({ instructors:'Moniteurs',lessons:'Leçons',panels:'Panneaux',media:'Médias',branding:'Identité' })[view] || 'Module'; }
function showLoader(label) { setView(`<div class="product-loader"><span class="spinner"></span><strong>${escapeHTML(label)}</strong><span>Chargement...</span></div>`); }
function renderError(message) { setView(`<div class="empty-product" style="margin-top:30px"><i class="fas fa-triangle-exclamation"></i><strong>Module indisponible</strong><span>${escapeHTML(message)}</span><button class="secondary-product" data-retry-product>Réessayer</button></div>`); document.querySelector('[data-retry-product]')?.addEventListener('click', () => openProductView(state.view)); }
function setView(html) { const root = document.getElementById('admin-view'); if (root) root.innerHTML = html; }

async function runButton(button, action, success) { if (button?.disabled) return; setBusy(button, true); try { await action(); if (success) toast(success); } catch (error) { console.error(error); toast(error.message || 'Action refusée.', true); setBusy(button, false); } }
function setBusy(button, busy) { if (!button) return; if (busy) { button.dataset.originalLabel = button.textContent; button.disabled = true; button.textContent = 'Patiente...'; } else { button.disabled = false; button.textContent = button.dataset.originalLabel || 'Valider'; } }
function confirmAction(title, message, confirmLabel, action) { modal(`<div><p class="eyebrow">Confirmation</p><h2>${escapeHTML(title)}</h2><p class="product-muted">${escapeHTML(message)}</p><div class="editor-actions"><button class="secondary-product" data-close-product-modal>Annuler</button><button class="danger-product" data-confirm-product-modal>${escapeHTML(confirmLabel)}</button></div></div>`); document.querySelector('[data-confirm-product-modal]')?.addEventListener('click', async () => { closeModal(); await action(); }); }
function previewHtml(html, title) { modal(`<div><p class="eyebrow">Aperçu élève</p><h2>${escapeHTML(title)}</h2><div class="preview-panel lesson-preview-live">${sanitizeForEditor(html)}</div><div class="editor-actions"><button class="secondary-product" data-close-product-modal>Fermer</button></div></div>`); }
function previewPanel(value) { const v = value.imagePath !== undefined ? value : { title:value.title,description:value.description,imagePath:value.image_path,audioFrPath:value.audio_fr_path,audioWoPath:value.audio_wo_path }; modal(`<div><p class="eyebrow">Aperçu panneau</p><h2>${escapeHTML(v.title || '')}</h2>${v.imagePath ? `<img src="${escapeAttr(v.imagePath)}" alt="" style="width:100%;max-height:360px;object-fit:contain;border-radius:14px;background:#f5f7fa">` : ''}<p>${escapeHTML(v.description || '')}</p>${v.audioFrPath ? `<p><strong>Français</strong></p><audio controls src="${escapeAttr(v.audioFrPath)}" style="width:100%"></audio>` : ''}${v.audioWoPath ? `<p><strong>Wolof</strong></p><audio controls src="${escapeAttr(v.audioWoPath)}" style="width:100%"></audio>` : ''}<div class="editor-actions"><button class="secondary-product" data-close-product-modal>Fermer</button></div></div>`); }
function modal(html) { const root = document.getElementById('modal-root'); root.innerHTML = `<div class="product-modal-backdrop"><div class="product-modal">${html}</div></div>`; root.querySelector('[data-close-product-modal]')?.addEventListener('click', closeModal); root.querySelector('.product-modal-backdrop')?.addEventListener('click', (event) => { if (event.target.classList.contains('product-modal-backdrop')) closeModal(); }); }
function closeModal() { const root = document.getElementById('modal-root'); if (root) root.innerHTML = ''; }
function toast(message, error = false) { const root = document.getElementById('toast-root'); if (!root) return; root.innerHTML = `<div class="product-toast ${error ? 'error' : ''}">${escapeHTML(message)}</div>`; clearTimeout(root.productTimer); root.productTimer = setTimeout(() => { root.innerHTML = ''; }, 2800); }

function sanitizeLessonHtml(html) { const template = document.createElement('template'); template.innerHTML = html; template.content.querySelectorAll('script,iframe,object,embed,meta,link,style').forEach((node) => node.remove()); template.content.querySelectorAll('*').forEach((node) => { [...node.attributes].forEach((attr) => { const name = attr.name.toLowerCase(); const value = attr.value.trim().toLowerCase(); if (name.startsWith('on') || (['href','src','xlink:href'].includes(name) && value.startsWith('javascript:'))) node.removeAttribute(attr.name); }); }); return template.innerHTML.trim(); }
function sanitizeForEditor(html) { return sanitizeLessonHtml(html); }
function formObject(form) { return Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value).trim()])); }
function applyAdminBrand(settings) { const app = document.querySelector('[data-brand-app]'); const school = document.querySelector('[data-brand-school]'); if (app) app.textContent = settings?.app_name || 'eAutoecole'; if (school) school.textContent = `${settings?.school_name || 'Auto-école'} · Pilotage`; }
function initials(name) { return escapeHTML(String(name || 'É').trim().split(/\s+/).slice(0,2).map((part) => part[0] || '').join('').toUpperCase()); }
function formatPhone(value) { const digits = String(value || '').replace(/\D/g,''); return digits.length === 9 ? `${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5,7)} ${digits.slice(7)}` : String(value || ''); }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
function escapeAttr(value) { return escapeHTML(value); }
