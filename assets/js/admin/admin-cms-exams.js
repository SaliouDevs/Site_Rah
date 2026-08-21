/**
 * Admin CMS Exams Module
 *
 * Manages the CMS editing interface for exam questions.
 * Integrated into the admin exams view.
 */

import {
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

/**
 * Render CMS section for exams admin
 */
export function renderCMSExamsSection(examKey) {
  return `
    <section class="admin-card cms-exams-section">
      <div class="card-heading">
        <h2>Gestion du contenu CMS</h2>
        <span class="badge info">Phase B1</span>
      </div>
      <div class="cms-exams-content">
        <div id="cms-exams-list" class="cms-exams-list">
          <p class="loading">Chargement des séries...</p>
        </div>
        <div id="cms-question-editor" class="cms-question-editor" style="display: none;"></div>
      </div>
    </section>
  `;
}

/**
 * Initialize CMS exams interface
 */
export async function initCMSExams(examKey, containerSelector = '.cms-exams-section') {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  const listContainer = container.querySelector('#cms-exams-list');
  const editorContainer = container.querySelector('#cms-question-editor');

  // Load series
  const { data: series, error: seriesError } = await listExamSeries(examKey);

  if (seriesError) {
    listContainer.innerHTML = `<p class="error">Erreur: ${escapeHTML(seriesError)}</p>`;
    return;
  }

  if (!series || series.length === 0) {
    listContainer.innerHTML = `<p class="info">Aucune série importée.</p>`;
    return;
  }

  // Render series list
  let html = `
    <label class="cms-question-search">
      Rechercher une question
      <input type="search" data-cms-question-search placeholder="PL-001, texte...">
    </label>
    <div class="cms-series-selector">
  `;

  for (const s of series) {
    const seriesId = s.id;
    const { data: questions } = await listSeriesQuestions(seriesId);
    const qCount = questions?.length || 0;

    html += `
      <div class="cms-series-card" data-series-id="${escapeAttribute(seriesId)}">
        <div class="series-header">
          <strong>${escapeHTML(s.code)}</strong>
          <span class="q-count">${qCount} Q</span>
        </div>
        <div class="series-questions">
    `;

    if (questions && questions.length > 0) {
      html += `
        <div class="questions-compact">
          ${questions.map((q) => `
            <button class="q-link" type="button" data-question-id="${escapeAttribute(q.id)}" data-question-search="${escapeAttribute(String(q.legacy_id || '').toLowerCase())}" title="${escapeAttribute(q.legacy_id || 'Sans ID')}">
              ${escapeHTML(q.legacy_id || 'Question')}
            </button>
          `).join('')}
        </div>
      `;
    }

    html += `
        </div>
      </div>
    `;
  }

  html += `</div>`;
  listContainer.innerHTML = html;

  const searchInput = container.querySelector('[data-cms-question-search]');
  searchInput?.addEventListener('input', () => {
    const term = searchInput.value.trim().toLowerCase();
    container.querySelectorAll('.cms-series-card').forEach((card) => {
      let visibleCount = 0;
      card.querySelectorAll('.q-link').forEach((link) => {
        const visible = !term || link.dataset.questionSearch.includes(term) || link.textContent.toLowerCase().includes(term);
        link.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      card.hidden = visibleCount === 0;
    });
  });

  // Bind series card events
  container.querySelectorAll('.cms-series-card').forEach((card) => {
    const seriesId = card.dataset.seriesId;
    card.querySelectorAll('.q-link').forEach((link) => {
      link.addEventListener('click', async () => {
        await openQuestionEditor(link.dataset.questionId, editorContainer, listContainer);
      });
    });
  });
}

/**
 * Open question editor
 */
async function openQuestionEditor(questionId, editorContainer, listContainer) {
  // Hide list, show editor
  listContainer.style.display = 'none';
  editorContainer.style.display = 'block';

  // Load current version
  const { data: currentData, error: currentError } = await getCurrentQuestionVersion(questionId);

  if (currentError) {
    editorContainer.innerHTML = `
      <div class="editor-error">
        <p>Erreur lors du chargement: ${escapeHTML(currentError)}</p>
        <button type="button" data-back-to-list class="admin-secondary">← Retour</button>
      </div>
    `;
    editorContainer.querySelector('[data-back-to-list]').addEventListener('click', () => {
      listContainer.style.display = 'block';
      editorContainer.style.display = 'none';
    });
    return;
  }

  // Load draft version (if exists)
  const { data: draftData } = await getDraftQuestionVersion(questionId);

  // Render editor
  renderQuestionEditor(questionId, currentData, draftData, editorContainer, listContainer);
}

/**
 * Render question editor UI
 */
function renderQuestionEditor(questionId, currentData, draftData, editorContainer, listContainer) {
  const currentVersion = currentData?.version;
  const draftVersion = draftData?.version;
  const draftChoices = draftData?.choices || [];

  let html = `
    <div class="question-editor-wrapper">
      <div class="editor-header">
        <button type="button" data-back-to-list class="admin-secondary">← Retour</button>
        <h2>Édition question: ${escapeHTML(currentData?.question?.legacy_id || 'Sans ID')}</h2>
      </div>

      <div class="editor-grid">
        <!-- Published version panel -->
        <section class="editor-panel published-panel">
          <h3>Version publiée</h3>
          ${currentVersion ? `
            <div class="version-badge published">Publié</div>
            <div class="version-info">
              <p><strong>Texte:</strong></p>
              <p>${escapeHTML(currentVersion.question_text || '(vide)')}</p>
              <p><strong>Explication:</strong></p>
              <p>${escapeHTML(currentVersion.explanation || '(vide)')}</p>
              ${currentVersion.image_path ? `
                <p><strong>Image:</strong> ${escapeHTML(currentVersion.image_path)}</p>
              ` : ''}
              <p><strong>Choix:</strong></p>
              <ul class="choices-list">
                ${(currentData?.choices || []).map((c) => `
                  <li>
                    <span class="choice-key">${escapeHTML(c.choice_key)}</span>:
                    <span class="choice-label">${escapeHTML(c.label)}</span>
                    ${c.is_correct ? '<span class="badge correct">✓ Correct</span>' : ''}
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : '<p class="info">Aucune version publiée.</p>'}
        </section>

        <!-- Draft editor panel -->
        <section class="editor-panel draft-panel">
          <h3>Brouillon</h3>
          ${draftVersion ? `
            <div class="version-badge draft">Brouillon</div>
            <form class="draft-form" data-question-id="${escapeAttribute(questionId)}" data-version-id="${escapeAttribute(draftVersion.id)}" data-version-metadata="${escapeAttribute(JSON.stringify(draftVersion.metadata || {}))}">
              <label>Texte de la question
                <textarea name="question_text" class="question-text">${escapeHTML(draftVersion.question_text || '')}</textarea>
              </label>

              <label>Explication
                <textarea name="explanation" class="explanation">${escapeHTML(draftVersion.explanation || '')}</textarea>
              </label>

              <label>Image
                <input type="text" name="image_path" class="image-path" placeholder="Chemin ou URL" value="${escapeAttribute(draftVersion.image_path || '')}">
              </label>

              <fieldset class="choices-section">
                <legend>Choix</legend>
                <div class="choices-editor" data-version-id="${escapeAttribute(draftVersion.id)}">
                  ${draftChoices.map((c) => `
                    <div class="choice-item">
                      <input type="hidden" class="choice-id" value="${escapeAttribute(c.id)}">
                      <span class="choice-key">${escapeHTML(c.choice_key)}</span>
                      <input type="text" class="choice-label" placeholder="Texte du choix" value="${escapeAttribute(c.label)}">
                      <label class="choice-correct">
                        <input type="checkbox" class="is-correct" ${c.is_correct ? 'checked' : ''}>
                        Correct
                      </label>
                    </div>
                  `).join('')}
                </div>
              </fieldset>

              <div class="form-actions">
                <button type="button" class="admin-button" data-save-draft>💾 Enregistrer brouillon</button>
                <button type="button" class="admin-secondary" data-preview-draft>👁 Prévisualiser</button>
                <button type="button" class="admin-button success" data-publish-draft>✓ Publier</button>
              </div>
            </form>
          ` : `
            <div class="no-draft">
              <p>Aucun brouillon.</p>
              <button type="button" class="admin-button" data-create-draft>+ Créer un brouillon</button>
            </div>
          `}
        </section>
      </div>

      <!-- History panel -->
      <section class="editor-panel history-panel">
        <h3>Historique</h3>
        <div class="version-history" id="version-history-${escapeAttribute(questionId)}">
          <p class="loading">Chargement...</p>
        </div>
      </section>
    </div>
  `;

  editorContainer.innerHTML = html;

  // Bind events
  editorContainer.querySelector('[data-back-to-list]').addEventListener('click', () => {
    listContainer.style.display = 'block';
    editorContainer.style.display = 'none';
  });

  if (draftVersion) {
    bindDraftFormEvents(questionId, draftVersion.id, editorContainer);
  } else {
    editorContainer.querySelector('[data-create-draft]').addEventListener('click', async () => {
      await createDraftAndRefresh(questionId, editorContainer, listContainer, currentData);
    });
  }

  // Load history
  loadVersionHistory(questionId, editorContainer);
}

/**
 * Bind draft form events
 */
function bindDraftFormEvents(questionId, versionId, container) {
  const form = container.querySelector('.draft-form');
  if (!form) return;

  form.querySelector('[data-save-draft]').addEventListener('click', async (e) => {
    e.preventDefault();
    await saveDraftForm(questionId, versionId, form, container);
  });

  form.querySelector('[data-preview-draft]').addEventListener('click', async (e) => {
    e.preventDefault();
    previewDraft(form);
  });

  form.querySelector('[data-publish-draft]').addEventListener('click', async (e) => {
    e.preventDefault();
    if (confirm('Êtes-vous sûr de vouloir publier ce brouillon? Les élèves verront la nouvelle version.')) {
      await publishDraftVersion(questionId, versionId, container, form);
    }
  });
}

/**
 * Save draft changes
 */
async function saveDraftForm(questionId, versionId, form, container) {
  const questionText = form.querySelector('.question-text').value;
  const explanation = form.querySelector('.explanation').value;
  const imagePath = form.querySelector('.image-path').value;

  // Gather choices
  const choices = Array.from(form.querySelectorAll('.choice-item')).map((item, idx) => ({
    choice_key: item.querySelector('.choice-key').textContent,
    label: item.querySelector('.choice-label').value,
    is_correct: item.querySelector('.is-correct').checked,
    sort_order: idx + 1
  }));

  const button = form.querySelector('[data-save-draft]');
  button.disabled = true;
  button.textContent = '⏳ Enregistrement...';

  const { error } = await saveDraft(versionId, {
    question_text: questionText,
    explanation,
    image_path: imagePath,
    metadata: parseFormMetadata(form),
    choices
  });

  button.disabled = false;
  button.textContent = '💾 Enregistrer brouillon';

  if (error) {
    alert(`Erreur: ${error}`);
  } else {
    alert('Brouillon enregistré!');
  }
}

/**
 * Preview draft
 */
function previewDraft(form) {
  const questionText = form.querySelector('.question-text').value;
  const explanation = form.querySelector('.explanation').value;
  const choices = Array.from(form.querySelectorAll('.choice-item')).map((item) => ({
    choice_key: item.querySelector('.choice-key').textContent,
    label: item.querySelector('.choice-label').value,
    is_correct: item.querySelector('.is-correct').checked
  }));
  const usesMultipleCorrect = choices.filter((choice) => choice.is_correct).length > 1;

  // Open preview modal or panel
  let html = `
    <div class="preview-modal">
      <div class="modal-content">
        <button type="button" class="close" data-close-preview>×</button>
        <h2>Prévisualisation</h2>
        <div class="question-preview">
          <p class="question-text"><strong>${escapeHTML(questionText || '(vide)')}</strong></p>
          <div class="choices-preview">
            ${choices.map((c) => `
              <div class="choice-item ${c.is_correct ? 'correct' : ''}">
                <input type="${usesMultipleCorrect ? 'checkbox' : 'radio'}" name="preview-answer" value="${escapeAttribute(c.choice_key)}" ${c.is_correct ? 'checked' : ''}>
                <label>${escapeHTML(c.choice_key)}</label>
                <span>${escapeHTML(c.label)}</span>
              </div>
            `).join('')}
          </div>
          ${explanation ? `
            <p class="explanation"><strong>Explication:</strong> ${escapeHTML(explanation)}</p>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const modal = document.createElement('div');
  modal.innerHTML = html;
  document.body.appendChild(modal);
  modal.querySelector('[data-close-preview]').addEventListener('click', () => modal.remove());
}

function parseFormMetadata(form) {
  try {
    return JSON.parse(form.dataset.versionMetadata || '{}');
  } catch (_) {
    return {};
  }
}

/**
 * Publish draft version
 */
async function publishDraftVersion(questionId, versionId, container, form) {
  const button = form.querySelector('[data-publish-draft]');
  button.disabled = true;
  button.textContent = '⏳ Publication...';

  const { error, published } = await publishDraft(questionId, versionId);

  button.disabled = false;
  button.textContent = '✓ Publier';

  if (error) {
    alert(`Erreur de publication: ${error}`);
  } else {
    alert('✓ Version publiée avec succès!');
    // Refresh editor
    setTimeout(() => {
      const listContainer = container.parentElement.querySelector('#cms-exams-list');
      openQuestionEditor(questionId, container, listContainer);
    }, 500);
  }
}

/**
 * Create draft and refresh
 */
async function createDraftAndRefresh(questionId, editorContainer, listContainer, currentData) {
  const button = editorContainer.querySelector('[data-create-draft]');
  button.disabled = true;
  button.textContent = '⏳ Création du brouillon...';

  const { data, error } = await createOrGetDraft(questionId);

  button.disabled = false;

  if (error) {
    alert(`Erreur: ${error}`);
  } else {
    // Refresh editor
    await openQuestionEditor(questionId, editorContainer, listContainer);
  }
}

/**
 * Load version history
 */
async function loadVersionHistory(questionId, container) {
  const historyContainer = container.querySelector(`#version-history-${escapeAttribute(questionId)}`);
  if (!historyContainer) return;

  const { data: versions, error } = await getQuestionHistory(questionId);

  if (error) {
    historyContainer.innerHTML = `<p class="error">Erreur: ${escapeHTML(error)}</p>`;
    return;
  }

  if (!versions || versions.length === 0) {
    historyContainer.innerHTML = `<p class="info">Aucune version.</p>`;
    return;
  }

  let html = `<div class="versions-list">`;
  for (const v of versions) {
    const statusBadge = `<span class="badge ${v.status}">${v.status === 'published' ? 'Publié' : v.status === 'archived' ? 'Archivé' : 'Brouillon'}</span>`;
    html += `
      <div class="version-item" data-version-id="${escapeAttribute(v.id)}">
        <div class="version-meta">
          <strong>V${v.version_number}</strong>
          ${statusBadge}
          <small>${new Date(v.updated_at).toLocaleString()}</small>
        </div>
        <div class="version-actions">
          ${v.status !== 'draft' ? `
            <button type="button" class="admin-secondary" data-restore-version="${escapeAttribute(v.id)}">Restaurer</button>
          ` : ''}
        </div>
      </div>
    `;
  }
  html += `</div>`;
  historyContainer.innerHTML = html;

  // Bind restore events
  historyContainer.querySelectorAll('[data-restore-version]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sourceVersionId = btn.dataset.restoreVersion;
      if (confirm('Créer un nouveau brouillon à partir de cette version?')) {
        const { data, error } = await restoreVersionAsDraft(questionId, sourceVersionId);
        if (error) {
          alert(`Erreur: ${error}`);
        } else {
          alert('Brouillon créé à partir de la version.');
          const listContainer = container.parentElement.querySelector('#cms-exams-list');
          await openQuestionEditor(questionId, container, listContainer);
        }
      }
    });
  });
}

/**
 * HTML escape utilities
 */
function escapeHTML(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escapeAttribute(text) {
  return escapeHTML(text);
}
