const API_URL = "https://functions.yandexcloud.net/d4ebvaiffdtsos840t16";
const MOSCOW_TZ = 'Europe/Moscow';
const STATUS_OPTIONS = ['Новая','Связались','Записан','Оплатил','Не подходит'];

let sessionCredentials = null;
let allLeads = [];

const $ = id => document.getElementById(id);
const E = {
  loginView:$('loginView'), appView:$('appView'), loginForm:$('loginForm'),
  username:$('username'), password:$('password'), loginError:$('loginError'),
  globalError:$('globalError'), loading:$('loading'), leadsBody:$('leadsBody'),
  emptyState:$('emptyState'), searchInput:$('searchInput'),
  statusFilter:$('statusFilter'), gradeFilter:$('gradeFilter'),
  statTotal:$('statTotal'), statNew:$('statNew'), statToday:$('statToday'),
  statGrades:$('statGrades'), refreshBtn:$('refreshBtn'),
  logoutBtn:$('logoutBtn'), lastUpdated:$('lastUpdated'),
  pipeNew:$('pipeNew'), pipeContacted:$('pipeContacted'), pipeEnrolled:$('pipeEnrolled'),
  pipePaid:$('pipePaid'), pipeRejected:$('pipeRejected'), visibleCount:$('visibleCount')
};

function show(el,msg){ el.textContent=msg; el.hidden=false; }
function hide(el){ el.hidden=true; el.textContent=''; }

function esc(v){
  return String(v ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function fmt(iso){
  if(!iso) return '—';
  const d=new Date(iso);
  if(Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('ru-RU',{
    timeZone:MOSCOW_TZ, day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  }).format(d);
}

function today(iso){
  if(!iso) return false;
  const f=new Intl.DateTimeFormat('en-CA',{
    timeZone:MOSCOW_TZ, year:'numeric', month:'2-digit', day:'2-digit'
  });
  return f.format(new Date(iso))===f.format(new Date());
}

function contact(v){
  const c=String(v||'').trim();
  if(!c) return '—';
  if(c.startsWith('@')){
    return `<a class="contact-link" href="https://t.me/${encodeURIComponent(c.slice(1))}" target="_blank" rel="noopener">${esc(c)}</a>`;
  }
  if(/^\+7\d{10}$/.test(c)){
    return `<a class="contact-link" href="tel:${c}">${esc(c)}</a>`;
  }
  return esc(c);
}

function statusSelect(lead){
  const current = String(lead.status || 'Новая');
  return `
    <select class="status-select" data-lead-id="${esc(lead.id)}" data-original-status="${esc(current)}" aria-label="Статус заявки">
      ${STATUS_OPTIONS.map(s => `<option value="${esc(s)}"${s===current?' selected':''}>${esc(s)}</option>`).join('')}
    </select>
  `;
}

async function apiRequest(payload){
  if(!sessionCredentials) throw new Error('Сессия завершена. Войдите снова.');

  return fetch(API_URL,{
    method:'POST',
    mode:'cors',
    cache:'no-store',
    headers:{
      'Content-Type':'application/json',
      'Accept':'application/json'
    },
    body:JSON.stringify({
      username: sessionCredentials.username,
      password: sessionCredentials.password,
      ...payload
    })
  });
}

async function load(login=false){
  hide(E.globalError);
  hide(E.loginError);

  if(!sessionCredentials) return;

  E.loading.hidden=false;

  try{
    const r=await apiRequest({action:'list'});
    let d=null;
    try{ d=await r.json(); }catch{}

    if(r.status===401) throw new Error('Неверный логин или пароль.');
    if(!r.ok || !d?.ok) throw new Error(d?.error || `Ошибка API: ${r.status}`);

    allLeads=Array.isArray(d.leads)?d.leads:[];
    filters();
    render();

    E.lastUpdated.textContent='Обновлено '+new Intl.DateTimeFormat('ru-RU',{
      timeZone:MOSCOW_TZ,hour:'2-digit',minute:'2-digit'
    }).format(new Date());

    if(login){
      E.password.value='';
      E.loginView.hidden=true;
      E.appView.hidden=false;
    }
  }catch(e){
    login ? show(E.loginError,e.message) : show(E.globalError,e.message);
    if(login) sessionCredentials=null;
  }finally{
    E.loading.hidden=true;
  }
}

async function updateStatus(select){
  const id = select.dataset.leadId;
  const previous = select.dataset.originalStatus || 'Новая';
  const status = select.value;

  if(status===previous) return;

  hide(E.globalError);
  select.disabled=true;

  try{
    const r=await apiRequest({action:'updateStatus', id, status});
    let d=null;
    try{ d=await r.json(); }catch{}

    if(r.status===401) throw new Error('Сессия завершена. Войдите снова.');
    if(!r.ok || !d?.ok) throw new Error(d?.error || `Ошибка API: ${r.status}`);

    const lead = allLeads.find(x=>String(x.id)===String(id));
    if(lead){
      lead.status=status;
      if(d.lead?.updated_at) lead.updated_at=d.lead.updated_at;
    }

    select.dataset.originalStatus=status;
    select.classList.add('saved');
    setTimeout(()=>select.classList.remove('saved'),900);

    filters();
    renderStatsOnly();
  }catch(e){
    select.value=previous;
    show(E.globalError,'Не удалось сохранить статус: '+e.message);
  }finally{
    select.disabled=false;
  }
}

function filters(){
  const currentStatus=E.statusFilter.value;
  E.statusFilter.innerHTML='<option value="">Все статусы</option>'+
    STATUS_OPTIONS.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  E.statusFilter.value=STATUS_OPTIONS.includes(currentStatus)?currentStatus:'';

  const gs=[...new Set(allLeads.map(x=>String(x.grade??'').trim()).filter(Boolean))]
    .sort((a,b)=>Number(a)-Number(b));
  const cg=E.gradeFilter.value;
  E.gradeFilter.innerHTML='<option value="">Все классы</option>'+
    gs.map(g=>`<option value="${esc(g)}">${esc(g)} класс</option>`).join('');
  E.gradeFilter.value=gs.includes(cg)?cg:'';
}

function list(){
  const q=E.searchInput.value.trim().toLowerCase();
  const s=E.statusFilter.value;
  const g=E.gradeFilter.value;

  return allLeads.filter(x =>
    (!s || String(x.status||'')===s) &&
    (!g || String(x.grade??'')===g) &&
    (!q || [
      x.parent_name,x.student_name,x.contact,x.goal,
      x.client_comment,x.status,x.grade
    ].join(' ').toLowerCase().includes(q))
  );
}

function renderStatsOnly(){
  const byStatus = status => allLeads.filter(x=>String(x.status||'')===status).length;
  E.statTotal.textContent=allLeads.length;
  E.statNew.textContent=byStatus('Новая');
  E.statToday.textContent=allLeads.filter(x=>today(x.created_at)).length;
  E.statGrades.textContent=new Set(
    allLeads.map(x=>x.grade).filter(x=>x!==null&&x!==undefined)
  ).size;

  if(E.pipeNew) E.pipeNew.textContent=byStatus('Новая');
  if(E.pipeContacted) E.pipeContacted.textContent=byStatus('Связались');
  if(E.pipeEnrolled) E.pipeEnrolled.textContent=byStatus('Записан');
  if(E.pipePaid) E.pipePaid.textContent=byStatus('Оплатил');
  if(E.pipeRejected) E.pipeRejected.textContent=byStatus('Не подходит');
}

function bindStatusSelects(){
  document.querySelectorAll('.status-select').forEach(select=>{
    select.addEventListener('change',()=>updateStatus(select));
  });
}

function render(){
  const rows=list();
  renderStatsOnly();
  if(E.visibleCount) E.visibleCount.textContent=rows.length;

  E.leadsBody.innerHTML=rows.map(x=>`
    <tr>
      <td>${esc(fmt(x.created_at))}</td>
      <td class="person"><strong>${esc(x.parent_name||'—')}</strong><span>${esc(x.student_name||'—')}</span></td>
      <td><span class="grade">${esc(x.grade??'—')}</span></td>
      <td>${esc(x.goal||'—')}</td>
      <td>${contact(x.contact)}</td>
      <td>${statusSelect(x)}</td>
      <td class="comment">${esc(x.client_comment||'—')}</td>
    </tr>
  `).join('');

  E.emptyState.hidden=rows.length!==0;
  bindStatusSelects();
}

E.loginForm.addEventListener('submit', async e=>{
  e.preventDefault();
  const username=E.username.value.trim();
  const password=E.password.value;
  if(!username || !password) return;

  sessionCredentials={username,password};
  await load(true);
});

E.refreshBtn.addEventListener('click',()=>load(false));

E.logoutBtn.addEventListener('click',()=>{
  sessionCredentials=null;
  allLeads=[];
  E.appView.hidden=true;
  E.loginView.hidden=false;
  E.password.value='';
  hide(E.globalError);
  hide(E.loginError);
});

[E.searchInput,E.statusFilter,E.gradeFilter].forEach(el=>{
  el.addEventListener('input',render);
  el.addEventListener('change',render);
});

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}
