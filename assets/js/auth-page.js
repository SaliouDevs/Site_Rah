import { registerStudent, resolveAuthMessage, signInWithIdentifier } from './services/auth-service.js';

const state = {
  activeTab: 'login'
};

document.addEventListener('DOMContentLoaded', initAuthPage);

async function initAuthPage() {
  bindTabs();
  bindPasswordToggles();
  bindPhoneFormatters();
  document.querySelector('[data-login-form]').addEventListener('submit', handleLogin);
  document.querySelector('[data-register-form]').addEventListener('submit', handleRegister);
  document.querySelector('[data-forgot]').addEventListener('click', showForgot);
  document.querySelector('[data-show-register]').addEventListener('click', () => switchTab('register'));
  document.querySelector('[data-show-login]').addEventListener('click', () => switchTab('login'));

  const message = resolveAuthMessage();
  if (message) showAlert(message.text, message.type);
}

function bindTabs() {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.authTab));
  });
}

function switchTab(tab) {
  state.activeTab = tab;
  clearFeedback();
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authTab === tab);
  });
  document.querySelectorAll('[data-auth-form]').forEach((form) => {
    form.classList.toggle('active', form.dataset.authForm === tab);
  });
}

function bindPasswordToggles() {
  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.togglePassword);
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? 'Afficher' : 'Masquer';
    });
  });
}

function bindPhoneFormatters() {
  document.querySelectorAll('input[data-phone]').forEach((input) => {
    input.addEventListener('input', () => {
      let value = input.value.replace(/\D/g, '').slice(0, 9);
      if (value.length > 7) value = `${value.slice(0, 2)} ${value.slice(2, 5)} ${value.slice(5, 7)} ${value.slice(7)}`;
      else if (value.length > 5) value = `${value.slice(0, 2)} ${value.slice(2, 5)} ${value.slice(5)}`;
      else if (value.length > 2) value = `${value.slice(0, 2)} ${value.slice(2)}`;
      input.value = value;
    });
  });
}

async function handleLogin(event) {
  event.preventDefault();
  clearFeedback();
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!identifier) return setFieldError('loginIdentifierError', 'Identifiant requis.');
  if (!password) return setFieldError('loginPasswordError', 'Mot de passe requis.');

  setBusy('[data-login-submit]', true, 'Connexion...');
  try {
    const result = await signInWithIdentifier(identifier, password);
    if (result.isAdmin) {
      window.location.href = 'admin.html';
      return;
    }
    if (result.profile?.status === 'pending') {
      await window.sbLogout();
      showAlert('Votre inscription est en attente de validation par l’auto-école.', 'warning');
      return;
    }
    if (result.profile?.status === 'blocked') {
      await window.sbLogout();
      showAlert('Votre compte est actuellement bloqué. Veuillez contacter l’auto-école.', 'error');
      return;
    }
    window.location.href = 'index.html';
  } catch (error) {
    showAlert(normalizeAuthError(error), 'error');
  } finally {
    setBusy('[data-login-submit]', false, 'Se connecter');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  clearFeedback();
  const prenom = document.getElementById('registerName').value.trim();
  const telephone = document.getElementById('registerPhone').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirm = document.getElementById('registerConfirm').value;
  if (!prenom) return setFieldError('registerNameError', 'Prénom requis.');
  if (telephone.replace(/\s/g, '').length !== 9) return setFieldError('registerPhoneError', 'Numéro à 9 chiffres requis.');
  if (password.length < 6) return setFieldError('registerPasswordError', 'Minimum 6 caractères.');
  if (password !== confirm) return setFieldError('registerConfirmError', 'Les mots de passe ne correspondent pas.');

  setBusy('[data-register-submit]', true, 'Création...');
  try {
    await registerStudent({ prenom, telephone, password, formule: 'Formule Illimitée', prix: 2000 });
    sessionStorage.setItem('pending_phone', telephone);
    sessionStorage.setItem('pending_formule', 'Formule Illimitée');
    sessionStorage.setItem('pending_prix', '2000');
    window.location.href = 'payment.html';
  } catch (error) {
    showAlert(normalizeAuthError(error), 'error');
  } finally {
    setBusy('[data-register-submit]', false, 'Créer mon compte');
  }
}

function showForgot() {
  showAlert(`Mot de passe oublié ? Contactez l’auto-école au ${window.CONTACT_CONFIG.phone} pour réinitialiser votre accès.`, 'info');
}

function clearFeedback() {
  document.querySelectorAll('.field-error').forEach((item) => item.textContent = '');
  const alert = document.querySelector('[data-auth-alert]');
  alert.className = 'auth-alert';
  alert.textContent = '';
}

function setFieldError(id, text) {
  document.getElementById(id).textContent = text;
}

function showAlert(text, type = 'error') {
  const alert = document.querySelector('[data-auth-alert]');
  alert.className = `auth-alert visible ${type}`;
  alert.textContent = text;
}

function setBusy(selector, busy, label) {
  const button = document.querySelector(selector);
  button.disabled = busy;
  button.textContent = label;
}

function normalizeAuthError(error) {
  const message = error?.message || 'Erreur de connexion.';
  if (message.includes('Invalid login')) return 'Numéro ou mot de passe incorrect.';
  if (message.includes('already registered')) return 'Ce numéro est déjà inscrit. Connectez-vous.';
  if (message.includes('Failed to fetch')) return 'Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.';
  return message;
}
