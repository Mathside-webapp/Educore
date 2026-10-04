/* Student V8: a presentation layer over the original classroom workflow. */
(() => {
  'use strict';
  const shell = document.getElementById('studentApp');
  const iconPaths = {
    task:'<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/>',
    calendar:'<rect x="3" y="5" width="18" height="17" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/>',
    check:'<circle cx="12" cy="12" r="10"/><path d="m7 12 3 3 7-7"/>'
  };
  const icon = name => `<svg class="v8-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.task}</svg>`;
  const empty = (title,body) => `<div class="v8-empty"><b>${esc(title)}</b>${esc(body)}</div>`;
  const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value) : null;
  const formatDate = value => date(value) ? new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric'}).format(date(value)) : '';
  const startedKey = () => `educore:v8:started:${state.user?.id || 'guest'}`;
  let expandedFeedback=false;
  function readLocal(key,fallback=null) { try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;} }
  function startedIds() { const ids=readLocal(startedKey(),[]);return Array.isArray(ids)?ids.filter(x=>typeof x==='string'):[]; }
  function kind(a) {
    const source=String(a.activity_type || a.type || a.title || '').toLowerCase();
    if(/quiz|exam|test/.test(source))return {color:'purple',label:'Quiz'};
    if(/performance|project/.test(source))return {color:'green',label:'Performance Task'};
    if(/trigonometry/.test(source))return {color:'green',label:'Practice Activity'};
    return {color:'blue',label:'Practice Activity'};
  }
  function status(a) {
    const sub=submissionFor(a.id);
    if(sub)return {key:'submitted',label:a.status==='archived'?'Submitted · Archived':'Submitted'};
    if(a.status==='archived')return {key:'archived',label:'Archived'};
    if(window.CLASSSIDE_PREVIEW && a.preview_status==='upcoming')return {key:'upcoming',label:'Upcoming'};
    if((date(a.publish_at)?.getTime() || 0)>Date.now())return {key:'upcoming',label:'Upcoming'};
    const dueDate=date(a.due_at);
    if(dueDate && dueDate.getTime()<Date.now())return {key:'missed',label:'Missed'};
    if((window.CLASSSIDE_PREVIEW && a.preview_status==='in-progress') || startedIds().includes(a.id))return {key:'ongoing',label:'Ongoing'};
    return {key:'ongoing',label:'Ongoing'};
  }
  function statusMarkup(a) {const s=status(a);return `<span class="v8-status ${s.key}">${s.label}</span>`;}
  function due(a) {
    const d=date(a.due_at);const urgent=d && d.getTime()<Date.now()+2*86400000;
    return `<span class="v8-due ${urgent?'is-urgent':''}">${icon('calendar')}<span>${d?`Due <time datetime="${esc(a.due_at)}">${esc(formatDate(a.due_at))}</time>`:'No due date'}</span></span>`;
  }
  function scores() {
    return state.submissions.filter(s=>s.student_id===state.user?.id && s.status==='graded').map(s=>{
      const total=totalPoints(s.assignment_id),raw=Number(s.teacher_score ?? s.auto_score);
      return {s,total,percent:total>0 && Number.isFinite(raw)?Math.max(0,Math.min(100,raw/total*100)):null};
    }).filter(x=>x.percent!==null).sort((a,b)=>(date(b.s.graded_at || b.s.updated_at || b.s.submitted_at)?.getTime()||0)-(date(a.s.graded_at || a.s.updated_at || a.s.submitted_at)?.getTime()||0));
  }
  const mean = a => a.reduce((sum,x)=>sum+x.percent,0)/a.length;
  function removeLegacyRankingCards() {
    const allowed = new Set(['average','highest','total']);
    shell.querySelectorAll('.v8-metric').forEach(card => {
      const heading = card.querySelector('h3')?.textContent?.trim().toLowerCase() || '';
      const metric = card.querySelector('[data-v8-metric]')?.dataset.v8Metric || '';
      if (heading === 'class rank' || heading === 'your progress' || (metric && !allowed.has(metric))) {
        card.remove();
      }
    });
  }
  function renderMetrics() {
    removeLegacyRankingCards();
    const marked=scores(),average=marked.length?Math.round(mean(marked)):null,highest=marked.length?Math.round(Math.max(...marked.map(x=>x.percent))):null;
    const total=state.assignments.length,completed=state.assignments.filter(a=>submissionFor(a.id)).length;
    const change=marked.length>=6?Math.round(mean(marked.slice(0,3))-mean(marked.slice(3,6))):null;
    const values={average:average===null?'—':`${average}%`,total:String(total),highest:highest===null?'—':`${highest}%`};
    const notes={average:change===null?(marked.length?'Reviewed work':'Awaiting grades'):`${change>=0?'↑':'↓'} ${Math.abs(change)}%`,total:`${completed} completed`,highest:highest===null?'Awaiting grades':highest===100?'Excellent!':'Keep it up!'};
    shell.querySelectorAll('[data-v8-metric]').forEach(n=>n.textContent=values[n.dataset.v8Metric]);
    shell.querySelectorAll('[data-v8-note]').forEach(n=>{const k=n.dataset.v8Note;n.textContent=notes[k];n.classList.toggle('v8-positive',k==='average' && change!==null && change>=0);n.classList.toggle('v8-negative',k==='average' && change!==null && change<0);});
    shell.querySelectorAll('[data-v8-detail]').forEach(n=>{const k=n.dataset.v8Detail;n.textContent=k==='average' && change!==null?(change>0?'Good improvement!':'Recent score trend'):'';});
  }
  function renderIdentity() {
    const profile=state.profile||{},section=studentClassForDashboard();
    const gender=String(profile.gender||'').trim().toLowerCase();
    const artwork=gender==='female'?'girl':gender==='male'?'boy':'neutral';
    shell.dataset.avatar=artwork;
    const name=profile.display_name || 'Student';
    $('#studentWelcome').textContent=name;
    $('#v8HeaderGrade').textContent=section?.grade_level?`Grade ${section.grade_level}`:profile.grade_level?`Grade ${profile.grade_level}`:'My classroom';
    $('#v8GreetingName').textContent=`${name.split(/\s+/)[0]}!`;
    const hour=new Date().getHours();
    $('#v8Greeting').textContent=window.CLASSSIDE_PREVIEW?'Good morning,':hour<12?'Good morning,':hour<18?'Good afternoon,':'Good evening,';
    const hero=$('#v8HeroCharacter');
    const src=artwork==='neutral'?'':`assets/student-${artwork}.png`;
    if(src && hero.getAttribute('src')!==src)hero.src=src;
    hero.hidden=!src;
    const initials=name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase() || 'ST';
    shell.querySelectorAll('[data-v8-avatar]').forEach(n=>{
      n.textContent=initials;
      n.style.backgroundImage='none';
      n.classList.remove('has-art','custom-photo');
    });
  }
  function renderUpcoming() {
    const list=state.assignments.filter(a=>a.status==='published' && !submissionFor(a.id)).sort((a,b)=>(date(a.due_at)?.getTime()??Infinity)-(date(b.due_at)?.getTime()??Infinity)).slice(0,3);
    $('#v8UpcomingList').innerHTML=list.length?list.map(a=>{
      const k=kind(a);const upcoming=status(a).key==='upcoming';
      return `<button type="button" class="v8-upcoming-row" ${upcoming?'data-v8-action="upcoming"':`data-answer-assignment="${esc(a.id)}"`}><span class="v8-dot ${k.color}"></span><span class="v8-task-icon ${k.color}">${icon('task')}</span><span class="v8-task-title"><b>${esc(a.title)}</b></span>${due(a)}${statusMarkup(a)}</button>`;
    }).join(''):empty('You’re all caught up!',state.assignments.length?'Great work. Check Grades & Feedback for your teacher’s comments.':'Your teacher’s activities will appear here once they are posted.');
  }
  function renderActivities() {
    const needle=studentTaskSearch.trim().toLowerCase();
    const writtenAssignments=state.assignments.filter(a=>!isPerformanceTask(a));
    const list=writtenAssignments.filter(a=>(studentTaskFilter==='all' || studentAssignmentState(a)===studentTaskFilter) && (!needle || `${a.title || ''} ${a.instructions || ''} ${sectionLabel(sectionById(a.section_id))}`.toLowerCase().includes(needle)));
    list.sort((a,b)=>{const av=studentTaskSortValue(a,studentTaskSort),bv=studentTaskSortValue(b,studentTaskSort);return typeof av==='string'?av.localeCompare(String(bv)):av-bv;});
    $('#studentTaskSummary').textContent=`${list.length} activit${list.length===1?'y':'ies'} shown${needle?` for “${studentTaskSearch}”`:''}.`;
    const searchInput=$('#studentTaskSearch'), sortSelect=$('#studentTaskSort');
    if(searchInput) searchInput.value=studentTaskSearch;
    if(sortSelect) sortSelect.value=studentTaskSort;
    const counts={ongoing:0,submitted:0,missed:0};
    writtenAssignments.forEach(a=>{const key=studentAssignmentState(a);if(key in counts)counts[key]+=1;});
    shell.querySelectorAll('[data-student-filter-count]').forEach(n=>{n.textContent=String(counts[n.dataset.studentFilterCount]||0);});
    shell.querySelectorAll('.student-filter').forEach(n=>{const active=n.dataset.studentFilter===studentTaskFilter;n.classList.toggle('active',active);n.setAttribute('aria-pressed',String(active));});
    $('#studentAssignmentList').innerHTML=list.length?list.map(a=>{
      const k=kind(a),sub=submissionFor(a.id),s=status(a);
      const archived=a.status==='archived';
      const action=archived&&!sub?'data-v8-action="archived"':s.key==='upcoming'?'data-v8-action="upcoming"':sub?`data-preview-response="${esc(sub.id)}"`:`data-answer-assignment="${esc(a.id)}"`;
      return `<article class="v8-activity-row ${archived?'is-archived':''}"><span class="v8-task-icon ${k.color}">${icon('task')}</span><div class="v8-task-title"><b>${esc(a.title)}</b><small>${esc(k.label)}</small></div>${due(a)}${statusMarkup(a)}<button type="button" class="v8-view-button" ${action} aria-label="View ${esc(a.title)}">View</button>${sub && !archived && sub.resubmit_allowed?`<button class="v8-resubmit" data-answer-assignment="${esc(a.id)}">Submit new attempt</button>`:''}</article>`;
    }).join(''):empty(writtenAssignments.length?'No matching activities.':'No activities yet.',writtenAssignments.length?'Try another search term or filter.':'Your teacher’s activities will appear here.');
  }
  function renderGrades() {
    renderMetrics();
    const marked=state.submissions.filter(s=>s.student_id===state.user?.id && s.status==='graded').sort((a,b)=>(date(b.graded_at || b.updated_at || b.submitted_at)?.getTime()||0)-(date(a.graded_at || a.updated_at || a.submitted_at)?.getTime()||0));
    $('#studentGradedCount').textContent=`${marked.length} graded`;
    $('#studentGradeList').innerHTML=marked.length?(expandedFeedback?marked:marked.slice(0,3)).map(s=>{
      const a=assignmentById(s.assignment_id),k=kind(a||{}),total=a?totalPoints(a.id):0;
      const raw=Number(s.teacher_score ?? s.auto_score ?? 0),pct=total>0?`${Math.round(raw/total*100)}%`:'—';
      const when=s.graded_at || s.updated_at || s.submitted_at;
      return `<article class="v8-feedback-row"><span class="v8-task-icon ${k.color}">${icon('task')}</span><div class="v8-feedback-title"><button type="button" data-preview-response="${esc(s.id)}" title="View your response">${esc(a?.title || 'Reviewed activity')}</button><time>${esc(formatDate(when) || 'Date unavailable')}</time></div><div class="v8-feedback-score"><span>Score</span><strong title="${raw} of ${total} points">${pct}</strong></div><div class="v8-feedback-message">${icon('check')}<p>${esc(s.feedback || 'Your teacher has reviewed this activity.')}</p></div></article>`;
    }).join('')+(marked.length>3?`<button type="button" class="v8-more-feedback" data-v8-action="all-feedback">${expandedFeedback?'Show recent feedback':`View all feedback (${marked.length})`}</button>`:''):empty('Your feedback will appear here.','Complete an activity. Once your teacher reviews it, you’ll see your score and comments here.');
  }
  function syncPanel() {
    removeLegacyRankingCards();
    document.body.classList.toggle('v8-student-active',!shell.hidden);
    shell.querySelectorAll('.v8-nav-link').forEach(n=>{
      const active=n.dataset.studentPanel===activeStudentPanel;n.classList.toggle('active',active);
      if(active)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');
    });
    renderIdentity();
  }
  function render(){renderIdentity();renderMetrics();renderUpcoming();renderActivities();renderGrades();syncPanel();}
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-v8-action]')?.dataset.v8Action;
    if(action==='all-feedback'){expandedFeedback=!expandedFeedback;renderGrades();}
    if(action==='view-tasks'){studentTaskFilter='ongoing';studentTaskSearch='';studentTaskSort='due';showStudentPanel('activities');}
    if(action==='upcoming')toast('This activity is not open yet. Your teacher will make it available on its scheduled date.');
    if(action==='archived')toast('This activity has been archived. You can still view it, but you can no longer upload or submit answers.', 'orange', 'Activity archived');
    if(action==='copy-username'){
      const value=$('#studentAccountUsername').textContent;
      if(value==='—'){ $('#v8AccountStatus').textContent='No username is available yet.';return; }
      const fallback=()=>{const range=document.createRange();range.selectNodeContents($('#studentAccountUsername'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);$('#v8AccountStatus').textContent='Username selected. Use your device’s Copy action.';};
      if(navigator.clipboard?.writeText)navigator.clipboard.writeText(value).then(()=>$('#v8AccountStatus').textContent='Username copied.').catch(fallback);else fallback();
    }
    if(event.target.closest('.v8-brand'))event.preventDefault();
    const task=event.target.closest('[data-answer-assignment]');
    if(task && !task.disabled && !window.CLASSSIDE_PREVIEW && assignmentById(task.dataset.answerAssignment)){
      try {const ids=new Set(startedIds());ids.add(task.dataset.answerAssignment);localStorage.setItem(startedKey(),JSON.stringify([...ids]));renderUpcoming();renderActivities();} catch {}
    }
  });
  new MutationObserver(()=>syncPanel()).observe(shell,{attributes:true,attributeFilter:['hidden']});
  window.EduCoreStudent={render,renderIdentity,renderActivities,renderGrades,syncPanel};
  window.EduCoreDesign={render};
  if(state.profile?.role==='student')render();
  else syncPanel();
})();

/* EduCore V10.5: mobile student burger navigation + account/notification relocation. */
(() => {
  'use strict';
  const shell = document.getElementById('studentApp');
  const drawer = document.getElementById('studentMobileDrawer');
  const toggle = document.getElementById('studentMenuToggle');
  const closeBtn = document.getElementById('studentMenuClose');
  const backdrop = document.getElementById('studentMenuBackdrop');
  const mobileTools = document.getElementById('studentMobileTools');
  const topbar = shell?.querySelector('.v8-topbar');
  const notification = document.getElementById('studentNotificationBtn');
  const account = shell?.querySelector('.v8-user-menu');
  if (!shell || !drawer || !toggle || !backdrop || !mobileTools || !topbar) return;

  const mq = window.matchMedia('(max-width: 760px)');

  function setOpen(open) {
    if (!mq.matches) open = false;
    drawer.classList.toggle('is-open', open);
    backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('v8-mobile-menu-open', open && !shell.hidden);
    if (open) closeBtn?.focus({ preventScroll: true });
  }

  function syncTools() {
    if (mq.matches) {
      if (account && account.parentElement !== mobileTools) mobileTools.appendChild(account);
      if (notification && notification.parentElement !== mobileTools) mobileTools.appendChild(notification);
    } else {
      if (notification && notification.parentElement !== topbar) topbar.appendChild(notification);
      if (account && account.parentElement !== topbar) topbar.appendChild(account);
      setOpen(false);
    }
  }

  toggle.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')));
  closeBtn?.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  notification?.addEventListener('click', () => setOpen(false));

  document.addEventListener('click', event => {
    if (mq.matches && event.target.closest('#studentMobileDrawer [data-student-panel]')) {
      setOpen(false);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drawer.classList.contains('is-open')) setOpen(false);
  });

  const onChange = () => syncTools();
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange);

  new MutationObserver(() => {
    if (shell.hidden) setOpen(false);
  }).observe(shell, { attributes:true, attributeFilter:['hidden'] });

  syncTools();
})();

/* EduCore V10.7.2: hard-isolate the student portal from teacher/public UI. */
(() => {
  'use strict';
  const shell = document.getElementById('studentApp');
  if (!shell) return;

  const teacherDialogIds = [
    'sectionModal','studentModal','accountsModal','deleteStudentModal',
    'classStudentsModal','studentTrackingModal','assignmentModal',
    'missingAnswerModal','assignmentPreviewModal','deleteAssignmentModal',
    'reviewSubmissionModal'
  ];

  function isolateStudentPortal() {
    if (shell.hidden) return;

    const publicSite = document.getElementById('publicSite');
    const teacherApp = document.getElementById('teacherApp');
    if (publicSite) publicSite.hidden = true;
    if (teacherApp) teacherApp.hidden = true;

    /* Remove the legacy accessibility link if an older cached HTML copy
       still contains it. The current HTML no longer includes this element. */
    document.querySelectorAll('#studentApp .v8-skip').forEach(node => node.remove());

    teacherDialogIds.forEach(id => {
      const dialog = document.getElementById(id);
      if (dialog?.open) dialog.close();
    });
  }

  new MutationObserver(isolateStudentPortal).observe(shell, {
    attributes: true,
    attributeFilter: ['hidden']
  });

  isolateStudentPortal();
})();
