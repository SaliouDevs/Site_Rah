import { LESSONS_DATA } from '../data/lessons-data.js';
import {
  canOpenLesson,
  completeLessonMastery,
  getLearningProgress,
  getLessonState,
  getNextLesson,
  getStateLabel,
  saveMistake,
  setCurrentLessonStep
} from '../progress.js';
import { navigateTo } from '../router.js';

const threshold = (window.LEARNING_CONFIG && window.LEARNING_CONFIG.masteryThreshold) || 80;

export function renderLessonsView(container) {
  const progress = getLearningProgress();
  container.innerHTML = `
    <section class="view-stack">
      <div class="view-heading">
        <p class="eyebrow">Parcours guidé</p>
        <h1>Leçons</h1>
        <p>Comprendre, pratiquer, recevoir du feedback, maîtriser puis débloquer la suite.</p>
      </div>
      <div class="learning-path">
        ${LESSONS_DATA.map((lesson) => {
          const state = getLessonState(lesson.id);
          const score = progress.lessonScores[lesson.id];
          return `
            <button class="lesson-path-card ${state.toLowerCase()}" type="button" data-open-lesson="${lesson.id}" ${state === 'LOCKED' ? 'aria-disabled="true"' : ''}>
              <span class="lesson-order">${String(lesson.id).padStart(2, '0')}</span>
              <span class="lesson-path-main">
                <strong>${lesson.title}</strong>
                <small>${lesson.description}</small>
                <em>${getStateLabel(state)}${score ? ` · ${score} %` : ''}</em>
              </span>
              <span class="lesson-path-icon">${state === 'MASTERED' ? '✓' : state === 'LOCKED' ? '' : '→'}</span>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;

  container.querySelectorAll('[data-open-lesson]').forEach((button) => {
    button.addEventListener('click', () => {
      const lessonId = Number(button.dataset.openLesson);
      if (!canOpenLesson(lessonId)) {
        window.eautoToast('Cette leçon est verrouillée. Maîtrise la leçon précédente pour la débloquer.');
        return;
      }
      navigateTo(`/lesson/${lessonId}`);
    });
  });
}

export function renderLessonView(container, params) {
  const lessonId = Number(params.id);
  const lesson = LESSONS_DATA.find((item) => item.id === lessonId);
  if (!lesson || !canOpenLesson(lessonId)) {
    navigateTo('/lessons');
    return;
  }

  const progress = getLearningProgress();
  const steps = buildLessonSteps(lesson);
  let currentStep = Math.min(Number(progress.currentStep[lessonId] || 0), steps.length - 1);
  let mode = 'lesson';
  let masteryIndex = 0;
  const masteryAnswers = [];
  const masteryQuestions = getMasteryQuestions(lesson);

  render();

  function render() {
    if (mode === 'mastery') {
      renderMastery();
      return;
    }

    setCurrentLessonStep(lessonId, currentStep);
    const step = steps[currentStep];
    container.innerHTML = `
      <section class="lesson-reader-view immersive-view">
        <button class="text-back" type="button" data-back-lessons>← Toutes les leçons</button>
        <div class="reader-panel">
          <div class="reader-meta">
            <span>Leçon ${lesson.id} sur ${LESSONS_DATA.length}</span>
            <strong>Étape ${currentStep + 1} sur ${steps.length}</strong>
          </div>
          <h1>${lesson.title}</h1>
          <p class="reader-description">${lesson.description}</p>
          <div class="step-progress"><span style="width:${Math.round(((currentStep + 1) / steps.length) * 100)}%"></span></div>
          <article class="lesson-step-content">${step.html}</article>
          ${step.quiz ? renderMicroQuiz(step.quiz) : ''}
          <div class="reader-actions">
            <button class="secondary-action" type="button" data-prev-step ${currentStep === 0 ? 'disabled' : ''}>Étape précédente</button>
            ${currentStep === steps.length - 1
              ? '<button class="primary-action" type="button" data-start-mastery>Passer le test de maîtrise</button>'
              : '<button class="primary-action" type="button" data-next-step>Continuer</button>'}
          </div>
        </div>
      </section>
    `;

    bindReaderControls();
  }

  function bindReaderControls() {
    container.querySelector('[data-back-lessons]').addEventListener('click', () => navigateTo('/lessons'));
    const prev = container.querySelector('[data-prev-step]');
    if (prev) {
      prev.addEventListener('click', () => {
        currentStep = Math.max(0, currentStep - 1);
        render();
      });
    }
    const next = container.querySelector('[data-next-step]');
    if (next) {
      next.addEventListener('click', () => {
        currentStep = Math.min(steps.length - 1, currentStep + 1);
        render();
      });
    }
    const startMastery = container.querySelector('[data-start-mastery]');
    if (startMastery) {
      startMastery.addEventListener('click', () => {
        mode = 'mastery';
        masteryIndex = 0;
        masteryAnswers.length = 0;
        renderMastery();
      });
    }
    bindMicroQuiz(container, lessonId);
  }

  function renderMastery() {
    const question = masteryQuestions[masteryIndex];
    container.innerHTML = `
      <section class="mastery-view immersive-view">
        <button class="text-back" type="button" data-back-lesson>← Revoir la leçon</button>
        <div class="reader-panel">
          <div class="reader-meta">
            <span>Test de maîtrise</span>
            <strong>Question ${masteryIndex + 1} sur ${masteryQuestions.length}</strong>
          </div>
          <h1>${lesson.title}</h1>
          <div class="quiz-block mastery-question" data-mastery-question>
            <p>${question.prompt}</p>
            <div class="quiz-options">
              ${question.options.map((option, index) => `
                <button type="button" data-answer="${index}">${option}</button>
              `).join('')}
            </div>
            <div class="quiz-feedback" data-feedback></div>
          </div>
          <div class="reader-actions">
            <button class="primary-action" type="button" data-validate-mastery disabled>Valider</button>
          </div>
        </div>
      </section>
    `;

    let selected = null;
    container.querySelector('[data-back-lesson]').addEventListener('click', () => {
      mode = 'lesson';
      render();
    });
    container.querySelectorAll('[data-answer]').forEach((button) => {
      button.addEventListener('click', () => {
        selected = Number(button.dataset.answer);
        container.querySelectorAll('[data-answer]').forEach((item) => item.classList.remove('selected'));
        button.classList.add('selected');
        container.querySelector('[data-validate-mastery]').disabled = false;
      });
    });
    container.querySelector('[data-validate-mastery]').addEventListener('click', () => {
      const isCorrect = selected === question.answer;
      masteryAnswers[masteryIndex] = isCorrect;
      if (!isCorrect) {
        saveMistake(lessonId, question.topic);
      }
      const feedback = container.querySelector('[data-feedback]');
      feedback.className = `quiz-feedback ${isCorrect ? 'correct' : 'wrong'}`;
      feedback.innerHTML = `<strong>${isCorrect ? 'Correct' : 'À revoir'}</strong><span>${question.explanation}</span>`;
      container.querySelector('[data-validate-mastery]').outerHTML = `<button class="primary-action" type="button" data-next-mastery>${masteryIndex === masteryQuestions.length - 1 ? 'Voir le résultat' : 'Question suivante →'}</button>`;
      container.querySelector('[data-next-mastery]').addEventListener('click', () => {
        if (masteryIndex === masteryQuestions.length - 1) {
          renderMasteryResult();
        } else {
          masteryIndex += 1;
          renderMastery();
        }
      });
    });
  }

  function renderMasteryResult() {
    const correctCount = masteryAnswers.filter(Boolean).length;
    const score = Math.round((correctCount / masteryQuestions.length) * 100);
    const passed = score >= threshold;
    completeLessonMastery(lessonId, score);
    const nextLesson = getNextLesson(lessonId);
    const mistakes = masteryQuestions.filter((question, index) => !masteryAnswers[index]).map((question) => question.topic);

    container.innerHTML = `
      <section class="mastery-result-view immersive-view">
        <div class="reader-panel result-panel ${passed ? 'passed' : 'failed'}">
          <div class="result-check">${passed ? '✓' : '!'}</div>
          <p class="eyebrow">${passed ? 'Leçon maîtrisée' : 'Encore un peu de révision'}</p>
          <h1>${score} %</h1>
          <p>${passed ? 'La leçon suivante est débloquée.' : 'Revois les points clés, puis repasse le test de maîtrise.'}</p>
          ${mistakes.length ? `<div class="review-list"><strong>Points à revoir</strong>${mistakes.map((item) => `<span>${item}</span>`).join('')}</div>` : ''}
          <div class="reader-actions">
            ${passed && nextLesson ? `<button class="primary-action" type="button" data-continue-next>Continuer vers ${nextLesson.title} →</button>` : ''}
            <button class="secondary-action" type="button" data-review-lesson>Revoir la leçon</button>
            <button class="secondary-action" type="button" data-retry-mastery>Refaire le test</button>
          </div>
        </div>
      </section>
    `;

    const continueNext = container.querySelector('[data-continue-next]');
    if (continueNext && nextLesson) {
      continueNext.addEventListener('click', () => navigateTo(`/lesson/${nextLesson.id}`));
    }
    container.querySelector('[data-review-lesson]').addEventListener('click', () => {
      mode = 'lesson';
      currentStep = 0;
      render();
    });
    container.querySelector('[data-retry-mastery]').addEventListener('click', () => {
      mode = 'mastery';
      masteryIndex = 0;
      masteryAnswers.length = 0;
      renderMastery();
    });
  }
}

function buildLessonSteps(lesson) {
  const template = document.createElement('template');
  template.innerHTML = lesson.html;
  const root = template.content.firstElementChild;
  if (!root) {
    return [{ title: lesson.title, html: lesson.html, quiz: buildMicroQuizForLesson(lesson, 0) }];
  }

  root.querySelector('.lesson-title')?.remove();
  const children = Array.from(root.children);
  const groups = [];
  let current = { title: 'Définition', nodes: [] };

  children.forEach((node) => {
    if (node.classList && node.classList.contains('lesson-subtitle') && current.nodes.length) {
      groups.push(current);
      current = { title: node.textContent.trim(), nodes: [node] };
      return;
    }
    current.nodes.push(node);
  });
  if (current.nodes.length) {
    groups.push(current);
  }

  const maxSteps = Math.min(groups.length, 8);
  const steps = groups.slice(0, maxSteps).map((group, index) => ({
    title: group.title,
    html: group.nodes.map((node) => node.outerHTML).join(''),
    quiz: index % 2 === 1 ? buildMicroQuizForLesson(lesson, index) : null
  }));

  if (groups.length > maxSteps) {
    steps[maxSteps - 1].html += groups.slice(maxSteps).flatMap((group) => group.nodes).map((node) => node.outerHTML).join('');
  }

  return steps.length ? steps : [{ title: lesson.title, html: root.innerHTML, quiz: buildMicroQuizForLesson(lesson, 0) }];
}

function buildMicroQuizForLesson(lesson, index) {
  const mastery = getMasteryQuestions(lesson);
  return mastery[index % mastery.length];
}

function bindMicroQuiz(container, lessonId) {
  const quiz = container.querySelector('[data-micro-quiz]');
  if (!quiz) {
    return;
  }
  const answer = Number(quiz.dataset.answer);
  const topic = quiz.dataset.topic;
  quiz.querySelectorAll('[data-micro-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = Number(button.dataset.microAnswer);
      const correct = selected === answer;
      quiz.querySelectorAll('[data-micro-answer]').forEach((item) => item.disabled = true);
      button.classList.add(correct ? 'correct' : 'wrong');
      if (!correct) {
        saveMistake(lessonId, topic);
      }
      const feedback = quiz.querySelector('[data-feedback]');
      feedback.className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`;
      feedback.innerHTML = `<strong>${correct ? 'Correct' : 'À revoir'}</strong><span>${quiz.dataset.explanation}</span>`;
    });
  });
}

function renderMicroQuiz(question) {
  return `
    <aside class="quiz-block" data-micro-quiz data-answer="${question.answer}" data-topic="${escapeAttribute(question.topic)}" data-explanation="${escapeAttribute(question.explanation)}">
      <p>${question.prompt}</p>
      <div class="quiz-options">
        ${question.options.map((option, index) => `<button type="button" data-micro-answer="${index}">${option}</button>`).join('')}
      </div>
      <div class="quiz-feedback" data-feedback></div>
    </aside>
  `;
}

function getMasteryQuestions(lesson) {
  const questionBank = {
    1: [
      ['La route est un espace public aménagé pour la circulation des usagers.', ['Vrai', 'Faux'], 0, 'Définition de la route', 'Le cours définit la route comme un espace public aménagé pour les usagers.'],
      ['Quel élément est réservé exclusivement aux piétons ?', ['La chaussée', 'Le trottoir', 'Le terre-plein central'], 1, 'Parties de la route', 'Le trottoir est présenté comme l’espace réservé aux piétons.'],
      ['Que doit faire le conducteur quand la route est mouillée ?', ['Accélérer', 'Adapter la vitesse', 'Ignorer l’adhérence'], 1, 'Adhérence', 'Le cours demande d’adapter la vitesse et les distances.']
    ],
    2: [
      ['Quelle qualité fait partie d’un bon conducteur ?', ['Vigilance', 'Précipitation', 'Distraction'], 0, 'Qualités du conducteur', 'Le cours cite la vigilance comme qualité essentielle.'],
      ['Le téléphone au volant est une distraction majeure.', ['Vrai', 'Faux'], 0, 'Téléphone au volant', 'Le contenu indique que le téléphone est une distraction majeure.'],
      ['La responsabilité civile concerne...', ['La réparation des dommages', 'Le choix du carburant', 'Le nettoyage du véhicule'], 0, 'Responsabilité', 'Le cours associe responsabilité civile et réparation des dommages.']
    ],
    3: [
      ['Quel système permet de ralentir ou arrêter le véhicule ?', ['Direction', 'Freinage', 'Échappement'], 1, 'Freinage', 'Le freinage permet de ralentir ou d’arrêter.'],
      ['Un véhicule mal entretenu représente un danger.', ['Vrai', 'Faux'], 0, 'Entretien', 'Le cours insiste sur le danger d’un véhicule mal entretenu.'],
      ['Quel document est cité comme obligatoire ?', ['Permis de conduire', 'Carte bancaire', 'Carnet scolaire'], 0, 'Documents', 'Le permis de conduire fait partie des documents obligatoires cités.']
    ],
    4: [
      ['La signalisation routière sert à informer, guider et réglementer.', ['Vrai', 'Faux'], 0, 'Signalisation', 'C’est la définition donnée dans le cours.'],
      ['Les panneaux de danger alertent l’usager.', ['Vrai', 'Faux'], 0, 'Panneaux de danger', 'Le cours indique qu’ils attirent l’attention sur un danger.'],
      ['Une ligne continue interdit généralement...', ['Le franchissement', 'Le ralentissement', 'L’allumage des feux'], 0, 'Ligne continue', 'Le cours précise qu’elle interdit le franchissement et le chevauchement.']
    ],
    5: [
      ['Une règle de circulation sert à organiser les comportements entre usagers.', ['Vrai', 'Faux'], 0, 'Règles de circulation', 'Le contenu de la leçon traite des règles qui organisent la circulation.'],
      ['À une intersection, la priorité sert à déterminer...', ['Qui passe en premier', 'La couleur du véhicule', 'Le type de carburant'], 0, 'Priorité', 'La priorité organise le passage des usagers.'],
      ['L’arrêt et le stationnement font partie des règles à maîtriser.', ['Vrai', 'Faux'], 0, 'Arrêt et stationnement', 'La leçon traite ces notions comme des règles de circulation.']
    ],
    6: [
      ['Plus la vitesse augmente, plus la distance d’arrêt augmente.', ['Vrai', 'Faux'], 0, 'Distance d’arrêt', 'Le cours relie vitesse et distances de réaction/freinage/arrêt.'],
      ['Le temps de réaction correspond au délai entre perception et action.', ['Vrai', 'Faux'], 0, 'Temps de réaction', 'Le contenu décrit le temps de réaction entre voir, décider et exécuter.'],
      ['La force centrifuge pousse le véhicule...', ['Vers l’extérieur du virage', 'Sous la chaussée', 'Vers le tableau de bord'], 0, 'Force centrifuge', 'Le cours indique qu’elle pousse vers l’extérieur du virage.']
    ],
    7: [
      ['Le permis B concerne les véhicules légers.', ['Vrai', 'Faux'], 0, 'Permis B', 'Le cours présente B comme la catégorie des véhicules légers.'],
      ['Le permis de conduire est une autorisation administrative.', ['Vrai', 'Faux'], 0, 'Permis de conduire', 'C’est la définition donnée dans la leçon.'],
      ['Le permis à points sanctionne...', ['Les mauvais comportements', 'Les révisions', 'Les appels téléphoniques hors conduite'], 0, 'Permis à points', 'Le cours lie retrait de points et infractions.']
    ],
    8: [
      ['Une infraction est le non-respect des règles du code de la route.', ['Vrai', 'Faux'], 0, 'Infraction', 'La leçon définit l’infraction de cette manière.'],
      ['Les contraventions sont présentées comme des infractions...', ['Légères', 'Inexistantes', 'Administratives scolaires'], 0, 'Contraventions', 'Le cours classe les contraventions parmi les infractions légères.'],
      ['Les sanctions citées incluent les amendes.', ['Vrai', 'Faux'], 0, 'Sanctions', 'Les amendes font partie des sanctions listées.']
    ],
    9: [
      ['La sécurité routière vise à prévenir les accidents.', ['Vrai', 'Faux'], 0, 'Sécurité routière', 'Le cours indique que la sécurité routière sert à prévenir les accidents.'],
      ['Les forces de l’ordre font partie des acteurs cités.', ['Vrai', 'Faux'], 0, 'Acteurs', 'Police et gendarmerie sont citées parmi les acteurs.'],
      ['La fatigue est citée comme facteur d’accident.', ['Vrai', 'Faux'], 0, 'Facteurs d’accidents', 'La fatigue et la somnolence sont mentionnées.']
    ]
  };

  return (questionBank[lesson.id] || questionBank[1]).map(([prompt, options, answer, topic, explanation]) => ({
    prompt,
    options,
    answer,
    topic,
    explanation
  }));
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
