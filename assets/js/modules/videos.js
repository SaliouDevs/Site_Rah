import { VIDEOS_DATA } from '../data/videos-data.js';
import { navigateTo } from '../router.js';

export function renderVideosView(container, params = {}) {
  if (params.videoId) {
    renderVideoPlayer(container, params.videoId);
    return;
  }

  const videos = flattenVideos();
  container.innerHTML = `
    <section class="view-stack">
      <div class="view-heading">
        <p class="eyebrow">Ressources</p>
        <h1>Vidéos</h1>
        <p>Tutoriels de conduite et explications en wolof, classés par thème.</p>
      </div>
      <div class="video-grid">
        ${videos.map((video) => `
          <article class="video-learning-card">
            <img src="${getYouTubeThumbnail(video.youtubeId)}" alt="${video.title} ${video.part}" loading="lazy">
            <div>
              <span>${video.part}</span>
              <h2>${video.title}</h2>
              <p>${video.description}</p>
              <button class="primary-action" type="button" data-open-video="${video.youtubeId}">Regarder</button>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;

  container.querySelectorAll('[data-open-video]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(`/videos/${button.dataset.openVideo}`));
  });
}

function renderVideoPlayer(container, videoId) {
  const video = flattenVideos().find((item) => item.youtubeId === videoId);
  if (!video) {
    navigateTo('/videos');
    return;
  }

  container.innerHTML = `
    <section class="video-player-view immersive-view">
      <button class="text-back" type="button" data-back-videos>← Toutes les vidéos</button>
      <div class="video-player-shell">
        <div class="youtube-frame">
          <iframe src="https://www.youtube.com/embed/${video.youtubeId}" title="${video.title} ${video.part}" allowfullscreen loading="lazy"></iframe>
        </div>
        <div class="video-player-copy">
          <p class="eyebrow">${video.category}</p>
          <h1>${video.title} · ${video.part}</h1>
          <p>${video.description}</p>
        </div>
      </div>
    </section>
  `;

  container.querySelector('[data-back-videos]').addEventListener('click', () => navigateTo('/videos'));
}

function flattenVideos() {
  return VIDEOS_DATA.flatMap((theme) => theme.videos.map((video) => ({
    ...video,
    title: theme.title,
    category: theme.title,
    themeDescription: theme.description
  })));
}

function getYouTubeThumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function getVideosCount() {
  return flattenVideos().length;
}
