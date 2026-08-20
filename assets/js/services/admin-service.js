export async function loadAdminOverview({ page = 1, pageSize = 10, status = 'all', query = '' } = {}) {
  if (typeof window.sbGetProfilesPage === 'function' && typeof window.sbGetProfileCounts === 'function') {
    const [pageResult, countsResult] = await Promise.allSettled([
      window.sbGetProfilesPage({ page, pageSize, status, query }),
      window.sbGetProfileCounts()
    ]);
    if (pageResult.status === 'rejected') throw pageResult.reason;
    if (countsResult.status === 'rejected') {
      console.warn('Compteurs utilisateurs indisponibles', countsResult.reason);
    }
    return {
      ...pageResult.value,
      counts: countsResult.status === 'fulfilled' ? countsResult.value : null
    };
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
