import { requireAuthenticatedUser, logoutCurrentUser } from './services/auth-service.js';
import {
  loadInstructorDashboard, loadInstructorStudents, loadInstructorStudentDetail, requestStudentLink,
  loadAssignmentWorkspace, createInstructorGoal, updateInstructorGoalStatus, scheduleInstructorActivity,
  updateInstructorActivity, setStudentReadiness, createRecommendation, scheduleStudentExam,
  updateStudentExamResult, addDrivingEvaluation, loadAssignmentMessages, sendAssignmentMessage,
  markAssignmentMessagesRead, loadInstructorProfileWorkspace
} from './services/instructor-service.js';
import { uploadMessageMedia, getMessageMediaUrl } from './services/message-media-service.js';
import { loadNotifications, markNotificationRead, markAllNotificationsRead, startPresenceHeartbeat, subscribeNotifications } from './services/notification-service.js';

const VIEWS = ['home','students','messages','planning','exams','driving','progress','notifications','profile'];
const state = { user:null, profile:null, dashboard:null, students:[], view:'home', selected:null, notifications:[], busy:false, messageChannel:null };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const auth = await requireAuthenticatedUser({ allowInstructor:true, allowAdmin:true });
  if (!auth) return;
  if (!auth.profile?.isInstructor && !auth.profile?.isAdmin) { await window.sbLogout().catch(()=>{}); location.href='auth.html?instructor=denied'; return; }
  state.user = auth.profile;
  [state.profile, state.dashboard, state.students] = await Promise.all([
    loadInstructorProfileWorkspace().catch(()=>null), loadInstructorDashboard(), loadInstructorStudents().catch(()=>[])
  ]);
  mergeStudents();
  state.selected = state.students[0]?.assignmentId || null;
  applyBrand(); bindShell(); startPresenceHeartbeat();
  await refreshNotifications();
  await subscribeNotifications(async () => { await refreshNotifications(); updateBell(); if (state.view==='notifications') render(); });
  render();
}

function mergeStudents() {
  const basic = new Map((state.dashboard?.students || []).map(s=>[s.studentId,s]));
  state.students = state.students.map(s=>({ ...basic.get(s.studentId), ...s }));
}
function applyBrand() {
  const app = window.EAUTO_SCHOOL_SETTINGS?.app_name || 'eAutoecole';
  const school = state.profile?.school?.name || window.EAUTO_SCHOOL_SETTINGS?.school_name || 'Auto-école';
  document.querySelector('[data-brand-app]').textContent = app;
  document.querySelector('[data-brand-school]').textContent = `${school} · Espace Moniteur`;
  document.querySelector('[data-instructor-name]').textContent = state.profile?.profile?.name || state.user?.prenom || 'Moniteur';
}
function bindShell() {
  document.querySelector('[data-instructor-logout]')?.addEventListener('click',()=>logoutCurrentUser(state.user));
  document.querySelectorAll('[data-instructor-view]').forEach(btn=>btn.addEventListener('click',()=>openView(btn.dataset.instructorView)));
  document.querySelector('[data-notification-bell]')?.addEventListener('click',()=>openView('notifications'));
}
async function openView(view) {
  if (!VIEWS.includes(view) || state.busy) return;
  state.view=view;
  document.querySelectorAll('[data-instructor-view]').forEach(b=>b.classList.toggle('active',b.dataset.instructorView===view));
  render();
}
function render() {
  const root=document.getElementById('instructor-view'); if(!root)return;
  const handlers={home:renderHome,students:renderStudents,messages:renderMessages,planning:renderPlanning,exams:renderExams,driving:renderDriving,progress:renderProgress,notifications:renderNotifications,profile:renderProfile};
  root.innerHTML=''; handlers[state.view]?.(root);
  updateBell();
}
function renderHome(root) {
  const stats=state.dashboard?.stats||{}; const sessions=state.dashboard?.upcomingSessions||[]; const exams=state.dashboard?.upcomingExams||[];
  root.innerHTML=`<section class="iv-view">
    ${hero(`Bonjour, ${esc(state.profile?.profile?.name||'Moniteur')} 👋🏽`,'Votre journée en un coup d’œil. Les alertes importantes remontent automatiquement.')}
    <div class="iv-stat-grid">${stat('Mes élèves',stats.total||0,'fa-users')}${stat('Actifs',stats.active||0,'fa-circle-check','good')}${stat('En difficulté',stats.difficulty||0,'fa-triangle-exclamation','warn')}${stat('Prêts examen',stats.ready||0,'fa-trophy','good')}</div>
    <div class="iv-two-col"><section class="iv-card"><div class="iv-card-head"><div><p class="eyebrow">Planning</p><h2>Prochains cours</h2></div><button class="iv-link" data-go="planning">Voir tout</button></div>${timeline(sessions.slice(0,6),'session')}</section>
    <section class="iv-card"><div class="iv-card-head"><div><p class="eyebrow">Échéances</p><h2>Prochains examens</h2></div><button class="iv-link" data-go="exams">Voir tout</button></div>${timeline(exams.slice(0,6),'exam')}</section></div>
    <section class="iv-card"><div class="iv-card-head"><div><p class="eyebrow">À traiter</p><h2>Notifications</h2></div><span class="iv-badge">${unreadCount()} non lue${unreadCount()>1?'s':''}</span></div>${notificationList(state.notifications.slice(0,5))}</section>
  </section>`;
  bindGo(root);
}
function renderStudents(root) {
  root.innerHTML=`<section class="iv-view">${hero('Mes élèves','Uniquement les élèves qui vous sont rattachés. Consultez leur progression ou demandez un nouveau rattachement.')}
    <section class="iv-card"><div class="iv-card-head"><div><p class="eyebrow">Rattachement</p><h2>Ajouter un élève</h2></div></div><form class="iv-inline-form" data-link-form><input name="phone" inputmode="tel" placeholder="77 123 45 67" required><button class="iv-primary">Vérifier & demander</button></form><div data-link-result></div></section>
    <div class="iv-student-grid">${state.students.length?state.students.map(studentCard).join(''):empty('Aucun élève rattaché pour le moment.')}</div>
    <section class="iv-detail-slot" data-student-detail></section></section>`;
  root.querySelector('[data-link-form]')?.addEventListener('submit',handleLinkRequest);
  root.querySelectorAll('[data-open-student]').forEach(b=>b.addEventListener('click',()=>showStudentDetail(b.dataset.openStudent)));
}
async function handleLinkRequest(e) {
  e.preventDefault(); const form=e.currentTarget; const result=form.parentElement.querySelector('[data-link-result]');
  await withBusy(form.querySelector('button'),async()=>{
    const data=await requestStudentLink(new FormData(form).get('phone'));
    const messages={not_found:'Aucun compte élève avec ce numéro.',payment_required:`Cet élève n’a pas encore un accès eAutoecole confirmé. Prix : ${Number(data?.price||2000).toLocaleString('fr-FR')} FCFA.`,already_linked:'Cet élève est déjà rattaché à vous.',assigned_elsewhere:'Cet élève est déjà rattaché à un autre moniteur.',instructor_without_school:'Votre compte doit d’abord être associé à une auto-école.',pending:`Demande envoyée à l’administration pour ${data?.studentName||'cet élève'}.`};
    result.innerHTML=`<div class="iv-alert ${data?.state==='pending'?'success':'warn'}">${esc(messages[data?.state]||'Vérification terminée.')}</div>`;
  });
}
async function showStudentDetail(assignmentId) {
  state.selected=assignmentId; const slot=document.querySelector('[data-student-detail]'); if(!slot)return;
  slot.innerHTML=loading('Chargement du dossier…');
  try {
    const detail=await loadInstructorStudentDetail(assignmentId); const s=detail?.student||{};
    slot.innerHTML=`<section class="iv-card iv-student-detail"><div class="iv-card-head"><div><p class="eyebrow">Profil détaillé</p><h2>${esc(s.prenom||'Élève')}</h2><p>${esc(formatPhone(s.telephone))}</p></div>${readinessSelect(assignmentId,s.readinessStatus)}</div>
      <div class="iv-stat-grid compact">${stat('Progression',`${detail?.accuracy||0}%`,'fa-chart-line')}${stat('Questions',detail?.answered||0,'fa-list-check')}${stat('Points',detail?.points||0,'fa-star')}${stat('Conduite',readinessLabel(s.readinessStatus),'fa-car')}</div>
      <div class="iv-two-col"><div><h3>Points faibles</h3>${topicRows(detail?.weakTopics||[],'weak')}</div><div><h3>Points forts</h3>${topicRows(detail?.strongTopics||[],'strong')}</div></div>
      <div class="iv-action-grid"><button class="iv-secondary" data-student-action="messages">💬 Contacter</button><button class="iv-secondary" data-student-action="planning">📅 Programmer un cours</button><button class="iv-secondary" data-student-action="progress">📊 Progression</button><button class="iv-secondary" data-student-action="driving">📝 Évaluer</button></div>
      <div class="iv-two-col"><form class="iv-form" data-rec-form><h3>Recommander</h3><select name="type"><option value="lesson">Leçon</option><option value="test">Test</option><option value="video">Vidéo</option></select><input name="title" placeholder="Titre" required><input name="target" placeholder="ID / lien interne"><textarea name="note" placeholder="Message personnalisé"></textarea><button class="iv-primary">Envoyer la recommandation</button></form>
      <form class="iv-form" data-goal-form><h3>Objectif</h3><input name="title" placeholder="Ex. 3 tests à 80 %" required><textarea name="details" placeholder="Détails"></textarea><input name="due" type="date"><button class="iv-primary">Créer l’objectif</button></form></div>
    </section>`;
    slot.querySelector('[data-readiness]')?.addEventListener('change',async e=>{await setStudentReadiness(assignmentId,e.target.value); toast('Statut mis à jour.'); await refreshData(); showStudentDetail(assignmentId);});
    slot.querySelectorAll('[data-student-action]').forEach(b=>b.addEventListener('click',()=>openStudentAction(b.dataset.studentAction,assignmentId)));
    slot.querySelector('[data-rec-form]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);await withBusy(f.querySelector('button'),()=>createRecommendation(assignmentId,{type:d.get('type'),title:d.get('title'),targetKey:d.get('target'),note:d.get('note')}));f.reset();toast('Recommandation envoyée.');});
    slot.querySelector('[data-goal-form]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);await withBusy(f.querySelector('button'),()=>createInstructorGoal(assignmentId,{title:d.get('title'),details:d.get('details'),dueDate:d.get('due')||null}));f.reset();toast('Objectif créé.');});
    slot.scrollIntoView({behavior:'smooth',block:'start'});
  } catch(err){slot.innerHTML=empty(err.message||'Dossier indisponible.');}
}
function openStudentAction(view,assignmentId){state.selected=assignmentId;openView(view);}

async function renderMessages(root) {
  root.innerHTML=`<section class="iv-view">${hero('Messages','Discussion privée avec vos élèves : texte, vocal, photo, vidéo ou document.')}${studentPicker('messages')}<section class="iv-card" data-message-panel>${state.selected?loading('Chargement des messages…'):empty('Choisissez un élève.')}</section></section>`;
  bindStudentPicker(root,'messages'); if(state.selected) await loadMessagePanel(root,state.selected);
}
async function loadMessagePanel(root,assignmentId){
  const panel=root.querySelector('[data-message-panel]'); const student=findStudent(assignmentId); if(!panel)return;
  const messages=await loadAssignmentMessages(assignmentId); await markAssignmentMessagesRead(assignmentId).catch(()=>{});
  panel.innerHTML=`<div class="iv-chat-head"><div><strong>${esc(student?.prenom||'Élève')}</strong><small>${student?.online?'🟢 En ligne':'⚫ Hors ligne'}</small></div></div><div class="iv-chat" data-chat>${messages.length?messages.map(messageBubble).join(''):empty('Aucun message. Commencez la conversation.')}</div>
    <form class="iv-message-form" data-message-form><textarea name="body" rows="2" placeholder="Écrire un message…"></textarea><label class="iv-attach"><i class="fas fa-paperclip"></i><span>Photo, vocal, vidéo, document</span><input name="file" type="file" accept="image/*,audio/*,video/*,.pdf,.txt"></label><button class="iv-primary">Envoyer</button></form>`;
  await hydrateMessageMedia(panel,assignmentId);
  panel.querySelector('[data-message-form]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f),file=d.get('file');await withBusy(f.querySelector('button'),async()=>{let media=null;if(file&&file.size)media=await uploadMessageMedia(assignmentId,file);await sendAssignmentMessage(assignmentId,{kind:media?.kind||'text',body:String(d.get('body')||''),mediaPath:media?.path||null,mimeType:media?.mimeType||null});});f.reset();await loadMessagePanel(root,assignmentId);});
  subscribeMessageRealtime(assignmentId,()=>{if(state.view==='messages'&&state.selected===assignmentId)loadMessagePanel(root,assignmentId).catch(()=>{});});
}
function messageBubble(m){const mine=m.sender_id===state.profile?.profile?.id;return `<article class="iv-message ${mine?'mine':''}" data-message-id="${m.id}">${m.body?`<p>${esc(m.body)}</p>`:''}${m.media_path?`<div class="iv-media-placeholder" data-media-path="${attr(m.media_path)}" data-media-kind="${attr(m.message_kind)}"><span class="spinner"></span></div>`:''}<small>${formatDateTime(m.created_at)} · ${m.seen_at?'Vu':'Envoyé'}</small></article>`;}
async function hydrateMessageMedia(root,assignmentId){for(const node of root.querySelectorAll('[data-media-path]')){try{const url=await getMessageMediaUrl(assignmentId,node.dataset.mediaPath);const k=node.dataset.mediaKind;node.innerHTML=k==='image'?`<img src="${attr(url)}" alt="Pièce jointe">`:k==='audio'?`<audio controls src="${attr(url)}"></audio>`:k==='video'?`<video controls playsinline src="${attr(url)}"></video>`:`<a href="${attr(url)}" target="_blank" rel="noopener">Ouvrir le document</a>`;}catch{node.textContent='Média indisponible';}}}
function subscribeMessageRealtime(assignmentId,cb){if(state.messageChannel)window.sb.removeChannel(state.messageChannel).catch(()=>{});state.messageChannel=window.sb.channel(`msg:${assignmentId}:${Date.now()}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'instructor_messages',filter:`assignment_id=eq.${assignmentId}`},cb).subscribe();}

async function renderPlanning(root){
  root.innerHTML=`<section class="iv-view">${hero('Planning','Cours de conduite et cours théoriques avec date, heure, lieu, durée et thème.')}${studentPicker('planning')}<section class="iv-card">${state.selected?`<form class="iv-form iv-plan-form" data-plan-form><div class="iv-form-grid"><label>Type<select name="type"><option value="driving">🚗 Conduite</option><option value="theory">📖 Théorie</option></select></label><label>Date & heure<input name="date" type="datetime-local" required></label><label>Durée<input name="duration" type="number" min="15" max="240" step="15" value="60"></label><label>Lieu<input name="location" placeholder="Keur Massar"></label></div><input name="theme" placeholder="Thème / objectif de séance"><button class="iv-primary">Programmer</button></form>`:empty('Choisissez un élève.')}</section><section class="iv-card"><h2>Prochains rendez-vous</h2>${timeline(state.dashboard?.upcomingSessions||[],'session',true)}</section></section>`;
  bindStudentPicker(root,'planning'); root.querySelector('[data-plan-form]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);await withBusy(f.querySelector('button'),()=>scheduleInstructorActivity(state.selected,{type:d.get('type'),scheduledAt:new Date(d.get('date')).toISOString(),durationMinutes:d.get('duration'),location:d.get('location'),theme:d.get('theme')}));f.reset();await refreshData();render();toast('Cours programmé et élève notifié.');});
}
async function renderExams(root){
  let exams=[]; if(state.selected){exams=(await loadAssignmentWorkspace(state.selected)).exams;}
  root.innerHTML=`<section class="iv-view">${hero('Examens','Programmez Code théorique, oral ou conduite et enregistrez le résultat.')}${studentPicker('exams')}<section class="iv-card">${state.selected?`<form class="iv-form" data-exam-form><div class="iv-form-grid"><label>Type<select name="type"><option value="code_theory">Code · Théorie</option><option value="code_oral">Code · Oral</option><option value="driving">Conduite</option></select></label><label>Date & heure<input name="date" type="datetime-local" required></label><label>Lieu<input name="location"></label></div><button class="iv-primary">Programmer l’examen</button></form>`:empty('Choisissez un élève.')}</section><section class="iv-card"><h2>Historique examens</h2>${exams.length?exams.map(examRow).join(''):empty('Aucun examen enregistré.')}</section></section>`;
  bindStudentPicker(root,'exams'); root.querySelector('[data-exam-form]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);await withBusy(f.querySelector('button'),()=>scheduleStudentExam(state.selected,{type:d.get('type'),scheduledAt:new Date(d.get('date')).toISOString(),location:d.get('location')}));f.reset();render();toast('Examen programmé.');});
  root.querySelectorAll('[data-exam-result]').forEach(b=>b.addEventListener('click',()=>examResultPrompt(b.dataset.examResult)));
}
async function examResultPrompt(id){const status=prompt('Résultat : passed ou failed ?','passed');if(!['passed','failed'].includes(status))return;const observation=prompt('Observation (optionnelle)','')||'';await updateStudentExamResult(id,status,observation);toast('Résultat enregistré.');render();}

async function renderDriving(root){
  let ws={evaluations:[]};if(state.selected)ws=await loadAssignmentWorkspace(state.selected);
  root.innerHTML=`<section class="iv-view">${hero('Carnet de conduite','Évaluez chaque séance pratique avec des critères identiques pour suivre la progression.')}${studentPicker('driving')}<section class="iv-card">${state.selected?evaluationForm():empty('Choisissez un élève.')}</section><section class="iv-card"><h2>Historique conduite</h2>${ws.evaluations.length?ws.evaluations.map(evaluationRow).join(''):empty('Aucune évaluation enregistrée.')}</section></section>`;
  bindStudentPicker(root,'driving');root.querySelector('[data-eval-form]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f),ratings={vehicle:+d.get('vehicle'),braking:+d.get('braking'),direction:+d.get('direction'),parking:+d.get('parking'),lane:+d.get('lane'),checks:+d.get('checks'),code:+d.get('code')};await withBusy(f.querySelector('button'),()=>addDrivingEvaluation(state.selected,{durationMinutes:d.get('duration'),location:d.get('location'),ratings,score:d.get('score'),comment:d.get('comment')}));f.reset();render();toast('Évaluation ajoutée.');});
}
async function renderProgress(root){
  root.innerHTML=`<section class="iv-view">${hero('Progression','Repérez immédiatement les élèves à accompagner et ceux qui sont prêts pour l’examen.')}<div class="iv-progress-list" data-progress-list>${loading('Analyse des élèves…')}</div></section>`;
  const details=await Promise.all(state.students.map(async s=>({student:s,detail:await loadInstructorStudentDetail(s.assignmentId).catch(()=>null)})));
  const list=root.querySelector('[data-progress-list]');list.innerHTML=details.length?details.map(({student,detail})=>`<article class="iv-card iv-progress-card"><div><strong>${esc(student.prenom)}</strong><small>${student.online?'🟢 En ligne':'⚫ Hors ligne'} · ${readinessLabel(student.readinessStatus)}</small></div><div class="iv-progress-meter"><span style="width:${Math.max(0,Math.min(100,detail?.accuracy||0))}%"></span></div><strong>${detail?.accuracy||0}%</strong><div class="iv-topic-inline">${(detail?.weakTopics||[]).slice(0,3).map(t=>`<span>⚠️ ${esc(t.topic)} ${t.accuracy}%</span>`).join('')}</div></article>`).join(''):empty('Aucun élève.');
}
function renderNotifications(root){root.innerHTML=`<section class="iv-view">${hero('Notifications','Messages, rattachements, rappels, examens et alertes de suivi.')}<section class="iv-card"><div class="iv-card-head"><h2>Centre de notifications</h2><button class="iv-secondary" data-read-all>Tout marquer comme lu</button></div>${notificationList(state.notifications)}</section></section>`;root.querySelector('[data-read-all]')?.addEventListener('click',async()=>{await markAllNotificationsRead();await refreshNotifications();render();});root.querySelectorAll('[data-notification-id]').forEach(n=>n.addEventListener('click',async()=>{await markNotificationRead(n.dataset.notificationId);await refreshNotifications();render();}));}
function renderProfile(root){const p=state.profile?.profile||{},s=state.profile?.school||{};root.innerHTML=`<section class="iv-view">${hero('Mon profil','Vos informations professionnelles. Les données sensibles restent gérées par eAutoecole.')}<section class="iv-card iv-profile"><div class="iv-avatar-lg">${initials(p.name)}</div><div><h2>${esc(p.name||'Moniteur')}</h2><p>${esc(formatPhone(p.phone))}</p><span class="iv-badge success">Compte ${esc(p.status||'actif')}</span></div></section><div class="iv-two-col"><section class="iv-card"><h3>Auto-école associée</h3><dl class="iv-dl"><div><dt>Nom</dt><dd>${esc(s.name||'—')}</dd></div><div><dt>Ville</dt><dd>${esc(s.city||'—')}</dd></div><div><dt>Téléphone</dt><dd>${esc(s.phone||'—')}</dd></div><div><dt>Adresse</dt><dd>${esc(s.address||'—')}</dd></div></dl></section><section class="iv-card"><h3>Sécurité</h3><p>Vous voyez uniquement vos élèves, vos messages, votre planning et vos évaluations. Les paiements globaux et l’administration restent réservés à eAutoecole.</p><button class="iv-danger" data-profile-logout>Se déconnecter</button></section></div></section>`;root.querySelector('[data-profile-logout]')?.addEventListener('click',()=>logoutCurrentUser(state.user));}

function studentPicker(view){return `<section class="iv-card iv-picker"><label>Élève<select data-student-picker><option value="">Choisir…</option>${state.students.map(s=>`<option value="${attr(s.assignmentId)}" ${s.assignmentId===state.selected?'selected':''}>${esc(s.prenom)} · ${esc(formatPhone(s.telephone))}</option>`).join('')}</select></label></section>`;}
function bindStudentPicker(root,view){root.querySelector('[data-student-picker]')?.addEventListener('change',e=>{state.selected=e.target.value||null;openView(view);});}
function studentCard(s){return `<article class="iv-card iv-student-card"><div class="iv-person"><span class="iv-avatar">${initials(s.prenom)}</span><div><strong>${esc(s.prenom||'Élève')}</strong><small>${s.online?'🟢 En ligne':'⚫ Hors ligne'} · ${esc(formatPhone(s.telephone))}</small></div></div><div class="iv-student-metrics"><span>Progression <strong>${Number(s.accuracy||0)}%</strong></span><span>Tests <strong>${Number(s.accuracy||0)}%</strong></span><span>Conduite <strong>${readinessLabel(s.readinessStatus)}</strong></span></div><div class="iv-actions"><button class="iv-primary" data-open-student="${attr(s.assignmentId)}">Voir le profil</button><button class="iv-secondary" data-quick-message="${attr(s.assignmentId)}">💬 Contacter</button></div></article>`;}
function readinessSelect(id,status){return `<label class="iv-readiness">Préparation<select data-readiness="${attr(id)}"><option value="training" ${status==='training'?'selected':''}>🟠 En formation</option><option value="preparing" ${status==='preparing'?'selected':''}>🟡 En préparation</option><option value="ready" ${status==='ready'?'selected':''}>🟢 Prêt pour l’examen</option><option value="needs_work" ${status==='needs_work'?'selected':''}>🔴 Doit encore travailler</option></select></label>`;}
function topicRows(items,kind){return items.length?`<div class="iv-topic-list">${items.map(t=>`<div><span>${kind==='weak'?'⚠️':'🟢'} ${esc(t.topic||'Notion')}</span><strong>${Number(t.accuracy||0)}%</strong><div><i style="width:${Number(t.accuracy||0)}%"></i></div></div>`).join('')}</div>`:empty('Pas encore assez de données.');}
function evaluationForm(){const criteria=[['vehicle','Maîtrise du véhicule'],['braking','Freinage'],['direction','Changement de direction'],['parking','Stationnement'],['lane','Changement de voie'],['checks','Contrôles'],['code','Respect du Code']];return `<form class="iv-form" data-eval-form><h2>Nouvelle évaluation</h2><div class="iv-form-grid"><label>Date<input type="date" value="${new Date().toISOString().slice(0,10)}" disabled></label><label>Durée (min)<input name="duration" type="number" value="60" min="15" max="360"></label><label>Lieu<input name="location"></label><label>Note globale /10<input name="score" type="number" min="0" max="10" step="0.5" value="8" required></label></div><div class="iv-rating-grid">${criteria.map(([k,l])=>`<label>${l}<input name="${k}" type="range" min="0" max="10" value="7"><span>0–10</span></label>`).join('')}</div><textarea name="comment" placeholder="Commentaire du moniteur"></textarea><button class="iv-primary">Enregistrer l’évaluation</button></form>`;}
function examRow(e){return `<article class="iv-list-row"><div><strong>${examLabel(e.exam_type)}</strong><small>${formatDateTime(e.scheduled_at)} · ${esc(e.location||'Lieu à confirmer')}</small>${e.observation?`<p>${esc(e.observation)}</p>`:''}</div><span class="iv-badge ${e.status==='passed'?'success':e.status==='failed'?'danger':''}">${examStatus(e.status)}</span>${e.status==='scheduled'?`<button class="iv-secondary" data-exam-result="${e.id}">Résultat</button>`:''}</article>`;}
function evaluationRow(e){return `<article class="iv-list-row"><div><strong>⭐ ${Number(e.overall_score||0)}/10</strong><small>${formatDate(e.evaluation_date)} · ${Number(e.duration_minutes||0)} min · ${esc(e.location||'')}</small><p>${esc(e.comment||'Sans commentaire')}</p></div></article>`;}
function timeline(items,type,withStudent=false){return items.length?`<div class="iv-timeline">${items.map(i=>`<article><span class="iv-time-icon">${type==='exam'?'📝':i.type==='theory'?'📖':'🚗'}</span><div><strong>${withStudent?`${esc(i.studentName||'Élève')} · `:''}${type==='exam'?examLabel(i.type):i.type==='theory'?'Cours théorique':'Cours de conduite'}</strong><small>${formatDateTime(i.scheduledAt)}${i.location?` · ${esc(i.location)}`:''}</small></div></article>`).join('')}</div>`:empty(type==='exam'?'Aucun examen à venir.':'Aucun cours à venir.');}
function notificationList(items){return items.length?`<div class="iv-notification-list">${items.map(n=>`<button class="iv-notification ${n.read_at?'':'unread'}" data-notification-id="${n.id}"><span>${notificationIcon(n.category)}</span><div><strong>${esc(n.title)}</strong><p>${esc(n.body||'')}</p><small>${formatDateTime(n.created_at)}</small></div></button>`).join('')}</div>`:empty('Aucune notification.');}
function hero(title,text){return `<header class="iv-hero"><div><p class="eyebrow">Espace professionnel</p><h1>${title}</h1><p>${text}</p></div></header>`;}
function stat(label,value,icon,tone=''){return `<article class="iv-stat ${tone}"><i class="fas ${icon}"></i><div><span>${label}</span><strong>${value}</strong></div></article>`;}
function empty(text){return `<div class="iv-empty"><i class="fas fa-circle-info"></i><span>${esc(text)}</span></div>`;}
function loading(text){return `<div class="iv-loading"><span class="spinner"></span><span>${esc(text)}</span></div>`;}
function bindGo(root){root.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>openView(b.dataset.go)));root.querySelectorAll('[data-quick-message]').forEach(b=>b.addEventListener('click',()=>{state.selected=b.dataset.quickMessage;openView('messages');}));}
async function refreshNotifications(){state.notifications=await loadNotifications(60).catch(()=>[]);updateBell();}
async function refreshData(){const [dashboard,students]=await Promise.all([loadInstructorDashboard(),loadInstructorStudents().catch(()=>[])]);state.dashboard=dashboard;state.students=students;mergeStudents();await refreshNotifications();}
function updateBell(){const n=unreadCount();const badge=document.querySelector('[data-notification-count]');if(badge){badge.textContent=n>99?'99+':String(n);badge.hidden=!n;}}
function unreadCount(){return state.notifications.filter(n=>!n.read_at).length;}
async function withBusy(button,fn){if(state.busy)return;state.busy=true;const old=button?.innerHTML;if(button){button.disabled=true;button.innerHTML='<span class="spinner mini"></span>';}try{return await fn();}catch(e){toast(e.message||'Action impossible',true);throw e;}finally{state.busy=false;if(button){button.disabled=false;button.innerHTML=old;}}}
function toast(message,error=false){const root=document.getElementById('instructor-toast-root');if(!root)return;root.innerHTML=`<div class="toast ${error?'error':''}">${esc(message)}</div>`;setTimeout(()=>root.replaceChildren(),3200);}
function findStudent(id){return state.students.find(s=>s.assignmentId===id);}
function formatPhone(v=''){const d=String(v).replace(/\D/g,'').replace(/^221/,'');return d.length===9?`${d.slice(0,2)} ${d.slice(2,5)} ${d.slice(5,7)} ${d.slice(7)}`:v;}
function formatDateTime(v){if(!v)return '—';return new Intl.DateTimeFormat('fr-SN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}
function formatDate(v){if(!v)return '—';return new Intl.DateTimeFormat('fr-SN',{dateStyle:'medium'}).format(new Date(v));}
function readinessLabel(s){return ({training:'En formation',preparing:'En préparation',ready:'Prêt examen',needs_work:'À renforcer'})[s]||'En formation';}
function examLabel(s){return ({code_theory:'Code · Théorie',code_oral:'Code · Oral',driving:'Conduite'})[s]||'Examen';}
function examStatus(s){return ({scheduled:'Programmé',passed:'Réussi',failed:'Échoué',cancelled:'Annulé'})[s]||s;}
function notificationIcon(c=''){if(c.includes('message'))return'💬';if(c.includes('payment')||c.includes('registration'))return'💳';if(c.includes('exam'))return'📝';if(c.includes('session'))return'📅';if(c.includes('ready'))return'🏆';if(c.includes('link'))return'👥';return'🔔';}
function initials(v=''){return String(v||'M').split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();}
function esc(v=''){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function attr(v=''){return esc(v).replace(/`/g,'&#96;');}
