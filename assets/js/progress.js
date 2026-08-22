import { LESSONS_DATA } from './data/lessons-data.js';
import { awardLearningPoints, recordLearningAttempt } from './services/learning-service.js';

const config = window.LEARNING_CONFIG || { masteryThreshold: 80, storageKey: 'eautoecole.learningProgress' };

const defaultProgress = {
  masteredLessons: [],
  lessonScores: {},
  currentLesson: 1,
  currentStep: {},
  mistakes: {}
};

export function getLearningProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(config.storageKey));
    return normalizeProgress(saved);
  } catch (error) {
    return normalizeProgress(null);
  }
}

export function saveLearningProgress(progress) {
  const normalized = normalizeProgress(progress);
  localStorage.setItem(config.storageKey, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent('learning-progress-updated', { detail: normalized }));
  return normalized;
}

export function canOpenLesson(lessonId) {
  const lessonNumber = Number(lessonId);
  if (lessonNumber === 1) return true;
  const progress = getLearningProgress();
  return progress.masteredLessons.includes(lessonNumber - 1);
}

export function getLessonState(lessonId) {
  const lessonNumber = Number(lessonId);
  const progress = getLearningProgress();
  if (progress.masteredLessons.includes(lessonNumber)) return 'MASTERED';
  if (!canOpenLesson(lessonNumber)) return 'LOCKED';
  if (progress.lessonScores[lessonNumber] && progress.lessonScores[lessonNumber] < config.masteryThreshold) return 'MASTERY_REQUIRED';
  if (progress.currentLesson === lessonNumber || progress.currentStep[lessonNumber]) return 'IN_PROGRESS';
  return 'AVAILABLE';
}

export function getStateLabel(state) {
  return {
    LOCKED: 'Verrouillée',
    AVAILABLE: 'À commencer',
    IN_PROGRESS: 'En cours',
    MASTERY_REQUIRED: 'Test de maîtrise',
    MASTERED: 'Maîtrisée'
  }[state] || 'À commencer';
}

export function setCurrentLessonStep(lessonId, stepIndex) {
  const lessonNumber = Number(lessonId);
  const progress = getLearningProgress();
  progress.currentLesson = lessonNumber;
  progress.currentStep[lessonNumber] = Number(stepIndex) || 0;
  return saveLearningProgress(progress);
}

export function completeLessonMastery(lessonId, score) {
  const lessonNumber = Number(lessonId);
  const numericScore = Number(score);
  const progress = getLearningProgress();
  const wasMastered = progress.masteredLessons.includes(lessonNumber);
  progress.lessonScores[lessonNumber] = numericScore;

  if (numericScore >= config.masteryThreshold && !wasMastered) {
    progress.masteredLessons.push(lessonNumber);
    progress.masteredLessons.sort((a, b) => a - b);
    progress.currentLesson = Math.min(lessonNumber + 1, LESSONS_DATA.length);
  } else {
    progress.currentLesson = lessonNumber;
  }

  const saved = saveLearningProgress(progress);
  recordLearningAttempt({
    activityType: 'lesson',
    activityKey: `lesson:${lessonNumber}:${Date.now()}`,
    topic: LESSONS_DATA.find((lesson) => lesson.id === lessonNumber)?.title || `Leçon ${lessonNumber}`,
    score: numericScore,
    isCorrect: numericScore >= config.masteryThreshold,
    metadata: { lessonId: lessonNumber }
  });
  if (numericScore >= config.masteryThreshold && !wasMastered) {
    awardLearningPoints({
      sourceKey: `lesson:${lessonNumber}`,
      kind: 'lesson',
      points: 10,
      metadata: { lessonId: lessonNumber, score: numericScore }
    });
  }
  return saved;
}

export function saveMistake(lessonId, topic) {
  const lessonNumber = Number(lessonId);
  const progress = getLearningProgress();
  if (!progress.mistakes[lessonNumber]) progress.mistakes[lessonNumber] = [];
  if (topic && !progress.mistakes[lessonNumber].includes(topic)) progress.mistakes[lessonNumber].push(topic);
  return saveLearningProgress(progress);
}

export function getNextLesson(lessonId) {
  const next = Number(lessonId) + 1;
  return LESSONS_DATA.find((lesson) => lesson.id === next) || null;
}

export function getResumeTarget() {
  const progress = getLearningProgress();
  const lesson = LESSONS_DATA.find((item) => item.id === progress.currentLesson) || LESSONS_DATA[0];
  const step = Number(progress.currentStep[lesson.id] || 0);
  return { lesson, step };
}

function normalizeProgress(progress) {
  const source = progress && typeof progress === 'object' ? progress : {};
  return {
    masteredLessons: Array.isArray(source.masteredLessons) ? source.masteredLessons.map(Number).filter(Number.isFinite) : [],
    lessonScores: source.lessonScores && typeof source.lessonScores === 'object' ? source.lessonScores : {},
    currentLesson: Number.isFinite(Number(source.currentLesson)) ? Number(source.currentLesson) : 1,
    currentStep: source.currentStep && typeof source.currentStep === 'object' ? source.currentStep : {},
    mistakes: source.mistakes && typeof source.mistakes === 'object' ? source.mistakes : {}
  };
}
