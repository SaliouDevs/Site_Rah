const BUCKET = 'instructor-messages';

export async function uploadMessageMedia(assignmentId, file) {
  ensureClient();
  const mimeType = normalizeMime(file);
  const { data: prepared, error: prepareError } = await window.sb.functions.invoke('instructor-message-media', {
    body: { action: 'prepare', assignmentId, filename: file.name || 'file', mimeType }
  });
  if (prepareError) throw prepareError;
  if (!prepared?.path || !prepared?.token) throw new Error(prepared?.error || 'Préparation du média impossible');
  const { error: uploadError } = await window.sb.storage.from(BUCKET).uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: mimeType });
  if (uploadError) throw uploadError;
  return { path: prepared.path, mimeType, kind: kindFromMime(mimeType) };
}

export async function getMessageMediaUrl(assignmentId, path) {
  if (!path) return null;
  ensureClient();
  const { data, error } = await window.sb.functions.invoke('instructor-message-media', { body: { action: 'view', assignmentId, path } });
  if (error) throw error;
  if (!data?.url) throw new Error(data?.error || 'Média indisponible');
  return data.url;
}

export function kindFromMime(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function normalizeMime(file) {
  const direct = String(file?.type || '').toLowerCase();
  if (direct) return direct;
  const name = String(file?.name || '').toLowerCase();
  if (/\.(jpg|jpeg)$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  if (/\.(heic|heif)$/.test(name)) return 'image/heic';
  if (/\.mp3$/.test(name)) return 'audio/mpeg';
  if (/\.(m4a|mp4a)$/.test(name)) return 'audio/mp4';
  if (/\.wav$/.test(name)) return 'audio/wav';
  if (/\.ogg$/.test(name)) return 'audio/ogg';
  if (/\.aac$/.test(name)) return 'audio/aac';
  if (/\.mov$/.test(name)) return 'video/quicktime';
  if (/\.mp4$/.test(name)) return 'video/mp4';
  if (/\.webm$/.test(name)) return 'video/webm';
  if (/\.pdf$/.test(name)) return 'application/pdf';
  if (/\.txt$/.test(name)) return 'text/plain';
  return 'application/octet-stream';
}

function ensureClient() { if (!window.sb) throw new Error('Supabase indisponible'); }
