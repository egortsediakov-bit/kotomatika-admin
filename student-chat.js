/* КОТОМАТИКА CRM — ученики: время урока при создании + мини-чат с фиксацией оплат
   Подключается после app.js и использует его функции (STATE, api, bootstrap, toast…).
   Серверная часть не меняется: сообщения чата хранятся строками в поле «Заметки» ученика,
   оплаты — обычным действием createPayment. */
(function(){
  'use strict';
  var CHAT_PREFIX='@@km|';

  /* ---------- заметки: обычный текст + строки чата ---------- */
  function splitNotes(raw){
    var plain=[],chat=[];
    String(raw||'').split(/\r?\n/).forEach(function(line){
      if(line.indexOf(CHAT_PREFIX)===0){
        var p=line.slice(CHAT_PREFIX.length), i=p.indexOf('|');
        if(i>0) chat.push({at:p.slice(0,i),text:p.slice(i+1).replace(/\\n/g,'\n'),raw:line});
      }else plain.push(line);
    });
    return {plain:plain.join('\n').replace(/\s+$/,''),chat:chat};
  }
  function joinNotes(plain,chat){
    var lines=chat.map(function(c){return c.raw});
    return [String(plain||'').replace(/\s+$/,'')].concat(lines).filter(function(x){return x!==''}).join('\n');
  }
  function chatLine(text){
    return CHAT_PREFIX+new Date().toISOString()+'|'+String(text).replace(/\r?\n/g,'\\n');
  }
  function studentById(id){return STATE.students.find(function(s){return String(s.id)===String(id)})}

  /* Заметки в форме карточки показываем без служебных строк чата и сохраняем обратно вместе с ними */
  var origApi=api;
  api=function(action,payload,useAuth){
    payload=payload||{};
    if(action==='updateStudent'&&payload.id!==undefined){
      if(payload.__chat){delete payload.__chat}
      else{
        var cur=studentById(payload.id);
        if(cur&&typeof payload.notes==='string'){
          payload.notes=joinNotes(splitNotes(payload.notes).plain,splitNotes(cur.notes).chat);
        }
      }
    }
    return origApi.call(this,action,payload,useAuth);
  };
  var origOpenStudent=openStudent;
  openStudent=function(id){
    origOpenStudent.apply(this,arguments);
    if(id){var s=studentById(id); if(s) $('#sNotes').value=splitNotes(s.notes).plain}
    syncNewStudentBlock();
  };
  var origReset=resetStudentForm;
  resetStudentForm=function(){origReset.apply(this,arguments);syncNewStudentBlock(true)};

  /* ---------- блок «Время занятия» в форме нового ученика ---------- */
  function ensureNewStudentBlock(){
    if($('#sLessonBlock'))return;
    var form=$('.student-form'); var notes=$('#sNotes'); if(!form||!notes)return;
    var box=document.createElement('div'); box.id='sLessonBlock'; box.className='s-lesson-block'; box.hidden=true;
    box.innerHTML='<div class="s-lesson-title"><b>Время занятия</b><small>Необязательно. Занятия появятся в календаре и у преподавателя.</small></div>'+
      '<div class="two"><label>Первое занятие<input id="sLessonAt" type="datetime-local"></label>'+
      '<label>Длительность, мин<input id="sLessonDuration" type="number" min="15" max="240" step="5" value="60" inputmode="numeric"></label></div>'+
      '<div class="two"><label>Повтор<select id="sLessonRepeat"><option value="weekly">Каждую неделю</option><option value="biweekly">Каждые 2 недели</option><option value="once">Один раз</option></select></label>'+
      '<label id="sLessonCountLabel">Сколько занятий<input id="sLessonCount" type="number" min="1" max="52" value="8" inputmode="numeric"></label></div>'+
      '<small class="field-hint">Нужен выбранный преподаватель — занятие создаётся на него.</small>';
    notes.closest('label').before(box);
    $('#sLessonRepeat').addEventListener('change',function(){$('#sLessonCountLabel').style.display=this.value==='once'?'none':''});
  }
  function syncNewStudentBlock(forceNew){
    ensureNewStudentBlock();
    var box=$('#sLessonBlock'); if(!box)return;
    var isNew=forceNew||!currentStudent;
    box.hidden=!isNew;
    if(isNew){$('#sLessonAt').value='';$('#sLessonDuration').value=60;$('#sLessonRepeat').value='weekly';$('#sLessonCount').value=8;$('#sLessonCountLabel').style.display=''}
  }
  ensureNewStudentBlock();

  var saveBtn=$('#saveStudent'), origSave=saveBtn&&saveBtn.onclick;
  if(saveBtn&&origSave){
    saveBtn.onclick=async function(){
      var isNew=!currentStudent;
      var at=isNew?$('#sLessonAt').value:'';
      var teacher=cleanText($('#sTeacher').value);
      if(isNew&&at&&!teacher){showError('Чтобы создать занятие, выберите преподавателя');$('#sTeacher').focus();return}
      var lessonPlan=isNew&&at?{
        startsAt:at,teacher:teacher,
        durationMin:cleanPositiveInt($('#sLessonDuration').value,60)||60,
        repeat:$('#sLessonRepeat').value,count:Math.min(52,Math.max(1,cleanPositiveInt($('#sLessonCount').value,1)||1)),
        name:cleanText($('#sStudentName').value)
      }:null;
      var before=new Set(STATE.students.map(function(s){return String(s.id)}));
      await origSave.apply(this,arguments);
      if(!lessonPlan)return;
      var created=STATE.students.filter(function(s){return !before.has(String(s.id))});
      var st=created.find(function(s){return (s.student_name||'')===lessonPlan.name})||created[0];
      if(!st){return}
      try{
        await api('createLesson',{studentId:st.id,teacher:lessonPlan.teacher,startsAt:inputToDisplay(lessonPlan.startsAt),
          durationMin:lessonPlan.durationMin,lessonType:'Занятие',status:'Запланировано',comment:'',
          repeatRule:lessonPlan.repeat==='once'?'weekly':lessonPlan.repeat,repeatCount:lessonPlan.repeat==='once'?1:lessonPlan.count});
        await bootstrap();
        toast('Ученик создан, занятия добавлены в расписание');
      }catch(e){showError('Ученик создан, но занятие не добавлено: '+(e&&e.message||e))}
    };
  }

  /* ---------- мини-чат ---------- */
  var chatId=null;
  function buildChatDom(){
    if($('#studentChat'))return;
    var d=document.createElement('div'); d.id='studentChat'; d.className='drawer chat-drawer';
    d.innerHTML='<div class="shade" data-chat-close></div><aside role="dialog" aria-label="Чат с учеником">'+
      '<header class="chat-top"><div id="chatAvatar" class="chat-avatar">У</div>'+
      '<div class="chat-title"><b id="chatName">Ученик</b><small id="chatMeta"></small></div>'+
      '<button type="button" id="chatOpenCard" class="chat-card-btn">Карточка</button>'+
      '<button type="button" class="chat-x" data-chat-close aria-label="Закрыть">×</button></header>'+
      '<div id="chatFeed" class="chat-feed"></div>'+
      '<div id="chatPay" class="chat-pay" hidden>'+
        '<div class="chat-pay-row"><label>Сумма, ₽<input id="chatPayAmount" type="number" min="1" inputmode="numeric"></label>'+
        '<label>Когда<input id="chatPayAt" type="datetime-local"></label></div>'+
        '<div id="chatPayMethods" class="chat-chips"></div>'+
        '<input id="chatPayComment" placeholder="Комментарий (необязательно)">'+
        '<small id="chatPayNext" class="field-hint"></small>'+
        '<button type="button" id="chatPaySave" class="save">Зафиксировать оплату</button></div>'+
      '<footer class="chat-composer"><button type="button" id="chatPayToggle" class="chat-rub" aria-label="Оплата">₽</button>'+
        '<textarea id="chatInput" rows="1" placeholder="Заметка по ученику…"></textarea>'+
        '<button type="button" id="chatSend" class="chat-send" aria-label="Отправить">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></footer>'+
      '</aside>';
    document.body.appendChild(d);
    var methods=['Перевод','СБП','Карта','Наличные'];
    $('#chatPayMethods').innerHTML=methods.map(function(m,i){return '<button type="button" data-method="'+m+'" class="'+(i===0?'on':'')+'">'+m+'</button>'}).join('');
    $('#chatPayMethods').addEventListener('click',function(e){var b=e.target.closest('[data-method]');if(!b)return;$$('#chatPayMethods button').forEach(function(x){x.classList.toggle('on',x===b)})});
    $$('[data-chat-close]',d).forEach(function(x){x.addEventListener('click',closeChat)});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&d.classList.contains('open'))closeChat()});
    $('#chatOpenCard').addEventListener('click',function(){var id=chatId;closeChat();if(id)openStudent(id)});
    $('#chatPayToggle').addEventListener('click',function(){var p=$('#chatPay');p.hidden=!p.hidden;this.classList.toggle('on',!p.hidden);if(!p.hidden)prepPay();scrollFeed()});
    $('#chatSend').addEventListener('click',sendNote);
    $('#chatInput').addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();sendNote()}});
    $('#chatInput').addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(120,this.scrollHeight)+'px'});
    $('#chatPaySave').addEventListener('click',savePay);
    $('#chatPayAt').addEventListener('input',updNext);
  }
  function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
  function closeChat(){var d=$('#studentChat');if(d)d.classList.remove('open');chatId=null;document.body.classList.remove('chat-open')}
  function scrollFeed(){var f=$('#chatFeed');if(f)f.scrollTop=f.scrollHeight}
  function ts(iso){var t=new Date(iso).getTime();return isNaN(t)?0:t}

  function renderChat(){
    var s=studentById(chatId); if(!s)return;
    $('#chatAvatar').textContent=(s.student_name||'У').trim().charAt(0).toUpperCase();
    $('#chatName').textContent=s.student_name||'Ученик';
    var up=STATE.lessons.filter(function(l){return String(l.student_id)===String(s.id)&&l.status==='Запланировано'&&ts(l.starts_at)>Date.now()}).sort(function(a,b){return ts(a.starts_at)-ts(b.starts_at)})[0];
    var meta=[s.teacher_id?('Преподаватель: '+s.teacher_id):'Преподаватель не назначен'];
    meta.push(up?('Урок: '+shortFmt(up.starts_at)):'Урока в расписании нет');
    if(s.next_payment_at) meta.push('Оплата до '+fmt(s.next_payment_at).slice(0,10));
    $('#chatMeta').textContent=meta.join(' · ');
    var items=[];
    STATE.payments.filter(function(p){return String(p.student_id)===String(s.id)}).forEach(function(p){items.push({t:ts(p.payment_at),k:'pay',p:p})});
    STATE.lessons.filter(function(l){return String(l.student_id)===String(s.id)}).forEach(function(l){items.push({t:ts(l.starts_at),k:'lesson',l:l})});
    splitNotes(s.notes).chat.forEach(function(c){items.push({t:ts(c.at),k:'note',c:c})});
    items.sort(function(a,b){return a.t-b.t});
    var html='',lastDay='';
    items.forEach(function(it){
      var iso=it.k==='pay'?it.p.payment_at:it.k==='lesson'?it.l.starts_at:it.c.at;
      var day=fmt(iso).slice(0,10); if(day!==lastDay){html+='<div class="chat-day">'+esc(day)+'</div>';lastDay=day}
      var time=(fmt(iso)||'').slice(11,16);
      if(it.k==='pay'){
        html+='<div class="chat-row pay"><div class="bubble"><b>✓ Оплата '+esc(rub(it.p.amount_rub))+'</b><span>'+esc([it.p.method||'Оплата',it.p.comment].filter(Boolean).join(' · '))+'</span><time>'+esc(time)+'</time></div></div>';
      }else if(it.k==='lesson'){
        var st=it.l.status||'Запланировано';
        html+='<div class="chat-sys"><span>'+esc((it.l.lesson_type||'Занятие')+' · '+(it.l.teacher_id||s.teacher_id||'—')+' · '+time+' · '+st)+'</span></div>';
      }else{
        html+='<div class="chat-row me"><div class="bubble">'+esc(it.c.text).replace(/\n/g,'<br>')+'<time>'+esc(time)+'</time></div></div>';
      }
    });
    $('#chatFeed').innerHTML=html||'<div class="chat-empty">Здесь будут оплаты, занятия и заметки по ученику.<br>Нажмите «₽», чтобы зафиксировать оплату.</div>';
    scrollFeed();
  }
  function prepPay(){
    var s=studentById(chatId); if(!s)return;
    $('#chatPayAmount').value=s.monthly_price_rub||'';
    $('#chatPayAt').value=nowInput(); $('#chatPayComment').value='';
    updNext();
  }
  function updNext(){
    var v=addMonthInput($('#chatPayAt').value);
    $('#chatPayNext').textContent=v?('Следующая оплата: '+inputToDisplay(v).slice(0,10)):'';
  }
  async function savePay(){
    var s=studentById(chatId); if(!s)return;
    var amount=cleanPositiveInt($('#chatPayAmount').value,0), at=$('#chatPayAt').value;
    if(amount<=0){showError('Укажите сумму оплаты больше 0');return}
    if(!at){showError('Укажите дату оплаты');return}
    var method=($('#chatPayMethods .on')||{}).dataset?$('#chatPayMethods .on').dataset.method:'Перевод';
    var btn=$('#chatPaySave'),old=btn.textContent; btn.disabled=true; btn.textContent='Сохраняю…';
    try{
      var result=await api('createPayment',{studentId:s.id,amountRub:amount,paymentAt:inputToDisplay(at),method:method,
        nextPaymentAt:inputToDisplay(addMonthInput(at)),comment:$('#chatPayComment').value});
      await bootstrap(); renderChat();
      $('#chatPay').hidden=true; $('#chatPayToggle').classList.remove('on');
      var w=result&&Array.isArray(result.warnings)&&result.warnings[0];
      toast(w?('Оплата сохранена. '+w):'Оплата зафиксирована');
    }catch(e){showError(e&&e.message||String(e))}finally{btn.disabled=false;btn.textContent=old}
  }
  async function sendNote(){
    var s=studentById(chatId); var ta=$('#chatInput'); var text=cleanText(ta.value);
    if(!s||!text)return;
    var btn=$('#chatSend'); btn.disabled=true;
    try{
      var parts=splitNotes(s.notes);
      var notes=joinNotes(parts.plain,parts.chat.concat([{raw:chatLine(text)}]));
      await api('updateStudent',{__chat:true,id:s.id,studentName:s.student_name||'',parentName:s.parent_name||'',grade:s.grade||'',
        contact:s.contact||'',program:s.program||'',teacher:s.teacher_id||'',status:s.status||'Активен',tariff:s.tariff||'',
        monthlyPriceRub:cleanPositiveInt(s.monthly_price_rub,0),nextPaymentAt:s.next_payment_at?inputToDisplay(toDateInput(s.next_payment_at)):'',notes:notes});
      ta.value=''; ta.style.height='auto';
      await bootstrap(); renderChat();
    }catch(e){showError(e&&e.message||String(e))}finally{btn.disabled=false}
  }
  function openChat(id){
    buildChatDom(); if(!studentById(id))return;
    chatId=id; $('#chatPay').hidden=true; $('#chatPayToggle').classList.remove('on'); $('#chatInput').value='';
    renderChat(); $('#studentChat').classList.add('open'); document.body.classList.add('chat-open');
  }
  window.KotomatikaStudentChat={open:openChat,close:closeChat};

  /* Клик по имени ученика в списке открывает чат (клик по остальной строке — карточку, как раньше) */
  document.addEventListener('click',function(e){
    var name=e.target.closest&&e.target.closest('#studentRows .name');
    if(!name)return;
    var row=name.closest('[data-open-student]'); if(!row)return;
    e.preventDefault(); e.stopPropagation(); openChat(row.dataset.openStudent);
  },true);

  /* пометка в списке: имя — ссылка на чат (наблюдатель переживает любые перерисовки таблицы) */
  var rows=$('#studentRows');
  function markNames(){$$('#studentRows .name').forEach(function(n){if(!n.title)n.title='Открыть чат с учеником'})}
  if(rows){new MutationObserver(markNames).observe(rows,{childList:true});markNames()}
})();
