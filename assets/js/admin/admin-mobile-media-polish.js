const adminRoot = document.getElementById('admin-view');
let panelCategory = sessionStorage.getItem('eauto.admin.panelCategory') || 'all';
let mutationTimer = 0;
let polishing = false;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAdminPolish, { once: true });
else initAdminPolish();

function initAdminPolish() {
  if (!adminRoot) return;
  adminRoot.addEventListener('click', handleWorkspaceClick, true);
  new MutationObserver(schedulePolish).observe(adminRoot, { childList: true, subtree: true });
  schedulePolish();
}

function schedulePolish() {
  window.clearTimeout(mutationTimer);
  mutationTimer = window.setTimeout(polishCurrentView, 45);
}

async function polishCurrentView() {
  if (polishing) return;
  polishing = true;
  try {
    enhancePanelWorkspace();
    enhanceLessonWorkspace();
    await enhanceMediaWorkspace();
    enhanceExamWorkspace();
  } finally {
    polishing = false;
  }
}

function handleWorkspaceClick(event) {
  const panel = event.target.closest('[data-panel-id]');
  if (panel && window.innerWidth <= 980) {
    window.setTimeout(() => document.querySelector('[data-panel-editor]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 160);
  }
  const lesson = event.target.closest('[data-lesson-id]');
  if (lesson && window.innerWidth <= 980) {
    window.setTimeout(() => document.querySelector('[data-lesson-editor]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 160);
  }
  const question = event.target.closest('.q-link[data-question-id]');
  if (question && window.innerWidth <= 900) {
    window.setTimeout(() => document.querySelector('.cms-exams-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }
}

function enhancePanelWorkspace() {
  const search = document.querySelector('[data-panel-search]');
  const workspace = document.querySelector('[data-panel-editor]')?.closest('.product-workspace');
  if (!search || !workspace) return;
  workspace.classList.add('product-workspace-compact');
  workspace.querySelector('.product-sidebar')?.classList.add('product-sidebar-compact');

  const toolbar = search.closest('.product-toolbar');
  if (toolbar && !toolbar.querySelector('[data-panel-category-filter]')) {
    const categories = [...new Set([...workspace.querySelectorAll('[data-panel-id] small')]
      .map((node) => String(node.textContent || '').split('·')[0].trim())
      .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const select = document.createElement('select');
    select.className = 'product-search product-category-select';
    select.dataset.panelCategoryFilter = 'true';
    select.innerHTML = `<option value="all">Toutes les catégories</option>${categories.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(humanize(value))}</option>`).join('')}`;
    if (categories.includes(panelCategory)) select.value = panelCategory;
    else panelCategory = 'all';
    toolbar.insertBefore(select, toolbar.querySelector('.product-muted'));
    select.addEventListener('change', () => {
      panelCategory = select.value;
      sessionStorage.setItem('eauto.admin.panelCategory', panelCategory);
      applyPanelCategory(true);
    });
  }
  applyPanelCategory(false);
  decoratePanelMediaFields();
}

function applyPanelCategory(selectFirstIfNeeded) {
  const workspace = document.querySelector('[data-panel-editor]')?.closest('.product-workspace');
  if (!workspace) return;
  const items = [...workspace.querySelectorAll('[data-panel-id]')];
  let visible = 0;
  items.forEach((item) => {
    const category = String(item.querySelector('small')?.textContent || '').split('·')[0].trim();
    const show = panelCategory === 'all' || category === panelCategory;
    item.hidden = !show;
    if (show) visible += 1;
  });
  const toolbar = document.querySelector('[data-panel-search]')?.closest('.product-toolbar');
  const result = toolbar?.querySelector('.product-muted');
  if (result) result.textContent = `${visible} panneau${visible > 1 ? 'x' : ''} visible${visible > 1 ? 's' : ''}`;
  if (selectFirstIfNeeded) {
    const active = workspace.querySelector('[data-panel-id].active');
    if (active?.hidden) workspace.querySelector('[data-panel-id]:not([hidden])')?.click();
  }
}

function enhanceLessonWorkspace() {
  const editor = document.querySelector('[data-lesson-editor]');
  const workspace = editor?.closest('.product-workspace');
  if (!workspace) return;
  workspace.classList.add('product-workspace-compact');
  workspace.querySelector('.product-sidebar')?.classList.add('product-sidebar-compact');
}

async function enhanceMediaWorkspace() {
  const input = document.querySelector('[data-media-input]');
  const drop = document.querySelector('[data-media-drop]');
  if (!input || !drop) return;

  input.accept = 'image/*,audio/*,video/*,.heic,.heif,.m4a,.mp3,.wav,.ogg,.aac,.mp4,.mov,.m4v,.webm';
  const title = drop.querySelector('strong');
  const hint = drop.querySelector('.product-muted');
  if (title) title.textContent = 'Ajoute une image, un son ou une vidéo';
  if (hint) hint.textContent = 'Photos, Fichiers, iCloud ou Google Drive · image/audio/vidéo · 50 Mo max';

  const language = drop.querySelector('[data-media-language]');
  if (language) {
    language.innerHTML = '<option value="">Langue neutre</option><option value="fr">Français</option><option value="wo">Wolof / SN</option>';
  }
  if (!drop.querySelector('[data-media-provider-hint]')) {
    const provider = document.createElement('small');
    provider.className = 'media-provider-hint';
    provider.dataset.mediaProviderHint = 'true';
    provider.textContent = 'Sur iPhone : Choisir des fichiers → Parcourir pour ouvrir iCloud Drive, Google Drive ou un autre fournisseur installé.';
    drop.appendChild(provider);
  }

  const filters = document.querySelector('[data-media-filter="all"]')?.parentElement;
  if (filters && !filters.querySelector('[data-video-filter-extra]')) {
    const videoButton = document.createElement('button');
    videoButton.type = 'button';
    videoButton.className = 'secondary-product';
    videoButton.dataset.videoFilterExtra = 'true';
    videoButton.textContent = 'Vidéos';
    videoButton.addEventListener('click', () => filterMediaCards('video', videoButton));
    filters.appendChild(videoButton);
  }

  document.querySelectorAll('.media-card').forEach(enhanceMediaCard);
  await ensureVideoMetric();
}

function enhanceMediaCard(card) {
  const meta = String(card.querySelector('.media-body small')?.textContent || '').toLowerCase();
  const url = String(card.querySelector('.media-url')?.textContent || '').trim();
  card.dataset.mediaKind = meta.split('·')[0].trim();
  if (card.dataset.mediaKind === 'video' && url) {
    const preview = card.querySelector('.media-preview');
    if (preview && !preview.querySelector('video')) preview.innerHTML = `<video controls playsinline preload="metadata" src="${escapeHTML(url)}"></video>`;
  }
  const small = card.querySelector('.media-body small');
  if (small) small.textContent = small.textContent.replace(/\bWO\b/g, 'WO / SN');
}

function filterMediaCards(kind, button) {
  document.querySelectorAll('.media-card').forEach((card) => { card.hidden = card.dataset.mediaKind !== kind; });
  document.querySelectorAll('[data-media-filter], [data-video-filter-extra]').forEach((item) => item.classList.toggle('filter-active', item === button));
  const label = button.closest('.product-toolbar')?.querySelector('.product-muted');
  const count = [...document.querySelectorAll('.media-card')].filter((card) => !card.hidden).length;
  if (label) label.textContent = `${count} vidéo${count > 1 ? 's' : ''}`;
}

async function ensureVideoMetric() {
  const grid = document.querySelector('.product-view .product-stat-grid');
  if (!grid || grid.querySelector('[data-video-stat]') || !window.sb) return;
  const card = document.createElement('div');
  card.className = 'product-stat';
  card.dataset.videoStat = 'true';
  card.innerHTML = '<span>Vidéos</span><strong>…</strong>';
  grid.appendChild(card);
  try {
    const { count, error } = await window.sb.from('cms_media_assets').select('id', { count: 'exact', head: true }).eq('media_kind', 'video');
    if (error) throw error;
    card.querySelector('strong').textContent = String(count || 0);
  } catch {
    card.querySelector('strong').textContent = '0';
  }
}

function decoratePanelMediaFields() {
  const form = document.querySelector('[data-panel-form]');
  if (!form) return;
  addMediaPicker(form.elements.imagePath, { kind: 'image', label: 'Choisir une image' });
  addMediaPicker(form.elements.audioFrPath, { kind: 'audio', language: 'fr', label: 'Choisir un son FR' });
  addMediaPicker(form.elements.audioWoPath, { kind: 'audio', language: 'wo', label: 'Choisir un son Wolof / SN' });
}

function addMediaPicker(input, options) {
  if (!input || input.parentElement.querySelector(`[data-picker-for="${input.name}"]`)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary-product product-media-picker';
  button.dataset.pickerFor = input.name;
  button.innerHTML = `<i class="fas fa-photo-film"></i> ${escapeHTML(options.label)}`;
  button.addEventListener('click', () => openMediaPicker(input, options));
  input.insertAdjacentElement('afterend', button);
}

async function openMediaPicker(target, { kind, language, label }) {
  if (!window.sb) return toastLocal('Supabase indisponible.', true);
  const backdrop = document.createElement('div');
  backdrop.className = 'product-modal-backdrop media-picker-backdrop';
  backdrop.innerHTML = `<div class="product-modal media-picker-modal"><div class="media-picker-head"><div><p class="eyebrow">Bibliothèque</p><h2>${escapeHTML(label)}</h2></div><button type="button" class="secondary-product" data-close-picker>Fermer</button></div><input class="product-search" type="search" data-picker-search placeholder="Rechercher un fichier"><div class="media-picker-grid" data-picker-grid><div class="product-loader"><span class="spinner"></span><span>Chargement...</span></div></div></div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('[data-close-picker]').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove(); });
  try {
    let query = window.sb.from('cms_media_assets').select('*').eq('status', 'published').eq('media_kind', kind).order('created_at', { ascending: false }).limit(150);
    if (language === 'fr') query = query.eq('language', 'fr');
    if (language === 'wo') query = query.in('language', ['wo', 'sn']);
    const { data, error } = await query;
    if (error) throw error;
    renderPickerItems(backdrop, target, data || [], kind);
  } catch (error) {
    backdrop.querySelector('[data-picker-grid]').innerHTML = `<div class="empty-product"><strong>Bibliothèque indisponible</strong><span>${escapeHTML(error.message || '')}</span></div>`;
  }
}

function renderPickerItems(backdrop, target, assets, kind) {
  const grid = backdrop.querySelector('[data-picker-grid]');
  const render = (term = '') => {
    const q = term.trim().toLowerCase();
    const shown = assets.filter((asset) => !q || `${asset.title || ''} ${asset.storage_path || ''}`.toLowerCase().includes(q));
    grid.innerHTML = shown.length ? shown.map((asset) => {
      const url = window.sb.storage.from(asset.bucket || 'cms-media').getPublicUrl(asset.storage_path).data.publicUrl;
      return `<article class="media-picker-card">${kind === 'image' ? `<img src="${escapeHTML(url)}" alt="" loading="lazy">` : `<audio controls preload="none" src="${escapeHTML(url)}"></audio>`}<div><strong>${escapeHTML(asset.title || asset.storage_path)}</strong><small>${escapeHTML(asset.language ? asset.language.toUpperCase().replace('WO','WO / SN') : 'Neutre')}</small></div><button type="button" class="primary-product" data-select-media="${escapeHTML(url)}">Utiliser</button></article>`;
    }).join('') : '<div class="empty-product"><strong>Aucun média correspondant</strong></div>';
    grid.querySelectorAll('[data-select-media]').forEach((button) => button.addEventListener('click', () => {
      target.value = button.dataset.selectMedia;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      backdrop.remove();
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  };
  render();
  backdrop.querySelector('[data-picker-search]').addEventListener('input', (event) => render(event.target.value));
}

function enhanceExamWorkspace() {
  document.querySelector('.cms-series-selector')?.classList.add('cms-series-selector-compact');
  document.querySelector('.exam-question-admin-list')?.classList.add('legacy-image-scrollbox');
}

function toastLocal(message, error = false) {
  if (window.eautoToast) return window.eautoToast(message);
  const toast = document.createElement('div');
  toast.className = `product-toast${error ? ' error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}
function humanize(value) { return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
