const fs = require('fs');

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Fichier requis absent: ${path}`);
  return fs.readFileSync(path, 'utf8');
}
function has(path, needle, label) {
  if (!read(path).includes(needle)) throw new Error(`${label}: attendu introuvable dans ${path}`);
  console.log(`PASS ${label}`);
}
function lacks(path, needle, label) {
  if (read(path).includes(needle)) throw new Error(`${label}: ancien contrat encore présent dans ${path}`);
  console.log(`PASS ${label}`);
}

has('assets/js/payment-page.js', "rpc('student_submit_payment_claim')", 'paiement utilise une déclaration vérifiée');
lacks('assets/js/payment-page.js', "rpc('confirm_payment')", 'page paiement ne peut plus auto-activer un compte');
lacks('assets/js/supabase.js', 'sbConfirmPayment', 'helper historique de confirmation supprimé');
lacks('assets/js/supabase.js', "rpc('confirm_payment')", 'client global ne référence plus le RPC historique');
has('assets/js/auth-page.js', "window.location.href = 'instructor.html'", 'connexion moniteur routée vers espace dédié');
has('assets/js/auth-page.js', "window.location.href = 'admin.html'", 'connexion admin conservée');
has('admin.html', 'data-admin-view="instructors"', 'cockpit admin expose les moniteurs');
has('admin.html', 'data-admin-view="branding"', 'cockpit admin expose la marque blanche');
has('admin.html', 'data-admin-view="lessons"', 'cockpit admin expose les leçons');
has('admin.html', 'data-admin-view="panels"', 'cockpit admin expose les panneaux');
has('admin.html', 'data-admin-view="media"', 'cockpit admin expose les médias');
has('admin.html', 'admin-mobile-media-polish.js', 'polish mobile admin chargé');
has('admin.html', 'admin-media-edge.js', 'pipeline média signé chargé');
has('index.html', 'app-bootstrap.js', 'bootstrap SPA conservé');
has('index.html', 'student-experience-suite.js', 'expérience élève enrichie chargée');
has('index.html', 'home-stability.js', 'composition Home stabilisée');
has('instructor.html', 'instructor-page.js', 'espace moniteur complet présent');
has('assets/js/services/admin-product-service.js', "'video'", 'service média supporte la vidéo');
has('assets/js/services/admin-product-service.js', 'video/quicktime', 'import vidéo iPhone MOV supporté');
has('assets/js/services/admin-product-service.js', '50 * 1024 * 1024', 'limite média 50 Mo côté client');
has('assets/js/admin/admin-mobile-media-polish.js', 'Google Drive', 'sélecteur média documente Drive/iCloud');
has('assets/js/admin/admin-mobile-media-polish.js', 'video controls playsinline', 'vidéos prévisualisées avec contrôles et son');
has('assets/js/admin/admin-mobile-media-polish.js', "kind: ['audio', 'video']", 'panneaux acceptent audio ou vidéo par langue');
has('assets/js/admin/admin-media-edge.js', "functions.invoke('admin-media-upload'", 'frontend utilise edge function admin média');
has('assets/js/admin/admin-media-edge.js', 'uploadToSignedUrl', 'frontend utilise URL signée pour le fichier');
has('assets/js/modules/panels.js', 'sign.audioWo', 'vue élève consomme audio Wolof CMS');
has('assets/js/modules/panels.js', 'sign.audioFr', 'vue élève consomme audio français CMS');
has('assets/js/modules/panels.js', 'data-panel-audio', 'audios panneau utilisent le contrôle unifié');
has('assets/js/modules/panels.js', 'stopPanelPlayback()', 'lecture panneau possède un arrêt global');
has('assets/js/modules/panels.js', "currentPlayback?.kind === 'speech'", 'deuxième clic français arrête la lecture');
has('assets/js/modules/panels.js', "currentPlayback?.kind === 'audio'", 'deuxième clic audio arrête la lecture');
has('assets/js/modules/panels.js', "active.element.pause()", 'changer de langue coupe le média précédent');
lacks('assets/js/modules/panels.js', '<audio controls', 'ancien lecteur audio natif gris supprimé des panneaux');
has('assets/js/modules/panels.js', '<video controls playsinline', 'vue élève conserve vidéo avec son');
has('assets/css/panels.css', '.panel-play-card.playing', 'état visuel lecture/stop unifié');
has('assets/js/app-bootstrap.js', "new HashChangeEvent('hashchange')", 'vue CMS active se rafraîchit après hydratation');
has('supabase/functions/admin-media-upload/index.ts', 'createSignedUploadUrl', 'edge function crée les URLs signées');
has('supabase/functions/admin-media-upload/index.ts', 'app_metadata?.role', 'edge function vérifie le rôle admin');
has('supabase/migrations/20260822135954_cms_media_video_support.sql', "'video'", 'migration vidéo CMS versionnée');
has('supabase/migrations/20260822135954_cms_media_video_support.sql', '52428800', 'bucket média élargi à 50 Mo');
has('supabase/migrations/20260822142825_lock_cms_media_to_signed_uploads.sql', 'drop policy if exists cms_media_admin_insert', 'écriture directe storage média verrouillée');
has('supabase/migrations/20260822145417_rc_security_hardening.sql', "revoke execute on function public.is_admin() from public, anon", 'RC ferme is_admin aux visiteurs');
has('supabase/migrations/20260822145417_rc_security_hardening.sql', "set search_path = ''", 'RC fixe les search_path de triggers');
has('supabase/migrations/20260822145620_rc_performance_hardening.sql', 'idx_cms_panels_current_version', 'RC indexe les pointeurs de version CMS');
has('supabase/migrations/20260822145620_rc_performance_hardening.sql', '(select public.is_admin())', 'RC optimise les policies admin examens');
has('supabase/migrations/20260822061328_secure_payment_claims.sql', 'student_submit_payment_claim', 'migration paiement vérifié versionnée');
has('supabase/migrations/20260822061328_secure_payment_claims.sql', 'confirm_payment', 'migration neutralise le flux historique');
has('supabase/migrations/20260822055342_school_branding_instructor_platform.sql', 'admin_set_account_role', 'migration rôles moniteur versionnée');
has('supabase/migrations/20260822055342_school_branding_instructor_platform.sql', 'enable row level security', 'RLS plateforme moniteur versionnée');

console.log('PASS V3.3.1 release candidate contracts');
