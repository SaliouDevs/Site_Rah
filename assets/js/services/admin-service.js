export async function loadAdminOverview() {
  const profiles = await window.sbGetAllProfiles();
  return { profiles };
}

export async function updateUserStatus(userId, status) {
  return window.sbAdminUpdateStatus(userId, status);
}

export async function renameUser(userId, prenom) {
  return window.sbAdminRenameUser(userId, prenom);
}

export async function resetUserPassword(userId, password) {
  return window.sbAdminResetPassword(userId, password);
}

export async function deleteUser(userId) {
  return window.sbInvokeAdminAction('delete-user', { userId });
}
