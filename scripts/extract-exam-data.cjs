const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function writeModule(file, dataName, data) {
  const target = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `// Generated from legacy exam HTML. Do not edit question content by hand.\nexport const ${dataName} = ${JSON.stringify(data, null, 2)};\n`
  );
}

function runDataScript(source, expression) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__result = ${expression};`, context, { timeout: 3000 });
  return context.__result;
}

function extractLight() {
  const html = read('Poids_Leger.html');
  const start = html.indexOf('const seriesData = {');
  const end = html.indexOf('// ===== VARIABLES GLOBALES =====');
  if (start < 0 || end < 0) throw new Error('Unable to find light data block');
  const source = html.slice(start, end);
  const result = runDataScript(source, `{
    seriesData,
    questions: {
      B1: questionsB1, B2: questionsB2, B3: questionsB3, B4: questionsB4,
      B5: questionsB5, B6: questionsB6, B7: questionsB7, B8: questionsB8,
      B9: questionsB9, B10: questionsB10, B11: questionsB11, B12: questionsB12
    }
  }`);

  return {
    id: 'light',
    legacyId: 'poids_leger',
    title: 'Poids léger',
    license: 'Permis B',
    routeSegment: 'light',
    reviewPrefix: 'PL',
    durationMinutes: 30,
    passingScore: 21,
    historyKey: 'eautoecole.examHistory.light',
    reviewStorageKey: 'examReview:light',
    series: Object.keys(result.questions).map((seriesId) => ({
      id: seriesId,
      legacyId: seriesId,
      label: result.seriesData[seriesId]?.name || `Série ${seriesId}`,
      level: result.seriesData[seriesId]?.level || '',
      description: result.seriesData[seriesId]?.description || '',
      questionCount: result.questions[seriesId].length,
      durationMinutes: 30,
      passingScore: 21,
      questions: result.questions[seriesId].map((question, index) => ({
        ...question,
        id: `PL-${String(Object.keys(result.questions).slice(0, Object.keys(result.questions).indexOf(seriesId)).reduce((sum, key) => sum + result.questions[key].length, 0) + index + 1).padStart(3, '0')}`,
        number: index + 1,
        seriesId
      }))
    }))
  };
}

function extractHeavy() {
  const html = read('Poids_Lourd.html');
  const start = html.indexOf('let seriesData = {');
  const end = html.indexOf('// Variables globales');
  if (start < 0 || end < 0) throw new Error('Unable to find heavy data block');
  const source = html.slice(start, end);
  const result = runDataScript(source, 'seriesData');
  const legacyIds = Object.keys(result);
  let globalIndex = 0;

  return {
    id: 'heavy',
    legacyId: 'poids_lourd',
    title: 'Poids lourd',
    license: 'Permis C',
    routeSegment: 'heavy',
    reviewPrefix: 'PLD',
    durationMinutes: 15,
    passingScore: 8,
    historyKey: 'eautoecole.examHistory.heavy',
    reviewStorageKey: 'examReview:heavy',
    series: legacyIds.map((legacyId, index) => {
      const id = `C${index + 1}`;
      const questions = result[legacyId].questions.map((question, questionIndex) => {
        globalIndex += 1;
        return {
          ...question,
          id: `PLD-${String(globalIndex).padStart(3, '0')}`,
          number: questionIndex + 1,
          seriesId: id,
          legacySeriesId: legacyId
        };
      });
      return {
        id,
        legacyId,
        label: `Série ${id}`,
        level: index === 0 ? 'Débutant' : index < 3 ? 'Intermédiaire' : 'Avancé',
        description: '',
        questionCount: questions.length,
        durationMinutes: 15,
        passingScore: 8,
        questions
      };
    })
  };
}

writeModule('assets/js/data/exam-light-data.js', 'EXAM_LIGHT_DATA', extractLight());
writeModule('assets/js/data/exam-heavy-data.js', 'EXAM_HEAVY_DATA', extractHeavy());
console.log('exam data extracted');
