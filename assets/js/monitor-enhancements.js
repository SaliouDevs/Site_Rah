import { navigateTo } from './router.js';

const NOTES_KEY = 'eautoecole.monitorNotes';

document.addEventListener('DOMContentLoaded', () => {
  enhance();
  const root = document.getElementById('app-view');
  if (root) new MutationObserver(() => queueMicrotask(enhance)).observe(root, { childList: true, subtree: true });
});
window.addEventListener('hashchange', () => setTimeout(enhance, 30));

function enhance() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/home';
  if (path === '/home') addMonitorCard();
  if (path === '/monitor') addMonitorNotes();
}

function addMonitorCard() {
  const grid = document.querySelector('[data-learning-hub] .training-grid');
  if (!grid || grid.querySelector('[data-monitor-card]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'training-card monitor';
  button.dataset.monitorCard = 'true';
  button.innerHTML = '<i class="fas fa-chalkboard-user"></i><strong>Espace Moniteur</strong><span>Prépare tes questions avant la séance</span>';
  button.addEventListener('click', () => navigateTo('/monitor'));
  grid.appendChild(button);
}

function addMonitorNotes() {
  const view = document.querySelector('.monitor-space');
  if (!view || view.querySelector('[data-monitor-notes]')) return;
  const panel = document.createElement('section');
  panel.className = 'monitor-notes-panel';
  panel.dataset.monitorNotes = 'true';
  panel.innerHTML = `
    <div class="section-heading">
      <div><p class="eyebrow">À préparer</p><h2>Mes questions pour le moniteur</h2></div>
      <span class="monitor-save-state" data-monitor-save-state>Enregistré sur cet appareil</span>
    </div>
    <p>Note ici les situations que tu veux revoir pendant ta prochaine séance de conduite.</p>
    <textarea data-monitor-notes-input maxlength="3000" placeholder="Exemple : je veux revoir les priorités aux intersections, le placement avant un rond-point..."></textarea>
    <div class="monitor-note-actions">
      <small data-monitor-count>0 / 3000</small>
      <button class="secondary-action compact-action" type="button" data-clear-monitor-notes>Effacer</button>
    </div>`;
  const notice = view.querySelector('.cms-inline-notice');
  if (notice) notice.insertAdjacentElement('beforebegin', panel);
  else view.appendChild(panel);

  const input = panel.querySelector('[data-monitor-notes-input]');
  const count = panel.querySelector('[data-monitor-count]');
  const state = panel.querySelector('[data-monitor-save-state]');
  input.value = localStorage.getItem(NOTES_KEY) || '';
  updateCount();
  let timer;
  input.addEventListener('input', () => {
    updateCount();
    state.textContent = 'Enregistrement...';
    clearTimeout(timer);
    timer = setTimeout(() => {
      localStorage.setItem(NOTES_KEY, input.value);
      state.textContent = 'Enregistré sur cet appareil';
    }, 250);
  });
  panel.querySelector('[data-clear-monitor-notes]')?.addEventListener('click', () => {
    if (!input.value || confirm('Effacer toutes tes notes pour le moniteur ?')) {
      input.value = '';
      localStorage.removeItem(NOTES_KEY);
      updateCount();
      state.textContent = 'Notes effacées';
    }
  });

  function updateCount() { count.textContent = `${input.value.length} / 3000`; }
}
