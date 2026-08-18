(function () {
  const LESSONS = [
    { id: 1, title: 'La route', description: 'Environnement routier', icon: 'fa-road' },
    { id: 2, title: 'Le conducteur', description: 'Comportement & responsabilité', icon: 'fa-user-shield' },
    { id: 3, title: 'Le véhicule', description: 'État technique & équipements', icon: 'fa-car-side' },
    { id: 4, title: 'Signalisation', description: 'Panneaux, feux, marquage', icon: 'fa-traffic-light' },
    { id: 5, title: 'Règles de circulation', description: 'Priorités, dépassement, arrêt', icon: 'fa-route' },
    { id: 6, title: 'Vitesse & mouvement', description: 'Mécanique, distances', icon: 'fa-gauge-high' },
    { id: 7, title: 'Permis de conduire', description: 'Catégories, permis à points', icon: 'fa-id-card' },
    { id: 8, title: 'Infractions & sanctions', description: 'Loi 2022-04', icon: 'fa-scale-balanced' },
    { id: 9, title: 'Sécurité routière', description: 'Prévention & facteurs', icon: 'fa-shield-halved' }
  ];

  const storageKey = (window.EAUTO_CONFIG && window.EAUTO_CONFIG.lessons && window.EAUTO_CONFIG.lessons.storageKey) || 'eautoecole.lessonProgress';
  let currentLesson = null;

  document.addEventListener('DOMContentLoaded', function () {
    renderLessonList();
    bindReaderActions();
    updateProgressUi();

    const hashLesson = Number((window.location.hash || '').replace('#lesson-', ''));
    if (Number.isFinite(hashLesson) && hashLesson >= 1 && hashLesson <= LESSONS.length) {
      openLesson(hashLesson);
    }
  });

  function getLessonProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey)) || {};
      return {
        completed: Array.isArray(saved.completed) ? saved.completed.map(Number).filter(Number.isFinite) : [],
        lastLesson: Number.isFinite(Number(saved.lastLesson)) ? Number(saved.lastLesson) : null
      };
    } catch (e) {
      return { completed: [], lastLesson: null };
    }
  }

  function saveLessonProgress(progress) {
    localStorage.setItem(storageKey, JSON.stringify(progress));
    updateProgressUi();
  }

  function markLessonCompleted(lessonNumber) {
    const progress = getLessonProgress();
    if (!progress.completed.includes(lessonNumber)) {
      progress.completed.push(lessonNumber);
    }
    progress.lastLesson = lessonNumber;
    saveLessonProgress(progress);
    postProgress('lesson-completed', lessonNumber);
  }

  function getLastLesson() {
    return getLessonProgress().lastLesson;
  }

  function setLastLesson(lessonNumber) {
    const progress = getLessonProgress();
    progress.lastLesson = lessonNumber;
    saveLessonProgress(progress);
    postProgress('lesson-viewed', lessonNumber);
  }

  function renderLessonList() {
    const list = document.getElementById('lessonList');
    if (!list) {
      return;
    }

    list.innerHTML = LESSONS.map((lesson) => {
      return `
        <button class="lesson-card" type="button" data-lesson="${lesson.id}">
          <span class="lesson-number">${String(lesson.id).padStart(2, '0')}</span>
          <span>
            <h2><i class="fas ${lesson.icon}" aria-hidden="true"></i> ${lesson.title}</h2>
            <p>${lesson.description}</p>
          </span>
          <span class="lesson-state">À commencer</span>
        </button>
      `;
    }).join('');

    list.querySelectorAll('[data-lesson]').forEach((button) => {
      button.addEventListener('click', function () {
        openLesson(Number(this.dataset.lesson));
      });
    });
  }

  function openLesson(lessonNumber) {
    const lesson = LESSONS.find((item) => item.id === lessonNumber);
    const content = document.getElementById(`lecon${lessonNumber}`);
    if (!lesson || !content) {
      return;
    }

    currentLesson = lessonNumber;
    document.getElementById('lessonsHome').classList.add('is-hidden');
    document.getElementById('lessonReader').classList.add('active');
    document.querySelectorAll('.lesson-content').forEach((section) => section.classList.remove('active'));
    content.classList.add('active');
    document.getElementById('readerKicker').textContent = `Leçon ${lessonNumber} / ${LESSONS.length}`;
    document.getElementById('readerTitle').textContent = lesson.title;
    document.getElementById('readerProgressBar').style.width = `${Math.round((lessonNumber / LESSONS.length) * 100)}%`;
    document.getElementById('prevLesson').disabled = lessonNumber === 1;
    document.getElementById('nextLesson').disabled = lessonNumber === LESSONS.length;
    setLastLesson(lessonNumber);
    window.location.hash = `lesson-${lessonNumber}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeLesson() {
    currentLesson = null;
    document.getElementById('lessonsHome').classList.remove('is-hidden');
    document.getElementById('lessonReader').classList.remove('active');
    document.querySelectorAll('.lesson-content').forEach((section) => section.classList.remove('active'));
    history.replaceState(null, '', window.location.pathname);
    updateProgressUi();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindReaderActions() {
    document.getElementById('backToLessons').addEventListener('click', closeLesson);
    document.getElementById('prevLesson').addEventListener('click', function () {
      if (currentLesson > 1) {
        openLesson(currentLesson - 1);
      }
    });
    document.getElementById('nextLesson').addEventListener('click', function () {
      if (currentLesson < LESSONS.length) {
        openLesson(currentLesson + 1);
      }
    });
    document.getElementById('completeLesson').addEventListener('click', function () {
      if (currentLesson) {
        markLessonCompleted(currentLesson);
      }
    });
  }

  function updateProgressUi() {
    const progress = getLessonProgress();
    const completedCount = progress.completed.length;
    const percent = Math.round((completedCount / LESSONS.length) * 100);

    document.querySelectorAll('[data-lesson-completed]').forEach((element) => {
      element.textContent = completedCount;
    });
    document.querySelectorAll('[data-lesson-progress-bar]').forEach((element) => {
      element.style.width = `${percent}%`;
    });
    document.querySelectorAll('[data-lesson-percent]').forEach((element) => {
      element.textContent = `${percent} % terminé`;
    });

    document.querySelectorAll('.lesson-card').forEach((card) => {
      const lessonNumber = Number(card.dataset.lesson);
      const state = card.querySelector('.lesson-state');
      card.classList.toggle('is-completed', progress.completed.includes(lessonNumber));
      card.classList.toggle('is-current', progress.lastLesson === lessonNumber && !progress.completed.includes(lessonNumber));
      if (state) {
        state.textContent = progress.completed.includes(lessonNumber)
          ? 'Terminé'
          : progress.lastLesson === lessonNumber ? 'En cours' : 'À commencer';
      }
    });
  }

  function postProgress(type, lesson) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'eautoecole-lessons', type, lesson }, '*');
    }
  }

  window.getLessonProgress = getLessonProgress;
  window.markLessonCompleted = markLessonCompleted;
  window.getLastLesson = getLastLesson;
  window.setLastLesson = setLastLesson;
})();
