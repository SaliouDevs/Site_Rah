const root=document.getElementById('app-view');
if(root){
  const inject=()=>{
    if(window.EAUTO_CURRENT_USER?.isAdmin||window.EAUTO_CURRENT_USER?.isInstructor)return;
    const path=(location.hash||'#/home').replace(/^#\/?/,'/');
    if(path==='/home') injectHome();
    if(path==='/profile') injectProfile();
  };
  const observer=new MutationObserver(()=>queueMicrotask(inject));observer.observe(root,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(inject,0));setTimeout(inject,0);
}
function injectHome(){
  if(document.querySelector('[data-student-monitor-entry]'))return;
  const home=document.querySelector('.home-view');if(!home)return;
  const card=document.createElement('section');card.className='continue-card';card.dataset.studentMonitorEntry='1';
  card.innerHTML='<div><p class="eyebrow">Accompagnement</p><h2>👨🏽‍🏫 Mon Moniteur</h2><p>Messages, recommandations, cours, examens et suivi conduite au même endroit.</p></div><button class="primary-action" type="button">Ouvrir</button>';
  card.querySelector('button').addEventListener('click',()=>location.href='student-monitor.html');
  const hero=home.querySelector('.dashboard-hero');hero?.insertAdjacentElement('afterend',card);
}
function injectProfile(){
  if(document.querySelector('[data-student-monitor-profile]'))return;
  const layout=document.querySelector('.profile-layout');if(!layout)return;
  const group=document.createElement('div');group.className='profile-group';group.dataset.studentMonitorProfile='1';
  group.innerHTML='<h2>Accompagnement</h2><button class="profile-row" type="button"><i class="fas fa-user-tie"></i><span>Mon Moniteur</span><strong>Messages & suivi</strong></button>';
  group.querySelector('button').addEventListener('click',()=>location.href='student-monitor.html');
  const first=layout.querySelector('.profile-card-main');first?.insertAdjacentElement('afterend',group);
}
