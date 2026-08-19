export async function adminAction(action, payload = {}) {
  const result = await window.sbInvokeAdminAction(action, payload);
  return result?.data ?? result;
}

export async function loadAdminOverview() {
  try {
    return await adminAction('overview');
  } catch (error) {
    let profiles = [];
    try {
      profiles = await window.sbGetAllProfiles();
    } catch (_fallbackError) {
      profiles = [];
    }
    return {
      profiles,
      settings: null,
      notifications: [],
      auditLogs: [],
      securityEvents: [],
      fallback: true
    };
  }
}

export const updateUserStatus = (userId, status) => adminAction('update-user-status', { userId, status });
export const renameUser = (userId, prenom) => adminAction('rename-user', { userId, prenom });
export const resetUserPassword = (userId, password) => adminAction('reset-password', { userId, password });
export const forceUserLogout = (userId) => adminAction('force-user-logout', { userId });
export const forceStudentsLogout = (confirm) => adminAction('force-students-logout', { confirm });
export const updateAppSettings = (settings) => adminAction('update-app-settings', { settings });
export const sendNotification = (notification) => adminAction('send-notification', { notification });
