const API_URL = 'https://functions.yandexcloud.net/d4ebvaiffdtsos840t16';
const MOSCOW_TZ = 'Europe/Moscow';
const TEACHERS = ['Егор','Миша','Иван','Никита'];
const SESSION_KEY = 'kotomatika_crm_session_v1';

const STATE = {
  leads: [], events: [], students: [], payments: [], tasks: [], lessons: [], teachers: [], authLog: [],
  features: {}, session: {}
};
let token = sessionStorage.getItem(SESSION_KEY) || '';
let currentLead = null;
let currentStudent = null;
let taskContext = {leadId:'', studentId:''};
let selectedAgendaKey = '';
let crmCalView = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#039;');
const rub = n => new Intl.NumberFormat('ru-RU').format(Number(n||0)) + ' ₽';
const pad2 = n => String(n).padStart(2,'0');

function showError(msg){
  const el=$('#globalError'); el.textContent=msg; el.hidden=false;
  setTimeout(()=>{el.hidden=true},9000);
}
function toast(msg){
  const el=$('#globalToast'); el.textContent=msg; el.hidden=false;
  clearTimeout(toast.t); toast.t=setTimeout(()=>{el.hidden=true},2400);
}
function setSync(text, ok=true){
  const el=$('#syncState'); if(!el)return; el.textContent=(ok?'● ':'● ')+text; el.classList.toggle('bad',!ok);
}

function moscowParts(iso){
  if(!iso) return null;
  const d=new Date(iso); if(Number.isNaN(d.getTime()))return null;
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:MOSCOW_TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d);
  return Object.fromEntries(p.map(x=>[x.type,x.value]));
}
function fmt(iso){
  const p=moscowParts(iso); if(!p)return iso||'—';
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}
function shortFmt(iso){
  const p=moscowParts(iso); if(!p)return '—';
  return `${p.day}.${p.month} · ${p.hour}:${p.minute}`;
}
function dateKey(iso){
  const p=moscowParts(iso); return p?`${p.year}-${p.month}-${p.day}`:'';
}
function todayKey(){return dateKey(new Date().toISOString())}
function monthKey(iso){const k=dateKey(iso);return k?k.slice(0,7):''}
function toDateInput(iso){
  const p=moscowParts(iso); return p?`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`:'';
}
function inputToDisplay(v){
  if(!v)return '';
  const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return m?`${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`:v;
}
function displayToInput(v){
  const m=String(v||'').match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  return m?`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`:'';
}
function nowInput(offsetDays=0, hour=null, minute=0){
  const base=new Date(Date.now()+offsetDays*86400000);
  const p=moscowParts(base.toISOString());
  const hh=hour===null?p.hour:pad2(hour);
  return `${p.year}-${p.month}-${p.day}T${hh}:${pad2(minute)}`;
}
function contactHtml(v){
  const c=String(v||'').trim(); if(!c)return '—';
  if(c.startsWith('@'))return `<a class="contact-link" href="https://t.me/${encodeURIComponent(c.slice(1))}" target="_blank" rel="noopener">${esc(c)}</a>`;
  if(/^\+7\d{10}$/.test(c))return `<a class="contact-link" href="tel:${c}">${esc(c)}</a>`;
  return esc(c);
}
function statusClass(s){
  return ({'Новая':'s-new','Связались':'s-contacted','Пробный':'s-trial','Пробный проведён':'s-trial','Записан':'s-trial','Оплатил':'s-paid','Не отвечает':'s-lost','Отказ':'s-lost','Отложено':'s-trial','Не подходит':'s-lost'}[s]||'');
}
function empty(text='Пока пусто'){return `<div class="empty-mini">${esc(text)}</div>`}

async function api(action, payload={}, useAuth=true){
  const headers={'Content-Type':'application/json','Accept':'application/json'};
  if(useAuth && token) headers['X-Kotomatika-Session']=token;
  setSync('Синхронизация…');
  let r;
  try{
    r=await fetch(API_URL,{method:'POST',mode:'cors',cache:'no-store',headers,body:JSON.stringify({action,...payload})});
  }catch(e){ setSync('Нет связи',false); throw new Error('Не удалось связаться с API'); }
  const d=await r.json().catch(()=>({}));
  if(r.status===401 && useAuth){
    token=''; sessionStorage.removeItem(SESSION_KEY); document.body.classList.remove('is-authenticated');
    $('#authOverlay').style.display='grid';
  }
  if(!r.ok || !d.ok){ setSync('Ошибка',false); throw new Error(d.error||`Ошибка API: ${r.status}`); }
  setSync('Данные сохранены');
  return d;
}

async function bootstrap(){
  const d=await api('bootstrap');
  ['leads','events','students','payments','tasks','lessons','teachers','authLog'].forEach(k=>STATE[k]=Array.isArray(d[k])?d[k]:[]);
  STATE.features=d.features||{}; STATE.session=d.session||{};
  renderAll();
  const p=moscowParts(new Date().toISOString());
  if($('#refreshTime')&&p) $('#refreshTime').textContent=`обновлено ${p.hour}:${p.minute}`;
  if(p) setSync(`Обновлено ${p.hour}:${p.minute}`);
}

function showPage(name){
  $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${name}`));
  $$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  location.hash=name;
  if(name==='calendar')renderCrmCalendar();
}
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
$$('[data-jump]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.jump)));

function renderAll(){
  renderToday(); renderLeads(); renderStudents(); renderTeachers(); renderFinance(); renderStats(); renderSettings(); renderCrmCalendar();
  populateStudentSelects();
}

async function refreshData(){
  const btn=$('#refreshData');
  const leadWasOpen=$('#drawer')?.classList.contains('open');
  const studentWasOpen=$('#studentDrawer')?.classList.contains('open');
  const leadId=currentLead?.id||'';
  const studentId=currentStudent?.id||'';

  if(btn){btn.disabled=true;btn.classList.add('loading');}
  try{
    await bootstrap();

    if(leadWasOpen && leadId){
      const exists=STATE.leads.some(l=>String(l.id)===String(leadId));
      if(exists) openLead(leadId);
      else {$('#drawer').classList.remove('open');currentLead=null;}
    }

    if(studentWasOpen && studentId){
      const exists=STATE.students.some(s=>String(s.id)===String(studentId));
      if(exists) openStudent(studentId);
      else {$('#studentDrawer').classList.remove('open');currentStudent=null;}
    }

    toast('Данные обновлены. Новые заявки загружены.');
  }catch(e){
    showError(e.message);
  }finally{
    if(btn){btn.disabled=false;btn.classList.remove('loading');}
  }
}
$('#refreshData').addEventListener('click',refreshData);


function renderToday(){
  const now=Date.now(), today=todayKey(), in7=now+7*86400000;
  const newToday=STATE.leads.filter(l=>l.status==='Новая'&&dateKey(l.created_at)===today);
  const stale=STATE.leads.filter(l=>l.status==='Новая'&&new Date(l.created_at).getTime()<now-24*3600000);
  const trials=STATE.leads.filter(l=>l.trial_at&&dateKey(l.trial_at)===today).sort((a,b)=>new Date(a.trial_at)-new Date(b.trial_at));
  const overdue=STATE.tasks.filter(t=>!t.done&&new Date(t.due_at).getTime()<now).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));
  const payAttention=STATE.students.filter(s=>s.status==='Активен'&&s.next_payment_at&&new Date(s.next_payment_at).getTime()<=in7).sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at));
  $('#t-new').textContent=newToday.length; $('#t-trials').textContent=trials.length; $('#t-tasks').textContent=overdue.length; $('#t-payments').textContent=payAttention.length;
  const urgent=stale.length+overdue.length+payAttention.filter(s=>new Date(s.next_payment_at).getTime()<now).length;
  const nav=$('#navUrgent'); nav.textContent=urgent; nav.hidden=!urgent;
  $('#todayDate').textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:MOSCOW_TZ,weekday:'long',day:'numeric',month:'long'}).format(new Date());

  $('#todayLeads').innerHTML=(stale.length?stale:STATE.leads.filter(l=>l.status==='Новая')).slice(0,6).map(l=>compactItem(
    l.student_name||l.parent_name||'Заявка', `${fmt(l.created_at)} · ${l.contact||'нет контакта'}`, 'Открыть', `data-open-lead="${esc(l.id)}"`, stale.includes(l)?'danger':''
  )).join('')||empty('Новых заявок нет');
  $('#todayTrials').innerHTML=(trials.length?trials:STATE.leads.filter(l=>l.trial_at&&new Date(l.trial_at)>new Date()).sort((a,b)=>new Date(a.trial_at)-new Date(b.trial_at)).slice(0,6)).map(l=>compactItem(
    l.student_name||l.parent_name||'Пробный', `${fmt(l.trial_at)} · ${l.teacher_id||'не назначен'}`, 'Открыть', `data-open-lead="${esc(l.id)}"`, 'orange'
  )).join('')||empty('Пробных пока нет');
  $('#todayTasks').innerHTML=STATE.tasks.filter(t=>!t.done).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at)).slice(0,7).map(t=>taskItem(t)).join('')||empty('Задач нет');
  $('#todayPayments').innerHTML=payAttention.slice(0,7).map(s=>compactItem(
    s.student_name||'Ученик', `${fmt(s.next_payment_at)} · ${rub(s.monthly_price_rub)}`, 'Открыть', `data-open-student="${esc(s.id)}"`, new Date(s.next_payment_at)<new Date()?'danger':'green'
  )).join('')||empty('Оплаты в порядке');
}

function compactItem(title, meta, action, attr, tone=''){
  const button=action?`<button ${attr||''}>${esc(action)}</button>`:'';
  return `<div class="compact-item ${tone}"><div><b>${esc(title)}</b><small>${esc(meta)}</small></div>${button}</div>`;
}
function taskItem(t){
  const overdue=!t.done&&new Date(t.due_at)<new Date();
  return `<div class="compact-item ${overdue?'danger':''}"><label class="task-check"><input type="checkbox" data-task-toggle="${esc(t.id)}" ${t.done?'checked':''}><span><b>${esc(t.title)}</b><small>${fmt(t.due_at)}</small></span></label>${t.lead_id?`<button data-open-lead="${esc(t.lead_id)}">Заявка</button>`:''}</div>`;
}

function renderLeads(){
  const count=a=>STATE.leads.filter(l=>a.includes(l.status)).length;
  $('#m-new').textContent=count(['Новая']); $('#m-contacted').textContent=count(['Связались']); $('#m-trial').textContent=count(['Пробный','Пробный проведён','Записан']); $('#m-paid').textContent=count(['Оплатил']);
  const q=($('#search').value||'').toLowerCase(); const s=$('#status').value; const teacher=$('#teacherFilter').value;
  const arr=STATE.leads.filter(l=>(!q||[l.parent_name,l.student_name,l.contact,l.goal,l.grade,l.teacher_id,l.source].join(' ').toLowerCase().includes(q))&&(!s||l.status===s)&&(!teacher||l.teacher_id===teacher));
  $('#rows').innerHTML=arr.map(l=>{
    const p=moscowParts(l.created_at); return `<tr data-open-lead="${esc(l.id)}"><td><div class="name">${p?`${p.hour}:${p.minute}`:'—'}</div><div class="sub">${p?`${p.day}.${p.month}.${p.year}`:'—'}</div></td><td><div class="name">${esc(l.parent_name||'—')}</div><div class="sub">${esc(l.student_name||'—')} · ${esc(l.grade??'—')} класс</div></td><td>${esc(l.goal||'—')}</td><td>${contactHtml(l.contact)}</td><td>${esc(l.teacher_id||'Не назначен')}</td><td><span class="status ${statusClass(l.status)}"><i class="dot"></i>${esc(l.status||'Новая')}</span></td></tr>`;
  }).join('')||`<tr><td colspan="6">${empty('Ничего не найдено')}</td></tr>`;
}
['#search','#status','#teacherFilter'].forEach(id=>$(id).addEventListener('input',renderLeads));

function leadHistory(leadId){return STATE.events.filter(e=>String(e.lead_id)===String(leadId)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));}
function openLead(id){
  currentLead=STATE.leads.find(l=>String(l.id)===String(id)); if(!currentLead)return;
  $('#leadTitle').textContent=`${currentLead.parent_name||'—'} · ${currentLead.student_name||'—'}`;
  $('#leadMeta').textContent=`${currentLead.grade??'—'} класс · ${fmt(currentLead.created_at)} · ${currentLead.source||'Сайт'}`;
  $('#details').innerHTML=`<div class="kv"><b>Цель</b><span>${esc(currentLead.goal||'—')}</span></div><div class="kv"><b>Контакт</b><span>${contactHtml(currentLead.contact)}</span></div><div class="kv"><b>Комментарий</b><span>${esc(currentLead.client_comment||'—')}</span></div><div class="kv"><b>Источник</b><span>${esc(currentLead.source||'—')}</span></div>`;
  ensureOption($('#leadStatus'),currentLead.status||'Новая'); $('#leadStatus').value=currentLead.status||'Новая'; $('#teacher').value=currentLead.teacher_id||'Не назначен'; $('#trial').value=currentLead.trial_at?fmt(currentLead.trial_at):''; $('#note').value=currentLead.manager_note||'';
  closeTrialPicker(); renderLeadTasks();
  const h=leadHistory(id); $('#history').innerHTML=h.map(e=>`<li><small>${fmt(e.created_at)}</small><b>${esc(e.title||e.event_type||'Изменение')}</b>${e.details?`<span>${esc(e.details)}</span>`:''}</li>`).join('')||`<li><small>${fmt(currentLead.created_at)}</small><b>Заявка создана</b></li>`;
  $('#drawer').classList.add('open');
}
function renderLeadTasks(){
  if(!currentLead)return; const arr=STATE.tasks.filter(t=>String(t.lead_id||'')===String(currentLead.id)).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));
  $('#leadTasks').innerHTML=arr.map(taskItem).join('')||empty('Задач по заявке нет');
}
function ensureOption(select,value){if(value&&![...select.options].some(o=>o.value===value)){const o=document.createElement('option');o.value=value;o.textContent=value;select.appendChild(o)}}
$('#close').addEventListener('click',()=>$('#drawer').classList.remove('open')); $('#drawer .shade').addEventListener('click',()=>$('#drawer').classList.remove('open'));
$$('[data-q]').forEach(b=>b.addEventListener('click',()=>{$('#leadStatus').value=b.dataset.q;}));
$('#save').addEventListener('click',async()=>{
  if(!currentLead)return; const btn=$('#save'); btn.disabled=true; btn.textContent='Сохраняем…';
  try{await api('updateLead',{id:currentLead.id,status:$('#leadStatus').value,teacher:$('#teacher').value,trial:$('#trial').value,note:$('#note').value}); await bootstrap(); currentLead=STATE.leads.find(l=>String(l.id)===String(currentLead.id)); openLead(currentLead.id); toast('Заявка сохранена');}
  catch(e){showError(e.message)} finally{btn.disabled=false;btn.textContent='Сохранить изменения'}
});
$('#convertStudent').addEventListener('click',async()=>{
  if(!currentLead)return; try{await api('convertLeadToStudent',{id:currentLead.id}); await bootstrap(); const s=STATE.students.find(s=>String(s.source_lead_id)===String(currentLead.id)); if(s){$('#drawer').classList.remove('open');openStudent(s.id)} toast('Карточка ученика готова');}catch(e){showError(e.message)}
});

$('#deleteLead').addEventListener('click',async()=>{
  if(!currentLead)return;

  const leadId=currentLead.id;
  const label=currentLead.student_name||currentLead.parent_name||'эту заявку';
  const linkedStudent=STATE.students.find(s=>String(s.source_lead_id||'')===String(leadId));

  const warning=linkedStudent
    ? `Удалить заявку «${label}»?\n\nКарточка ученика уже существует и ОСТАНЕТСЯ в разделе «Ученики». Сама заявка, её задачи и история будут удалены.`
    : `Удалить заявку «${label}»?\n\nЗаявка, её задачи и история будут удалены без возможности восстановления.`;

  if(!window.confirm(warning))return;

  const btn=$('#deleteLead');
  btn.disabled=true;
  btn.textContent='Удаляем…';

  try{
    await api('deleteLead',{id:leadId});
    $('#drawer').classList.remove('open');
    currentLead=null;
    await bootstrap();
    toast('Заявка удалена');
  }catch(e){
    showError(e.message);
  }finally{
    btn.disabled=false;
    btn.textContent='Удалить заявку';
  }
});
$('#newLeadTask').addEventListener('click',()=>openTaskModal({leadId:currentLead?.id||''}));

// ---------- тёмный мини-календарь пробного ----------
const trialInput=$('#trial'), trialPicker=$('#trialPicker'), calTitle=$('#calTitle'), calDays=$('#calDays'), calTime=$('#calTime');
let calView={year:0,month:0}, calSelected=null;
function moscowTodayParts(){const p=moscowParts(new Date().toISOString());return {year:+p.year,month:+p.month-1,day:+p.day}}
function parseTrialValue(v){const m=String(v||'').match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);return m?{year:+m[3],month:+m[2]-1,day:+m[1],hour:+m[4],minute:+m[5]}:null}
function formatTrial(v){return v?`${pad2(v.day)}.${pad2(v.month+1)}.${v.year} ${pad2(v.hour)}:${pad2(v.minute)}`:''}
function monthTitle(y,m){return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(y,m,1)).replace(/\s?г\.?$/,'').replace(/^./,c=>c.toUpperCase())}
function sameDay(a,b){return a&&b&&a.year===b.year&&a.month===b.month&&a.day===b.day}
function renderMiniCalendar(){
  calTitle.textContent=monthTitle(calView.year,calView.month);calDays.innerHTML='';const today=moscowTodayParts();const first=new Date(calView.year,calView.month,1);const start=(first.getDay()+6)%7;const dim=new Date(calView.year,calView.month+1,0).getDate();const prev=new Date(calView.year,calView.month,0).getDate();
  for(let i=0;i<42;i++){let y=calView.year,m=calView.month,d;const b=document.createElement('button');b.type='button';b.className='cal-day';if(i<start){d=prev-start+i+1;m--;if(m<0){m=11;y--}b.classList.add('outside')}else if(i>=start+dim){d=i-(start+dim)+1;m++;if(m>11){m=0;y++}b.classList.add('outside')}else d=i-start+1;const date={year:y,month:m,day:d};b.textContent=d;if(sameDay(date,today))b.classList.add('today');if(sameDay(date,calSelected))b.classList.add('selected');b.onclick=()=>{const [hh,mm]=(calTime.value||'18:00').split(':').map(Number);calSelected={...date,hour:hh||0,minute:mm||0};if(m!==calView.month||y!==calView.year)calView={year:y,month:m};renderMiniCalendar()};calDays.appendChild(b)}
}
function openTrialPicker(){const p=parseTrialValue(trialInput.value),t=moscowTodayParts();calSelected=p||{...t,hour:18,minute:0};calView={year:calSelected.year,month:calSelected.month};calTime.value=`${pad2(calSelected.hour||18)}:${pad2(calSelected.minute||0)}`;renderMiniCalendar();trialPicker.hidden=false;trialInput.setAttribute('aria-expanded','true')}
function closeTrialPicker(){trialPicker.hidden=true;trialInput?.setAttribute('aria-expanded','false')}
trialInput.addEventListener('click',openTrialPicker);$('#trialCalendarBtn').addEventListener('click',openTrialPicker);$('#calPrev').onclick=()=>{const d=new Date(calView.year,calView.month-1,1);calView={year:d.getFullYear(),month:d.getMonth()};renderMiniCalendar()};$('#calNext').onclick=()=>{const d=new Date(calView.year,calView.month+1,1);calView={year:d.getFullYear(),month:d.getMonth()};renderMiniCalendar()};
function quickCal(offset){const t=moscowTodayParts(),d=new Date(t.year,t.month,t.day+offset),[hh,mm]=(calTime.value||'18:00').split(':').map(Number);calSelected={year:d.getFullYear(),month:d.getMonth(),day:d.getDate(),hour:hh||0,minute:mm||0};calView={year:calSelected.year,month:calSelected.month};renderMiniCalendar()}
$('#calToday').onclick=()=>quickCal(0);$('#calTomorrow').onclick=()=>quickCal(1);$('#calClear').onclick=()=>{trialInput.value='';calSelected=null;closeTrialPicker()};$('#calApply').onclick=()=>{if(!calSelected)return;const [hh,mm]=(calTime.value||'18:00').split(':').map(Number);calSelected.hour=hh||0;calSelected.minute=mm||0;trialInput.value=formatTrial(calSelected);closeTrialPicker()};

// ---------- Ученики ----------
function renderStudents(){
  const q=($('#studentSearch').value||'').toLowerCase(), s=$('#studentStatusFilter').value, t=$('#studentTeacherFilter').value;
  const arr=STATE.students.filter(x=>(!q||[x.student_name,x.parent_name,x.contact,x.program,x.tariff].join(' ').toLowerCase().includes(q))&&(!s||x.status===s)&&(!t||x.teacher_id===t));
  $('#studentRows').innerHTML=arr.map(x=>`<tr data-open-student="${esc(x.id)}"><td><div class="name">${esc(x.student_name||'—')}</div><div class="sub">${esc(x.parent_name||'—')} · ${esc(x.contact||'')}</div></td><td>${esc(x.grade||'—')}</td><td>${esc(x.program||'—')}</td><td>${esc(x.teacher_id||'—')}</td><td>${esc(x.tariff||'—')}<div class="sub">${rub(x.monthly_price_rub)}</div></td><td class="${x.next_payment_at&&new Date(x.next_payment_at)<new Date()?'late-text':''}">${fmt(x.next_payment_at)}</td><td><span class="student-state">${esc(x.status||'Активен')}</span></td></tr>`).join('')||`<tr><td colspan="7">${empty('Учеников пока нет')}</td></tr>`;
}
['#studentSearch','#studentStatusFilter','#studentTeacherFilter'].forEach(id=>$(id).addEventListener('input',renderStudents));
function resetStudentForm(){currentStudent=null;$('#studentDrawerTitle').textContent='Новый ученик';$('#studentDrawerMeta').textContent='';['#sStudentName','#sParentName','#sGrade','#sContact','#sProgram','#sTeacher','#sTariff','#sPrice','#sNextPayment','#sNotes'].forEach(id=>$(id).value='');$('#sStatus').value='Активен';$('#studentPayments').innerHTML=empty();$('#studentLessons').innerHTML=empty();$('#studentDangerZone').hidden=true}
function openStudent(id=null){
  if(!id){resetStudentForm();$('#studentDrawer').classList.add('open');return}
  currentStudent=STATE.students.find(s=>String(s.id)===String(id));if(!currentStudent)return;
  $('#studentDangerZone').hidden=false;
  $('#studentDrawerTitle').textContent=currentStudent.student_name||'Ученик';$('#studentDrawerMeta').textContent=`${currentStudent.grade||'—'} класс · ${currentStudent.teacher_id||'не назначен'}`;
  $('#sStudentName').value=currentStudent.student_name||'';$('#sParentName').value=currentStudent.parent_name||'';$('#sGrade').value=currentStudent.grade||'';$('#sContact').value=currentStudent.contact||'';$('#sProgram').value=currentStudent.program||'';$('#sTeacher').value=currentStudent.teacher_id||'';$('#sStatus').value=currentStudent.status||'Активен';$('#sTariff').value=currentStudent.tariff||'';$('#sPrice').value=currentStudent.monthly_price_rub||0;$('#sNextPayment').value=toDateInput(currentStudent.next_payment_at);$('#sNotes').value=currentStudent.notes||'';
  const pays=STATE.payments.filter(p=>String(p.student_id)===String(id)).sort((a,b)=>new Date(b.payment_at)-new Date(a.payment_at));$('#studentPayments').innerHTML=pays.map(p=>compactItem(rub(p.amount_rub),`${fmt(p.payment_at)} · ${p.method||'Оплата'}`,'','')).join('')||empty('Оплат ещё нет');
  const lessons=STATE.lessons.filter(l=>String(l.student_id)===String(id)).sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at));$('#studentLessons').innerHTML=lessons.slice(0,20).map(l=>compactItem(`${l.lesson_type||'Занятие'} · ${l.teacher_id||'—'}`,`${fmt(l.starts_at)} · ${l.status||'Запланировано'}`,l.status==='Запланировано'?'Проведено':'',l.status==='Запланировано'?`data-lesson-done="${esc(l.id)}"`:'' )).join('')||empty('Занятий пока нет');
  $('#studentDrawer').classList.add('open');
}
$('#newStudentBtn').onclick=()=>openStudent();$('#studentClose').onclick=()=>$('#studentDrawer').classList.remove('open');$('#studentDrawer .shade').onclick=()=>$('#studentDrawer').classList.remove('open');
$('#saveStudent').onclick=async()=>{
  const payload={studentName:$('#sStudentName').value,parentName:$('#sParentName').value,grade:$('#sGrade').value,contact:$('#sContact').value,program:$('#sProgram').value,teacher:$('#sTeacher').value,status:$('#sStatus').value,tariff:$('#sTariff').value,monthlyPriceRub:$('#sPrice').value,nextPaymentAt:inputToDisplay($('#sNextPayment').value),notes:$('#sNotes').value};
  try{if(currentStudent)await api('updateStudent',{id:currentStudent.id,...payload});else await api('createStudent',payload);await bootstrap(); if(currentStudent){currentStudent=STATE.students.find(s=>String(s.id)===String(currentStudent.id));openStudent(currentStudent.id)}else $('#studentDrawer').classList.remove('open');toast('Ученик сохранён')}catch(e){showError(e.message)}
};
$('#deleteStudent').addEventListener('click',async()=>{
  if(!currentStudent)return;

  const studentId=currentStudent.id;
  const label=currentStudent.student_name||'этого ученика';
  const paymentCount=STATE.payments.filter(p=>String(p.student_id)===String(studentId)).length;
  const lessonCount=STATE.lessons.filter(l=>String(l.student_id)===String(studentId)).length;

  const warning=`Удалить ученика «${label}»?\n\nТакже будут удалены ${paymentCount} оплат(ы), ${lessonCount} занятий(я) и задачи ученика. Исходная заявка, если она есть, останется. Это действие необратимо.`;
  if(!window.confirm(warning))return;

  const btn=$('#deleteStudent');
  btn.disabled=true;
  btn.textContent='Удаляем…';

  try{
    await api('deleteStudent',{id:studentId});
    $('#studentDrawer').classList.remove('open');
    currentStudent=null;
    await bootstrap();
    toast('Ученик удалён');
  }catch(e){
    showError(e.message);
  }finally{
    btn.disabled=false;
    btn.textContent='Удалить ученика';
  }
});
$('#studentAddPayment').onclick=()=>{if(!currentStudent)return;openPaymentModal(currentStudent.id)};$('#studentAddLesson').onclick=()=>{if(!currentStudent)return;openLessonModal(currentStudent.id,currentStudent.teacher_id)};

// ---------- Преподаватели ----------
function teacherData(name){
  const students=STATE.students.filter(s=>s.status==='Активен'&&s.teacher_id===name);const upcomingTrials=STATE.leads.filter(l=>l.teacher_id===name&&l.trial_at&&new Date(l.trial_at)>new Date());const upcomingLessons=STATE.lessons.filter(l=>l.teacher_id===name&&l.starts_at&&new Date(l.starts_at)>new Date()&&l.status!=='Отменено');const row=STATE.teachers.find(t=>t.name===name)||{};return {students,upcomingTrials,upcomingLessons,row};
}
function renderTeachers(){
  $('#teachersGrid').innerHTML=TEACHERS.map(name=>{const d=teacherData(name),cap=Number(d.row.weekly_capacity||20),load=Math.min(100,Math.round(d.students.length/Math.max(1,cap)*100));return `<article class="teacher-card"><div class="teacher-avatar">${esc(name[0])}</div><div class="teacher-card-head"><div><em>Преподаватель</em><h3>${esc(name)}</h3></div><span>${d.row.active===false?'Пауза':'Активен'}</span></div><div class="teacher-numbers"><div><b>${d.students.length}</b><small>учеников</small></div><div><b>${d.upcomingTrials.length}</b><small>пробных</small></div><div><b>${d.upcomingLessons.length}</b><small>занятий впереди</small></div></div><div class="capacity"><div><span>Нагрузка</span><b>${d.students.length} / ${cap}</b></div><div class="capacity-track"><i style="width:${load}%"></i></div></div></article>`}).join('');
}

// ---------- Финансы ----------
function renderFinance(){
  const mk=monthKey(new Date().toISOString()), now=Date.now();const pays=STATE.payments.filter(p=>monthKey(p.payment_at)===mk);const month=pays.reduce((a,p)=>a+Number(p.amount_rub||0),0);const active=STATE.students.filter(s=>s.status==='Активен');const plan=active.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);const overdue=active.filter(s=>s.next_payment_at&&new Date(s.next_payment_at).getTime()<now);const overSum=overdue.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);$('#f-month').textContent=rub(month);$('#f-plan').textContent=rub(plan);$('#f-overdue').textContent=rub(overSum);$('#f-count').textContent=pays.length;
  const due=active.filter(s=>s.next_payment_at).sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at));$('#duePayments').innerHTML=due.slice(0,12).map(s=>compactItem(s.student_name||'Ученик',`${fmt(s.next_payment_at)} · ${rub(s.monthly_price_rub)}`,'Оплата',`data-payment-for="${esc(s.id)}"`,new Date(s.next_payment_at)<new Date()?'danger':'green')).join('')||empty('Дат оплаты нет');
  const sorted=[...STATE.payments].sort((a,b)=>new Date(b.payment_at)-new Date(a.payment_at));$('#paymentList').innerHTML=sorted.slice(0,15).map(p=>{const s=STATE.students.find(x=>String(x.id)===String(p.student_id));return compactItem(rub(p.amount_rub),`${fmt(p.payment_at)} · ${s?.student_name||'Ученик'} · ${p.method||''}`,'Открыть',s?`data-open-student="${esc(s.id)}"`:'')}).join('')||empty('Оплат ещё нет');
}

// ---------- CRM календарь ----------
function crmMonthTitle(y,m){return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(y,m,1)).replace(/\s?г\.?$/,'').replace(/^./,c=>c.toUpperCase())}
function allCalendarEvents(){
  const trials=STATE.leads.filter(l=>l.trial_at).map(l=>({kind:'trial',at:l.trial_at,title:`Пробный · ${l.student_name||l.parent_name||'Ученик'}`,teacher:l.teacher_id||'Не назначен',leadId:l.id,status:l.status}));
  const lessons=STATE.lessons.map(l=>{const s=STATE.students.find(x=>String(x.id)===String(l.student_id));return {kind:'lesson',at:l.starts_at,title:`${l.lesson_type||'Занятие'} · ${s?.student_name||'Ученик'}`,teacher:l.teacher_id||s?.teacher_id||'Не назначен',studentId:l.student_id,lessonId:l.id,status:l.status}});
  return [...trials,...lessons].filter(e=>e.at).sort((a,b)=>new Date(a.at)-new Date(b.at));
}
function renderCrmCalendar(){
  if(!crmCalView){const p=moscowParts(new Date().toISOString());crmCalView={year:+p.year,month:+p.month-1};selectedAgendaKey=todayKey()}
  $('#crmCalTitle').textContent=crmMonthTitle(crmCalView.year,crmCalView.month);const grid=$('#crmCalendarGrid');grid.innerHTML='';const first=new Date(crmCalView.year,crmCalView.month,1),start=(first.getDay()+6)%7,dim=new Date(crmCalView.year,crmCalView.month+1,0).getDate(),prev=new Date(crmCalView.year,crmCalView.month,0).getDate(),events=allCalendarEvents();
  for(let i=0;i<42;i++){let y=crmCalView.year,m=crmCalView.month,d,out=false;if(i<start){d=prev-start+i+1;m--;if(m<0){m=11;y--}out=true}else if(i>=start+dim){d=i-(start+dim)+1;m++;if(m>11){m=0;y++}out=true}else d=i-start+1;const key=`${y}-${pad2(m+1)}-${pad2(d)}`,ev=events.filter(e=>dateKey(e.at)===key);const b=document.createElement('button');b.type='button';b.className=`crm-day ${out?'outside':''} ${key===todayKey()?'today':''} ${key===selectedAgendaKey?'selected':''}`;b.innerHTML=`<b>${d}</b><div class="event-dots">${ev.slice(0,4).map(e=>`<i class="${e.kind}"></i>`).join('')}</div>${ev.length?`<small>${ev.length}</small>`:''}`;b.onclick=()=>{selectedAgendaKey=key;renderCrmCalendar();renderAgenda()};grid.appendChild(b)}renderAgenda();
}
function renderAgenda(){
  const events=allCalendarEvents().filter(e=>dateKey(e.at)===selectedAgendaKey);const [y,m,d]=selectedAgendaKey.split('-');$('#agendaTitle').textContent=`${d}.${m}.${y}`;$('#dayAgenda').innerHTML=events.map(e=>`<div class="agenda-item ${e.kind}"><div><b>${moscowParts(e.at)?.hour}:${moscowParts(e.at)?.minute} · ${esc(e.title)}</b><small>${esc(e.teacher)} · ${esc(e.status||'')}</small></div>${e.leadId?`<button data-open-lead="${esc(e.leadId)}">Заявка</button>`:`<button data-open-student="${esc(e.studentId)}">Ученик</button>`}</div>`).join('')||empty('На этот день событий нет');
}
$('#crmCalPrev').onclick=()=>{const d=new Date(crmCalView.year,crmCalView.month-1,1);crmCalView={year:d.getFullYear(),month:d.getMonth()};renderCrmCalendar()};$('#crmCalNext').onclick=()=>{const d=new Date(crmCalView.year,crmCalView.month+1,1);crmCalView={year:d.getFullYear(),month:d.getMonth()};renderCrmCalendar()};$('#calendarToday').onclick=()=>{const p=moscowParts(new Date().toISOString());crmCalView={year:+p.year,month:+p.month-1};selectedAgendaKey=todayKey();renderCrmCalendar()};

// ---------- Статистика ----------
function renderStats(){
  const total=STATE.leads.length,trial=STATE.leads.filter(l=>['Пробный','Пробный проведён','Записан','Оплатил'].includes(l.status)).length,paid=STATE.leads.filter(l=>l.status==='Оплатил').length,contacted=STATE.leads.filter(l=>['Связались','Пробный','Пробный проведён','Записан','Оплатил'].includes(l.status)).length;$('#conv1').textContent=total?Math.round(trial/total*100)+'%':'0%';$('#conv2').textContent=trial?Math.round(paid/trial*100)+'%':'0%';$('#paidStudents').textContent=STATE.students.filter(s=>s.status==='Активен').length;$('#allLeadsStat').textContent=total;
  const base=Math.max(total,1);$('#bars').innerHTML=[['Все заявки',total],['Связались',contacted],['Пробный',trial],['Оплатили',paid]].map(x=>bar(x[0],x[1],Math.round(x[1]/base*100))).join('');
  const sm=new Map();STATE.leads.forEach(l=>{const s=l.source||'Не указан';sm.set(s,(sm.get(s)||0)+1)});const sources=[...sm.entries()].sort((a,b)=>b[1]-a[1]);$('#sourceBars').innerHTML=sources.length?sources.map(x=>bar(x[0],x[1],Math.round(x[1]/base*100))).join(''):empty();
  $('#teacherStats').innerHTML=TEACHERS.map(name=>{const d=teacherData(name),paidLeads=STATE.leads.filter(l=>l.teacher_id===name&&l.status==='Оплатил').length,trials=STATE.leads.filter(l=>l.teacher_id===name&&['Пробный','Пробный проведён','Оплатил','Записан'].includes(l.status)).length;return `<div class="teacher-stat-row"><b>${esc(name)}</b><span>${d.students.length} активных</span><span>${trials} пробных</span><span>${paidLeads} оплат</span></div>`}).join('');
}
function bar(label,val,pct){return `<div class="bar"><b>${esc(label)}</b><div class="track"><div class="fill" style="width:${Math.min(100,pct)}%"></div></div><strong>${val}</strong></div>`}

// ---------- Настройки ----------
function renderSettings(){
  $('#telegramState').textContent=STATE.features.telegramConfigured?'Telegram подключён. Можно отправлять сводки.':'Telegram пока не подключён: нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.';$('#sendTelegramDigest').disabled=!STATE.features.telegramConfigured;
  $('#sessionInfo').textContent=STATE.session.expiresAt?`Сессия активна до ${fmt(STATE.session.expiresAt)}.`:'Серверная сессия активна.';
  $('#authLog').innerHTML=STATE.authLog.slice(0,15).map(a=>`<div class="auth-row"><span class="${a.success?'ok':'fail'}">${a.success?'●':'●'}</span><b>${esc(a.action||'login')}</b><span>${fmt(a.created_at)}</span><small>${esc(a.ip||'—')}</small></div>`).join('')||empty('Журнал входов пуст');
  $('#teacherSettings').innerHTML=TEACHERS.map(name=>{const t=STATE.teachers.find(x=>x.name===name)||{};return `<div class="teacher-setting" data-teacher-row="${esc(t.id||name.toLowerCase())}"><b>${esc(name)}</b><label>Недельная ёмкость<input data-capacity type="number" value="${Number(t.weekly_capacity||20)}" min="0" max="100"></label><label>Telegram<input data-telegram value="${esc(t.telegram||'')}"></label><label class="inline-check"><input data-active type="checkbox" ${t.active===false?'':'checked'}> Активен</label><button data-save-teacher="${esc(t.id||name.toLowerCase())}">Сохранить</button></div>`}).join('');
}
$('#sendTelegramDigest').onclick=async()=>{try{await api('sendTelegramDigest');toast('Сводка отправлена в Telegram')}catch(e){showError(e.message)}};$('#revokeSessions').onclick=async()=>{try{await api('revokeOtherSessions');toast('Другие сессии завершены')}catch(e){showError(e.message)}};

// ---------- Модальные окна, задачи, оплаты, занятия ----------
function openModal(id){$('#modalShade').hidden=false;$(id).hidden=false}
function closeModals(){[$('#taskModal'),$('#paymentModal'),$('#lessonModal'),$('#modalShade')].forEach(x=>x.hidden=true)}
$$('[data-modal-close]').forEach(b=>b.onclick=closeModals);$('#modalShade').onclick=closeModals;
function openTaskModal(ctx={}){taskContext={leadId:ctx.leadId||'',studentId:ctx.studentId||''};$('#taskTitle').value='';$('#taskDue').value=nowInput(0,null,0);$('#taskType').value='Перезвонить';openModal('#taskModal')}
$('#newTaskToday').onclick=()=>openTaskModal();$('#taskSave').onclick=async()=>{try{await api('createTask',{title:$('#taskTitle').value,dueAt:inputToDisplay($('#taskDue').value),taskType:$('#taskType').value,...taskContext});closeModals();await bootstrap();if(currentLead)renderLeadTasks();toast('Задача создана')}catch(e){showError(e.message)}};
function populateStudentSelects(){const opts=STATE.students.filter(s=>s.status!=='Архив').map(s=>`<option value="${esc(s.id)}">${esc(s.student_name||'Ученик')} · ${esc(s.grade||'—')} класс</option>`).join('');$('#paymentStudent').innerHTML=opts;$('#lessonStudent').innerHTML=opts}
function addMonthInput(v){if(!v)return '';const d=new Date(`${v}:00+03:00`);d.setMonth(d.getMonth()+1);return toDateInput(d.toISOString())}
function openPaymentModal(studentId=''){populateStudentSelects();if(studentId)$('#paymentStudent').value=studentId;const s=STATE.students.find(x=>String(x.id)===String(studentId));$('#paymentAmount').value=s?.monthly_price_rub||'';$('#paymentAt').value=nowInput();$('#paymentNext').value=addMonthInput(nowInput());$('#paymentComment').value='';openModal('#paymentModal')}
$('#newPaymentBtn').onclick=()=>openPaymentModal();$('#paymentSave').onclick=async()=>{try{await api('createPayment',{studentId:$('#paymentStudent').value,amountRub:$('#paymentAmount').value,paymentAt:inputToDisplay($('#paymentAt').value),method:$('#paymentMethod').value,nextPaymentAt:inputToDisplay($('#paymentNext').value),comment:$('#paymentComment').value});closeModals();await bootstrap();if(currentStudent)openStudent(currentStudent.id);toast('Оплата сохранена')}catch(e){showError(e.message)}};
function openLessonModal(studentId='',teacher=''){populateStudentSelects();if(studentId)$('#lessonStudent').value=studentId;const s=STATE.students.find(x=>String(x.id)===String($('#lessonStudent').value));$('#lessonTeacher').value=teacher||s?.teacher_id||'';$('#lessonAt').value=nowInput(1,18,0);$('#lessonDuration').value=60;$('#lessonType').value='Занятие';$('#lessonComment').value='';openModal('#lessonModal')}
$('#newLessonBtn').onclick=()=>openLessonModal();$('#lessonSave').onclick=async()=>{try{await api('createLesson',{studentId:$('#lessonStudent').value,teacher:$('#lessonTeacher').value,startsAt:inputToDisplay($('#lessonAt').value),durationMin:$('#lessonDuration').value,lessonType:$('#lessonType').value,status:'Запланировано',comment:$('#lessonComment').value});closeModals();await bootstrap();toast('Занятие добавлено')}catch(e){showError(e.message)}};
$('#paymentStudent').addEventListener('change',()=>{const s=STATE.students.find(x=>String(x.id)===String($('#paymentStudent').value));if(s?.monthly_price_rub)$('#paymentAmount').value=s.monthly_price_rub});$('#lessonStudent').addEventListener('change',()=>{const s=STATE.students.find(x=>String(x.id)===String($('#lessonStudent').value));if(s?.teacher_id)$('#lessonTeacher').value=s.teacher_id});

// ---------- Делегированные действия ----------
document.addEventListener('click',async e=>{
  const lead=e.target.closest('[data-open-lead]');if(lead){e.preventDefault();openLead(lead.dataset.openLead);return}
  const student=e.target.closest('[data-open-student]');if(student){e.preventDefault();openStudent(student.dataset.openStudent);return}
  const pay=e.target.closest('[data-payment-for]');if(pay){e.preventDefault();openPaymentModal(pay.dataset.paymentFor);return}
  const teacherSave=e.target.closest('[data-save-teacher]');if(teacherSave){const row=teacherSave.closest('[data-teacher-row]');try{await api('updateTeacher',{id:teacherSave.dataset.saveTeacher,weeklyCapacity:row.querySelector('[data-capacity]').value,telegram:row.querySelector('[data-telegram]').value,active:row.querySelector('[data-active]').checked,notes:''});await bootstrap();toast('Настройки преподавателя сохранены')}catch(err){showError(err.message)}return}
  const done=e.target.closest('[data-lesson-done]');if(done){try{await api('updateLessonStatus',{id:done.dataset.lessonDone,status:'Проведено'});await bootstrap();if(currentStudent)openStudent(currentStudent.id);toast('Занятие отмечено проведённым')}catch(err){showError(err.message)}return}
});
document.addEventListener('change',async e=>{
  const cb=e.target.closest('[data-task-toggle]');if(cb){try{await api('toggleTask',{id:cb.dataset.taskToggle,done:cb.checked});await bootstrap();if(currentLead)renderLeadTasks()}catch(err){cb.checked=!cb.checked;showError(err.message)}}
});

// ---------- Авторизация ----------
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault();const err=$('#authError');err.hidden=true;try{const d=await api('login',{username:$('#authUser').value.trim(),password:$('#authPassword').value},false);token=d.token;sessionStorage.setItem(SESSION_KEY,token);$('#authPassword').value='';document.body.classList.add('is-authenticated');$('#authOverlay').style.display='none';await bootstrap();toast('Добро пожаловать')}catch(ex){err.textContent=ex.message;err.hidden=false}
});

// PWA
let promptEvt=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptEvt=e;$('#install').classList.add('show')});$('#installBtn').onclick=async()=>{if(!promptEvt)return;promptEvt.prompt();await promptEvt.userChoice;promptEvt=null;$('#install').classList.remove('show')};if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js?v=pro3').catch(()=>{}));

// Старт
(async()=>{
  const hash=location.hash.slice(1);showPage(['today','leads','calendar','students','teachers','finance','stats','settings'].includes(hash)?hash:'today');
  if(token){try{document.body.classList.add('is-authenticated');$('#authOverlay').style.display='none';await bootstrap()}catch(e){showError(e.message)}}
})();
