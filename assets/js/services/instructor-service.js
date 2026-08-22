export async function loadInstructorStudents() {
  ensureClient();
  const { data, error } = await window.sb.rpc('get_instructor_students');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function loadAssignmentWorkspace(assignmentId) {
  ensureClient();
  const [notesRes, goalsRes, sessionsRes, questionsRes] = await Promise.all([
    window.sb.from('instructor_notes').select('*').eq('assignment_id', assignmentId).order('created_at', { ascending: false }).limit(30),
    window.sb.from('instructor_goals').select('*').eq('assignment_id', assignmentId).order('created_at', { ascending: false }),
    window.sb.from('driving_sessions').select('*').eq('assignment_id', assignmentId).order('scheduled_at', { ascending: false }).limit(30),
    window.sb.from('student_coaching_questions').select('*').eq('assignment_id', assignmentId).order('created_at', { ascending: false }).limit(30)
  ]);
  [notesRes, goalsRes, sessionsRes, questionsRes].forEach((result) => { if (result.error) throw result.error; });
  return {
    notes: notesRes.data || [],
    goals: goalsRes.data || [],
    sessions: sessionsRes.data || [],
    questions: questionsRes.data || []
  };
}

export async function addInstructorNote(assignmentId, note, visibleToStudent = true) {
  const { data, error } = await window.sb.rpc('instructor_add_note', {
    p_assignment_id: assignmentId,
    p_note: note,
    p_visible_to_student: visibleToStudent
  });
  if (error) throw error;
  return data;
}

export async function createInstructorGoal(assignmentId, { title, details = '', dueDate = null }) {
  const { data, error } = await window.sb.rpc('instructor_create_goal', {
    p_assignment_id: assignmentId,
    p_title: title,
    p_details: details || null,
    p_due_date: dueDate || null
  });
  if (error) throw error;
  return data;
}

export async function updateInstructorGoalStatus(goalId, status) {
  const { data, error } = await window.sb.rpc('instructor_update_goal_status', { p_goal_id: goalId, p_status: status });
  if (error) throw error;
  return Boolean(data);
}

export async function scheduleDrivingSession(assignmentId, { scheduledAt, durationMinutes = 60, location = '', focus = '' }) {
  const { data, error } = await window.sb.rpc('instructor_schedule_session', {
    p_assignment_id: assignmentId,
    p_scheduled_at: scheduledAt,
    p_duration_minutes: durationMinutes,
    p_location: location || null,
    p_focus: focus || null
  });
  if (error) throw error;
  return data;
}

export async function updateDrivingSession(sessionId, status, comment = '') {
  const { data, error } = await window.sb.rpc('instructor_update_session', {
    p_session_id: sessionId,
    p_status: status,
    p_comment: comment || null
  });
  if (error) throw error;
  return Boolean(data);
}

export async function replyCoachingQuestion(questionId, reply, close = false) {
  const { data, error } = await window.sb.rpc('instructor_reply_coaching_question', {
    p_question_id: questionId,
    p_reply: reply,
    p_close: close
  });
  if (error) throw error;
  return Boolean(data);
}

export async function loadStudentInstructorSummary() {
  ensureClient();
  const { data, error } = await window.sb.rpc('get_student_instructor_summary');
  if (error) throw error;
  return data || null;
}

export async function submitStudentCoachingQuestion(question) {
  ensureClient();
  const { data, error } = await window.sb.rpc('student_submit_coaching_question', { p_question: question });
  if (error) throw error;
  return data;
}

export async function loadStudentCoachingQuestions() {
  ensureClient();
  const user = await window.sbGetUser?.();
  if (!user) return [];
  const { data, error } = await window.sb.from('student_coaching_questions').select('*').eq('student_id', user.id).order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  return data || [];
}

function ensureClient() {
  if (!window.sb) throw new Error('Supabase indisponible');
}
