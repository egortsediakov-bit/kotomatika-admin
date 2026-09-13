const API_URL = "https://functions.yandexcloud.net/d4ebvaiffdtsos840t16";
const MOSCOW_TZ = "Europe/Moscow";

const DATA = { leads: [] };
let credentials = null;
let current = null;

const sc = s => ({
  "Новая":"s-new",
  "Связались":"s-contacted",
  "Пробный":"s-trial",
  "Пробный проведён":"s-trial",
  "Оплатил":"s-paid",
  "Не отвечает":"s-lost",
  "Отказ":"s-lost",
  "Отложено":"s-trial",
  "Записан":"s-trial",
  "Не подходит":"s-lost"
}[s] || "");

const nav = [...document.querySelectorAll("[data-page]")];
const pages = [...document.querySelectorAll(".page")];
const rows = document.querySelector("#rows");
const drawer = document.querySelector("#drawer");

function showPage(n){
  pages.forEach(p => p.classList.toggle("active", p.id === "page-" + n));
  nav.forEach(b => b.classList.toggle("active", b.dataset.page === n));
  location.hash = n;
}
nav.forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));

function api(payload){
  if(!credentials) throw new Error("Сессия завершена");
  return fetch(API_URL,{
    method:"POST",
    mode:"cors",
    cache:"no-store",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({...credentials,...payload})
  });
}

function esc(v){
  return String(v ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function moscowDateTime(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat("ru-RU",{
    timeZone:MOSCOW_TZ,day:"2-digit",month:"2-digit",year:"numeric",
    hour:"2-digit",minute:"2-digit"
  }).formatToParts(d);
  const x = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${x.day}.${x.month}.${x.year} ${x.hour}:${x.minute}`;
}

function compactCreated(iso){
  const value = moscowDateTime(iso);
  const [date,time] = value.split(" ");
  return {date:date||"—",time:time||"—"};
}

function contactHtml(value){
  const c = String(value||"").trim();
  if(!c) return "—";
  if(c.startsWith("@")){
    return `<a class="contact-link" href="https://t.me/${encodeURIComponent(c.slice(1))}" target="_blank" rel="noopener">${esc(c)}</a>`;
  }
  if(/^\+7\d{10}$/.test(c)){
    return `<a class="contact-link" href="tel:${c}">${esc(c)}</a>`;
  }
  return esc(c);
}

function fromApi(l){
  return {
    id:String(l.id),
    created:moscowDateTime(l.created_at),
    createdIso:l.created_at,
    updatedIso:l.updated_at,
    parent:l.parent_name || "",
    student:l.student_name || "",
    grade:String(l.grade ?? ""),
    goal:l.goal || "",
    contact:l.contact || "",
    comment:l.client_comment || "",
    source:l.source || "Сайт",
    status:l.status || "Новая",
    teacher:l.teacher_id || "Не назначен",
    trial:l.trial_at ? moscowDateTime(l.trial_at) : "",
    note:l.manager_note || "",
    history:makeHistory(l)
  };
}

function makeHistory(l){
  const items = [];
  if(l.created_at) items.push([moscowDateTime(l.created_at),"Заявка создана"]);
  if(l.updated_at) items.push([moscowDateTime(l.updated_at),"Последнее изменение"]);
  return items;
}

function showTransient(text, kind="loading"){
  document.querySelector(".live-loading")?.remove();
  document.querySelector(".live-error")?.remove();
  const el=document.createElement("div");
  el.className=kind==="error"?"live-error":"live-loading";
  el.textContent=text;
  if(kind==="error"){
    const main=document.querySelector("main");
    main.prepend(el);
  }else{
    document.body.appendChild(el);
  }
  return el;
}

async function loadData(){
  const loading=showTransient("Загружаю заявки…");
  try{
    const r=await api({action:"list"});
    const d=await r.json().catch(()=>({}));
    if(r.status===401) throw new Error("Неверный логин или пароль");
    if(!r.ok || !d.ok) throw new Error(d.error || `Ошибка API: ${r.status}`);

    DATA.leads=(Array.isArray(d.leads)?d.leads:[]).map(fromApi);
    metrics();
    render();
    students();
    stats();
    loading.remove();
  }catch(e){
    loading.remove();
    throw e;
  }
}

function count(a){return DATA.leads.filter(l=>a.includes(l.status)).length}

function metrics(){
  document.querySelector("#m-new").textContent=count(["Новая"]);
  document.querySelector("#m-contacted").textContent=count(["Связались"]);
  document.querySelector("#m-trial").textContent=count(["Пробный","Пробный проведён","Записан"]);
  document.querySelector("#m-paid").textContent=count(["Оплатил"]);
}

function render(){
  const q=(document.querySelector("#search").value||"").toLowerCase();
  const f=document.querySelector("#status").value;

  const arr=DATA.leads.filter(l =>
    (!q || [l.parent,l.student,l.contact,l.goal,l.grade,l.teacher].join(" ").toLowerCase().includes(q)) &&
    (!f || l.status===f)
  );

  rows.innerHTML=arr.map(l=>{
    const c=compactCreated(l.createdIso);
    return `<tr data-id="${esc(l.id)}">
      <td><div class="name">${esc(c.time)}</div><div class="sub">${esc(c.date)}</div></td>
      <td><div class="name">${esc(l.parent)}</div><div class="sub">${esc(l.student)} · ${esc(l.grade)} класс</div></td>
      <td>${esc(l.goal)}</td>
      <td>${contactHtml(l.contact)}</td>
      <td>${esc(l.teacher)}</td>
      <td><span class="status ${sc(l.status)}"><i class="dot"></i>${esc(l.status)}</span></td>
    </tr>`;
  }).join("");

  document.querySelectorAll("[data-id]").forEach(r =>
    r.addEventListener("click",()=>openLead(r.dataset.id))
  );
}

document.querySelector("#search").addEventListener("input",render);
document.querySelector("#status").addEventListener("change",render);

function hist(){
  document.querySelector("#history").innerHTML=current.history.slice().reverse().map(x=>
    `<li><small>${esc(x[0])}</small><b>${esc(x[1])}</b></li>`
  ).join("") || `<li><small>—</small><b>История пока пуста</b></li>`;
}

function openLead(id){
  current=DATA.leads.find(l=>String(l.id)===String(id));
  if(!current) return;

  document.querySelector("#leadTitle").textContent=current.parent+" · "+current.student;
  document.querySelector("#leadMeta").textContent=current.grade+" класс · "+current.created;
  document.querySelector("#details").innerHTML=`
    <div class="kv"><b>Цель</b><span>${esc(current.goal)}</span></div>
    <div class="kv"><b>Контакт</b><span>${contactHtml(current.contact)}</span></div>
    <div class="kv"><b>Комментарий</b><span>${esc(current.comment||"—")}</span></div>
    <div class="kv"><b>Источник</b><span>${esc(current.source||"—")}</span></div>`;

  ensureStatusOption(current.status);
  document.querySelector("#leadStatus").value=current.status;
  document.querySelector("#teacher").value=current.teacher || "Не назначен";
  document.querySelector("#trial").value=current.trial || "";
  document.querySelector("#note").value=current.note || "";
  hist();
  drawer.classList.add("open");
}

function ensureStatusOption(status){
  const select=document.querySelector("#leadStatus");
  if(![...select.options].some(o=>o.value===status)){
    const o=document.createElement("option");
    o.value=status;o.textContent=status;
    select.appendChild(o);
  }
}

function closeDrawer(){drawer.classList.remove("open")}
document.querySelector("#close").addEventListener("click",closeDrawer);
document.querySelector(".shade").addEventListener("click",closeDrawer);

document.querySelectorAll("[data-q]").forEach(b =>
  b.addEventListener("click",()=>{
    ensureStatusOption(b.dataset.q);
    document.querySelector("#leadStatus").value=b.dataset.q;
  })
);

document.querySelector("#save").addEventListener("click", async ()=>{
  if(!current) return;

  const button=document.querySelector("#save");
  const status=document.querySelector("#leadStatus").value;
  const teacher=document.querySelector("#teacher").value;
  const trial=document.querySelector("#trial").value.trim();
  const note=document.querySelector("#note").value.trim();

  button.disabled=true;
  button.textContent="Сохраняем…";

  try{
    const r=await api({
      action:"updateLead",
      id:current.id,
      status, teacher, trial, note
    });
    const d=await r.json().catch(()=>({}));

    if(!r.ok || !d.ok) throw new Error(d.error || `Ошибка API: ${r.status}`);

    current.status=status;
    current.teacher=teacher;
    current.trial=trial;
    current.note=note;
    current.updatedIso=d.lead?.updated_at || new Date().toISOString();
    current.history.push([moscowDateTime(current.updatedIso),"Заявка обновлена"]);

    hist();metrics();render();students();stats();
    button.textContent="Сохранено ✓";
    setTimeout(()=>button.textContent="Сохранить изменения",1200);
  }catch(e){
    button.textContent="Ошибка";
    showTransient("Не удалось сохранить: "+e.message,"error");
    setTimeout(()=>button.textContent="Сохранить изменения",1500);
  }finally{
    button.disabled=false;
  }
});

function students(){
  const m=new Map();
  DATA.leads.forEach(l=>{
    const k=l.parent+"|"+l.student+"|"+l.contact;
    if(!m.has(k))m.set(k,l);
  });

  document.querySelector("#students").innerHTML=[...m.values()].map(l=>`
    <article>
      <em>${esc(l.grade)} класс</em>
      <h3>${esc(l.student)}</h3>
      <p>Родитель: ${esc(l.parent)}</p>
      <p>${contactHtml(l.contact)}</p>
      <p><b>${esc(l.teacher)}</b></p>
      <span class="status ${sc(l.status)}"><i class="dot"></i>${esc(l.status)}</span>
    </article>`).join("");
}

function stats(){
  const t=DATA.leads.length||1;
  const c=DATA.leads.filter(l=>["Связались","Пробный","Пробный проведён","Оплатил","Записан"].includes(l.status)).length;
  const tr=DATA.leads.filter(l=>["Пробный","Пробный проведён","Оплатил","Записан"].includes(l.status)).length;
  const p=DATA.leads.filter(l=>l.status==="Оплатил").length;

  document.querySelector("#conv1").textContent=DATA.leads.length?Math.round(tr/DATA.leads.length*100)+"%":"0%";
  document.querySelector("#conv2").textContent=tr?Math.round(p/tr*100)+"%":"0%";

  document.querySelector("#bars").innerHTML=[
    ["Все заявки",DATA.leads.length],
    ["Связались",c],
    ["Пробный",tr],
    ["Оплатили",p]
  ].map(x=>`
    <div class="bar">
      <b>${esc(x[0])}</b>
      <div class="track"><div class="fill" style="width:${Math.round(x[1]/t*100)}%"></div></div>
      <strong>${x[1]}</strong>
    </div>`).join("");
}

// Auth overlay.
const authForm=document.querySelector("#authForm");
authForm.addEventListener("submit",async e=>{
  e.preventDefault();
  const user=document.querySelector("#authUser").value.trim();
  const password=document.querySelector("#authPassword").value;
  const error=document.querySelector("#authError");

  error.hidden=true;
  credentials={username:user,password};

  try{
    await loadData();
    document.body.classList.add("is-authenticated");
    document.querySelector("#authPassword").value="";
  }catch(err){
    credentials=null;
    error.textContent=err.message || "Не удалось войти";
    error.hidden=false;
  }
});

// PWA install from the original demo.
let promptEvt=null;
window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault();
  promptEvt=e;
  document.querySelector("#install").classList.add("show");
});
document.querySelector("#installBtn").addEventListener("click",async()=>{
  if(!promptEvt)return;
  promptEvt.prompt();
  await promptEvt.userChoice;
  promptEvt=null;
  document.querySelector("#install").classList.remove("show");
});

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js?v=live1"));
}

showPage(["leads","students","stats","settings"].includes(location.hash.slice(1))?location.hash.slice(1):"leads");
metrics();render();students();stats();
