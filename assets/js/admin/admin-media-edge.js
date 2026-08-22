const MEDIA_BUCKET = 'cms-media';
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
let mediaBusy = false;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSignedMedia, { once: true });
else initSignedMedia();

function initSignedMedia() {
  document.addEventListener('change', handleMediaInput, true);
  document.addEventListener('drop', handleMediaDrop, true);
  document.addEventListener('click', handleMediaDelete, true);
}

async function handleMediaInput(event) {
  const input = event.target.closest?.('[data-media-input]');
  if (!input || !input.files?.length) return;
  event.stopImmediatePropagation();
  await uploadFiles([...input.files], input);
}

async function handleMediaDrop(event) {
  const drop = event.target.closest?.('[data-media-drop]');
  if (!drop || !event.dataTransfer?.files?.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  await uploadFiles([...event.dataTransfer.files], document.querySelector('[data-media-input]'));
}

async function handleMediaDelete(event) {
  const button = event.target.closest?.('[data-delete-media]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (mediaBusy) return;
  if (!confirm('Supprimer ce média ?')) return;
  mediaBusy = true;
  setBusy(button, true, 'Suppression...');
  try {
    const { data: asset, error: loadError } = await window.sb.from('cms_media_assets')
      .select('id,storage_path')
      .eq('id', button.dataset.deleteMedia)
      .single();
    if (loadError) throw loadError;
    const { data, error } = await window.sb.functions.invoke('admin-media-upload', {
      body: { action: 'delete', id: asset.id, path: asset.storage_path }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    toast('Média supprimé.');
    reloadMediaView();
  } catch (error) {
    toast(readFunctionError(error, 'Suppression impossible.'), true);
    setBusy(button, false);
  } finally {
    mediaBusy = false;
  }
}

async function uploadFiles(files, input) {
  if (mediaBusy || !files.length) return;
  mediaBusy = true;
  const button = document.querySelector('[data-pick-media]');
  const language = document.querySelector('[data-media-language]')?.value || null;
  setBusy(button, true, `Préparation 0/${files.length}`);
  let done = 0;
  try {
    for (const file of files) {
      validateLocalFile(file);
      setBusy(button, true, `Envoi ${done + 1}/${files.length}`);
      const prepared = await invokeMedia({
        action: 'prepare',
        name: file.name,
        size: file.size,
        mime: file.type || '',
        language
      });
      const { error: uploadError } = await window.sb.storage.from(MEDIA_BUCKET)
        .uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: prepared.mime,
          cacheControl: '3600'
        });
      if (uploadError) throw uploadError;
      await invokeMedia({
        action: 'complete',
        path: prepared.path,
        mime: prepared.mime,
        language: prepared.language,
        title: file.name
      });
      done += 1;
    }
    if (input) input.value = '';
    toast(`${done} média${done > 1 ? 's' : ''} ajouté${done > 1 ? 's' : ''}.`);
    reloadMediaView();
  } catch (error) {
    toast(readFunctionError(error, 'Upload impossible.'), true);
    setBusy(button, false);
  } finally {
    mediaBusy = false;
  }
}

async function invokeMedia(body) {
  const { data, error } = await window.sb.functions.invoke('admin-media-upload', { body });
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error || 'Réponse serveur invalide.');
  return data;
}

function validateLocalFile(file) {
  if (!file) throw new Error('Fichier requis.');
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Fichier trop lourd (50 Mo max).');
}

function reloadMediaView() {
  window.setTimeout(() => document.querySelector('[data-admin-view="media"]')?.click(), 80);
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = label || 'Chargement...';
    button.setAttribute('aria-busy', 'true');
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.removeAttribute('aria-busy');
  }
}

function readFunctionError(error, fallback) {
  const message = String(error?.message || error || '').trim();
  if (/row-level security/i.test(message)) return 'Upload sécurisé indisponible. Recharge la page puis réessaie.';
  if (/jwt|unauthorized|401|403/i.test(message)) return 'Session admin expirée. Reconnecte-toi puis réessaie.';
  return message || fallback;
}

function toast(message, isError = false) {
  const node = document.createElement('div');
  node.className = `product-toast${isError ? ' error' : ''}`;
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
}
