const API_URL = 'https://functions.yandexcloud.net/d4ebvaiffdtsos840t16';
const MOSCOW_TZ = 'Europe/Moscow';
const TEACHERS = ['Егор','Миша','Иван','Никита'];
const SESSION_KEY = 'kotomatika_crm_session_v1';

const STATE = {
  leads: [], events: [], students: [], payments: [], tasks: [], lessons: [], teachers: [], authLog: [], groups: [], groupSlots: [], groupMembers: [], groupAttendance: [],
  features: {}, session: {}, warnings: [], diagnostics: null
};
let token = sessionStorage.getItem(SESSION_KEY) || '';
let currentLead = null;
let currentStudent = null;
let currentTeacherName = '';
let currentGroup = null;
let currentGroupAttendanceAt = '';
let taskContext = {leadId:'', studentId:''};
let selectedAgendaKey = '';
let crmCalView = null;
let calendarMode = 'week';
let calendarTeacherFilter = '';
let leadViewMode = 'kanban';
let leadQuickFilter = '';
const leadSelected = new Set();
let leadDraggingId = '';

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
  const body={action,...payload};
  if(useAuth && token) body.sessionToken=token;
  setSync('Синхронизация…');
  let r;
  try{
    r=await fetch(API_URL,{method:'POST',mode:'cors',cache:'no-store',headers,body:JSON.stringify(body)});
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
  ['leads','events','students','payments','tasks','lessons','teachers','authLog','groups','groupSlots','groupMembers','groupAttendance'].forEach(k=>STATE[k]=Array.isArray(d[k])?d[k]:[]);
  STATE.features=d.features||{}; STATE.session=d.session||{}; STATE.warnings=Array.isArray(d.warnings)?d.warnings:[];
  if(d.system) STATE.system=d.system;
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
  renderToday(); renderLeads(); renderStudents(); renderGroups(); renderTeachers(); renderFinance(); renderStats(); renderSettings(); renderCrmCalendar();
  populateStudentSelects();
}

async function refreshData(){
  const btn=$('#refreshData');
  const leadWasOpen=$('#drawer')?.classList.contains('open');
  const studentWasOpen=$('#studentDrawer')?.classList.contains('open');
  const groupWasOpen=$('#groupDrawer')?.classList.contains('open');
  const leadId=currentLead?.id||'';
  const studentId=currentStudent?.id||'';
  const groupId=currentGroup?.id||'';

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

    if(groupWasOpen && groupId){
      const exists=STATE.groups.some(g=>String(g.id)===String(groupId));
      if(exists) openGroup(groupId);
      else {$('#groupDrawer').classList.remove('open');currentGroup=null;}
    }

    toast('Данные обновлены. Новые заявки загружены.');
  }catch(e){
    showError(e.message);
  }finally{
    if(btn){btn.disabled=false;btn.classList.remove('loading');}
  }
}
$('#refreshData').addEventListener('click',refreshData);


function hoursSince(iso){
  const ms=Date.now()-new Date(iso).getTime();
  return Number.isFinite(ms)?Math.max(0,Math.floor(ms/3600000)):0;
}
function daysUntil(iso){
  const ms=new Date(iso).getTime()-Date.now();
  return Number.isFinite(ms)?Math.ceil(ms/86400000):0;
}
function timeOnly(iso){
  const p=moscowParts(iso); return p?`${p.hour}:${p.minute}`:'—';
}
function todayPriorityItem({tone='orange',icon='!',title,meta,button='',attr=''}) {
  return `<div class="priority-item ${tone}">
    <span class="priority-icon">${esc(icon)}</span>
    <div><b>${esc(title)}</b><small>${esc(meta)}</small></div>
    ${button?`<button ${attr}>${esc(button)}</button>`:''}
  </div>`;
}
function timelineItem({time='—',tone='lesson',title,meta,attr=''}) {
  return `<button class="timeline-item ${tone}" ${attr}>
    <span class="timeline-time">${esc(time)}</span>
    <i></i>
    <span class="timeline-copy"><b>${esc(title)}</b><small>${esc(meta)}</small></span>
  </button>`;
}

function renderToday(){
  const now=Date.now(), today=todayKey(), in7=now+7*86400000;

  const newToday=STATE.leads
    .filter(l=>l.status==='Новая'&&dateKey(l.created_at)===today)
    .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

  const stale2h=STATE.leads
    .filter(l=>l.status==='Новая'&&new Date(l.created_at).getTime()<now-2*3600000)
    .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

  const stale24h=stale2h.filter(l=>new Date(l.created_at).getTime()<now-24*3600000);

  const trials=STATE.leads
    .filter(l=>l.trial_at&&dateKey(l.trial_at)===today)
    .sort((a,b)=>new Date(a.trial_at)-new Date(b.trial_at));

  const lessons=STATE.lessons
    .filter(l=>l.starts_at&&dateKey(l.starts_at)===today&&l.status!=='Отменено')
    .sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));

  const groupToday=groupSessionEventsForKeys([today]);

  const overdue=STATE.tasks
    .filter(t=>!t.done&&t.due_at&&new Date(t.due_at).getTime()<now)
    .sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));

  const todayTasks=STATE.tasks
    .filter(t=>!t.done&&t.due_at&&dateKey(t.due_at)===today)
    .sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));

  const overduePayments=STATE.students
    .filter(s=>s.status==='Активен'&&s.next_payment_at&&new Date(s.next_payment_at).getTime()<now)
    .sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at));

  const payAttention=STATE.students
    .filter(s=>s.status==='Активен'&&s.next_payment_at&&new Date(s.next_payment_at).getTime()<=in7)
    .sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at));

  const noTeacherTrials=trials.filter(l=>!l.teacher_id||l.teacher_id==='Не назначен');

  $('#t-new').textContent=newToday.length;
  $('#t-stale').textContent=stale2h.length;
  $('#t-trials').textContent=trials.length;
  $('#t-lessons').textContent=lessons.length+groupToday.length;
  $('#t-tasks').textContent=overdue.length;
  $('#t-payments').textContent=overduePayments.length;

  const urgent=stale2h.length+overdue.length+overduePayments.length+noTeacherTrials.length;
  $('#t-focus').textContent=urgent;
  $('#t-focusText').textContent=urgent
    ? `${stale2h.length} заявок · ${overdue.length} задач · ${overduePayments.length} оплат`
    : 'Критичных дел нет';

  const nav=$('#navUrgent'); nav.textContent=urgent; nav.hidden=!urgent;
  $('#todayDate').textContent=new Intl.DateTimeFormat('ru-RU',{
    timeZone:MOSCOW_TZ,weekday:'long',day:'numeric',month:'long',year:'numeric'
  }).format(new Date());

  const priorities=[];

  stale24h.slice(0,3).forEach(l=>priorities.push({
    score:100+hoursSince(l.created_at),
    html:todayPriorityItem({
      tone:'danger',icon:'!',
      title:`${l.student_name||l.parent_name||'Заявка'} — без ответа`,
      meta:`Ждёт ${hoursSince(l.created_at)} ч. · ${l.contact||'контакт не указан'}`,
      button:'Открыть',attr:`data-open-lead="${esc(l.id)}"`
    })
  }));

  overdue.slice(0,4).forEach(t=>priorities.push({
    score:80+hoursSince(t.due_at),
    html:todayPriorityItem({
      tone:'danger',icon:'✓',
      title:t.title||'Просроченная задача',
      meta:`Просрочено · ${fmt(t.due_at)}`,
      button:t.lead_id?'Заявка':(t.student_id?'Ученик':''),
      attr:t.lead_id?`data-open-lead="${esc(t.lead_id)}"`:(t.student_id?`data-open-student="${esc(t.student_id)}"`:'')
    })
  }));

  overduePayments.slice(0,3).forEach(s=>priorities.push({
    score:70+Math.abs(daysUntil(s.next_payment_at)),
    html:todayPriorityItem({
      tone:'money',icon:'₽',
      title:`${s.student_name||'Ученик'} — просрочена оплата`,
      meta:`${fmt(s.next_payment_at)} · ${rub(s.monthly_price_rub)}`,
      button:'Открыть',attr:`data-open-student="${esc(s.id)}"`
    })
  }));

  noTeacherTrials.slice(0,3).forEach(l=>priorities.push({
    score:65,
    html:todayPriorityItem({
      tone:'orange',icon:'◷',
      title:`${l.student_name||l.parent_name||'Пробный'} — нет преподавателя`,
      meta:`Сегодня ${timeOnly(l.trial_at)}`,
      button:'Назначить',attr:`data-open-lead="${esc(l.id)}"`
    })
  }));

  stale2h.filter(l=>!stale24h.includes(l)).slice(0,3).forEach(l=>priorities.push({
    score:50+hoursSince(l.created_at),
    html:todayPriorityItem({
      tone:'orange',icon:'↗',
      title:`${l.student_name||l.parent_name||'Заявка'} — связаться`,
      meta:`Ждёт ${hoursSince(l.created_at)} ч. · ${l.contact||'контакт не указан'}`,
      button:'Открыть',attr:`data-open-lead="${esc(l.id)}"`
    })
  }));

  priorities.sort((a,b)=>b.score-a.score);
  $('#todayPriority').innerHTML=priorities.slice(0,8).map(x=>x.html).join('')||`
    <div class="all-clear">
      <span>✓</span><div><b>Срочных дел нет</b><small>Можно работать по плану.</small></div>
    </div>`;
  $('#priorityCaption').textContent=priorities.length?`${priorities.length} приоритетов`:'Всё спокойно';

  const timeline=[];

  trials.forEach(l=>timeline.push({
    at:new Date(l.trial_at).getTime(),
    html:timelineItem({
      time:timeOnly(l.trial_at),tone:'trial',
      title:`Пробный · ${l.student_name||l.parent_name||'ученик'}`,
      meta:`${l.teacher_id||'преподаватель не назначен'} · ${l.contact||'нет контакта'}`,
      attr:`data-open-lead="${esc(l.id)}"`
    })
  }));

  groupToday.forEach(g=>timeline.push({
    at:new Date(g.at).getTime(),
    html:timelineItem({
      time:timeOnly(g.at),tone:'group',
      title:`Группа · ${g.person}`,
      meta:`${g.teacher} · ${g.memberCount}/${g.capacity} детей`,
      attr:`data-open-group="${esc(g.groupId)}"`
    })
  }));

  lessons.forEach(l=>{
    const s=STATE.students.find(x=>String(x.id)===String(l.student_id));
    timeline.push({
      at:new Date(l.starts_at).getTime(),
      html:timelineItem({
        time:timeOnly(l.starts_at),tone:'lesson',
        title:`${l.lesson_type||'Занятие'} · ${s?.student_name||'ученик'}`,
        meta:`${l.teacher_id||s?.teacher_id||'не назначен'} · ${Number(l.duration_min||60)} мин`,
        attr:s?`data-open-student="${esc(s.id)}"`:''
      })
    });
  });

  todayTasks.forEach(t=>timeline.push({
    at:new Date(t.due_at).getTime(),
    html:timelineItem({
      time:timeOnly(t.due_at),tone:new Date(t.due_at).getTime()<now?'task late':'task',
      title:t.title||'Задача',
      meta:t.task_type||'Задача CRM',
      attr:t.lead_id?`data-open-lead="${esc(t.lead_id)}"`:(t.student_id?`data-open-student="${esc(t.student_id)}"`:'')
    })
  }));

  STATE.students.filter(s=>s.status==='Активен'&&s.next_payment_at&&dateKey(s.next_payment_at)===today).forEach(s=>timeline.push({
    at:new Date(s.next_payment_at).getTime(),
    html:timelineItem({
      time:timeOnly(s.next_payment_at),tone:'payment',
      title:`Оплата · ${s.student_name||'ученик'}`,
      meta:`${rub(s.monthly_price_rub)} · ${s.tariff||'тариф не указан'}`,
      attr:`data-open-student="${esc(s.id)}"`
    })
  }));

  timeline.sort((a,b)=>a.at-b.at);
  $('#todayTimeline').innerHTML=timeline.map(x=>x.html).join('')||empty('На сегодня событий нет');

  $('#todayLeads').innerHTML=(stale2h.length?stale2h:STATE.leads.filter(l=>l.status==='Новая')).slice(0,6).map(l=>compactItem(
    l.student_name||l.parent_name||'Заявка',
    `${fmt(l.created_at)} · ${hoursSince(l.created_at)} ч. назад · ${l.contact||'нет контакта'}`,
    'Открыть',`data-open-lead="${esc(l.id)}"`,stale24h.includes(l)?'danger':(stale2h.includes(l)?'orange':'')
  )).join('')||empty('Новых заявок нет');

  $('#todayTrials').innerHTML=(trials.length?trials:STATE.leads.filter(l=>l.trial_at&&new Date(l.trial_at)>new Date()).sort((a,b)=>new Date(a.trial_at)-new Date(b.trial_at)).slice(0,6)).map(l=>compactItem(
    l.student_name||l.parent_name||'Пробный',
    `${fmt(l.trial_at)} · ${l.teacher_id||'не назначен'}`,
    'Открыть',`data-open-lead="${esc(l.id)}"`,'orange'
  )).join('')||empty('Пробных пока нет');

  $('#todayTasks').innerHTML=STATE.tasks.filter(t=>!t.done).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at)).slice(0,7).map(t=>taskItem(t)).join('')||empty('Задач нет');

  $('#todayPayments').innerHTML=payAttention.slice(0,7).map(s=>compactItem(
    s.student_name||'Ученик',
    `${fmt(s.next_payment_at)} · ${rub(s.monthly_price_rub)}`,
    'Открыть',`data-open-student="${esc(s.id)}"`,
    new Date(s.next_payment_at)<new Date()?'danger':'green'
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


function resetLeadCreateForm(){
  $('#newLeadParent').value='';
  $('#newLeadStudent').value='';
  $('#newLeadGrade').value='';
  $('#newLeadContact').value='';
  $('#newLeadGoal').value='';
  $('#newLeadSource').value='Ручная заявка';
  $('#newLeadStatus').value='Новая';
  $('#newLeadTeacher').value='Не назначен';
  $('#newLeadTrial').value='';
  $('#newLeadClientComment').value='';
  $('#newLeadManagerNote').value='';
}
function openLeadCreateModal(){
  resetLeadCreateForm();
  openModal('#leadCreateModal');
  setTimeout(()=>$('#newLeadParent').focus(),100);
}
$('#newLeadBtn').addEventListener('click',openLeadCreateModal);

$('#newLeadSave').addEventListener('click',async()=>{
  const btn=$('#newLeadSave');
  const parentName=$('#newLeadParent').value.trim();
  const studentName=$('#newLeadStudent').value.trim();
  const contact=$('#newLeadContact').value.trim();

  if(!parentName&&!studentName){toast('Укажите родителя или ученика');return}
  if(!contact){toast('Укажите контакт');return}

  btn.disabled=true;
  btn.textContent='Создаю…';
  try{
    const result=await api('createLead',{
      parentName,
      studentName,
      grade:$('#newLeadGrade').value,
      contact,
      goal:$('#newLeadGoal').value,
      source:$('#newLeadSource').value,
      status:$('#newLeadStatus').value,
      teacher:$('#newLeadTeacher').value,
      trial:inputToDisplay($('#newLeadTrial').value),
      clientComment:$('#newLeadClientComment').value,
      managerNote:$('#newLeadManagerNote').value
    });
    closeModals();
    await bootstrap();
    toast('Заявка создана');
    if(result.id)openLead(result.id);
  }catch(e){showError(e.message)}
  finally{
    btn.disabled=false;
    btn.textContent='Создать заявку';
  }
});

const LEAD_KANBAN_COLUMNS=[
  {id:'new',title:'Новые',statuses:['Новая'],dropStatus:'Новая',tone:'new'},
  {id:'contacted',title:'Связались',statuses:['Связались'],dropStatus:'Связались',tone:'contacted'},
  {id:'trial',title:'Пробный',statuses:['Пробный'],dropStatus:'Пробный',tone:'trial'},
  {id:'decision',title:'Решение',statuses:['Пробный проведён','Записан'],dropStatus:'Пробный проведён',tone:'decision'},
  {id:'paid',title:'Оплатили',statuses:['Оплатил'],dropStatus:'Оплатил',tone:'paid'},
  {id:'followup',title:'Контроль',statuses:['Не отвечает','Отложено'],dropStatus:'Отложено',tone:'followup'},
  {id:'closed',title:'Закрыты',statuses:['Отказ','Не подходит'],dropStatus:'Отказ',tone:'closed'}
];

function leadOpenTasks(l){
  return STATE.tasks
    .filter(t=>!t.done&&String(t.lead_id||'')===String(l.id))
    .sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));
}
function leadPriority(l){
  let score=0,reasons=[];
  const age=hoursSince(l.created_at);
  const tasks=leadOpenTasks(l);
  const overdueTasks=tasks.filter(t=>t.due_at&&new Date(t.due_at)<new Date());
  const noTeacher=!l.teacher_id||l.teacher_id==='Не назначен';
  const futureTrial=l.trial_at&&new Date(l.trial_at)>new Date();
  const pastTrial=l.trial_at&&new Date(l.trial_at)<new Date();

  if(l.status==='Новая'&&age>=24){score+=100;reasons.push('без ответа 24+ ч.')}
  else if(l.status==='Новая'&&age>=2){score+=65;reasons.push('без ответа 2+ ч.')}
  else if(l.status==='Новая'){score+=30;reasons.push('новая заявка')}

  if(overdueTasks.length){score+=70;reasons.push('просрочена задача')}
  if(futureTrial&&noTeacher){score+=65;reasons.push('пробный без учителя')}
  if(l.status==='Пробный'&&pastTrial){score+=60;reasons.push('пробный уже прошёл')}
  if(['Новая','Связались','Не отвечает','Отложено'].includes(l.status)&&!tasks.length){score+=25;reasons.push('нет следующей задачи')}
  if(futureTrial&&daysUntil(l.trial_at)<=1){score+=25;reasons.push('пробный скоро')}
  if(['Отказ','Не подходит','Оплатил'].includes(l.status))score=Math.max(0,score-100);

  const level=score>=90?'critical':score>=60?'high':score>=30?'medium':'low';
  return {score,level,reasons,tasks,overdueTasks};
}
function leadPriorityLabel(l){
  const p=leadPriority(l);
  if(p.level==='critical')return {label:'Срочно',className:'critical'};
  if(p.level==='high')return {label:'Высокий',className:'high'};
  if(p.level==='medium')return {label:'Средний',className:'medium'};
  return {label:'Обычный',className:'low'};
}
function leadMatchesQuick(l){
  const p=leadPriority(l);
  if(!leadQuickFilter)return true;
  if(leadQuickFilter==='attention')return p.score>=60;
  if(leadQuickFilter==='stale')return l.status==='Новая'&&hoursSince(l.created_at)>=2;
  if(leadQuickFilter==='trial7')return Boolean(l.trial_at&&daysUntil(l.trial_at)>=0&&daysUntil(l.trial_at)<=7);
  if(leadQuickFilter==='noTeacher')return Boolean(l.trial_at&&new Date(l.trial_at)>new Date()&&(!l.teacher_id||l.teacher_id==='Не назначен'));
  if(leadQuickFilter==='noTask')return ['Новая','Связались','Не отвечает','Отложено'].includes(l.status)&&!p.tasks.length;
  return true;
}
function syncLeadSourceOptions(){
  const select=$('#leadSourceFilter');if(!select)return;
  const current=select.value;
  const sources=[...new Set(STATE.leads.map(l=>l.source||'Не указан'))].sort((a,b)=>a.localeCompare(b,'ru'));
  select.innerHTML='<option value="">Все источники</option>'+sources.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if(sources.includes(current))select.value=current;
}
function filteredLeads(){
  const q=($('#search').value||'').toLowerCase();
  const s=$('#status').value;
  const teacher=$('#teacherFilter').value;
  const source=$('#leadSourceFilter').value;
  const sort=$('#leadSort').value||'priority';
  const arr=STATE.leads.filter(l=>
    (!q||[l.parent_name,l.student_name,l.contact,l.goal,l.grade,l.teacher_id,l.source,l.manager_note].join(' ').toLowerCase().includes(q))&&
    (!s||l.status===s)&&
    (!teacher||l.teacher_id===teacher)&&
    (!source||(l.source||'Не указан')===source)&&
    leadMatchesQuick(l)
  );
  arr.sort((a,b)=>{
    if(sort==='new')return new Date(b.created_at)-new Date(a.created_at);
    if(sort==='old')return new Date(a.created_at)-new Date(b.created_at);
    if(sort==='trial'){
      const at=a.trial_at?new Date(a.trial_at).getTime():Number.MAX_SAFE_INTEGER;
      const bt=b.trial_at?new Date(b.trial_at).getTime():Number.MAX_SAFE_INTEGER;
      return at-bt;
    }
    const pa=leadPriority(a).score,pb=leadPriority(b).score;
    return pb-pa||new Date(b.created_at)-new Date(a.created_at);
  });
  return arr;
}
function leadNextTaskText(l){
  const t=leadOpenTasks(l)[0];
  if(!t)return 'Нет следующей задачи';
  const late=new Date(t.due_at)<new Date();
  return `${late?'Просрочено':'Задача'} · ${shortFmt(t.due_at)} · ${t.title||'Связаться'}`;
}
function leadKanbanCard(l){
  const p=leadPriority(l),priority=leadPriorityLabel(l);
  const age=leadAgeText(l.created_at);
  return `<article class="lead-kanban-card ${priority.className}" draggable="true" data-lead-drag="${esc(l.id)}" data-open-lead="${esc(l.id)}">
    <div class="lead-card-top">
      <span class="lead-priority ${priority.className}">${esc(priority.label)}</span>
      <small>${esc(age)}</small>
    </div>
    <h4>${esc(l.student_name||l.parent_name||'Без имени')}</h4>
    <p>${esc(l.parent_name&&l.student_name?l.parent_name:(l.goal||'Заявка'))}</p>
    <div class="lead-card-meta">
      <span>${esc(l.grade?`${l.grade} класс`:'Класс —')}</span>
      <span>${esc(l.source||'Сайт')}</span>
    </div>
    ${l.trial_at?`<div class="lead-card-event ${new Date(l.trial_at)<new Date()?'past':''}">◷ ${esc(shortFmt(l.trial_at))}</div>`:''}
    <div class="lead-card-task ${p.overdueTasks.length?'late':''}">${esc(leadNextTaskText(l))}</div>
    <div class="lead-card-footer">
      <span>${esc(l.teacher_id||'Не назначен')}</span>
      <button type="button" data-open-lead="${esc(l.id)}">Открыть</button>
    </div>
  </article>`;
}
function renderLeadKanban(arr){
  $('#leadKanban').innerHTML=LEAD_KANBAN_COLUMNS.map(col=>{
    const items=arr.filter(l=>col.statuses.includes(l.status||'Новая'));
    const all=STATE.leads.filter(l=>col.statuses.includes(l.status||'Новая')).length;
    return `<section class="lead-kanban-column ${col.tone}" data-kanban-drop="${esc(col.dropStatus)}">
      <div class="lead-kanban-head">
        <div><i></i><b>${esc(col.title)}</b></div>
        <span>${items.length}${items.length!==all?` / ${all}`:''}</span>
      </div>
      <div class="lead-kanban-cards">
        ${items.map(leadKanbanCard).join('')||'<div class="lead-kanban-empty">Нет заявок</div>'}
      </div>
    </section>`;
  }).join('');
}
function renderLeadTable(arr){
  $('#rows').innerHTML=arr.map(l=>{
    const p=moscowParts(l.created_at),priority=leadPriorityLabel(l),checked=leadSelected.has(String(l.id));
    return `<tr data-open-lead="${esc(l.id)}" class="${checked?'selected-row':''}">
      <td class="lead-check-cell"><input type="checkbox" data-lead-select="${esc(l.id)}" ${checked?'checked':''} aria-label="Выбрать заявку"></td>
      <td><span class="lead-priority ${priority.className}">${esc(priority.label)}</span><div class="sub">${leadPriority(l).reasons.slice(0,1).map(esc).join('')}</div></td>
      <td><div class="name">${p?`${p.hour}:${p.minute}`:'—'}</div><div class="sub">${p?`${p.day}.${p.month}.${p.year}`:'—'}</div></td>
      <td><div class="name">${esc(l.parent_name||'—')}</div><div class="sub">${esc(l.student_name||'—')} · ${esc(l.grade??'—')} класс</div></td>
      <td>${esc(l.goal||'—')}<div class="sub">${esc(l.source||'Сайт')}</div></td>
      <td>${contactHtml(l.contact)}</td>
      <td>${esc(l.teacher_id||'Не назначен')}</td>
      <td><span class="status ${statusClass(l.status)}"><i class="dot"></i>${esc(l.status||'Новая')}</span></td>
    </tr>`;
  }).join('')||`<tr><td colspan="8">${empty('Ничего не найдено')}</td></tr>`;

  const allVisible=arr.length>0&&arr.every(l=>leadSelected.has(String(l.id)));
  $('#leadSelectAll').checked=allVisible;
  $('#leadSelectAll').indeterminate=!allVisible&&arr.some(l=>leadSelected.has(String(l.id)));
}
function renderLeadBulkBar(){
  const count=leadSelected.size;
  $('#leadBulkBar').hidden=!count;
  $('#leadSelectedCount').textContent=count;
}
function renderLeads(){
  syncLeadSourceOptions();
  const count=a=>STATE.leads.filter(l=>a.includes(l.status)).length;
  const now=Date.now();
  const stale=STATE.leads.filter(l=>l.status==='Новая'&&new Date(l.created_at).getTime()<now-2*3600000);
  const trial7=STATE.leads.filter(l=>l.trial_at&&daysUntil(l.trial_at)>=0&&daysUntil(l.trial_at)<=7);
  const noTeacher=STATE.leads.filter(l=>l.trial_at&&new Date(l.trial_at)>new Date()&&(!l.teacher_id||l.teacher_id==='Не назначен'));
  const attention=STATE.leads.filter(l=>leadPriority(l).score>=60);

  $('#m-new').textContent=count(['Новая']);
  $('#m-stale').textContent=stale.length;
  $('#m-trial-week').textContent=trial7.length;
  $('#m-no-teacher').textContent=noTeacher.length;
  $('#m-paid').textContent=count(['Оплатил']);
  $('#m-attention').textContent=attention.length;
  $('#q-attention').textContent=attention.length;
  $('#q-stale').textContent=stale.length;
  $('#q-trial').textContent=trial7.length;
  $('#q-teacher').textContent=noTeacher.length;
  $('#q-task').textContent=STATE.leads.filter(l=>['Новая','Связались','Не отвечает','Отложено'].includes(l.status)&&!leadOpenTasks(l).length).length;

  $$('.lead-quick-filters [data-lead-quick]').forEach(b=>b.classList.toggle('active',b.dataset.leadQuick===leadQuickFilter));
  $('#leadKanbanMode').classList.toggle('active',leadViewMode==='kanban');
  $('#leadTableMode').classList.toggle('active',leadViewMode==='table');
  $('#leadKanbanView').hidden=leadViewMode!=='kanban';
  $('#leadTableView').hidden=leadViewMode!=='table';

  const arr=filteredLeads();
  renderLeadKanban(arr);
  renderLeadTable(arr);
  renderLeadBulkBar();
}

function leadPayload(l,changes={}){
  return {
    id:l.id,
    status:changes.status??l.status??'Новая',
    teacher:changes.teacher??l.teacher_id??'Не назначен',
    trial:l.trial_at?fmt(l.trial_at):'',
    note:l.manager_note||''
  };
}
async function updateLeadQuick(id,changes,successText='Заявка обновлена'){
  const l=STATE.leads.find(x=>String(x.id)===String(id));if(!l)return;
  await api('updateLead',leadPayload(l,changes));
  await bootstrap();
  toast(successText);
}
async function applyBulkLeadChanges(){
  const ids=[...leadSelected];
  const status=$('#leadBulkStatus').value;
  const teacher=$('#leadBulkTeacher').value;
  if(!ids.length)return;
  if(!status&&!teacher){toast('Выберите статус или преподавателя');return}
  const btn=$('#leadBulkApply');
  btn.disabled=true;
  let done=0,failed=0;
  $('#leadBulkProgress').textContent=`0 / ${ids.length}`;
  for(const id of ids){
    const l=STATE.leads.find(x=>String(x.id)===String(id));
    if(!l)continue;
    try{
      await api('updateLead',leadPayload(l,{...(status?{status}:{}),...(teacher?{teacher}:{})}));
      done++;
    }catch(e){failed++}
    $('#leadBulkProgress').textContent=`${done+failed} / ${ids.length}`;
  }
  leadSelected.clear();
  $('#leadBulkStatus').value='';
  $('#leadBulkTeacher').value='';
  await bootstrap();
  $('#leadBulkProgress').textContent='';
  btn.disabled=false;
  toast(failed?`Обновлено ${done}, ошибок ${failed}`:`Обновлено заявок: ${done}`);
}

['#search','#status','#teacherFilter','#leadSourceFilter','#leadSort'].forEach(id=>$(id).addEventListener('input',renderLeads));
$('#leadKanbanMode').onclick=()=>{leadViewMode='kanban';renderLeads()};
$('#leadTableMode').onclick=()=>{leadViewMode='table';renderLeads()};
$$('.lead-quick-filters [data-lead-quick]').forEach(b=>b.onclick=()=>{leadQuickFilter=b.dataset.leadQuick||'';renderLeads()});
$('#leadBulkApply').onclick=applyBulkLeadChanges;
$('#leadBulkClear').onclick=()=>{leadSelected.clear();renderLeads()};
$('#leadSelectAll').addEventListener('change',e=>{
  filteredLeads().forEach(l=>e.target.checked?leadSelected.add(String(l.id)):leadSelected.delete(String(l.id)));
  renderLeads();
});

document.addEventListener('click',e=>{
  const cb=e.target.closest('[data-lead-select]');
  if(!cb)return;
  e.stopPropagation();
  const id=String(cb.dataset.leadSelect);
  cb.checked?leadSelected.add(id):leadSelected.delete(id);
  renderLeads();
});

document.addEventListener('dragstart',e=>{
  const card=e.target.closest('[data-lead-drag]');
  if(!card)return;
  leadDraggingId=String(card.dataset.leadDrag||'');
  card.classList.add('dragging');
  try{e.dataTransfer.setData('text/plain',leadDraggingId);e.dataTransfer.effectAllowed='move'}catch{}
});
document.addEventListener('dragend',e=>{
  e.target.closest('[data-lead-drag]')?.classList.remove('dragging');
  $$('.lead-kanban-column.drag-over').forEach(x=>x.classList.remove('drag-over'));
  leadDraggingId='';
});
document.addEventListener('dragover',e=>{
  const col=e.target.closest('[data-kanban-drop]');
  if(!col)return;
  e.preventDefault();
  $$('.lead-kanban-column.drag-over').forEach(x=>x!==col&&x.classList.remove('drag-over'));
  col.classList.add('drag-over');
});
document.addEventListener('dragleave',e=>{
  const col=e.target.closest('[data-kanban-drop]');
  if(col&&!col.contains(e.relatedTarget))col.classList.remove('drag-over');
});
document.addEventListener('drop',async e=>{
  const col=e.target.closest('[data-kanban-drop]');
  if(!col)return;
  e.preventDefault();col.classList.remove('drag-over');
  const id=leadDraggingId||e.dataTransfer?.getData('text/plain');if(!id)return;
  const l=STATE.leads.find(x=>String(x.id)===String(id));if(!l)return;
  const status=col.dataset.kanbanDrop;
  if(l.status===status)return;
  try{await updateLeadQuick(id,{status},`Статус: ${status}`)}
  catch(err){showError(err.message)}
});



const LEAD_FUNNEL=['Новая','Связались','Пробный','Пробный проведён','Оплатил'];

function leadAgeText(iso){
  if(!iso)return '—';
  const hours=hoursSince(iso);
  if(hours<1)return 'меньше часа';
  if(hours<24)return `${hours} ч.`;
  const days=Math.floor(hours/24);
  if(days<30)return `${days} дн.`;
  return `${Math.floor(days/30)} мес.`;
}

function leadStageIndex(status){
  if(status==='Записан') return 3;
  const i=LEAD_FUNNEL.indexOf(status);
  return i>=0?i:0;
}

function leadContactInfo(value){
  const c=String(value||'').trim();
  if(c.startsWith('@')){
    return {type:'telegram',label:c,hint:'Telegram',primaryLabel:'Написать в Telegram',primaryHref:`https://t.me/${encodeURIComponent(c.slice(1))}`};
  }
  if(/^\+7\d{10}$/.test(c)){
    return {type:'phone',label:c,hint:'Телефон',primaryLabel:'Позвонить',primaryHref:`tel:${c}`};
  }
  return {type:'text',label:c||'Не указан',hint:c?'Контакт из заявки':'Контакт не указан',primaryLabel:c?'Скопировать':'',primaryHref:''};
}

function leadNextRecommendation(l){
  const tasks=STATE.tasks.filter(t=>String(t.lead_id||'')===String(l.id)&&!t.done);
  const hasTrial=Boolean(l.trial_at);
  const trialPast=hasTrial&&new Date(l.trial_at).getTime()<Date.now();
  const noTeacher=!l.teacher_id||l.teacher_id==='Не назначен';

  if(l.status==='Новая'){
    return {tone:hoursSince(l.created_at)>=2?'danger':'orange',eyebrow:'Следующее действие',
      title:hoursSince(l.created_at)>=2?'Связаться как можно скорее':'Связаться с клиентом',
      meta:`Заявка ждёт ${leadAgeText(l.created_at)}${tasks.length?` · есть задач: ${tasks.length}`:' · задачи ещё нет'}`,
      action:'contact',button:'Связаться'};
  }
  if(l.status==='Связались'&&!hasTrial){
    return {tone:'orange',eyebrow:'Следующее действие',title:'Назначить пробный урок',
      meta:noTeacher?'Сначала можно выбрать преподавателя и удобное время':'Выберите дату и время пробного',
      action:'schedule',button:'Выбрать дату'};
  }
  if(hasTrial&&noTeacher&&['Связались','Пробный'].includes(l.status)){
    return {tone:'danger',eyebrow:'Нужно подготовить',title:'Назначить преподавателя',
      meta:`Пробный: ${fmt(l.trial_at)}`,action:'assign',button:'Назначить'};
  }
  if(l.status==='Пробный'&&trialPast){
    return {tone:'orange',eyebrow:'После занятия',title:'Зафиксировать результат пробного',
      meta:`Пробный был ${fmt(l.trial_at)}`,action:'trialDone',button:'Пробный проведён'};
  }
  if(l.status==='Пробный проведён'||l.status==='Записан'){
    return {tone:'green',eyebrow:'Продажа',title:'Получить решение и оформить оплату',
      meta:'После оплаты карточка ученика создастся автоматически',action:'paid',button:'Отметить оплату'};
  }
  if(l.status==='Оплатил'){
    return {tone:'green',eyebrow:'Ученик',title:'Перейти к карточке ученика',
      meta:'Заявка успешно прошла воронку',action:'student',button:'Открыть ученика'};
  }
  if(['Не отвечает','Отложено'].includes(l.status)){
    return {tone:'neutral',eyebrow:'Контроль',title:'Поставить задачу на повторный контакт',
      meta:tasks.length?`Активных задач: ${tasks.length}`:'Активных задач нет',action:'task',button:'+ Задача'};
  }
  if(['Отказ','Не подходит'].includes(l.status)){
    return {tone:'neutral',eyebrow:'Завершено',title:'Заявка закрыта',
      meta:'История сохранена. При необходимости статус можно вернуть.',action:'',button:''};
  }
  return {tone:'neutral',eyebrow:'Следующее действие',title:'Проверить заявку',
    meta:'Уточните статус и следующее действие',action:'task',button:'+ Задача'};
}

function renderLeadSmart(){
  if(!currentLead)return;
  const l=currentLead;
  const stage=leadStageIndex(l.status||'Новая');
  const ageHours=hoursSince(l.created_at);
  const contact=leadContactInfo(l.contact);
  const recommendation=leadNextRecommendation(l);
  const warning=ageHours>=24&&l.status==='Новая';

  $('#leadSmartBadges').innerHTML=`
    <span class="lead-status-chip ${statusClass(l.status)}"><i></i>${esc(l.status||'Новая')}</span>
    ${l.teacher_id?`<span class="lead-soft-chip">👨‍🏫 ${esc(l.teacher_id)}</span>`:''}
    ${l.trial_at?`<span class="lead-soft-chip">◷ ${esc(shortFmt(l.trial_at))}</span>`:''}
    ${warning?`<span class="lead-warning-chip">Без ответа 24+ ч.</span>`:''}
  `;

  $('#leadAgeBox').innerHTML=`
    <span>Возраст заявки</span>
    <strong>${esc(leadAgeText(l.created_at))}</strong>
    <small>${esc(shortFmt(l.created_at))}</small>
  `;

  $('#leadFunnel').innerHTML=LEAD_FUNNEL.map((s,i)=>{
    const done=i<stage, active=i===stage;
    return `<button type="button" data-funnel-status="${esc(s)}" class="${done?'done':''} ${active?'active':''}">
      <i>${done?'✓':i+1}</i><span>${esc(s)}</span>
    </button>`;
  }).join('');
  $('#leadStageHint').textContent=`Этап ${Math.min(stage+1,LEAD_FUNNEL.length)} из ${LEAD_FUNNEL.length}`;

  $('#leadNextAction').className=`lead-next-action ${recommendation.tone}`;
  $('#leadNextAction').innerHTML=`
    <div><span>${esc(recommendation.eyebrow)}</span><b>${esc(recommendation.title)}</b><small>${esc(recommendation.meta)}</small></div>
    ${recommendation.button?`<button type="button" data-lead-next="${esc(recommendation.action)}">${esc(recommendation.button)}</button>`:''}
  `;

  $('#leadContactValue').textContent=contact.label;
  $('#leadContactHint').textContent=contact.hint;
  const buttons=[];
  if(contact.primaryHref){
    buttons.push(`<a class="lead-contact-primary" href="${esc(contact.primaryHref)}" ${contact.type==='telegram'?'target="_blank" rel="noopener"':''}>${esc(contact.primaryLabel)}</a>`);
  }else if(contact.label&&contact.label!=='Не указан'){
    buttons.push(`<button type="button" class="lead-contact-primary" data-copy-contact>Скопировать</button>`);
  }
  if(contact.label&&contact.label!=='Не указан'){
    buttons.push(`<button type="button" data-copy-contact>Копировать</button>`);
  }
  $('#leadContactActions').innerHTML=buttons.join('');
}

function leadHistory(leadId){return STATE.events.filter(e=>String(e.lead_id)===String(leadId)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));}
function openLead(id){
  currentLead=STATE.leads.find(l=>String(l.id)===String(id)); if(!currentLead)return;

  $('#leadTitle').textContent=`${currentLead.parent_name||'—'} · ${currentLead.student_name||'—'}`;
  $('#leadMeta').textContent=`${currentLead.grade??'—'} класс · ${currentLead.source||'Сайт'}`;
  renderLeadSmart();

  $('#details').innerHTML=`
    <div class="kv"><b>Цель</b><span>${esc(currentLead.goal||'—')}</span></div>
    <div class="kv"><b>Контакт</b><span>${contactHtml(currentLead.contact)}</span></div>
    <div class="kv"><b>Комментарий</b><span>${esc(currentLead.client_comment||'—')}</span></div>
    <div class="kv"><b>Источник</b><span>${esc(currentLead.source||'—')}</span></div>
    <div class="kv"><b>Создана</b><span>${esc(fmt(currentLead.created_at))}</span></div>
    <div class="kv"><b>Обновлена</b><span>${esc(fmt(currentLead.updated_at||currentLead.created_at))}</span></div>
  `;

  ensureOption($('#leadStatus'),currentLead.status||'Новая');
  $('#leadStatus').value=currentLead.status||'Новая';
  $('#teacher').value=currentLead.teacher_id||'Не назначен';
  $('#trial').value=currentLead.trial_at?fmt(currentLead.trial_at):'';
  $('#note').value=currentLead.manager_note||'';
  closeTrialPicker();
  renderLeadTasks();

  const iconMap={status_change:'↗',teacher_change:'👨‍🏫',trial_change:'◷',note_change:'✎',task_created:'✓',student_created:'👨‍🎓',student_deleted:'−'};
  const h=leadHistory(id);
  $('#history').innerHTML=h.map(e=>`
    <li class="history-row">
      <i>${esc(iconMap[e.event_type]||'•')}</i>
      <div><small>${fmt(e.created_at)}</small><b>${esc(e.title||e.event_type||'Изменение')}</b>${e.details?`<span>${esc(e.details)}</span>`:''}</div>
    </li>`).join('')||`
    <li class="history-row"><i>＋</i><div><small>${fmt(currentLead.created_at)}</small><b>Заявка создана</b></div></li>`;

  $('#drawer').classList.add('open');
}
function renderLeadTasks(){
  if(!currentLead)return; const arr=STATE.tasks.filter(t=>String(t.lead_id||'')===String(currentLead.id)).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));
  $('#leadTasks').innerHTML=arr.map(taskItem).join('')||empty('Задач по заявке нет');
}
function ensureOption(select,value){if(value&&![...select.options].some(o=>o.value===value)){const o=document.createElement('option');o.value=value;o.textContent=value;select.appendChild(o)}}
function closeLeadDrawer(){
  $('#drawer').classList.remove('open');
  if(typeof closeTrialPicker==='function')closeTrialPicker();
}
$('#close').addEventListener('click',closeLeadDrawer);
$('#drawer .shade').addEventListener('click',closeLeadDrawer);
$$('[data-q]').forEach(b=>b.addEventListener('click',()=>{$('#leadStatus').value=b.dataset.q;if(currentLead){currentLead={...currentLead,status:b.dataset.q};renderLeadSmart();}}));
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
    showError(`Не удалось удалить заявку: ${e.message}`);
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
function studentData(s){
  const payments=STATE.payments.filter(p=>String(p.student_id)===String(s.id)).sort((a,b)=>new Date(b.payment_at)-new Date(a.payment_at));
  const lessons=STATE.lessons.filter(l=>String(l.student_id)===String(s.id)).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  const upcoming=lessons.filter(l=>l.starts_at&&new Date(l.starts_at)>new Date()&&l.status!=='Отменено');
  const completed=lessons.filter(l=>['Проведено','Завершено'].includes(l.status));
  const thisMonth=completed.filter(l=>monthKey(l.starts_at)===monthKey(new Date().toISOString()));
  const monthPayments=payments.filter(p=>monthKey(p.payment_at)===monthKey(new Date().toISOString()));
  const paidMonth=monthPayments.reduce((a,p)=>a+Number(p.amount_rub||0),0);
  const overdue=Boolean(s.status==='Активен'&&s.next_payment_at&&new Date(s.next_payment_at)<new Date());
  const noTeacher=Boolean(s.status==='Активен'&&!s.teacher_id);
  const noUpcoming=Boolean(s.status==='Активен'&&!upcoming.length);
  return {payments,lessons,upcoming,completed,thisMonth,monthPayments,paidMonth,overdue,noTeacher,noUpcoming};
}

function studentAttention(s){
  const d=studentData(s);
  const reasons=[];
  if(d.overdue)reasons.push('просрочена оплата');
  if(d.noTeacher)reasons.push('нет преподавателя');
  if(d.noUpcoming)reasons.push('нет будущих занятий');
  return {attention:reasons.length>0,reasons,d};
}

let studentAttentionOnly=false;

function renderStudents(){
  const active=STATE.students.filter(s=>s.status==='Активен');
  const next7=Date.now()+7*86400000;
  const lessons7=STATE.lessons.filter(l=>l.starts_at&&new Date(l.starts_at).getTime()>=Date.now()&&new Date(l.starts_at).getTime()<=next7&&l.status!=='Отменено');
  const overdue=active.filter(s=>s.next_payment_at&&new Date(s.next_payment_at)<new Date());
  const plan=active.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);
  const attention=active.filter(s=>studentAttention(s).attention);

  $('#s-m-active').textContent=active.length;
  $('#s-m-lessons').textContent=lessons7.length;
  $('#s-m-overdue').textContent=overdue.length;
  $('#s-m-plan').textContent=rub(plan);
  $('#studentAttentionCount').textContent=attention.length;
  $('#studentAttentionText').textContent=attention.length
    ? `${overdue.length} оплат · ${attention.filter(s=>studentData(s).noUpcoming).length} без расписания · ${attention.filter(s=>studentData(s).noTeacher).length} без преподавателя`
    : 'Всё в порядке';
  $('#studentShowAttention').textContent=studentAttentionOnly?'Показать всех':'Показать';
  $('#studentShowAttention').classList.toggle('active',studentAttentionOnly);

  const q=($('#studentSearch').value||'').toLowerCase(), status=$('#studentStatusFilter').value, teacher=$('#studentTeacherFilter').value;
  const arr=STATE.students.filter(x=>
    (!q||[x.student_name,x.parent_name,x.contact,x.program,x.tariff].join(' ').toLowerCase().includes(q))&&
    (!status||x.status===status)&&(!teacher||x.teacher_id===teacher)&&
    (!studentAttentionOnly||studentAttention(x).attention)
  );

  $('#studentRows').innerHTML=arr.map(x=>{
    const a=studentAttention(x);
    const tags=[];
    if(a.d.overdue)tags.push('<span class="student-alert danger">Оплата</span>');
    if(a.d.noUpcoming)tags.push('<span class="student-alert">Нет занятий</span>');
    if(a.d.noTeacher)tags.push('<span class="student-alert">Нет преподавателя</span>');
    const next=a.d.upcoming[0];
    return `<tr data-open-student="${esc(x.id)}">
      <td><div class="name">${esc(x.student_name||'—')}</div><div class="sub">${esc(x.parent_name||'—')} · ${esc(x.contact||'')}</div><div class="student-row-tags">${tags.join('')}</div></td>
      <td>${esc(x.grade||'—')}</td>
      <td>${esc(x.program||'—')}${next?`<div class="sub">След. занятие ${esc(shortFmt(next.starts_at))}</div>`:''}</td>
      <td>${esc(x.teacher_id||'—')}</td>
      <td>${esc(x.tariff||'—')}<div class="sub">${rub(x.monthly_price_rub)}</div></td>
      <td class="${a.d.overdue?'late-text':''}">${fmt(x.next_payment_at)}</td>
      <td><span class="student-state">${esc(x.status||'Активен')}</span></td>
    </tr>`;
  }).join('')||`<tr><td colspan="7">${empty(studentAttentionOnly?'Нет учеников, требующих внимания':'Учеников пока нет')}</td></tr>`;
}
$('#studentShowAttention').addEventListener('click',()=>{studentAttentionOnly=!studentAttentionOnly;renderStudents()});
['#studentSearch','#studentStatusFilter','#studentTeacherFilter'].forEach(id=>$(id).addEventListener('input',renderStudents));

function studentInitials(s){
  const n=String(s?.student_name||'У').trim().split(/\s+/).filter(Boolean);
  return (n[0]?.[0]||'У')+(n[1]?.[0]||'');
}
function studentContactInfo(value){
  return leadContactInfo(value);
}
function studentNextRecommendation(s){
  const d=studentData(s);
  if(s.status!=='Активен'){
    return {tone:'neutral',title:`Статус: ${s.status||'—'}`,meta:'Карточка не участвует в активном контроле',action:'',button:''};
  }
  if(d.overdue){
    return {tone:'danger',title:'Получить или отметить оплату',meta:`Оплата ожидалась ${fmt(s.next_payment_at)} · ${rub(s.monthly_price_rub)}`,action:'payment',button:'+ Оплата'};
  }
  if(d.noTeacher){
    return {tone:'orange',title:'Назначить преподавателя',meta:'Активный ученик без назначенного преподавателя',action:'teacher',button:'Назначить'};
  }
  if(d.noUpcoming){
    return {tone:'orange',title:'Добавить следующее занятие',meta:'В календаре нет будущих занятий',action:'lesson',button:'+ Занятие'};
  }
  const next=d.upcoming[0];
  const days=s.next_payment_at?daysUntil(s.next_payment_at):null;
  if(days!==null&&days>=0&&days<=3){
    return {tone:'orange',title:'Скоро следующая оплата',meta:`${fmt(s.next_payment_at)} · ${rub(s.monthly_price_rub)}`,action:'payment',button:'+ Оплата'};
  }
  return {tone:'green',title:'Всё по плану',meta:`Следующее занятие ${fmt(next.starts_at)} · ${next.teacher_id||s.teacher_id||'преподаватель'}`,action:'lesson',button:'+ Занятие'};
}
function renderStudentSmart(){
  if(!currentStudent)return;
  const s=currentStudent,d=studentData(s),rec=studentNextRecommendation(s);
  const next=d.upcoming[0];
  const last=[...d.completed].sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at))[0];
  const contact=studentContactInfo(s.contact);
  const allMonth=STATE.lessons.filter(l=>String(l.student_id)===String(s.id)&&monthKey(l.starts_at)===monthKey(new Date().toISOString())&&l.status!=='Отменено');
  const doneMonth=allMonth.filter(l=>['Проведено','Завершено'].includes(l.status)).length;
  const rhythmPct=allMonth.length?Math.round(doneMonth/allMonth.length*100):0;

  $('#studentSmartHead').hidden=false;
  $('#studentNewHead').hidden=true;
  $('#studentSnapshot').hidden=false;
  $('#studentNextAction').hidden=false;
  $('#studentContactCard').hidden=false;
  $('#studentRhythm').hidden=false;

  $('#studentAvatar').textContent=studentInitials(s).toUpperCase();
  $('#studentSmartBadges').innerHTML=`
    <span class="student-smart-status ${s.status==='Активен'?'active':''}">${esc(s.status||'Активен')}</span>
    ${s.teacher_id?`<span class="student-smart-soft">👨‍🏫 ${esc(s.teacher_id)}</span>`:''}
    ${s.program?`<span class="student-smart-soft">${esc(s.program)}</span>`:''}
  `;

  $('#studentMonthlyPrice').textContent=rub(s.monthly_price_rub);
  $('#studentTariffText').textContent=s.tariff||'Тариф не указан';
  $('#studentPaidMonth').textContent=rub(d.paidMonth);
  $('#studentPaidMonthCount').textContent=`${d.monthPayments.length} оплат(ы)`;

  $('#studentNextPayment').textContent=s.next_payment_at?shortFmt(s.next_payment_at):'—';
  $('#studentPaymentState').textContent=d.overdue?'Просрочена':(s.next_payment_at?`через ${Math.max(0,daysUntil(s.next_payment_at))} дн.`:'Дата не указана');
  $('#studentPaymentCard').classList.toggle('danger',d.overdue);

  $('#studentNextLesson').textContent=next?shortFmt(next.starts_at):'—';
  $('#studentNextLessonMeta').textContent=next?`${next.lesson_type||'Занятие'} · ${next.teacher_id||s.teacher_id||'—'}`:'Не запланировано';

  $('#studentNextAction').className=`student-next-action ${rec.tone}`;
  $('#studentNextAction').innerHTML=`
    <div><span>Следующее действие</span><b>${esc(rec.title)}</b><small>${esc(rec.meta)}</small></div>
    ${rec.button?`<button type="button" data-student-next="${esc(rec.action)}">${esc(rec.button)}</button>`:''}
  `;

  $('#studentContactValue').textContent=contact.label;
  $('#studentContactType').textContent=contact.hint;
  const actions=[];
  if(contact.primaryHref)actions.push(`<a class="student-contact-primary" href="${esc(contact.primaryHref)}" ${contact.type==='telegram'?'target="_blank" rel="noopener"':''}>${esc(contact.primaryLabel)}</a>`);
  if(contact.label&&contact.label!=='Не указан')actions.push(`<button type="button" data-copy-student-contact>Копировать</button>`);
  $('#studentContactActions').innerHTML=actions.join('');

  $('#studentRhythmTitle').textContent=allMonth.length?`${doneMonth} из ${allMonth.length} занятий`:'Занятий в месяце нет';
  $('#studentRhythmMeta').textContent=allMonth.length?`${rhythmPct}% проведено`:'Добавьте расписание';
  $('#studentRhythmFill').style.width=`${rhythmPct}%`;
  $('#studentDoneLessons').textContent=doneMonth;
  $('#studentUpcomingLessons').textContent=d.upcoming.length;
  $('#studentLastLesson').textContent=last?shortFmt(last.starts_at):'—';
}

function resetStudentForm(){
  currentStudent=null;
  $('#studentSmartHead').hidden=true;$('#studentNewHead').hidden=false;$('#studentSnapshot').hidden=true;$('#studentNextAction').hidden=true;$('#studentContactCard').hidden=true;$('#studentRhythm').hidden=true;
  $('#studentDrawerTitle').textContent='';$('#studentDrawerMeta').textContent='';
  ['#sStudentName','#sParentName','#sGrade','#sContact','#sProgram','#sTeacher','#sTariff','#sPrice','#sNextPayment','#sNotes'].forEach(id=>$(id).value='');
  $('#sStatus').value='Активен';$('#studentPayments').innerHTML=empty();$('#studentLessons').innerHTML=empty();$('#studentDangerZone').hidden=true
}
function openStudent(id=null){
  if(!id){resetStudentForm();$('#studentDrawer').classList.add('open');return}
  currentStudent=STATE.students.find(s=>String(s.id)===String(id));if(!currentStudent)return;
  $('#studentDangerZone').hidden=false;
  $('#studentDrawerTitle').textContent=currentStudent.student_name||'Ученик';
  $('#studentDrawerMeta').textContent=`${currentStudent.grade||'—'} класс · ${currentStudent.parent_name||'родитель не указан'}`;
  $('#sStudentName').value=currentStudent.student_name||'';$('#sParentName').value=currentStudent.parent_name||'';$('#sGrade').value=currentStudent.grade||'';$('#sContact').value=currentStudent.contact||'';$('#sProgram').value=currentStudent.program||'';$('#sTeacher').value=currentStudent.teacher_id||'';$('#sStatus').value=currentStudent.status||'Активен';$('#sTariff').value=currentStudent.tariff||'';$('#sPrice').value=currentStudent.monthly_price_rub||0;$('#sNextPayment').value=toDateInput(currentStudent.next_payment_at);$('#sNotes').value=currentStudent.notes||'';

  renderStudentSmart();

  const pays=STATE.payments.filter(p=>String(p.student_id)===String(id)).sort((a,b)=>new Date(b.payment_at)-new Date(a.payment_at));
  $('#studentPayments').innerHTML=pays.map(p=>compactItem(rub(p.amount_rub),`${fmt(p.payment_at)} · ${p.method||'Оплата'}${p.comment?` · ${p.comment}`:''}`,'','')).join('')||empty('Оплат ещё нет');

  const lessons=STATE.lessons.filter(l=>String(l.student_id)===String(id)).sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at));
  $('#studentLessons').innerHTML=lessons.slice(0,30).map(l=>compactItem(
    `${l.lesson_type||'Занятие'} · ${l.teacher_id||currentStudent.teacher_id||'—'}`,
    `${fmt(l.starts_at)} · ${l.status||'Запланировано'}${l.comment?` · ${l.comment}`:''}`,
    l.status==='Запланировано'?'Проведено':'',
    l.status==='Запланировано'?`data-lesson-done="${esc(l.id)}"`:''
  )).join('')||empty('Занятий пока нет');

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
$('#studentAddPayment').onclick=()=>{if(!currentStudent)return;openPaymentModal(currentStudent.id)};
$('#studentAddLesson').onclick=()=>{if(!currentStudent)return;openLessonModal(currentStudent.id,currentStudent.teacher_id)};
$('#studentAddTask').onclick=()=>{if(!currentStudent)return;openTaskModal({studentId:currentStudent.id})};
$('#studentQuickContact').onclick=()=>{if(!currentStudent)return;const c=studentContactInfo(currentStudent.contact);if(c.primaryHref){if(c.type==='telegram')window.open(c.primaryHref,'_blank','noopener');else location.href=c.primaryHref}else if(c.label&&c.label!=='Не указан'){navigator.clipboard?.writeText(c.label).then(()=>toast('Контакт скопирован')).catch(()=>{})}};


// ---------- Умная карточка ученика ----------
document.addEventListener('click',async e=>{
  const copy=e.target.closest('[data-copy-student-contact]');
  if(copy&&currentStudent){
    const value=String(currentStudent.contact||'').trim();
    if(!value)return;
    try{await navigator.clipboard.writeText(value);toast('Контакт скопирован')}catch{window.prompt('Скопируйте контакт:',value)}
    return;
  }

  const next=e.target.closest('[data-student-next]');
  if(!next||!currentStudent)return;
  const action=next.dataset.studentNext;
  if(action==='payment')return openPaymentModal(currentStudent.id);
  if(action==='lesson')return openLessonModal(currentStudent.id,currentStudent.teacher_id);
  if(action==='teacher'){
    $('#sTeacher').scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>$('#sTeacher').focus(),250);
  }
});


// ---------- Группы ----------
const GROUP_WEEKDAYS={
  1:'Понедельник',2:'Вторник',3:'Среда',4:'Четверг',5:'Пятница',6:'Суббота',7:'Воскресенье'
};
const GROUP_WEEKDAYS_SHORT={1:'Пн',2:'Вт',3:'Ср',4:'Чт',5:'Пт',6:'Сб',7:'Вс'};

function groupMembers(groupId,activeOnly=true){
  return STATE.groupMembers.filter(m=>String(m.group_id)===String(groupId)&&(!activeOnly||m.status==='Активен'));
}
function groupSlots(groupId,activeOnly=true){
  return STATE.groupSlots
    .filter(s=>String(s.group_id)===String(groupId)&&(!activeOnly||s.active!==false))
    .sort((a,b)=>Number(a.weekday)-Number(b.weekday)||String(a.start_time).localeCompare(String(b.start_time)));
}
function groupMemberStudents(groupId){
  return groupMembers(groupId).map(m=>({
    member:m,
    student:STATE.students.find(s=>String(s.id)===String(m.student_id))
  })).filter(x=>x.student);
}
function groupFreePlaces(g){
  return Math.max(0,Number(g.capacity||6)-groupMembers(g.id).length);
}
function groupNextSession(g,from=new Date()){
  const slots=groupSlots(g.id);
  if(!slots.length)return null;
  const baseKey=dateKey(from.toISOString());
  let best=null;
  for(let offset=0;offset<14;offset++){
    const key=shiftKey(baseKey,offset);
    const d=keyDate(key);
    const weekday=((d.getDay()+6)%7)+1;
    slots.filter(s=>Number(s.weekday)===weekday).forEach(slot=>{
      const iso=new Date(`${key}T${slot.start_time}:00+03:00`).toISOString();
      const ts=new Date(iso).getTime();
      if(ts>=from.getTime()&&(!best||ts<new Date(best.at).getTime())){
        best={at:iso,slot};
      }
    });
  }
  return best;
}
function groupScheduleText(g){
  const slots=groupSlots(g.id);
  if(!slots.length)return 'Расписание не задано';
  return slots.map(s=>`${GROUP_WEEKDAYS_SHORT[Number(s.weekday)]} ${s.start_time}`).join(' · ');
}
function syncGroupGradeFilter(){
  const select=$('#groupGradeFilter');if(!select)return;
  const current=select.value;
  const grades=[...new Set(STATE.groups.map(g=>String(g.grade||'').trim()).filter(Boolean))]
    .sort((a,b)=>Number(a)-Number(b)||a.localeCompare(b,'ru'));
  select.innerHTML='<option value="">Все классы</option>'+grades.map(g=>`<option value="${esc(g)}">${esc(g)} класс</option>`).join('');
  if(grades.includes(current))select.value=current;
}

function groupAttendanceRecords(groupId,month=''){
  return STATE.groupAttendance.filter(a=>
    String(a.group_id)===String(groupId)&&(!month||monthKey(a.session_at)===month)
  );
}
function groupAttendanceStats(groupId,month=monthKey(new Date().toISOString())){
  const records=groupAttendanceRecords(groupId,month);
  const present=records.filter(a=>a.status==='Присутствовал').length;
  const late=records.filter(a=>a.status==='Опоздал').length;
  const excused=records.filter(a=>a.status==='Уважительная').length;
  const absent=records.filter(a=>a.status==='Отсутствовал').length;
  const marked=present+late+excused+absent;
  const attended=present+late;
  const rate=marked?Math.round(attended/marked*100):null;
  const sessions=new Set(records.map(a=>String(a.session_at))).size;
  return {records,present,late,excused,absent,marked,attended,rate,sessions};
}
function groupStudentAttendanceStats(groupId,studentId,month=monthKey(new Date().toISOString())){
  const records=groupAttendanceRecords(groupId,month).filter(a=>String(a.student_id)===String(studentId));
  const attended=records.filter(a=>['Присутствовал','Опоздал'].includes(a.status)).length;
  return {records,attended,rate:records.length?Math.round(attended/records.length*100):null};
}
function groupAttendanceSessionOptions(g){
  const seen=new Map();
  const today=todayKey();
  for(let offset=-75;offset<=0;offset++){
    const key=shiftKey(today,offset);
    groupSessionEventsForKeys([key]).filter(e=>String(e.groupId)===String(g.id)).forEach(e=>{
      if(new Date(e.at).getTime()<=Date.now()+6*3600000)seen.set(new Date(e.at).toISOString(),e);
    });
  }
  groupAttendanceRecords(g.id).forEach(a=>{
    const iso=new Date(a.session_at).toISOString();
    if(!seen.has(iso))seen.set(iso,{
      kind:'group',at:iso,groupId:g.id,person:g.name||'Группа',
      teacher:g.teacher_id||'Не назначен',durationMin:60,status:g.status
    });
  });
  return [...seen.values()].sort((a,b)=>new Date(b.at)-new Date(a.at));
}
function attendanceRecordFor(groupId,studentId,sessionAt){
  const target=new Date(sessionAt).getTime();
  return STATE.groupAttendance.find(a=>
    String(a.group_id)===String(groupId)&&
    String(a.student_id)===String(studentId)&&
    Math.abs(new Date(a.session_at).getTime()-target)<1000
  )||null;
}
function attendanceStatusLabel(status){
  return ({'Присутствовал':'Был','Опоздал':'Опоздал','Уважительная':'Уваж.','Отсутствовал':'Не был'})[status]||status;
}
function renderGroupAttendance(){
  if(!currentGroup)return;
  const g=currentGroup,members=groupMemberStudents(g.id);
  const monthStats=groupAttendanceStats(g.id);
  $('#groupAttendanceMonthRate').textContent=monthStats.rate===null
    ?'за месяц ещё нет отметок'
    :`${monthStats.rate}% · ${monthStats.sessions} зан.`;
  $('#groupAttPresent').textContent=monthStats.present;
  $('#groupAttLate').textContent=monthStats.late;
  $('#groupAttExcused').textContent=monthStats.excused;
  $('#groupAttAbsent').textContent=monthStats.absent;

  const sessions=groupAttendanceSessionOptions(g);
  if(!sessions.length){
    currentGroupAttendanceAt='';
    $('#groupAttendanceSession').innerHTML='<option value="">Нет прошедших занятий</option>';
    $('#groupAttendanceList').innerHTML=empty('Сначала добавьте расписание и дождитесь занятия');
    $('#groupAttendanceSave').disabled=true;
    $('#groupAttendanceAllPresent').disabled=true;
    $('#groupAttendanceHint').textContent='Нет занятия, для которого можно отметить посещаемость.';
    return;
  }

  if(!currentGroupAttendanceAt||!sessions.some(s=>new Date(s.at).toISOString()===new Date(currentGroupAttendanceAt).toISOString())){
    currentGroupAttendanceAt=new Date(sessions[0].at).toISOString();
  }

  $('#groupAttendanceSession').innerHTML=sessions.map(s=>{
    const iso=new Date(s.at).toISOString();
    const selected=new Date(currentGroupAttendanceAt).getTime()===new Date(iso).getTime();
    const records=groupAttendanceRecords(g.id).filter(a=>Math.abs(new Date(a.session_at).getTime()-new Date(iso).getTime())<1000);
    return `<option value="${esc(iso)}" ${selected?'selected':''}>${esc(fmt(iso))}${records.length?` · отмечено ${records.length}`:''}</option>`;
  }).join('');

  $('#groupAttendanceSave').disabled=!members.length;
  $('#groupAttendanceAllPresent').disabled=!members.length;
  $('#groupAttendanceHint').textContent=members.length
    ?'Статусы можно менять повторно — сохранение обновит отметку.'
    :'В группе нет активных участников.';

  $('#groupAttendanceList').innerHTML=members.map(({student})=>{
    const existing=attendanceRecordFor(g.id,student.id,currentGroupAttendanceAt);
    const stats=groupStudentAttendanceStats(g.id,student.id);
    const statuses=['Присутствовал','Опоздал','Уважительная','Отсутствовал'];
    return `<div class="attendance-row" data-attendance-row="${esc(student.id)}">
      <div class="attendance-student">
        <span>${esc((student.student_name||'У')[0])}</span>
        <div><b>${esc(student.student_name||'Ученик')}</b><small>${esc(student.grade||'—')} класс · месяц ${stats.rate===null?'—':`${stats.rate}%`}</small></div>
      </div>
      <div class="attendance-statuses">
        ${statuses.map(status=>`<button type="button" data-attendance-status="${esc(status)}" class="${existing?.status===status?'active':''} ${status==='Отсутствовал'?'absent':status==='Уважительная'?'excused':status==='Опоздал'?'late':'present'}">${esc(attendanceStatusLabel(status))}</button>`).join('')}
      </div>
      <input data-attendance-reason value="${esc(existing?.reason||'')}" placeholder="Причина / комментарий">
    </div>`;
  }).join('')||empty('В группе пока нет детей');
}
function renderGroups(){
  syncGroupGradeFilter();
  const activeGroups=STATE.groups.filter(g=>['Набор','Активна'].includes(g.status));
  const activeMemberIds=new Set(STATE.groupMembers.filter(m=>m.status==='Активен').map(m=>String(m.student_id)));
  const free=activeGroups.reduce((a,g)=>a+groupFreePlaces(g),0);
  const slots=activeGroups.reduce((a,g)=>a+groupSlots(g.id).length,0);

  const totalAttendance=STATE.groupAttendance.filter(a=>monthKey(a.session_at)===monthKey(new Date().toISOString()));
  const totalAttended=totalAttendance.filter(a=>['Присутствовал','Опоздал'].includes(a.status)).length;
  const attendanceRate=totalAttendance.length?Math.round(totalAttended/totalAttendance.length*100):null;

  $('#g-m-active').textContent=activeGroups.length;
  $('#g-m-students').textContent=activeMemberIds.size;
  $('#g-m-free').textContent=free;
  $('#g-m-slots').textContent=slots;
  $('#g-m-attendance').textContent=attendanceRate===null?'—':`${attendanceRate}%`;

  const q=($('#groupSearch').value||'').toLowerCase();
  const teacher=$('#groupTeacherFilter').value;
  const grade=$('#groupGradeFilter').value;
  const status=$('#groupStatusFilter').value;

  const arr=STATE.groups
    .filter(g=>
      (!q||[g.name,g.grade,g.program,g.teacher_id,g.notes].join(' ').toLowerCase().includes(q))&&
      (!teacher||g.teacher_id===teacher)&&(!grade||String(g.grade)===grade)&&(!status||g.status===status)
    )
    .sort((a,b)=>{
      const rank={Активна:0,Набор:1,Пауза:2,Архив:3};
      return (rank[a.status]??9)-(rank[b.status]??9)||String(a.grade||'').localeCompare(String(b.grade||''),'ru');
    });

  $('#groupsGrid').innerHTML=arr.map(g=>{
    const members=groupMemberStudents(g.id);
    const freePlaces=groupFreePlaces(g);
    const capacity=Math.max(1,Number(g.capacity||6));
    const fill=Math.min(100,Math.round(members.length/capacity*100));
    const next=groupNextSession(g);
    const initials=members.slice(0,5).map(x=>`<span title="${esc(x.student.student_name||'Ученик')}">${esc((x.student.student_name||'У')[0])}</span>`).join('');
    const att=groupAttendanceStats(g.id);
    return `<article class="group-card ${g.status==='Архив'?'archived':''}" data-open-group="${esc(g.id)}">
      <div class="group-card-top">
        <span class="group-status ${g.status==='Активна'?'active':g.status==='Набор'?'recruiting':''}">${esc(g.status||'Набор')}</span>
        <small>${esc(g.grade?`${g.grade} класс`:'Класс не указан')}</small>
      </div>
      <h3>${esc(g.name||'Группа')}</h3>
      <p>${esc(g.program||'Программа не указана')}</p>

      <div class="group-card-schedule">
        <span>Расписание</span>
        <b>${esc(groupScheduleText(g))}</b>
        <small>${next?`Следующее: ${esc(shortFmt(next.at))}`:'Нет ближайших занятий'}</small>
      </div>

      <div class="group-card-teacher">
        <span>Преподаватель</span>
        <strong>${esc(g.teacher_id||'Не назначен')}</strong>
      </div>

      <div class="group-capacity">
        <div><span>Состав</span><b>${members.length} / ${capacity}</b></div>
        <div class="group-capacity-track"><i style="width:${fill}%"></i></div>
        <small>${freePlaces?`Свободно мест: ${freePlaces}`:'Группа заполнена'}</small>
      </div>

      <div class="group-card-attendance">
        <span>Посещаемость месяца</span>
        <strong>${att.rate===null?'—':`${att.rate}%`}</strong>
        <small>${att.sessions?`${att.sessions} отмеченных занятий`:'ещё не отмечалась'}</small>
      </div>

      <div class="group-card-members">
        <div class="group-member-avatars">${initials}${members.length>5?`<span>+${members.length-5}</span>`:''}</div>
        <button type="button" data-open-group="${esc(g.id)}">Открыть</button>
      </div>
    </article>`;
  }).join('')||empty('Групп пока нет');
}
['#groupSearch','#groupTeacherFilter','#groupGradeFilter','#groupStatusFilter'].forEach(id=>$(id).addEventListener('input',renderGroups));

function resetGroupForm(){
  currentGroup=null;
  $('#groupDrawerTitle').textContent='Новая группа';
  $('#groupDrawerMeta').textContent='Состав, преподаватель и расписание';
  $('#groupBadges').innerHTML='';
  $('#groupSnapshot').hidden=true;
  $('#groupExistingBlocks').hidden=true;
  $('#groupInitialSchedule').hidden=false;
  $('#groupName').value='';
  $('#groupGrade').value='';
  $('#groupProgram').value='';
  $('#groupTeacher').value='Не назначен';
  $('#groupCapacity').value=6;
  $('#groupStatus').value='Набор';
  $('#groupNotes').value='';
  $('#groupInitialWeekday').value='1';
  $('#groupInitialTime').value='18:00';
  $('#groupInitialDuration').value=60;
  currentGroupAttendanceAt='';
  $('#groupSave').textContent='Создать группу';
}
function populateGroupMemberSelect(){
  const select=$('#groupMemberStudent');
  if(!currentGroup){select.innerHTML='';return}
  const existing=new Set(groupMembers(currentGroup.id,false).map(m=>String(m.student_id)));
  const students=STATE.students.filter(s=>s.status==='Активен'&&!existing.has(String(s.id)));
  select.innerHTML=students.map(s=>`<option value="${esc(s.id)}">${esc(s.student_name||'Ученик')} · ${esc(s.grade||'—')} класс</option>`).join('');
  if(!students.length)select.innerHTML='<option value="">Нет доступных учеников</option>';
}
function renderGroupDrawer(){
  if(!currentGroup)return;
  const g=currentGroup;
  const members=groupMemberStudents(g.id);
  const slots=groupSlots(g.id);
  const next=groupNextSession(g);
  const cap=Math.max(1,Number(g.capacity||6));
  const teacherDataRow=g.teacher_id?teacherData(g.teacher_id):null;

  $('#groupDrawerTitle').textContent=g.name||'Группа';
  $('#groupDrawerMeta').textContent=`${g.grade?`${g.grade} класс · `:''}${g.program||'программа не указана'}`;
  $('#groupAvatar').textContent=(g.grade||g.name||'Г').toString().slice(0,2).toUpperCase();
  $('#groupBadges').innerHTML=`
    <span class="group-drawer-status ${g.status==='Активна'?'active':g.status==='Набор'?'recruiting':''}">${esc(g.status||'Набор')}</span>
    ${g.teacher_id?`<span class="group-drawer-soft">👨‍🏫 ${esc(g.teacher_id)}</span>`:''}
    <span class="group-drawer-soft">👥 ${members.length}/${cap}</span>`;

  $('#groupSnapshot').hidden=false;
  $('#groupExistingBlocks').hidden=false;
  $('#groupInitialSchedule').hidden=true;
  $('#groupMemberCount').textContent=`${members.length} / ${cap}`;
  $('#groupFreeText').textContent=groupFreePlaces(g)?`${groupFreePlaces(g)} свободных мест`:'Группа заполнена';
  $('#groupTeacherText').textContent=g.teacher_id||'Не назначен';
  $('#groupTeacherLoadText').textContent=teacherDataRow?`нагрузка ${teacherDataRow.loadPct}%`:'преподаватель не назначен';
  $('#groupGradeText').textContent=g.grade?`${g.grade} класс`:'—';
  $('#groupProgramText').textContent=g.program||'программа не указана';
  $('#groupNextText').textContent=next?shortFmt(next.at):'—';
  $('#groupNextMeta').textContent=next?`${GROUP_WEEKDAYS[Number(next.slot.weekday)]} · ${next.slot.duration_min} мин`:'расписание не задано';

  $('#groupName').value=g.name||'';
  $('#groupGrade').value=g.grade||'';
  $('#groupProgram').value=g.program||'';
  $('#groupTeacher').value=g.teacher_id||'Не назначен';
  $('#groupCapacity').value=g.capacity||6;
  $('#groupStatus').value=g.status||'Набор';
  $('#groupNotes').value=g.notes||'';
  $('#groupSave').textContent='Сохранить изменения';

  $('#groupSlotsCount').textContent=`${slots.length} в неделю`;
  $('#groupSlotsList').innerHTML=slots.map(s=>`
    <div class="group-slot-row">
      <div><b>${esc(GROUP_WEEKDAYS[Number(s.weekday)]||'День')}</b><small>${esc(s.start_time)} · ${Number(s.duration_min||60)} мин</small></div>
      <button type="button" data-group-slot-delete="${esc(s.id)}">Удалить</button>
    </div>`).join('')||empty('Расписание не задано');

  $('#groupMembersCaption').textContent=`${members.length} из ${cap}`;
  $('#groupMembersList').innerHTML=members.map(({member,student})=>`
    <div class="group-member-row">
      <div class="group-member-avatar">${esc((student.student_name||'У')[0])}</div>
      <div><b>${esc(student.student_name||'Ученик')}</b><small>${esc(student.grade||'—')} класс · ${esc(student.contact||'нет контакта')}</small></div>
      <button type="button" data-open-student="${esc(student.id)}">Карточка</button>
      <button type="button" class="remove" data-group-member-remove="${esc(member.id)}">×</button>
    </div>`).join('')||empty('В группе пока нет детей');

  populateGroupMemberSelect();
  renderGroupAttendance();
}
function openGroup(id=null){
  if(!id){
    resetGroupForm();
    $('#groupDrawer').classList.add('open');
    return;
  }
  currentGroup=STATE.groups.find(g=>String(g.id)===String(id));
  if(!currentGroup)return;
  renderGroupDrawer();
  $('#groupDrawer').classList.add('open');
}
$('#newGroupBtn').onclick=()=>openGroup();
$('#groupClose').onclick=()=>$('#groupDrawer').classList.remove('open');
$('#groupDrawer .shade').onclick=()=>$('#groupDrawer').classList.remove('open');

$('#groupSave').onclick=async()=>{
  const btn=$('#groupSave');btn.disabled=true;
  try{
    if(currentGroup){
      await api('updateGroup',{
        id:currentGroup.id,name:$('#groupName').value,grade:$('#groupGrade').value,program:$('#groupProgram').value,
        teacher:$('#groupTeacher').value,capacity:$('#groupCapacity').value,status:$('#groupStatus').value,notes:$('#groupNotes').value
      });
      await bootstrap();
      currentGroup=STATE.groups.find(g=>String(g.id)===String(currentGroup.id));
      renderGroupDrawer();
      toast('Группа сохранена');
    }else{
      const d=await api('createGroup',{
        name:$('#groupName').value,grade:$('#groupGrade').value,program:$('#groupProgram').value,
        teacher:$('#groupTeacher').value,capacity:$('#groupCapacity').value,status:$('#groupStatus').value,notes:$('#groupNotes').value,
        weekday:$('#groupInitialWeekday').value,startTime:$('#groupInitialTime').value,durationMin:$('#groupInitialDuration').value
      });
      await bootstrap();
      currentGroup=STATE.groups.find(g=>String(g.id)===String(d.id));
      if(currentGroup)renderGroupDrawer();
      toast('Группа создана');
    }
  }catch(e){showError(e.message)}
  finally{btn.disabled=false}
};
$('#groupAddSlot').onclick=async()=>{
  if(!currentGroup)return;
  try{
    await api('createGroupSlot',{
      groupId:currentGroup.id,weekday:$('#groupSlotWeekday').value,startTime:$('#groupSlotTime').value,durationMin:$('#groupSlotDuration').value
    });
    await bootstrap();
    currentGroup=STATE.groups.find(g=>String(g.id)===String(currentGroup.id));
    renderGroupDrawer();
    toast('Время добавлено');
  }catch(e){showError(e.message)}
};
$('#groupAddMember').onclick=async()=>{
  if(!currentGroup)return;
  const studentId=$('#groupMemberStudent').value;
  if(!studentId){toast('Нет доступного ученика');return}
  try{
    await api('addGroupMember',{groupId:currentGroup.id,studentId});
    await bootstrap();
    currentGroup=STATE.groups.find(g=>String(g.id)===String(currentGroup.id));
    renderGroupDrawer();
    toast('Ученик добавлен в группу');
  }catch(e){showError(e.message)}
};

document.addEventListener('click',async e=>{
  const group=e.target.closest('[data-open-group]');
  if(group){
    e.preventDefault();
    openGroup(group.dataset.openGroup);
    return;
  }
  const delSlot=e.target.closest('[data-group-slot-delete]');
  if(delSlot&&currentGroup){
    if(!confirm('Удалить это время из расписания группы?'))return;
    try{
      await api('deleteGroupSlot',{id:delSlot.dataset.groupSlotDelete});
      await bootstrap();
      currentGroup=STATE.groups.find(g=>String(g.id)===String(currentGroup.id));
      renderGroupDrawer();
      toast('Время удалено');
    }catch(err){showError(err.message)}
    return;
  }
  const rem=e.target.closest('[data-group-member-remove]');
  if(rem&&currentGroup){
    if(!confirm('Убрать ученика из этой группы? Карточка ученика останется в CRM.'))return;
    try{
      await api('removeGroupMember',{id:rem.dataset.groupMemberRemove});
      await bootstrap();
      currentGroup=STATE.groups.find(g=>String(g.id)===String(currentGroup.id));
      renderGroupDrawer();
      toast('Ученик убран из группы');
    }catch(err){showError(err.message)}
  }
});


$('#groupAttendanceSession').addEventListener('change',()=>{
  currentGroupAttendanceAt=$('#groupAttendanceSession').value||'';
  renderGroupAttendance();
});
$('#groupAttendanceAllPresent').addEventListener('click',()=>{
  $$('#groupAttendanceList [data-attendance-row]').forEach(row=>{
    row.querySelectorAll('[data-attendance-status]').forEach(b=>b.classList.toggle('active',b.dataset.attendanceStatus==='Присутствовал'));
  });
});
$('#groupAttendanceSave').addEventListener('click',async()=>{
  if(!currentGroup||!currentGroupAttendanceAt)return;
  const records=[];
  $$('#groupAttendanceList [data-attendance-row]').forEach(row=>{
    const active=row.querySelector('[data-attendance-status].active');
    if(!active)return;
    records.push({
      studentId:row.dataset.attendanceRow,
      status:active.dataset.attendanceStatus,
      reason:row.querySelector('[data-attendance-reason]')?.value||''
    });
  });
  if(!records.length){toast('Отметьте хотя бы одного ученика');return}
  const btn=$('#groupAttendanceSave');btn.disabled=true;
  try{
    await api('saveGroupAttendance',{groupId:currentGroup.id,sessionAt:currentGroupAttendanceAt,records});
    const groupId=currentGroup.id,sessionAt=currentGroupAttendanceAt;
    await bootstrap();
    currentGroup=STATE.groups.find(g=>String(g.id)===String(groupId));
    currentGroupAttendanceAt=sessionAt;
    renderGroupDrawer();
    toast(`Посещаемость сохранена: ${records.length}`);
  }catch(e){showError(e.message)}
  finally{btn.disabled=false}
});

document.addEventListener('click',e=>{
  const status=e.target.closest('[data-attendance-status]');
  if(!status)return;
  const row=status.closest('[data-attendance-row]');
  if(!row)return;
  row.querySelectorAll('[data-attendance-status]').forEach(b=>b.classList.toggle('active',b===status));
});

// ---------- Преподаватели ----------
function teacherData(name){
  const now=Date.now(), next7=now+7*86400000;
  const students=STATE.students.filter(s=>s.status==='Активен'&&s.teacher_id===name);
  const allStudents=STATE.students.filter(s=>s.teacher_id===name);
  const upcomingTrials=STATE.leads
    .filter(l=>l.teacher_id===name&&l.trial_at&&new Date(l.trial_at).getTime()>now)
    .sort((a,b)=>new Date(a.trial_at)-new Date(b.trial_at));
  const upcomingLessons=STATE.lessons
    .filter(l=>l.teacher_id===name&&l.starts_at&&new Date(l.starts_at).getTime()>now&&l.status!=='Отменено')
    .sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  const weekTrials=upcomingTrials.filter(l=>new Date(l.trial_at).getTime()<=next7);
  const weekLessons=upcomingLessons.filter(l=>new Date(l.starts_at).getTime()<=next7);
  const row=STATE.teachers.find(t=>t.name===name)||{};
  const cap=Math.max(0,Number(row.weekly_capacity||20));
  const loadPct=cap?Math.min(100,Math.round(students.length/cap*100)):100;
  const free=Math.max(0,cap-students.length);
  const events=[
    ...upcomingTrials.map(l=>({kind:'trial',at:l.trial_at,title:`Пробный · ${l.student_name||l.parent_name||'Ученик'}`,leadId:l.id,status:l.status})),
    ...upcomingLessons.map(l=>{
      const s=STATE.students.find(x=>String(x.id)===String(l.student_id));
      return {kind:'lesson',at:l.starts_at,title:`${l.lesson_type||'Занятие'} · ${s?.student_name||'Ученик'}`,studentId:l.student_id,status:l.status};
    })
  ].sort((a,b)=>new Date(a.at)-new Date(b.at));
  const plan=students.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);
  return {
    students,allStudents,upcomingTrials,upcomingLessons,weekTrials,weekLessons,row,
    cap,loadPct,free,events,nextEvent:events[0]||null,plan
  };
}

function teacherRecommendation(){
  const candidates=TEACHERS
    .map(name=>({name,d:teacherData(name)}))
    .filter(x=>x.d.row.active!==false&&x.d.cap>0)
    .map(x=>{
      const weekEvents=x.d.weekLessons.length+x.d.weekTrials.length;
      const capacityRatio=x.d.students.length/Math.max(1,x.d.cap);
      const score=capacityRatio*100+weekEvents*3;
      return {...x,weekEvents,score};
    })
    .sort((a,b)=>a.score-b.score||b.d.free-a.d.free);
  return candidates[0]||null;
}

function renderTeachers(){
  const onlyActive=$('#teacherOnlyActive')?.checked??true;
  const teacherRows=TEACHERS.map(name=>({name,d:teacherData(name)}));
  const active=teacherRows.filter(x=>x.d.row.active!==false);
  const weekEvents=teacherRows.reduce((a,x)=>a+x.d.weekLessons.length+x.d.weekTrials.length,0);
  const unassignedStudents=STATE.students.filter(s=>s.status==='Активен'&&!s.teacher_id);
  const unassignedTrials=STATE.leads.filter(l=>l.trial_at&&new Date(l.trial_at)>new Date()&&(!l.teacher_id||l.teacher_id==='Не назначен'));

  $('#tr-m-active').textContent=active.length;
  $('#tr-m-students').textContent=STATE.students.filter(s=>s.status==='Активен'&&s.teacher_id).length;
  $('#tr-m-week').textContent=weekEvents;
  $('#tr-m-unassigned').textContent=unassignedStudents.length+unassignedTrials.length;
  $('#teacherTeamHint').textContent=`${unassignedStudents.length} ученик(а) и ${unassignedTrials.length} пробных без преподавателя`;

  const rec=teacherRecommendation();
  if(rec){
    $('#teacherAdvisorName').textContent=rec.name;
    $('#teacherAdvisorMeta').textContent=`Свободно ${rec.d.free} · ${rec.weekEvents} событий на 7 дней`;
    $('#teacherAdvisorLoad').textContent=`${rec.d.loadPct}%`;
    $('#teacherAdvisorOpen').disabled=false;
    $('#teacherAdvisorOpen').dataset.teacher=rec.name;
  }else{
    $('#teacherAdvisorName').textContent='Нет доступных';
    $('#teacherAdvisorMeta').textContent='Проверьте активность и ёмкость преподавателей';
    $('#teacherAdvisorLoad').textContent='—';
    $('#teacherAdvisorOpen').disabled=true;
    delete $('#teacherAdvisorOpen').dataset.teacher;
  }

  const list=teacherRows.filter(x=>!onlyActive||x.d.row.active!==false);
  $('#teachersGrid').innerHTML=list.map(({name,d})=>{
    const activeState=d.row.active!==false;
    const recommended=rec?.name===name;
    const week=d.weekLessons.length+d.weekTrials.length;
    const loadTone=d.loadPct>=90?'high':(d.loadPct>=70?'medium':'low');
    return `<article class="teacher-card teacher-card-pro ${!activeState?'paused':''}" data-open-teacher="${esc(name)}">
      <div class="teacher-card-top">
        <div class="teacher-avatar">${esc(name[0])}</div>
        <div class="teacher-card-flags">
          ${recommended?'<span class="teacher-recommended">★ Рекомендуем</span>':''}
          <span class="teacher-state ${activeState?'active':''}">${activeState?'Активен':'Пауза'}</span>
        </div>
      </div>

      <div class="teacher-card-head">
        <div><em>Преподаватель</em><h3>${esc(name)}</h3></div>
      </div>

      <div class="teacher-numbers teacher-numbers-pro">
        <div><b>${d.students.length}</b><small>учеников</small></div>
        <div><b>${d.free}</b><small>свободно</small></div>
        <div><b>${week}</b><small>событий 7 дней</small></div>
        <div><b>${d.weekTrials.length}</b><small>пробных 7 дней</small></div>
      </div>

      <div class="capacity">
        <div><span>Нагрузка</span><b>${d.students.length} / ${d.cap}</b></div>
        <div class="capacity-track ${loadTone}"><i style="width:${d.loadPct}%"></i></div>
        <small>${d.loadPct}% · ${d.free?`есть резерв ${d.free}`:'резерв исчерпан'}</small>
      </div>

      <div class="teacher-next-preview">
        <span>Ближайшее</span>
        ${d.nextEvent
          ? `<b>${esc(shortFmt(d.nextEvent.at))}</b><small>${esc(d.nextEvent.title)}</small>`
          : '<b>Нет событий</b><small>Расписание свободно</small>'}
      </div>

      <div class="teacher-card-actions">
        <button type="button" data-open-teacher="${esc(name)}">Открыть</button>
        <button type="button" data-teacher-lesson="${esc(name)}">+ Занятие</button>
      </div>
    </article>`;
  }).join('')||empty('Нет преподавателей по выбранному фильтру');
}

function openTeacher(name){
  currentTeacherName=name;
  const d=teacherData(name);
  const active=d.row.active!==false;
  const week=d.weekLessons.length+d.weekTrials.length;
  const candidates=[
    ...STATE.students.filter(s=>s.status==='Активен'&&!s.teacher_id).map(s=>({kind:'student',id:s.id,title:s.student_name||'Ученик',meta:`${s.grade||'—'} класс · ${s.program||'программа не указана'}`})),
    ...STATE.leads.filter(l=>l.trial_at&&new Date(l.trial_at)>new Date()&&(!l.teacher_id||l.teacher_id==='Не назначен')).map(l=>({kind:'lead',id:l.id,title:l.student_name||l.parent_name||'Пробный',meta:`Пробный ${shortFmt(l.trial_at)} · ${l.grade||'—'} класс`}))
  ];

  $('#teacherProfileAvatar').textContent=name[0]||'П';
  $('#teacherProfileName').textContent=name;
  $('#teacherProfileMeta').textContent=`Плановая ёмкость ${d.cap} · ${rub(d.plan)} план активных учеников`;
  $('#teacherProfileBadges').innerHTML=`
    <span class="teacher-profile-status ${active?'active':''}">${active?'Активен':'Пауза'}</span>
    ${d.row.telegram?'<span class="teacher-profile-soft">Telegram подключён</span>':''}
  `;

  $('#teacherProfileStudents').textContent=d.students.length;
  $('#teacherProfileFree').textContent=d.free;
  $('#teacherProfileWeek').textContent=week;
  $('#teacherProfileTrials').textContent=d.upcomingTrials.length;

  $('#teacherLoadText').textContent=`${d.students.length} / ${d.cap}`;
  $('#teacherLoadPercent').textContent=`${d.loadPct}%`;
  $('#teacherLoadFill').style.width=`${d.loadPct}%`;
  $('#teacherLoadFill').className=d.loadPct>=90?'high':(d.loadPct>=70?'medium':'');
  $('#teacherLoadHint').textContent=d.loadPct>=90
    ? 'Нагрузка высокая — новых учеников лучше распределять осторожно'
    : (d.loadPct>=70?'Нагрузка средняя — свободная ёмкость ещё есть':`Есть хороший резерв: ${d.free} мест`);

  if(d.nextEvent){
    $('#teacherNextEvent').innerHTML=`
      <div><span>Следующее событие</span><b>${esc(d.nextEvent.title)}</b><small>${esc(fmt(d.nextEvent.at))}</small></div>
      <button type="button" ${d.nextEvent.leadId?`data-open-lead="${esc(d.nextEvent.leadId)}"`:`data-open-student="${esc(d.nextEvent.studentId)}"`}>Открыть</button>
    `;
  }else{
    $('#teacherNextEvent').innerHTML='<div><span>Следующее событие</span><b>Расписание свободно</b><small>Будущих занятий и пробных нет</small></div>';
  }

  $('#teacherScheduleCount').textContent=`${d.events.length} впереди`;
  $('#teacherSchedule').innerHTML=d.events.slice(0,12).map(ev=>compactItem(
    ev.title,
    `${fmt(ev.at)} · ${ev.kind==='trial'?'Пробный':'Занятие'}`,
    'Открыть',
    ev.leadId?`data-open-lead="${esc(ev.leadId)}"`:`data-open-student="${esc(ev.studentId)}"`,
    ev.kind==='trial'?'orange':''
  )).join('')||empty('Будущих событий нет');

  $('#teacherStudentsCount').textContent=`${d.students.length} активных`;
  $('#teacherStudentsList').innerHTML=d.students.map(s=>{
    const sd=studentData(s);
    return compactItem(
      s.student_name||'Ученик',
      `${s.grade||'—'} класс · ${s.program||'программа не указана'}${sd.upcoming[0]?` · след. ${shortFmt(sd.upcoming[0].starts_at)}`:''}`,
      'Открыть',`data-open-student="${esc(s.id)}"`,
      sd.overdue?'danger':'green'
    );
  }).join('')||empty('Активных учеников нет');

  $('#teacherCandidatesCount').textContent=`${candidates.length} без назначения`;
  $('#teacherCandidatesCard').hidden=!candidates.length;
  $('#teacherCandidates').innerHTML=candidates.slice(0,10).map(c=>compactItem(
    c.title,c.meta,'Открыть',
    c.kind==='student'?`data-open-student="${esc(c.id)}"`:`data-open-lead="${esc(c.id)}"`,
    'orange'
  )).join('');

  $('#teacherContactBtn').disabled=!d.row.telegram;
  $('#teacherContactBtn').textContent=d.row.telegram?'Telegram':'Нет Telegram';
  $('#teacherDrawer').classList.add('open');
}

$('#teacherOnlyActive').addEventListener('change',renderTeachers);
$('#teacherAdvisorOpen').addEventListener('click',()=>{
  const name=$('#teacherAdvisorOpen').dataset.teacher;
  if(name)openTeacher(name);
});
$('#teacherClose').addEventListener('click',()=>$('#teacherDrawer').classList.remove('open'));
$('#teacherDrawer .shade').addEventListener('click',()=>$('#teacherDrawer').classList.remove('open'));

$('#teacherAddLesson').addEventListener('click',()=>{
  if(currentTeacherName)openLessonModal('',currentTeacherName);
});
$('#teacherOpenCalendar').addEventListener('click',()=>{
  $('#teacherDrawer').classList.remove('open');
  showPage('calendar');
});
$('#teacherContactBtn').addEventListener('click',()=>{
  if(!currentTeacherName)return;
  const d=teacherData(currentTeacherName),tg=String(d.row.telegram||'').trim();
  if(!tg)return;
  const username=tg.replace(/^https?:\/\/t\.me\//,'').replace(/^@/,'');
  window.open(`https://t.me/${encodeURIComponent(username)}`,'_blank','noopener');
});
$('#teacherOpenSettings').addEventListener('click',()=>{
  $('#teacherDrawer').classList.remove('open');
  showPage('settings');
  setTimeout(()=>{
    const row=$(`[data-teacher-row] b`);
    $('#teacherSettings')?.scrollIntoView({behavior:'smooth',block:'center'});
  },150);
});

document.addEventListener('click',e=>{
  const lesson=e.target.closest('[data-teacher-lesson]');
  if(lesson){
    e.stopPropagation();
    openLessonModal('',lesson.dataset.teacherLesson);
    return;
  }
  const card=e.target.closest('[data-open-teacher]');
  if(card && !e.target.closest('[data-open-student],[data-open-lead]')){
    const name=card.dataset.openTeacher;
    if(name)openTeacher(name);
  }
});

// ---------- Финансы ----------
let financeDebtorsOnly=false;

function monthStartOffset(offset){
  const now=new Date();
  return new Date(now.getFullYear(),now.getMonth()+offset,1);
}
function monthBucketKey(date){
  return `${date.getFullYear()}-${pad2(date.getMonth()+1)}`;
}
function monthLabelShort(date){
  return new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(date).replace('.','');
}
function financeExpectedStudents(days=30){
  const now=Date.now(), limit=now+days*86400000;
  return STATE.students
    .filter(s=>s.status==='Активен'&&s.next_payment_at)
    .filter(s=>{
      const t=new Date(s.next_payment_at).getTime();
      return Number.isFinite(t)&&t>=now&&t<=limit;
    })
    .sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at));
}
function financeDueGroup(s){
  if(!s.next_payment_at)return 'later';
  const diff=daysUntil(s.next_payment_at);
  if(diff<0)return 'overdue';
  if(diff===0)return 'today';
  if(diff<=7)return 'week';
  return 'later';
}
function financeMethodRows(payments){
  const map=new Map();
  payments.forEach(p=>{
    const method=String(p.method||'Не указан').trim()||'Не указан';
    const row=map.get(method)||{method,sum:0,count:0};
    row.sum+=Number(p.amount_rub||0);row.count+=1;map.set(method,row);
  });
  return [...map.values()].sort((a,b)=>b.sum-a.sum);
}

function renderFinance(){
  const mk=monthKey(new Date().toISOString()), now=Date.now();
  const pays=STATE.payments.filter(p=>monthKey(p.payment_at)===mk);
  const month=pays.reduce((a,p)=>a+Number(p.amount_rub||0),0);
  const active=STATE.students.filter(s=>s.status==='Активен');
  const plan=active.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);

  const overdue=active
    .filter(s=>s.next_payment_at&&new Date(s.next_payment_at).getTime()<now)
    .sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at));
  const overSum=overdue.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);

  const week=active
    .filter(s=>s.next_payment_at&&daysUntil(s.next_payment_at)>=0&&daysUntil(s.next_payment_at)<=7)
    .sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at));
  const weekSum=week.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);

  const forecast30=financeExpectedStudents(30);
  const forecastSum=forecast30.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);

  const collectionPct=plan?Math.min(100,Math.round(month/plan*100)):0;
  const average=pays.length?Math.round(month/pays.length):0;

  $('#f-month').textContent=rub(month);
  $('#f-plan').textContent=rub(plan);
  $('#f-overdue').textContent=rub(overSum);
  $('#f-count').textContent=pays.length;
  $('#f-week').textContent=rub(weekSum);
  $('#f-forecast').textContent=rub(forecastSum);
  $('#f-plan-fill').style.width=`${collectionPct}%`;
  $('#f-collection').textContent=`${collectionPct}% от месячного плана`;
  $('#f-overdue-count').textContent=`${overdue.length} ученик(а)`;
  $('#f-week-count').textContent=`${week.length} оплат`;
  $('#f-average').textContent=`средний чек ${rub(average)}`;
  $('#f-forecast-meta').textContent=`${forecast30.length} ожидаемых оплат активных учеников`;

  $('#financeAlert').classList.toggle('danger',overdue.length>0);
  $('#financeAlertTitle').textContent=overdue.length
    ? `${overdue.length} просроченных оплат на ${rub(overSum)}`
    : 'Просроченных оплат нет';
  $('#financeAlertMeta').textContent=overdue.length
    ? `Самая ранняя: ${fmt(overdue[0]?.next_payment_at)} · ${overdue[0]?.student_name||'ученик'}`
    : 'Платежи идут по плану';
  $('#financeShowDebtors').disabled=!overdue.length;
  $('#financeShowDebtors').textContent=financeDebtorsOnly?'Показать все':'Показать должников';

  // Revenue trend: last 6 calendar months.
  const buckets=[];
  for(let offset=-5;offset<=0;offset++){
    const date=monthStartOffset(offset);
    const key=monthBucketKey(date);
    const sum=STATE.payments.filter(p=>monthKey(p.payment_at)===key).reduce((a,p)=>a+Number(p.amount_rub||0),0);
    buckets.push({date,key,sum,label:monthLabelShort(date)});
  }
  const max=Math.max(1,...buckets.map(x=>x.sum));
  $('#financeTrend').innerHTML=buckets.map(x=>{
    const h=x.sum?Math.max(8,Math.round(x.sum/max*100)):3;
    return `<div class="finance-bar-col">
      <div class="finance-bar-value">${x.sum?rub(x.sum):'0 ₽'}</div>
      <div class="finance-bar-track"><i style="height:${h}%"></i></div>
      <b>${esc(x.label)}</b>
    </div>`;
  }).join('');
  const first=buckets[0]?.sum||0,last=buckets[buckets.length-1]?.sum||0;
  const trend=first?Math.round((last-first)/first*100):null;
  $('#financeTrendCaption').textContent=trend===null?'пока мало данных':`${trend>=0?'+':''}${trend}% к первому месяцу`;

  // Payment calendar buckets.
  const groups={
    overdue:{title:'Просрочено',tone:'danger',items:overdue},
    today:{title:'Сегодня',tone:'orange',items:active.filter(s=>financeDueGroup(s)==='today')},
    week:{title:'7 дней',tone:'blue',items:active.filter(s=>financeDueGroup(s)==='week')},
    later:{title:'Позже',tone:'neutral',items:active.filter(s=>financeDueGroup(s)==='later'&&s.next_payment_at).sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at))}
  };
  $('#financePaymentCalendar').innerHTML=Object.values(groups).map(g=>{
    const sum=g.items.reduce((a,s)=>a+Number(s.monthly_price_rub||0),0);
    return `<div class="finance-date-bucket ${g.tone}">
      <span>${esc(g.title)}</span>
      <strong>${g.items.length}</strong>
      <small>${rub(sum)}</small>
    </div>`;
  }).join('');
  $('#financeCalendarCaption').textContent=`${active.filter(s=>s.next_payment_at).length} дат оплаты`;

  const dueBase=financeDebtorsOnly?overdue:active.filter(s=>s.next_payment_at).sort((a,b)=>new Date(a.next_payment_at)-new Date(b.next_payment_at));
  $('#duePayments').innerHTML=dueBase.slice(0,16).map(s=>{
    const grp=financeDueGroup(s);
    const label=grp==='overdue'?`Просрочено ${Math.abs(daysUntil(s.next_payment_at))} дн.`:(grp==='today'?'Сегодня':`Через ${Math.max(0,daysUntil(s.next_payment_at))} дн.`);
    return compactItem(
      s.student_name||'Ученик',
      `${label} · ${fmt(s.next_payment_at)} · ${rub(s.monthly_price_rub)}`,
      'Оплата',`data-payment-for="${esc(s.id)}"`,
      grp==='overdue'?'danger':(grp==='today'?'orange':'green')
    );
  }).join('')||empty(financeDebtorsOnly?'Просроченных оплат нет':'Дат оплаты нет');

  const sorted=[...STATE.payments].sort((a,b)=>new Date(b.payment_at)-new Date(a.payment_at));
  $('#paymentList').innerHTML=sorted.slice(0,18).map(p=>{
    const s=STATE.students.find(x=>String(x.id)===String(p.student_id));
    return compactItem(
      rub(p.amount_rub),
      `${fmt(p.payment_at)} · ${s?.student_name||'Ученик'} · ${p.method||'Способ не указан'}`,
      'Открыть',s?`data-open-student="${esc(s.id)}"`:''
    );
  }).join('')||empty('Оплат ещё нет');
  $('#financePaymentsCaption').textContent=`${STATE.payments.length} всего`;

  const methods=financeMethodRows(pays);
  const methodMax=Math.max(1,...methods.map(x=>x.sum));
  $('#financeMethods').innerHTML=methods.map(x=>`
    <div class="finance-method-row">
      <div><b>${esc(x.method)}</b><small>${x.count} оплат(ы)</small></div>
      <div class="finance-method-track"><i style="width:${Math.round(x.sum/methodMax*100)}%"></i></div>
      <strong>${rub(x.sum)}</strong>
    </div>
  `).join('')||empty('Нет оплат за текущий месяц');

  $('#financeForecastList').innerHTML=forecast30.slice(0,12).map(s=>compactItem(
    s.student_name||'Ученик',
    `${fmt(s.next_payment_at)} · ${rub(s.monthly_price_rub)} · ${s.tariff||'тариф не указан'}`,
    'Открыть',`data-open-student="${esc(s.id)}"`,
    daysUntil(s.next_payment_at)<=7?'orange':'green'
  )).join('')||empty('На 30 дней оплат не запланировано');
}

$('#financeShowDebtors').addEventListener('click',()=>{
  if($('#financeShowDebtors').disabled)return;
  financeDebtorsOnly=!financeDebtorsOnly;
  renderFinance();
  $('#duePayments').scrollIntoView({behavior:'smooth',block:'center'});
});
$('#financeToggleDue').addEventListener('click',()=>{
  financeDebtorsOnly=false;
  renderFinance();
  $('#duePayments').scrollIntoView({behavior:'smooth',block:'center'});
});

// ---------- CRM календарь ----------
function crmMonthTitle(y,m){
  return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'})
    .format(new Date(y,m,1)).replace(/\s?г\.?$/,'').replace(/^./,c=>c.toUpperCase())
}
function keyDate(key){
  const [y,m,d]=String(key||todayKey()).split('-').map(Number);
  return new Date(y,m-1,d,12,0,0,0);
}
function dateToKeyLocal(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function shiftKey(key,days){
  const d=keyDate(key);d.setDate(d.getDate()+days);return dateToKeyLocal(d);
}
function weekStartKey(key){
  const d=keyDate(key),dow=(d.getDay()+6)%7;
  d.setDate(d.getDate()-dow);
  return dateToKeyLocal(d);
}
function weekKeys(key){
  const start=weekStartKey(key);
  return Array.from({length:7},(_,i)=>shiftKey(start,i));
}

function groupSessionEventsForKeys(keys){
  const keySet=new Set(keys||[]);
  const result=[];
  STATE.groups.filter(g=>['Набор','Активна'].includes(g.status)).forEach(g=>{
    const members=groupMembers(g.id);
    groupSlots(g.id).forEach(slot=>{
      keySet.forEach(key=>{
        const d=keyDate(key);
        const weekday=((d.getDay()+6)%7)+1;
        if(weekday!==Number(slot.weekday))return;
        const at=new Date(`${key}T${slot.start_time}:00+03:00`).toISOString();
        result.push({
          kind:'group',at,durationMin:Number(slot.duration_min||60),
          title:`Группа · ${g.name||'Без названия'}`,
          person:g.name||'Группа',
          teacher:g.teacher_id||'Не назначен',
          groupId:g.id,slotId:slot.id,status:g.status,
          memberCount:members.length,capacity:Number(g.capacity||6)
        });
      });
    });
  });
  return result.sort((a,b)=>new Date(a.at)-new Date(b.at));
}
function calendarEventsForKeys(keys){
  return [...allCalendarEvents(),...groupSessionEventsForKeys(keys)]
    .filter(e=>keys.includes(dateKey(e.at)))
    .filter(e=>!calendarTeacherFilter||e.teacher===calendarTeacherFilter)
    .sort((a,b)=>new Date(a.at)-new Date(b.at));
}

function weekTitle(key){
  const keys=weekKeys(key),a=keyDate(keys[0]),b=keyDate(keys[6]);
  const sameMonth=a.getMonth()===b.getMonth()&&a.getFullYear()===b.getFullYear();
  const sameYear=a.getFullYear()===b.getFullYear();
  if(sameMonth){
    const month=new Intl.DateTimeFormat('ru-RU',{month:'long'}).format(a);
    return `${a.getDate()}–${b.getDate()} ${month} ${a.getFullYear()}`;
  }
  if(sameYear){
    const am=new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(a).replace('.','');
    const bm=new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(b).replace('.','');
    return `${a.getDate()} ${am} – ${b.getDate()} ${bm} ${a.getFullYear()}`;
  }
  return `${a.toLocaleDateString('ru-RU')} – ${b.toLocaleDateString('ru-RU')}`;
}
function dayLabel(key){
  const d=keyDate(key);
  return {
    weekday:new Intl.DateTimeFormat('ru-RU',{weekday:'short'}).format(d).replace('.',''),
    day:d.getDate(),
    month:new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(d).replace('.','')
  };
}
function eventKey(e){return `${e.kind}:${e.lessonId||e.leadId||`${e.at}:${e.teacher}`}`}
function eventEndMs(e){
  return new Date(e.at).getTime()+Math.max(15,Number(e.durationMin||60))*60000;
}
function allCalendarEvents(){
  const trials=STATE.leads
    .filter(l=>l.trial_at)
    .map(l=>({
      kind:'trial',at:l.trial_at,durationMin:60,
      title:`Пробный · ${l.student_name||l.parent_name||'Ученик'}`,
      person:l.student_name||l.parent_name||'Ученик',
      teacher:l.teacher_id||'Не назначен',leadId:l.id,status:l.status
    }));
  const lessons=STATE.lessons.map(l=>{
    const s=STATE.students.find(x=>String(x.id)===String(l.student_id));
    return {
      kind:'lesson',at:l.starts_at,durationMin:Number(l.duration_min||60),
      title:`${l.lesson_type||'Занятие'} · ${s?.student_name||'Ученик'}`,
      person:s?.student_name||'Ученик',
      teacher:l.teacher_id||s?.teacher_id||'Не назначен',
      studentId:l.student_id,lessonId:l.id,status:l.status||'Запланировано'
    };
  });
  return [...trials,...lessons].filter(e=>e.at).sort((a,b)=>new Date(a.at)-new Date(b.at));
}
function calendarVisibleEvents(){
  return allCalendarEvents().filter(e=>!calendarTeacherFilter||e.teacher===calendarTeacherFilter);
}
function calendarConflictPairs(events=allCalendarEvents()){
  const usable=events.filter(e=>e.teacher&&e.teacher!=='Не назначен'&&e.status!=='Отменено');
  const byTeacher=new Map();
  usable.forEach(e=>{
    if(!byTeacher.has(e.teacher))byTeacher.set(e.teacher,[]);
    byTeacher.get(e.teacher).push(e);
  });
  const pairs=[];
  byTeacher.forEach((list,teacher)=>{
    list.sort((a,b)=>new Date(a.at)-new Date(b.at));
    for(let i=0;i<list.length;i++){
      const a=list[i],aStart=new Date(a.at).getTime(),aEnd=eventEndMs(a);
      for(let j=i+1;j<list.length;j++){
        const b=list[j],bStart=new Date(b.at).getTime();
        if(bStart>=aEnd)break;
        const bEnd=eventEndMs(b);
        if(aStart<bEnd&&bStart<aEnd)pairs.push({teacher,a,b});
      }
    }
  });
  return pairs;
}
function calendarConflictKeys(events=null){
  const set=new Set();
  calendarConflictPairs(events||allCalendarEvents()).forEach(p=>{set.add(eventKey(p.a));set.add(eventKey(p.b))});
  return set;
}
function calendarRangeKeys(){
  if(calendarMode==='week')return weekKeys(selectedAgendaKey||todayKey());
  const y=crmCalView.year,m=crmCalView.month,dim=new Date(y,m+1,0).getDate();
  return Array.from({length:dim},(_,i)=>`${y}-${pad2(m+1)}-${pad2(i+1)}`);
}
function calendarEventButton(e,conflicts){
  const p=moscowParts(e.at);
  const end=moscowParts(new Date(eventEndMs(e)).toISOString());
  const openAttr=e.groupId?`data-open-group="${esc(e.groupId)}"`:(e.leadId?`data-open-lead="${esc(e.leadId)}"`:`data-open-student="${esc(e.studentId)}"`);
  return `<button type="button" class="week-event ${e.kind} ${conflicts.has(eventKey(e))?'conflict':''} ${e.status==='Отменено'?'cancelled':''}" ${openAttr}>
    <span class="week-event-time">${p?.hour}:${p?.minute}–${end?.hour}:${end?.minute}</span>
    <b>${esc(e.person)}</b>
    <small>${esc(e.teacher)} · ${esc(e.kind==='trial'?'Пробный':(e.kind==='group'?`Группа ${e.memberCount}/${e.capacity}`:(e.status||'Занятие')))}</small>
  </button>`;
}
function renderCalendarMetrics(){
  const now=Date.now(),next7=now+7*86400000;
  const keys=Array.from({length:8},(_,i)=>shiftKey(todayKey(),i));
  const events=calendarEventsForKeys(keys);
  const today=events.filter(e=>dateKey(e.at)===todayKey()&&e.status!=='Отменено');
  const week=events.filter(e=>{
    const t=new Date(e.at).getTime();
    return t>=now&&t<=next7&&e.status!=='Отменено';
  });
  const conflicts=calendarConflictPairs(events);
  const unassigned=STATE.leads.filter(l=>l.trial_at&&new Date(l.trial_at).getTime()>=now&&(!l.teacher_id||l.teacher_id==='Не назначен'));
  $('#cal-m-today').textContent=today.length;
  $('#cal-m-week').textContent=week.length;
  $('#cal-m-conflicts').textContent=conflicts.length;
  $('#cal-m-unassigned').textContent=unassigned.length;
}

function renderCalendarWeek(){
  const keys=weekKeys(selectedAgendaKey||todayKey());
  const events=calendarEventsForKeys(keys),conflicts=calendarConflictKeys(calendarEventsForKeys(keys));
  $('#calendarWeekGrid').innerHTML=keys.map(key=>{
    const label=dayLabel(key),dayEvents=events.filter(e=>dateKey(e.at)===key);
    return `<section class="calendar-week-day ${key===todayKey()?'today':''} ${key===selectedAgendaKey?'selected':''}">
      <button type="button" class="calendar-week-day-head" data-calendar-day="${key}">
        <span>${esc(label.weekday)}</span><strong>${label.day}</strong><small>${esc(label.month)}</small>
      </button>
      <div class="calendar-week-events">
        ${dayEvents.map(e=>calendarEventButton(e,conflicts)).join('')||'<div class="week-day-empty">Свободно</div>'}
      </div>
      <button type="button" class="week-add" data-add-day="${key}">+ занятие</button>
    </section>`;
  }).join('');
}
function renderCalendarMonth(){
  const grid=$('#crmCalendarGrid');grid.innerHTML='';
  const first=new Date(crmCalView.year,crmCalView.month,1),
    start=(first.getDay()+6)%7,
    dim=new Date(crmCalView.year,crmCalView.month+1,0).getDate(),
    prev=new Date(crmCalView.year,crmCalView.month,0).getDate();
  const monthKeys=[];
  for(let i=0;i<42;i++){
    let y=crmCalView.year,m=crmCalView.month,d;
    if(i<start){d=prev-start+i+1;m--;if(m<0){m=11;y--}}
    else if(i>=start+dim){d=i-(start+dim)+1;m++;if(m>11){m=0;y++}}
    else d=i-start+1;
    monthKeys.push(`${y}-${pad2(m+1)}-${pad2(d)}`);
  }
  const events=calendarEventsForKeys(monthKeys),
    conflicts=calendarConflictKeys(events);

  for(let i=0;i<42;i++){
    let y=crmCalView.year,m=crmCalView.month,d,out=false;
    if(i<start){d=prev-start+i+1;m--;if(m<0){m=11;y--}out=true}
    else if(i>=start+dim){d=i-(start+dim)+1;m++;if(m>11){m=0;y++}out=true}
    else d=i-start+1;
    const key=`${y}-${pad2(m+1)}-${pad2(d)}`;
    const ev=events.filter(e=>dateKey(e.at)===key);
    const conflictCount=ev.filter(e=>conflicts.has(eventKey(e))).length;
    const b=document.createElement('button');
    b.type='button';
    b.className=`crm-day ${out?'outside':''} ${key===todayKey()?'today':''} ${key===selectedAgendaKey?'selected':''} ${conflictCount?'has-conflict':''}`;
    b.innerHTML=`<b>${d}</b>
      <div class="event-dots">${ev.slice(0,5).map(e=>`<i class="${e.kind} ${conflicts.has(eventKey(e))?'conflict':''}"></i>`).join('')}</div>
      ${ev.length?`<small>${ev.length}</small>`:''}`;
    b.onclick=()=>{selectedAgendaKey=key;renderCrmCalendar()};
    grid.appendChild(b);
  }
}
function renderAgenda(){
  const events=calendarEventsForKeys([selectedAgendaKey]);
  const [y,m,d]=selectedAgendaKey.split('-');
  const date=keyDate(selectedAgendaKey);
  const weekday=new Intl.DateTimeFormat('ru-RU',{weekday:'long'}).format(date);
  $('#agendaTitle').textContent=`${d}.${m}.${y} · ${weekday}`;
  $('#agendaSummary').innerHTML=`
    <span><b>${events.length}</b> событий</span>
    <span><b>${events.filter(e=>e.kind==='trial').length}</b> пробных</span>
    <span><b>${new Set(events.filter(e=>e.teacher!=='Не назначен').map(e=>e.teacher)).size}</b> преподавателей</span>`;

  const conflicts=calendarConflictKeys(events);
  $('#dayAgenda').innerHTML=events.map(e=>{
    const p=moscowParts(e.at),end=moscowParts(new Date(eventEndMs(e)).toISOString());
    const conflict=conflicts.has(eventKey(e));
    const action=e.groupId
      ? `<button data-open-group="${esc(e.groupId)}">Группа</button>`
      : (e.leadId
        ? `<button data-open-lead="${esc(e.leadId)}">Заявка</button>`
        : `<div class="agenda-actions"><button data-open-student="${esc(e.studentId)}">Ученик</button>${e.status==='Запланировано'?`<button class="agenda-done" data-lesson-done="${esc(e.lessonId)}">✓</button>`:''}</div>`);
    return `<div class="agenda-item ${e.kind} ${conflict?'conflict':''} ${e.status==='Отменено'?'cancelled':''}">
      <div>
        <b>${p?.hour}:${p?.minute}–${end?.hour}:${end?.minute} · ${esc(e.title)}</b>
        <small>${esc(e.teacher)} · ${esc(e.status||'')}</small>
        ${conflict?'<em>⚠ Пересечение расписания</em>':''}
      </div>${action}
    </div>`;
  }).join('')||empty('На этот день событий нет');
}
function renderCalendarConflicts(){
  const range=new Set(calendarRangeKeys());
  const rangeKeys=[...range]; const pairs=calendarConflictPairs(calendarEventsForKeys(rangeKeys));
  $('#calendarConflictCaption').textContent=pairs.length?`${pairs.length} пересечений`:'конфликтов нет';
  $('#calendarConflictList').innerHTML=pairs.map(p=>`
    <div class="calendar-conflict-row">
      <span>!</span>
      <div>
        <b>${esc(p.teacher)} · ${esc(shortFmt(p.a.at))}</b>
        <small>${esc(p.a.title)} ↔ ${esc(p.b.title)}</small>
      </div>
    </div>`).join('')||`
    <div class="calendar-all-clear"><i>✓</i><div><b>Пересечений нет</b><small>У преподавателей нет одновременных событий в выбранном периоде.</small></div></div>`;
}
function renderCalendarTeacherLoad(){
  const keys=new Set(weekKeys(selectedAgendaKey||todayKey()));
  const events=calendarEventsForKeys([...keys]).filter(e=>e.status!=='Отменено');
  const rows=TEACHERS.map(name=>{
    const count=events.filter(e=>e.teacher===name).length;
    const teacher=STATE.teachers.find(t=>t.name===name);
    const cap=Math.max(1,Number(teacher?.weekly_capacity||20));
    const pct=Math.min(100,Math.round(count/cap*100));
    return {name,count,cap,pct};
  });
  const max=Math.max(1,...rows.map(r=>r.count));
  $('#calendarTeacherLoad').innerHTML=rows.map(r=>`
    <button type="button" class="${calendarTeacherFilter===r.name?'active':''}" data-calendar-teacher="${esc(r.name)}">
      <div><b>${esc(r.name)}</b><small>${r.count} событий · ёмкость ${r.cap}</small></div>
      <span><i style="width:${Math.max(3,Math.round(r.count/max*100))}%"></i></span>
      <strong>${r.pct}%</strong>
    </button>`).join('');
}
function renderCrmCalendar(){
  if(!selectedAgendaKey)selectedAgendaKey=todayKey();
  if(!crmCalView){
    const p=moscowParts(new Date().toISOString());
    crmCalView={year:+p.year,month:+p.month-1};
  }

  calendarTeacherFilter=$('#calendarTeacherFilter')?.value||calendarTeacherFilter||'';
  $('#calendarWeekMode').classList.toggle('active',calendarMode==='week');
  $('#calendarMonthMode').classList.toggle('active',calendarMode==='month');
  $('#calendarWeekView').hidden=calendarMode!=='week';
  $('#calendarMonthView').hidden=calendarMode!=='month';

  if(calendarMode==='week'){
    $('#crmCalTitle').textContent=weekTitle(selectedAgendaKey);
    renderCalendarWeek();
  }else{
    $('#crmCalTitle').textContent=crmMonthTitle(crmCalView.year,crmCalView.month);
    renderCalendarMonth();
  }

  renderCalendarMetrics();
  renderAgenda();
  renderCalendarConflicts();
  renderCalendarTeacherLoad();
}
function navigateCalendar(direction){
  if(calendarMode==='week'){
    selectedAgendaKey=shiftKey(selectedAgendaKey||todayKey(),direction*7);
    const d=keyDate(selectedAgendaKey);
    crmCalView={year:d.getFullYear(),month:d.getMonth()};
  }else{
    const d=new Date(crmCalView.year,crmCalView.month+direction,1);
    crmCalView={year:d.getFullYear(),month:d.getMonth()};
    const selected=keyDate(selectedAgendaKey||todayKey());
    if(selected.getFullYear()!==crmCalView.year||selected.getMonth()!==crmCalView.month){
      selectedAgendaKey=`${crmCalView.year}-${pad2(crmCalView.month+1)}-01`;
    }
  }
  renderCrmCalendar();
}
function openLessonForDay(key){
  const value=`${key}T18:00`;
  openLessonModal('',calendarTeacherFilter||'',value);
}
$('#crmCalPrev').onclick=()=>navigateCalendar(-1);
$('#crmCalNext').onclick=()=>navigateCalendar(1);
$('#calendarToday').onclick=()=>{
  const p=moscowParts(new Date().toISOString());
  crmCalView={year:+p.year,month:+p.month-1};
  selectedAgendaKey=todayKey();
  renderCrmCalendar();
};
$('#calendarWeekMode').onclick=()=>{calendarMode='week';renderCrmCalendar()};
$('#calendarMonthMode').onclick=()=>{calendarMode='month';const d=keyDate(selectedAgendaKey||todayKey());crmCalView={year:d.getFullYear(),month:d.getMonth()};renderCrmCalendar()};
$('#calendarTeacherFilter').addEventListener('change',()=>{calendarTeacherFilter=$('#calendarTeacherFilter').value;renderCrmCalendar()});
$('#calendarAddForDay').onclick=()=>openLessonForDay(selectedAgendaKey||todayKey());

document.addEventListener('click',e=>{
  const day=e.target.closest('[data-calendar-day]');
  if(day){selectedAgendaKey=day.dataset.calendarDay;renderCrmCalendar();return}
  const add=e.target.closest('[data-add-day]');
  if(add){e.stopPropagation();selectedAgendaKey=add.dataset.addDay;openLessonForDay(add.dataset.addDay);return}
  const teacher=e.target.closest('[data-calendar-teacher]');
  if(teacher){
    const name=teacher.dataset.calendarTeacher;
    calendarTeacherFilter=calendarTeacherFilter===name?'':name;
    $('#calendarTeacherFilter').value=calendarTeacherFilter;
    renderCrmCalendar();
  }
});

// ---------- Статистика ----------
function statsLeadReached(l,stage){
  const status=String(l.status||'Новая');
  const contacted=['Связались','Пробный','Пробный проведён','Записан','Оплатил'];
  const trial=['Пробный','Пробный проведён','Записан','Оплатил'];
  if(stage==='contacted')return contacted.includes(status);
  if(stage==='trial')return trial.includes(status);
  if(stage==='paid')return status==='Оплатил';
  return true;
}
function statsPeriodStart(){
  const raw=$('#statsPeriod')?.value||'90';
  if(raw==='all')return null;
  return Date.now()-Number(raw||90)*86400000;
}
function statsFilteredLeads(){
  const from=statsPeriodStart(),source=$('#statsSource')?.value||'';
  return STATE.leads.filter(l=>{
    const t=new Date(l.created_at).getTime();
    return (!from||t>=from)&&(!source||(l.source||'Не указан')===source);
  });
}
function statsPct(a,b){return b?Math.round(a/b*100):0}
function statsSourceData(leads){
  const map=new Map();
  leads.forEach(l=>{
    const name=l.source||'Не указан';
    const row=map.get(name)||{name,total:0,trial:0,paid:0};
    row.total++;
    if(statsLeadReached(l,'trial'))row.trial++;
    if(statsLeadReached(l,'paid'))row.paid++;
    map.set(name,row);
  });
  return [...map.values()].map(r=>({...r,trialPct:statsPct(r.trial,r.total),paidPct:statsPct(r.paid,r.total)})).sort((a,b)=>b.total-a.total||b.paidPct-a.paidPct);
}
function statsTeacherData(leads){
  return TEACHERS.map(name=>{
    const assigned=leads.filter(l=>l.teacher_id===name);
    const trials=assigned.filter(l=>statsLeadReached(l,'trial')).length;
    const paid=assigned.filter(l=>statsLeadReached(l,'paid')).length;
    const d=teacherData(name);
    return {name,total:assigned.length,trials,paid,paidPct:statsPct(paid,assigned.length),active:d.students.length,load:d.loadPct};
  });
}
function statsOutcomeClass(status){
  if(status==='Оплатил')return 'paid';
  if(['Отказ','Не подходит'].includes(status))return 'lost';
  if(['Пробный','Пробный проведён','Записан'].includes(status))return 'trial';
  if(status==='Связались')return 'contacted';
  if(['Не отвечает','Отложено'].includes(status))return 'waiting';
  return 'new';
}
function statsMonthBuckets(leads){
  const buckets=[];
  for(let offset=-5;offset<=0;offset++){
    const date=monthStartOffset(offset),key=monthBucketKey(date);
    const leadCount=leads.filter(l=>monthKey(l.created_at)===key).length;
    const paidCount=leads.filter(l=>monthKey(l.created_at)===key&&statsLeadReached(l,'paid')).length;
    buckets.push({key,label:monthLabelShort(date),leadCount,paidCount});
  }
  return buckets;
}
function statsSourceOptionSync(){
  const select=$('#statsSource');if(!select)return;
  const current=select.value;
  const sources=[...new Set(STATE.leads.map(l=>l.source||'Не указан'))].sort((a,b)=>a.localeCompare(b,'ru'));
  select.innerHTML='<option value="">Все источники</option>'+sources.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if(sources.includes(current))select.value=current;
}

function renderStats(){
  statsSourceOptionSync();
  const leads=statsFilteredLeads();
  const total=leads.length;
  const contacted=leads.filter(l=>statsLeadReached(l,'contacted')).length;
  const trial=leads.filter(l=>statsLeadReached(l,'trial')).length;
  const paid=leads.filter(l=>statsLeadReached(l,'paid')).length;
  const lost=leads.filter(l=>['Отказ','Не подходит'].includes(l.status)).length;
  const conversion=statsPct(paid,total);

  $('#statsMainConversion').textContent=`${conversion}%`;
  $('#statsMainCaption').textContent=`${paid} оплат из ${total} заявок`;
  $('#allLeadsStat').textContent=total;
  $('#statsContacted').textContent=`${statsPct(contacted,total)}%`;
  $('#statsContactedCount').textContent=`${contacted} заявок`;
  $('#conv1').textContent=`${statsPct(trial,total)}%`;
  $('#statsTrialCount').textContent=`${trial} пробных`;
  $('#conv2').textContent=`${statsPct(paid,trial)}%`;
  $('#statsPaidCount').textContent=`${paid} оплат`;
  $('#paidStudents').textContent=STATE.students.filter(s=>s.status==='Активен').length;
  $('#statsLost').textContent=lost;
  $('#statsLostMeta').textContent=`${statsPct(lost,total)}% от заявок`;

  const period=$('#statsPeriod').value;
  $('#statsLeadDelta').textContent=period==='all'?'за всё время':`за последние ${period} дней`;

  const sources=statsSourceData(leads);
  const bestSource=[...sources].filter(x=>x.total>=2).sort((a,b)=>b.paidPct-a.paidPct||b.paid-a.paid||b.total-a.total)[0]||sources[0];
  $('#statsBestSource').textContent=bestSource?.name||'—';
  $('#statsBestSourceMeta').textContent=bestSource?`${bestSource.paidPct}% в оплату · ${bestSource.total} заявок`:'Недостаточно данных';

  const teachers=statsTeacherData(leads);
  const bestTeacher=[...teachers].filter(x=>x.total>=1).sort((a,b)=>b.paidPct-a.paidPct||b.paid-a.paid||a.load-b.load)[0];
  $('#statsBestTeacher').textContent=bestTeacher?.name||'—';
  $('#statsBestTeacherMeta').textContent=bestTeacher?`${bestTeacher.paidPct}% в оплату · ${bestTeacher.paid} оплат`:'Недостаточно данных';

  const funnel=[
    {name:'Заявки',value:total,base:total},
    {name:'Связались',value:contacted,base:total},
    {name:'Пробный',value:trial,base:contacted},
    {name:'Оплата',value:paid,base:trial}
  ];
  $('#statsFunnel').innerHTML=funnel.map((x,i)=>{
    const overall=statsPct(x.value,total),step=i===0?100:statsPct(x.value,x.base);
    return `<div class="stats-funnel-step">
      <div class="stats-funnel-number">${x.value}</div>
      <div class="stats-funnel-copy"><b>${esc(x.name)}</b><small>${i===0?'100% база':`${step}% от прошлого этапа`}</small></div>
      <div class="stats-funnel-track"><i style="width:${overall}%"></i></div>
      <strong>${overall}%</strong>
    </div>`;
  }).join('');
  $('#statsFunnelCaption').textContent=`Итоговая конверсия ${conversion}%`;

  const statusMap=new Map();
  leads.forEach(l=>{const status=l.status||'Новая';statusMap.set(status,(statusMap.get(status)||0)+1)});
  const statuses=[...statusMap.entries()].sort((a,b)=>b[1]-a[1]);
  $('#statsOutcomes').innerHTML=statuses.map(([status,count])=>`
    <div class="stats-outcome-row">
      <span class="stats-outcome-dot ${statsOutcomeClass(status)}"></span>
      <b>${esc(status)}</b>
      <div class="stats-outcome-track"><i style="width:${statsPct(count,total)}%"></i></div>
      <strong>${count}</strong><small>${statsPct(count,total)}%</small>
    </div>`).join('')||empty('Нет данных за выбранный период');
  $('#statsOutcomeCaption').textContent=`${statuses.length} статусов`;

  const months=statsMonthBuckets(leads),monthMax=Math.max(1,...months.map(x=>x.leadCount));
  $('#statsMonthChart').innerHTML=months.map(x=>{
    const leadH=x.leadCount?Math.max(5,Math.round(x.leadCount/monthMax*100)):2;
    const paidH=x.paidCount?Math.max(5,Math.round(x.paidCount/monthMax*100)):2;
    return `<div class="stats-month-col">
      <div class="stats-month-values"><span>${x.leadCount}</span><span>${x.paidCount}</span></div>
      <div class="stats-month-bars"><i class="lead" style="height:${leadH}%"></i><i class="paid" style="height:${paidH}%"></i></div>
      <b>${esc(x.label)}</b>
    </div>`;
  }).join('');
  const recent=months[months.length-1],prev=months[months.length-2];
  const leadTrend=prev?.leadCount?Math.round((recent.leadCount-prev.leadCount)/prev.leadCount*100):null;
  $('#statsMonthCaption').textContent=leadTrend===null?'6 месяцев':`${leadTrend>=0?'+':''}${leadTrend}% заявок к прошлому месяцу`;

  const now=Date.now(),freshNew=leads.filter(l=>l.status==='Новая');
  const stale2=freshNew.filter(l=>new Date(l.created_at).getTime()<now-2*3600000);
  const stale24=freshNew.filter(l=>new Date(l.created_at).getTime()<now-24*3600000);
  const futureTrials=leads.filter(l=>l.trial_at&&new Date(l.trial_at)>new Date()&&(!l.teacher_id||l.teacher_id==='Не назначен'));
  const leadTaskIds=new Set(STATE.tasks.filter(t=>!t.done&&t.lead_id).map(t=>String(t.lead_id)));
  const noTask=freshNew.filter(l=>!leadTaskIds.has(String(l.id)));
  $('#statsStale2').textContent=stale2.length;
  $('#statsStale24').textContent=stale24.length;
  $('#statsNoTeacherTrials').textContent=futureTrials.length;
  $('#statsNoTask').textContent=noTask.length;

  $('#statsSourceRows').innerHTML=sources.map((s,i)=>`
    <tr>
      <td><div class="stats-source-name">${i===0?'★ ':''}${esc(s.name)}</div></td>
      <td>${s.total}</td><td>${s.trial}</td><td>${s.paid}</td>
      <td><span class="stats-rate">${s.trialPct}%</span></td>
      <td><span class="stats-rate ${s.paidPct>=conversion&&s.paid?'good':''}">${s.paidPct}%</span></td>
    </tr>`).join('')||`<tr><td colspan="6">${empty('Нет источников за выбранный период')}</td></tr>`;
  $('#statsSourceCaption').textContent=`${sources.length} источников`;

  const teacherRows=[...teachers].sort((a,b)=>b.paid-a.paid||b.trials-a.trials||a.load-b.load);
  $('#statsTeacherRows').innerHTML=teacherRows.map(t=>`
    <tr>
      <td><b>${esc(t.name)}</b></td><td>${t.total}</td><td>${t.trials}</td><td>${t.paid}</td>
      <td><span class="stats-rate ${t.paidPct>=conversion&&t.paid?'good':''}">${t.paidPct}%</span></td>
      <td>${t.active}</td>
      <td><div class="stats-load"><span><i style="width:${Math.min(100,t.load)}%"></i></span><b>${t.load}%</b></div></td>
    </tr>`).join('');
  $('#statsTeacherCaption').textContent=`${teacherRows.length} преподавателей`;
}

$('#statsPeriod').addEventListener('change',renderStats);
$('#statsSource').addEventListener('change',renderStats);

// ---------- Настройки ----------
function setSystemStatus(id,state,title,meta){
  const card=$(id); if(!card)return;
  card.classList.remove('ok','warn','bad','pending');
  card.classList.add(state);
  const titleEl=card.querySelector('strong');
  const metaEl=card.querySelector('small');
  if(titleEl)titleEl.textContent=title;
  if(metaEl)metaEl.textContent=meta;
}

function renderDiagnostics(){
  const d=STATE.diagnostics;
  if(!d)return;

  $('#backendVersion').textContent=`Backend: ${d.backendVersion||'—'}`;
  $('#diagnosticsCheckedAt').textContent=d.serverTime?`проверено ${fmt(d.serverTime)}`:'проверено';

  setSystemStatus('#statusApi','ok','Работает',`API ${d.backendVersion||''}`.trim());
  setSystemStatus('#statusDb',d.database?.ok?'ok':'bad',d.database?.ok?'Подключена':'Ошибка',d.database?.message||'YDB');
  setSystemStatus(
    '#statusTelegram',
    d.telegram?.configured?'ok':'warn',
    d.telegram?.configured?'Подключён':'Не настроен',
    d.telegram?.configured?'Bot token и chat ID найдены':'Нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID'
  );
  setSystemStatus('#statusSession','ok','Активна',d.sessionExpiresAt?`до ${fmt(d.sessionExpiresAt)}`:'Подписанная сессия');

  const warnings=[...(d.warnings||[]),...(STATE.warnings||[])];
  const uniqueWarnings=[...new Set(warnings.filter(Boolean))];
  $('#diagnosticsWarnings').hidden=!uniqueWarnings.length;
  $('#diagnosticsWarnings').innerHTML=uniqueWarnings.length
    ? `<b>Обнаружены предупреждения</b>${uniqueWarnings.map(w=>`<span>${esc(w)}</span>`).join('')}`
    : '';

  const tableOrder=['leads','lead_events','students','groups','group_slots','group_members','group_attendance','payments','tasks','lessons','teachers','auth_log'];
  const labels={
    leads:'Заявки',lead_events:'История заявок',students:'Ученики',groups:'Группы',group_slots:'Расписание групп',group_members:'Состав групп',group_attendance:'Посещаемость групп',payments:'Оплаты',
    tasks:'Задачи',lessons:'Занятия',teachers:'Преподаватели',auth_log:'Журнал входов'
  };
  $('#diagnosticsTables').innerHTML=tableOrder.map(key=>{
    const row=d.tables?.[key]||{};
    const ok=row.ok!==false;
    const count=Number.isFinite(Number(row.count))?Number(row.count):'—';
    return `<div class="diagnostic-table-row ${ok?'ok':'bad'}">
      <i>${ok?'✓':'!'}</i>
      <div><b>${esc(labels[key]||key)}</b><small>${ok?'Таблица доступна':esc(row.error||'Ошибка чтения')}</small></div>
      <strong>${count}</strong>
    </div>`;
  }).join('');

  const healthBad=!d.database?.ok || (d.tables&&Object.values(d.tables).some(x=>x&&x.ok===false));
  const healthWarn=!d.telegram?.configured || uniqueWarnings.length>0;
  $('#systemHealthIcon').textContent=healthBad?'!':(healthWarn?'●':'✓');
  $('#systemHealthTitle').textContent=healthBad?'Нужна проверка':(healthWarn?'Работает с замечаниями':'Всё работает');
  $('#systemHealthMeta').textContent=healthBad
    ? 'Есть ошибка API/YDB. Откройте диагностику ниже.'
    : (healthWarn?'Основные функции доступны, но есть необязательные замечания.':'API, база и интеграции отвечают штатно.');
  $('.system-health-hero').classList.toggle('bad',healthBad);
  $('.system-health-hero').classList.toggle('warn',!healthBad&&healthWarn);

  const tgCheck=$('#securityTelegramCheck');
  tgCheck.className=d.telegram?.configured?'done':'warn';
  tgCheck.querySelector('i').textContent=d.telegram?.configured?'✓':'!';
  tgCheck.querySelector('small').textContent=d.telegram?.configured
    ? 'Интеграция настроена.'
    : 'Telegram пока не настроен. Это не мешает работе CRM.';
}

function renderSettings(){
  const telegramConfigured=Boolean(STATE.features.telegramConfigured);
  $('#telegramState').textContent=telegramConfigured
    ?'Telegram подключён. Ручную сводку можно отправить прямо отсюда.'
    :'Telegram пока не подключён: нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.';
  $('#sendTelegramDigest').disabled=!telegramConfigured;

  $('#sessionInfo').textContent=STATE.session.expiresAt
    ?`Текущая сессия администратора активна до ${fmt(STATE.session.expiresAt)}.`
    :'Подписанная сессия администратора активна.';

  setSystemStatus('#statusApi','ok','Работает','Последний bootstrap выполнен успешно');
  setSystemStatus('#statusDb',STATE.warnings.length?'warn':'ok',STATE.warnings.length?'Есть замечания':'Подключена',STATE.warnings.length?`${STATE.warnings.length} предупреждений`:'Данные CRM загружены');
  setSystemStatus('#statusTelegram',telegramConfigured?'ok':'warn',telegramConfigured?'Подключён':'Не настроен',telegramConfigured?'Сводки доступны':'CRM работает без Telegram');
  setSystemStatus('#statusSession','ok','Активна',STATE.session.expiresAt?`до ${fmt(STATE.session.expiresAt)}`:'8 часов');

  if(!STATE.diagnostics){
    $('#systemHealthIcon').textContent=STATE.warnings.length?'●':'✓';
    $('#systemHealthTitle').textContent=STATE.warnings.length?'Работает с замечаниями':'CRM работает';
    $('#systemHealthMeta').textContent=STATE.warnings.length
      ?`${STATE.warnings.length} предупреждений при загрузке данных. Запустите диагностику.`
      :'API и база ответили на последнюю синхронизацию.';
  }else{
    renderDiagnostics();
  }

  $('#authLogCaption').textContent=`${STATE.authLog.length} событий загружено`;
  $('#authLog').innerHTML=STATE.authLog.slice(0,20).map(a=>`
    <div class="auth-row auth-row-pro">
      <span class="${a.success?'ok':'fail'}">${a.success?'✓':'!'}</span>
      <div><b>${esc(a.action||'login')}</b><small>${esc(a.ip||'IP не указан')}</small></div>
      <time>${fmt(a.created_at)}</time>
    </div>`).join('')||empty('Журнал входов пуст');

  $('#teacherSettings').innerHTML=TEACHERS.map(name=>{
    const t=STATE.teachers.find(x=>x.name===name)||{};
    return `<div class="teacher-setting" data-teacher-row="${esc(t.id||name.toLowerCase())}">
      <b>${esc(name)}</b>
      <label>Недельная ёмкость<input data-capacity type="number" value="${Number(t.weekly_capacity||20)}" min="0" max="100"></label>
      <label>Telegram<input data-telegram value="${esc(t.telegram||'')}" placeholder="@username"></label>
      <label class="inline-check"><input data-active type="checkbox" ${t.active===false?'':'checked'}> Активен</label>
      <button data-save-teacher="${esc(t.id||name.toLowerCase())}">Сохранить</button>
    </div>`;
  }).join('');
}

async function runSystemDiagnostics(){
  const btn=$('#runDiagnostics');
  const oldText=btn.textContent;
  btn.disabled=true; btn.textContent='Проверяю…';
  setSystemStatus('#statusApi','pending','Проверяю','Запрос к backend');
  setSystemStatus('#statusDb','pending','Проверяю','YDB');
  try{
    const d=await api('diagnostics');
    STATE.diagnostics=d;
    renderDiagnostics();
    toast('Диагностика завершена');
  }catch(e){
    setSystemStatus('#statusApi','bad','Ошибка',e.message);
    $('#systemHealthIcon').textContent='!';
    $('#systemHealthTitle').textContent='Нет связи с диагностикой';
    $('#systemHealthMeta').textContent=e.message;
    showError(e.message);
  }finally{
    btn.disabled=false; btn.textContent=oldText;
  }
}

$('#runDiagnostics').onclick=runSystemDiagnostics;
$('#settingsRefresh').onclick=async()=>{
  try{await refreshData();if(location.hash==='#settings'||$('#page-settings').classList.contains('active'))await runSystemDiagnostics()}catch{}
};
$('#sendTelegramDigest').onclick=async()=>{
  try{await api('sendTelegramDigest');toast('Сводка отправлена в Telegram')}
  catch(e){showError(e.message)}
};
$('#revokeSessions').onclick=async()=>{
  try{
    const d=await api('revokeOtherSessions');
    toast(d.note||'Сессии истекают автоматически');
  }catch(e){showError(e.message)}
};
$('#logoutCurrent').onclick=async()=>{
  try{await api('logout')}catch{}
  token='';
  sessionStorage.removeItem(SESSION_KEY);
  document.body.classList.remove('is-authenticated');
  $('#authOverlay').style.display='grid';
  toast('Вы вышли из CRM');
};

// ---------- Модальные окна, задачи, оплаты, занятия ----------
function openModal(id){
  $('#modalShade').hidden=false;
  const modal=$(id);
  if(modal)modal.hidden=false;
}
function closeModals(){
  $$('.modal').forEach(x=>x.hidden=true);
  const shade=$('#modalShade');
  if(shade)shade.hidden=true;
}
$$('[data-modal-close]').forEach(b=>b.onclick=closeModals);
$('#modalShade').onclick=closeModals;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModals()});
function openTaskModal(ctx={}){taskContext={leadId:ctx.leadId||'',studentId:ctx.studentId||''};$('#taskTitle').value='';$('#taskDue').value=nowInput(0,null,0);$('#taskType').value='Перезвонить';openModal('#taskModal')}
$('#newTaskToday').onclick=()=>openTaskModal();
$('#quickTaskToday').onclick=()=>openTaskModal();
$('#quickLessonToday').onclick=()=>openLessonModal();
$('#quickPaymentToday').onclick=()=>openPaymentModal();
$('#todayRefresh').onclick=()=>refreshData();$('#taskSave').onclick=async()=>{try{await api('createTask',{title:$('#taskTitle').value,dueAt:inputToDisplay($('#taskDue').value),taskType:$('#taskType').value,...taskContext});closeModals();await bootstrap();if(currentLead)renderLeadTasks();toast('Задача создана')}catch(e){showError(e.message)}};
function populateStudentSelects(){const opts=STATE.students.filter(s=>s.status!=='Архив').map(s=>`<option value="${esc(s.id)}">${esc(s.student_name||'Ученик')} · ${esc(s.grade||'—')} класс</option>`).join('');$('#paymentStudent').innerHTML=opts;$('#lessonStudent').innerHTML=opts}
function addMonthInput(v){if(!v)return '';const d=new Date(`${v}:00+03:00`);d.setMonth(d.getMonth()+1);return toDateInput(d.toISOString())}
function openPaymentModal(studentId=''){populateStudentSelects();if(studentId)$('#paymentStudent').value=studentId;const s=STATE.students.find(x=>String(x.id)===String(studentId));$('#paymentAmount').value=s?.monthly_price_rub||'';$('#paymentAt').value=nowInput();$('#paymentNext').value=addMonthInput(nowInput());$('#paymentComment').value='';openModal('#paymentModal')}
$('#newPaymentBtn').onclick=()=>openPaymentModal();$('#paymentSave').onclick=async()=>{try{await api('createPayment',{studentId:$('#paymentStudent').value,amountRub:$('#paymentAmount').value,paymentAt:inputToDisplay($('#paymentAt').value),method:$('#paymentMethod').value,nextPaymentAt:inputToDisplay($('#paymentNext').value),comment:$('#paymentComment').value});closeModals();await bootstrap();if(currentStudent)openStudent(currentStudent.id);toast('Оплата сохранена')}catch(e){showError(e.message)}};
function lessonDraftInterval(){
  const raw=$('#lessonAt').value,teacher=$('#lessonTeacher').value;
  if(!raw||!teacher)return null;
  const start=new Date(`${raw}:00+03:00`).getTime();
  if(!Number.isFinite(start))return null;
  const duration=Math.max(15,Number($('#lessonDuration').value||60));
  return {teacher,start,end:start+duration*60000,duration};
}
function lessonDraftConflicts(){
  const draft=lessonDraftInterval();if(!draft)return [];
  const draftKey=$('#lessonAt').value.slice(0,10);
  const events=[...allCalendarEvents(),...groupSessionEventsForKeys(draftKey?[draftKey]:[])];
  return events.filter(e=>{
    if(e.teacher!==draft.teacher||e.status==='Отменено')return false;
    const a=new Date(e.at).getTime(),b=eventEndMs(e);
    return draft.start<b&&a<draft.end;
  });
}
function renderLessonConflictPreview(){
  const box=$('#lessonConflictWarning');if(!box)return;
  const conflicts=lessonDraftConflicts();
  box.hidden=!conflicts.length;
  box.innerHTML=conflicts.length?`
    <b>⚠ Найдено пересечение: ${conflicts.length}</b>
    ${conflicts.slice(0,3).map(e=>`<span>${esc(shortFmt(e.at))} · ${esc(e.teacher)} · ${esc(e.title)}</span>`).join('')}
    <small>Можно выбрать другое время или подтвердить добавление вручную.</small>`:'';
}
function openLessonModal(studentId='',teacher='',atValue=''){
  populateStudentSelects();
  if(studentId)$('#lessonStudent').value=studentId;
  const s=STATE.students.find(x=>String(x.id)===String($('#lessonStudent').value));
  $('#lessonTeacher').value=teacher||s?.teacher_id||'';
  $('#lessonAt').value=atValue||nowInput(1,18,0);
  $('#lessonDuration').value=60;
  $('#lessonType').value='Занятие';
  $('#lessonComment').value='';
  renderLessonConflictPreview();
  openModal('#lessonModal');
}
$('#newLessonBtn').onclick=()=>openLessonModal('','','');
$('#lessonSave').onclick=async()=>{
  const conflicts=lessonDraftConflicts();
  if(conflicts.length){
    const ok=confirm(`У ${$('#lessonTeacher').value} уже есть ${conflicts.length} событие(я) в это время. Всё равно добавить занятие?`);
    if(!ok)return;
  }
  try{
    await api('createLesson',{
      studentId:$('#lessonStudent').value,
      teacher:$('#lessonTeacher').value,
      startsAt:inputToDisplay($('#lessonAt').value),
      durationMin:$('#lessonDuration').value,
      lessonType:$('#lessonType').value,
      status:'Запланировано',
      comment:$('#lessonComment').value
    });
    closeModals();
    await bootstrap();
    selectedAgendaKey=$('#lessonAt').value.slice(0,10)||selectedAgendaKey;
    toast('Занятие добавлено');
  }catch(e){showError(e.message)}
};
$('#paymentStudent').addEventListener('change',()=>{const s=STATE.students.find(x=>String(x.id)===String($('#paymentStudent').value));if(s?.monthly_price_rub)$('#paymentAmount').value=s.monthly_price_rub});
$('#lessonStudent').addEventListener('change',()=>{const s=STATE.students.find(x=>String(x.id)===String($('#lessonStudent').value));if(s?.teacher_id)$('#lessonTeacher').value=s.teacher_id;renderLessonConflictPreview()});
['#lessonTeacher','#lessonAt','#lessonDuration'].forEach(id=>$(id).addEventListener('input',renderLessonConflictPreview));

// ---------- Делегированные действия ----------
document.addEventListener('click',async e=>{
  const lead=e.target.closest('[data-open-lead]');if(lead&&!e.target.closest('[data-lead-select]')){e.preventDefault();openLead(lead.dataset.openLead);return}
  const student=e.target.closest('[data-open-student]');if(student){e.preventDefault();openStudent(student.dataset.openStudent);return}
  const pay=e.target.closest('[data-payment-for]');if(pay){e.preventDefault();openPaymentModal(pay.dataset.paymentFor);return}
  const teacherSave=e.target.closest('[data-save-teacher]');if(teacherSave){const row=teacherSave.closest('[data-teacher-row]');try{await api('updateTeacher',{id:teacherSave.dataset.saveTeacher,weeklyCapacity:row.querySelector('[data-capacity]').value,telegram:row.querySelector('[data-telegram]').value,active:row.querySelector('[data-active]').checked,notes:''});await bootstrap();toast('Настройки преподавателя сохранены')}catch(err){showError(err.message)}return}
  const done=e.target.closest('[data-lesson-done]');if(done){try{await api('updateLessonStatus',{id:done.dataset.lessonDone,status:'Проведено'});await bootstrap();if(currentStudent)openStudent(currentStudent.id);toast('Занятие отмечено проведённым')}catch(err){showError(err.message)}return}
});
document.addEventListener('change',async e=>{
  const cb=e.target.closest('[data-task-toggle]');if(cb){try{await api('toggleTask',{id:cb.dataset.taskToggle,done:cb.checked});await bootstrap();if(currentLead)renderLeadTasks()}catch(err){cb.checked=!cb.checked;showError(err.message)}}
});


// ---------- Умная карточка заявки ----------
document.addEventListener('click',async e=>{
  const funnel=e.target.closest('[data-funnel-status]');
  if(funnel&&currentLead){
    const status=funnel.dataset.funnelStatus;
    ensureOption($('#leadStatus'),status);
    $('#leadStatus').value=status;
    currentLead={...currentLead,status};
    renderLeadSmart();
    $('#leadStatus').scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }

  const copy=e.target.closest('[data-copy-contact]');
  if(copy&&currentLead){
    const value=String(currentLead.contact||'').trim();
    if(!value)return;
    try{await navigator.clipboard.writeText(value);toast('Контакт скопирован')}
    catch{window.prompt('Скопируйте контакт:',value)}
    return;
  }

  const next=e.target.closest('[data-lead-next]');
  if(!next||!currentLead)return;
  const action=next.dataset.leadNext;

  if(action==='contact'){
    const c=leadContactInfo(currentLead.contact);
    if(c.primaryHref){
      if(c.type==='telegram')window.open(c.primaryHref,'_blank','noopener');
      else location.href=c.primaryHref;
    }else if(c.label&&c.label!=='Не указан'){
      try{await navigator.clipboard.writeText(c.label);toast('Контакт скопирован')}catch{}
    }
    return;
  }
  if(action==='schedule'){
    $('#leadStatus').value='Пробный';
    currentLead={...currentLead,status:'Пробный'};
    renderLeadSmart();
    $('#trial').scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>openTrialPicker(),250);
    return;
  }
  if(action==='assign'){
    $('#teacher').scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>$('#teacher').focus(),250);
    return;
  }
  if(action==='trialDone'){
    $('#leadStatus').value='Пробный проведён';
    currentLead={...currentLead,status:'Пробный проведён'};
    renderLeadSmart();
    $('#leadStatus').scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  if(action==='paid'){
    $('#leadStatus').value='Оплатил';
    currentLead={...currentLead,status:'Оплатил'};
    renderLeadSmart();
    $('#leadStatus').scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  if(action==='student'){
    $('#convertStudent').click();
    return;
  }
  if(action==='task') openTaskModal({leadId:currentLead.id});
});

// ---------- Авторизация ----------
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault();const err=$('#authError');err.hidden=true;try{const d=await api('login',{username:$('#authUser').value.trim(),password:$('#authPassword').value},false);token=d.token;sessionStorage.setItem(SESSION_KEY,token);$('#authPassword').value='';document.body.classList.add('is-authenticated');$('#authOverlay').style.display='none';await bootstrap();toast('Добро пожаловать')}catch(ex){err.textContent=ex.message;err.hidden=false}
});

// PWA
let promptEvt=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptEvt=e;$('#install').classList.add('show')});$('#installBtn').onclick=async()=>{if(!promptEvt)return;promptEvt.prompt();await promptEvt.userChoice;promptEvt=null;$('#install').classList.remove('show')};if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js?v=master14').catch(()=>{}));

// Старт
(async()=>{
  const hash=location.hash.slice(1);showPage(['today','leads','calendar','students','groups','teachers','finance','stats','settings'].includes(hash)?hash:'today');
  if(token){try{document.body.classList.add('is-authenticated');$('#authOverlay').style.display='none';await bootstrap()}catch(e){showError(e.message)}}
})();
