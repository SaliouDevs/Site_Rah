import { TEST_SERIES_DATA } from '../data/tests-data.js';
import { EXAM_LIGHT_DATA } from '../data/exam-light-data.js';
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

function dayNumber(date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

export function getDailyQuestions(limit = 10, date = new Date()) {
  const pool = getQuestionPool();
  const groupCount = Math.max(1, Math.ceil(pool.length / limit));
  const number = dayNumber(date);
  const cycle = Math.floor(number / groupCount);
  const slot = number % groupCount;
  const ordered = seededOrder(pool, `daily-cycle:${cycle}`);
  const selected = ordered.slice(slot * limit, (slot + 1) * limit);
  return selected.length === limit ? selected : [...selected, ...ordered.slice(0, limit - selected.length)];
}

export function getQuestionOfDay(date = new Date()) {
  return getDailyQuestions(10, date)[0] || null;
}

export function getSpeedQuestions(date = new Date()) {
  return seededOrder(getQuestionPool(), `${getDailyKey(date)}:speed`);
}

export async function recordTrainingAnswer({ mode, question, answer, correct, index }) {
  return recordLearningAttempt({
    activityType: mode,
    activityKey: `${mode}:${getDailyKey()}:${Date.now()}`,
    questionId: question.id,
    topic: question.topic || inferTopic(question),
    isCorrect: correct,
    metadata: { answer, correctAnswer: question.correctAnswer, index }
  });
}

export function getSituationQuestions(limit = 6, date = new Date()) {
  const candidates = EXAM_LIGHT_DATA.series.flatMap((series) => series.questions)
    .map(normalizeSituationQuestion)
    .filter(Boolean);
  return seededOrder(candidates, `${getDailyKey(date)}:situations`).slice(0, limit);
}

function normalizeSituationQuestion(question) {
  if (!question?.image) return null;
  if (question.optionType === 'type2') {
    const normalized = {
      id: question.id,
      text: question.text,
      image: question.image,
      explanation: question.explanation || '',
      options: { A: 'OUI', B: 'NON' },
      correctAnswer: question.correctAnswer
    };
    return { ...normalized, topic: inferTopic(normalized) };
  }
  if (question.optionType === 'type4') {
    const options = {};
    ['type4Text1', 'type4Text2', 'type4Text3', 'type4Text4'].forEach((field, index) => {
      if (question[field]) options[String.fromCharCode(65 + index)] = question[field];
    });
    if (!Object.keys(options).length || !question.correctAnswer) return null;
    const normalized = {
      id: question.id,
      text: question.text,
      image: question.image,
      explanation: question.explanation || '',
      options,
      correctAnswer: question.correctAnswer
    };
    return { ...normalized, topic: inferTopic(normalized) };
  }
  return null;
}
