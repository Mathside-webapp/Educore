/* EduCore V3.4 — classic calendar enhancement only.
   Class logos/backgrounds and style controls have been removed. */
(() => {
  'use strict';
  const find = id => document.getElementById(id);
  const two = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`;
  const readableDate = d => d.toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'});

  // The calendar is retained as a classic workspace feature.
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selected = ymd(new Date());
  let classFilter = 'all';
  const activeClasses = () => (state.sections||[]).filter(section=>!section.archived_at);
  const calendarTasks = () => (state.assignments||[]).filter(item => item.due_at && item.status !== 'archived' && !item.archived_at && (classFilter === 'all' || item.section_id === classFilter));
  const groupByDay = () => {
    const map = new Map();
    calendarTasks().forEach(task=>{
      const d=new Date(task.due_at);
      if (Number.isNaN(d.getTime())) return;
      const day=ymd(d);
      if (!map.has(day)) map.set(day,[]);
      map.get(day).push(task);
    });
    return map;
  };
  const safeColor = value => /^#[a-f\d]{6}$/i.test(String(value)) ? String(value) : 'var(--subject-primary,#4f46e5)';
  function renderCalendar() {
    const grid = find('classicCalendarGrid');
    if (!grid) return;
    const classes = activeClasses();
    const select = find('classicCalendarClass');
    if (classFilter !== 'all' && !classes.some(c=>c.id===classFilter)) classFilter='all';
    if (select) {
      const sorted=classes.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
      select.innerHTML = '<option value="all">All classes</option>' + sorted.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
      select.value=classFilter;
    }
    find('classicCalendarMonth').textContent=calendarMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    const weekday=(calendarMonth.getDay()+6)%7;  // Monday first
    const firstDay = new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1-weekday);
    const events=groupByDay();
    const today=ymd(new Date());
    grid.innerHTML=Array.from({length:42},(_,i)=>{
      const d=new Date(firstDay); d.setDate(firstDay.getDate()+i);
      const date=ymd(d), tasks=events.get(date)||[];
      const outside=d.getMonth()!==calendarMonth.getMonth();
      return `<button type="button" class="classic-calendar-date ${outside?'outside':''} ${date===today?'today':''} ${date===selected?'chosen':''}" data-classic-calendar-day="${date}" aria-label="${date}; ${tasks.length} deadline${tasks.length===1?'':'s'}"><span class="classic-day-number">${d.getDate()}</span>${tasks.slice(0,2).map(task=>{
        const cls=sectionById(task.section_id);
        return `<span class="classic-calendar-event" style="--event-color:${safeColor(cls?.color)}">${esc(task.title)}</span>`;
      }).join('')}${tasks.length>2?`<small>+${tasks.length-2} more</small>`:''}</button>`;
    }).join('');
    const rows = find('classicAgendaList');
    if (!rows) return;
    let due = events.get(selected) || [];
    const focused = due.length>0;
    if (!focused) {
      const prefix=`${calendarMonth.getFullYear()}-${two(calendarMonth.getMonth()+1)}-`;
      due=calendarTasks().filter(a=>{
        const d=new Date(a.due_at); return !Number.isNaN(d.getTime()) && ymd(d).startsWith(prefix);
      }).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at)).slice(0,8);
    }
    const label = find('classicAgendaTitle');
    if (label) label.textContent = focused ? `Deadlines · ${readableDate(new Date(`${selected}T12:00:00`))}` : 'Upcoming deadlines this month';
    rows.innerHTML=due.length?due.map(task=>{
      const cls=sectionById(task.section_id);
      const when=new Date(task.due_at);
      const kind = task.task_type === 'performance' || task.assignment_type === 'performance' || (typeof isPerformanceTask === 'function' && isPerformanceTask(task)) ? 'Performance task' : 'Written work';
      return `<article class="classic-agenda-row"><span class="classic-agenda-date">${when.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><div><strong>${esc(task.title)}</strong><small>${esc(cls?.name||'Class')} · ${kind}</small></div><button type="button" class="btn btn-light" data-preview-assignment="${esc(task.id)}">Preview</button></article>`;
    }).join(''):'<p class="muted">No deadlines this month.</p>';
  }
  find('classicCalendarPrev')?.addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1); selected=ymd(calendarMonth);renderCalendar();});
  find('classicCalendarNext')?.addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1); selected=ymd(calendarMonth);renderCalendar();});
  find('classicCalendarToday')?.addEventListener('click',()=>{const d=new Date();calendarMonth=new Date(d.getFullYear(),d.getMonth(),1);selected=ymd(d);renderCalendar();});
  find('classicCalendarClass')?.addEventListener('change',e=>{classFilter=e.currentTarget.value;renderCalendar();});
  find('classicCalendarGrid')?.addEventListener('click',e=>{const day=e.target.closest('[data-classic-calendar-day]');if(!day)return;selected=day.dataset.classicCalendarDay;const d=new Date(`${selected}T12:00:00`);calendarMonth=new Date(d.getFullYear(),d.getMonth(),1);renderCalendar();});

  const oldShowTeacherView = showTeacherView;
  showTeacherView = function(view) {
    oldShowTeacherView(view);
    if (view==='calendar') renderCalendar();
    const title=find('teacherPageTitle');
    if (title && view==='calendar') title.textContent='Calendar';
    if (title && view==='performance') title.textContent='Performance Tasks';
    if (title && view==='archive') title.textContent='Archived';
  };
  const oldRenderTeacher = renderTeacher;
  renderTeacher = function() {
    oldRenderTeacher();
    if (find('view-calendar')?.classList.contains('active')) renderCalendar();
  };
})();
