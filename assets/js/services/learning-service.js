export async function recordLearningAttempt(payload) {
  if (typeof window.sbRecordLearningAttempt !== 'function') return null;
  try {
    return await window.sbRecordLearningAttempt(payload);
  } catch (error) {
    console.warn('Progression serveur différée', error);
    return null;
  }
}

export async function awardLearningPoints({ sourceKey, kind, points, metadata = {} }) {
  if (typeof window.sbAwardLearningPoints !== 'function') return null;
  try {
    if (kind === 'exam' && metadata.exam && metadata.series) {
      await recordLearningAttempt({
        activityType: 'exam',
        activityKey: `${sourceKey}:result`,
        topic: `Examen ${metadata.exam} · ${metadata.series}`,
        isCorrect: true,
        metadata
      });
    }
    const total = await window.sbAwardLearningPoints({ sourceKey, kind, points, metadata });
    window.dispatchEvent(new CustomEvent('learning-points-updated', { detail: { total } }));
    return total;
  } catch (error) {
    console.warn('Attribution de points différée', error);
    return null;
  }
}

export async function getLearningDashboard() {
  if (typeof window.sbGetLearningDashboard !== 'function') {
    return { points: 0, attempts: 0, answered: 0, correct: 0, weakTopics: [] };
  }
  try {
    return await window.sbGetLearningDashboard();
  } catch (error) {
    console.warn('Tableau intelligent indisponible', error);
    return { points: 0, attempts: 0, answered: 0, correct: 0, weakTopics: [] };
  }
}

export async function getLearningProfile() {
  try { return await window.sbGetLearningProfile?.(); }
  catch (error) { console.warn('Profil apprentissage indisponible', error); return null; }
}

export async function saveLearningProfile(updates) {
  if (typeof window.sbUpsertLearningProfile !== 'function') return null;
  return window.sbUpsertLearningProfile(updates);
}

export function getDailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function inferTopic(question = {}) {
  const text = `${question.text || ''} ${question.explanation || ''}`.toLowerCase();
  const rules = [
    ['priorités', ['priorit', 'cédez', 'cedez', 'stop', 'intersection']],
    ['signalisation', ['panneau', 'signal', 'interdit', 'obligation']],
    ['vitesse', ['vitesse', 'km/h', 'ralent']],
    ['stationnement', ['stationnement', 'arrêt', 'arret']],
    ['dépassement', ['dépasse', 'depasse']],
    ['piétons', ['piéton', 'pieton']],
    ['danger', ['danger', 'virage', 'glissant', 'travaux']],
    ['conduite', ['conduct', 'chaussée', 'chaussee', 'circulation']]
  ];
  return rules.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || 'code de la route';
}
