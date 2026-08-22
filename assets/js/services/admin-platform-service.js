export async function deleteExamQuestionVersion(questionId, versionId) {
  const { data, error } = await window.sb.rpc('admin_delete_exam_question_version', {
    p_question_id: questionId,
    p_version_id: versionId
  });
  if (error) throw error;
  return Boolean(data);
}

export async function loadExamQuestionVersion(versionId) {
  const [{ data: version, error: versionError }, { data: choices, error: choicesError }] = await Promise.all([
    window.sb.from('exam_question_versions').select('*').eq('id', versionId).single(),
    window.sb.from('exam_question_choices').select('*').eq('question_version_id', versionId).order('sort_order')
  ]);
  if (versionError) throw versionError;
  if (choicesError) throw choicesError;
  return { version, choices: choices || [] };
}
