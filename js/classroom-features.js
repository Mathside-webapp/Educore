/* EduCore V10 classroom features: To-Do, Calendar, Feedback Inbox,
   Draft Saving, Notifications, Resubmission controls, and Class Record export.
   Attendance and private messaging are intentionally not included. */
(() => {
  'use strict';

  const feature = {
    calendarCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    calendarSelectedDay: '',
    draftTimer: null,
    notifications: [],
    notificationCleanupDone: false,
    pollTimer: null
  };

  const safeDate = value => {
    const d = value ? new Date(value) : null;
    return d && Number.isFinite(d.getTime()) ? d : null;
  };
  const dayKey = value => {
    const d = safeDate(value);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const formatFullDate = value => {
    const d = safeDate(value);
    return d ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d) : 'No date';
  };
  const formatDateTime = value => {
    const d = safeDate(value);
    return d ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) : '';
  };
  const relativeDue = value => {
    const d = safeDate(value);
    if (!d) return { label: 'No deadline', key: 'none' };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((target - today) / 86400000);
    if (days < 0) return { label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, key: 'overdue' };
    if (days === 0) return { label: 'Due today', key: 'today' };
    if (days === 1) return { label: 'Due tomorrow', key: 'soon' };
    if (days <= 7) return { label: `Due in ${days} days`, key: 'soon' };
    return { label: `Due ${formatFullDate(d)}`, key: 'later' };
  };
  const currentUserId = () => state.user?.id || null;
  const connected = () => Boolean(db && currentUserId());
  const studentAssignments = () => state.assignments.filter(a => a.status === 'published');
  const todoAssignments = () => studentAssignments().filter(a => !submissionFor(a.id));

  function setBadge(id, count) {
    const node = document.getElementById(id);
    if (!node) return;
    const n = Math.max(0, Number(count || 0));
    node.textContent = n > 99 ? '99+' : String(n);
    node.hidden = n === 0;
  }

  function featureEmpty(title, copy = '') {
    return `<div class="v10-feature-empty"><b>${esc(title)}</b>${copy ? `<span>${esc(copy)}</span>` : ''}</div>`;
  }

  // ------------------------------------------------------------------
  // STUDENT TO-DO
  // ------------------------------------------------------------------
  function renderTodo() {
    const list = document.getElementById('studentTodoList');
    const summary = document.getElementById('studentTodoSummary');
    if (!list || !summary) return;
    const pending = todoAssignments().sort((a, b) => {
      const ad = safeDate(a.due_at)?.getTime() ?? Infinity;
      const bd = safeDate(b.due_at)?.getTime() ?? Infinity;
      return ad - bd || new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    const overdue = pending.filter(a => safeDate(a.due_at) && safeDate(a.due_at).getTime() < Date.now()).length;
    const dueWeek = pending.filter(a => {
      const d = safeDate(a.due_at);
      return d && d.getTime() >= Date.now() && d.getTime() <= Date.now() + 7 * 86400000;
    }).length;
    summary.innerHTML = `<article><b>${pending.length}</b><span>To do</span></article><article><b>${overdue}</b><span>Overdue</span></article><article><b>${dueWeek}</b><span>Due this week</span></article>`;
    setBadge('studentTodoNavBadge', pending.length);
    if (!pending.length) {
      list.innerHTML = featureEmpty('You’re all caught up!', 'No unfinished activities right now.');
      return;
    }
    list.innerHTML = pending.map(a => {
      const due = relativeDue(a.due_at);
      const section = sectionById(a.section_id);
      return `<article class="v10-todo-card ${due.key}">
        <div class="v10-todo-check" aria-hidden="true">✓</div>
        <div class="v10-todo-copy"><span>${esc(sectionLabel(section))}</span><h3>${esc(a.title)}</h3><p>${esc(a.instructions || 'Open this activity to continue working.')}</p></div>
        <div class="v10-todo-meta"><span class="v10-due-chip ${due.key}">${esc(due.label)}</span><button class="v8-view-button" type="button" data-answer-assignment="${esc(a.id)}">Open</button></div>
      </article>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // STUDENT CALENDAR
  // ------------------------------------------------------------------
  function renderCalendar() {
    const grid = document.getElementById('studentCalendarGrid');
    const label = document.getElementById('calendarMonthLabel');
    const agenda = document.getElementById('studentCalendarAgenda');
    const agendaTitle = document.getElementById('studentCalendarAgendaTitle');
    if (!grid || !label) return;
    const cursor = feature.calendarCursor;
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    label.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = first.getDay();
    const assignments = studentAssignments().filter(a => {
      const d = safeDate(a.due_at);
      return d && d.getFullYear() === year && d.getMonth() === month;
    }).sort((a,b) => new Date(a.due_at || 0) - new Date(b.due_at || 0));
    const byDay = new Map();
    assignments.forEach(a => {
      const key = dayKey(a.due_at);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(a);
    });
    const cells = [];
    for (let i = 0; i < prevDays; i += 1) cells.push('<div class="v10-calendar-day is-outside" aria-hidden="true"></div>');
    const today = dayKey(new Date());
    for (let day = 1; day <= daysInMonth; day += 1) {
      const d = new Date(year, month, day);
      const key = dayKey(d);
      const tasks = byDay.get(key) || [];
      const taskLabel = tasks.length ? `${tasks.length} deadline${tasks.length === 1 ? '' : 's'}` : 'No deadlines';
      cells.push(`<button type="button" class="v10-calendar-day ${key === today ? 'is-today' : ''} ${tasks.length ? 'has-task' : ''} ${feature.calendarSelectedDay === key ? 'is-selected' : ''}" data-calendar-day="${key}" aria-label="${esc(new Intl.DateTimeFormat(undefined,{month:'long',day:'numeric',year:'numeric'}).format(d))}: ${taskLabel}" title="${esc(taskLabel)}"><span class="v15-calendar-number">${day}</span>${tasks.length ? '<span class="v15-calendar-deadline-dot" aria-hidden="true"></span>' : ''}</button>`);
    }
    grid.innerHTML = cells.join('');

    if (!agenda) return;
    const selectedTasks = feature.calendarSelectedDay ? (byDay.get(feature.calendarSelectedDay) || []) : assignments;
    if (agendaTitle) {
      if (feature.calendarSelectedDay) {
        const selectedDate = safeDate(`${feature.calendarSelectedDay}T12:00:00`);
        agendaTitle.textContent = selectedDate
          ? `Deadlines for ${new Intl.DateTimeFormat(undefined,{month:'long',day:'numeric'}).format(selectedDate)}`
          : 'Deadlines';
      } else {
        agendaTitle.textContent = 'Deadlines this month';
      }
    }
    if (!selectedTasks.length) {
      agenda.innerHTML = `<div class="v10-calendar-empty">${feature.calendarSelectedDay ? 'No deadlines on this day.' : 'No deadlines this month.'}</div>`;
      return;
    }
    agenda.innerHTML = selectedTasks.map(a => {
      const submitted = submissionFor(a.id);
      const missed = !submitted && safeDate(a.due_at)?.getTime() < Date.now();
      const status = submitted ? 'Submitted' : missed ? 'Missed' : 'To do';
      const statusKey = submitted ? 'done' : missed ? 'missed' : 'todo';
      const type = isPerformanceTask(a) ? 'Performance Task' : 'Activity';
      const action = submitted ? `data-preview-response="${esc(submitted.id)}"` : isPerformanceTask(a) ? `data-submit-performance="${esc(a.id)}"` : `data-answer-assignment="${esc(a.id)}"`;
      return `<article class="v10-agenda-row"><time>${esc(formatDateTime(a.due_at))}</time><div><span>${esc(type)}</span><b>${esc(a.title)}</b></div><span class="v10-agenda-status ${statusKey}">${status}</span><button type="button" class="v8-view-button" ${action}>${submitted ? 'View' : 'Open'}</button></article>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // FEEDBACK INBOX
  // ------------------------------------------------------------------
  function renderFeedbackInbox() {
    const box = document.getElementById('studentFeedbackInbox');
    if (!box) return;
    const graded = state.submissions
      .filter(s => s.student_id === currentUserId() && s.status === 'graded')
      .sort((a,b) => new Date(b.graded_at || b.updated_at || b.submitted_at || 0) - new Date(a.graded_at || a.updated_at || a.submitted_at || 0));
    if (!graded.length) {
      box.innerHTML = featureEmpty('No teacher feedback yet.', 'Reviewed activities and teacher comments will appear here.');
      return;
    }
    box.innerHTML = graded.map(s => {
      const a = assignmentById(s.assignment_id);
      const total = a ? totalPoints(a.id) : 0;
      const raw = Number(s.teacher_score ?? s.auto_score ?? 0);
      const pct = total > 0 ? Math.round(raw / total * 100) : null;
      return `<article class="v10-feedback-card">
        <div class="v10-feedback-icon">✓</div>
        <div class="v10-feedback-main"><span>${esc(sectionLabel(sectionById(a?.section_id)))}</span><h3>${esc(a?.title || 'Reviewed activity')}</h3><p>${esc(s.feedback || 'Your teacher reviewed this activity.')}</p><time>${esc(formatDateTime(s.graded_at || s.updated_at || s.submitted_at))}</time></div>
        <div class="v10-feedback-score"><b>${pct === null ? '—' : `${pct}%`}</b><span>${raw}/${total}</span><button class="v8-view-button" type="button" data-preview-response="${esc(s.id)}">View response</button></div>
      </article>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // DRAFT SAVING
  // ------------------------------------------------------------------
  function collectDraftAnswers(assignment) {
    return questionsFor(assignment.id).map(q => ({
      question_id: q.id,
      answer: q.question_type === 'mcq'
        ? (document.querySelector(`input[name="answer_${q.id}"]:checked`)?.value || '')
        : (document.querySelector(`[name="answer_${q.id}"]`)?.value || '')
    }));
  }

  function applyDraftAnswers(assignment, answers = []) {
    const map = new Map((Array.isArray(answers) ? answers : []).map(row => [row.question_id, row.answer ?? '']));
    questionsFor(assignment.id).forEach(q => {
      const value = map.get(q.id);
      if (value == null) return;
      if (q.question_type === 'mcq') {
        const options = [...document.querySelectorAll(`input[name="answer_${q.id}"]`)];
        const match = options.find(input => input.value === value);
        if (match) match.checked = true;
      } else {
        const input = document.querySelector(`[name="answer_${q.id}"]`);
        if (input) {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
  }

  async function saveDraft() {
    if (!connected() || state.profile?.role !== 'student' || !activeStudentAssignment) return;
    const status = document.getElementById('studentDraftStatus');
    const answers = collectDraftAnswers(activeStudentAssignment);
    if (status) status.textContent = 'Saving draft…';
    const { error } = await db.from('classside_assignment_drafts').upsert({
      student_id: currentUserId(),
      assignment_id: activeStudentAssignment.id,
      answers,
      updated_at: new Date().toISOString()
    }, { onConflict: 'student_id,assignment_id' });
    if (error) {
      console.warn('Draft save failed:', error.message || error);
      if (status) status.textContent = 'Draft could not be saved. Check your connection.';
      return;
    }
    if (status) status.textContent = `Draft saved ${new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date())}`;
  }

  function queueDraftSave() {
    clearTimeout(feature.draftTimer);
    feature.draftTimer = setTimeout(() => saveDraft().catch(() => {}), 650);
  }

  async function prepareAnswerDraft(assignment) {
    if (!connected() || state.profile?.role !== 'student' || !assignment) return;
    const status = document.getElementById('studentDraftStatus');
    if (status) status.textContent = 'Loading saved draft…';
    const { data, error } = await db.from('classside_assignment_drafts')
      .select('answers,updated_at')
      .eq('student_id', currentUserId())
      .eq('assignment_id', assignment.id)
      .maybeSingle();
    if (!error && data?.answers) {
      applyDraftAnswers(assignment, data.answers);
      if (status) status.textContent = `Draft restored from ${formatDateTime(data.updated_at)}.`;
      return;
    }
    const existing = submissionFor(assignment.id);
    if (existing && assignment.allow_resubmission) {
      const previousAnswers = state.submissionAnswers
        .filter(row => row.submission_id === existing.id)
        .map(row => ({ question_id: row.question_id, answer: row.answer_text || '' }));
      applyDraftAnswers(assignment, previousAnswers);
      if (status) status.textContent = 'Previous submission loaded for your new attempt.';
      return;
    }
    if (status) status.textContent = 'Draft saving is ready.';
  }

  async function clearDraft(assignmentId) {
    if (!connected() || !assignmentId) return;
    await db.from('classside_assignment_drafts')
      .delete()
      .eq('student_id', currentUserId())
      .eq('assignment_id', assignmentId);
  }

  document.getElementById('answerForm')?.addEventListener('input', queueDraftSave);
  document.getElementById('answerForm')?.addEventListener('change', event => {
    if (event.target?.id === 'studentSolutionImage') return;
    queueDraftSave();
  });


  // ------------------------------------------------------------------
  // NOTIFICATIONS CENTER
  // ------------------------------------------------------------------
  function ensureNotificationDialog() {
    if (document.getElementById('v10NotificationDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="v10NotificationDialog" class="modal v10-notification-dialog"><div class="modal-box v10-notification-box"><button class="modal-close" type="button" id="v10NotificationClose" aria-label="Close">×</button><div class="v10-notification-title"><div><p class="eyebrow">EDUCORE UPDATES</p><h2>Notifications</h2></div><div class="v10-notification-actions"><button type="button" class="btn btn-light btn-small" id="v10PushNotificationBtn">Enable app alerts</button><button type="button" class="btn btn-light btn-small" id="v10MarkAllRead">Mark all read</button></div></div><div id="v10NotificationList" class="v10-notification-list"></div></div></dialog>`);
    document.getElementById('v10NotificationClose')?.addEventListener('click', () => document.getElementById('v10NotificationDialog')?.close());
    document.getElementById('v10MarkAllRead')?.addEventListener('click', async () => {
      if (!connected()) return;
      await db.rpc('classside_mark_notifications_read', { p_ids: null });
      await refreshNotifications();
    });
    document.getElementById('v10NotificationList')?.addEventListener('click', async event => {
      const btn = event.target.closest('[data-notification-id]');
      if (!btn) return;
      const note = feature.notifications.find(n => n.id === btn.dataset.notificationId);
      if (!note) return;
      // Remove the unread highlight immediately so the tap feels responsive.
      note.read_at = new Date().toISOString();
      btn.classList.remove('unread');
      btn.querySelector(':scope > i')?.remove();
      renderNotifications();
      await db.rpc('classside_mark_notifications_read', { p_ids: [note.id] });
      document.getElementById('v10NotificationDialog')?.close();
      await refreshNotifications();
      routeNotification(note);
    });
  }

  function notificationIcon(type) {
    if (type === 'feedback') return '✓';
    if (type === 'submission') return '↥';
    return '●';
  }

  function renderNotifications() {
    const box = document.getElementById('v10NotificationList');
    const unread = feature.notifications.filter(n => !n.read_at);
    setBadge('teacherNotificationBadge', state.profile?.role === 'teacher' ? unread.length : 0);
    setBadge('studentNotificationBadge', state.profile?.role === 'student' ? unread.length : 0);
    setBadge('studentFeedbackNavBadge', state.profile?.role === 'student' ? unread.filter(n => n.type === 'feedback').length : 0);
    if (!box) return;
    box.innerHTML = feature.notifications.length ? feature.notifications.map(n => `<button type="button" class="v10-notification-row ${n.read_at ? '' : 'unread'}" data-notification-id="${esc(n.id)}"><span class="v10-notification-kind">${notificationIcon(n.type)}</span><span><b>${esc(n.title || 'EduCore update')}</b><small>${esc(n.body || '')}</small><time>${esc(formatDateTime(n.created_at))}</time></span>${n.read_at ? '' : '<i></i>'}</button>`).join('') : featureEmpty('You’re all caught up.', 'New class updates will appear here.');
  }

  async function refreshNotifications() {
    if (!connected()) return;

    // Notifications are retained for seven days only. The RPC removes expired
    // database rows; the date filter also guarantees that an expired item never
    // appears in the UI while an older deployment is being upgraded.
    if (!feature.notificationCleanupDone) {
      const { error: cleanupError } = await db.rpc('classside_cleanup_old_notifications');
      if (cleanupError && !String(cleanupError.message || '').toLowerCase().includes('could not find')) {
        console.warn('Notification cleanup:', cleanupError.message || cleanupError);
      }
      feature.notificationCleanupDone = true;
    }
    const retentionCutoff = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
    const { data, error } = await db.from('classside_notifications')
      .select('*')
      .eq('user_id', currentUserId())
      .gte('created_at', retentionCutoff)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) {
      console.warn('Notifications not ready:', error.message || error);
      return;
    }
    feature.notifications = data || [];
    renderNotifications();
  }

  async function openNotifications() {
    ensureNotificationDialog();
    await refreshNotifications();
    const dialog = document.getElementById('v10NotificationDialog');
    if (dialog && !dialog.open) dialog.showModal();
  }

  function routeNotification(note) {
    if (state.profile?.role === 'student') {
      if (note.type === 'feedback') showStudentPanel('feedback');
      else showStudentPanel('todo');
    } else if (state.profile?.role === 'teacher') {
      showTeacherView('submissions');
    }
  }

  document.getElementById('teacherNotificationBtn')?.addEventListener('click', openNotifications);
  document.getElementById('studentNotificationBtn')?.addEventListener('click', openNotifications);

  // ------------------------------------------------------------------
  // EXPORT CLASS RECORD
  // ------------------------------------------------------------------
  function safeFilename(value) {
    return String(value || 'class').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'class';
  }

  function classRecordGenderRank(value) {
    const gender = String(value || '').trim().toLowerCase();
    if (gender === 'male' || gender === 'm' || gender === 'boy' || gender === 'boys') return 0;
    if (gender === 'female' || gender === 'f' || gender === 'girl' || gender === 'girls') return 1;
    return 2;
  }

  function classRecordGenderLabel(value) {
    const rank = classRecordGenderRank(value);
    if (rank === 0) return 'Male';
    if (rank === 1) return 'Female';
    return String(value || 'Not specified');
  }

  function downloadExcelBuffer(buffer, filename) {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function exportRosterAccounts() {
    if (!window.ExcelJS) return toast('Excel export library is not available.', 'orange', 'Export unavailable');
    const section = sectionById(activeRosterSectionId);
    if (!section) return toast('Open a class roster first.', 'orange', 'Choose a class');

    const students = studentsForSection(section.id).slice().sort((a, b) => {
      const genderDifference = classRecordGenderRank(a.gender) - classRecordGenderRank(b.gender);
      if (genderDifference) return genderDifference;
      return String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' });
    });
    if (!students.length) return toast('This class does not have any student accounts yet.', 'orange', 'Nothing to export');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EduCore';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Student Accounts', { views: [{ state: 'frozen', ySplit: 4 }] });
    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFC9B7A8' } },
      left: { style: 'thin', color: { argb: 'FFC9B7A8' } },
      bottom: { style: 'thin', color: { argb: 'FFC9B7A8' } },
      right: { style: 'thin', color: { argb: 'FFC9B7A8' } }
    };

    sheet.mergeCells('A1:D1');
    const title = sheet.getCell('A1');
    title.value = 'EDUCORE STUDENT ACCOUNTS';
    title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
    title.alignment = { vertical: 'middle', horizontal: 'left' };
    title.border = thinBorder;
    sheet.getRow(1).height = 28;

    sheet.mergeCells('A2:D2');
    const info = sheet.getCell('A2');
    info.value = `${section.name}   •   Grade ${section.grade_level}   •   Downloaded: ${new Date().toLocaleString()}`;
    info.font = { bold: true, color: { argb: 'FF7C2D00' } };
    info.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE8D5' } };
    info.alignment = { vertical: 'middle', horizontal: 'left' };
    info.border = thinBorder;

    const header = sheet.getRow(4);
    header.values = ['No.', 'Student Name', 'Gender', 'Username'];
    header.height = 25;
    header.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D3748' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = thinBorder;
    });

    let rowNumber = 5;
    let currentGroup = null;
    let number = 1;
    students.forEach(student => {
      const rank = classRecordGenderRank(student.gender);
      const group = rank === 0 ? 'MALE' : rank === 1 ? 'FEMALE' : 'OTHER / NOT SPECIFIED';
      if (group !== currentGroup) {
        currentGroup = group;
        sheet.mergeCells(`A${rowNumber}:D${rowNumber}`);
        const groupCell = sheet.getCell(`A${rowNumber}`);
        groupCell.value = group;
        groupCell.font = { bold: true, color: { argb: rank === 0 ? 'FF174A7E' : rank === 1 ? 'FF8C2458' : 'FF5B5B5B' } };
        groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rank === 0 ? 'FFDCEEFF' : rank === 1 ? 'FFFCE1EE' : 'FFECECEC' } };
        groupCell.alignment = { vertical: 'middle', horizontal: 'left' };
        for (let col = 1; col <= 4; col += 1) sheet.getCell(rowNumber, col).border = thinBorder;
        rowNumber += 1;
      }
      const row = sheet.getRow(rowNumber);
      row.values = [number++, student.display_name || '', classRecordGenderLabel(student.gender), student.username || ''];
      row.height = 21;
      row.eachCell((cell, col) => {
        cell.border = thinBorder;
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'center' : 'left', wrapText: true };
      });
      row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6EA' } };
      rowNumber += 1;
    });

    sheet.getColumn(1).width = 7;
    sheet.getColumn(2).width = 34;
    sheet.getColumn(3).width = 14;
    sheet.getColumn(4).width = 32;

    const notes = workbook.addWorksheet('Read Me');
    notes.columns = [{ width: 24 }, { width: 90 }];
    const noteRows = [
      ['EDUCORE — ACCOUNT LIST', ''],
      ['Purpose', 'Use this file to recover the current student names and EduCore usernames for this class.'],
      ['Passwords', 'For security, existing passwords are not stored in readable form and cannot be included in a later download. If a student forgot a password, the password must be reset rather than recovered.'],
      ['Class', section.name],
      ['Grade', `Grade ${section.grade_level}`]
    ];
    noteRows.forEach((values, index) => {
      const row = notes.addRow(values);
      row.eachCell(cell => { cell.border = thinBorder; cell.alignment = { vertical: 'top', wrapText: true }; });
      if (index === 0) {
        row.eachCell(cell => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
        });
      } else {
        row.getCell(1).font = { bold: true, color: { argb: 'FF7C2D00' } };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE8D5' } };
      }
    });

    try {
      const buffer = await workbook.xlsx.writeBuffer();
      downloadExcelBuffer(buffer, `EduCore-${safeFilename(section.name)}-Grade-${section.grade_level}-Student-Accounts.xlsx`);
      toast('Student account list downloaded.', 'success', 'Download complete');
    } catch (error) {
      console.error('Student account export failed:', error);
      toast('Could not create the student account Excel file.', 'orange', 'Export failed');
    }
  }

  async function exportClassRecord() {
    if (!window.ExcelJS) return toast('Excel export library is not available.', 'orange', 'Export unavailable');
    const section = sectionById(activeRosterSectionId);
    if (!section) return toast('Open a class roster first.', 'orange', 'Choose a class');

    const students = studentsForSection(section.id).slice().sort((a, b) => {
      const genderDifference = classRecordGenderRank(a.gender) - classRecordGenderRank(b.gender);
      if (genderDifference) return genderDifference;
      return String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' });
    });
    const assignments = state.assignments
      .filter(a => a.section_id === section.id && a.status === 'published')
      .sort((a,b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EduCore';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Class Record', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }]
    });

    const totalColumns = Math.max(2, 2 + assignments.length);
    const lastColumn = sheet.getColumn(totalColumns).letter;
    const title = `EduCore Class Record — ${section.name}`;

    sheet.mergeCells(`A1:${lastColumn}1`);
    const titleCell = sheet.getCell('A1');
    titleCell.value = title;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(1).height = 28;

    sheet.mergeCells(`A2:${lastColumn}2`);
    const infoCell = sheet.getCell('A2');
    infoCell.value = `Grade ${section.grade_level}   •   Teacher: ${state.profile?.display_name || 'Teacher'}   •   Exported: ${new Date().toLocaleString()}`;
    infoCell.font = { bold: true, color: { argb: 'FF7C2D00' } };
    infoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE8D5' } };
    infoCell.alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(2).height = 22;

    const headers = [
      'Student Name',
      'Gender',
      ...assignments.map(a => `${a.title}\n(${totalPoints(a.id)} pts)`)
    ];
    const headerRow = sheet.getRow(4);
    headerRow.values = headers;
    headerRow.height = 38;
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D3748' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFB8B8B8' } },
      left: { style: 'thin', color: { argb: 'FFB8B8B8' } },
      bottom: { style: 'thin', color: { argb: 'FFB8B8B8' } },
      right: { style: 'thin', color: { argb: 'FFB8B8B8' } }
    };

    let rowNumber = 5;
    let currentGroup = null;
    students.forEach(student => {
      const rank = classRecordGenderRank(student.gender);
      const group = rank === 0 ? 'MALE' : rank === 1 ? 'FEMALE' : 'OTHER / NOT SPECIFIED';
      if (group !== currentGroup) {
        currentGroup = group;
        sheet.mergeCells(`A${rowNumber}:${lastColumn}${rowNumber}`);
        const groupCell = sheet.getCell(`A${rowNumber}`);
        groupCell.value = group;
        groupCell.font = { bold: true, color: { argb: rank === 0 ? 'FF174A7E' : rank === 1 ? 'FF8C2458' : 'FF5B5B5B' } };
        groupCell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: rank === 0 ? 'FFDCEEFF' : rank === 1 ? 'FFFCE1EE' : 'FFECECEC' }
        };
        groupCell.alignment = { vertical: 'middle', horizontal: 'left' };
        for (let col = 1; col <= totalColumns; col += 1) sheet.getCell(rowNumber, col).border = thinBorder;
        rowNumber += 1;
      }

      const scoreValues = assignments.map(a => {
        const sub = state.submissions.find(s => s.assignment_id === a.id && s.student_id === student.id);
        if (!sub) return '—';
        const rawScore = sub.status === 'graded'
          ? (sub.teacher_score ?? sub.auto_score)
          : sub.auto_score;
        if (rawScore === null || rawScore === undefined || rawScore === '') return 'Pending';
        const numericScore = Number(rawScore);
        return Number.isFinite(numericScore) ? numericScore : rawScore;
      });

      const row = sheet.getRow(rowNumber);
      row.values = [student.display_name || '', classRecordGenderLabel(student.gender), ...scoreValues];
      row.height = 22;
      row.eachCell((cell, colNumber) => {
        cell.border = thinBorder;
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNumber <= 2 ? 'left' : 'center',
          wrapText: true
        };
        if (colNumber >= 3) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFAF5' } };
        }
      });
      const genderCell = row.getCell(2);
      genderCell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: rank === 0 ? 'FFF0F7FF' : rank === 1 ? 'FFFFF1F7' : 'FFF5F5F5' }
      };
      rowNumber += 1;
    });

    // Borders for the header row and a short legend under the record.
    headerRow.eachCell(cell => { cell.border = thinBorder; });
    rowNumber += 1;
    sheet.mergeCells(`A${rowNumber}:${lastColumn}${rowNumber}`);
    const legendCell = sheet.getCell(`A${rowNumber}`);
    legendCell.value = '— = Not submitted   •   Pending = Submitted but not yet scored';
    legendCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    legendCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    legendCell.border = thinBorder;

    sheet.getColumn(1).width = 34;
    sheet.getColumn(2).width = 13;
    for (let col = 3; col <= totalColumns; col += 1) sheet.getColumn(col).width = 22;
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: totalColumns } };

    // Keep the assignment reference sheet, but style it to match the class record.
    const assignmentSheet = workbook.addWorksheet('Assignments');
    assignmentSheet.columns = [
      { header: 'Assignment', key: 'assignment', width: 38 },
      { header: 'Maximum Points', key: 'points', width: 18 },
      { header: 'Deadline', key: 'deadline', width: 24 },
      { header: 'Resubmission', key: 'resubmission', width: 18 }
    ];
    assignmentSheet.getRow(1).height = 26;
    assignmentSheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = thinBorder;
    });
    assignments.forEach(a => {
      const row = assignmentSheet.addRow({
        assignment: a.title,
        points: totalPoints(a.id),
        deadline: a.due_at ? formatFullDate(a.due_at) : 'No deadline',
        resubmission: a.allow_resubmission ? 'Allowed' : 'Not allowed'
      });
      row.eachCell(cell => {
        cell.border = thinBorder;
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
    });
    assignmentSheet.views = [{ state: 'frozen', ySplit: 1 }];

    try {
      const buffer = await workbook.xlsx.writeBuffer();
      downloadExcelBuffer(buffer, `EduCore-${safeFilename(section.name)}-Grade-${section.grade_level}-Class-Record.xlsx`);
      toast('Class record exported to Excel.', 'success', 'Export complete');
    } catch (error) {
      console.error('Class record export failed:', error);
      toast('Could not create the Excel class record.', 'orange', 'Export failed');
    }
  }
  document.getElementById('downloadRosterAccountsBtn')?.addEventListener('click', exportRosterAccounts);
  document.getElementById('exportClassRecordBtn')?.addEventListener('click', exportClassRecord);

  // ------------------------------------------------------------------
  // PANEL HOOKS + CALENDAR CONTROLS
  // ------------------------------------------------------------------
  document.getElementById('calendarPrevBtn')?.addEventListener('click', () => {
    feature.calendarCursor = new Date(feature.calendarCursor.getFullYear(), feature.calendarCursor.getMonth() - 1, 1);
    feature.calendarSelectedDay = '';
    renderCalendar();
  });
  document.getElementById('calendarNextBtn')?.addEventListener('click', () => {
    feature.calendarCursor = new Date(feature.calendarCursor.getFullYear(), feature.calendarCursor.getMonth() + 1, 1);
    feature.calendarSelectedDay = '';
    renderCalendar();
  });
  document.getElementById('studentCalendarGrid')?.addEventListener('click', event => {
    const day = event.target.closest('[data-calendar-day]');
    if (!day) return;
    const key = day.dataset.calendarDay || '';
    feature.calendarSelectedDay = feature.calendarSelectedDay === key ? '' : key;
    renderCalendar();
  });

  async function renderStudentPanel(panel) {
    if (state.profile?.role !== 'student') return;
    renderTodo();
    if (panel === 'calendar') renderCalendar();
    if (panel === 'feedback') renderFeedbackInbox();
    refreshNotifications();
  }

  async function renderTeacherView() {
    if (state.profile?.role !== 'teacher') return;
    refreshNotifications();
  }

  async function syncWorkspace() {
    if (!connected() || !state.profile) return;
    ensureNotificationDialog();
    if (state.profile.role === 'student') {
      renderTodo();
      renderCalendar();
      renderFeedbackInbox();
    }
    await refreshNotifications();
  }

  const teacherApp = document.getElementById('teacherApp');
  const studentApp = document.getElementById('studentApp');
  if (teacherApp) new MutationObserver(syncWorkspace).observe(teacherApp, { attributes: true, attributeFilter: ['hidden'] });
  if (studentApp) new MutationObserver(syncWorkspace).observe(studentApp, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('focus', () => syncWorkspace().catch(() => {}));
  feature.pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && connected() && state.profile) refreshNotifications().catch(() => {});
  }, 45000);

  window.EduCoreV10 = {
    renderStudentPanel,
    renderTeacherView,
    prepareAnswerDraft,
    clearDraft,
    refreshNotifications,
    openNotifications,
    routeNotification,
    exportClassRecord
  };

  // Initial render for sessions restored before this script loaded.
  setTimeout(() => syncWorkspace().catch(() => {}), 0);
})();

/* EduCore V10.8: keep the auth dialog inside the visual viewport while
   the mobile keyboard is open. This is intentionally independent from
   the classroom-feature IIFE above. */
(() => {
  'use strict';

  const root = document.documentElement;
  const mobileQuery = window.matchMedia('(max-width: 760px)');

  function syncVisualViewport(){
    const viewport = window.visualViewport;
    if (viewport) {
      root.style.setProperty('--classside-vvh', `${Math.max(240, Math.round(viewport.height))}px`);
      root.style.setProperty('--classside-vv-top', `${Math.max(0, Math.round(viewport.offsetTop))}px`);
    } else {
      root.style.setProperty('--classside-vvh', `${window.innerHeight}px`);
      root.style.setProperty('--classside-vv-top', '0px');
    }
  }

  function revealFocusedAuthField(target){
    if (!mobileQuery.matches || !target?.closest?.('#authDialog')) return;
    window.setTimeout(() => {
      try {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      } catch (_) {
        target.scrollIntoView(false);
      }
    }, 140);
  }

  syncVisualViewport();
  window.addEventListener('resize', syncVisualViewport, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(syncVisualViewport, 120), { passive: true });
  window.visualViewport?.addEventListener('resize', syncVisualViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncVisualViewport, { passive: true });

  document.addEventListener('focusin', event => revealFocusedAuthField(event.target));

  const authDialog = document.getElementById('authDialog');
  authDialog?.addEventListener('close', () => {
    root.style.removeProperty('--classside-vv-top');
    syncVisualViewport();
  });
})();


/* EduCore V10.9: keep class-roster management controls collapsed until the
   teacher requests them. This keeps the roster much cleaner on phones. */
(() => {
  'use strict';

  function setupRosterManagementTools(){
    const modal = document.getElementById('classStudentsModal');
    const heading = modal?.querySelector('.roster-modal-heading');
    const actions = modal?.querySelector('.v10-roster-actions');
    const controls = modal?.querySelector('.roster-controls');
    const bulk = document.getElementById('studentBulkToolbar');
    if (!modal || !heading || !actions || !controls || !bulk) return;
    if (document.getElementById('rosterManagementTools')) return;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'rosterToolsToggle';
    toggle.className = 'v10-roster-tools-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'rosterManagementTools');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>Manage roster</span>';

    const tools = document.createElement('div');
    tools.id = 'rosterManagementTools';
    tools.className = 'v10-roster-management-tools';
    tools.hidden = true;

    heading.appendChild(toggle);
    heading.insertAdjacentElement('afterend', tools);
    tools.append(actions, controls, bulk);

    const setOpen = (open) => {
      tools.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      const label = toggle.querySelector('span');
      if (label) label.textContent = open ? 'Hide roster tools' : 'Manage roster';
    };

    toggle.addEventListener('click', () => setOpen(tools.hidden));
    modal.addEventListener('close', () => setOpen(false));

    /* If Add students opens another dialog, close the tools again so returning
       to the roster is clean and focused on the learner list. */
    document.getElementById('rosterAddStudentsBtn')?.addEventListener('click', () => setOpen(false));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupRosterManagementTools, { once: true });
  } else {
    setupRosterManagementTools();
  }
})();
