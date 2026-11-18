/* КОТОМАТИКА CRM — мобильная навигация и подсказка установки на iPhone */
(function(){
  'use strict';
  var $=function(s,r){return (r||document).querySelector(s)};
  var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};

  /* ---------- «Ещё» ---------- */
  var sheet=$('#moreSheet'), btn=$('#moreBtn');
  if(sheet&&btn){
    var MORE=['groups','teachers','finance','stats','settings'];
    var open=function(){sheet.hidden=false;btn.setAttribute('aria-expanded','true')};
    var close=function(){sheet.hidden=true;btn.setAttribute('aria-expanded','false')};
    var sync=function(){
      var page=(location.hash||'').slice(1);
      btn.classList.toggle('has-active',MORE.indexOf(page)!==-1);
    };
    btn.addEventListener('click',function(){sheet.hidden?open():close()});
    $$('[data-close-more]',sheet).forEach(function(el){el.addEventListener('click',close)});
    $$('[data-page]',sheet).forEach(function(b){b.addEventListener('click',function(){close();setTimeout(sync,0)})});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!sheet.hidden)close()});
    window.addEventListener('hashchange',sync);
    sync();
  }

  /* ---------- подсказка установки (только iPhone/iPad в Safari) ---------- */
  var hint=$('#iosInstall'), KEY='kotomatika_crm_ios_hint_v1';
  if(hint){
    var ua=navigator.userAgent||'';
    var isIOS=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    var standalone=window.navigator.standalone===true||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches);
    var dismissed=false; try{dismissed=!!localStorage.getItem(KEY)}catch(e){}
    if(isIOS&&!standalone&&!dismissed){
      setTimeout(function(){
        if(document.body.classList.contains('is-authenticated')) hint.hidden=false;
      },2500);
    }
    var x=$('#iosInstallClose');
    if(x) x.addEventListener('click',function(){hint.hidden=true;try{localStorage.setItem(KEY,String(Date.now()))}catch(e){}});
  }

  /* ---------- календарь: неделя открывается на сегодняшнем дне ---------- */
  var grid=$('#calendarWeekGrid');
  if(grid&&window.MutationObserver){
    var focusToday=function(){
      var view=$('#calendarWeekView'); if(!view||view.scrollWidth<=view.clientWidth+4)return;
      var d=grid.querySelector('.calendar-week-day.selected')||grid.querySelector('.calendar-week-day.today');
      if(d) view.scrollLeft=Math.max(0,d.offsetLeft-grid.offsetLeft);
    };
    new MutationObserver(function(){requestAnimationFrame(focusToday)}).observe(grid,{childList:true});
  }
})();
