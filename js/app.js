const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const config = window.CLASSSIDE_CONFIG || {};
const isConfigured = Boolean(
  !window.CLASSSIDE_PREVIEW && window.supabase &&
  /^https?:\/\//i.test(String(config.SUPABASE_URL || '')) &&
  !String(config.SUPABASE_URL || '').includes('YOUR-PROJECT') &&
  String(config.SUPABASE_PUBLISHABLE_KEY || '').length > 20 &&
  !String(config.SUPABASE_PUBLISHABLE_KEY || '').includes('REPLACE_ME')
);

const db = isConfigured
  ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;


const SUBJECTS = {
  'English': { slug: 'english', primary: '#2563eb', secondary: '#60a5fa', dark: '#1e3a8a', soft: '#eff6ff', soft2: '#dbeafe' },
  'Filipino': { slug: 'filipino', primary: '#b91c1c', secondary: '#fb7185', dark: '#7f1d1d', soft: '#fef2f2', soft2: '#fee2e2' },
  'Araling Panlipunan': { slug: 'araling-panlipunan', primary: '#a16207', secondary: '#eab308', dark: '#713f12', soft: '#fffbeb', soft2: '#fef3c7' },
  'Science': { slug: 'science', primary: '#16a34a', secondary: '#4ade80', dark: '#14532d', soft: '#f0fdf4', soft2: '#dcfce7' },
  'ESP': { slug: 'esp', primary: '#7c3aed', secondary: '#a78bfa', dark: '#4c1d95', soft: '#f5f3ff', soft2: '#ede9fe' },
  'TLE': { slug: 'tle', primary: '#0891b2', secondary: '#22d3ee', dark: '#164e63', soft: '#ecfeff', soft2: '#cffafe' },
  'MAPEH': { slug: 'mapeh', primary: '#db2777', secondary: '#f472b6', dark: '#831843', soft: '#fdf2f8', soft2: '#fce7f3' },
};
function normalizedSubject(value = '') {
  const text = String(value || '').trim();
  if (Object.prototype.hasOwnProperty.call(SUBJECTS, text)) return text;
  const lower = text.toLocaleLowerCase();
  return Object.keys(SUBJECTS).find(name => name.toLocaleLowerCase() === lower) || '';
}
function currentSubject() { return normalizedSubject(state?.profile?.subject) || ''; }

const EDUCORE_LOGOS = {
  general: 'assets/educore-logos/educore-general.png?v=305',
  english: 'assets/educore-logos/educore-english.png?v=305',
  filipino: 'assets/educore-logos/educore-filipino.png?v=305',
  'araling-panlipunan': 'assets/educore-logos/educore-araling-panlipunan.png?v=305',
  science: 'assets/educore-logos/educore-science.png?v=305',
  esp: 'assets/educore-logos/educore-esp.png?v=305',
  tle: 'assets/educore-logos/educore-tle.png?v=305',
  mapeh: 'assets/educore-logos/educore-mapeh.png?v=305'
};

function applyEduCoreLogo(slug = 'general') {
  const src = EDUCORE_LOGOS[slug] || EDUCORE_LOGOS.general;
  document.querySelectorAll('img.cap-logo, .loading-logo img, .subject-orbit-center img, img.v8-logo-icon').forEach(img => {
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  });
}

function applySubjectTheme(subject = '') {
  const normalized = normalizedSubject(subject);
  const theme = normalized ? SUBJECTS[normalized] : {
    slug: 'general', primary: '#4f46e5', secondary: '#8b5cf6', dark: '#312e81', soft: '#eef2ff', soft2: '#ddd6fe'
  };
  const root = document.documentElement;
  root.dataset.subject = theme.slug;
  root.style.setProperty('--active-subject-color', theme.primary);
  root.style.setProperty('--subject-primary', theme.primary);
  root.style.setProperty('--subject-secondary', theme.secondary);
  root.style.setProperty('--subject-dark', theme.dark);
  root.style.setProperty('--subject-soft', theme.soft);
  root.style.setProperty('--subject-soft-2', theme.soft2);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.primary);
  applyEduCoreLogo(theme.slug);
}


const state = {
  user: null,
  profile: null,
  sections: [],
  members: [],
  students: [],
  assignments: [],
  questions: [],
  keys: [],
  submissions: [],
  submissionAnswers: []
};

let authMode = 'signin';
let activeSectionId = null;
let questionCount = 0;
let activeStudentAssignment = null;
let activeSubmissionId = null;
let pendingResubmissionId = null;
let lastGeneratedAccounts = [];
let lastGeneratedSection = null;
let pendingStudentAction = null;
let pendingAssignmentDeleteId = null;
let pendingAssignmentDeleteIds = [];
let editingAssignmentId = null;
let editingAssignmentIds = [];
let missingAnswerResolve = null;
const selectedStudentIds = new Set();
const selectedAssignmentIds = new Set();
let studentTaskFilter = 'ongoing';
let studentTaskSort = 'newest';
let studentTaskSearch = '';
let activeStudentPanel = 'overview';
let studentGradeWatchTimer = null;
let studentWorkspacePollBusy = false;
let studentWorkspaceSignature = '';
let studentWorkspaceFullRefreshAt = 0;
const STUDENT_WORKSPACE_POLL_MS = 60000;
const STUDENT_WORKSPACE_FULL_REFRESH_MS = 15 * 60 * 1000;
let studentLoginAlertsShownFor = null;
let activeRosterSectionId = null;
let studentRosterSearch = '';
let studentRosterSort = 'gender';
let submissionSectionId = 'all';
let submissionReviewFilter = 'all';
let submissionGroupMode = 'section';
let submissionSort = 'newest';
let activeTrackingStudentId = null;
let loadingDepth = 0;
const signedUrlCache = new Map();
const submissionAnswerCache = new Map();

const messageQueue = [];
let messagePopupOpen = false;

function toast(message, type = 'orange', title = '') {
  messageQueue.push({ message: String(message || ''), type, title });
  showNextMessage();
}

function showNextMessage() {
  if (messagePopupOpen || !messageQueue.length) return;
  const dialog = $('#messageDialog');
  if (!dialog) return;
  const item = messageQueue.shift();
  messagePopupOpen = true;
  dialog.classList.remove('message-success', 'message-orange', 'message-danger');
  const messageClass = item.type === 'success' ? 'message-success' : item.type === 'danger' ? 'message-danger' : 'message-orange';
  dialog.classList.add(messageClass);
  $('#messageEyebrow').textContent = item.type === 'success' ? 'EDUCORE • COMPLETE' : item.type === 'danger' ? 'EDUCORE • URGENT' : 'EDUCORE • NOTICE';
  $('#messageTitle').textContent = item.title || (item.type === 'success' ? 'Success' : item.type === 'danger' ? 'Deadline warning' : 'Please check');
  $('#messageText').textContent = item.message;
  $('#messageIcon').innerHTML = item.type === 'success'
    ? iconSvg('check', 'dynamic-icon')
    : iconSvg('assignment', 'dynamic-icon');
  if (!dialog.open) dialog.showModal();
}


function esc(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
}

function friendlyErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const raw = String(error?.message || error || '').trim();
  const lower = raw.toLowerCase();
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  // HEIC/HEIF is common on iPhone/iPad. EduCore converts it before upload;
  // if conversion cannot run, show a normal in-app message instead of Supabase's raw MIME error.
  if (lower.includes('image/heic') || lower.includes('image/heif') || lower.includes('heic_conversion')) {
    return 'This is an iPhone/iPad HEIC photo. EduCore could not convert it to a supported JPG image this time. Check your internet connection and try again, or choose a JPG/PNG photo.';
  }
  const looksLikeNetworkError = offline
    || lower.includes('failed to fetch')
    || lower.includes('networkerror')
    || lower.includes('network request failed')
    || lower.includes('load failed')
    || lower.includes('connection closed')
    || lower.includes('connection reset');
  if (looksLikeNetworkError) {
    return offline
      ? 'You appear to be offline. Connect to Wi-Fi or mobile data, then try again.'
      : 'Poor internet connection or temporary network problem. Check your Wi-Fi or mobile data, then try again.';
  }
  if (lower.includes('edge function returned a non-2xx status code') || lower.includes('functionshttperror')) {
    return fallback;
  }
  return raw || fallback;
}


// EduCore uses normal plain-text fields for questions and student answers.
function richText(value = '') {
  return esc(String(value ?? '')).replace(/\n/g, '<br>');
}

function richMath(value = '') { return richText(value); }

// Keep student short-answer values as plain text for all subjects.
function studentAnswerLatex(value = '') { return String(value ?? '').trim(); }

function updateStudentAnswerPreview() {}

function richStudentAnswer(value = '') { const text = String(value ?? '').trim(); return text ? richText(text) : 'No answer'; }

function refreshStudentAnswerPreviews() {}


function iconSvg(name, className = 'dynamic-icon') {
  const paths = {
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2"/>',
    assignment: '<path d="M6 3h9l3 3v15H6zM14 3v4h4M9 11h6M9 15h6"/>',
    calculator: '<path d="M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
    inbox: '<path d="M4 5h16v14H4zM4 14h4l2 3h4l2-3h4"/>',
    check: '<path d="M5 12.5 10 17l9-10"/>',
    class: '<path d="M4 5h16v14H4zM8 5V3h8v2M8 10h8M8 14h5"/>'
  };
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.assignment}</svg>`;
}

function safeFileName(name = 'file') {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-100) || 'file';
}

function isHeicImage(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return type === 'image/heic'
    || type === 'image/heif'
    || type === 'image/heic-sequence'
    || type === 'image/heif-sequence'
    || /\.(heic|heif)$/.test(name);
}

async function convertHeicToJpeg(file) {
  if (!isHeicImage(file)) return file;
  if (typeof window.heic2any !== 'function') {
    throw new Error('HEIC_CONVERSION_UNAVAILABLE');
  }
  try {
    const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.90 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob) throw new Error('HEIC conversion returned no image.');
    const baseName = String(file.name || 'iphone-photo').replace(/\.(heic|heif)$/i, '') || 'iphone-photo';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (error) {
    console.warn('HEIC conversion failed', error);
    throw new Error('HEIC_CONVERSION_FAILED');
  }
}

// Convert iPhone HEIC photos when needed, then compress phone photos in the
// browser before they are sent to Supabase Storage. This keeps written work
// readable while greatly reducing storage usage.
async function compressImageForUpload(file, options = {}) {
  if (!file || !String(file.type || '').startsWith('image/') && !isHeicImage(file)) return file;
  file = await convertHeicToJpeg(file);
  const supportedInput = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!supportedInput.has(String(file.type || '').toLowerCase())) return file;

  const maxDimension = Math.max(800, Number(options.maxDimension || 1800));
  const targetBytes = Math.max(200 * 1024, Number(options.targetBytes || 700 * 1024));
  const initialQuality = Math.min(0.92, Math.max(0.58, Number(options.quality || 0.82)));
  const minQuality = Math.min(initialQuality, Math.max(0.46, Number(options.minQuality || 0.56)));
  const minLongEdge = Math.max(800, Number(options.minLongEdge || 900));
  const hardLimitBytes = Math.max(targetBytes, Number(options.hardLimitBytes || Math.round(targetBytes * 1.12)));
  const maxResizeRounds = Math.max(3, Math.min(7, Number(options.maxResizeRounds || 5)));

  let bitmap = null;
  let objectUrl = '';
  try {
    if ('createImageBitmap' in window) {
      try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch { bitmap = await createImageBitmap(file); }
    } else {
      objectUrl = URL.createObjectURL(file);
      bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not read the selected image.'));
        image.src = objectUrl;
      });
    }

    const sourceWidth = Number(bitmap.width || bitmap.naturalWidth || 0);
    const sourceHeight = Number(bitmap.height || bitmap.naturalHeight || 0);
    if (!sourceWidth || !sourceHeight) return file;

    let scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    let width = Math.max(1, Math.round(sourceWidth * scale));
    let height = Math.max(1, Math.round(sourceHeight * scale));
    let bestBlob = null;

    const encode = (w, h, quality) => new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) return reject(new Error('Image compression is not available in this browser.'));
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, w, h);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not compress the selected image.')), 'image/webp', quality);
    });

    // First lower WebP quality, then gently reduce dimensions only when the
    // image is still over the requested target. Student solution photos use a
    // ~450 KB target; the extra resize rounds make that target much more
    // reliable without immediately sacrificing handwriting readability.
    for (let resizeRound = 0; resizeRound < maxResizeRounds; resizeRound += 1) {
      for (let quality = initialQuality; quality >= minQuality - 0.001; quality -= 0.07) {
        const blob = await encode(width, height, Math.max(minQuality, quality));
        if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
        if (blob.size <= targetBytes) break;
      }
      if (bestBlob?.size <= targetBytes || Math.max(width, height) <= minLongEdge) break;
      width = Math.max(1, Math.round(width * 0.86));
      height = Math.max(1, Math.round(height * 0.86));
    }

    // One final pass near the readability floor provides a small safety buffer
    // for unusually detailed phone photos. It still never shrinks below the
    // configured long-edge floor unless the source image was already smaller.
    if (bestBlob?.size > targetBytes && Math.max(width, height) > minLongEdge) {
      const lastScale = minLongEdge / Math.max(width, height);
      width = Math.max(1, Math.round(width * lastScale));
      height = Math.max(1, Math.round(height * lastScale));
      const finalBlob = await encode(width, height, minQuality);
      if (!bestBlob || finalBlob.size < bestBlob.size) bestBlob = finalBlob;
    }

    // Student-photo calls use a 500 KB hard ceiling. Only unusually detailed
    // images that remain above it are reduced one last time to an 800 px long
    // edge; ordinary handwritten pages stay at the larger dimensions above.
    if (bestBlob?.size > hardLimitBytes && Math.max(width, height) > 800) {
      const emergencyScale = 800 / Math.max(width, height);
      const emergencyWidth = Math.max(1, Math.round(width * emergencyScale));
      const emergencyHeight = Math.max(1, Math.round(height * emergencyScale));
      const emergencyBlob = await encode(emergencyWidth, emergencyHeight, Math.min(minQuality, 0.48));
      if (!bestBlob || emergencyBlob.size < bestBlob.size) bestBlob = emergencyBlob;
    }

    if (!bestBlob || (bestBlob.size >= file.size && file.size <= targetBytes)) return file;
    const originalName = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    const outputType = String(bestBlob.type || 'image/webp').toLowerCase();
    const extension = outputType === 'image/png' ? 'png' : outputType === 'image/jpeg' ? 'jpg' : 'webp';
    return new File([bestBlob], `${originalName}-compressed.${extension}`, {
      type: outputType,
      lastModified: Date.now()
    });
  } catch (error) {
    console.warn('Image compression skipped; the original file will be uploaded.', error);
    return file;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
window.compressImageForUpload = compressImageForUpload;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function startLoading(title, message) {
  loadingDepth += 1;
  const overlay = $('#appLoading');
  $('#loadingTitle').textContent = title;
  $('#loadingMessage').textContent = message;
  overlay.hidden = false;
  overlay.classList.remove('leaving');
}

async function stopLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth) return;
  const overlay = $('#appLoading');
  overlay.classList.add('leaving');
  await sleep(320);
  overlay.hidden = true;
  overlay.classList.remove('leaving');
}

async function withLoading(title, message, fn) {
  startLoading(title, message);
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - started;
    if (elapsed < 450) await sleep(450 - elapsed);
    await stopLoading();
  }
}

// Cross-platform anti-double-click button states. Uses standard DOM APIs
// so the same flow works on iOS Safari, Android Chrome, and desktop browsers.
function startActionButton(button, busyText = 'Working…') {
  if (!button || button.dataset.educoreBusy === '1') return false;
  button.dataset.educoreBusy = '1';
  button.dataset.educoreOriginalText = button.textContent || '';
  button.dataset.educoreOriginalDisabled = button.disabled ? '1' : '0';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = busyText;
  return true;
}

function resetActionButton(button) {
  if (!button) return;
  const originalText = button.dataset.educoreOriginalText;
  const wasDisabled = button.dataset.educoreOriginalDisabled === '1';
  if (originalText !== undefined) button.textContent = originalText;
  button.disabled = wasDisabled;
  button.removeAttribute('aria-busy');
  button.removeAttribute('data-educore-busy');
  delete button.dataset.educoreOriginalText;
  delete button.dataset.educoreOriginalDisabled;
  button.classList.remove('action-done');
}

async function finishActionButton(button, doneText = 'Done', holdMs = 420) {
  if (!button) return;
  button.textContent = doneText;
  button.classList.add('action-done');
  button.setAttribute('aria-busy', 'false');
  if (holdMs > 0) await sleep(holdMs);
  resetActionButton(button);
}

function actionButtonBusy(button) {
  return Boolean(button?.dataset?.educoreBusy === '1');
}

window.EduCoreActionButton = {
  start: startActionButton,
  done: finishActionButton,
  reset: resetActionButton,
  busy: actionButtonBusy
};

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

$('#messageCloseBtn')?.addEventListener('click', () => {
  const dialog = $('#messageDialog');
  if (dialog?.open) dialog.close();
  messagePopupOpen = false;
  showNextMessage();
});

$('#messageDialog')?.addEventListener('cancel', event => {
  // Notifications only disappear when the user explicitly clicks Close.
  event.preventDefault();
});

function requireSupabase() {
  if (db) return true;
  toast('Connect EduCore first: edit js/config.js with your Supabase Project URL and publishable key.', 'orange');
  return false;
}

function resetState() {
  stopStudentGradeWatcher();
  studentLoginAlertsShownFor = null;
  studentWorkspacePollBusy = false;
  studentWorkspaceSignature = '';
  studentWorkspaceFullRefreshAt = 0;
  state.user = null;
  state.profile = null;
  state.sections = [];
  state.members = [];
  state.students = [];
  state.assignments = [];
  state.questions = [];
  state.keys = [];
  state.submissions = [];
  state.submissionAnswers = [];
  lastGeneratedAccounts = [];
  lastGeneratedSection = null;
  pendingStudentAction = null;
  signedUrlCache.clear();
  submissionAnswerCache.clear();
}

async function signedUrl(bucket, path, seconds = 3600) {
  if (!db || !path) return '';
  const key = `${bucket}:${path}`;
  if (signedUrlCache.has(key)) return signedUrlCache.get(key);
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) return '';
  const url = data?.signedUrl || '';
  if (url) signedUrlCache.set(key, url);
  return url;
}

document.addEventListener('error', async event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const path = image.dataset.assignmentStoragePath;
  if (!path || image.dataset.retryingAssignmentImage === 'done') return;
  if (image.dataset.retryingAssignmentImage === 'retrying') {
    image.dataset.retryingAssignmentImage = 'done';
    image.closest('.assignment-thumb')?.classList.add('image-fallback');
    image.hidden = true;
    return;
  }
  image.dataset.retryingAssignmentImage = 'retrying';
  signedUrlCache.delete(`classside-assignment-images:${path}`);
  const freshUrl = await signedUrl('classside-assignment-images', path, 3600);
  if (freshUrl) {
    image.src = freshUrl;
  } else {
    image.dataset.retryingAssignmentImage = 'done';
    image.closest('.assignment-thumb')?.classList.add('image-fallback');
    image.hidden = true;
  }
}, true);

function sectionById(id) { return state.sections.find(s => s.id === id); }
function studentById(id) { return state.students.find(s => s.id === id); }
function assignmentById(id) { return state.assignments.find(a => a.id === id); }
function questionsFor(assignmentId) { return state.questions.filter(q => q.assignment_id === assignmentId).sort((a,b) => a.position-b.position); }
function keyFor(questionId) { return state.keys.find(k => k.question_id === questionId); }
function submissionFor(assignmentId, studentId = state.user?.id) { return state.submissions.find(s => s.assignment_id === assignmentId && s.student_id === studentId); }
function sectionStudentIds(sectionId) { return state.members.filter(m => m.section_id === sectionId).map(m => m.student_id); }
function studentsForSection(sectionId) {
  const ids = new Set(sectionStudentIds(sectionId));
  return state.students.filter(s => ids.has(s.id)).sort((a,b) => a.display_name.localeCompare(b.display_name));
}
function sectionLabel(section) { return section ? `${section.name} · Grade ${section.grade_level}` : 'Unknown class'; }
function workType(assignment) { return assignment?.work_type === 'performance_task' ? 'performance_task' : 'written_work'; }
function isPerformanceTask(assignment) { return workType(assignment) === 'performance_task'; }
function workTypeLabel(assignment) { return isPerformanceTask(assignment) ? 'Performance Task' : 'Written Work'; }
function totalPoints(assignmentId) {
  const assignment = assignmentById(assignmentId);
  return isPerformanceTask(assignment)
    ? Math.max(0, Number(assignment?.max_points || 0))
    : questionsFor(assignmentId).reduce((sum, q) => sum + Number(q.max_points || 0), 0);
}
function normalizeStoredPaths(value, fallback = '') {
  let paths = [];
  if (Array.isArray(value)) paths = value;
  else if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); paths = Array.isArray(parsed) ? parsed : [value]; }
    catch { paths = [value]; }
  }
  paths = paths.map(item => String(item || '').trim()).filter(Boolean);
  if (!paths.length && fallback) paths = [String(fallback)];
  return [...new Set(paths)];
}
function submissionProofPaths(submission) { return normalizeStoredPaths(submission?.proof_paths, submission?.proof_path || ''); }


function formatDeadlineDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric', minute: '2-digit'
  }).format(date);
}

function deadlineRelativeLabel(value) {
  if (!value) return '';
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  const abs = Math.abs(ms);
  const hours = Math.max(1, Math.round(abs / (60 * 60 * 1000)));
  if (ms < 0) return hours < 24 ? `${hours}h overdue` : `${Math.max(1, Math.round(hours / 24))}d overdue`;
  return hours < 24 ? `${hours}h left` : `${Math.max(1, Math.round(hours / 24))}d left`;
}

function reminderLabel(hours) {
  const value = Number(hours || 0);
  if (value === 24) return '1 day before';
  if (value === 48) return '2 days before';
  if (value === 72) return '3 days before';
  return 'No reminder';
}

function studentUrgentAssignments() {
  const now = Date.now();
  return state.assignments
    .filter(a => !submissionFor(a.id) && a.due_at && Number(a.reminder_hours_before || 0) > 0)
    .filter(a => {
      const due = new Date(a.due_at).getTime();
      const reminderMs = Number(a.reminder_hours_before || 0) * 60 * 60 * 1000;
      return Number.isFinite(due) && reminderMs > 0 && due <= now + reminderMs;
    })
    .sort((a,b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
}

function notifyStudentDeadlineOnLogin() {
  const urgent = studentUrgentAssignments();
  if (!urgent.length) return;
  const overdue = urgent.filter(a => new Date(a.due_at).getTime() < Date.now()).length;
  const preview = urgent.slice(0, 4).map(a => `• ${a.title} — ${formatDeadlineDate(a.due_at)} (${deadlineRelativeLabel(a.due_at)})`).join('\n');
  const more = urgent.length > 4 ? `\n• +${urgent.length - 4} more classwork item${urgent.length - 4 === 1 ? '' : 's'}` : '';
  const lead = overdue
    ? `You have ${urgent.length} unfinished classwork item${urgent.length === 1 ? '' : 's'} needing attention, including ${overdue} past the deadline.`
    : `You have ${urgent.length} unfinished classwork item${urgent.length === 1 ? '' : 's'} approaching the deadline.`;
  toast(`${lead}\n\n${preview}${more}\n\nSubmit your work before time runs out.`, 'danger', overdue ? 'Overdue classwork warning' : 'Deadline approaching');
}

function gradeNoticeStorageKey() {
  return `classside_seen_grades_${state.user?.id || 'student'}`;
}

function readSeenGradeNotices() {
  try { return JSON.parse(localStorage.getItem(gradeNoticeStorageKey()) || '{}') || {}; }
  catch { return {}; }
}

function writeSeenGradeNotices(value) {
  try { localStorage.setItem(gradeNoticeStorageKey(), JSON.stringify(value)); } catch {}
}

function notifyUnseenStudentGrades() {
  if (!state.user || state.profile?.role !== 'student') return;
  const seen = readSeenGradeNotices();
  const graded = state.submissions
    .filter(s => s.status === 'graded' && s.graded_at)
    .sort((a,b) => new Date(a.graded_at).getTime() - new Date(b.graded_at).getTime());
  const unseen = graded.filter(s => seen[s.id] !== String(s.graded_at));
  if (!unseen.length) return;

  unseen.forEach(submission => {
    const assignment = assignmentById(submission.assignment_id);
    const total = assignment ? totalPoints(assignment.id) : 0;
    const score = Number(submission.teacher_score ?? submission.auto_score ?? 0);
    const feedback = String(submission.feedback || '').trim();
    const gradedKind = assignment ? workTypeLabel(assignment) : 'Classwork';
    const message = `${assignment?.title || `Your ${gradedKind.toLowerCase()}`} has been checked and graded.\n\nScore: ${score}/${total}${feedback ? `\nTeacher feedback: ${feedback}` : ''}`;
    toast(message, 'success', `${gradedKind} graded`);
    seen[submission.id] = String(submission.graded_at);
  });
  writeSeenGradeNotices(seen);
}

function latestWorkspaceItem(items = []) {
  return [...items].sort((a, b) => new Date(b?.updated_at || b?.created_at || 0).getTime() - new Date(a?.updated_at || a?.created_at || 0).getTime())[0] || null;
}

function studentWorkspaceSignatureFromState() {
  const assignment = latestWorkspaceItem(state.assignments.filter(a => a.status === 'published'));
  const submission = latestWorkspaceItem(state.submissions);
  return [
    assignment ? `${assignment.id}:${assignment.updated_at || assignment.created_at || ''}` : 'no-assignment',
    submission ? `${submission.id}:${submission.updated_at || submission.submitted_at || ''}` : 'no-submission'
  ].join('|');
}

async function fetchStudentWorkspaceSignature() {
  if (!db || !state.user?.id) return studentWorkspaceSignature;
  const studentId = state.user.id;
  const [assignmentRes, submissionRes] = await Promise.all([
    db.from('classside_assignments')
      .select('id,updated_at,created_at,status')
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(1),
    db.from('classside_submissions')
      .select('id,updated_at,submitted_at,status,graded_at')
      .eq('student_id', studentId)
      .order('updated_at', { ascending: false })
      .limit(1)
  ]);
  if (assignmentRes.error) throw assignmentRes.error;
  if (submissionRes.error) throw submissionRes.error;
  const assignment = assignmentRes.data?.[0] || null;
  const submission = submissionRes.data?.[0] || null;
  return [
    assignment ? `${assignment.id}:${assignment.updated_at || assignment.created_at || ''}` : 'no-assignment',
    submission ? `${submission.id}:${submission.updated_at || submission.submitted_at || ''}` : 'no-submission'
  ].join('|');
}

async function checkStudentGradeUpdates() {
  if (!db || state.profile?.role !== 'student' || !state.user?.id) return;
  if (studentWorkspacePollBusy || document.visibilityState !== 'visible' || !navigator.onLine) return;
  studentWorkspacePollBusy = true;
  try {
    // Keep the 60-second schedule responsiveness, but only ask Supabase for the
    // newest assignment/submission timestamps. A full workspace reload happens
    // only when something actually changed.
    const remoteSignature = await fetchStudentWorkspaceSignature();
    const periodicRefreshDue = !studentWorkspaceFullRefreshAt || Date.now() - studentWorkspaceFullRefreshAt >= STUDENT_WORKSPACE_FULL_REFRESH_MS;
    if (remoteSignature === studentWorkspaceSignature && !periodicRefreshDue) return;
    await loadStudentData();
    notifyUnseenStudentGrades();
    renderStudentDashboard();
    showStudentPanel(activeStudentPanel);
  } catch (error) {
    console.warn('Student workspace refresh skipped:', error?.message || error);
  } finally {
    studentWorkspacePollBusy = false;
  }
}

function startStudentGradeWatcher() {
  stopStudentGradeWatcher();
  studentGradeWatchTimer = window.setInterval(checkStudentGradeUpdates, STUDENT_WORKSPACE_POLL_MS);
}

function stopStudentGradeWatcher() {
  if (studentGradeWatchTimer) window.clearInterval(studentGradeWatchTimer);
  studentGradeWatchTimer = null;
}

// ---------- PUBLIC NAV ----------
const menuToggle = $('#menuToggle');
const mainNav = $('#mainNav');
menuToggle.addEventListener('click', () => mainNav.classList.toggle('mobile-open'));
$$('.main-nav a').forEach(link => link.addEventListener('click', () => mainNav.classList.remove('mobile-open')));

// ---------- AUTH ----------
function setAuthMode(mode, requestedRole = '') {
  authMode = mode;
  const signup = mode === 'signup';
  $('#authHeading').textContent = signup ? 'Create teacher account' : 'Sign in';
  $('#authCopy').textContent = signup
    ? 'Choose your subject and create your account. Your request will be registered in Supabase and must be approved by the EduCore administrator before teacher access is enabled.'
    : 'Teachers use email. Students use the username generated by their teacher.';
  $('#nameField').hidden = !signup;
  $('#subjectField').hidden = !signup;
  $('#roleField').hidden = true;
  $('#roleSelect').value = requestedRole || 'teacher';
  $('#authSubmit').textContent = signup ? 'Create teacher account' : 'Sign in';
  $('#switchAuth').textContent = signup ? 'Already have an account? Sign in' : 'Teacher without an account? Create one';
}

$$('[data-open-auth]').forEach(btn => {
  btn.addEventListener('click', () => {
    setAuthMode(btn.dataset.openAuth || 'signin', btn.dataset.role || '');
    openDialog('authDialog');
  });
});

$('#switchAuth').addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));
$('#subjectSelect')?.addEventListener('change', event => applySubjectTheme(event.target.value));

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireSupabase()) return;

  const form = new FormData(event.currentTarget);
  const login = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const name = String(form.get('name') || '').trim();
  const subject = normalizedSubject(form.get('subject'));

  if (authMode === 'signup') {
    if (!login.includes('@')) return toast('Teacher accounts must use an email address.', 'orange');
    if (!subject) return toast('Choose the subject you teach before creating your account.', 'orange');
    try {
      await withLoading('Creating your EduCore…', 'Connecting your teacher workspace to Supabase.', async () => {
        const { data, error } = await db.auth.signUp({
          email: login,
          password,
          options: { data: { display_name: name || login.split('@')[0], subject } }
        });
        if (error) throw error;
        closeDialog('authDialog');
        if (data.session) {
          try { await db.auth.signOut({ scope: 'local' }); } catch {}
          resetState();
          returnPublic();
          toast('Your account is registered and is waiting for administrator approval. You can sign in after your account is approved.', 'success', 'Teacher request submitted');
        } else {
          toast('Account registered. Confirm your email if Supabase sends a verification link, then wait for the administrator to approve your teacher account.', 'success', 'Teacher request submitted');
        }
      });
    } catch (error) {
      console.error(error);
      toast(friendlyErrorMessage(error, 'Could not create the teacher account. Make sure this email is in the teacher allowlist.'), 'orange');
    }
    return;
  }

  try {
    await withLoading('Signing you in…', 'Opening your EduCore classroom.', async () => {
      let authEmail = login;
      if (!login.includes('@')) {
        const { data, error } = await db.rpc('classside_resolve_login', { p_username: login.toLowerCase() });
        if (error) throw error;
        if (!data) throw new Error('Student username or password is incorrect.');
        authEmail = data;
      }
      const { error } = await db.auth.signInWithPassword({ email: authEmail, password });
      if (error) throw error;
      closeDialog('authDialog');
      await routeAuthenticatedUser();
    });
  } catch (error) {
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not sign in.'), 'orange');
  }
});

$$('[data-close]').forEach(btn => btn.addEventListener('click', () => closeDialog(btn.dataset.close)));
// Dialogs no longer close when the user clicks the shaded backdrop.
// Action dialogs close only through their explicit X/Cancel/Done controls,
// while notification popups close only through their Close button.

async function loadCurrentIdentity() {
  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData?.user) throw userError || new Error('Your session is no longer valid.');
  state.user = userData.user;
  const { data: profile, error: profileError } = await db
    .from('classside_profiles')
    .select('id,display_name,role,username,gender,grade_level,avatar_path,created_by_teacher,subject')
    .eq('id', state.user.id)
    .single();
  if (profileError) throw profileError;
  state.profile = profile;
  applySubjectTheme(profile.subject);
}

async function routeAuthenticatedUser() {
  if (!db) return;
  await loadCurrentIdentity();
  if (state.profile.role === 'teacher') {
    await loadTeacherData();
    openTeacherApp();
    return;
  }
  if (state.profile.role === 'student') {
    await loadStudentData();
    openStudentApp();
    return;
  }
  if (state.profile.role === 'pending_teacher') {
    const pendingName = state.profile.display_name || 'Teacher';
    try { await db.auth.signOut({ scope: 'local' }); } catch {}
    resetState();
    returnPublic();
    toast(`${pendingName}, your EduCore account is registered but is still waiting for administrator approval. Please try signing in again after your account has been approved.`, 'orange', 'Waiting for approval');
    return;
  }
  throw new Error('This account has no valid EduCore role.');
}

async function signOut(message) {
  if (!db) returnPublic();
  try {
    await withLoading('Signing you out…', message, async () => {
      // Start push cleanup while the current session is still available,
      // but do not make the user wait for that network request to finish.
      try {
        const cleanup = window.EduCorePush?.unregisterForCurrentUser?.({ unsubscribe: true });
        if (cleanup?.catch) cleanup.catch(() => {});
      } catch (_) {}

      // EduCore should sign out only this browser/device. Supabase's default
      // JavaScript scope is global, which revokes every active session and can
      // make a simple sign-out feel unnecessarily slow.
      const { error } = await db.auth.signOut({ scope: 'local' });
      if (error) throw error;
      resetState();
      returnPublic();
    });
    toast('Signed out successfully.', 'success');
  } catch (error) {
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not sign out.'), 'orange');
  }
}

// ---------- APP SHELLS ----------
function openTeacherApp() {
  closeTeacherSidebar?.();
  stopStudentGradeWatcher();
  $('#publicSite').hidden = true;
  $('#studentApp').hidden = true;
  $('#teacherApp').hidden = false;
  $('#teacherName').textContent = state.profile?.display_name || 'Teacher';
  if ($('#teacherSubjectLabel')) $('#teacherSubjectLabel').textContent = currentSubject() || 'Teacher account';
  renderTeacher();
}

function openStudentApp() {
  $('#publicSite').hidden = true;
  $('#teacherApp').hidden = true;
  $('#studentApp').hidden = false;
  $('#studentWelcome').textContent = `Hi, ${state.profile?.display_name || 'Student'}`;
  studentTaskFilter = 'ongoing';
  studentTaskSort = 'newest';
  studentTaskSearch = '';
  activeStudentPanel = 'overview';
  showStudentPanel('overview');
  renderStudentDashboard();
  startStudentGradeWatcher();
  if (studentLoginAlertsShownFor !== state.user?.id) {
    studentLoginAlertsShownFor = state.user?.id || null;
    notifyStudentDeadlineOnLogin();
    notifyUnseenStudentGrades();
  }
}

function returnPublic() {
  applySubjectTheme('');
  closeTeacherSidebar?.();
  $('#teacherApp').hidden = true;
  $('#studentApp').hidden = true;
  $('#publicSite').hidden = false;
}

$('#teacherSignout').addEventListener('click', () => signOut('Saving your EduCore workspace.'));
$('#studentSignout').addEventListener('click', () => signOut('See you next time.'));

// ---------- DATA LOADING ----------
async function loadTeacherData() {
  const teacherId = state.user.id;
  const [sectionsRes, membersRes, studentsRes, assignmentsRes] = await Promise.all([
    db.from('classside_sections').select('*').eq('teacher_id', teacherId).order('grade_level').order('name'),
    db.from('classside_section_members').select('section_id,student_id,joined_at'),
    db.from('classside_profiles').select('id,display_name,role,username,gender,grade_level,avatar_path').eq('role', 'student').order('display_name'),
    db.from('classside_assignments').select('*').eq('teacher_id', teacherId).order('created_at', { ascending: false })
  ]);
  for (const result of [sectionsRes, membersRes, studentsRes, assignmentsRes]) if (result.error) throw result.error;
  state.sections = sectionsRes.data || [];
  state.members = membersRes.data || [];
  state.students = studentsRes.data || [];
  state.assignments = assignmentsRes.data || [];

  const assignmentIds = state.assignments.map(a => a.id);
  state.questions = [];
  state.keys = [];
  state.submissions = [];
  submissionAnswerCache.clear();
  if (assignmentIds.length) {
    const [questionsRes, submissionsRes] = await Promise.all([
      db.from('classside_questions').select('*').in('assignment_id', assignmentIds).order('position'),
      db.from('classside_submissions').select('*').in('assignment_id', assignmentIds).order('submitted_at', { ascending: false })
    ]);
    if (questionsRes.error) throw questionsRes.error;
    if (submissionsRes.error) throw submissionsRes.error;
    state.questions = questionsRes.data || [];
    state.submissions = submissionsRes.data || [];
    const questionIds = state.questions.map(q => q.id);
    if (questionIds.length) {
      const keysRes = await db.from('classside_question_keys').select('*').in('question_id', questionIds);
      if (keysRes.error) throw keysRes.error;
      state.keys = keysRes.data || [];
    }
  }

  await Promise.all(state.assignments.map(async assignment => {
    assignment.image_url = assignment.image_path
      ? await signedUrl('classside-assignment-images', assignment.image_path)
      : '';
  }));
}

async function loadStudentData() {
  const studentId = state.user.id;
  const [sectionsRes, membersRes, assignmentsRes, submissionsRes] = await Promise.all([
    db.from('classside_sections').select('*').order('grade_level').order('name'),
    db.from('classside_section_members').select('*').eq('student_id', studentId),
    db.from('classside_assignments').select('*').in('status', ['published','archived']).order('created_at', { ascending: false }),
    db.from('classside_submissions').select('*').eq('student_id', studentId).order('submitted_at', { ascending: false })
  ]);
  for (const result of [sectionsRes, membersRes, assignmentsRes, submissionsRes]) if (result.error) throw result.error;
  state.sections = sectionsRes.data || [];
  state.assignments = assignmentsRes.data || [];
  state.submissions = submissionsRes.data || [];
  state.students = [state.profile];
  state.members = membersRes.data || [];
  state.keys = [];
  state.submissionAnswers = [];

  const assignmentIds = state.assignments.map(a => a.id);
  state.questions = [];
  if (assignmentIds.length) {
    const questionsRes = await db.from('classside_questions').select('*').in('assignment_id', assignmentIds).order('position');
    if (questionsRes.error) throw questionsRes.error;
    state.questions = questionsRes.data || [];
  }

  const submissionIds = state.submissions.map(s => s.id);
  if (submissionIds.length) {
    const answersRes = await db.from('classside_submission_answers').select('*').in('submission_id', submissionIds);
    if (answersRes.error) throw answersRes.error;
    state.submissionAnswers = answersRes.data || [];
  }

  await Promise.all(state.assignments.map(async assignment => {
    assignment.image_url = assignment.image_path
      ? await signedUrl('classside-assignment-images', assignment.image_path)
      : '';
  }));
  studentWorkspaceSignature = studentWorkspaceSignatureFromState();
  studentWorkspaceFullRefreshAt = Date.now();
}

async function refreshTeacher() {
  await loadTeacherData();
  renderTeacher();
}

async function refreshStudent() {
  await loadStudentData();
  renderStudentDashboard();
  showStudentPanel(activeStudentPanel);
}

// ---------- TEACHER NAV ----------
function showTeacherView(view) {
  $$('.app-view').forEach(v => v.classList.remove('active'));
  $(`#view-${view}`)?.classList.add('active');
  $$('.side-link[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  const titleMap = { dashboard: 'Dashboard', classes: 'Classes', assignments: 'Assignments', submissions: 'Submissions' };
  $('#teacherPageTitle').textContent = titleMap[view] || (currentSubject() || 'EduCore');
  if (view === 'classes') renderClasses();
  if (view === 'assignments') renderAssignments();
  if (view === 'submissions') renderSubmissions();
  window.EduCoreV10?.renderTeacherView?.(view);
}

function setTeacherSidebar(open) {
  const sidebar = $('#teacherSidebar') || $('.sidebar');
  const backdrop = $('#teacherSidebarBackdrop');
  const toggle = $('#teacherMenuBtn');
  if (!sidebar) return;
  sidebar.classList.toggle('open', Boolean(open));
  backdrop?.classList.toggle('open', Boolean(open));
  document.body.classList.toggle('teacher-menu-open', Boolean(open));
  toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function closeTeacherSidebar() { setTeacherSidebar(false); }

$$('[data-view]').forEach(btn => btn.addEventListener('click', () => {
  showTeacherView(btn.dataset.view);
  closeTeacherSidebar();
}));
$$('[data-go-view]').forEach(btn => btn.addEventListener('click', () => {
  showTeacherView(btn.dataset.goView);
  closeTeacherSidebar();
}));
$('#teacherMenuBtn')?.setAttribute('aria-expanded', 'false');
$('#teacherMenuBtn')?.addEventListener('click', () => setTeacherSidebar(!($('#teacherSidebar') || $('.sidebar'))?.classList.contains('open')));
$('#teacherMenuClose')?.addEventListener('click', closeTeacherSidebar);
$('#teacherSidebarBackdrop')?.addEventListener('click', closeTeacherSidebar);
window.addEventListener('resize', () => { if (window.innerWidth > 780) closeTeacherSidebar(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTeacherSidebar(); });

function classCard(section, dashboard = false) {
  const studentCount = studentsForSection(section.id).length;
  const assignmentCount = state.assignments.filter(a => a.section_id === section.id).length;
  return `<article class="class-card" data-class-card-id="${section.id}" ${dashboard ? 'data-dashboard-class="true"' : ''}>
    <div class="class-card-top">
      <div class="class-card-heading">
        <span class="class-icon">${iconSvg('class', 'class-card-icon')}</span>
        <div class="class-card-copy"><small>CLASS</small><h3>${esc(section.name)}</h3></div>
      </div>
      <span class="grade-pill">Grade ${esc(section.grade_level)}</span>
    </div>
    <footer><span><b>${studentCount}</b> student${studentCount === 1 ? '' : 's'}</span><span>${assignmentCount} assignment${assignmentCount === 1 ? '' : 's'}</span></footer>
    <div class="class-card-actions">
      <button class="btn btn-light class-view-students-btn" type="button" data-view-class-students="${section.id}">${iconSvg('people', 'btn-icon')}View students</button>
    </div>
  </article>`;
}

function renderTeacher() {
  const uniqueStudents = new Set(state.members.map(m => m.student_id)).size;
  $('#studentTotal').textContent = uniqueStudents;
  $('#classTotal').textContent = state.sections.length;
  $('#assignmentTotal').textContent = groupedAssignmentsForDisplay().length;
  $('#dashboardClassGrid').innerHTML = state.sections.length
    ? state.sections.map(section => classCard(section, true)).join('')
    : `<div class="class-empty"><span>${iconSvg('class', 'empty-icon')}</span><h3>No classes yet</h3><p>Create your first class and choose its grade level.</p><button class="btn btn-orange" data-empty-create-class>Create class</button></div>`;
  renderClasses();
  renderAssignments();
  renderSubmissions();
  populateAssignmentSections();
}

function renderClasses() {
  const grid = $('#classGrid');
  grid.innerHTML = state.sections.length
    ? state.sections.map(section => classCard(section)).join('')
    : `<div class="class-empty"><span>${iconSvg('class', 'empty-icon')}</span><h3>No classes yet</h3><p>Click Create class, enter the class name, and choose its grade.</p></div>`;
}

document.addEventListener('click', event => {
  const viewStudentsBtn = event.target.closest('[data-view-class-students]');
  if (viewStudentsBtn) {
    const sectionId = viewStudentsBtn.dataset.viewClassStudents;
    activeSectionId = sectionId;
    openClassStudentsModal(sectionId);
    return;
  }
  if (event.target.closest('[data-empty-create-class]')) openSectionModal();
});

function rosterSortStudents(students) {
  const list = [...students];
  if (studentRosterSort === 'gender') {
    const genderOrder = { Male: 0, Female: 1, 'Prefer not to say': 2, 'Not specified': 3 };
    return list.sort((a, b) => {
      const ga = ['Female','Male','Prefer not to say'].includes(a.gender) ? a.gender : 'Not specified';
      const gb = ['Female','Male','Prefer not to say'].includes(b.gender) ? b.gender : 'Not specified';
      const g = (genderOrder[ga] ?? 9) - (genderOrder[gb] ?? 9);
      return g || String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' });
    });
  }
  return list.sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' }));
}

function currentRosterStudents() {
  if (!activeRosterSectionId) return [];
  const query = studentRosterSearch.trim().toLowerCase();
  const filtered = studentsForSection(activeRosterSectionId).filter(student => {
    if (!query) return true;
    return `${student.display_name || ''} ${student.username || ''} ${student.gender || ''}`.toLowerCase().includes(query);
  });
  return rosterSortStudents(filtered);
}

function updateRosterBulkUI() {
  const shown = currentRosterStudents();
  const shownIds = shown.map(student => student.id);
  const count = shownIds.filter(id => selectedStudentIds.has(id)).length;
  $('#selectedStudentCount') && ($('#selectedStudentCount').textContent = `${count} selected`);
  $('#bulkRemoveStudentsBtn') && ($('#bulkRemoveStudentsBtn').disabled = count === 0);
  $('#bulkDeleteStudentsBtn') && ($('#bulkDeleteStudentsBtn').disabled = count === 0);
  $('#bulkResetPasswordsBtn') && ($('#bulkResetPasswordsBtn').disabled = count === 0);
  const selectAll = $('#selectAllStudents');
  if (selectAll) {
    selectAll.checked = count > 0 && count === shownIds.length;
    selectAll.indeterminate = count > 0 && count < shownIds.length;
  }
}

function renderClassStudentsModal() {
  const section = sectionById(activeRosterSectionId);
  const list = $('#classStudentsList');
  if (!section || !list) return;
  const allStudents = studentsForSection(section.id);
  const students = currentRosterStudents();
  const maleCount = allStudents.filter(student => student.gender === 'Male').length;
  const femaleCount = allStudents.filter(student => student.gender === 'Female').length;
  $('#classStudentsTitle').textContent = section.name;
  $('#classStudentsMeta').textContent = `Grade ${section.grade_level} · ${allStudents.length} students · ${maleCount} male · ${femaleCount} female`;
  if (!students.length) {
    list.innerHTML = `<div class="assignment-empty">${studentRosterSearch ? 'No student matches your search.' : 'No students are enrolled in this section yet.'}</div>`;
    updateRosterBulkUI();
    return;
  }
  list.innerHTML = students.map(student => {
    const assignmentCount = state.assignments.filter(a => a.section_id === section.id).length;
    const submissions = state.submissions.filter(sub => sub.student_id === student.id && assignmentById(sub.assignment_id)?.section_id === section.id);
    const graded = submissions.filter(sub => sub.status === 'graded').length;
    const genderClass = student.gender === 'Male' ? 'gender-male' : student.gender === 'Female' ? 'gender-female' : 'gender-other';
    return `<article class="roster-student-card ${genderClass} ${selectedStudentIds.has(student.id) ? 'is-selected' : ''}">
      <label class="roster-check"><input class="row-check" type="checkbox" data-select-student="${student.id}" ${selectedStudentIds.has(student.id) ? 'checked' : ''}><span class="sr-only">Select ${esc(student.display_name)}</span></label>
      <button class="roster-student-main" type="button" data-track-student="${student.id}">
        <span class="roster-avatar">${esc((student.display_name || 'S').trim().charAt(0).toUpperCase())}</span>
        <span class="roster-student-copy"><b>${esc(student.display_name)}</b><small>${esc(student.username || 'No username')} · ${esc(student.gender || 'Not specified')}</small></span>
      </button>
      <div class="roster-progress"><span>${submissions.length}/${assignmentCount} submitted</span><span>${graded} graded</span></div>
      <div class="roster-student-actions"><button class="btn btn-light btn-small" type="button" data-track-student="${student.id}">Track</button><button class="table-delete" type="button" data-delete-student="${student.id}">Delete</button></div>
    </article>`;
  }).join('');
  updateRosterBulkUI();
}

function openClassStudentsModal(sectionId) {
  const section = sectionById(sectionId);
  if (!section) return;
  activeRosterSectionId = sectionId;
  studentRosterSearch = '';
  studentRosterSort = 'gender';
  selectedStudentIds.clear();
  $('#classStudentSearch') && ($('#classStudentSearch').value = '');
  $('#classStudentSort') && ($('#classStudentSort').value = 'gender');
  renderClassStudentsModal();
  openDialog('classStudentsModal');
}

$('#rosterAddStudentsBtn')?.addEventListener('click', () => {
  if (!activeRosterSectionId) return;
  const sectionId = activeRosterSectionId;
  closeDialog('classStudentsModal');
  openStudentModal(sectionId);
});

$('#classStudentSearch')?.addEventListener('input', event => {
  studentRosterSearch = event.currentTarget.value || '';
  renderClassStudentsModal();
});
$('#classStudentSort')?.addEventListener('change', event => {
  studentRosterSort = event.currentTarget.value || 'name';
  renderClassStudentsModal();
});
$('#classStudentsList')?.addEventListener('change', event => {
  const check = event.target.closest('[data-select-student]');
  if (!check) return;
  if (check.checked) selectedStudentIds.add(check.dataset.selectStudent);
  else selectedStudentIds.delete(check.dataset.selectStudent);
  check.closest('.roster-student-card')?.classList.toggle('is-selected', check.checked);
  updateRosterBulkUI();
});
$('#selectAllStudents')?.addEventListener('change', event => {
  const checked = event.currentTarget.checked;
  currentRosterStudents().forEach(student => {
    if (checked) selectedStudentIds.add(student.id);
    else selectedStudentIds.delete(student.id);
  });
  renderClassStudentsModal();
});
$('#classStudentsList')?.addEventListener('click', event => {
  const deleteBtn = event.target.closest('[data-delete-student]');
  if (deleteBtn) {
    openDeleteStudentModal(activeRosterSectionId, deleteBtn.dataset.deleteStudent);
    return;
  }
  const trackBtn = event.target.closest('[data-track-student]');
  if (trackBtn) openStudentTrackingModal(activeRosterSectionId, trackBtn.dataset.trackStudent);
});
$('#bulkRemoveStudentsBtn')?.addEventListener('click', () => {
  const ids = studentsForSection(activeRosterSectionId).map(s => s.id).filter(id => selectedStudentIds.has(id));
  if (ids.length) openDeleteStudentModal(activeRosterSectionId, ids);
});
$('#bulkDeleteStudentsBtn')?.addEventListener('click', () => {
  const ids = studentsForSection(activeRosterSectionId).map(s => s.id).filter(id => selectedStudentIds.has(id));
  if (ids.length) openDeleteStudentModal(activeRosterSectionId, ids);
});


async function buildResetPasswordsExcel(accounts, section) {
  if (!window.ExcelJS) throw new Error('Excel export library is not available. Check your connection and try again.');
  const createdAt = new Date();
  const genderRank = value => String(value || '').trim().toLowerCase() === 'male' ? 0 : String(value || '').trim().toLowerCase() === 'female' ? 1 : 2;
  const rows = (accounts || []).slice().sort((a, b) => {
    const g = genderRank(a.gender) - genderRank(b.gender);
    return g || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EduCore';
  workbook.created = createdAt;
  const sheet = workbook.addWorksheet('Reset Credentials', { views: [{ state: 'frozen', ySplit: 4 }] });
  const thinBorder = { top:{style:'thin',color:{argb:'FFC9B7A8'}}, left:{style:'thin',color:{argb:'FFC9B7A8'}}, bottom:{style:'thin',color:{argb:'FFC9B7A8'}}, right:{style:'thin',color:{argb:'FFC9B7A8'}} };
  sheet.mergeCells('A1:E1');
  const title = sheet.getCell('A1');
  title.value = 'EDUCORE — RESET STUDENT PASSWORDS';
  title.font = { bold:true, size:16, color:{argb:'FFFFFFFF'} };
  title.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFF6B00'} };
  title.alignment = { vertical:'middle', horizontal:'left' };
  title.border = thinBorder;
  sheet.getRow(1).height = 28;
  sheet.mergeCells('A2:E2');
  const info = sheet.getCell('A2');
  info.value = `${section?.name || 'Class'}   •   ${section?.grade_level ? `Grade ${section.grade_level}` : 'Grade'}   •   Reset: ${createdAt.toLocaleString()}`;
  info.font = { bold:true, color:{argb:'FF7C2D00'} };
  info.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFE8D5'} };
  info.alignment = { vertical:'middle', horizontal:'left' };
  info.border = thinBorder;
  const header = sheet.getRow(4);
  header.values = ['No.','Student Name','Gender','Username','New Password'];
  header.height = 25;
  header.eachCell(cell => { cell.font={bold:true,color:{argb:'FFFFFFFF'}}; cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2D3748'}}; cell.alignment={vertical:'middle',horizontal:'center',wrapText:true}; cell.border=thinBorder; });
  let rowNumber=5, number=1, currentGroup=null;
  for (const student of rows) {
    const rank=genderRank(student.gender);
    const group=rank===0?'MALE':rank===1?'FEMALE':'OTHER / NOT SPECIFIED';
    if (group!==currentGroup) {
      currentGroup=group;
      sheet.mergeCells(`A${rowNumber}:E${rowNumber}`);
      const groupCell=sheet.getCell(`A${rowNumber}`);
      groupCell.value=group;
      groupCell.font={bold:true,color:{argb:rank===0?'FF174A7E':rank===1?'FF8C2458':'FF5B5B5B'}};
      groupCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:rank===0?'FFDCEEFF':rank===1?'FFFCE1EE':'FFECECEC'}};
      groupCell.alignment={vertical:'middle',horizontal:'left'};
      for (let col=1;col<=5;col+=1) sheet.getCell(rowNumber,col).border=thinBorder;
      rowNumber+=1;
    }
    const row=sheet.getRow(rowNumber++);
    row.values=[number++,student.name||'',student.gender||'Not specified',student.username||'',student.temporary_password||''];
    row.height=21;
    row.eachCell((cell,col)=>{cell.border=thinBorder;cell.alignment={vertical:'middle',horizontal:col===1?'center':'left',wrapText:true};});
    row.getCell(4).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF6EA'}};
    row.getCell(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFEFD9'}};
    row.getCell(5).font={bold:true,color:{argb:'FF7C2D00'}};
  }
  sheet.getColumn(1).width=7; sheet.getColumn(2).width=34; sheet.getColumn(3).width=14; sheet.getColumn(4).width=32; sheet.getColumn(5).width=26;
  const notes=workbook.addWorksheet('Read Me');
  notes.columns=[{width:24},{width:90}];
  const noteRows=[['EDUCORE — IMPORTANT',''],['What changed','The listed student passwords were changed to the new passwords chosen by the teacher. Their previous passwords no longer work for future sign-ins.'],['Privacy','Keep this file private. Give each learner only their own username and new password.'],['Recovery','EduCore does not store readable passwords. If this file is lost, reset the affected password again.'],['Class',section?.name||''],['Grade',section?.grade_level?`Grade ${section.grade_level}`:'']];
  noteRows.forEach((values,index)=>{const row=notes.addRow(values);row.eachCell(cell=>{cell.border=thinBorder;cell.alignment={vertical:'top',wrapText:true};});if(index===0){row.eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFF6B00'}};});}else{row.getCell(1).font={bold:true,color:{argb:'FF7C2D00'}};row.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE8D5'}};}});
  const buffer=await workbook.xlsx.writeBuffer();
  const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  return { blob, filename:`EduCore-Reset-Passwords-${safeFileName(section?.name||'Class')}-${excelTimestamp(createdAt)}.xlsx` };
}
function isIOSDevice(){return /iPad|iPhone|iPod/i.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
function downloadPreparedResetExcel(exportFile){
  if(!exportFile?.blob||!exportFile?.filename)return toast('The reset Excel file is not ready. Please reset the password again.','orange','Download unavailable');
  const url=URL.createObjectURL(exportFile.blob);
  const link=document.createElement('a');
  link.href=url; link.download=exportFile.filename; link.rel='noopener';
  if(isIOSDevice()) link.target='_blank';
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
let resetPasswordStudentIds=[];
let latestResetPasswordExport=null;
function openResetPasswordsModal(section,ids){
  const selected=(ids||[]).map(studentById).filter(Boolean); if(!section||!selected.length)return;
  resetPasswordStudentIds=selected.map(student=>student.id);
  $('#resetPasswordsLead').textContent=selected.length===1?`Choose a new password for ${selected[0].display_name||'this learner'}. The old password will stop working for future sign-ins.`:`Choose a separate new password for each of the ${selected.length} selected learners. Their old passwords will stop working for future sign-ins.`;
  $('#resetPasswordRows').innerHTML=selected.map(student=>`<label class="reset-password-row"><span class="reset-password-student"><b>${esc(student.display_name||'Student')}</b><small>${esc(student.username||'No username')}</small></span><span class="reset-password-field"><span>New password</span><input type="password" data-reset-password-id="${esc(student.id)}" minlength="6" maxlength="72" autocomplete="new-password" autocapitalize="none" spellcheck="false" required placeholder="Enter new password"></span></label>`).join('');
  const show=$('#showResetPasswords'); if(show)show.checked=false;
  openDialog('resetPasswordsModal'); requestAnimationFrame(()=>$('#resetPasswordRows input')?.focus());
}
function renderResetPasswordsComplete(reset,section,exportError=null){
  $('#resetPasswordsCompleteTitle').textContent=`${reset.length} student password${reset.length===1?'':'s'} changed.`;
  $('#resetPasswordsCompleteLead').textContent=`${section?.name||'Class'}${section?.grade_level?` · Grade ${section.grade_level}`:''} — Download the Excel file and give each learner only their own credentials.`;
  $('#resetPasswordsCompleteBody').innerHTML=reset.map(student=>`<tr><td>${esc(student.name||'Student')}</td><td>${esc(student.gender||'Not specified')}</td><td>${esc(student.username||'')}</td><td><b>${esc(student.temporary_password||'')}</b></td></tr>`).join('');
  const status=$('#resetPasswordsExportStatus'),button=$('#downloadResetPasswordsExcelBtn');
  if(exportError||!latestResetPasswordExport){status.textContent='Passwords were changed successfully, but EduCore could not prepare the Excel file. Keep this window open and copy the credentials shown below.';if(button)button.disabled=true;}
  else{status.textContent='Your Excel file is ready. Tap Download Excel to save a copy.';if(button)button.disabled=false;}
  openDialog('resetPasswordsCompleteModal');
}
$('#showResetPasswords')?.addEventListener('change',event=>{const type=event.currentTarget.checked?'text':'password';$$('#resetPasswordRows input[data-reset-password-id]').forEach(input=>{input.type=type;});});
$('#bulkResetPasswordsBtn')?.addEventListener('click',()=>{const section=sectionById(activeRosterSectionId);if(!section)return toast('Open a class roster first.','orange');const ids=studentsForSection(activeRosterSectionId).map(student=>student.id).filter(id=>selectedStudentIds.has(id));if(!ids.length)return toast('Select at least one student first.','orange');openResetPasswordsModal(section,ids);});
$('#resetPasswordsForm')?.addEventListener('submit',async event=>{
  event.preventDefault(); const section=sectionById(activeRosterSectionId); if(!section)return toast('Open a class roster first.','orange');
  const passwordResets=resetPasswordStudentIds.map(studentId=>{const input=document.querySelector(`#resetPasswordRows input[data-reset-password-id="${CSS.escape(studentId)}"]`);return{student_id:studentId,password:String(input?.value||'').trim()};});
  const invalid=passwordResets.find(item=>item.password.length<6||item.password.length>72); if(invalid){const student=studentById(invalid.student_id);return toast(`Enter a password with 6 to 72 characters for ${student?.display_name||'every selected student'}.`,'orange','Password required');}
  const submitBtn=$('#confirmResetPasswordsBtn');
  if(!startActionButton(submitBtn,'Resetting…'))return;
  try{
    let result=null,exportError=null; latestResetPasswordExport=null;
    await withLoading('Resetting passwords…',`Applying the password${passwordResets.length===1?'':'s'} you chose.`,async()=>{
      result=await invokeTeacherFunction('reset-student-passwords',{section_id:section.id,password_resets:passwordResets});
      const reset=result?.reset||[];
      if(reset.length){$('#loadingTitle').textContent='Preparing Excel…';$('#loadingMessage').textContent='Creating the reset-password file for download.';try{latestResetPasswordExport=await buildResetPasswordsExcel(reset,section);}catch(error){exportError=error;console.error('RESET PASSWORD EXCEL ERROR',error);}}
    });
    const reset=result?.reset||[],failures=result?.failures||[];
    if(reset.length){
      await finishActionButton(submitBtn,'Done');
      selectedStudentIds.clear();resetPasswordStudentIds=[];closeDialog('resetPasswordsModal');renderClassStudentsModal();renderResetPasswordsComplete(reset,section,exportError);
    }else{
      resetActionButton(submitBtn);
    }
    if(failures.length)toast(`${failures.length} password${failures.length===1?'':'s'} could not be reset.\n\n${failures.map(item=>`${item.name||'Student'}: ${item.error||'Reset failed.'}`).join('\n')}`,'orange','Some resets failed');
  }catch(error){resetActionButton(submitBtn);console.error('RESET STUDENT PASSWORD ERROR',error);toast(friendlyErrorMessage(error,'Could not reset the selected student passwords. Please try again.'),'orange');}
});

$('#downloadResetPasswordsExcelBtn')?.addEventListener('click',()=>downloadPreparedResetExcel(latestResetPasswordExport));

function renderStudentTracking(sectionId, studentId) {
  const section = sectionById(sectionId);
  const student = studentById(studentId);
  if (!section || !student) return;
  const assignments = state.assignments.filter(a => a.section_id === sectionId && a.status === 'published').sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const submissions = state.submissions.filter(sub => sub.student_id === studentId && assignments.some(a => a.id === sub.assignment_id));
  const graded = submissions.filter(sub => sub.status === 'graded').length;
  $('#studentTrackingName').textContent = student.display_name || 'Student';
  $('#studentTrackingMeta').textContent = `${sectionLabel(section)} · ${student.gender || 'Not specified'} · ${student.username || 'No username'}`;
  $('#studentTrackingStats').innerHTML = `<article><b>${assignments.length}</b><span>Assigned</span></article><article><b>${submissions.length}</b><span>Submitted</span></article><article><b>${graded}</b><span>Graded</span></article><article><b>${Math.max(0, assignments.length - submissions.length)}</b><span>To do</span></article>`;
  const list = $('#studentTrackingList');
  if (!assignments.length) {
    list.innerHTML = '<div class="assignment-empty">No assignments have been posted to this section yet.</div>';
    return;
  }
  list.innerHTML = assignments.map(assignment => {
    const submission = submissions.find(sub => sub.assignment_id === assignment.id);
    const total = totalPoints(assignment.id);
    const score = submission ? Number(submission.status === 'graded' ? (submission.teacher_score ?? submission.auto_score ?? 0) : (submission.auto_score || 0)) : 0;
    const status = submission ? (submission.status === 'graded' ? 'Graded' : 'Submitted') : 'Not submitted';
    return `<article class="tracking-assignment-card ${submission ? 'has-submission' : 'missing-submission'}"><div><span class="student-status ${submission?.status === 'graded' ? 'status-graded' : submission ? 'status-submitted' : ''}">${status}</span><h4>${esc(assignment.title)}</h4><p>${assignment.due_at ? `Deadline ${esc(formatDeadlineDate(assignment.due_at))}` : 'No deadline'}</p></div><div class="tracking-assignment-meta">${submission ? `<b>${score}/${total}</b><small>Submitted ${esc(formatStudentDate(submission.submitted_at) || '')}</small>` : '<b>—</b><small>No response yet</small>'}</div>${submission ? `<button class="btn btn-light btn-small" type="button" data-track-review-submission="${submission.id}">Preview submission</button>` : '<span></span>'}</article>`;
  }).join('');
}

function openStudentTrackingModal(sectionId, studentId) {
  activeTrackingStudentId = studentId;
  renderStudentTracking(sectionId, studentId);
  openDialog('studentTrackingModal');
}

$('#studentTrackingList')?.addEventListener('click', async event => {
  const btn = event.target.closest('[data-track-review-submission]');
  if (!btn) return;
  closeDialog('studentTrackingModal');
  await openSubmissionReview(btn.dataset.trackReviewSubmission);
});

// ---------- CLASSES ----------
function openSectionModal() {
  $('#sectionForm').reset();
  $('#sectionGrade').value = '7';
  openDialog('sectionModal');
}

$('#createClassBtn').addEventListener('click', openSectionModal);
$('#dashboardCreateClass').addEventListener('click', openSectionModal);

$('#sectionForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireSupabase()) return;
  const formElement = event.currentTarget;
  const submitBtn = formElement.querySelector('button[type="submit"]');
  const form = new FormData(formElement);
  const grade = Number(form.get('grade_level'));
  const name = String(form.get('name') || '').trim();
  const colors = { 7:'#ff6b00', 8:'#ff8f00', 9:'#ff4f81', 10:'#3e8ef7', 11:'#7b61c8', 12:'#2c9c78' };
  if (!name) return toast('Enter a class name.', 'orange');
  if (!startActionButton(submitBtn, 'Creating…')) return;
  try {
    await withLoading('Creating class…', `Setting up ${name} for Grade ${grade}.`, async () => {
      const { data, error } = await db.from('classside_sections').insert({
        teacher_id: state.user.id,
        grade_level: grade,
        name,
        color: colors[grade] || '#ff6b00'
      }).select().single();
      if (error) throw error;
      activeSectionId = data.id;
      await refreshTeacher();
      showTeacherView('classes');
    });
    await finishActionButton(submitBtn, 'Done');
    closeDialog('sectionModal');
    toast('Class created.', 'success');
  } catch (error) {
    resetActionButton(submitBtn);
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not create the class.'), 'orange');
  }
});

// ---------- STUDENT ACCOUNT MANAGEMENT ----------
async function invokeTeacherFunction(name, body) {
  const { data: sessionData, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Your teacher session has expired. Please sign in again.');

  const { data, error } = await db.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (error) {
    let detail = error.message || `${name} rejected the request.`;
    try {
      const response = error.context;
      if (response && typeof response.clone === 'function') {
        const clone = response.clone();
        const payload = await clone.json().catch(() => null);
        if (payload) detail = payload.error || payload.message || payload.msg || detail;
      }
    } catch (_) {}
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

function openDeleteStudentModal(sectionId, studentIdOrIds) {
  const section = sectionById(sectionId);
  const studentIds = Array.isArray(studentIdOrIds) ? studentIdOrIds.filter(Boolean) : [studentIdOrIds].filter(Boolean);
  const students = studentIds.map(studentById).filter(Boolean);
  if (!section || !students.length) return;
  pendingStudentAction = { sectionId, studentIds };
  if (students.length === 1) {
    const student = students[0];
    $('#deleteStudentTitle').textContent = student.display_name || 'Student';
    $('#deleteStudentUsernameLabel').textContent = 'Username';
    $('#deleteStudentUsername').textContent = student.username || 'No username';
  } else {
    $('#deleteStudentTitle').textContent = `${students.length} students selected`;
    $('#deleteStudentUsernameLabel').textContent = 'Accounts';
    $('#deleteStudentUsername').textContent = `${students.length} EduCore accounts`;
  }
  $('#deleteStudentClass').textContent = sectionLabel(section);
  openDialog('deleteStudentModal');
}

async function runStudentDelete(deleteAccount) {
  if (!requireSupabase() || !pendingStudentAction) return;
  const { sectionId, studentIds = [] } = pendingStudentAction;
  const students = studentIds.map(studentById).filter(Boolean);
  if (!students.length) return;
  const actionTitle = deleteAccount
    ? `Deleting ${students.length === 1 ? 'student account' : `${students.length} student accounts`}…`
    : `Removing ${students.length === 1 ? 'student' : `${students.length} students`}…`;
  const actionMessage = deleteAccount
    ? 'Removing login accounts, EduCore records, and student-uploaded files from Supabase Storage.'
    : 'Removing the selected students from this class while keeping their login accounts.';

  const failures = [];
  try {
    closeDialog('deleteStudentModal');
    await withLoading(actionTitle, actionMessage, async () => {
      for (const student of students) {
        try {
          await invokeTeacherFunction('delete-student', {
            section_id: sectionId,
            student_id: student.id,
            delete_account: Boolean(deleteAccount)
          });
        } catch (error) {
          failures.push({ name: student.display_name || 'Student', error: error.message || 'Delete failed' });
        }
      }
      pendingStudentAction = null;
      selectedStudentIds.clear();
      await refreshTeacher();
      activeSectionId = sectionId;
      if ($('#classStudentsModal')?.open) renderClassStudentsModal();
    });

    const successCount = students.length - failures.length;
    if (successCount) {
      toast(
        deleteAccount
          ? `${successCount} student account${successCount === 1 ? '' : 's'} permanently deleted.`
          : `${successCount} student${successCount === 1 ? '' : 's'} removed from this class. Their login accounts were kept.`,
        'success'
      );
    }
    if (failures.length) {
      toast(`${failures.length} student${failures.length === 1 ? '' : 's'} could not be updated.\n\n${failures.map(item => `${item.name}: ${item.error}`).join('\n')}`, 'orange', 'Some actions failed');
    }
  } catch (error) {
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not update the selected students.'), 'orange');
  }
}

$('#removeStudentOnlyBtn')?.addEventListener('click', () => runStudentDelete(false));
$('#deleteStudentAccountBtn')?.addEventListener('click', () => runStudentDelete(true));

function excelTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function downloadGeneratedAccountsExcel() {
  if (!window.ExcelJS) return toast('Excel export could not load. Check your internet connection and try again.', 'orange');
  if (!lastGeneratedAccounts.length) return toast('There are no newly generated student credentials to download.', 'orange');

  const section = lastGeneratedSection || sectionById(activeSectionId) || {};
  const generatedAt = new Date();
  const genderRank = value => String(value || '').trim().toLowerCase() === 'male' ? 0 : String(value || '').trim().toLowerCase() === 'female' ? 1 : 2;
  const accounts = lastGeneratedAccounts.slice().sort((a, b) => {
    const g = genderRank(a.gender) - genderRank(b.gender);
    return g || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EduCore';
  workbook.created = generatedAt;
  const sheet = workbook.addWorksheet('Student Accounts', { views: [{ state: 'frozen', ySplit: 4 }] });
  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFC9B7A8' } },
    left: { style: 'thin', color: { argb: 'FFC9B7A8' } },
    bottom: { style: 'thin', color: { argb: 'FFC9B7A8' } },
    right: { style: 'thin', color: { argb: 'FFC9B7A8' } }
  };

  sheet.mergeCells('A1:E1');
  const title = sheet.getCell('A1');
  title.value = 'EDUCORE STUDENT LOGIN ACCOUNTS';
  title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  title.border = thinBorder;
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:E2');
  const info = sheet.getCell('A2');
  info.value = `${section.name || 'Class'}   •   ${section.grade_level ? `Grade ${section.grade_level}` : 'Grade'}   •   Generated: ${generatedAt.toLocaleString()}`;
  info.font = { bold: true, color: { argb: 'FF7C2D00' } };
  info.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE8D5' } };
  info.border = thinBorder;
  info.alignment = { vertical: 'middle', horizontal: 'left' };

  const header = sheet.getRow(4);
  header.values = ['No.', 'Student Name', 'Gender', 'Username', 'Temporary Password'];
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
  accounts.forEach(student => {
    const rank = genderRank(student.gender);
    const group = rank === 0 ? 'MALE' : rank === 1 ? 'FEMALE' : 'OTHER / NOT SPECIFIED';
    if (group !== currentGroup) {
      currentGroup = group;
      sheet.mergeCells(`A${rowNumber}:E${rowNumber}`);
      const groupCell = sheet.getCell(`A${rowNumber}`);
      groupCell.value = group;
      groupCell.font = { bold: true, color: { argb: rank === 0 ? 'FF174A7E' : rank === 1 ? 'FF8C2458' : 'FF5B5B5B' } };
      groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rank === 0 ? 'FFDCEEFF' : rank === 1 ? 'FFFCE1EE' : 'FFECECEC' } };
      groupCell.alignment = { vertical: 'middle', horizontal: 'left' };
      for (let col = 1; col <= 5; col += 1) sheet.getCell(rowNumber, col).border = thinBorder;
      rowNumber += 1;
    }

    const row = sheet.getRow(rowNumber);
    row.values = [number++, student.name || '', student.gender || 'Not specified', student.username || '', student.temporary_password || ''];
    row.height = 21;
    row.eachCell((cell, col) => {
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'center' : 'left', wrapText: true };
    });
    row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6EA' } };
    row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEFD9' } };
    rowNumber += 1;
  });

  sheet.getColumn(1).width = 7;
  sheet.getColumn(2).width = 34;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 32;
  sheet.getColumn(5).width = 24;

  const notes = workbook.addWorksheet('Read Me');
  notes.columns = [{ width: 24 }, { width: 88 }];
  const noteRows = [
    ['EDUCORE — IMPORTANT', ''],
    ['Privacy', 'Keep this file private. It contains student login credentials.'],
    ['Passwords', 'Temporary passwords are shown only when accounts are generated. Existing passwords cannot be recovered later because EduCore does not store them in readable form.'],
    ['Sharing', 'Give each student only their own username and temporary password.'],
    ['Class', section.name || ''],
    ['Grade', section.grade_level ? `Grade ${section.grade_level}` : '']
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
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `EduCore-Student-Accounts-${safeFileName(section.name || 'Class')}-${excelTimestamp(generatedAt)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('A styled Excel file with the generated student accounts was downloaded.', 'success');
  } catch (error) {
    console.error(error);
    toast('Could not create the student account Excel file.', 'orange');
  }
}

$('#downloadAccountsExcelBtn')?.addEventListener('click', downloadGeneratedAccountsExcel);

// ---------- ADD STUDENTS ----------
const MAX_STUDENTS_PER_ADD = 60;
const STUDENT_CREATE_BATCH_SIZE = 30;

function studentImportCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeImportedGender(value) {
  const text = studentImportCell(value).toLowerCase().replace(/\./g, '');
  if (['m', 'male', 'boy'].includes(text)) return 'Male';
  if (['f', 'female', 'girl'].includes(text)) return 'Female';
  if (text.includes('prefer not')) return 'Prefer not to say';
  return '';
}

function normalizeStudentNameKey(value) {
  return studentImportCell(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looksLikeLrn(value) {
  return /^\d{12}$/.test(studentImportCell(value).replace(/[^0-9]/g, ''));
}

function looksLikeStudentName(value) {
  const text = studentImportCell(value);
  if (text.length < 3 || !/[A-Za-zÀ-ÿÑñ]/.test(text)) return false;
  if (/^(name|student|learner|lrn|sex|gender|birth|age|address|father|mother|guardian|remarks|total)/i.test(text)) return false;
  return true;
}

function findStudentHeader(rows) {
  const limit = Math.min(rows.length, 90);
  for (let r = 0; r < limit; r += 1) {
    const cells = (rows[r] || []).map(studentImportCell);
    const normalized = cells.map(value => value.toLowerCase().replace(/\s+/g, ' ').trim());
    const lrnCol = normalized.findIndex(value => /^lrn\b/.test(value));
    const nameCol = normalized.findIndex(value => /^name\b/.test(value) || /^(student|learner)\s+name\b/.test(value) || /^full\s+name\b/.test(value));
    const sexCol = normalized.findIndex(value => /^sex\b/.test(value) || /^gender\b/.test(value));
    if (nameCol >= 0 && (lrnCol >= 0 || sexCol >= 0)) {
      return { row: r, lrnCol, nameCol, sexCol };
    }
  }
  return null;
}

function extractStudentRecordsFromRows(sourceRows) {
  const rows = (sourceRows || []).map(row => Array.isArray(row) ? row : []);
  const sampleText = rows.slice(0, 90).flat().map(studentImportCell).join(' ').toUpperCase();
  const header = findStudentHeader(rows);
  const isSf1 = sampleText.includes('SCHOOL FORM 1') || sampleText.includes('SCHOOL REGISTER') || Boolean(header?.lrnCol >= 0 && sampleText.includes('LRN'));
  const records = [];

  if (isSf1) {
    let groupGender = 'Male';
    const firstDataRow = header ? header.row + 1 : 0;
    for (let r = firstDataRow; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const rowCells = row.map(studentImportCell);
      const rowText = rowCells.join(' ').toUpperCase();
      if (rowText.includes('TOTAL MALE')) {
        groupGender = 'Female';
        continue;
      }
      if (rowText.includes('TOTAL FEMALE') || rowText.includes('COMBINED')) break;

      let lrnCol = header?.lrnCol ?? -1;
      if (lrnCol < 0 || !looksLikeLrn(rowCells[lrnCol])) {
        lrnCol = rowCells.findIndex(looksLikeLrn);
      }
      if (lrnCol < 0) continue;

      let name = header?.nameCol >= 0 ? studentImportCell(rowCells[header.nameCol]) : '';
      if (!looksLikeStudentName(name)) {
        for (let c = lrnCol + 1; c < Math.min(rowCells.length, lrnCol + 6); c += 1) {
          if (looksLikeStudentName(rowCells[c])) {
            name = studentImportCell(rowCells[c]);
            break;
          }
        }
      }
      if (!looksLikeStudentName(name)) continue;

      let gender = header?.sexCol >= 0 ? normalizeImportedGender(rowCells[header.sexCol]) : '';
      if (!gender) {
        gender = rowCells.map(normalizeImportedGender).find(Boolean) || groupGender || 'Not specified';
      }
      records.push({ name, gender, lrn: studentImportCell(rowCells[lrnCol]).replace(/[^0-9]/g, '') });
    }
    if (records.length) return { records, format: 'DepEd SF1' };
  }

  if (header?.nameCol >= 0) {
    for (let r = header.row + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const name = studentImportCell(row[header.nameCol]);
      if (!looksLikeStudentName(name)) continue;
      const gender = header.sexCol >= 0 ? normalizeImportedGender(row[header.sexCol]) : '';
      records.push({ name, gender: gender || 'Not specified' });
    }
    if (records.length) return { records, format: 'Excel list' };
  }

  return { records: [], format: 'Unknown' };
}

function parseStudentWorkbook(workbook) {
  let best = { records: [], format: 'Unknown', sheetName: '' };
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const parsed = extractStudentRecordsFromRows(rows);
    if (parsed.records.length > best.records.length) best = { ...parsed, sheetName };
  }
  return best;
}

function updateStudentEntryCount() {
  const count = $('#studentEntryBody')?.children.length || 0;
  if ($('#studentEntryCount')) $('#studentEntryCount').textContent = `${count} / ${MAX_STUDENTS_PER_ADD}`;
  if ($('#addStudentRowBtn')) $('#addStudentRowBtn').disabled = count >= MAX_STUDENTS_PER_ADD;
}

function currentStudentEntryRows() {
  return [...($('#studentEntryBody')?.querySelectorAll('tr') || [])].map(row => ({
    name: row.querySelector('.student-name-input')?.value.trim() || '',
    gender: row.querySelector('.student-gender-input')?.value || 'Not specified'
  })).filter(student => student.name);
}

function openStudentModal(sectionId) {
  activeSectionId = sectionId;
  const section = sectionById(sectionId);
  if (!section) return;
  $('#studentModalTitle').textContent = sectionLabel(section);
  $('#studentEntryBody').innerHTML = '';
  addStudentEntryRow({}, true);
  addStudentEntryRow({}, true);
  addStudentEntryRow({}, true);
  $('#studentImportStatus').textContent = 'You can review imported learners before generating accounts.';
  if ($('#studentsFileInput')) $('#studentsFileInput').value = '';
  updateStudentEntryCount();
  openDialog('studentModal');
}

function addStudentEntryRow(student = {}, silent = false) {
  const body = $('#studentEntryBody');
  if (!body) return false;
  if (body.children.length >= MAX_STUDENTS_PER_ADD) {
    if (!silent) toast(`You can add up to ${MAX_STUDENTS_PER_ADD} students at a time.`, 'orange');
    updateStudentEntryCount();
    return false;
  }
  const row = document.createElement('tr');
  const index = body.children.length + 1;
  const gender = ['Female', 'Male', 'Prefer not to say', 'Not specified'].includes(student.gender) ? student.gender : 'Not specified';
  row.innerHTML = `<td>${index}</td><td><input class="student-name-input" placeholder="Student full name" value="${esc(student.name || '')}"></td><td><select class="student-gender-input"><option value="Female">Female</option><option value="Male">Male</option><option value="Prefer not to say">Prefer not to say</option><option value="Not specified">Not specified</option></select></td><td><button class="table-remove" type="button">Remove</button></td>`;
  body.append(row);
  row.querySelector('.student-gender-input').value = gender;
  row.querySelector('.table-remove').addEventListener('click', () => {
    row.remove();
    [...body.children].forEach((r,i) => r.children[0].textContent = i+1);
    updateStudentEntryCount();
  });
  updateStudentEntryCount();
  return true;
}

function fillStudentEntryRows(imported, formatName) {
  const body = $('#studentEntryBody');
  const existingManual = currentStudentEntryRows();
  const currentClassNames = new Set(studentsForSection(activeSectionId).map(student => normalizeStudentNameKey(student.display_name)));
  const seen = new Set();
  const combined = [];
  let duplicateCount = 0;

  for (const student of [...existingManual, ...imported]) {
    const key = normalizeStudentNameKey(student.name);
    if (!key) continue;
    if (seen.has(key) || currentClassNames.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    combined.push({ name: student.name, gender: student.gender || 'Not specified' });
  }

  const importGenderOrder = { Male: 0, Female: 1, 'Prefer not to say': 2, 'Not specified': 3 };
  combined.sort((a, b) => {
    const byGender = (importGenderOrder[a.gender] ?? 9) - (importGenderOrder[b.gender] ?? 9);
    if (byGender) return byGender;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });

  const limited = combined.slice(0, MAX_STUDENTS_PER_ADD);
  const trimmedCount = Math.max(0, combined.length - limited.length);
  body.innerHTML = '';
  limited.forEach(student => addStudentEntryRow(student, true));
  if (!limited.length) addStudentEntryRow({}, true);
  updateStudentEntryCount();

  const notes = [`Loaded ${limited.length} learner${limited.length === 1 ? '' : 's'} from ${formatName}.`];
  if (duplicateCount) notes.push(`${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} skipped.`);
  if (trimmedCount) notes.push(`${trimmedCount} learner${trimmedCount === 1 ? '' : 's'} skipped because the limit is ${MAX_STUDENTS_PER_ADD}.`);
  if (formatName === 'DepEd SF1') notes.push('LRNs are used only to identify SF1 learner rows; EduCore does not store the LRN.');
  $('#studentImportStatus').textContent = notes.join(' ');
}

$('#addStudentRowBtn').addEventListener('click', () => addStudentEntryRow());
$('#importStudentsFileBtn')?.addEventListener('click', () => $('#studentsFileInput')?.click());
$('#studentsFileInput')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!window.XLSX) {
    toast('Excel reader could not load. Check your internet connection and try again.', 'orange');
    event.target.value = '';
    return;
  }
  try {
    $('#studentImportStatus').textContent = `Reading ${file.name}…`;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: false });
    const parsed = parseStudentWorkbook(workbook);
    if (!parsed.records.length) {
      throw new Error('No learner rows were detected. For a regular Excel file, use a Name column and a Sex or Gender column.');
    }
    fillStudentEntryRows(parsed.records, parsed.format);
    toast(`${parsed.records.length} learner row${parsed.records.length === 1 ? '' : 's'} detected from ${parsed.format}. Review the list before generating accounts.`, 'success');
  } catch (error) {
    console.error('STUDENT IMPORT ERROR', error);
    $('#studentImportStatus').textContent = error.message || 'Could not read this student list.';
    toast(friendlyErrorMessage(error, 'Could not import the student list.'), 'orange');
  } finally {
    event.target.value = '';
  }
});

$('#saveStudentsBtn').addEventListener('click', async () => {
  if (!requireSupabase() || !activeSectionId) return;
  const students = currentStudentEntryRows();
  if (!students.length) return toast('Enter at least one student name.', 'orange');
  if (students.length > MAX_STUDENTS_PER_ADD) return toast(`You can generate up to ${MAX_STUDENTS_PER_ADD} student accounts at a time.`, 'orange');
  const submitBtn = $('#saveStudentsBtn');
  if (!startActionButton(submitBtn, 'Creating accounts…')) return;

  try {
    let result = { created: [], failures: [], section: null };
    await withLoading('Creating student accounts…', `Generating ${students.length} secure student account${students.length === 1 ? '' : 's'}.`, async () => {
      for (let start = 0; start < students.length; start += STUDENT_CREATE_BATCH_SIZE) {
        const batch = students.slice(start, start + STUDENT_CREATE_BATCH_SIZE);
        try {
          const partial = await invokeTeacherFunction('create-students', {
            section_id: activeSectionId,
            students: batch
          });
          result.created.push(...(partial?.created || []));
          result.failures.push(...(partial?.failures || []));
          if (!result.section && partial?.section) result.section = partial.section;
        } catch (batchError) {
          batch.forEach(student => result.failures.push({
            name: student.name,
            error: batchError.message || 'Account creation failed.'
          }));
        }
      }
      await refreshTeacher();
    });

    const created = result.created || [];
    const failures = result.failures || [];
    if (created.length) {
      lastGeneratedAccounts = created.map(item => ({ ...item }));
      lastGeneratedSection = result.section || sectionById(activeSectionId) || null;
    }
    $('#generatedAccountsBody').innerHTML = created.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.gender)}</td><td><b>${esc(s.username)}</b></td><td><b>${esc(s.temporary_password)}</b></td></tr>`).join('');
    if (created.length) {
      await finishActionButton(submitBtn, 'Done');
      closeDialog('studentModal');
      openDialog('accountsModal');
    } else {
      resetActionButton(submitBtn);
    }
    if (failures.length) {
      const details = failures.map(f => `${f.name || 'Student'}: ${f.error || 'Account creation failed.'}`).join('\n');
      toast(`${failures.length} account${failures.length === 1 ? '' : 's'} could not be created.\n\n${details}`, 'orange');
    }
    if (created.length) toast(`${created.length} student account${created.length === 1 ? '' : 's'} created.`, 'success');
  } catch (error) {
    resetActionButton(submitBtn);
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not create student accounts. Please try again.'), 'orange');
  }
});

// ---------- ASSIGNMENTS ----------
function questionBlock(number) {
  return `<article class="question-block" data-question-block>
    <div class="question-top"><strong>Question ${number}</strong><button type="button" class="question-remove">Remove</button></div>
    <label>Question<input class="q-text" placeholder="Type the question here"></label>
    <div class="question-type-row"><label>Type<select class="q-type"><option value="short">Short answer</option><option value="mcq">Multiple choice</option></select></label><label>Correct answer <small class="field-optional">Optional</small><input class="q-answer" placeholder="Add now or later for auto-checking"></label><label>Points<input class="q-points" type="number" min="0" step="0.25" value="1"></label></div>
    <div class="option-list" hidden>
      <div class="option-row"><input class="q-option" placeholder="Option A"><span></span></div>
      <div class="option-row"><input class="q-option" placeholder="Option B"><span></span></div>
      <div class="option-row"><input class="q-option" placeholder="Option C"><span></span></div>
      <div class="option-row"><input class="q-option" placeholder="Option D"><span></span></div>
    </div>
  </article>`;
}

function populateAssignmentSections() {
  const list = $('#assignmentSectionChecklist');
  if (!list) return;
  if (!state.sections.length) {
    list.innerHTML = '<p class="class-checklist-empty">Create a class first.</p>';
    return;
  }
  list.innerHTML = state.sections.map((section, index) => `
    <label class="class-check-option">
      <input type="checkbox" name="assignment_sections" value="${section.id}" ${state.sections.length === 1 && index === 0 ? 'checked' : ''}>
      <span><b>${esc(section.name)}</b><small>Grade ${esc(section.grade_level)}</small></span>
    </label>`).join('');
}

function selectedAssignmentSectionIds() {
  return $$('input[name="assignment_sections"]:checked', $('#assignmentSectionChecklist')).map(input => input.value);
}

function normalizeExcelText(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function applyExcelClassSelection(rawClasses) {
  if (editingAssignmentId) return 1;
  if (!rawClasses) return 0;
  const wanted = String(rawClasses).split(/[;|\n]+/).map(normalizeExcelText).filter(Boolean);
  if (!wanted.length) return 0;
  let matched = 0;
  $$('input[name="assignment_sections"]', $('#assignmentSectionChecklist')).forEach(input => {
    const section = sectionById(input.value);
    const candidates = [
      section?.name,
      sectionLabel(section),
      `grade ${section?.grade_level} ${section?.name}`,
      `${section?.name} grade ${section?.grade_level}`
    ].map(normalizeExcelText);
    input.checked = wanted.some(token => candidates.includes(token));
    if (input.checked) matched += 1;
  });
  return matched;
}

function importQuestionsFromRows(rows) {
  const valid = rows.filter(row => String(row.question || '').trim());
  $('#questionBuilder').innerHTML = '';
  questionCount = 0;
  if (!valid.length) {
    addQuestion();
    return 0;
  }
  valid.forEach(row => {
    addQuestion();
    const block = $$('[data-question-block]', $('#questionBuilder')).at(-1);
    const typeText = normalizeExcelText(row.type || row.question_type || 'short');
    const type = typeText.includes('multiple') || typeText === 'mcq' ? 'mcq' : 'short';
    block.querySelector('.q-text').value = String(row.question || '').trim();
    block.querySelector('.q-type').value = type;
    block.querySelector('.q-answer').value = String(row.correct_answer || row.answer || '').trim();
    block.querySelector('.q-points').value = Number(row.points || 1) || 1;
    const options = [row.option_a, row.option_b, row.option_c, row.option_d].map(v => String(v || '').trim());
    [...block.querySelectorAll('.q-option')].forEach((input, index) => { input.value = options[index] || ''; });
    block.querySelector('.option-list').hidden = type !== 'mcq';
  });
  return valid.length;
}

async function importAssignmentExcel(file) {
  if (!window.XLSX) throw new Error('Excel reader could not load. Check your internet connection and try again.');
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const assignmentSheet = workbook.Sheets.Assignment || workbook.Sheets[workbook.SheetNames[0]];
  if (!assignmentSheet) throw new Error('The workbook does not contain an Assignment sheet.');
  const assignmentRows = XLSX.utils.sheet_to_json(assignmentSheet, { header: 1, defval: '' });
  const fields = {};
  assignmentRows.slice(1).forEach(row => {
    const key = normalizeExcelText(row[0]).replace(/ /g, '_');
    if (key) fields[key] = row[1];
  });
  const form = $('#assignmentForm');
  if (fields.title) form.elements.title.value = String(fields.title);
  if (fields.instructions) form.elements.instructions.value = String(fields.instructions);
  if (fields.deadline || fields.due_at || fields.due) {
    const rawDeadline = fields.deadline || fields.due_at || fields.due;
    const parsed = new Date(rawDeadline);
    if (!Number.isNaN(parsed.getTime())) {
      const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0,16);
      if (form.elements.due_at) form.elements.due_at.value = local;
    }
  }
  const matchedClasses = applyExcelClassSelection(fields.classes || fields.class || fields.sections);

  const questionSheet = workbook.Sheets.Questions || workbook.Sheets[workbook.SheetNames.find(name => normalizeExcelText(name) === 'questions')];
  let questionCountImported = 0;
  if (questionSheet) {
    const rawRows = XLSX.utils.sheet_to_json(questionSheet, { defval: '' });
    const normalized = rawRows.map(row => {
      const result = {};
      Object.entries(row).forEach(([key, value]) => {
        const normalizedKey = normalizeExcelText(key).replace(/ /g, '_');
        result[normalizedKey] = value;
      });
      return result;
    });
    questionCountImported = importQuestionsFromRows(normalized);
  }
  return { questionCountImported, matchedClasses };
}

function resetAssignmentForm() {
  $('#assignmentForm').reset();
  populateAssignmentSections();
  if ($('#assignmentPublishMode')) $('#assignmentPublishMode').value = 'now';
  if ($('#assignmentPublishAtWrap')) $('#assignmentPublishAtWrap').hidden = true;
  if ($('#assignmentPublishAt')) $('#assignmentPublishAt').value = '';
  $('#assignmentImagePreview').hidden = true;
  $('#assignmentImagePreview').removeAttribute('src');
  $('#questionBuilder').innerHTML = '';
  questionCount = 0;
  addQuestion();
}

function addQuestion() {
  questionCount += 1;
  $('#questionBuilder').insertAdjacentHTML('beforeend', questionBlock(questionCount));
}

$('#addQuestionBtn').addEventListener('click', addQuestion);
$('#questionBuilder').addEventListener('change', event => {
  if (!event.target.classList.contains('q-type')) return;
  const block = event.target.closest('[data-question-block]');
  block.querySelector('.option-list').hidden = event.target.value !== 'mcq';
});
$('#questionBuilder').addEventListener('click', event => {
  if (!event.target.classList.contains('question-remove')) return;
  const blocks = $$('[data-question-block]', $('#questionBuilder'));
  if (blocks.length === 1) return toast('Keep at least one question.', 'orange');
  event.target.closest('[data-question-block]').remove();
  $$('[data-question-block]', $('#questionBuilder')).forEach((b,i) => b.querySelector('.question-top strong').textContent = `Question ${i+1}`);
  questionCount = $$('[data-question-block]', $('#questionBuilder')).length;
});


function syncAssignmentPublishFields() {
  const mode = $('#assignmentPublishMode')?.value || 'now';
  const wrap = $('#assignmentPublishAtWrap');
  if (wrap) wrap.hidden = mode !== 'schedule';
}
$('#assignmentPublishMode')?.addEventListener('change', syncAssignmentPublishFields);

function formatDateTimeLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function loadAssignmentQuestions(assignmentId) {
  const questions = questionsFor(assignmentId).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  $('#questionBuilder').innerHTML = '';
  questionCount = 0;
  if (!questions.length) {
    addQuestion();
    return;
  }
  questions.forEach(question => {
    addQuestion();
    const block = $$('[data-question-block]', $('#questionBuilder')).at(-1);
    block.querySelector('.q-text').value = question.question_text || '';
    block.querySelector('.q-type').value = question.question_type || 'short';
    block.querySelector('.q-answer').value = keyFor(question.id)?.correct_answer || '';
    block.querySelector('.q-points').value = Number(question.max_points ?? 1);
    const options = Array.isArray(question.options) ? question.options : [];
    [...block.querySelectorAll('.q-option')].forEach((input, index) => { input.value = options[index] || ''; });
    block.querySelector('.option-list').hidden = question.question_type !== 'mcq';
  });
}

function setAssignmentEditorMode(assignment = null, assignmentGroup = []) {
  editingAssignmentId = assignment?.id || null;
  editingAssignmentIds = assignment ? (assignmentGroup.length ? assignmentGroup : [assignment]).map(item => item.id) : [];
  const isEditing = Boolean(assignment);
  const classCount = editingAssignmentIds.length;
  $('#assignmentModalEyebrow').textContent = isEditing ? 'EDIT CLASSWORK' : 'POST CLASSWORK';
  $('#assignmentModalTitle').textContent = isEditing ? 'Edit assignment' : 'Create assignment';
  $('#assignmentModalLead').textContent = isEditing
    ? (classCount > 1
      ? `Update this shared assignment once. Changes will be applied to all ${classCount} linked classes.`
      : 'Update the activity, deadline, questions, choices, points, or answer key.')
    : 'Build the activity, choose the classes, then review the questions before posting.';
  $('#assignmentSubmitBtn').textContent = isEditing ? 'Save changes' : 'Post assignment';
  $('#assignmentClassHint').textContent = isEditing
    ? (classCount > 1 ? `${classCount} linked classes` : 'Class is fixed while editing')
    : 'Select one or more';
}

function openAssignmentModal(assignmentId = null) {
  if (!state.sections.length) {
    toast('Create at least one class before posting an assignment.', 'orange');
    showTeacherView('classes');
    return;
  }
  resetAssignmentForm();
  const assignment = assignmentId ? assignmentById(assignmentId) : null;
  if (assignmentId && !assignment) return toast('This assignment is no longer available. Refresh and try again.', 'orange');
  const assignmentGroup = assignment ? assignmentDisplayGroupForId(assignment.id) : [];
  setAssignmentEditorMode(assignment, assignmentGroup);

  if (assignment) {
    const form = $('#assignmentForm');
    form.elements.title.value = assignment.title || '';
    form.elements.instructions.value = assignment.instructions || '';
    const isScheduled = assignment.status === 'draft' && assignment.publish_at && new Date(assignment.publish_at).getTime() > Date.now();
    form.elements.publish_mode.value = isScheduled ? 'schedule' : 'now';
    form.elements.publish_at.value = isScheduled ? formatDateTimeLocalInput(assignment.publish_at) : '';
    syncAssignmentPublishFields();
    form.elements.due_at.value = formatDateTimeLocalInput(assignment.due_at);
    form.elements.reminder_hours_before.value = String(Number(assignment.reminder_hours_before || 0));
    if (form.elements.allow_resubmission) form.elements.allow_resubmission.checked = Boolean(assignment.allow_resubmission);
    const groupSectionIds = new Set((assignmentGroup.length ? assignmentGroup : [assignment]).map(item => item.section_id));
    $$('input[name="assignment_sections"]', $('#assignmentSectionChecklist')).forEach(input => {
      input.checked = groupSectionIds.has(input.value);
      input.disabled = true;
      input.closest('.class-check-option')?.classList.toggle('editing-class-option', input.checked);
    });
    if (assignment.image_url) {
      $('#assignmentImagePreview').src = assignment.image_url;
      $('#assignmentImagePreview').hidden = false;
      $('#assignmentImagePreview').dataset.existingPath = assignment.image_path || '';
    }
    loadAssignmentQuestions(assignment.id);
  }
  openDialog('assignmentModal');
}

$('#postAssignmentBtn').addEventListener('click', () => openAssignmentModal());
$('#assignmentImage').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  $('#assignmentImagePreview').src = URL.createObjectURL(file);
  $('#assignmentImagePreview').hidden = false;
});

$('#importAssignmentExcelBtn')?.addEventListener('click', () => $('#assignmentExcelInput')?.click());
$('#assignmentExcelInput')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const result = await importAssignmentExcel(file);
    const classMessage = editingAssignmentId
      ? ' The linked classes remain unchanged while editing.'
      : result.matchedClasses
        ? ` ${result.matchedClasses} class${result.matchedClasses === 1 ? '' : 'es'} matched from the Classes field.`
        : ' Choose the destination class or classes below if none were matched.';
    toast(`Excel imported. ${result.questionCountImported} question${result.questionCountImported === 1 ? '' : 's'} loaded.${classMessage}`, 'success', 'Excel import complete');
  } catch (error) {
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not import the Excel assignment.'), 'orange', 'Excel import failed');
  } finally {
    event.target.value = '';
  }
});

function resolveMissingAnswerWarning(result) {
  if (!missingAnswerResolve) return;
  const resolve = missingAnswerResolve;
  missingAnswerResolve = null;
  closeDialog('missingAnswerModal');
  resolve(Boolean(result));
}

function confirmMissingAnswers(count, isEditing = false) {
  if (!count) return Promise.resolve(true);
  $('#missingAnswerText').textContent = `${count} question${count === 1 ? '' : 's'} ${count === 1 ? 'does' : 'do'} not have a correct answer yet. You can still ${isEditing ? 'save' : 'post'} the activity. Those questions will not be auto-checked until you edit the assignment and add their correct answers.`;
  $('#proceedPostAssignmentBtn').textContent = isEditing ? 'Proceed saving' : 'Proceed posting';
  openDialog('missingAnswerModal');
  return new Promise(resolve => { missingAnswerResolve = resolve; });
}

$('#continueEditingAssignmentBtn')?.addEventListener('click', () => resolveMissingAnswerWarning(false));
$('#proceedPostAssignmentBtn')?.addEventListener('click', () => resolveMissingAnswerWarning(true));
$('#missingAnswerCloseBtn')?.addEventListener('click', () => resolveMissingAnswerWarning(false));
$('#missingAnswerModal')?.addEventListener('cancel', event => {
  event.preventDefault();
  resolveMissingAnswerWarning(false);
});

async function saveQuestionsForAssignment(assignmentId, questions) {
  const existing = questionsFor(assignmentId).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const existingQuestion = existing[index];
    let questionId = existingQuestion?.id || null;
    const payload = {
      assignment_id: assignmentId,
      position: question.position,
      question_text: question.text,
      question_type: question.type,
      options: question.type === 'mcq' ? question.options : null,
      max_points: question.points
    };
    if (questionId) {
      const updateRes = await db.from('classside_questions').update(payload).eq('id', questionId);
      if (updateRes.error) throw updateRes.error;
    } else {
      const insertRes = await db.from('classside_questions').insert(payload).select('id').single();
      if (insertRes.error) throw insertRes.error;
      questionId = insertRes.data.id;
    }
    const keyRes = await db.from('classside_question_keys').upsert({
      question_id: questionId,
      correct_answer: question.correctAnswer || ''
    }, { onConflict: 'question_id' });
    if (keyRes.error) throw keyRes.error;
  }
  const extraIds = existing.slice(questions.length).map(question => question.id).filter(Boolean);
  if (extraIds.length) {
    const deleteRes = await db.from('classside_questions').delete().in('id', extraIds);
    if (deleteRes.error) throw deleteRes.error;
  }
}

async function updateExistingAssignment(assignment, form, questions, dueAt, reminderHours, publishStatus, publishAt) {
  const imageFile = $('#assignmentImage').files[0];
  let newImagePath = assignment.image_path || null;
  let uploadedNewPath = null;
  if (imageFile) {
    const preparedImage = await compressImageForUpload(imageFile, { maxDimension: 1800, targetBytes: 700 * 1024 });
    uploadedNewPath = `${state.user.id}/${assignment.id}/${Date.now()}-${safeFileName(preparedImage.name)}`;
    const uploadRes = await db.storage.from('classside-assignment-images').upload(uploadedNewPath, preparedImage, { upsert: false });
    if (uploadRes.error) throw uploadRes.error;
    newImagePath = uploadedNewPath;
  }

  try {
    const updateRes = await db.from('classside_assignments').update({
      title: String(form.get('title') || '').trim(),
      instructions: String(form.get('instructions') || '').trim(),
      due_at: dueAt,
      reminder_hours_before: dueAt ? reminderHours : 0,
      image_path: newImagePath,
      status: publishStatus,
      publish_at: publishAt,
      allow_resubmission: form.get('allow_resubmission') === 'on'
    }).eq('id', assignment.id);
    if (updateRes.error) throw updateRes.error;

    await saveQuestionsForAssignment(assignment.id, questions);

    if (uploadedNewPath && assignment.image_path && assignment.image_path !== uploadedNewPath) {
      try { await db.storage.from('classside-assignment-images').remove([assignment.image_path]); } catch (error) { console.warn('Old assignment image cleanup failed', error); }
    }
  } catch (error) {
    if (uploadedNewPath) {
      try { await db.storage.from('classside-assignment-images').remove([uploadedNewPath]); } catch {}
    }
    throw error;
  }
}

$('#assignmentForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireSupabase()) return;
  const form = new FormData(event.currentTarget);
  const sectionIds = selectedAssignmentSectionIds();
  if (!sectionIds.length) return toast('Select at least one class for this assignment.', 'orange', 'Choose a class');
  if (sectionIds.some(id => !sectionById(id))) return toast('One of the selected classes is no longer available. Refresh and try again.', 'orange');

  const blocks = $$('[data-question-block]', $('#questionBuilder'));
  const questions = blocks.map((block, index) => ({
    position: index + 1,
    text: block.querySelector('.q-text').value.trim(),
    type: block.querySelector('.q-type').value,
    correctAnswer: block.querySelector('.q-answer').value.trim(),
    points: Math.max(0, Number(block.querySelector('.q-points')?.value || 1)),
    options: [...block.querySelectorAll('.q-option')].map(input => input.value.trim()).filter(Boolean)
  })).filter(question => question.text);
  if (!questions.length) return toast('Add at least one question.', 'orange');
  if (questions.some(question => question.type === 'mcq' && question.options.length < 2)) return toast('Each multiple-choice question needs at least two options.', 'orange');

  const missingAnswerCount = questions.filter(question => !question.correctAnswer).length;
  if (missingAnswerCount) {
    const proceed = await confirmMissingAnswers(missingAnswerCount, Boolean(editingAssignmentId));
    if (!proceed) return;
  }

  const dueRaw = String(form.get('due_at') || '').trim();
  let dueAt = null;
  if (dueRaw) {
    const parsedDue = new Date(dueRaw);
    if (Number.isNaN(parsedDue.getTime())) return toast('Enter a valid assignment deadline.', 'orange', 'Check the deadline');
    dueAt = parsedDue.toISOString();
  }
  const reminderHours = Number(form.get('reminder_hours_before') || 0);
  const allowedReminderHours = new Set([0, 24, 48, 72]);
  if (!allowedReminderHours.has(reminderHours)) return toast('Choose a valid student reminder.', 'orange', 'Check the reminder');
  if (!dueAt && reminderHours > 0) return toast('Choose a deadline before turning on a student reminder.', 'orange', 'Deadline required');

  const publishMode = String(form.get('publish_mode') || 'now');
  let publishAt = null;
  let publishStatus = 'published';
  if (publishMode === 'schedule') {
    const rawPublishAt = String(form.get('publish_at') || '').trim();
    if (!rawPublishAt) return toast('Choose the date and time when EduCore should post this assignment.', 'orange', 'Posting time required');
    const parsedPublishAt = new Date(rawPublishAt);
    if (Number.isNaN(parsedPublishAt.getTime())) return toast('Enter a valid posting date and time.', 'orange', 'Check posting time');
    if (parsedPublishAt.getTime() <= Date.now() + 30000) return toast('Scheduled posting must be in the future.', 'orange', 'Choose a future time');
    publishAt = parsedPublishAt.toISOString();
    publishStatus = 'draft';
  }
  if (dueAt && publishAt && new Date(dueAt).getTime() <= new Date(publishAt).getTime()) {
    return toast('The assignment deadline must be after the scheduled posting time.', 'orange', 'Check the schedule');
  }

  const submitBtn = $('#assignmentSubmitBtn');
  if (!startActionButton(submitBtn, editingAssignmentId ? 'Updating…' : 'Posting…')) return;

  if (editingAssignmentId) {
    const assignmentsToUpdate = (editingAssignmentIds.length ? editingAssignmentIds : [editingAssignmentId])
      .map(id => assignmentById(id))
      .filter(Boolean);
    if (!assignmentsToUpdate.length) return toast('This assignment is no longer available. Refresh and try again.', 'orange');
    try {
      const copyCount = assignmentsToUpdate.length;
      await withLoading(
        copyCount > 1 ? `Saving in ${copyCount} classes…` : 'Saving assignment…',
        copyCount > 1
          ? 'Updating every linked class copy, including questions, answer keys, deadline, and image.'
          : 'Updating the activity, questions, answer keys, deadline, and image.',
        async () => {
          for (const assignment of assignmentsToUpdate) {
            await updateExistingAssignment(assignment, form, questions, dueAt, reminderHours, publishStatus, publishAt);
          }
          editingAssignmentId = null;
          editingAssignmentIds = [];
          await refreshTeacher();
          showTeacherView('assignments');
        }
      );
      await finishActionButton(submitBtn, 'Done');
      closeDialog('assignmentModal');
      toast(
        publishStatus === 'draft'
          ? `Assignment scheduled for ${formatDeadlineDate(publishAt)}${copyCount > 1 ? ` in ${copyCount} classes` : ''}.`
          : (copyCount > 1 ? `Assignment changes saved in ${copyCount} classes.` : 'Assignment changes saved.'),
        'success',
        publishStatus === 'draft' ? 'Assignment scheduled' : 'Assignment updated'
      );
    } catch (error) {
      resetActionButton(submitBtn);
      console.error(error);
      toast(friendlyErrorMessage(error, 'Could not save the assignment changes.'), 'orange', 'Save failed');
    }
    return;
  }

  const createdAssignments = [];
  const uploadedPaths = [];
  try {
    await withLoading(
      `Posting to ${sectionIds.length} class${sectionIds.length === 1 ? '' : 'es'}…`,
      'Creating the assignment, questions, answer keys, and image copies.',
      async () => {
        const imageFile = $('#assignmentImage').files[0];
        const preparedImageFile = imageFile
          ? await compressImageForUpload(imageFile, { maxDimension: 1800, targetBytes: 700 * 1024 })
          : null;
        for (const sectionId of sectionIds) {
          const { data, error } = await db.from('classside_assignments').insert({
            section_id: sectionId,
            teacher_id: state.user.id,
            title: String(form.get('title') || '').trim(),
            instructions: String(form.get('instructions') || '').trim(),
            due_at: dueAt,
            reminder_hours_before: dueAt ? reminderHours : 0,
            status: publishStatus,
            publish_at: publishAt,
            allow_resubmission: form.get('allow_resubmission') === 'on'
          }).select().single();
          if (error) throw error;
          const assignment = data;
          createdAssignments.push(assignment);

          if (preparedImageFile) {
            const uploadedPath = `${state.user.id}/${assignment.id}/${Date.now()}-${safeFileName(preparedImageFile.name)}`;
            const uploadRes = await db.storage.from('classside-assignment-images').upload(uploadedPath, preparedImageFile, { upsert: false });
            if (uploadRes.error) throw uploadRes.error;
            uploadedPaths.push(uploadedPath);
            const updateRes = await db.from('classside_assignments').update({ image_path: uploadedPath }).eq('id', assignment.id);
            if (updateRes.error) throw updateRes.error;
          }

          const questionPayload = questions.map(question => ({
            assignment_id: assignment.id,
            position: question.position,
            question_text: question.text,
            question_type: question.type,
            options: question.type === 'mcq' ? question.options : null,
            max_points: question.points
          }));
          const questionRes = await db.from('classside_questions').insert(questionPayload).select('id,position');
          if (questionRes.error) throw questionRes.error;
          const inserted = (questionRes.data || []).sort((a, b) => a.position - b.position);
          const keyPayload = inserted.map(row => ({
            question_id: row.id,
            correct_answer: questions.find(question => question.position === row.position)?.correctAnswer || ''
          }));
          const keyRes = await db.from('classside_question_keys').insert(keyPayload);
          if (keyRes.error) throw keyRes.error;
        }

        await refreshTeacher();
        showTeacherView('assignments');
      }
    );
    await finishActionButton(submitBtn, 'Done');
    closeDialog('assignmentModal');
    toast(
      publishStatus === 'draft'
        ? `Assignment scheduled for ${formatDeadlineDate(publishAt)}${sectionIds.length > 1 ? ` in ${sectionIds.length} classes` : ''}.`
        : (sectionIds.length === 1 ? 'Assignment posted successfully.' : `Assignment posted successfully to ${sectionIds.length} classes.`),
      'success',
      publishStatus === 'draft' ? 'Assignment scheduled' : 'Assignment posted'
    );
  } catch (error) {
    resetActionButton(submitBtn);
    console.error(error);
    if (uploadedPaths.length) { try { await db.storage.from('classside-assignment-images').remove(uploadedPaths); } catch {} }
    const createdIds = createdAssignments.map(assignment => assignment.id).filter(Boolean);
    if (createdIds.length) { try { await db.from('classside_assignments').delete().in('id', createdIds); } catch {} }
    toast(friendlyErrorMessage(error, 'Could not post the assignment.'), 'orange', 'Posting failed');
  }
});


function assignmentQuestionSignature(assignmentId) {
  return questionsFor(assignmentId)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map(question => ({
      position: Number(question.position || 0),
      text: String(question.question_text || '').trim(),
      type: String(question.question_type || 'short'),
      options: Array.isArray(question.options) ? question.options.map(option => String(option || '').trim()) : [],
      points: Number(question.max_points ?? 1),
      answer: String(keyFor(question.id)?.correct_answer || '').trim()
    }));
}

function assignmentDisplaySignature(assignment) {
  return JSON.stringify({
    title: String(assignment.title || '').trim(),
    instructions: String(assignment.instructions || '').trim(),
    dueAt: assignment.due_at || null,
    reminderHours: Number(assignment.reminder_hours_before || 0),
    status: assignment.status || 'published',
    publishAt: assignment.publish_at || null,
    questions: assignmentQuestionSignature(assignment.id)
  });
}

function groupedAssignmentsForDisplay() {
  const signatureBuckets = new Map();
  const orderedGroups = [];
  state.assignments.forEach(assignment => {
    const signature = assignmentDisplaySignature(assignment);
    if (!signatureBuckets.has(signature)) signatureBuckets.set(signature, []);
    const groups = signatureBuckets.get(signature);
    let group = groups.find(candidate => !candidate.some(item => item.section_id === assignment.section_id));
    if (!group) {
      group = [];
      groups.push(group);
      orderedGroups.push(group);
    }
    group.push(assignment);
  });
  return orderedGroups;
}

function assignmentDisplayGroupForId(assignmentId) {
  return groupedAssignmentsForDisplay().find(group => group.some(assignment => assignment.id === assignmentId)) || [];
}

function assignmentGroupSectionLabels(group) {
  return [...new Set(group.map(assignment => sectionLabel(sectionById(assignment.section_id))))].sort((a, b) => a.localeCompare(b));
}

function updateAssignmentBulkToolbar() {
  const validIds = state.assignments.map(assignment => assignment.id);
  [...selectedAssignmentIds].forEach(id => { if (!validIds.includes(id)) selectedAssignmentIds.delete(id); });
  // The Activities panel must only count/select question-based activities.
  // Performance Tasks have their own panel and controls.
  const groups = groupedAssignmentsForDisplay().filter(group => group.length && !isPerformanceTask(group[0]));
  const selectedGroups = groups.filter(group => group.every(assignment => selectedAssignmentIds.has(assignment.id)));
  const count = selectedGroups.length;
  const countEl = $('#selectedAssignmentCount');
  if (countEl) countEl.textContent = `${count} selected`;
  const deleteBtn = $('#bulkDeleteAssignmentsBtn');
  if (deleteBtn) deleteBtn.disabled = count === 0;
  const archiveBtn = $('#bulkArchiveAssignmentsBtn');
  if (archiveBtn) archiveBtn.disabled = count === 0;
  const selectAll = $('#selectAllAssignments');
  if (selectAll) {
    selectAll.checked = groups.length > 0 && count === groups.length;
    selectAll.indeterminate = count > 0 && count < groups.length;
  }
}

function renderAssignments() {
  const list = $('#assignmentList');
  if (!state.assignments.length) {
    selectedAssignmentIds.clear();
    list.innerHTML = `<div class="assignment-empty v9-empty"><span class="v9-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/></svg></span><b>No assignments yet</b><p>Create your first Classwork task to get started.<br>You can assign it to one or more classes.</p><button class="btn btn-orange" type="button" data-v9-new-assignment>＋ New assignment</button></div>`;
    return;
  }
  const groups = groupedAssignmentsForDisplay();
  const cards = groups.map(group => {
    const assignment = group[0];
    const groupIds = group.map(item => item.id);
    const groupIdsAttr = groupIds.join(',');
    const sectionLabels = assignmentGroupSectionLabels(group);
    const questions = questionsFor(assignment.id);
    const groupIdSet = new Set(groupIds);
    const submissions = state.submissions.filter(submission => groupIdSet.has(submission.assignment_id)).length;
    const missingAnswers = questions.filter(question => !(keyFor(question.id)?.correct_answer || '').trim()).length;
    const scheduled = assignment.status === 'draft' && assignment.publish_at && new Date(assignment.publish_at).getTime() > Date.now();
    const selected = group.every(item => selectedAssignmentIds.has(item.id));
    const classSummary = sectionLabels.length === 1
      ? `<span class="meta-chip">${esc(sectionLabels[0])}</span>`
      : `<span class="meta-chip assignment-group-count">${sectionLabels.length} classes</span>`;
    const classList = sectionLabels.length > 1
      ? `<div class="assignment-class-list" aria-label="Classes">${sectionLabels.map(label => `<span>${esc(label)}</span>`).join('')}</div>`
      : '';
    return `<article class="assignment-card assignment-group-card ${selected ? 'is-selected' : ''} ${scheduled ? 'assignment-scheduled' : ''}">
      <label class="assignment-select-check"><input class="row-check" type="checkbox" data-select-assignment="${assignment.id}" data-assignment-group-ids="${esc(groupIdsAttr)}" ${selected ? 'checked' : ''}><span class="sr-only">Select ${esc(assignment.title)}</span></label>
      <div class="assignment-thumb">${assignment.image_url ? `<img src="${esc(assignment.image_url)}" alt="Assignment image" data-assignment-storage-path="${esc(assignment.image_path || '')}">` : iconSvg('assignment', 'assignment-line-icon')}</div>
      <div class="assignment-card-body"><div class="assignment-title-line"><h3>${esc(assignment.title)}</h3>${group.length > 1 ? '<span class="shared-assignment-badge">Shared assignment</span>' : ''}${scheduled ? '<span class="scheduled-badge">Scheduled</span>' : ''}</div><p>${esc(assignment.instructions || 'Classwork assignment')}</p>${classList}<div class="assignment-meta">${classSummary}${scheduled ? `<span class="meta-chip scheduled-chip">Posts ${esc(formatDeadlineDate(assignment.publish_at))}</span>` : ''}${missingAnswers ? `<span class="meta-chip answer-key-warning">${missingAnswers} answer${missingAnswers===1?'':'s'} pending</span>` : ''}</div></div>
      <div class="assignment-card-actions"><button class="btn btn-light" data-preview-assignment="${assignment.id}">Preview</button><button class="btn btn-light" data-edit-assignment="${assignment.id}">Edit</button><button class="btn btn-danger-outline" data-delete-assignment-group="${esc(groupIdsAttr)}">Delete</button></div>
    </article>`;
  }).join('');
  list.innerHTML = `
    <div class="bulk-toolbar assignment-bulk-toolbar">
      <label class="bulk-select-all"><input id="selectAllAssignments" class="row-check" type="checkbox"><span>Select all activities</span></label>
      <span class="bulk-selected-count" id="selectedAssignmentCount">0 selected</span>
      <div class="bulk-actions"><button class="btn btn-danger" id="bulkDeleteAssignmentsBtn" type="button" disabled>Delete selected</button></div>
    </div>
    ${cards}`;
  updateAssignmentBulkToolbar();
}

document.addEventListener('change', event => {
  const check = event.target.closest('[data-select-assignment]');
  if (!check) return;
  const ids = String(check.dataset.assignmentGroupIds || check.dataset.selectAssignment || '').split(',').filter(Boolean);
  ids.forEach(id => {
    if (check.checked) selectedAssignmentIds.add(id);
    else selectedAssignmentIds.delete(id);
  });
  check.closest('.assignment-card')?.classList.toggle('is-selected', check.checked);
  updateAssignmentBulkToolbar();
});

document.addEventListener('change', event => {
  if (event.target.id !== 'selectAllAssignments') return;
  const checked = event.target.checked;
  // Only select the Activity groups currently rendered in this panel.
  $$('[data-select-assignment]', $('#assignmentList')).forEach(check => {
    const ids = String(check.dataset.assignmentGroupIds || check.dataset.selectAssignment || '').split(',').filter(Boolean);
    ids.forEach(id => {
      if (checked) selectedAssignmentIds.add(id);
      else selectedAssignmentIds.delete(id);
    });
    check.checked = checked;
    check.closest('.assignment-card')?.classList.toggle('is-selected', checked);
  });
  updateAssignmentBulkToolbar();
});

function openAssignmentPreview(assignmentId) {
  const assignment = assignmentById(assignmentId);
  if (!assignment) return;
  const group = assignmentDisplayGroupForId(assignment.id);
  const linked = group.length ? group : [assignment];
  const sectionLabels = assignmentGroupSectionLabels(linked);
  const questions = questionsFor(assignment.id).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const linkedIds = new Set(linked.map(item => item.id));
  const submissionCount = state.submissions.filter(submission => linkedIds.has(submission.assignment_id)).length;
  const scheduled = assignment.status === 'draft' && assignment.publish_at;

  $('#assignmentPreviewTitle').textContent = assignment.title || 'Assignment';
  $('#assignmentPreviewInstructions').textContent = assignment.instructions || 'No additional instructions were provided.';

  const detailItems = [
    ['Classes', sectionLabels.join(', ') || 'No class selected'],
    ['Posting', scheduled ? `Scheduled for ${formatDeadlineDate(assignment.publish_at)}` : 'Posted immediately'],
    ['Deadline', assignment.due_at ? formatDeadlineDate(assignment.due_at) : 'No deadline'],
    ['Student reminder', assignment.due_at ? reminderLabel(assignment.reminder_hours_before) : 'No reminder'],
    ['Questions', `${questions.length} question${questions.length === 1 ? '' : 's'}`],
    ['Submissions', `${submissionCount} submission${submissionCount === 1 ? '' : 's'}`],
    ['Total points', `${totalPoints(assignment.id)} points`]
  ];
  $('#assignmentPreviewDetails').innerHTML = detailItems.map(([label, value]) => `<article><span>${esc(label)}</span><b>${esc(value)}</b></article>`).join('');

  $('#assignmentPreviewQuestions').innerHTML = questions.length ? questions.map((question, index) => {
    const key = String(keyFor(question.id)?.correct_answer || '').trim();
    const options = Array.isArray(question.options) ? question.options.filter(Boolean) : [];
    return `<article class="assignment-preview-question-card">
      <div class="assignment-preview-question-head"><span>${index + 1}</span><div><h4 class="rich-content">${richMath(question.question_text || 'Untitled question')}</h4><small>${question.question_type === 'mcq' ? 'Multiple choice' : 'Short answer'} · ${Number(question.max_points || 0)} point${Number(question.max_points || 0) === 1 ? '' : 's'}</small></div></div>
      ${options.length ? `<div class="assignment-preview-options">${options.map((option, optionIndex) => `<span class="rich-content"><b>${String.fromCharCode(65 + optionIndex)}.</b> ${richMath(option)}</span>`).join('')}</div>` : ''}
      <div class="assignment-preview-answer ${key ? '' : 'missing'}"><span>Correct answer</span><b class="rich-content">${richMath(key || 'Not set yet')}</b></div>
    </article>`;
  }).join('') : '<div class="assignment-empty">No questions have been added yet.</div>';
  openDialog('assignmentPreviewModal');
}

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-preview-assignment]');
  if (!btn) return;
  openAssignmentPreview(btn.dataset.previewAssignment);
});

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-edit-assignment]');
  if (!btn) return;
  openAssignmentModal(btn.dataset.editAssignment);
});

function openAssignmentDeleteModal(ids) {
  const uniqueIds = [...new Set((ids || []).filter(id => assignmentById(id)))];
  if (!uniqueIds.length) return;
  pendingAssignmentDeleteIds = uniqueIds;
  pendingAssignmentDeleteId = uniqueIds.length === 1 ? uniqueIds[0] : null;

  const assignments = uniqueIds.map(id => assignmentById(id)).filter(Boolean);
  const allPerformance = assignments.length > 0 && assignments.every(isPerformanceTask);
  const kindSingular = allPerformance ? 'performance task' : 'activity';
  const kindPlural = allPerformance ? 'performance tasks' : 'activities';
  const deleteModal = $('#deleteAssignmentModal');
  const eyebrow = $('.eyebrow', deleteModal);
  const choiceTitle = $('.delete-choice h3', deleteModal);
  const choiceText = $('.delete-choice p', deleteModal);
  if (eyebrow) eyebrow.textContent = allPerformance ? 'DELETE PERFORMANCE TASK' : 'DELETE ACTIVITY';
  if (choiceTitle) choiceTitle.textContent = `Permanently delete this ${kindSingular}?`;
  if (choiceText) choiceText.textContent = allPerformance
    ? 'This removes the performance task, team setup, student submissions, participation ratings, and uploaded task/output files from Supabase Storage. This cannot be undone.'
    : 'This removes the activity, its questions and answer keys, student submissions, and uploaded assignment/proof files from Supabase Storage. This cannot be undone.';

  if (uniqueIds.length === 1) {
    const assignment = assignments[0];
    const section = sectionById(assignment.section_id);
    $('#deleteAssignmentTitle').textContent = assignment.title || (allPerformance ? 'Performance Task' : 'Activity');
    $('#deleteAssignmentClass').textContent = sectionLabel(section);
    $('#confirmDeleteAssignmentBtn').textContent = `Delete ${kindSingular} permanently`;
  } else {
    const first = assignments[0];
    const displayGroup = first ? assignmentDisplayGroupForId(first.id) : [];
    const isOneSharedAssignment = displayGroup.length === uniqueIds.length && displayGroup.every(item => uniqueIds.includes(item.id));
    if (isOneSharedAssignment) {
      const labels = assignmentGroupSectionLabels(displayGroup);
      $('#deleteAssignmentTitle').textContent = first?.title || (allPerformance ? 'Shared performance task' : 'Shared activity');
      $('#deleteAssignmentClass').textContent = `This shared ${kindSingular} will be deleted from: ${labels.join(', ')}.`;
      $('#confirmDeleteAssignmentBtn').textContent = `Delete from ${labels.length} classes`;
    } else {
      $('#deleteAssignmentTitle').textContent = `${uniqueIds.length} ${kindPlural} selected`;
      $('#deleteAssignmentClass').textContent = allPerformance
        ? 'The selected performance tasks may belong to different classes.'
        : 'The selected activities may belong to different classes.';
      $('#confirmDeleteAssignmentBtn').textContent = `Delete ${uniqueIds.length} ${kindPlural} permanently`;
    }
  }
  openDialog('deleteAssignmentModal');
}

document.addEventListener('click', event => {
  const groupBtn = event.target.closest('[data-delete-assignment-group]');
  if (groupBtn) {
    openAssignmentDeleteModal(String(groupBtn.dataset.deleteAssignmentGroup || '').split(',').filter(Boolean));
    return;
  }
  const btn = event.target.closest('[data-delete-assignment]');
  if (!btn) return;
  openAssignmentDeleteModal([btn.dataset.deleteAssignment]);
});

document.addEventListener('click', event => {
  if (event.target.closest('#bulkDeleteAssignmentsBtn')) {
    openAssignmentDeleteModal([...selectedAssignmentIds]);
  }
});

async function deleteAssignmentThroughFunction(assignmentId, accessToken) {
  const { data, error } = await db.functions.invoke('delete-assignment', {
    body: { assignment_id: assignmentId },
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}

$('#confirmDeleteAssignmentBtn')?.addEventListener('click', async () => {
  const ids = pendingAssignmentDeleteIds.filter(id => assignmentById(id));
  if (!ids.length) return;
  const assignments = ids.map(id => assignmentById(id)).filter(Boolean);
  const allPerformance = assignments.length > 0 && assignments.every(isPerformanceTask);
  const kindSingular = allPerformance ? 'performance task' : 'activity';
  const kindPlural = allPerformance ? 'performance tasks' : 'activities';
  const targetView = allPerformance ? 'performance' : 'assignments';
  const failures = [];
  closeDialog('deleteAssignmentModal');
  try {
    await withLoading(
      `Deleting ${ids.length === 1 ? kindSingular : `${ids.length} ${kindPlural}`}…`,
      allPerformance
        ? 'Removing the performance task, team setup, submissions, ratings, and related uploaded files.'
        : 'Removing the activity, submissions, and related Supabase Storage files.',
      async () => {
        const { data: sessionData, error: sessionError } = await db.auth.getSession();
        if (sessionError) throw sessionError;
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) throw new Error('Your teacher session has expired. Please sign in again.');
        for (const id of ids) {
          const assignment = assignmentById(id);
          try {
            await deleteAssignmentThroughFunction(id, accessToken);
          } catch (error) {
            failures.push({ title: assignment?.title || (allPerformance ? 'Performance Task' : 'Activity'), error: error.message || 'Delete failed' });
          }
        }
        pendingAssignmentDeleteIds = [];
        pendingAssignmentDeleteId = null;
        selectedAssignmentIds.clear();
        await refreshTeacher();
        showTeacherView(targetView);
      }
    );
    const successCount = ids.length - failures.length;
    if (successCount) {
      const successMessage = allPerformance
        ? `${successCount} performance task${successCount === 1 ? ' was' : 's were'} deleted with related uploaded files.`
        : `${successCount} activit${successCount === 1 ? 'y was' : 'ies were'} deleted with related uploaded files.`;
      toast(successMessage, 'success', allPerformance ? 'Performance task deleted' : 'Activity deleted');
    }
    if (failures.length) {
      const failedLabel = allPerformance
        ? `${failures.length} performance task${failures.length === 1 ? '' : 's'}`
        : `${failures.length} activit${failures.length === 1 ? 'y' : 'ies'}`;
      toast(`${failedLabel} could not be deleted.\n\n${failures.map(item => `${item.title}: ${item.error}`).join('\n')}`, 'orange', 'Some deletes failed');
    }
  } catch (error) {
    console.error(error);
    toast(
      friendlyErrorMessage(error, allPerformance ? 'Could not delete the selected performance task. Please try again.' : 'Could not delete the selected activities. Please try again.'),
      'orange',
      'Delete failed'
    );
  }
});

// ---------- STUDENT WORKSPACE NAV ----------
function showStudentPanel(panel = 'overview') {
  const allowed = new Set(['overview', 'activities', 'grades', 'todo', 'calendar', 'feedback', 'account']);
  activeStudentPanel = allowed.has(panel) ? panel : 'overview';
  $$('[data-student-panel-view]').forEach(view => {
    const active = view.dataset.studentPanelView === activeStudentPanel;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });
  $$('[data-student-panel]').forEach(btn => btn.classList.toggle('active', btn.dataset.studentPanel === activeStudentPanel));
  if (activeStudentPanel === 'activities') renderStudentAssignments();
  if (activeStudentPanel === 'grades') renderStudentGrades();
  if (activeStudentPanel === 'account') renderStudentAccount();
  window.EduCoreV10?.renderStudentPanel?.(activeStudentPanel);
  window.EduCoreStudent?.syncPanel();
}

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-student-panel]');
  if (!btn) return;
  showStudentPanel(btn.dataset.studentPanel);
});

// ---------- STUDENT DASHBOARD + ASSIGNMENTS ----------
function studentDisplayName() {
  return state.profile?.display_name || 'Student';
}

function studentInitials(name = studentDisplayName()) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ST';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}

function formatStudentDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }).format(date);
}

function studentAssignmentState(assignment) {
  const submission = submissionFor(assignment.id);
  if (submission) return 'submitted';
  if (assignment?.status === 'archived') return 'missed';
  const due = assignment?.due_at ? new Date(assignment.due_at) : null;
  if (due && Number.isFinite(due.getTime()) && due.getTime() < Date.now()) return 'missed';
  return 'ongoing';
}

function studentClassForDashboard() {
  const activeMember = (state.members || []).find(member => {
    const section = sectionById(member.section_id);
    return section && !section.archived_at;
  });
  if (activeMember) {
    const section = sectionById(activeMember.section_id);
    if (section) return section;
  }
  const member = state.members?.[0];
  if (member) {
    const section = sectionById(member.section_id);
    if (section) return section;
  }
  const firstAssignment = state.assignments?.[0];
  return firstAssignment ? sectionById(firstAssignment.section_id) : state.sections?.[0] || null;
}

function studentScorePercent() {
  const scores = state.submissions.map(submission => {
    const assignment = assignmentById(submission.assignment_id);
    if (!assignment) return null;
    const total = totalPoints(assignment.id);
    if (!total) return null;
    const score = submission.status === 'graded' && submission.teacher_score != null
      ? Number(submission.teacher_score)
      : Number(submission.auto_score || 0);
    return Math.max(0, Math.min(100, (score / total) * 100));
  }).filter(value => value != null && Number.isFinite(value));
  if (!scores.length) return null;
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

function renderStudentDashboard() {
  const assigned = state.assignments.length;
  const completed = state.assignments.filter(a => Boolean(submissionFor(a.id))).length;
  const todo = Math.max(0, assigned - completed);
  const completion = assigned ? Math.round((completed / assigned) * 100) : 0;
  const average = studentScorePercent();
  const profileName = studentDisplayName();
  const firstName = profileName.trim().split(/\s+/)[0] || 'Student';
  const studentClass = studentClassForDashboard();

  $('#studentWelcome').textContent = `Hi, ${profileName}`;
  $('#studentFirstName').textContent = firstName.toUpperCase();
  $('#studentInitials').textContent = studentInitials(profileName);
  $('#studentAssignedCount').textContent = assigned;
  $('#studentCompletedCount').textContent = completed;
  $('#studentTodoCount').textContent = todo;
  $('#studentAverageScore').textContent = average == null ? '—' : `${average}%`;
  $('#studentProgressValue').textContent = `${completion}% complete`;
  $('#studentProgressBar').style.width = `${completion}%`;
  $('#studentClassChip').textContent = studentClass?.name || 'My class';
  $('#studentGradeChip').textContent = `Grade ${studentClass?.grade_level || state.profile?.grade_level || '—'}`;

  if (!assigned) {
    $('#studentHeroCopy').textContent = 'Your class is ready. New Classwork tasks will appear here when your teacher posts them.';
    $('#studentProgressCopy').textContent = 'No assignments yet. Your progress will begin with your first posted task.';
  } else if (!todo) {
    $('#studentHeroCopy').textContent = 'You are caught up. Review your feedback and keep the momentum going.';
    $('#studentProgressCopy').textContent = `You have submitted all ${assigned} of your current tasks.`;
  } else {
    $('#studentHeroCopy').textContent = `${todo} task${todo === 1 ? '' : 's'} still waiting. Pick one and make a little progress today.`;
    $('#studentProgressCopy').textContent = `${completed} of ${assigned} task${assigned === 1 ? '' : 's'} submitted so far.`;
  }

  renderStudentNextUp();
  renderStudentRecentFeedback();
  renderStudentAssignments();
  renderStudentResponses();
  renderStudentGrades();
  renderStudentAccount();
  window.EduCoreDesign?.render();

  if ($('#v212HeroSubject')) $('#v212HeroSubject').textContent = currentSubject() || 'Your subject';
  if ($('#v212HeroClass')) $('#v212HeroClass').textContent = studentClassForDashboard()?.name || 'Your class';
  if ($('#v212HeroTodo')) {
    const remaining = state.assignments.filter(a => (a.work_type || 'written_work') === 'written_work' && studentAssignmentState(a) === 'ongoing').length
      + state.assignments.filter(a => (a.work_type || 'written_work') === 'performance_task' && !submissionFor(a.id)).length;
    $('#v212HeroTodo').textContent = `${remaining} to do`;
  }
}

function renderStudentNextUp() {
  const holder = $('#studentNextUp');
  const pending = state.assignments
    .filter(a => !submissionFor(a.id))
    .sort((a, b) => {
      const ad = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });

  if (!pending.length) {
    holder.innerHTML = `<div class="student-empty-insight"><b>You're caught up.</b><p>There is no unfinished assignment right now.</p><span class="student-done-mark">✓</span></div>`;
    return;
  }

  const assignment = pending[0];
  const section = sectionById(assignment.section_id);
  const qs = questionsFor(assignment.id);
  const due = formatDeadlineDate(assignment.due_at);
  const overdue = assignment.due_at && new Date(assignment.due_at).getTime() < Date.now();
  holder.innerHTML = `<div class="student-next-content">
    <h3>${esc(assignment.title)}</h3>
    <p>${esc(assignment.instructions || 'Open this task and work through it one question at a time.')}</p>
    <div class="student-next-meta"><span>${esc(sectionLabel(section))}</span><span>${qs.length} question${qs.length === 1 ? '' : 's'}</span>${due ? `<span class="${overdue ? 'is-overdue' : ''}">${overdue ? 'Past due' : 'Due'} ${esc(due)}</span>` : ''}</div>
    <button class="btn btn-orange" type="button" data-answer-assignment="${assignment.id}">Start this task</button>
  </div>`;
}

function renderStudentRecentFeedback() {
  const holder = $('#studentRecentFeedback');
  const latest = state.submissions.find(s => s.status === 'graded' || String(s.feedback || '').trim());
  if (!latest) {
    holder.innerHTML = `<div class="student-empty-insight"><b>Feedback will appear here.</b><p>Once your teacher reviews your work, their comments and score will be easy to find.</p></div>`;
    return;
  }
  const assignment = assignmentById(latest.assignment_id);
  const total = assignment ? totalPoints(assignment.id) : 0;
  const score = latest.status === 'graded' && latest.teacher_score != null ? Number(latest.teacher_score) : Number(latest.auto_score || 0);
  holder.innerHTML = `<div class="student-feedback-content">
    <div class="student-feedback-score"><b>${score}</b><span>/ ${total}</span></div>
    <div><h3>${esc(assignment?.title || 'Reviewed work')}</h3><p>${esc(latest.feedback || (latest.status === 'graded' ? 'Your teacher has reviewed this task.' : 'Your work has been submitted.'))}</p><small>${latest.status === 'graded' ? 'Teacher reviewed' : 'Latest submission'}</small></div>
  </div>`;
}

function studentTaskSortValue(assignment, mode) {
  if (mode === 'due') return assignment.due_at ? new Date(assignment.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  if (mode === 'oldest') return new Date(assignment.created_at || 0).getTime();
  if (mode === 'title') return String(assignment.title || '').toLowerCase();
  if (mode === 'status') {
    const order = { ongoing: 0, submitted: 1, missed: 2 };
    return order[studentAssignmentState(assignment)] ?? 9;
  }
  return -new Date(assignment.created_at || 0).getTime();
}

function renderStudentAssignments() {
  if (window.EduCoreStudent) return window.EduCoreStudent.renderActivities();
  const list = $('#studentAssignmentList');
  if (!list) return;
  if (!state.assignments.length) {
    $('#studentTaskSummary').textContent = 'No tasks yet. Your teacher’s assignments will appear here.';
    list.innerHTML = `<div class="assignment-empty student-empty-state"><b>No assignments yet.</b><span>When your teacher posts a Classwork task, it will show up here.</span></div>`;
    return;
  }

  const needle = studentTaskSearch.trim().toLowerCase();
  let filtered = state.assignments.filter(a => !isPerformanceTask(a)).filter(a => {
    const matchesStatus = studentTaskFilter === 'all' || studentAssignmentState(a) === studentTaskFilter;
    const matchesSearch = !needle || `${a.title || ''} ${a.instructions || ''} ${sectionLabel(sectionById(a.section_id))}`.toLowerCase().includes(needle);
    return matchesStatus && matchesSearch;
  });

  filtered = [...filtered].sort((a, b) => {
    const av = studentTaskSortValue(a, studentTaskSort);
    const bv = studentTaskSortValue(b, studentTaskSort);
    if (typeof av === 'string') return av.localeCompare(String(bv));
    return av - bv;
  });

  const labels = { ongoing: 'ongoing activities', submitted: 'submitted activities', missed: 'missed activities' };
  $('#studentTaskSummary').textContent = `${filtered.length} ${labels[studentTaskFilter] || 'tasks'} shown${needle ? ` for “${studentTaskSearch.trim()}”` : ''}.`;
  $$('.student-filter').forEach(btn => btn.classList.toggle('active', btn.dataset.studentFilter === studentTaskFilter));
  if ($('#studentTaskSort')) $('#studentTaskSort').value = studentTaskSort;
  if ($('#studentTaskSearch') && $('#studentTaskSearch').value !== studentTaskSearch) $('#studentTaskSearch').value = studentTaskSearch;

  if (!filtered.length) {
    list.innerHTML = `<div class="assignment-empty student-empty-state"><b>Nothing matches this view.</b><span>Change the filter, sorting, or search to find another activity.</span></div>`;
    return;
  }

  list.innerHTML = filtered.map(a => {
    const submitted = submissionFor(a.id);
    const qs = questionsFor(a.id);
    const section = sectionById(a.section_id);
    const total = totalPoints(a.id);
    const taskState = studentAssignmentState(a);
    const due = formatDeadlineDate(a.due_at);
    const overdue = !submitted && a.due_at && new Date(a.due_at).getTime() < Date.now();
    const lateSubmission = Boolean(submitted && a.due_at && submitted.submitted_at && new Date(submitted.submitted_at).getTime() > new Date(a.due_at).getTime());
    let status = overdue ? 'Missed' : 'Ongoing';
    let statusClass = overdue ? 'status-overdue' : 'status-todo';
    if (a.status === 'archived') {
      status = submitted ? 'Submitted · Archived' : 'Archived';
      statusClass = 'status-submitted';
    } else if (submitted) {
      status = lateSubmission ? 'Submitted Late' : 'Submitted';
      statusClass = lateSubmission ? 'status-late' : 'status-submitted';
      if (submitted.resubmit_allowed) {
        status = `${lateSubmission ? 'Submitted Late' : 'Submitted'} · New attempt allowed`;
        statusClass = 'status-todo';
      }
    }
    const canSubmit = a.status !== 'archived' && (!submitted || (Boolean(a.allow_resubmission) && Boolean(submitted?.resubmit_allowed)));
    const actionLabel = a.status === 'archived' ? 'Archived' : submitted ? (canSubmit ? 'Submit again' : 'Submitted') : overdue ? 'Submit late' : 'Open task';
    return `<article class="assignment-card student-task-card ${taskState}">
      <div class="assignment-thumb">${a.image_url ? `<img src="${esc(a.image_url)}" alt="Assignment image" data-assignment-storage-path="${esc(a.image_path || '')}">` : iconSvg('calculator', 'assignment-line-icon')}</div>
      <div class="student-task-body">
        <span class="student-card-section-name">${esc(section?.name || 'Class')}</span>
        <div class="student-task-title-row"><h3>${esc(a.title)}</h3><span class="student-status ${statusClass}">${esc(status)}</span></div>
        <p>${esc(a.instructions || 'Open the task and submit your answers.')}</p>
        <div class="assignment-meta">
          ${section?.grade_level ? `<span class="meta-chip">Grade ${esc(section.grade_level)}</span>` : ''}
          <span class="meta-chip">${qs.length} question${qs.length === 1 ? '' : 's'}</span>
          ${due ? `<span class="meta-chip deadline-chip ${(overdue || lateSubmission) ? 'meta-overdue' : ''}">${lateSubmission ? 'Submitted late · Deadline' : overdue ? 'Past due' : 'Deadline'} ${esc(due)}</span>` : `<span class="meta-chip deadline-chip no-deadline">No deadline</span>`}
          ${submitted?.attempt_count ? `<span class="meta-chip">Attempt ${Number(submitted.attempt_count)}</span>` : ''}
        </div>
        ${submitted?.feedback ? `<div class="student-inline-feedback"><b>Teacher feedback:</b> ${esc(submitted.feedback)}</div>` : ''}
      </div>
      <div class="student-task-actions">
        ${submitted ? `<button class="btn btn-light" type="button" data-preview-response="${submitted.id}">Preview response</button>` : ''}
        <button class="btn ${canSubmit ? 'btn-orange' : 'btn-light'}" data-answer-assignment="${a.id}" ${canSubmit ? '' : 'disabled'}>${actionLabel}</button>
      </div>
    </article>`;
  }).join('');
}

document.addEventListener('click', event => {
  const filter = event.target.closest('[data-student-filter]');
  if (!filter) return;
  studentTaskFilter = filter.dataset.studentFilter || 'all';
  renderStudentAssignments();
});

$('#studentTaskSort')?.addEventListener('change', event => {
  studentTaskSort = event.currentTarget.value || 'newest';
  renderStudentAssignments();
});

$('#studentTaskSearch')?.addEventListener('input', event => {
  studentTaskSearch = event.currentTarget.value || '';
  renderStudentAssignments();
});

function renderStudentResponses() {
  const list = $('#studentResponseList');
  if (!list) return;
  const submissions = [...state.submissions].sort((a, b) => new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime());
  $('#studentResponseCount').textContent = `${submissions.length} response${submissions.length === 1 ? '' : 's'}`;
  if (!submissions.length) {
    list.innerHTML = `<div class="assignment-empty student-empty-state"><b>No submitted work yet.</b><span>Your answers will appear here after you submit an activity.</span></div>`;
    return;
  }
  list.innerHTML = submissions.map(submission => {
    const assignment = assignmentById(submission.assignment_id);
    const total = assignment ? totalPoints(assignment.id) : 0;
    const score = submission.status === 'graded' && submission.teacher_score != null ? Number(submission.teacher_score) : Number(submission.auto_score || 0);
    return `<article class="student-response-card">
      <div class="student-response-icon">${submission.status === 'graded' ? '✓' : '↗'}</div>
      <div class="student-response-body"><div class="student-response-title"><h3>${esc(assignment?.title || 'Activity')}</h3><span class="student-status ${submission.status === 'graded' ? 'status-graded' : 'status-submitted'}">${submission.status === 'graded' ? 'Graded' : 'Submitted'}</span></div><p>${esc(sectionLabel(sectionById(assignment?.section_id)))}</p><div class="assignment-meta"><span class="meta-chip">Score ${score}/${total}</span><span class="meta-chip">Attempt ${Number(submission.attempt_count || 1)}</span><span class="meta-chip">${esc(formatStudentDate(submission.submitted_at) || 'Submitted')}</span></div></div>
      <button class="btn btn-orange" type="button" data-preview-response="${submission.id}">Preview response</button>
    </article>`;
  }).join('');
}

function renderStudentGrades() {
  if (window.EduCoreStudent) return window.EduCoreStudent.renderGrades();
  const list = $('#studentGradeList');
  if (!list) return;
  const graded = state.submissions.filter(s => s.status === 'graded').sort((a,b) => new Date(b.graded_at || b.updated_at || 0).getTime() - new Date(a.graded_at || a.updated_at || 0).getTime());
  $('#studentGradedCount').textContent = `${graded.length} graded`;
  if (!graded.length) {
    list.innerHTML = `<div class="assignment-empty student-empty-state"><b>No teacher-reviewed grades yet.</b><span>Submitted work will appear here after your teacher grades it.</span></div>`;
    return;
  }
  list.innerHTML = graded.map(submission => {
    const assignment = assignmentById(submission.assignment_id);
    const total = assignment ? totalPoints(assignment.id) : 0;
    const score = Number(submission.teacher_score ?? submission.auto_score ?? 0);
    const percent = total ? Math.round(score / total * 100) : 0;
    return `<article class="student-grade-card"><div class="student-grade-score"><b>${score}</b><span>/ ${total}</span><small>${percent}%</small></div><div class="student-grade-body"><h3>${esc(assignment?.title || 'Activity')}</h3><p>${esc(submission.feedback || 'Your teacher reviewed this activity.')}</p><div class="assignment-meta"><span class="meta-chip">${esc(sectionLabel(sectionById(assignment?.section_id)))}</span><span class="meta-chip">Attempt ${Number(submission.attempt_count || 1)}</span></div></div><button class="btn btn-light" type="button" data-preview-response="${submission.id}">View response</button></article>`;
  }).join('');
}

function renderStudentAccount() {
  if (!$('#studentAccountName')) return;
  const profile = state.profile || {};
  const studentClass = studentClassForDashboard();
  $('#studentAccountInitials').textContent = studentInitials(profile.display_name || 'Student');
  $('#studentAccountName').textContent = profile.display_name || 'Student';
  $('#studentAccountUsername').textContent = profile.username || '—';
  $('#studentAccountClass').textContent = studentClass?.name || 'Not assigned';
  if ($('#studentAccountSubject')) $('#studentAccountSubject').textContent = currentSubject() || '—';
  $('#studentAccountGrade').textContent = studentClass?.grade_level ? `Grade ${studentClass.grade_level}` : (profile.grade_level ? `Grade ${profile.grade_level}` : '—');
  $('#studentAccountGender').textContent = profile.gender || 'Not specified';
  window.EduCoreStudent?.renderIdentity();
}

async function openStudentResponsePreview(submissionId) {
  const submission = state.submissions.find(s => s.id === submissionId);
  if (!submission) return;
  const assignment = assignmentById(submission.assignment_id);
  if (!assignment) return;
  const qs = questionsFor(assignment.id);
  const answers = state.submissionAnswers.filter(a => a.submission_id === submission.id);
  const total = totalPoints(assignment.id);
  const shownScore = submission.status === 'graded' && submission.teacher_score != null ? Number(submission.teacher_score) : Number(submission.auto_score || 0);
  $('#studentResponseTitle').textContent = assignment.title;
  const responseWasLate = Boolean(assignment.due_at && submission.submitted_at && new Date(submission.submitted_at).getTime() > new Date(assignment.due_at).getTime());
  $('#studentResponseMeta').textContent = `${sectionLabel(sectionById(assignment.section_id))} · Submitted ${formatStudentDate(submission.submitted_at) || ''}${responseWasLate ? ' · LATE SUBMISSION' : ''} · Attempt ${Number(submission.attempt_count || 1)}`;
  $('#studentResponseScore').innerHTML = `<div><span>${submission.status === 'graded' ? 'Teacher score' : 'Auto-check score'}</span><b>${shownScore}<small>/ ${total}</small></b></div><span class="student-status ${submission.status === 'graded' ? 'status-graded' : 'status-submitted'}">${submission.status === 'graded' ? 'Graded' : 'Submitted'}</span>`;
  $('#studentResponseAnswers').innerHTML = qs.map((q, i) => {
    const answer = answers.find(a => a.question_id === q.id);
    const hasManual = answer?.manual_is_correct !== null && answer?.manual_is_correct !== undefined;
    const effectiveCorrect = hasManual ? Boolean(answer.manual_is_correct) : answer?.is_correct;
    const shownPoints = hasManual ? (effectiveCorrect ? Number(q.max_points || 0) : 0) : Number(answer?.awarded_points || 0);
    const resultText = effectiveCorrect === true ? 'Correct' : effectiveCorrect === false ? (hasManual ? 'Wrong' : 'Needs review') : 'Recorded';
    const pointLabel = hasManual ? 'Teacher points' : 'Auto points';
    const teacherComment = String(answer?.teacher_comment || '').trim();
    return `<article class="answer-question student-preview-answer ${effectiveCorrect === true ? 'correct' : effectiveCorrect === false ? 'needs-review' : ''}"><div class="student-preview-question-head"><h3>${i + 1}. ${richMath(q.question_text)}</h3><span>${esc(resultText)}</span></div><p><b>Your answer:</b> <span class="rich-content">${richStudentAnswer(answer?.answer_text || '')}</span></p><p><b>${pointLabel}:</b> ${shownPoints}/${Number(q.max_points || 0)}</p>${teacherComment ? `<p><b>Teacher comment:</b> ${esc(teacherComment)}</p>` : ''}</article>`;
  }).join('') || '<div class="assignment-empty">No answer details are available for this submission.</div>';
  const proofWrap = $('#studentResponseProofWrap');
  const proofPaths = submissionProofPaths(submission);
  const proofLinks = [];
  for (const path of proofPaths) {
    const url = await signedUrl('classside-submission-proofs', path, 1800);
    if (url) proofLinks.push(url);
  }
  const proofLinksBox = $('#studentResponseProofLinks');
  if (proofLinksBox) proofLinksBox.innerHTML = proofLinks.map((url, index) => `<a class="btn btn-light" href="${esc(url)}" target="_blank" rel="noopener">Open solution ${index + 1}</a>`).join('');
  if ($('#studentResponseProofLabel')) $('#studentResponseProofLabel').textContent = proofLinks.length > 1 ? 'MY WORK PICTURES' : 'MY WORK PICTURE';
  proofWrap.hidden = !proofLinks.length;
  const feedback = $('#studentResponseFeedback');
  if (submission.feedback) {
    feedback.innerHTML = `<p class="eyebrow">TEACHER FEEDBACK</p><p>${esc(submission.feedback)}</p>`;
    feedback.hidden = false;
  } else feedback.hidden = true;
  openDialog('studentResponseModal');
}

document.addEventListener('click', async event => {
  const btn = event.target.closest('[data-preview-response]');
  if (!btn) return;
  try {
    await withLoading('Opening your response…', 'Loading your submitted answers and uploaded work.', async () => {
      await openStudentResponsePreview(btn.dataset.previewResponse);
    });
  } catch (error) {
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not open your submitted response.'), 'orange');
  }
});

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-answer-assignment]');
  if (!btn || btn.disabled) return;
  const assignment = assignmentById(btn.dataset.answerAssignment);
  if (!assignment) return;
  activeStudentAssignment = assignment;
  $('#answerAssignmentTitle').textContent = assignment.title;
  $('#answerInstructions').textContent = assignment.instructions || '';
  if (assignment.image_url) {
    const taskImage = $('#studentAssignmentImage');
    taskImage.dataset.assignmentStoragePath = assignment.image_path || '';
    taskImage.dataset.retryingAssignmentImage = '';
    taskImage.src = assignment.image_url;
    taskImage.hidden = false;
  } else {
    $('#studentAssignmentImage').hidden = true;
  }
  $('#answerQuestions').innerHTML = questionsFor(assignment.id).map((q,i) => {
    if (q.question_type === 'mcq') {
      const options = Array.isArray(q.options) ? q.options : [];
      return `<article class="answer-question"><h3 class="rich-content">${i+1}. ${richMath(q.question_text)}</h3>${options.map(opt => `<label><input type="radio" name="answer_${q.id}" value="${esc(opt)}"> <span class="rich-content">${richMath(opt)}</span></label>`).join('')}</article>`;
    }
    return `<article class="answer-question"><h3>${i+1}. ${richText(q.question_text)}</h3><input type="text" name="answer_${q.id}" placeholder="Type your answer"></article>`;
  }).join('');
  $('#studentSolutionImage').value = '';
  openDialog('answerModal');
  window.EduCoreV10?.prepareAnswerDraft?.(assignment);
  // Draft restore is asynchronous; refresh twice so both a blank form and a
  // restored draft immediately show the formatted answer preview.
  refreshStudentAnswerPreviews();
  setTimeout(refreshStudentAnswerPreviews, 250);
});

document.addEventListener('input', event => {
  if (event.target?.matches?.('#answerQuestions input[name^="answer_"]')) {
    updateStudentAnswerPreview(event.target);
  }
});

$('#answerForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireSupabase() || !activeStudentAssignment || state.profile?.role !== 'student') return;
  if (isPerformanceTask(activeStudentAssignment)) return;
  const qs = questionsFor(activeStudentAssignment.id);
  const answers = qs.map(q => {
    const answer = q.question_type === 'mcq'
      ? ($(`input[name="answer_${q.id}"]:checked`)?.value || '')
      : ($(`[name="answer_${q.id}"]`)?.value || '');
    return { question_id: q.id, answer };
  });
  const proofFiles = [...($('#studentSolutionImage')?.files || [])];
  if (!proofFiles.length) return toast('Upload at least one clear photo of your written work before submitting.', 'orange');
  if (proofFiles.some(file => !String(file.type || '').startsWith('image/') && !isHeicImage(file))) return toast('Solution uploads must be image files.', 'orange');
  if (proofFiles.length > 10) return toast('Choose up to 10 work pictures for one submission.', 'orange');

  const previousProofPaths = submissionProofPaths(submissionFor(activeStudentAssignment.id));
  const uploadedPaths = [];
  const submitBtn = event.currentTarget.querySelector('button[type="submit"]');
  if (!startActionButton(submitBtn, 'Submitting…')) return;
  try {
    let rpcResult;
    await withLoading('Submitting your answers…', `Uploading ${proofFiles.length} work picture${proofFiles.length === 1 ? '' : 's'} and saving your answers.`, async () => {
      for (let index = 0; index < proofFiles.length; index += 1) {
        const proofFile = await compressImageForUpload(proofFiles[index], { maxDimension: 1600, targetBytes: 450 * 1024, hardLimitBytes: 500 * 1024, quality: 0.80, minQuality: 0.50, minLongEdge: 900 });
        const proofPath = `${state.user.id}/${activeStudentAssignment.id}/${Date.now()}-${index + 1}-${safeFileName(proofFile.name)}`;
        const uploadRes = await db.storage.from('classside-submission-proofs').upload(proofPath, proofFile, { upsert: false });
        if (uploadRes.error) throw uploadRes.error;
        uploadedPaths.push(proofPath);
      }
      const { data, error } = await db.rpc('classside_submit_work', {
        p_assignment_id: activeStudentAssignment.id,
        p_answers: answers,
        p_proof_paths: uploadedPaths
      });
      if (error) throw error;
      rpcResult = data;
      if (previousProofPaths.length) {
        try { await db.storage.from('classside-submission-proofs').remove(previousProofPaths); } catch {}
      }
      await window.EduCoreV10?.clearDraft?.(activeStudentAssignment.id);
      await refreshStudent();
    });
    await finishActionButton(submitBtn, 'Done');
    closeDialog('answerModal');
    toast(`Submitted! Auto-check score: ${Number(rpcResult?.auto_score || 0)}/${totalPoints(activeStudentAssignment.id)}.`, 'success');
  } catch (error) {
    resetActionButton(submitBtn);
    console.error(error);
    if (uploadedPaths.length) { try { await db.storage.from('classside-submission-proofs').remove(uploadedPaths); } catch {} }
    toast(friendlyErrorMessage(error, 'Could not submit your answers.'), 'orange');
  }
});

// ---------- SUBMISSIONS / GRADING ----------
function submissionSectionCounts() {
  const counts = new Map(state.sections.map(section => [section.id, 0]));
  state.submissions.forEach(submission => {
    const assignment = assignmentById(submission.assignment_id);
    if (assignment?.section_id) counts.set(assignment.section_id, (counts.get(assignment.section_id) || 0) + 1);
  });
  return counts;
}

function renderSubmissionSectionTabs() {
  const tabs = $('#submissionSectionTabs');
  if (!tabs) return;
  const counts = submissionSectionCounts();
  if (submissionSectionId !== 'all' && !sectionById(submissionSectionId)) submissionSectionId = 'all';
  tabs.innerHTML = `<button type="button" class="submission-section-tab ${submissionSectionId === 'all' ? 'active' : ''}" data-submission-section="all"><b>All</b><span>${state.submissions.length}</span></button>` +
    state.sections.map(section => `<button type="button" class="submission-section-tab ${submissionSectionId === section.id ? 'active' : ''}" data-submission-section="${section.id}"><b>${esc(section.name)}</b><small>Grade ${esc(section.grade_level)}</small><span>${counts.get(section.id) || 0}</span></button>`).join('');
}

function renderSubmissions() {
  const list = $('#submissionList');
  if (!list) return;
  renderSubmissionSectionTabs();
  const sortSelect = $('#submissionSort');
  if (sortSelect) sortSelect.value = submissionSort;
  let submissions = state.submissions.filter(submission => {
    if (submissionSectionId === 'all') return true;
    return assignmentById(submission.assignment_id)?.section_id === submissionSectionId;
  });
  submissions.sort((a, b) => {
    if (submissionSort === 'oldest') return new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0);
    if (submissionSort === 'name') return String(studentById(a.student_id)?.display_name || '').localeCompare(String(studentById(b.student_id)?.display_name || ''), undefined, { sensitivity: 'base' });
    if (submissionSort === 'gender') {
      const order = { Male: 0, Female: 1, 'Prefer not to say': 2, 'Not specified': 3 };
      const ga = String(studentById(a.student_id)?.gender || 'Not specified');
      const gb = String(studentById(b.student_id)?.gender || 'Not specified');
      const byGender = (order[ga] ?? 9) - (order[gb] ?? 9);
      return byGender || String(studentById(a.student_id)?.display_name || '').localeCompare(String(studentById(b.student_id)?.display_name || ''), undefined, { sensitivity: 'base' });
    }
    return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
  });
  const selectedSection = submissionSectionId === 'all' ? null : sectionById(submissionSectionId);
  if ($('#submissionSort')) $('#submissionSort').value = submissionSort;
  const uniqueStudents = new Set(submissions.map(submission => submission.student_id)).size;
  const summary = $('#submissionSectionSummary');
  if (summary) summary.innerHTML = `<span><b>${submissions.length}</b> submission${submissions.length === 1 ? '' : 's'}</span><span><b>${uniqueStudents}</b> learner${uniqueStudents === 1 ? '' : 's'}</span>${selectedSection ? `<span><b>${esc(selectedSection.name)}</b> · Grade ${esc(selectedSection.grade_level)}</span>` : '<span>All sections</span>'}`;
  if (!submissions.length) {
    list.innerHTML = `<div class="assignment-empty v9-empty"><span class="v9-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/></svg></span><b>${selectedSection ? `No submissions yet from ${esc(selectedSection.name)}.` : 'No student submissions yet'}</b><p>When students submit their work, you’ll be able to review<br>their solutions here.</p></div>`;
    return;
  }
  list.innerHTML = submissions.map(s => {
    const a = assignmentById(s.assignment_id);
    const student = studentById(s.student_id);
    const section = sectionById(a?.section_id);
    const total = a ? totalPoints(a.id) : 0;
    const shownScore = s.teacher_score ?? s.auto_score ?? 0;
    const genderClass = student?.gender === 'Male' ? 'submission-male' : student?.gender === 'Female' ? 'submission-female' : 'submission-other';
    return `<article class="submission-card ${genderClass}">
      <div class="submission-status-icon">${s.status === 'graded' ? iconSvg('check', 'assignment-line-icon') : iconSvg('inbox', 'assignment-line-icon')}</div>
      <div class="submission-card-body">
        <div class="submission-student-row"><button type="button" class="submission-student-name" data-track-student-from-submissions="${student?.id || ''}" data-track-section="${section?.id || ''}">${esc(student?.display_name || 'Student')}</button><span class="gender-pill">${esc(student?.gender || 'Not specified')}</span></div>
        <h3 class="submission-assignment-title">${esc(a?.title || 'Assignment')}</h3>
        <p class="submission-class-label">${esc(sectionLabel(section))}</p>
        <div class="submission-meta-grid"><span><small>Status</small><b>${esc(s.status)}</b></span><span><small>Score</small><b>${Number(shownScore || 0)}/${total}</b></span><span><small>Attempt</small><b>${Number(s.attempt_count || 1)}</b></span><span><small>Submitted</small><b>${esc(formatStudentDate(s.submitted_at) || '')}</b></span></div>
      </div>
      <button class="btn btn-orange submission-review-btn" data-review-submission="${s.id}">Review</button>
    </article>`;
  }).join('');
}

$('#submissionSectionTabs')?.addEventListener('click', event => {
  const btn = event.target.closest('[data-submission-section]');
  if (!btn) return;
  submissionSectionId = btn.dataset.submissionSection || 'all';
  renderSubmissions();
});
$('#submissionReviewTabs')?.addEventListener('click', event => {
  const btn = event.target.closest('[data-submission-review-filter]');
  if (!btn) return;
  submissionReviewFilter = btn.dataset.submissionReviewFilter || 'all';
  renderSubmissions();
});
$('#submissionGroupMode')?.addEventListener('change', event => {
  submissionGroupMode = event.currentTarget.value || 'section';
  renderSubmissions();
});
$('#submissionSort')?.addEventListener('change', event => {
  submissionSort = event.currentTarget.value || 'newest';
  renderSubmissions();
});
$('#submissionList')?.addEventListener('click', event => {
  const btn = event.target.closest('[data-track-student-from-submissions]');
  if (!btn || !btn.dataset.trackStudentFromSubmissions || !btn.dataset.trackSection) return;
  openStudentTrackingModal(btn.dataset.trackSection, btn.dataset.trackStudentFromSubmissions);
});

document.addEventListener('click', async event => {
  const btn = event.target.closest('[data-review-submission]');
  if (!btn) return;
  await openSubmissionReview(btn.dataset.reviewSubmission);
});

async function openSubmissionReview(submissionId) {
  const submission = state.submissions.find(s => s.id === submissionId);
  if (!submission) return;
  activeSubmissionId = submissionId;
  const assignment = assignmentById(submission.assignment_id);
  const student = studentById(submission.student_id);
  const qs = questionsFor(assignment.id);
  try {
    await withLoading('Opening submission…', 'Loading answers and uploaded work.', async () => {
      let answers = submissionAnswerCache.get(submissionId);
      if (!answers) {
        const answersRes = await db.from('classside_submission_answers').select('*').eq('submission_id', submissionId);
        if (answersRes.error) throw answersRes.error;
        answers = answersRes.data || [];
        submissionAnswerCache.set(submissionId, answers);
      }
      $('#reviewSubmissionTitle').textContent = assignment.title;
      $('#reviewSubmissionStudentName').textContent = student?.display_name || 'Student';
      const reviewTotal = totalPoints(assignment.id);
      const hasManualScore = submission.teacher_score != null;
      const hasManualAnswerReview = answers.some(answer => answer.manual_is_correct !== null && answer.manual_is_correct !== undefined);
      const reviewWasLate = Boolean(assignment.due_at && submission.submitted_at && new Date(submission.submitted_at).getTime() > new Date(assignment.due_at).getTime());
      const reviewTiming = ` · Submitted ${formatStudentDate(submission.submitted_at) || ''}${reviewWasLate ? ' · LATE SUBMISSION' : ''}`;
      $('#reviewSubmissionMeta').textContent = hasManualScore
        ? `${sectionLabel(sectionById(assignment.section_id))} · ${hasManualAnswerReview ? 'Manual-review score' : 'Teacher score'} ${Number(submission.teacher_score)}/${reviewTotal} · Auto-check ${Number(submission.auto_score || 0)}/${reviewTotal}${reviewTiming}`
        : `${sectionLabel(sectionById(assignment.section_id))} · Auto-check ${Number(submission.auto_score || 0)}/${reviewTotal} · No manual score yet${reviewTiming}`;
      $('#reviewSubmissionAnswers').innerHTML = qs.map((q,i) => {
        const answer = answers.find(a => a.question_id === q.id);
        const key = keyFor(q.id);
        const hasManual = answer?.manual_is_correct !== null && answer?.manual_is_correct !== undefined;
        const effectiveCorrect = hasManual ? Boolean(answer.manual_is_correct) : Boolean(answer?.is_correct);
        const autoCorrect = Boolean(answer?.is_correct);
        const autoPoints = Number(answer?.awarded_points || 0);
        const maxPoints = Number(q.max_points || 0);
        return `<article class="answer-question review-answer ${effectiveCorrect ? 'correct' : 'needs-review'}" data-review-question="${q.id}">
          <div class="review-answer-heading"><h3>${i+1}. ${richMath(q.question_text)}</h3><label class="manual-answer-check"><input type="checkbox" data-manual-correct data-question-id="${q.id}" data-max-points="${maxPoints}" data-auto-correct="${autoCorrect ? 'true' : 'false'}" data-manual-existing="${hasManual ? 'true' : 'false'}" ${effectiveCorrect ? 'checked' : ''}><span>Correct</span></label></div>
          <p><b>Student:</b> <span class="rich-content">${richStudentAnswer(answer?.answer_text || '')}</span></p>
          <p><b>Answer key:</b> <span class="rich-content">${richMath(key?.correct_answer || '—')}</span></p>
          <div class="review-answer-points"><span><b>Auto points:</b> ${autoPoints}/${maxPoints}</span><span class="manual-review-source" data-manual-status>${hasManual ? `Manual check: ${effectiveCorrect ? 'Correct' : 'Wrong'}` : `Auto-check: ${autoCorrect ? 'Correct' : 'Wrong'}`}</span></div>
          <label class="question-comment-field"><span>Question comment</span><textarea data-question-comment data-question-id="${q.id}" rows="3" placeholder="Write a short comment for this question">${esc(answer?.teacher_comment || '')}</textarea></label>
        </article>`;
      }).join('');
      const total = totalPoints(assignment.id);
      $('#teacherScoreInput').max = String(total);
      $('#teacherScoreInput').value = submission.teacher_score != null ? String(submission.teacher_score) : '';
      $('#teacherScoreInput').placeholder = `Auto-check fallback: ${Number(submission.auto_score || 0)}/${total}`;
      $('#teacherScoreInput').readOnly = hasManualAnswerReview;
      updateManualReviewSummary(hasManualAnswerReview);
      $('#teacherFeedbackInput').value = submission.feedback || '';
      const allowAgainBtn = $('#allowResubmissionBtn');
      if (allowAgainBtn) {
        const canTeacherAllow = Boolean(assignment.allow_resubmission);
        allowAgainBtn.hidden = !canTeacherAllow;
        allowAgainBtn.disabled = Boolean(submission.resubmit_allowed);
        allowAgainBtn.textContent = submission.resubmit_allowed ? 'Resubmission already allowed' : 'Allow student to submit again';
      }
      const feedbackPreset = $('#teacherFeedbackPreset');
      if (feedbackPreset) feedbackPreset.value = '';
      const proofWrap = $('#reviewProofWrap');
      const proofPaths = submissionProofPaths(submission);
      const proofLinks = [];
      for (const path of proofPaths) {
        const url = await signedUrl('classside-submission-proofs', path, 1800);
        if (url) proofLinks.push(url);
      }
      const proofLinksBox = $('#reviewProofLinks');
      if (proofLinksBox) proofLinksBox.innerHTML = proofLinks.map((url, index) => `<a class="btn btn-light" href="${esc(url)}" target="_blank" rel="noopener">Open solution ${index + 1}</a>`).join('');
      if ($('#reviewProofLabel')) $('#reviewProofLabel').textContent = proofLinks.length > 1 ? 'WORK PICTURES' : 'WORK PICTURE';
      proofWrap.hidden = !proofLinks.length;
      openDialog('reviewSubmissionModal');
    });
  } catch (error) {
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not load this submission.'), 'orange');
  }
}

function getManualReviewCheckboxes() {
  return $$('#reviewSubmissionAnswers [data-manual-correct]');
}

function calculateManualReviewScore() {
  return getManualReviewCheckboxes().reduce((sum, checkbox) => {
    return sum + (checkbox.checked ? Number(checkbox.dataset.maxPoints || 0) : 0);
  }, 0);
}

function getQuestionCommentInputs() {
  return $$('#reviewSubmissionAnswers [data-question-comment]');
}

function collectQuestionReviewPayload() {
  const commentsByQuestion = Object.fromEntries(
    getQuestionCommentInputs().map(input => [String(input.dataset.questionId || ''), String(input.value || '').trim()])
  );
  return getManualReviewCheckboxes()
    .filter(checkbox => checkbox.dataset.manualExisting === 'true' || commentsByQuestion[String(checkbox.dataset.questionId || '')])
    .map(checkbox => ({
      question_id: checkbox.dataset.questionId,
      manual_review: checkbox.dataset.manualExisting === 'true',
      is_correct: Boolean(checkbox.checked),
      teacher_comment: commentsByQuestion[String(checkbox.dataset.questionId || '')] || null
    }));
}

function updateManualReviewSummary(forceVisible = false) {
  const checkboxes = getManualReviewCheckboxes();
  const hasManual = forceVisible || checkboxes.some(checkbox => checkbox.dataset.manualExisting === 'true');
  const summary = $('#manualReviewSummary');
  const scoreEl = $('#manualReviewScore');
  if (!summary || !scoreEl) return;
  const submission = state.submissions.find(item => item.id === activeSubmissionId);
  const total = submission ? totalPoints(submission.assignment_id) : 0;
  scoreEl.textContent = `${calculateManualReviewScore()} / ${total}`;
  summary.hidden = !hasManual;
}

$('#reviewSubmissionAnswers')?.addEventListener('change', event => {
  const checkbox = event.target.closest('[data-manual-correct]');
  if (!checkbox) return;
  checkbox.dataset.manualExisting = 'true';
  checkbox.dataset.manualDirty = 'true';
  const row = checkbox.closest('.review-answer');
  if (row) {
    row.classList.toggle('correct', checkbox.checked);
    row.classList.toggle('needs-review', !checkbox.checked);
    const status = row.querySelector('[data-manual-status]');
    if (status) status.textContent = `Manual check: ${checkbox.checked ? 'Correct' : 'Wrong'}`;
  }
  const score = calculateManualReviewScore();
  const scoreInput = $('#teacherScoreInput');
  if (scoreInput) {
    scoreInput.value = String(score);
    scoreInput.readOnly = true;
  }
  updateManualReviewSummary(true);
});

$('#teacherFeedbackPreset')?.addEventListener('change', event => {
  const preset = String(event.currentTarget.value || '').trim();
  if (!preset) return;
  const feedbackBox = $('#teacherFeedbackInput');
  if (!feedbackBox) return;
  feedbackBox.value = preset;
  feedbackBox.focus();
  feedbackBox.setSelectionRange(feedbackBox.value.length, feedbackBox.value.length);
});

$('#allowResubmissionBtn')?.addEventListener('click', () => {
  if (!activeSubmissionId || !requireSupabase()) return;
  const submission = state.submissions.find(s => s.id === activeSubmissionId);
  if (!submission) return;
  const assignment = assignmentById(submission.assignment_id);
  const student = studentById(submission.student_id);
  if (!assignment?.allow_resubmission) return toast(`Resubmission is not enabled for this ${isPerformanceTask(assignment) ? 'performance task' : 'activity'}.`, 'orange');
  if (submission.resubmit_allowed) return toast('This student is already allowed to submit again.', 'orange');
  pendingResubmissionId = activeSubmissionId;
  const text = $('#resubmissionConfirmText');
  if (text) text.textContent = isPerformanceTask(assignment)
    ? `Allow ${student?.display_name || 'this student'} to submit one new attempt for “${assignment.title}”? The student will be notified and must upload new output pictures before submitting.`
    : `Allow ${student?.display_name || 'this student'} to submit one new attempt for “${assignment.title}”? The student will be notified and must upload a new solution image before submitting.`;
  openDialog('resubmissionConfirmModal');
});

$('#resubmissionConfirmModal')?.addEventListener('close', () => {
  pendingResubmissionId = null;
});

$('#confirmAllowResubmissionBtn')?.addEventListener('click', async () => {
  const submissionId = pendingResubmissionId;
  if (!submissionId || !requireSupabase()) return;
  const submission = state.submissions.find(s => s.id === submissionId);
  if (!submission) return closeDialog('resubmissionConfirmModal');
  const assignment = assignmentById(submission.assignment_id);
  if (!assignment?.allow_resubmission) {
    closeDialog('resubmissionConfirmModal');
    return toast(`Resubmission is not enabled for this ${isPerformanceTask(assignment) ? 'performance task' : 'activity'}.`, 'orange');
  }
  try {
    closeDialog('resubmissionConfirmModal');
    await withLoading('Allowing another attempt…', 'Updating this student’s submission permission.', async () => {
      const { error } = await db.rpc('classside_allow_resubmission', { p_submission_id: submissionId });
      if (error) throw error;
      submission.resubmit_allowed = true;
      const btn = $('#allowResubmissionBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Resubmission already allowed';
      }
    });
    toast('The student can now submit one new attempt.', 'success');
  } catch (error) {
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not allow another attempt.'), 'orange');
  } finally {
    pendingResubmissionId = null;
  }
});

async function cleanupGradedSubmissionProofs(submission) {
  const proofPaths = submissionProofPaths(submission);
  if (!proofPaths.length) return { deleted: 0, warning: '' };

  try {
    const removeResult = await db.storage.from('classside-submission-proofs').remove(proofPaths);
    if (removeResult.error) throw removeResult.error;

    const clearResult = await db.rpc('classside_clear_submission_proofs', {
      p_submission_id: submission.id
    });
    if (clearResult.error) throw clearResult.error;

    submission.proof_path = null;
    submission.proof_paths = [];
    for (const path of proofPaths) signedUrlCache.delete(`classside-submission-proofs:${path}`);
    return { deleted: proofPaths.length, warning: '' };
  } catch (error) {
    console.warn('Grade saved, but solution image cleanup could not finish.', error);
    return {
      deleted: 0,
      warning: 'The grade was saved, but the work pictures could not be removed yet. Run the new V23 storage-optimization SQL file in Supabase, then future graded submissions will clean up automatically.'
    };
  }
}

$('#gradeForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!activeSubmissionId) return;
  const form = new FormData(event.currentTarget);
  const scoreRaw = String(form.get('teacher_score') ?? '').trim();
  const score = scoreRaw === '' ? null : Number(scoreRaw);
  const feedback = String(form.get('feedback') || '').trim();
  const submission = state.submissions.find(s => s.id === activeSubmissionId);
  const total = totalPoints(submission.assignment_id);
  const answerReviews = collectQuestionReviewPayload();
  const hasManualAnswerReview = answerReviews.some(review => review.manual_review === true);
  const effectiveScore = hasManualAnswerReview ? calculateManualReviewScore() : score;
  if (effectiveScore != null && (!Number.isFinite(effectiveScore) || effectiveScore < 0 || effectiveScore > total)) return toast(`Enter a score from 0 to ${total}, or leave it blank to use the auto-check score.`, 'orange');
  try {
    let cleanupResult = { deleted: 0, warning: '' };
    await withLoading('Saving grade…', hasManualAnswerReview ? 'Saving manual answer checks, recomputing the score, and clearing reviewed work pictures.' : 'Updating the student score, feedback, and clearing reviewed work pictures.', async () => {
      const { data: reviewResult, error } = await db.rpc('classside_save_submission_review', {
        p_submission_id: activeSubmissionId,
        p_teacher_score: hasManualAnswerReview ? null : score,
        p_feedback: feedback || null,
        p_answer_reviews: answerReviews
      });
      if (error) throw error;

      // Update only the reviewed submission locally instead of reloading the
      // complete teacher workspace after every saved grade.
      const savedAt = new Date().toISOString();
      submission.teacher_score = reviewResult?.teacher_score ?? null;
      submission.feedback = feedback || null;
      submission.status = 'graded';
      submission.graded_at = savedAt;
      submission.updated_at = savedAt;

      const cachedAnswers = submissionAnswerCache.get(activeSubmissionId);
      if (cachedAnswers) {
        answerReviews.forEach(review => {
          const answer = cachedAnswers.find(item => item.question_id === review.question_id);
          if (!answer) return;
          if (review.manual_review) {
            answer.manual_is_correct = Boolean(review.is_correct);
            const question = state.questions.find(item => item.id === review.question_id);
            answer.awarded_points = review.is_correct ? Number(question?.max_points || 0) : 0;
          }
          answer.teacher_comment = review.teacher_comment || null;
        });
      }

      // Once the teacher has saved the final grade, the uploaded proof pictures
      // are no longer needed for checking. Delete them to keep Supabase Storage small.
      cleanupResult = await cleanupGradedSubmissionProofs(submission);
      closeDialog('reviewSubmissionModal');
      showTeacherView('submissions');
    });
    if (cleanupResult.warning) {
      toast(cleanupResult.warning, 'orange', 'Grade saved · storage cleanup pending');
    } else if (cleanupResult.deleted > 0) {
      toast(`Grade saved. ${cleanupResult.deleted} reviewed work picture${cleanupResult.deleted === 1 ? '' : 's'} removed from Storage to save space.`, 'success');
    } else {
      toast('Grade, manual checks, and feedback saved.', 'success');
    }
  } catch (error) {
    console.error(error);
    toast(friendlyErrorMessage(error, 'Could not save the grade.'), 'orange');
  }
});

// ---------- STARTUP / SESSION RESTORE ----------
(async function restoreSession() {
  if (!db) {
    if (window.CLASSSIDE_PREVIEW) return;
    setTimeout(() => toast('EduCore is ready for Supabase. Edit js/config.js before signing in.', 'orange'), 500);
    return;
  }
  try {
    const { data } = await db.auth.getSession();
    if (!data?.session) return;
    await withLoading('Restoring your EduCore…', 'Loading your Supabase classroom.', routeAuthenticatedUser);
  } catch (error) {
    console.error(error);
    try { await db.auth.signOut({ scope: 'local' }); } catch {}
    resetState();
    returnPublic();
    toast('Your previous session could not be restored. Please sign in again.', 'orange');
  }
})();

if (db) {
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      resetState();
      returnPublic();
    }
  });
}
