import { PANELS_DATA } from '../data/panels-data.js';
import { navigateTo } from '../router.js';

let currentCategoryKey = null;
let currentIndex = 0;
let revisionScore = { correct: 0, total: 0 };

export function renderPanelsView(container, params = {}) {
  const categoryId = params.category;
  if (categoryId) {
    renderPanelCategory(container, categoryId);
    return;
  }

  container.innerHTML = `
    <section class="view-stack">
      <div class="view-heading">
        <p class="eyebrow">Signaux routiers</p>
        <h1>Panneaux</h1>
        <p>Apprends catégorie par catégorie, puis révise avec reconnaissance visuelle.</p>
      </div>
      <div class="mode-grid">
        <button class="mode-card active" type="button" data-panel-mode="learn">
          <strong>Apprendre</strong>
          <span>Une fiche claire à la fois.</span>
        </button>
        <button class="mode-card" type="button" data-panel-mode="review">
          <strong>Réviser</strong>
          <span>Quel est ce panneau ?</span>
        </button>
      </div>
      <div data-panel-root></div>
    </section>
  `;

  const root = container.querySelector('[data-panel-root]');
  renderPanelCategories(root);
  container.querySelectorAll('[data-panel-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      container.querySelectorAll('[data-panel-mode]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      if (button.dataset.panelMode === 'review') {
        renderPanelReview(root);
      } else {
        renderPanelCategories(root);
      }
    });
  });
}

function renderPanelCategories(root) {
  root.innerHTML = `
    <div class="category-grid">
      ${PANELS_DATA.map((category) => `
        <button class="category-tile" type="button" data-panel-category="${category.id}">
          <span>${category.logo || ''}</span>
          <strong>${category.name}</strong>
          <small>${category.signs.length} panneaux</small>
        </button>
      `).join('')}
    </div>
  `;

  root.querySelectorAll('[data-panel-category]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(`/panels/${button.dataset.panelCategory}`));
  });
}

function renderPanelCategory(container, categoryId) {
  const category = PANELS_DATA.find((item) => item.id === categoryId) || PANELS_DATA[0];
  currentCategoryKey = category.id;
  currentIndex = Math.min(currentIndex, category.signs.length - 1);
  renderCurrentPanel(container, category);
}

function renderCurrentPanel(container, category) {
  const sign = category.signs[currentIndex];
  container.innerHTML = `
    <section class="panel-study immersive-view">
      <button class="text-back" type="button" data-back-panels>← Toutes les catégories</button>
      <div class="panel-card-large">
        <div class="reader-meta">
          <span>${category.name}</span>
          <strong>${currentIndex + 1} / ${category.signs.length}</strong>
        </div>
        <div class="panel-visual">
          <img src="${sign.image}" alt="${sign.name}" loading="lazy">
        </div>
        <div class="panel-copy">
          <h1>${sign.name}</h1>
          <h2>Signification</h2>
          <p>${sign.description || 'Description à consulter avec le moniteur.'}</p>
        </div>
        <div class="reader-actions">
          <button class="secondary-action" type="button" data-prev-panel ${currentIndex === 0 ? 'disabled' : ''}>← Précédent</button>
          <button class="secondary-action" type="button" data-panel-details>Détails</button>
          <button class="primary-action" type="button" data-next-panel ${currentIndex === category.signs.length - 1 ? 'disabled' : ''}>Suivant →</button>
        </div>
      </div>
    </section>
  `;

  container.querySelector('[data-back-panels]').addEventListener('click', () => {
    currentIndex = 0;
    navigateTo('/panels');
  });
  container.querySelector('[data-prev-panel]').addEventListener('click', () => {
    currentIndex = Math.max(0, currentIndex - 1);
    renderCurrentPanel(container, category);
  });
  container.querySelector('[data-next-panel]').addEventListener('click', () => {
    currentIndex = Math.min(category.signs.length - 1, currentIndex + 1);
    renderCurrentPanel(container, category);
  });
  container.querySelector('[data-panel-details]').addEventListener('click', () => showPanelDetails(category, sign));
}

function renderPanelReview(root) {
  const allSigns = PANELS_DATA.flatMap((category) => category.signs.map((sign) => ({ ...sign, category: category.name })));
  const sign = allSigns[Math.floor(Math.random() * allSigns.length)];
  const options = buildReviewOptions(allSigns, sign);
  root.innerHTML = `
    <section class="review-card">
      <div class="reader-meta">
        <span>Révision panneaux</span>
        <strong>${revisionScore.correct} / ${revisionScore.total}</strong>
      </div>
      <h2>Quel est ce panneau ?</h2>
      <img src="${sign.image}" alt="Panneau à identifier" loading="lazy">
      <div class="quiz-options">
        ${options.map((option) => `<button type="button" data-review-answer="${option.id}">${option.name}</button>`).join('')}
      </div>
      <div class="quiz-feedback" data-feedback></div>
    </section>
  `;

  root.querySelectorAll('[data-review-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      const correct = button.dataset.reviewAnswer === sign.id;
      revisionScore.total += 1;
      if (correct) {
        revisionScore.correct += 1;
      }
      const feedback = root.querySelector('[data-feedback]');
      feedback.className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`;
      feedback.innerHTML = `<strong>${correct ? 'Correct' : 'À revoir'}</strong><span>${sign.name} : ${sign.description || 'Relis la fiche de ce panneau.'}</span><button class="primary-action" type="button" data-next-review>Continuer</button>`;
      root.querySelectorAll('[data-review-answer]').forEach((item) => item.disabled = true);
      root.querySelector('[data-next-review]').addEventListener('click', () => renderPanelReview(root));
    });
  });
}

function buildReviewOptions(allSigns, sign) {
  const others = allSigns.filter((item) => item.id !== sign.id).sort(() => Math.random() - 0.5).slice(0, 2);
  return [sign, ...others].sort(() => Math.random() - 0.5);
}

function showPanelDetails(category, sign) {
  window.eautoModal(`
    <div class="modal-card">
      <button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button>
      <p class="eyebrow">${category.name}</p>
      <h2>${sign.name}</h2>
      <img class="modal-panel-image" src="${sign.image}" alt="${sign.name}" loading="lazy">
      <p>${sign.description || 'Description à consulter avec le moniteur.'}</p>
    </div>
  `);
}

export function getPanelsDataCount() {
  return PANELS_DATA.reduce((sum, category) => sum + category.signs.length, 0);
}
