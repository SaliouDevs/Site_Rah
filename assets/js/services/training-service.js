import { TEST_SERIES_DATA } from '../data/tests-data.js';
import { getDailyKey, inferTopic, recordLearningAttempt } from './learning-service.js';

export function getQuestionPool() {
  return Object.entries(TEST_SERIES_DATA).flatMap(([seriesKey, series]) =>
    series.questions.map((question, index) => ({ ...question, id: `${seriesKey}-${index + 1}`, seriesKey, topic: inferTopic(question) }))
  );
}

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function seededOrder(items, seedText) {
  return [...items].sort((a, b) => hash(`${seedText}:${a.id}`) - hash(`${seedText}:${b.id}`));
}

export function getDailyQuestions(limit = 10, date = new Date()) {
  return seededOrder(getQuestionPool(), getDailyKey(date)).slice(0, limit);
}

export function getQuestionOfDay(date = new Date()) {
  return getDailyQuestions(1, date)[0] || null;
}

export function getSpeedQuestions(date = new Date()) {
  return seededOrder(getQuestionPool(), `${getDailyKey(date)}:speed`);
}

export async function recordTrainingAnswer({ mode, question, answer, correct, index }) {
  return recordLearningAttempt({
    activityType: mode,
    activityKey: `${mode}:${getDailyKey()}:${Date.now()}`,
    questionId: question.id,
    topic: question.topic,
    isCorrect: correct,
    metadata: { answer, correctAnswer: question.correctAnswer, index }
  });
}

export function getSituationQuestions(limit = 6, date = new Date()) {
  const candidates = getQuestionPool().filter((question) => question.image);
  return seededOrder(candidates, `${getDailyKey(date)}:situations`).slice(0, limit);
}
