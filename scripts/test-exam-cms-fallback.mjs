import { getExamDataSource } from '../assets/js/services/exam-cms-service.js';

const EXPECTED = {
  light: { series: 12, questions: 300, choices: 834 },
  heavy: { series: 5, questions: 50, choices: 120 }
};

function installMock(counts) {
  globalThis.window = {
    sb: {
      from(table) {
        return {
          select(_columns, options = {}) {
            return {
              eq(column, value) {
                if (table === 'exam_series' && options.count === 'exact') {
                  return Promise.resolve({ count: counts[value].series, error: null });
                }
                if (table === 'exam_series') {
                  return Promise.resolve({
                    data: Array.from({ length: counts[value].series }, (_, index) => ({
                      id: `series-${value}-${index}`,
                      current_version_id: index < counts[value].publishedSeries ? `series-version-${index}` : null
                    })),
                    error: null
                  });
                }
                if (table === 'exam_questions') {
                  return Promise.resolve({
                    data: Array.from({ length: counts[value].questions }, (_, index) => ({
                      id: `question-${value}-${index}`,
                      current_version_id: index < counts[value].publishedQuestions ? `question-version-${value}-${index}` : null
                    })),
                    error: null
                  });
                }
                return Promise.resolve({ data: [], count: 0, error: null });
              },
              in(_column, values) {
                const examKey = values[0]?.includes('heavy') ? 'heavy' : 'light';
                const totalQuestions = counts[examKey].questions || 1;
                const chunkRatio = values.length / totalQuestions;
                const chunkCount = Math.round(counts[examKey].choices * chunkRatio);
                return Promise.resolve({ count: chunkCount, error: null });
              }
            };
          }
        };
      }
    }
  };
}

async function expectSource(name, counts, examKey, expectedSource) {
  installMock(counts);
  const result = await getExamDataSource(examKey);
  const passed = result.source === expectedSource;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} - got ${result.source}`);
  if (!passed) process.exitCode = 1;
}

const complete = {
  light: { ...EXPECTED.light, publishedSeries: 12, publishedQuestions: 300 },
  heavy: { ...EXPECTED.heavy, publishedSeries: 5, publishedQuestions: 50 }
};

await expectSource('Light incomplete => legacy', {
  ...complete,
  light: { ...complete.light, questions: 299, publishedQuestions: 299 }
}, 'light', 'legacy');

await expectSource('Light complete => cms', complete, 'light', 'cms');

await expectSource('Light complete + Heavy incomplete => Heavy legacy', {
  ...complete,
  heavy: { ...complete.heavy, choices: 119 }
}, 'heavy', 'legacy');

await expectSource('Heavy complete => cms', complete, 'heavy', 'cms');
