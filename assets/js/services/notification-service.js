let notificationsChannel = null;

export async function loadUnreadNotifications(userId) {
  if (!window.sb || !userId) return [];
  const now = new Date().toISOString();
  const { data, error } = await window.sb
    .from('user_notifications')
    .select('id,title,message,type,requires_ack,target_user_id,starts_at,expires_at')
    .or(`target_user_id.is.null,target_user_id.eq.${userId}`)
    .lte('starts_at', now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false });
  if (error) return [];

  const { data: receipts } = await window.sb
    .from('notification_receipts')
    .select('notification_id')
    .eq('user_id', userId);
  const read = new Set((receipts || []).map((item) => item.notification_id));
  return (data || []).filter((item) => !read.has(item.id));
}

export async function acknowledgeNotification(notificationId) {
  const user = await window.sbGetUser();
  if (!user) return;
  await window.sb.from('notification_receipts').upsert({
    notification_id: notificationId,
    user_id: user.id,
    acknowledged_at: new Date().toISOString()
  });
}

export function subscribeToNotifications(userId, callback) {
  if (!window.sbSubscribe || notificationsChannel) return notificationsChannel;
  notificationsChannel = window.sbSubscribe(
    `notifications-${userId}`,
    { event: 'INSERT', schema: 'public', table: 'user_notifications' },
    () => callback()
  );
  return notificationsChannel;
}
