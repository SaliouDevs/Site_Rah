const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.md', '.sql', '.ts', '.cjs']);
const IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp', '.gif', '.svg']);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') return [];
      return walk(fullPath);
    }
    return [fullPath];
  });
}

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function normalizeRepoPath(value) {
  return String(value || '').replace(/^\.?\//, '').replace(/\\/g, '/');
}

function buildReferences(files) {
  const references = new Map();
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const repoPath = toRepoPath(file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const matches = line.match(/Images\/[^"')\s`<>]+(?:\s[^"')`<>]+)*?\.(?:jpeg|jpg|png|webp|gif|svg)/gi) || [];
      for (const match of matches) {
        const imagePath = normalizeRepoPath(match);
        if (!references.has(imagePath)) references.set(imagePath, []);
        references.get(imagePath).push(`${repoPath}:${index + 1}`);
      }
    });
  }
  return references;
}

function summarize(items) {
  const nonEmpty = items.filter((item) => item.imagePath);
  const byImage = nonEmpty.reduce((map, item) => {
    map.set(item.imagePath, [...(map.get(item.imagePath) || []), item.questionId]);
    return map;
  }, new Map());
  return {
    questionCount: items.length,
    imageCount: new Set(nonEmpty.map((item) => item.imagePath)).size,
    missingImages: nonEmpty.filter((item) => !item.fileExists),
    duplicates: [...byImage.entries()]
      .filter(([, questionIds]) => questionIds.length > 1)
      .map(([image, questionIds]) => ({ image, questionIds }))
  };
}

function renderReport(exams, inventory, unusedImages) {
  const sections = exams.map((exam) => {
    const items = inventory.filter((item) => item.examId === exam.id);
    const summary = summarize(items);
    const title = exam.id === 'light' ? 'EXAMEN POIDS LEGER' : 'EXAMEN POIDS LOURD';
    return [
      `## ${title}`,
      `- questions: ${summary.questionCount}`,
      `- images: ${summary.imageCount}`,
      `- images manquantes: ${summary.missingImages.length}`,
      `- doublons eventuels: ${summary.duplicates.length}`,
      '',
      summary.missingImages.length
        ? summary.missingImages.map((item) => `- ${item.questionId}: ${item.imagePath}`).join('\n')
        : '- aucune image manquante referencee',
      '',
      summary.duplicates.length
        ? summary.duplicates.map((item) => `- ${item.image}: ${item.questionIds.join(', ')}`).join('\n')
        : '- aucun doublon detecte'
    ].join('\n');
  });

  return [
    '# Audit images examens',
    '',
    'Aucune image n a ete supprimee. Convention proposee pour les corrections futures:',
    '- Images/exams/poids-leger/pl-001.*',
    '- Images/exams/poids-lourd/pld-001.*',
    '',
    ...sections,
    '',
    '## IMAGES NON REFERENCEES',
    '',
    unusedImages.length ? unusedImages.map((image) => `- ${image}`).join('\n') : '- aucune'
  ].join('\n');
}

function readGeneratedData(file, exportName) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const prefix = `export const ${exportName} = `;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Missing ${exportName}`);
  return JSON.parse(source.slice(start + prefix.length).replace(/;\s*$/, ''));
}

async function loadExamData() {
  return [
    readGeneratedData('assets/js/data/exam-light-data.js', 'EXAM_LIGHT_DATA'),
    readGeneratedData('assets/js/data/exam-heavy-data.js', 'EXAM_HEAVY_DATA')
  ];
}

function buildInventory(exams, references) {
  const usageCounts = new Map();
  for (const exam of exams) {
    for (const series of exam.series) {
      for (const question of series.questions) {
        if (!question.image) continue;
        const imagePath = normalizeRepoPath(question.image);
        usageCounts.set(imagePath, (usageCounts.get(imagePath) || 0) + 1);
      }
    }
  }

  return exams.flatMap((exam) => exam.series.flatMap((series) => series.questions.map((question) => {
    const imagePath = normalizeRepoPath(question.image || '');
    return {
      examId: exam.id,
      questionId: question.id,
      series: series.id,
      imagePath,
      fileExists: imagePath ? fs.existsSync(path.join(ROOT, imagePath)) : false,
      usageCount: imagePath ? usageCounts.get(imagePath) || 0 : 0,
      references: imagePath ? references.get(imagePath) || [] : [],
      reviewStatus: 'À vérifier'
    };
  })));
}

(async () => {
  const files = walk(ROOT);
  const references = buildReferences(files);
  const exams = await loadExamData();
  const inventory = buildInventory(exams, references);
  const allImageFiles = walk(path.join(ROOT, 'Images'))
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map(toRepoPath);
  const usedExamImages = new Set(inventory.map((item) => item.imagePath).filter(Boolean));
  const unusedImages = allImageFiles.filter((image) => !usedExamImages.has(normalizeRepoPath(image)));

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'exam-image-inventory.json'), JSON.stringify({ inventory, unusedImages }, null, 2));
  fs.writeFileSync(path.join(ROOT, 'docs', 'exam-image-audit.md'), renderReport(exams, inventory, unusedImages));

  for (const exam of exams) {
    const summary = summarize(inventory.filter((item) => item.examId === exam.id));
    console.log(`${exam.id}: ${summary.questionCount} questions, ${summary.imageCount} images, ${summary.missingImages.length} missing, ${summary.duplicates.length} duplicate groups`);
  }
  console.log(`unused images: ${unusedImages.length}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
