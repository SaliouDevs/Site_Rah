const routes = [];
let fallbackRoute = null;

export function registerRoute(pattern, handler) {
  routes.push({ pattern, handler });
}

export function setFallbackRoute(handler) {
  fallbackRoute = handler;
}

export function navigateTo(path) {
  const normalizedPath = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === normalizedPath) {
    renderCurrentRoute();
    return;
  }
  window.location.hash = normalizedPath;
}

export function getCurrentPath() {
  return (window.location.hash.replace(/^#/, '') || '/home').split('?')[0];
}

export function startRouter() {
  window.addEventListener('hashchange', renderCurrentRoute);
  if (!window.location.hash) {
    window.location.hash = '#/home';
    return;
  }
  renderCurrentRoute();
}

export function renderCurrentRoute() {
  const path = getCurrentPath();
  for (const route of routes) {
    const match = matchRoute(route.pattern, path);
    if (match) {
      route.handler(match.params);
      return;
    }
  }
  if (fallbackRoute) {
    fallbackRoute(path);
  }
}

function matchRoute(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  return { params };
}
