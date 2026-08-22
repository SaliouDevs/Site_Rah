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
          <small>Choisissez une série, puis une question. Les brouillons restent invisibles aux élèves jusqu'à publication.</small>
        </div>
        <span class="badge info">CMS</span>
      </div>
      <div class="cms-exams-content">
        <div id="cms-exams-list" class="cms-exams-list"><p class="loading">Chargement du contenu...</p></div>
        <div id="cms-question-editor" class="cms-question-editor" hidden></div>
      </div>
    </section>
  `;
}

export async function initCMSExams(examKey, containerSelector = '.cms-exams-section') {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  runtime.examKey = examKey;
  runtime.selectedQuestionId = null;
  runtime.questionsBySeries = new Map();

  moveCmsNearTop(container);
  scopeLegacyImagesToOneSeries(examKey);

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
  if (view && tabs && tabs.nextElementSibling !== container) {
    tabs.insertAdjacentElement('afterend', container);
  }
}

function scopeLegacyImagesToOneSeries() {
  const select = document.querySelector('[data-exam-series-filter]');
  if (!select || select.value !== 'all') return;
  const firstRealOption = Array.from(select.options).find((option) => option.value !== 'all');
  if (!firstRealOption) return;
  select.value = firstRealOption.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function resolveInitialSeries(series) {
  const legacySelect = document.querySelector('[data-exam-series-filter]');
  const code = legacySelect?.value;
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
        <input type="search" data-cms-question-search placeholder="PL-001 ou texte de la question" autocomplete="off">
      </label>
      <button class="admin-secondary" type="button" data-cms-open-student>Voir l'examen côté élève</button>
    </div>
    <div class="cms-series-selector" role="tablist" aria-label="Séries">
      ${runtime.series.map((item) => {
        const count = runtime.questionsBySeries.get(item.id)?.length || 0;
        return `
          <article class="cms-series-card ${item.id === selectedSeries.id ? 'active' : ''}" data-series-id="${escapeAttribute(item.id)}">
            <button class="series-header" type="button" data-select-series="${escapeAttribute(item.id)}">
              <strong>${escapeHTML(item.code)}</strong><span class="q-count">${count} Q</span>
            </button>
            <div class="series-questions">
              <div class="questions-compact">
                ${(runtime.questionsBySeries.get(item.id) || []).map((q) => renderQuestionButton(q)).join('')}
              </div>
            </div>
          </article>`;
      }).join('')}
    </div>
    <div class="cms-inline-notice">Les images affichées plus bas sont maintenant limitées à la série sélectionnée pour éviter de faire défiler tout l'examen.</div>
  `;

  listContainer.querySelectorAll('[data-select-series]').forEach((button) => {
    button.addEventListener('click', () => selectSeries(button.dataset.selectSeries, container, listContainer, editorContainer));
  });
  listContainer.querySelectorAll('[data-question-id]').forEach((button) => {
    button.addEventListener('click', () => openQuestionEditor(button.dataset.questionId, editorContainer, listContainer));
  });

  const search = listContainer.querySelector('[data-cms-question-search]');
  search?.addEventListener('input', () => filterSelectedSeriesQuestions(listContainer, search.value));

  listContainer.querySelector('[data-cms-open-student]')?.addEventListener('click', () => {
    document.querySelector('[data-open-selected-exam]')?.click();
  });
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
    const [currentResult, draftResult] = await Promise.all([
      getCurrentQuestionVersion(questionId),
      getDraftQuestionVersion(questionId)
    ]);
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
        <div class="editor-header-main"><h2>${escapeHTML(questionCode)}</h2><span>${escapeHTML(seriesCode)} · ${draftVersion ? `Brouillon V${draftVersion.version_number}` : 'Version publiée uniquement'}</span></div>
        <button type="button" class="admin-secondary" data-open-student-question>Voir côté élève</button>
      </header>
      <div class="editor-content">
        <main class="editor-main">
          <section class="editor-panel draft-panel">
            <h3>Édition</h3>
            ${draftVersion ? renderDraftForm(questionId, draftVersion, draftChoices) : `
              <div class="no-draft"><p>La version publiée est protégée. Créez un brouillon pour modifier cette question.</p><button type="button" class="admin-button" data-create-draft>Créer un brouillon</button></div>`}
          </section>
          <section class="editor-panel published-panel">
            <h3>Version actuellement publiée</h3>
            ${renderPublishedVersion(currentData)}
          </section>
        </main>
        <aside class="editor-sidebar">
          <section class="editor-panel history-panel"><h3>Historique</h3><div class="version-history" data-version-history><p>Chargement...</p></div></section>
          <div class="cms-inline-notice">Publier remplace immédiatement la version visible par les élèves. Enregistrer garde uniquement le brouillon.</div>
        </aside>
      </div>
    </div>`;

  editorContainer.querySelector('[data-back-to-list]')?.addEventListener('click', () => showBrowser(listContainer, editorContainer));
  editorContainer.querySelector('[data-open-student-question]')?.addEventListener('click', () => {
    document.querySelector(`[data-view-question-in-exam="${CSS.escape(questionCode)}"]`)?.click() || document.querySelector('[data-open-selected-exam]')?.click();
  });

  if (draftVersion) bindDraftFormEvents(questionId, draftVersion.id, editorContainer, listContainer);
  else editorContainer.querySelector('[data-create-draft]')?.addEventListener('click', (event) => createDraftAndRefresh(questionId, event.currentTarget, editorContainer, listContainer));

  loadVersionHistory(questionId, editorContainer, listContainer);
}

function renderDraftForm(questionId, draftVersion, choices) {
  return `
    <div class="version-badge draft">Brouillon V${draftVersion.version_number}</div>
    <form class="draft-form" data-question-id="${escapeAttribute(questionId)}" data-version-id="${escapeAttribute(draftVersion.id)}" data-version-metadata="${escapeAttribute(JSON.stringify(draftVersion.metadata || {}))}">
      <label>Texte de la question<textarea name="question_text" class="question-text">${escapeHTML(draftVersion.question_text || '')}</textarea></label>
      <label>Explication<textarea name="explanation" class="explanation">${escapeHTML(draftVersion.explanation || '')}</textarea></label>
      <label>Image<input type="text" name="image_path" class="image-path" placeholder="Chemin ou URL" value="${escapeAttribute(draftVersion.image_path || '')}"></label>
      <fieldset class="choices-section"><legend>Réponses</legend><div class="choices-editor">
        ${choices.map((choice) => `
          <div class="choice-item">
            <span class="choice-key">${escapeHTML(choice.choice_key)}</span>
            <input type="text" class="choice-label" value="${escapeAttribute(choice.label || '')}" aria-label="Réponse ${escapeAttribute(choice.choice_key)}">
            <label class="choice-correct"><input type="checkbox" class="is-correct" ${choice.is_correct ? 'checked' : ''}> Bonne réponse</label>
          </div>`).join('')}
      </div></fieldset>
      <div class="form-actions">
        <button type="button" class="admin-button" data-save-draft>Enregistrer</button>
        <button type="button" class="admin-secondary" data-preview-draft>Prévisualiser</button>
        <button type="button" class="admin-button" data-publish-draft>Publier</button>
      </div>
    </form>`;
}

function renderPublishedVersion(data) {
  const version = data?.version;
  if (!version) return '<p>Aucune version publiée.</p>';
  return `
    <div class="version-info">
      <span class="version-badge published">Publié V${version.version_number}</span>
      <div><strong>Question</strong><p>${escapeHTML(version.question_text || '(vide)')}</p></div>
      ${version.image_path ? `<div><strong>Image</strong><p>${escapeHTML(version.image_path)}</p></div>` : ''}
      <div><strong>Réponses</strong><div class="versions-list">
        ${(data.choices || []).map((choice) => `<div class="version-item"><div class="version-meta"><strong>${escapeHTML(choice.choice_key)}</strong><span>${escapeHTML(choice.label)}</span></div>${choice.is_correct ? '<span class="badge active">Correct</span>' : ''}</div>`).join('')}
      </div></div>
    </div>`;
}

function bindDraftFormEvents(questionId, versionId, container, listContainer) {
  const form = container.querySelector('.draft-form');
  if (!form) return;
  form.querySelector('[data-save-draft]')?.addEventListener('click', (event) => saveDraftForm(questionId, versionId, form, event.currentTarget));
  form.querySelector('[data-preview-draft]')?.addEventListener('click', () => previewDraft(form));
  form.querySelector('[data-publish-draft]')?.addEventListener('click', (event) => publishDraftVersion(questionId, versionId, container, listContainer, form, event.currentTarget));
}

async function saveDraftForm(questionId, versionId, form, button) {
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
  if (!choices.length || !choices.some((choice) => choice.is_correct)) throw new Error('Sélectionnez au moins une bonne réponse.');
  return {
    question_text: form.querySelector('.question-text').value.trim(),
    explanation: form.querySelector('.explanation').value.trim(),
    image_path: form.querySelector('.image-path').value.trim(),
    metadata: parseFormMetadata(form),
    choices
  };
}

function previewDraft(form) {
  let draft;
  try { draft = collectDraft(form); } catch (error) { notify(error.message, true); return; }
  const multiple = draft.choices.filter((choice) => choice.is_correct).length > 1;
  const modal = document.createElement('div');
  modal.className = 'preview-modal';
  modal.innerHTML = `<div class="modal-content"><button type="button" class="close" data-close-preview>×</button><h2>Prévisualisation</h2><div class="question-preview"><p><strong>${escapeHTML(draft.question_text || '(vide)')}</strong></p><div class="choices-preview">${draft.choices.map((choice) => `<div class="choice-item ${choice.is_correct ? 'correct' : ''}"><input type="${multiple ? 'checkbox' : 'radio'}" ${choice.is_correct ? 'checked' : ''} disabled><label>${escapeHTML(choice.choice_key)}</label><span>${escapeHTML(choice.label)}</span></div>`).join('')}</div>${draft.explanation ? `<p><strong>Explication :</strong> ${escapeHTML(draft.explanation)}</p>` : ''}</div></div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-close-preview]').addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
}

async function loadVersionHistory(questionId, container, listContainer) {
  const target = container.querySelector('[data-version-history]');
  if (!target) return;
  const { data: versions, error } = await getQuestionHistory(questionId);
  if (error) { target.innerHTML = `<p>${escapeHTML(error)}</p>`; return; }
  target.innerHTML = `<div class="versions-list">${(versions || []).map((version) => `
    <div class="version-item"><div class="version-meta"><strong>V${version.version_number}</strong><span class="badge ${version.status === 'published' ? 'active' : 'pending'}">${statusLabel(version.status)}</span><small>${formatDate(version.updated_at)}</small></div>${version.status !== 'draft' ? `<button type="button" class="admin-secondary" data-restore-version="${escapeAttribute(version.id)}">Restaurer</button>` : ''}</div>`).join('')}</div>`;
  target.querySelectorAll('[data-restore-version]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('Créer un nouveau brouillon depuis cette version ?')) return;
      await guardedMutation(`restore:${questionId}`, button, 'Restauration...', async () => {
        const { error: restoreError } = await restoreVersionAsDraft(questionId, button.dataset.restoreVersion);
        if (restoreError) throw new Error(restoreError);
        notify('Brouillon restauré.');
        await openQuestionEditor(questionId, container, listContainer);
      });
    });
  });
}

async function guardedMutation(key, button, busyLabel, work) {
  if (runtime.pending.has(key)) return;
  runtime.pending.add(key);
  const oldLabel = button?.textContent || '';
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = busyLabel; }
  try { await work(); }
  catch (error) { console.error('CMS exam action failed', error); notify(error.message || 'Action impossible.', true); }
  finally {
    runtime.pending.delete(key);
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = oldLabel; }
  }
}

function showBrowser(listContainer, editorContainer) {
  runtime.selectedQuestionId = null;
  listContainer.hidden = false;
  editorContainer.hidden = true;
  editorContainer.innerHTML = '';
}

function parseFormMetadata(form) {
  try { return JSON.parse(form.dataset.versionMetadata || '{}'); } catch (_) { return {}; }
}

function notify(message, isError = false) {
  const root = document.getElementById('toast-root');
  if (!root) { window.alert(message); return; }
  root.innerHTML = `<div class="toast ${isError ? 'error' : ''}">${escapeHTML(message)}</div>`;
  window.setTimeout(() => { if (root.textContent === message) root.innerHTML = ''; }, 2600);
}

function statusLabel(status) {
  return status === 'published' ? 'Publié' : status === 'archived' ? 'Archivé' : 'Brouillon';
}

function formatDate(value) {
  if (!value) return '';
  try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
  catch (_) { return String(value); }
}

function escapeHTML(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function escapeAttribute(text) { return escapeHTML(text); }
