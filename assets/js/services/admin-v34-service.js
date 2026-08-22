export async function loadAdminLinkRequests() { return rpc('get_admin_link_requests') || []; }
export async function reviewInstructorLinkRequest(requestId, decision, note = '') {
  return Boolean(await rpc('admin_review_instructor_link_request', { p_request_id: requestId, p_decision: decision, p_note: note || null }));
}
export async function loadAdminCommercialDashboard() { return rpc('get_admin_commercial_dashboard'); }
export async function loadAdminPaymentsWorkspace() { return rpc('get_admin_payments_workspace'); }
export async function markCommissionPaid({ schoolId, periodStart, periodEnd, reference, observation = '' }) {
  return rpc('admin_mark_commission_paid', { p_school_id: schoolId, p_period_start: periodStart, p_period_end: periodEnd, p_reference: reference, p_observation: observation || null });
}
export async function upsertDrivingSchool({ id = null, name, slug, phone = '', email = '', address = '', city = '', commissionRate = 25, status = 'active' }) {
  return rpc('admin_upsert_driving_school', {
    p_id: id || null, p_name: name, p_slug: slug, p_phone: phone || null, p_email: email || null,
    p_address: address || null, p_city: city || null, p_commission_rate: Number(commissionRate), p_status: status
  });
}
export async function assignInstructorSchool(instructorId, schoolId) {
  return Boolean(await rpc('admin_assign_instructor_school', { p_instructor_id: instructorId, p_school_id: schoolId }));
}
export async function createInstructorAccount({ name, phone, password, schoolId }) {
  ensureClient();
  const { data, error } = await window.sb.functions.invoke('admin-instructor-account', { body: { name, phone, password, schoolId } });
  if (error) throw error;
  if (data?.success === false || data?.error) throw new Error(data?.error || 'Création impossible');
  return data;
}
export async function loadDrivingSchools() {
  ensureClient();
  const { data, error } = await window.sb.from('driving_schools').select('*').order('name');
  if (error) throw error; return data || [];
}
export async function loadInstructorProfiles() {
  ensureClient();
  const { data, error } = await window.sb.from('profiles').select('id,prenom,telephone,status,photo_url,driving_school_id,account_role').eq('account_role', 'instructor').order('prenom');
  if (error) throw error; return data || [];
}
async function rpc(name, args = {}) { ensureClient(); const { data, error } = await window.sb.rpc(name, args); if (error) throw error; return data; }
function ensureClient() { if (!window.sb) throw new Error('Supabase indisponible'); }
