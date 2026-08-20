export async function loadAdminOverview({ page = 1, pageSize = 10, status = 'all', query = '' } = {}) {
  if (typeof window.sbGetProfilesPage === 'function' && typeof window.sbGetProfileCounts === 'function') {
    const [pageResult, counts] = await Promise.all([
      window.sbGetProfilesPage({ page, pageSize, status, query }),
      window.sbGetProfileCounts()
    ]);
    return { ...pageResult, counts };
  }
  throw new Error('Pagination utilisateurs indisponible');
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
