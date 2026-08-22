export async function loadInstructorDashboard() { return rpc('get_instructor_dashboard'); }
export async function loadInstructorStudents() { const data = await rpc('get_instructor_students'); return Array.isArray(data) ? data : []; }
export async function loadInstructorStudentDetail(assignmentId) { return rpc('get_instructor_student_detail', { p_assignment_id: assignmentId }); }
export async function requestStudentLink(phone) { return rpc('instructor_request_student_link', { p_phone: phone }); }
export async function loadInstructorProfileWorkspace() { return rpc('get_instructor_profile_workspace'); }

export async function loadAssignmentWorkspace(assignmentId) {
  ensureClient();
  const [notes, goals, sessions, questions, recommendations, exams, evaluations] = await Promise.all([
    query('instructor_notes', assignmentId, 'created_at'),
    query('instructor_goals', assignmentId, 'created_at'),
    query('driving_sessions', assignmentId, 'scheduled_at'),
    query('student_coaching_questions', assignmentId, 'created_at'),
    query('instructor_recommendations', assignmentId, 'created_at'),
    query('student_exams', assignmentId, 'scheduled_at'),
    query('driving_evaluations', assignmentId, 'evaluation_date')
  ]);
  return { notes, goals, sessions, questions, recommendations, exams, evaluations };
}

export async function addInstructorNote(assignmentId, note, visibleToStudent = true) {
  return rpc('instructor_add_note', { p_assignment_id: assignmentId, p_note: note, p_visible_to_student: visibleToStudent });
}
export async function createInstructorGoal(assignmentId, { title, details = '', dueDate = null }) {
  return rpc('instructor_create_goal', { p_assignment_id: assignmentId, p_title: title, p_details: details || null, p_due_date: dueDate || null });
}
export async function updateInstructorGoalStatus(goalId, status) { return Boolean(await rpc('instructor_update_goal_status', { p_goal_id: goalId, p_status: status })); }
export async function scheduleDrivingSession(assignmentId, payload) { return scheduleInstructorActivity(assignmentId, { ...payload, type: 'driving' }); }
export async function scheduleInstructorActivity(assignmentId, { type = 'driving', scheduledAt, durationMinutes = 60, location = '', theme = '', focus = '' }) {
  return rpc('instructor_schedule_activity', {
    p_assignment_id: assignmentId, p_session_type: type, p_scheduled_at: scheduledAt,
    p_duration_minutes: Number(durationMinutes || 60), p_location: location || null,
    p_theme: theme || null, p_focus: focus || null
  });
}
export async function updateDrivingSession(sessionId, status, comment = '') { return updateInstructorActivity(sessionId, { status, comment }); }
export async function updateInstructorActivity(sessionId, { status, attendance = 'unknown', comment = '' }) {
  return Boolean(await rpc('instructor_update_activity', { p_session_id: sessionId, p_status: status, p_attendance: attendance, p_comment: comment || null }));
}
export async function replyCoachingQuestion(questionId, reply, close = false) { return Boolean(await rpc('instructor_reply_coaching_question', { p_question_id: questionId, p_reply: reply, p_close: close })); }
export async function setStudentReadiness(assignmentId, status) { return Boolean(await rpc('instructor_set_readiness', { p_assignment_id: assignmentId, p_status: status })); }
export async function createRecommendation(assignmentId, { type, title, targetKey = '', note = '' }) {
  return rpc('instructor_create_recommendation', { p_assignment_id: assignmentId, p_type: type, p_title: title, p_target_key: targetKey || null, p_note: note || null });
}
export async function updateStudentRecommendation(recommendationId, status) { return Boolean(await rpc('student_update_recommendation', { p_recommendation_id: recommendationId, p_status: status })); }
export async function scheduleStudentExam(assignmentId, { type, scheduledAt, location = '' }) {
  return rpc('instructor_schedule_exam', { p_assignment_id: assignmentId, p_exam_type: type, p_scheduled_at: scheduledAt, p_location: location || null });
}
export async function updateStudentExamResult(examId, status, observation = '') { return Boolean(await rpc('instructor_update_exam_result', { p_exam_id: examId, p_status: status, p_observation: observation || null })); }
export async function addDrivingEvaluation(assignmentId, { sessionId = null, durationMinutes = 60, location = '', ratings = {}, score, comment = '' }) {
  return rpc('instructor_add_driving_evaluation', {
    p_assignment_id: assignmentId, p_session_id: sessionId || null, p_duration: Number(durationMinutes || 60),
    p_location: location || null, p_ratings: ratings || {}, p_score: Number(score), p_comment: comment || null
  });
}
export async function loadAssignmentMessages(assignmentId, limit = 100) { const data = await rpc('get_assignment_messages', { p_assignment_id: assignmentId, p_limit: limit }); return data || []; }
export async function sendAssignmentMessage(assignmentId, { kind = 'text', body = '', mediaPath = null, mimeType = null }) {
  return rpc('instructor_send_message', { p_assignment_id: assignmentId, p_kind: kind, p_body: body || null, p_media_path: mediaPath || null, p_mime_type: mimeType || null });
}
export async function markAssignmentMessagesRead(assignmentId) { return Number(await rpc('mark_assignment_messages_read', { p_assignment_id: assignmentId }) || 0); }
export async function loadStudentInstructorSummary() { return rpc('get_student_instructor_summary'); }
export async function loadStudentInstructorPortal() { return rpc('get_student_instructor_portal'); }
export async function submitStudentCoachingQuestion(question) { return rpc('student_submit_coaching_question', { p_question: question }); }
export async function loadStudentCoachingQuestions() {
  ensureClient(); const user = await window.sbGetUser?.(); if (!user) return [];
  const { data, error } = await window.sb.from('student_coaching_questions').select('*').eq('student_id', user.id).order('created_at', { ascending: false }).limit(20);
  if (error) throw error; return data || [];
}

async function query(table, assignmentId, orderBy) {
  const { data, error } = await window.sb.from(table).select('*').eq('assignment_id', assignmentId).order(orderBy, { ascending: false }).limit(60);
  if (error) throw error; return data || [];
}
async function rpc(name, args = {}) { ensureClient(); const { data, error } = await window.sb.rpc(name, args); if (error) throw error; return data; }
function ensureClient() { if (!window.sb) throw new Error('Supabase indisponible'); }
