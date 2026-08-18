        // ===== VARIABLES GLOBALES =====
        let pendingRegistration = false;
        let countdownTimer;
        let countdownSeconds = 1;
        let currentUser = null;
        let selectedTarif = null;
        let selectedPrix = 0;
        let selectedFormule = 'Formule Illimitée';

        const EXAMS_CONFIG = (window.EAUTO_CONFIG && window.EAUTO_CONFIG.exams) || {
            poidsLegerEnabled: false,
            poidsLourdEnabled: false
        };

        const EXAM_SECTION_CONFIG = {
            'examen-pl': 'poidsLegerEnabled',
            'examen-pld': 'poidsLourdEnabled'
        };

        // ===== DEVELOPMENT MODE =====
        const DEV_CONFIG = {
            enabled: true,
            autoLogin: true,
            role: 'student', // 'student', 'admin' ou 'normal'
            skipWelcome: true
        };

        const DEV_STUDENT = {
            prenom: 'Test',
            telephone: '770000000',
            password: 'dev1234',
            dateInscription: new Date().toISOString(),
            formule: 'Formule Illimitée',
            prix: 2000,
            status: 'active',
            isDevUser: true
        };

        const DEV_ADMIN = {
            prenom: 'Administrateur DEV',
            telephone: '760000000',
            password: 'devadmin',
            dateInscription: new Date().toISOString(),
            status: 'active',
            isAdmin: true,
            isDevUser: true
        };

        const DEV_ALLOWED_ROLES = ['student', 'admin', 'normal'];
        const DEV_AUTO_LOGIN_DISABLED_KEY = 'devAutoLoginDisabled';

        // ===== DEMO MODE PUBLIC =====
        const DEMO_CONFIG = {
            enabled: true,
            autoLoginStudent: true
        };

        const DEMO_STUDENT = {
            prenom: 'Visiteur',
            telephone: '770000000',
            password: '',
            dateInscription: new Date().toISOString(),
            formule: 'Formule Illimitée',
            prix: 2000,
            status: 'active',
            isDemoUser: true
        };

        // TODO PROD: remplacer l'authentification localStorage par une authentification backend sécurisée.

        // Compte admin
        const ADMIN_PHONE = '762572877';
        const ADMIN_PASSWORD = 'AA00ARD';

        // ===== CHARGEMENT DE LA SESSION AU DÉMARRAGE =====
        document.addEventListener('DOMContentLoaded', function() {
            initializeApp();
        });

        function initializeApp() {
            initializeCommonFeatures();
            
            if (!localStorage.getItem('users')) {
                localStorage.setItem('users', JSON.stringify([]));
            }

            if (initializeDevMode()) {
                return;
            }

            if (initializeDemoMode()) {
                return;
            }

            const savedUser = localStorage.getItem('currentUser');
            if (savedUser) {
                try {
                    currentUser = JSON.parse(savedUser);
                    
                    if (currentUser.telephone === ADMIN_PHONE && currentUser.password === ADMIN_PASSWORD) {
                        accederEspaceAdmin(currentUser, false);
                    } else {
                        const users = JSON.parse(localStorage.getItem('users')) || [];
                        const userExists = users.find(u => u.telephone === currentUser.telephone && u.status === 'active');
                        
                        if (userExists) {
                            accederEspaceEleve(currentUser, false);
                        } else {
                            localStorage.removeItem('currentUser');
                            currentUser = null;
                        }
                    }
                } catch (e) {
                    localStorage.removeItem('currentUser');
                }
            }

            setupLessonDashboard();
            startCountdown();
            checkConnection();
        }

        function initializeCommonFeatures() {
            const phoneInputs = document.querySelectorAll('input[type="tel"]');
            phoneInputs.forEach(phoneInput => {
                phoneInput.addEventListener('input', function(e) {
                    let value = e.target.value.replace(/\D/g, '');
                    
                    if (value.length > 9) {
                        value = value.slice(0, 9);
                    }
                    
                    if (value.length > 0) {
                        let formattedValue = '';
                        
                        if (value.length <= 2) {
                            formattedValue = value;
                        } else if (value.length <= 5) {
                            formattedValue = value.slice(0, 2) + ' ' + value.slice(2);
                        } else if (value.length <= 7) {
                            formattedValue = value.slice(0, 2) + ' ' + value.slice(2, 5) + ' ' + value.slice(5);
                        } else {
                            formattedValue = value.slice(0, 2) + ' ' + value.slice(2, 5) + ' ' + value.slice(5, 7) + ' ' + value.slice(7);
                        }
                        
                        e.target.value = formattedValue;
                    }
                });
            });
            
            const pendingPhone = localStorage.getItem('pendingPhone');
            if (pendingPhone) {
                pendingRegistration = true;
            }
            
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'dark') {
                document.body.classList.add('dark-mode');
                document.documentElement.setAttribute('data-theme', 'dark');
            }
            
            window.addEventListener('online', function() {
                document.getElementById('connectionAlert').style.display = 'none';
                showNotification('✅ Connexion rétablie !');
            });

            window.addEventListener('offline', function() {
                document.getElementById('connectionAlert').style.display = 'block';
            });

            window.addEventListener('beforeunload', function() {
                sessionStorage.removeItem(DEV_AUTO_LOGIN_DISABLED_KEY);
            });
        }

        function getDevRoleFromUrl() {
            if (!isLocalDevelopmentHost()) {
                return null;
            }

            const params = new URLSearchParams(window.location.search);
            const devRole = params.get('dev');
            return DEV_ALLOWED_ROLES.includes(devRole) ? devRole : null;
        }

        function getActiveDevRole() {
            const urlRole = getDevRoleFromUrl();
            if (urlRole) {
                return urlRole;
            }

            if (!DEV_CONFIG.enabled || !DEV_CONFIG.autoLogin) {
                return 'normal';
            }

            return DEV_ALLOWED_ROLES.includes(DEV_CONFIG.role) ? DEV_CONFIG.role : 'normal';
        }

        function initializeDevMode() {
            if (!isLocalDevelopmentHost()) {
                hideDevModeBadge();
                return false;
            }

            const urlRole = getDevRoleFromUrl();
            const activeRole = getActiveDevRole();
            const autoLoginDisabled = sessionStorage.getItem(DEV_AUTO_LOGIN_DISABLED_KEY) === 'true';

            if (activeRole === 'normal') {
                hideDevModeBadge();
                return false;
            }

            if (!urlRole && autoLoginDisabled) {
                hideDevModeBadge();
                return false;
            }

            sessionStorage.removeItem(DEV_AUTO_LOGIN_DISABLED_KEY);

            if (DEV_CONFIG.skipWelcome) {
                skipWelcome();
            }

            console.log('[DEV] Mode développement activé');
            showDevModeBadge(activeRole);

            if (activeRole === 'student') {
                console.log('[DEV] Connexion automatique élève');
                accederEspaceEleve({ ...DEV_STUDENT, dateInscription: new Date().toISOString() }, false);
                showSection('accueil');
                checkConnection();
                return true;
            }

            if (activeRole === 'admin') {
                console.log('[DEV] Connexion automatique admin');
                accederEspaceAdmin({ ...DEV_ADMIN, dateInscription: new Date().toISOString() }, false);
                checkConnection();
                return true;
            }

            return false;
        }

        function isLocalDevelopmentHost() {
            const hostname = window.location.hostname;
            return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '';
        }

        function initializeDemoMode() {
            if (isLocalDevelopmentHost() || !DEMO_CONFIG.enabled || !DEMO_CONFIG.autoLoginStudent) {
                hideDemoModeBadge();
                return false;
            }

            skipWelcome();
            console.log('[DEMO] Connexion automatique élève');
            showDemoModeBadge();
            accederEspaceEleve({ ...DEMO_STUDENT, dateInscription: new Date().toISOString() }, false);
            showSection('accueil');
            checkConnection();
            return true;
        }

        function showDevModeBadge(role) {
            let badge = document.getElementById('devModeBadge');

            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'devModeBadge';
                badge.style.cssText = `
                    position: fixed;
                    top: 10px;
                    left: 10px;
                    z-index: 2000;
                    padding: 6px 10px;
                    border-radius: 6px;
                    background: rgba(20, 20, 20, 0.82);
                    color: #fff;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
                    pointer-events: none;
                `;
                document.body.appendChild(badge);
            }

            badge.textContent = `DEV MODE - ${role.toUpperCase()}`;
            badge.style.display = 'block';
        }

        function hideDevModeBadge() {
            const badge = document.getElementById('devModeBadge');
            if (badge) {
                badge.style.display = 'none';
            }
        }

        function showDemoModeBadge() {
            let badge = document.getElementById('demoModeBadge');

            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'demoModeBadge';
                badge.style.cssText = `
                    position: fixed;
                    top: 10px;
                    left: 10px;
                    z-index: 2000;
                    padding: 6px 10px;
                    border-radius: 6px;
                    background: rgba(0, 82, 255, 0.86);
                    color: #fff;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
                    pointer-events: none;
                `;
                document.body.appendChild(badge);
            }

            badge.textContent = 'MODE DEMO';
            badge.style.display = 'block';
        }

        function hideDemoModeBadge() {
            const badge = document.getElementById('demoModeBadge');
            if (badge) {
                badge.style.display = 'none';
            }
        }

        function isTemporaryAuthUser(user) {
            return !!(user && (user.isDevUser || user.isDemoUser));
        }

        // ===== GESTION DES TARIFS =====
        
        function selectTarif(tarif, prix) {
            document.querySelectorAll('.tarif-card').forEach(card => {
                card.classList.remove('selected');
            });
            
            const card = document.querySelector(`.tarif-card[data-tarif="${tarif}"]`);
            card.classList.add('selected');
            
            selectedTarif = tarif;
            selectedPrix = prix;
            
            document.getElementById('paymentSection').style.display = 'block';
            document.getElementById('paymentAmount').textContent = prix + ' FCFA';
            
            localStorage.setItem('selectedPrix', prix);
            localStorage.setItem('selectedFormule', selectedFormule);
        }
        
        function effectuerPaiement() {
            if (!selectedTarif) {
                showNotification('⚠️ Veuillez sélectionner une formule d\'étude');
                return;
            }
            
            const prix = selectedPrix;
            
            const waveLink = `https://pay.wave.com/m/M_sn_h8KvN46A4_zB/c/sn/?amount=${prix}&description=${encodeURIComponent('eAutoecole - ' + selectedFormule)}`;
            window.open(waveLink, '_blank');
            
            showNotification('✅ Redirection vers Wave en cours... Paiement de ' + prix + ' FCFA');
            
            setTimeout(() => {
                showNotification('✅ Paiement effectué avec succès ! Vous pouvez maintenant valider votre inscription.');
            }, 3000);
        }

        function validerSurWave() {
            const prix = selectedPrix || localStorage.getItem('selectedPrix') || 2000;
            
            if (prix <= 0) {
                showNotification('⚠️ Veuillez d\'abord sélectionner une formule');
                return;
            }
            
            const waveLink = `https://pay.wave.com/m/M_sn_h8KvN46A4_zB/c/sn/?amount=${prix}&description=${encodeURIComponent('eAutoecole - ' + selectedFormule)}`;
            const waveWindow = window.open(waveLink, '_blank');
            
            showNotification('✅ Redirection vers Wave en cours...');
            
            const phone = document.getElementById('confirmation-login-phone').textContent;
            const password = document.getElementById('confirmation-login-password').textContent;
            
            // STOCKER POUR LE PRÉ-REMPLISSAGE
            localStorage.setItem('pendingLoginPhone', phone);
            localStorage.setItem('pendingLoginPassword', password);
            
            const checkReturn = setInterval(() => {
                if (waveWindow && waveWindow.closed) {
                    clearInterval(checkReturn);
                    
                    setTimeout(() => {
                        showNotification('✅ Paiement effectué avec succès ! Votre compte est en attente de validation.');
                        
                        setTimeout(() => {
                            showConnexion();
                        }, 1000);
                    }, 500);
                }
            }, 1000);
        }

        // ===== GESTION DE LA PHOTO DE PROFIL =====
        function triggerPhotoUpload() {
            document.getElementById('photoUpload').click();
        }

        function handlePhotoUpload(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const photoData = e.target.result;
                    
                    const photoElement = document.getElementById('profilePhoto');
                    const avatarElement = document.getElementById('userAvatar');
                    
                    photoElement.src = photoData;
                    photoElement.style.display = 'block';
                    avatarElement.style.display = 'none';
                    
                    if (currentUser) {
                        currentUser.photo = photoData;
                        if (!isTemporaryAuthUser(currentUser)) {
                            localStorage.setItem('currentUser', JSON.stringify(currentUser));
                        }
                        
                        const users = JSON.parse(localStorage.getItem('users')) || [];
                        const userIndex = users.findIndex(u => u.telephone === currentUser.telephone);
                        if (userIndex !== -1) {
                            users[userIndex].photo = photoData;
                            localStorage.setItem('users', JSON.stringify(users));
                        }
                    }
                };
                reader.readAsDataURL(file);
            }
        }

        // ===== GESTION DU NOM D'UTILISATEUR =====
        function toggleEditName() {
            const editInput = document.getElementById('editNameInput');
            editInput.classList.toggle('active');
            if (editInput.classList.contains('active')) {
                document.getElementById('editNameField').value = currentUser ? (currentUser.prenom || 'Élève') : '';
            }
        }

        function updateUserName() {
            const newName = document.getElementById('editNameField').value.trim();
            if (newName && currentUser) {
                currentUser.prenom = newName;
                
                setTextIfExists('userNameDisplay', newName);
                setTextIfExists('welcomeNameSpan', newName);
                setTextIfExists('userAvatar', newName.charAt(0));
                setTextIfExists('profileAvatarLarge', newName.charAt(0));
                setTextIfExists('profil-nom-complet', newName);
                
                if (!isTemporaryAuthUser(currentUser)) {
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                }
                
                const users = JSON.parse(localStorage.getItem('users')) || [];
                const userIndex = users.findIndex(u => u.telephone === currentUser.telephone);
                if (userIndex !== -1) {
                    users[userIndex].prenom = newName;
                    localStorage.setItem('users', JSON.stringify(users));
                }
                
                showNotification('✅ Prénom mis à jour avec succès !');
            }
            toggleEditName();
        }

        // ===== PAGE DE BIENVENUE =====
        
        function startCountdown() {
            if (sessionStorage.getItem('welcomeSeen') === 'true') {
                skipWelcome();
                return;
            }

            countdownTimer = setTimeout(() => {
                sessionStorage.setItem('welcomeSeen', 'true');
                skipWelcome();
            }, 900);
        }

        function skipWelcome() {
            clearTimeout(countdownTimer);
            const welcomePage = document.getElementById('welcomePage');
            if (welcomePage) {
                welcomePage.style.display = 'none';
            }
        }
        
        // ===== FONCTIONS NAVIGATION =====
        
        function showConnexion() {
            document.getElementById('inscriptionSection').classList.remove('active');
            document.getElementById('connexionSection').classList.add('active');
            document.getElementById('espaceEleveSection').classList.remove('active');
            document.getElementById('espaceAdminSection').classList.remove('active');
            document.getElementById('aboutPage').classList.remove('active');
            
            const warningMsg = document.getElementById('warningMessage');
            if (warningMsg) {
                warningMsg.remove();
            }
            
            resetForms();
            
            // PRÉ-REMPLIR LES CHAMPS DE CONNEXION
            const pendingPhone = localStorage.getItem('pendingLoginPhone');
            const pendingPassword = localStorage.getItem('pendingLoginPassword');
            
            if (pendingPhone && pendingPassword) {
                setTimeout(function() {
                    const phoneInput = document.getElementById('login-telephone');
                    const passwordInput = document.getElementById('login-password');
                    
                    if (phoneInput && passwordInput) {
                        phoneInput.value = pendingPhone;
                        passwordInput.value = pendingPassword;
                        
                        document.querySelector('.connexion-btn').focus();
                    }
                }, 200);
            }
        }
        
        function showInscription() {
            const phone = localStorage.getItem('pendingPhone');
            if (phone) {
                showWarningMessage("Vous ne pouvez pas créer un compte. Votre compte est en attente de validation par l'administrateur.");
                
                document.getElementById('login-telephone').value = formatPhoneNumber(phone);
                document.getElementById('login-password').focus();
                return;
            }
            
            document.getElementById('connexionSection').classList.remove('active');
            document.getElementById('inscriptionSection').classList.add('active');
            document.getElementById('espaceEleveSection').classList.remove('active');
            document.getElementById('espaceAdminSection').classList.remove('active');
            document.getElementById('aboutPage').classList.remove('active');
            resetForms();
        }
        
        function showEspaceEleve() {
            document.getElementById('connexionSection').classList.remove('active');
            document.getElementById('inscriptionSection').classList.remove('active');
            document.getElementById('espaceEleveSection').classList.add('active');
            document.getElementById('espaceAdminSection').classList.remove('active');
            document.getElementById('aboutPage').classList.remove('active');
        }

        function showEspaceAdmin() {
            document.getElementById('connexionSection').classList.remove('active');
            document.getElementById('inscriptionSection').classList.remove('active');
            document.getElementById('espaceEleveSection').classList.remove('active');
            document.getElementById('espaceAdminSection').classList.add('active');
            document.getElementById('aboutPage').classList.remove('active');
            
            refreshAdminLists();
        }
        
        function closeAboutPage() {
            document.getElementById('aboutPage').classList.remove('active');
        }
        
        function showWarningMessage(message) {
            const existingWarning = document.getElementById('warningMessage');
            if (existingWarning) {
                existingWarning.remove();
            }
            
            const warningDiv = document.createElement('div');
            warningDiv.id = 'warningMessage';
            warningDiv.className = 'warning-message';
            warningDiv.innerHTML = `
                <div class="warning-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <div>${message}</div>
            `;
            
            const formTitle = document.querySelector('#form0 .form-title');
            formTitle.parentNode.insertBefore(warningDiv, formTitle.nextSibling);
        }
        
        function formatPhoneNumber(phone) {
            const cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone.length === 9) {
                return cleanPhone.substring(0, 2) + ' ' + cleanPhone.substring(2, 5) + ' ' + cleanPhone.substring(5, 7) + ' ' + cleanPhone.substring(7);
            }
            return phone;
        }
        
        function resetForms() {
            document.getElementById('form2').classList.remove('form-active');
            document.getElementById('form1').classList.add('form-active');
            
            const inscriptionInputs = document.querySelectorAll('#form1 input');
            inscriptionInputs.forEach(input => {
                input.value = '';
                input.parentElement.classList.remove('valid');
            });
            
            const inscriptionErrors = document.querySelectorAll('#form1 .error-message');
            inscriptionErrors.forEach(error => {
                error.style.display = 'none';
                error.textContent = '';
            });
            
            document.getElementById('login-telephone').value = '';
            document.getElementById('login-password').value = '';
            document.getElementById('login-password-error').style.display = 'none';
            
            document.querySelectorAll('.tarif-card').forEach(card => {
                card.classList.remove('selected');
            });
            document.getElementById('paymentSection').style.display = 'none';
            selectedTarif = null;
            selectedPrix = 0;
        }
        
        function validatePhoneNumber(phone) {
            const cleanPhone = phone.replace(/\s/g, '');
            
            if (cleanPhone.length !== 9) {
                return false;
            }
            
            const prefix = cleanPhone.substring(0, 2);
            const allowedPrefixes = ['71', '70', '76', '77', '78', '75'];
            
            return allowedPrefixes.includes(prefix);
        }
        
        function validatePassword(password) {
            return password.length >= 4;
        }
        
        function validateInscription() {
            let isValid = true;
            
            const telephone = document.getElementById('telephone').value.trim();
            const password = document.getElementById('password').value;
            
            if (telephone === '') {
                showError('telephone-error', 'Veuillez entrer votre numéro de téléphone');
                isValid = false;
            } else if (!validatePhoneNumber(telephone.replace('+221', ''))) {
                showError('telephone-error', 'Numéro invalide. Utilisez 71, 70, 76, 77, 78 ou 75');
                isValid = false;
            } else {
                hideError('telephone-error');
            }
            
            if (password === '') {
                showError('password-error', 'Veuillez entrer un mot de passe');
                isValid = false;
            } else if (!validatePassword(password)) {
                showError('password-error', 'Le mot de passe doit contenir au moins 4 caractères');
                isValid = false;
            } else {
                hideError('password-error');
            }
            
            if (!selectedTarif) {
                showNotification('⚠️ Veuillez sélectionner une formule d\'étude');
                isValid = false;
            }
            
            return isValid;
        }
        
        function showError(elementId, message) {
            const errorElement = document.getElementById(elementId);
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
        
        function hideError(elementId) {
            const errorElement = document.getElementById(elementId);
            errorElement.style.display = 'none';
        }
        
        function submitInscription() {
            if (!validateInscription()) {
                return;
            }
            
            const telephone = document.getElementById('telephone').value;
            const password = document.getElementById('password').value;
            
            const formattedPhone = telephone.replace(/\s/g, '');
            
            const users = JSON.parse(localStorage.getItem('users')) || [];
            const existingUser = users.find(user => user.telephone === formattedPhone);
            
            if (existingUser) {
                if (existingUser.status === 'pending') {
                    showWarningMessage("Vous avez déjà une inscription en attente de validation.");
                    showConnexion();
                    document.getElementById('login-telephone').value = telephone;
                    document.getElementById('login-password').focus();
                    return;
                } else if (existingUser.status === 'active') {
                    showWarningMessage("Un compte existe déjà avec ce numéro de téléphone.");
                    showConnexion();
                    document.getElementById('login-telephone').value = telephone;
                    document.getElementById('login-password').focus();
                    return;
                }
            }
            
            const user = {
                prenom: 'Élève',
                telephone: formattedPhone,
                password: password,
                dateInscription: new Date().toISOString(),
                formule: selectedFormule,
                prix: selectedPrix,
                status: 'pending'
            };
            
            users.push(user);
            localStorage.setItem('users', JSON.stringify(users));
            
            localStorage.setItem('pendingPhone', formattedPhone);
            pendingRegistration = true;
            currentUser = user;
            
            document.getElementById('form1').classList.remove('form-active');
            document.getElementById('form2').classList.add('form-active');
            
            document.getElementById('confirmation-telephone').textContent = telephone;
            document.getElementById('confirmation-formule').textContent = selectedFormule;
            document.getElementById('confirmation-montant').textContent = selectedPrix + ' FCFA';
            document.getElementById('confirmation-login-phone').textContent = telephone;
            document.getElementById('confirmation-login-password').textContent = password;
            document.getElementById('confirmation-date').textContent = new Date().toLocaleDateString('fr-FR');
            
            // STOCKER LES IDENTIFIANTS POUR PRÉ-REMPLIR PLUS TARD
            localStorage.setItem('pendingLoginPhone', telephone);
            localStorage.setItem('pendingLoginPassword', password);
            
            showNotification('✅ Votre inscription a été soumise avec succès !');
        }
        
        function accederEspaceEleve(user, saveToStorage = true) {
            currentUser = user;
            
            if (saveToStorage) {
                localStorage.setItem('currentUser', JSON.stringify(user));
            }
            
            const prenom = user.prenom || 'Élève';
            
            setTextIfExists('welcomeNameSpan', prenom);
            const welcomeName = document.getElementById('welcomeName');
            if (welcomeName) {
                welcomeName.innerHTML = `Bonjour, <span id="welcomeNameSpan">${prenom}</span>`;
            }
            
            const avatarElement = document.getElementById('userAvatar');
            const photoElement = document.getElementById('profilePhoto');
            const largeAvatarElement = document.getElementById('profileAvatarLarge');
            
            if (avatarElement) {
                avatarElement.textContent = prenom.charAt(0);
            }
            if (largeAvatarElement) {
                largeAvatarElement.textContent = prenom.charAt(0);
            }
            
            if (user.photo && photoElement && avatarElement) {
                photoElement.src = user.photo;
                photoElement.style.display = 'block';
                avatarElement.style.display = 'none';
            } else if (photoElement && avatarElement) {
                photoElement.style.display = 'none';
                avatarElement.style.display = 'grid';
            }
            
            setTextIfExists('userNameDisplay', prenom);
            const headerUserName = document.getElementById('headerUserName');
            if (headerUserName) {
                headerUserName.innerHTML = `<span id="userNameDisplay">${prenom}</span> <i class="fas fa-pen edit-name-icon" onclick="toggleEditName()"></i>`;
            }

            setTextIfExists('profil-nom-complet', prenom);
            setTextIfExists('profil-telephone-value', user.telephone || '');
            setTextIfExists('profil-date-value', user.dateInscription ? new Date(user.dateInscription).toLocaleDateString('fr-FR') : '');
            setTextIfExists('profil-statut-value', user.status === 'active' ? 'Actif' : 'En attente');
            setTextIfExists('profil-formule-value', user.formule || 'Formule Illimitée');
            
            const statusBadge = document.getElementById('statusBadge');
            if (statusBadge && user.status === 'active') {
                document.getElementById('statusBadge').innerHTML = '✅ Inscription validée';
                document.getElementById('statusBadge').className = 'status-badge';
            } else if (statusBadge && user.status === 'blocked') {
                document.getElementById('statusBadge').innerHTML = '⛔ Compte bloqué';
                document.getElementById('statusBadge').style.background = 'var(--danger-color)';
            } else if (statusBadge) {
                document.getElementById('statusBadge').innerHTML = '⏳ En attente';
                document.getElementById('statusBadge').style.background = 'var(--warning-color)';
            }
            
            showEspaceEleve();
            setupEspaceEleveNavigation();
            updateLessonDashboard();
            
            if (!user.isDemoUser) {
                showNotification('Connecté');
            }
        }

        function accederEspaceAdmin(user, saveToStorage = true) {
            currentUser = user;
            
            if (saveToStorage) {
                localStorage.setItem('currentUser', JSON.stringify(user));
            }
            
            showEspaceAdmin();
            refreshAdminLists();
        }
        
        function login() {
            const phoneInput = document.getElementById('login-telephone');
            const passwordInput = document.getElementById('login-password');
            
            const phone = phoneInput.value.replace(/\s/g, '');
            const password = passwordInput.value;
            
            if (!phone || !password) {
                showError('login-password-error', 'Veuillez remplir tous les champs');
                return;
            }
            
            if (phone === ADMIN_PHONE && password === ADMIN_PASSWORD) {
                const adminUser = {
                    prenom: 'Administrateur',
                    telephone: phone,
                    password: password,
                    dateInscription: new Date().toISOString(),
                    status: 'active',
                    isAdmin: true
                };
                
                accederEspaceAdmin(adminUser);
                
                phoneInput.value = '';
                passwordInput.value = '';
                hideError('login-password-error');
                
                // NETTOYER LES IDENTIFIANTS TEMPORAIRES
                localStorage.removeItem('pendingLoginPhone');
                localStorage.removeItem('pendingLoginPassword');
                return;
            }
            
            const users = JSON.parse(localStorage.getItem('users')) || [];
            const user = users.find(u => u.telephone === phone && u.password === password);
            
            if (!user) {
                showError('login-password-error', 'Numéro de téléphone ou mot de passe incorrect');
                return;
            }
            
            if (user.status === 'pending') {
                showWarningMessage("Votre compte est encore en attente de validation par l'administrateur.");
                return;
            }
            
            if (user.status === 'blocked') {
                showWarningMessage("Votre compte a été bloqué. Veuillez contacter l'administrateur.");
                return;
            }
            
            accederEspaceEleve(user);
            
            phoneInput.value = '';
            passwordInput.value = '';
            hideError('login-password-error');
            
            // NETTOYER LES IDENTIFIANTS TEMPORAIRES
            localStorage.removeItem('pendingLoginPhone');
            localStorage.removeItem('pendingLoginPassword');
        }

        // ===== FONCTIONS ADMIN =====
        
        function showAdminTab(tab) {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            
            document.querySelector(`.admin-tab[onclick="showAdminTab('${tab}')"]`).classList.add('active');
            document.getElementById(`admin-${tab}`).classList.add('active');
            
            refreshAdminLists();
        }

        function togglePasswordVisibilityAdmin(elementId, button) {
            const element = document.getElementById(elementId);
            const icon = button.querySelector('i');
            
            if (element.style.filter === 'blur(4px)') {
                element.style.filter = 'none';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            } else {
                element.style.filter = 'blur(4px)';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            }
        }

        function refreshAdminLists() {
            const users = JSON.parse(localStorage.getItem('users')) || [];
            
            // Liste des inscriptions en attente
            const pendingUsers = users.filter(u => u.status === 'pending');
            const pendingList = document.getElementById('pendingList');
            pendingList.innerHTML = '';
            
            pendingUsers.forEach((user, index) => {
                const passwordId = `pass-pending-${index}`;
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${user.telephone}</td>
                    <td>
                        <div class="password-container">
                            <span class="password-text" id="${passwordId}">${user.password}</span>
                            <button class="toggle-password-admin" onclick="togglePasswordVisibilityAdmin('${passwordId}', this)">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </td>
                    <td>${new Date(user.dateInscription).toLocaleDateString('fr-FR')}</td>
                    <td>${user.formule || 'Formule Illimitée'}</td>
                    <td>${user.prix || 2000} FCFA</td>
                    <td>
                        <button class="action-btn accept" onclick="acceptUser('${user.telephone}')">Accepter</button>
                        <button class="action-btn block" onclick="blockUser('${user.telephone}')">Bloquer</button>
                        <button class="action-btn delete" onclick="deleteUser('${user.telephone}')">Supprimer</button>
                    </td>
                `;
                pendingList.appendChild(row);
            });
            
            if (pendingUsers.length === 0) {
                pendingList.innerHTML = '<tr><td colspan="6" style="text-align: center;">Aucune inscription en attente</td></tr>';
            }
            
            // Liste des utilisateurs actifs
            const activeUsers = users.filter(u => u.status === 'active');
            const activeList = document.getElementById('activeList');
            activeList.innerHTML = '';
            
            activeUsers.forEach((user, index) => {
                const passwordId = `pass-active-${index}`;
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${user.telephone}</td>
                    <td>
                        <div class="password-container">
                            <span class="password-text" id="${passwordId}">${user.password}</span>
                            <button class="toggle-password-admin" onclick="togglePasswordVisibilityAdmin('${passwordId}', this)">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </td>
                    <td>${new Date(user.dateInscription).toLocaleDateString('fr-FR')}</td>
                    <td>${user.formule || 'Formule Illimitée'}</td>
                    <td>
                        <button class="action-btn block" onclick="blockUser('${user.telephone}')">Bloquer</button>
                        <button class="action-btn delete" onclick="deleteUser('${user.telephone}')">Supprimer</button>
                    </td>
                `;
                activeList.appendChild(row);
            });
            
            if (activeUsers.length === 0) {
                activeList.innerHTML = '<tr><td colspan="5" style="text-align: center;">Aucun utilisateur actif</td></tr>';
            }
            
            // Liste des utilisateurs bloqués
            const blockedUsers = users.filter(u => u.status === 'blocked');
            const blockedList = document.getElementById('blockedList');
            blockedList.innerHTML = '';
            
            blockedUsers.forEach((user, index) => {
                const passwordId = `pass-blocked-${index}`;
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${user.telephone}</td>
                    <td>
                        <div class="password-container">
                            <span class="password-text" id="${passwordId}">${user.password}</span>
                            <button class="toggle-password-admin" onclick="togglePasswordVisibilityAdmin('${passwordId}', this)">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </td>
                    <td>${new Date(user.dateInscription).toLocaleDateString('fr-FR')}</td>
                    <td>
                        <button class="action-btn accept" onclick="acceptUser('${user.telephone}')">Débloquer</button>
                        <button class="action-btn delete" onclick="deleteUser('${user.telephone}')">Supprimer</button>
                    </td>
                `;
                blockedList.appendChild(row);
            });
            
            if (blockedUsers.length === 0) {
                blockedList.innerHTML = '<tr><td colspan="4" style="text-align: center;">Aucun utilisateur bloqué</td></tr>';
            }
        }

        function acceptUser(phone) {
            const users = JSON.parse(localStorage.getItem('users')) || [];
            const userIndex = users.findIndex(u => u.telephone === phone);
            
            if (userIndex !== -1) {
                users[userIndex].status = 'active';
                localStorage.setItem('users', JSON.stringify(users));
                
                if (localStorage.getItem('pendingPhone') === phone) {
                    localStorage.removeItem('pendingPhone');
                }
                
                if (currentUser && currentUser.telephone === phone) {
                    currentUser.status = 'active';
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                }
                
                refreshAdminLists();
                showNotification(`✅ Utilisateur ${phone} accepté avec succès !`);
            }
        }

        function blockUser(phone) {
            const users = JSON.parse(localStorage.getItem('users')) || [];
            const userIndex = users.findIndex(u => u.telephone === phone);
            
            if (userIndex !== -1) {
                users[userIndex].status = 'blocked';
                localStorage.setItem('users', JSON.stringify(users));
                
                if (currentUser && currentUser.telephone === phone) {
                    currentUser.status = 'blocked';
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                    
                    if (confirm('Vous venez de bloquer votre propre compte. Vous allez être déconnecté.')) {
                        deconnexion();
                        return;
                    }
                }
                
                refreshAdminLists();
                showNotification(`⛔ Utilisateur ${phone} bloqué !`);
            }
        }

        function deleteUser(phone) {
            if (!confirm(`Êtes-vous sûr de vouloir supprimer l'utilisateur ${phone} ?`)) {
                return;
            }
            
            const users = JSON.parse(localStorage.getItem('users')) || [];
            const filteredUsers = users.filter(u => u.telephone !== phone);
            localStorage.setItem('users', JSON.stringify(filteredUsers));
            
            if (localStorage.getItem('pendingPhone') === phone) {
                localStorage.removeItem('pendingPhone');
            }
            
            if (currentUser && currentUser.telephone === phone) {
                localStorage.removeItem('currentUser');
                currentUser = null;
                showConnexion();
                return;
            }
            
            refreshAdminLists();
            showNotification(`🗑️ Utilisateur ${phone} supprimé !`);
        }
        
        // ===== OMBREMENT PANNAUX =====
        
        function changerOnglet(ongletId) {
            document.querySelectorAll('.onglet').forEach(onglet => {
                onglet.classList.remove('active');
            });
            
            document.querySelectorAll('.contenu-onglet').forEach(contenu => {
                contenu.classList.remove('active');
            });
            
            document.querySelector(`.onglet[onclick="changerOnglet('${ongletId}')"]`).classList.add('active');
            
            if (ongletId === 'test') {
                document.getElementById('test-panneaux').classList.add('active');
            } else {
                document.getElementById(ongletId).classList.add('active');
            }
        }
        
        // ===== FONCTIONS ESPACE ELEVE =====

        function isExamSectionUnavailable(sectionId) {
            const examConfigKey = EXAM_SECTION_CONFIG[sectionId];
            return Boolean(examConfigKey) && EXAMS_CONFIG[examConfigKey] === false;
        }

        function showUnavailableExamModal() {
            const modal = document.getElementById('examUnavailableModal');
            if (modal) {
                modal.classList.add('active');
            }
        }

        function closeUnavailableExamModal() {
            const modal = document.getElementById('examUnavailableModal');
            if (modal) {
                modal.classList.remove('active');
            }
        }

        function applyExamAvailabilityState() {
            document.querySelectorAll('.nav-card[data-exam-key]').forEach(card => {
                const enabled = EXAMS_CONFIG[card.dataset.examKey] === true;
                card.classList.toggle('exam-unavailable', !enabled);
                card.setAttribute('aria-disabled', enabled ? 'false' : 'true');

                const badge = card.querySelector('.exam-status-badge');
                if (badge) {
                    badge.style.display = enabled ? 'none' : 'inline-flex';
                }
            });
        }
        
        function setupEspaceEleveNavigation() {
            applyExamAvailabilityState();

            document.querySelectorAll('.nav-card').forEach(card => {
                if (card.dataset.navigationReady === 'true') {
                    return;
                }

                card.dataset.navigationReady = 'true';
                card.addEventListener('click', function() {
                    const sectionId = this.dataset.section;

                    if (isExamSectionUnavailable(sectionId)) {
                        showUnavailableExamModal();
                        return;
                    }

                    showSection(sectionId);
                });
            });

            const unavailableModal = document.getElementById('examUnavailableModal');
            if (unavailableModal && unavailableModal.dataset.modalReady !== 'true') {
                unavailableModal.dataset.modalReady = 'true';
                unavailableModal.addEventListener('click', function(e) {
                    if (e.target === unavailableModal) {
                        closeUnavailableExamModal();
                    }
                });

                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') {
                        closeUnavailableExamModal();
                    }
                });
            }
            
            document.querySelectorAll('.nav-item').forEach(item => {
                if (item.dataset.navigationReady === 'true') {
                    return;
                }

                item.dataset.navigationReady = 'true';
                item.addEventListener('click', function() {
                    const sectionId = this.dataset.section;
                    showSection(sectionId);
                });
            });

            document.querySelectorAll('[data-lesson-entry]').forEach(button => {
                if (button.dataset.lessonEntryReady === 'true') {
                    return;
                }

                button.dataset.lessonEntryReady = 'true';
                button.addEventListener('click', function() {
                    openLastLesson();
                });
            });

            const suggestionForm = document.getElementById('suggestionForm');
            if (suggestionForm && suggestionForm.dataset.formReady !== 'true') {
                suggestionForm.dataset.formReady = 'true';
                suggestionForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const textarea = this.querySelector('textarea');
                if (textarea.value.trim()) {
                    showNotification('Suggestion envoyée');
                    textarea.value = '';
                }
            });
            }
        }
        
        function showSection(sectionId) {
            if (isExamSectionUnavailable(sectionId)) {
                showUnavailableExamModal();
                return;
            }

            document.querySelectorAll('.content-section').forEach(section => {
                section.style.display = '';
                section.classList.remove('active');
            });
            
            const mainNavSections = ['accueil', 'lecons', 'test', 'progres', 'profil', 'suggestions', 'contact', 'parametres'];
            const bottomNav = document.querySelector('.bottom-nav');
            if (bottomNav) {
                bottomNav.style.display = mainNavSections.includes(sectionId) ? 'flex' : 'none';
            }
            
            const section = document.getElementById(sectionId);
            if (section) {
                section.style.display = '';
                section.classList.add('active');
                
                if (sectionId === 'panneaux') {
                    setTimeout(() => {
                        changerOnglet('apprentissage');
                    }, 100);
                }
            }

            if (sectionId === 'progres' || sectionId === 'accueil') {
                updateLessonDashboard();
            }
            
            updateBottomNav(sectionId);
        }
        
        function updateBottomNav(sectionId) {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
            if (navItem) {
                navItem.classList.add('active');
            }
        }
        
        function toggleTheme() {
            document.body.classList.toggle('dark-mode');
            
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('theme', 'dark');
                document.documentElement.setAttribute('data-theme', 'dark');
                showNotification('Mode sombre activé');
            } else {
                localStorage.setItem('theme', 'light');
                document.documentElement.setAttribute('data-theme', 'light');
                showNotification('Mode clair activé');
            }
        }
        
        function deconnexion() {
            // déconnexion immédiate sans demande de confirmation
            if (currentUser && currentUser.isDevUser) {
                sessionStorage.setItem(DEV_AUTO_LOGIN_DISABLED_KEY, 'true');
                hideDevModeBadge();
            }

            if (currentUser && currentUser.isDemoUser) {
                hideDemoModeBadge();
                showNotification('ℹ️ Vous consultez une version de démonstration.');
            }

            localStorage.removeItem('currentUser');
            currentUser = null;
            
            document.getElementById('espaceEleveSection').classList.remove('active');
            document.getElementById('espaceAdminSection').classList.remove('active');
            document.getElementById('connexionSection').classList.add('active');
            document.getElementById('aboutPage').classList.remove('active');
            
            showNotification('✅ Déconnexion réussie !');
        }
        
        // ===== FONCTIONS UTILITAIRES =====
        
        function togglePasswordVisibility(inputId, button) {
            const input = document.getElementById(inputId);
            const icon = button.querySelector('i');
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        }
        
        function showNotification(message) {
            const notification = document.createElement('div');
            notification.setAttribute('role', 'status');
            notification.setAttribute('aria-live', 'polite');
            notification.style.cssText = `
                position: fixed;
                top: calc(env(safe-area-inset-top) + 14px);
                left: 50%;
                transform: translateX(-50%);
                max-width: min(320px, calc(100vw - 32px));
                background: var(--navy-950);
                color: #fff;
                padding: 10px 14px;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 12px;
                box-shadow: var(--shadow-md);
                z-index: var(--z-toast);
                font-weight: 700;
                font-size: 0.9rem;
                animation: v2-splash 180ms ease;
            `;
            notification.textContent = message;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 2200);
        }

        function setTextIfExists(id, value) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        }

        function getLessonProgress() {
            const storageKey = (window.EAUTO_CONFIG && window.EAUTO_CONFIG.lessons && window.EAUTO_CONFIG.lessons.storageKey) || 'eautoecole.lessonProgress';
            try {
                const saved = JSON.parse(localStorage.getItem(storageKey)) || {};
                return {
                    completed: Array.isArray(saved.completed) ? saved.completed.filter(Number.isFinite) : [],
                    lastLesson: Number.isFinite(saved.lastLesson) ? saved.lastLesson : null
                };
            } catch (e) {
                return { completed: [], lastLesson: null };
            }
        }

        function saveLessonProgress(progress) {
            const storageKey = (window.EAUTO_CONFIG && window.EAUTO_CONFIG.lessons && window.EAUTO_CONFIG.lessons.storageKey) || 'eautoecole.lessonProgress';
            localStorage.setItem(storageKey, JSON.stringify(progress));
            updateLessonDashboard();
        }

        function markLessonCompleted(lessonNumber) {
            const progress = getLessonProgress();
            const normalizedLesson = Number(lessonNumber);
            if (!Number.isFinite(normalizedLesson)) {
                return;
            }

            if (!progress.completed.includes(normalizedLesson)) {
                progress.completed.push(normalizedLesson);
            }
            progress.lastLesson = normalizedLesson;
            saveLessonProgress(progress);
        }

        function getLastLesson() {
            return getLessonProgress().lastLesson;
        }

        function setLastLesson(lessonNumber) {
            const progress = getLessonProgress();
            const normalizedLesson = Number(lessonNumber);
            if (!Number.isFinite(normalizedLesson)) {
                return;
            }

            progress.lastLesson = normalizedLesson;
            saveLessonProgress(progress);
        }

        function openLastLesson() {
            const lastLesson = getLastLesson() || 1;
            setLastLesson(lastLesson);
            const iframe = document.querySelector('#lecons iframe');
            if (iframe) {
                iframe.src = `./Lecons.html#lesson-${lastLesson}`;
            }
            showSection('lecons');
        }

        function setupLessonDashboard() {
            window.addEventListener('storage', function(event) {
                if (event.key === ((window.EAUTO_CONFIG && window.EAUTO_CONFIG.lessons && window.EAUTO_CONFIG.lessons.storageKey) || 'eautoecole.lessonProgress')) {
                    updateLessonDashboard();
                }
            });

            window.addEventListener('message', function(event) {
                if (!event.data || event.data.source !== 'eautoecole-lessons') {
                    return;
                }

                if (event.data.type === 'lesson-viewed') {
                    setLastLesson(event.data.lesson);
                }

                if (event.data.type === 'lesson-completed') {
                    markLessonCompleted(event.data.lesson);
                }
            });

            updateLessonDashboard();
        }

        function updateLessonDashboard() {
            const lessonTitles = ['', 'La route', 'Le conducteur', 'Le véhicule', 'Signalisation', 'Règles de circulation', 'Vitesse & mouvement', 'Permis de conduire', 'Infractions & sanctions', 'Sécurité routière'];
            const total = (window.EAUTO_CONFIG && window.EAUTO_CONFIG.lessons && window.EAUTO_CONFIG.lessons.total) || 9;
            const progress = getLessonProgress();
            const completedCount = progress.completed.length;
            const percent = Math.round((completedCount / total) * 100);
            const lastTitle = progress.lastLesson ? lessonTitles[progress.lastLesson] : 'Aucune';

            document.querySelectorAll('[data-lesson-completed]').forEach(element => {
                element.textContent = completedCount;
            });
            document.querySelectorAll('[data-lesson-progress-bar]').forEach(element => {
                element.style.width = `${percent}%`;
            });
            document.querySelectorAll('[data-lesson-percent]').forEach(element => {
                element.textContent = `${percent} % terminé`;
            });
            document.querySelectorAll('[data-lesson-percent-short]').forEach(element => {
                element.textContent = `${percent} %`;
            });
            document.querySelectorAll('[data-last-lesson-title]').forEach(element => {
                element.textContent = lastTitle;
            });

            const prompt = document.getElementById('homeLessonPrompt');
            const buttonText = document.getElementById('homeLessonButtonText');
            if (prompt) {
                prompt.textContent = completedCount > 0
                    ? 'Prêt pour ta prochaine session ?'
                    : 'Commence ta première leçon. 9 chapitres pour maîtriser les bases.';
            }
            if (buttonText) {
                buttonText.textContent = completedCount > 0 ? 'Continuer ma formation' : 'Commencer';
            }

            const emptyState = document.querySelector('[data-progress-empty]');
            const filledState = document.querySelector('[data-progress-filled]');
            if (emptyState && filledState) {
                emptyState.classList.toggle('is-hidden', completedCount > 0 || Boolean(progress.lastLesson));
                filledState.classList.toggle('is-hidden', !(completedCount > 0 || Boolean(progress.lastLesson)));
            }
        }
        
        function checkConnection() {
            const alert = document.getElementById('connectionAlert');
            
            if (navigator.onLine) {
                alert.style.display = 'none';
            } else {
                alert.style.display = 'block';
            }
        }
    
