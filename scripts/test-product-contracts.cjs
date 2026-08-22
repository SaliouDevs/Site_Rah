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
has('index.html', 'app-bootstrap.js', 'SPA hydrate le CMS avant démarrage');
has('index.html', 'student-experience-suite.js', 'expérience élève enrichie chargée');
has('instructor.html', 'instructor-page.js', 'espace moniteur complet présent');
has('supabase/migrations/20260822061328_secure_payment_claims.sql', 'student_submit_payment_claim', 'migration paiement vérifié versionnée');
has('supabase/migrations/20260822061328_secure_payment_claims.sql', 'confirm_payment', 'migration neutralise le flux historique');
has('supabase/migrations/20260822055342_school_branding_instructor_platform.sql', 'admin_set_account_role', 'migration rôles moniteur versionnée');
has('supabase/migrations/20260822055342_school_branding_instructor_platform.sql', 'enable row level security', 'RLS plateforme moniteur versionnée');

console.log('PASS product contracts');
