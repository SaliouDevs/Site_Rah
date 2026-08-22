import { loadSchoolSettings } from './services/school-service.js';

try {
  await loadSchoolSettings();
} catch (error) {
  console.warn('Branding dynamique indisponible', error);
}
