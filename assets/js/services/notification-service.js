let presenceTimer = null;
let notificationChannel = null;

export async function loadNotifications(limit = 40) {
  ensureClient();
  const { data, error } = await window.sb.rpc('get_my_notifications', { p_limit: limit });
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id) {
  ensureClient();
  const { data, error } = await window.sb.rpc('mark_notification_read', { p_notification_id: id });
  if (error) throw error;
  return Boolean(data);
}

export async function markAllNotificationsRead() {
  ensureClient();
  const { data, error } = await window.sb.rpc('mark_all_notifications_read');
  if (error) throw error;
  return Number(data || 0);
}

export async function touchPresence() {
  ensureClient();
  const { data, error } = await window.sb.rpc('touch_user_presence');
  if (error) throw error;
  return data;
}

export function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  const ping = () => touchPresence().catch(() => {});
  ping();
  presenceTimer = window.setInterval(ping, 45000);
  window.addEventListener('focus', ping);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  return () => stopPresenceHeartbeat();
}

export function stopPresenceHeartbeat() {
  if (presenceTimer) window.clearInterval(presenceTimer);
  presenceTimer = null;
}

export async function subscribeNotifications(onNotification) {
  ensureClient();
  const user = await window.sbGetUser?.();
  if (!user) return null;
  if (notificationChannel) await window.sb.removeChannel(notificationChannel).catch(() => {});
  notificationChannel = window.sb
    .channel(`notifications:${user.id}:${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'app_notifications', filter: `recipient_id=eq.${user.id}` }, (payload) => {
      onNotification?.(payload.new);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(payload.new?.title || 'eAutoecole', { body: payload.new?.body || '' }); } catch (_) {}
      }
    })
    .subscribe();
  return notificationChannel;
}

export async function unsubscribeNotifications() {
  if (!notificationChannel || !window.sb) return;
  await window.sb.removeChannel(notificationChannel).catch(() => {});
  notificationChannel = null;
}

function ensureClient() { if (!window.sb) throw new Error('Supabase indisponible'); }
