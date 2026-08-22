/**
 * Admin CMS Exams Workspace
 * Focused series/question editing with guarded mutations.
 */

import {
  EXAM_CMS_UNAVAILABLE_MESSAGE,
  listExamSeries,
  listSeriesQuestions,
  getCurrentQuestionVersion,
  getDraftQuestionVersion,
  createOrGetDraft,
  saveDraft,
  publishDraft,
  getQuestionHistory,
  restoreVersionAsDraft
} from '../services/exam-cms-service.js';
import { deleteExamQuestionVersion, loadExamQuestionVersion } from '../services/admin-platform-service.js';

const runtime = {
  examKey: null,
  selectedSeriesId: null,
  selectedQuestionId: null,
  series: [],
  questionsBySeries: new Map(),
  pending: new Set()
};

export function renderCMSExamsSection(examKey) {
  return `
    <section class="admin-card cms-exams-section" data-cms-exam-key="${escapeAttribute(examKey)}">
      <div class="card-heading">
        <div>
          <h2>Contenu des examens</h2>
          <small>Une série à la fois. Modifie en brouillon, compare l'historique, puis publie quand tout est prêt.</small>
        </div>
        <span class="badge info">CMS</span>
      </div>
      <div class="cms-exams-content">
        <div id="cms-exams-list" class="cms-exams-list"><p class="loading">Chargement du contenu...</p></div>
        <div id="cms-question-editor" class="cms-question-editor" hidden></div>
      </div>
    </section>`;
}

export async function initCMSExams(examKey, containerSelector = '.cms-exams-section') {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  runtime.examKey = examKey;
  runtime.selectedQuestionId = null;
  runtime.questionsBySeries = new Map();
  moveCmsNearTop(container);
  scopeLegacyImagesToOneSeries();

  const listContainer = container.querySelector('#cms-exams-list');
  const editorContainer = container.querySelector('#cms-question-editor');
  const { data: series, error, unavailable } = await listExamSeries(examKey);
  if (error) {
    listContainer.innerHTML = `<div class="cms-inline-notice">${escapeHTML(unavailable ? EXAM_CMS_UNAVAILABLE_MESSAGE : error)}</div>`;
    return;
  }
  if (!series?.length) {
    listContainer.innerHTML = '<div class="cms-inline-notice">Aucune série importée.</div>';
    return;
  }

  runtime.series = series;
  runtime.selectedSeriesId = resolveInitialSeries(series);
  await Promise.all(series.map(async (item) => {
    const result = await listSeriesQuestions(item.id);
    runtime.questionsBySeries.set(item.id, result.data || []);
  }));
  renderBrowser(container, listContainer, editorContainer);
}

function moveCmsNearTop(container) {
  const view = container.parentElement;
  const tabs = view?.querySelector('.exam-tabs');
  if (view && tabs && tabs.nextElementSibling !== container) tabs.insertAdjacentElement('afterend', container);
}

function scopeLegacyImagesToOneSeries() {
  const select = document.querySelector('[data-exam-series-filter]');
  if (!select || select.value !== 'all') return;
  const first = Array.from(select.options).find((option) => option.value !== 'all');
  if (!first) return;
  select.value = first.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function resolveInitialSeries(series) {
  const code = document.querySelector('[data-exam-series-filter]')?.value;
  return series.find((item) => item.code === code)?.id || series[0].id;
}

function renderBrowser(container, listContainer, editorContainer) {
  const selectedSeries = runtime.series.find((item) => item.id === runtime.selectedSeriesId) || runtime.series[0];
  const questions = runtime.questionsBySeries.get(selectedSeries.id) || [];
  listContainer.hidden = false;
  editorContainer.hidden = true;
  editorContainer.innerHTML = '';
  listContainer.innerHTML = `
    <div class="cms-workspace-topbar">
      <label class="cms-question-search">Rechercher dans ${escapeHTML(selectedSeries.code)}
        <input type="search" data-cms-question-search placeholder="ID ou texte" autocomplete="off">
      </label>
      <div class="cms-workspace-actions">
        <span class="cms-count-chip">${questions.length} questions</span>
        <button class="admin-secondary" type="button" data-cms-open-student>Voir côté élève</button>
      </div>
    </div>
    <div class="cms-series-selector" role="tablist" aria-label="Séries">
      ${runtime.series.map((item) => {
        const count = runtime.questionsBySeries.get(item.id)?.length || 0;
        return `<article class="cms-series-card ${item.id === selectedSeries.id ? 'active' : ''}">
          <button class="series-header" type="button" data-select-series="${escapeAttribute(item.id)}">
            <strong>${escapeHTML(item.code)}</strong><span class="q-count">${count} Q</span>
          </button>
          <div class="series-questions"><div class="questions-compact">
            ${(runtime.questionsBySeries.get(item.id) || []).map(renderQuestionButton).join('')}
          </div></div>
        </article>`;
      }).join('')}
    </div>
    <div class="cms-inline-notice">La galerie d'images plus bas suit automatiquement la série choisie ici.</div>`;

  listContainer.querySelectorAll('[data-select-series]').forEach((button) => {
    button.addEventListener('click', () => selectSeries(button.dataset.selectSeries, container, listContainer, editorContainer));
  });
  listContainer.querySelectorAll('[data-question-id]').forEach((button) => {
    button.addEventListener('click', () => openQuestionEditor(button.dataset.questionId, editorContainer, listContainer));
  });
  const search = listContainer.querySelector('[data-cms-question-search]');
  search?.addEventListener('input', () => filterSelectedSeriesQuestions(listContainer, search.value));
  listContainer.querySelector('[data-cms-open-student]')?.addEventListener('click', () => document.querySelector('[data-open-selected-exam]')?.click());
}

function renderQuestionButton(question) {
  return `<button class="q-link" type="button" data-question-id="${escapeAttribute(question.id)}" data-search="${escapeAttribute(`${question.legacy_id || ''}`.toLowerCase())}">${escapeHTML(question.legacy_id || 'Question')}</button>`;
}

function selectSeries(seriesId, container, listContainer, editorContainer) {
  if (runtime.selectedSeriesId === seriesId) return;
  runtime.selectedSeriesId = seriesId;
  runtime.selectedQuestionId = null;
  const selected = runtime.series.find((item) => item.id === seriesId);
  const legacySelect = document.querySelector('[data-exam-series-filter]');
  if (legacySelect && selected && legacySelect.value !== selected.code) {
    legacySelect.value = selected.code;
    legacySelect.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  renderBrowser(container, listContainer, editorContainer);
}

function filterSelectedSeriesQuestions(listContainer, rawTerm) {
  const term = rawTerm.trim().toLowerCase();
  const active = listContainer.querySelector('.cms-series-card.active');
  active?.querySelectorAll('.q-link').forEach((button) => {
    button.hidden = Boolean(term) && !`${button.dataset.search} ${button.textContent.toLowerCase()}`.includes(term);
  });
}

async function openQuestionEditor(questionId, editorContainer, listContainer) {
  if (!questionId || runtime.pending.has(`open:${questionId}`)) return;
  runtime.pending.add(`open:${questionId}`);
  runtime.selectedQuestionId = questionId;
  listContainer.hidden = true;
  editorContainer.hidden = false;
  editorContainer.innerHTML = '<div class="editor-main"><section class="editor-panel">Chargement de la question...</section></div>';
  try {
    const [currentResult, draftResult] = await Promise.all([getCurrentQuestionVersion(questionId), getDraftQuestionVersion(questionId)]);
    if (currentResult.error) throw new Error(currentResult.error);
    renderQuestionEditor(questionId, currentResult.data, draftResult.data, editorContainer, listContainer);
  } catch (error) {
    editorContainer.innerHTML = `<div class="editor-main"><section class="editor-panel"><p>Impossible de charger cette question.</p><small>${escapeHTML(error.message || String(error))}</small><div class="admin-actions"><button class="admin-secondary" type="button" data-back-to-list>← Retour</button></div></section></div>`;
    editorContainer.querySelector('[data-back-to-list]')?.addEventListener('click', () => showBrowser(listContainer, editorContainer));
  } finally {
    runtime.pending.delete(`open:${questionId}`);
  }
}

function renderQuestionEditor(questionId, currentData, draftData, editorContainer, listContainer) {
  const currentVersion = currentData?.version;
  const draftVersion = draftData?.version;
  const draftChoices = draftData?.choices || [];
  const questionCode = currentData?.question?.legacy_id || 'Question';
  const seriesCode = runtime.series.find((s) => s.id === currentData?.question?.series_id)?.code || '';

  editorContainer.innerHTML = `
    <div class="question-editor-wrapper">
      <header class="editor-header">
        <button type="button" data-back-to-list class="admin-secondary">← ${escapeHTML(seriesCode || 'Questions')}</button>
        <div class="editor-header-main"><h2>${escapeHTML(questionCode)}</h2><span>${escapeHTML(seriesCode)} · ${draftVersion ? `Brouillon V${draftVersion.version_number}` : `Publié V${currentVersion?.version_number || '?'}`}</span></div>
        <button type="button" class="admin-secondary" data-open-student-question>Voir côté élève</button>
      </header>
      <div class="editor-content">
        <main class="editor-main">
          <section class="editor-panel draft-panel">
            <h3>Édition</h3>
            ${draftVersion ? renderDraftForm(questionId, draftVersion, draftChoices) : `<div class="no-draft"><p>La version publiée est protégée. Crée un brouillon pour modifier.</p><button type="button" class="admin-button" data-create-draft>Créer un brouillon</button></div>`}
          </section>
          <section class="editor-panel published-panel">
            <h3>Version en ligne</h3>${renderPublishedVersion(currentData)}
          </section>
        </main>
        <aside class="editor-sidebar">
          <section class="editor-panel history-panel"><h3>Historique</h3><p class="history-help">Clique une version pour voir son contenu. Les anciennes versions sont archivées en rouge.</p><div class="version-history" data-version-history><p>Chargement...</p></div></section>
          <div class="cms-inline-notice">La version en ligne ne peut jamais être supprimée. Une version supprimée est d'abord sauvegardée dans l'audit CMS.</div>
        </aside>
      </div>
    </div>`;

  editorContainer.querySelector('[data-back-to-list]')?.addEventListener('click', () => showBrowser(listContainer, editorContainer));
  editorContainer.querySelector('[data-open-student-question]')?.addEventListener('click', () => document.querySelector('[data-open-selected-exam]')?.click());
  if (draftVersion) bindDraftFormEvents(questionId, draftVersion.id, editorContainer, listContainer);
  else editorContainer.querySelector('[data-create-draft]')?.addEventListener('click', (event) => createDraftAndRefresh(questionId, event.currentTarget, editorContainer, listContainer));
  loadVersionHistory(questionId, currentVersion?.id, editorContainer, listContainer);
}

function renderDraftForm(questionId, draftVersion, choices) {
  return `<div class="version-badge draft">Brouillon V${draftVersion.version_number}</div>
    <form class="draft-form" data-question-id="${escapeAttribute(questionId)}" data-version-id="${escapeAttribute(draftVersion.id)}" data-version-metadata="${escapeAttribute(JSON.stringify(draftVersion.metadata || {}))}">
      <label>Texte de la question<textarea name="question_text" class="question-text">${escapeHTML(draftVersion.question_text || '')}</textarea></label>
      <label>Explication<textarea name="explanation" class="explanation">${escapeHTML(draftVersion.explanation || '')}</textarea></label>
      <label>Image<input type="text" name="image_path" class="image-path" placeholder="Chemin ou URL" value="${escapeAttribute(draftVersion.image_path || '')}"></label>
      <fieldset class="choices-section"><legend>Réponses</legend><div class="choices-editor">
        ${choices.map((choice) => `<div class="choice-item"><span class="choice-key">${escapeHTML(choice.choice_key)}</span><input type="text" class="choice-label" value="${escapeAttribute(choice.label || '')}" aria-label="Réponse ${escapeAttribute(choice.choice_key)}"><label class="choice-correct"><input type="checkbox" class="is-correct" ${choice.is_correct ? 'checked' : ''}> Bonne réponse</label></div>`).join('')}
      </div></fieldset>
      <div class="form-actions"><button type="button" class="admin-button" data-save-draft>Enregistrer</button><button type="button" class="admin-secondary" data-preview-draft>Prévisualiser</button><button type="button" class="admin-button" data-publish-draft>Publier</button></div>
    </form>`;
}

function renderPublishedVersion(data) {
  const version = data?.version;
  if (!version) return '<p>Aucune version publiée.</p>';
  return `<div class="version-info"><span class="version-badge published">Publié V${version.version_number}</span><div><strong>Question</strong><p>${escapeHTML(version.question_text || '(vide)')}</p></div>${version.image_path ? `<div><strong>Image</strong><p>${escapeHTML(version.image_path)}</p></div>` : ''}<div><strong>Réponses</strong><div class="versions-list">${(data.choices || []).map((choice) => `<div class="version-item"><div class="version-meta"><strong>${escapeHTML(choice.choice_key)}</strong><span>${escapeHTML(choice.label)}</span></div>${choice.is_correct ? '<span class="badge active">Correct</span>' : ''}</div>`).join('')}</div></div></div>`;
}

function bindDraftFormEvents(questionId, versionId, container, listContainer) {
  const form = container.querySelector('.draft-form');
  if (!form) return;
  form.querySelector('[data-save-draft]')?.addEventListener('click', (event) => saveDraftForm(versionId, form, event.currentTarget));
  form.querySelector('[data-preview-draft]')?.addEventListener('click', () => previewDraft(form));
  form.querySelector('[data-publish-draft]')?.addEventListener('click', (event) => publishDraftVersion(questionId, versionId, container, listContainer, form, event.currentTarget));
}

async function saveDraftForm(versionId, form, button) {
  await guardedMutation(`save:${versionId}`, button, 'Enregistrement...', async () => {
    const { error } = await saveDraft(versionId, collectDraft(form));
    if (error) throw new Error(error);
    notify('Brouillon enregistré.');
  });
}

async function publishDraftVersion(questionId, versionId, container, listContainer, form, button) {
  if (!window.confirm('Publier cette version maintenant ? Les élèves verront immédiatement ces changements.')) return;
  await guardedMutation(`publish:${versionId}`, button, 'Publication...', async () => {
    const saveResult = await saveDraft(versionId, collectDraft(form));
    if (saveResult.error) throw new Error(saveResult.error);
    const { error } = await publishDraft(questionId, versionId);
    if (error) throw new Error(error);
    notify('Version publiée.');
    await openQuestionEditor(questionId, container, listContainer);
  });
}

async function createDraftAndRefresh(questionId, button, editorContainer, listContainer) {
  await guardedMutation(`draft:${questionId}`, button, 'Création...', async () => {
    const { error } = await createOrGetDraft(questionId);
    if (error) throw new Error(error);
    notify('Brouillon prêt.');
    await openQuestionEditor(questionId, editorContainer, listContainer);
  });
}

function collectDraft(form) {
  const choices = Array.from(form.querySelectorAll('.choice-item')).map((item, index) => ({
    choice_key: item.querySelector('.choice-key').textContent.trim(),
    label: item.querySelector('.choice-label').value.trim(),
    is_correct: item.querySelector('.is-correct').checked,
    sort_order: index + 1
  }));
  if (!choices.length || !choices.some((choice) => choice.is_correct)) throw new Error('Choisis au moins une bonne réponse.');
  return {
    question_text: form.querySelector('.question-text').value.trim(),
    explanation: form.querySelector('.explanation').value.trim(),
    image_path: form.querySelector('.image-path').value.trim(),
    metadata: parseMetadata(form.dataset.versionMetadata),
    choices
  };
}

async function loadVersionHistory(questionId, currentVersionId, container, listContainer) {
  const target = container.querySelector('[data-version-history]');
  if (!target) return;
  const { data: versions, error } = await getQuestionHistory(questionId);
  if (error) { target.innerHTML = `<p class="error">${escapeHTML(error)}</p>`; return; }
  if (!versions?.length) { target.innerHTML = '<p>Aucune version.</p>'; return; }
  target.innerHTML = `<div class="versions-list history-versions">${versions.map((version) => {
    const current = version.id === currentVersionId;
    const status = current ? 'current' : version.status;
    const label = current ? 'En ligne' : version.status === 'archived' ? 'Ancienne' : version.status === 'draft' ? 'Brouillon' : 'Publiée';
    return `<article class="version-item history-version ${escapeAttribute(status)}">
      <button type="button" class="version-open" data-open-version="${escapeAttribute(version.id)}">
        <span class="version-number">V${version.version_number}</span><span class="version-state">${escapeHTML(label)}</span><small>${formatDate(version.updated_at || version.created_at)}</small>
      </button>
      <div class="version-actions">
        ${!current && version.status !== 'draft' ? `<button type="button" class="admin-secondary compact" data-restore-version="${escapeAttribute(version.id)}">Restaurer</button>` : ''}
        ${!current ? `<button type="button" class="version-delete" data-delete-version="${escapeAttribute(version.id)}" aria-label="Supprimer V${version.version_number}">×</button>` : ''}
      </div>
    </article>`;
  }).join('')}</div><div class="history-version-preview" data-version-preview><span>Sélectionne une version pour la consulter.</span></div>`;

  target.querySelectorAll('[data-open-version]').forEach((button) => button.addEventListener('click', () => showHistoricalVersion(button.dataset.openVersion, target)));
  target.querySelectorAll('[data-restore-version]').forEach((button) => button.addEventListener('click', () => restoreHistoricalVersion(questionId, button.dataset.restoreVersion, button, container, listContainer)));
  target.querySelectorAll('[data-delete-version]').forEach((button) => button.addEventListener('click', () => deleteHistoricalVersion(questionId, button.dataset.deleteVersion, button, container, listContainer)));
}

async function showHistoricalVersion(versionId, target) {
  if (runtime.pending.has(`view-version:${versionId}`)) return;
  runtime.pending.add(`view-version:${versionId}`);
  const preview = target.querySelector('[data-version-preview]');
  if (preview) preview.innerHTML = '<span>Chargement...</span>';
  try {
    const { version, choices } = await loadExamQuestionVersion(versionId);
    if (!preview) return;
    preview.innerHTML = `<div class="history-preview-head"><strong>V${version.version_number}</strong><span class="version-badge ${escapeAttribute(version.status)}">${escapeHTML(version.status)}</span></div><p>${escapeHTML(version.question_text || '(vide)')}</p>${version.image_path ? `<small>Image : ${escapeHTML(version.image_path)}</small>` : ''}<div class="history-choice-list">${choices.map((c) => `<div class="history-choice ${c.is_correct ? 'correct' : ''}"><strong>${escapeHTML(c.choice_key)}</strong><span>${escapeHTML(c.label)}</span>${c.is_correct ? '<b>✓</b>' : ''}</div>`).join('')}</div>${version.explanation ? `<p class="history-explanation"><strong>Explication :</strong> ${escapeHTML(version.explanation)}</p>` : ''}`;
  } catch (error) {
    if (preview) preview.innerHTML = `<span class="error">${escapeHTML(error.message || String(error))}</span>`;
  } finally { runtime.pending.delete(`view-version:${versionId}`); }
}

async function restoreHistoricalVersion(questionId, versionId, button, container, listContainer) {
  if (!window.confirm('Créer un nouveau brouillon à partir de cette ancienne version ?')) return;
  await guardedMutation(`restore:${versionId}`, button, 'Restauration...', async () => {
    const { error } = await restoreVersionAsDraft(questionId, versionId);
    if (error) throw new Error(error);
    notify('Ancienne version copiée dans un nouveau brouillon.');
    await openQuestionEditor(questionId, container, listContainer);
  });
}

async function deleteHistoricalVersion(questionId, versionId, button, container, listContainer) {
  if (!window.confirm('Supprimer définitivement cette version de la liste ? Une copie d’audit sera conservée.')) return;
  await guardedMutation(`delete-version:${versionId}`, button, '…', async () => {
    await deleteExamQuestionVersion(questionId, versionId);
    notify('Version supprimée.');
    await openQuestionEditor(questionId, container, listContainer);
  });
}

function previewDraft(form) {
  let draft;
  try { draft = collectDraft(form); }
  catch (error) { notify(error.message, true); return; }
  const multiple = draft.choices.filter((choice) => choice.is_correct).length > 1;
  const modal = document.createElement('div');
  modal.className = 'preview-modal';
  modal.innerHTML = `<div class="modal-content"><button type="button" class="close" aria-label="Fermer">×</button><p class="eyebrow">Aperçu élève</p><h2>${escapeHTML(draft.question_text || '(Question vide)')}</h2>${draft.image_path ? `<img class="cms-preview-image" src="${escapeAttribute(draft.image_path)}" alt="">` : ''}<div class="choices-preview">${draft.choices.map((c) => `<div class="choice-item ${c.is_correct ? 'correct' : ''}"><input type="${multiple ? 'checkbox' : 'radio'}" ${c.is_correct ? 'checked' : ''} disabled><label>${escapeHTML(c.choice_key)}</label><span>${escapeHTML(c.label)}</span></div>`).join('')}</div>${draft.explanation ? `<p><strong>Explication :</strong> ${escapeHTML(draft.explanation)}</p>` : ''}</div>`;
  document.body.appendChild(modal);
  modal.querySelector('.close')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
}

async function guardedMutation(key, button, busyLabel, action) {
  if (runtime.pending.has(key) || button?.disabled) return;
  runtime.pending.add(key);
  const label = button?.textContent || '';
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = busyLabel; }
  try { await action(); }
  catch (error) { console.error('Action CMS refusée', error); notify(error.message || 'Action refusée', true); }
  finally {
    runtime.pending.delete(key);
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label; }
  }
}

function showBrowser(listContainer, editorContainer) {
  runtime.selectedQuestionId = null;
  editorContainer.hidden = true;
  editorContainer.innerHTML = '';
  listContainer.hidden = false;
}

function notify(message, error = false) {
  if (typeof window.eautoToast === 'function') { window.eautoToast(message, error); return; }
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.innerHTML = `<div class="toast ${error ? 'error' : ''}">${escapeHTML(message)}</div>`;
  window.setTimeout(() => { if (root.textContent === message) root.innerHTML = ''; }, 2600);
}

function parseMetadata(raw) { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } }
function formatDate(value) { try { return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return ''; } }
function escapeHTML(text) { return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;'); }
function escapeAttribute(text) { return escapeHTML(text).replace(/`/g, '&#x60;'); }
