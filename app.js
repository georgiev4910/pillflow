// PillFlow main app — date helpers: js/dates.js, log helpers: js/logs.js
// ==================== FIREBASE INIT ====================
const firebaseConfig = {
  apiKey: "AIzaSyAdh15OILXjv7bP8G71YxNZFcOdL6G-pkA",
  authDomain: "pillflow-bd2a1.firebaseapp.com",
  projectId: "pillflow-bd2a1",
  storageBucket: "pillflow-bd2a1.firebasestorage.app",
  messagingSenderId: "339505692979",
  appId: "1:339505692979:web:4ade0187a952e4d822fe46",
  measurementId: "G-FWEFKXBXVF"
};

let auth = null;
let db = null;
let firebaseReady = false;

try {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  firebaseReady = true;
  console.log('✅ Firebase connected');
} catch (e) {
  console.warn('Firebase init error:', e.message);
}

// ==================== STATE ====================
let currentUser = null;          // { uid, email, displayName }
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
let calendarMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
let editingMedId = null;

// Real-time data (kept in memory, updated by listeners)
let meds = [];                   // array of med objects
let logs = {};                   // { "YYYY-MM-DD": { "medId_time": true } }
let profile = { name: '', avatar: '👩', gender: 'f', weight: '', height: '', blood: '', allergies: '' };

let unsubMeds = null;
let unsubLogs = null;
let unsubProfile = null;
let selectedAvatar = '👩';

const TIME_LABELS = {
  morning: 'Сутрин',
  noon: 'Обяд',
  evening: 'Вечер',
  night: 'Преди лягане'
};

const PERIOD_ORDER = ['morning', 'noon', 'evening', 'night'];
const PERIOD_DEFAULT_CLOCK = { morning: '08:00', noon: '13:00', evening: '19:00', night: '22:00' };

function isClockTime(t) {
  return typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t);
}

function normalizeClock(t) {
  if (!isClockTime(t)) return t;
  var p = t.split(':');
  return String(p[0]).padStart(2, '0') + ':' + String(p[1]).padStart(2, '0');
}

function timeLabel(t) {
  return TIME_LABELS[t] || t;
}

/** Label with clock time: "Сутрин · 08:00" or just "14:00" for exact times */
function timeLabelWithClock(t) {
  if (isClockTime(t)) return normalizeClock(t);
  var name = TIME_LABELS[t] || t;
  var clock = resolveSlotClock(t);
  return name + ' · ' + clock;
}

function resolveSlotClock(slot) {
  if (isClockTime(slot)) return normalizeClock(slot);
  var times = {};
  try { times = JSON.parse(localStorage.getItem('pillflow_notif_times') || '{}'); } catch (e) {}
  return times[slot] || PERIOD_DEFAULT_CLOCK[slot] || '12:00';
}

function sortTimeKeys(keys) {
  return keys.slice().sort(function (a, b) {
    var ca = resolveSlotClock(a);
    var cb = resolveSlotClock(b);
    return ca.localeCompare(cb);
  });
}

// Custom times in med form
var _customTimes = [];

function renderCustomTimesList() {
  var el = document.getElementById('custom-times-list');
  if (!el) return;
  if (!_customTimes.length) {
    el.innerHTML = '<span class="text-xs text-slate-400">Няма добавени точни часове</span>';
    return;
  }
  el.innerHTML = _customTimes.map(function (t) {
    return '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-sm">' +
      '<span class="font-medium">' + t + '</span>' +
      '<button type="button" onclick="removeCustomTime(\'' + t + '\')" class="text-slate-400 hover:text-red-500 ml-0.5" title="Махни">×</button></span>';
  }).join('');
}

function addCustomTime() {
  var input = document.getElementById('custom-time-input');
  if (!input || !input.value) return;
  var t = normalizeClock(input.value);
  if (_customTimes.indexOf(t) === -1) {
    _customTimes.push(t);
    _customTimes.sort();
    renderCustomTimesList();
  }
}

function removeCustomTime(t) {
  _customTimes = _customTimes.filter(function (x) { return x !== t; });
  renderCustomTimesList();
}

function getSelectedTimes() {
  var periods = Array.from(document.querySelectorAll('.time-check:checked')).map(function (c) { return c.value; });
  var all = periods.concat(_customTimes);
  // unique
  var seen = {};
  return all.filter(function (t) {
    if (seen[t]) return false;
    seen[t] = true;
    return true;
  });
}


const CONDITION_LABELS = {
  any: '',
  empty: 'На гладно',
  food: 'С храна',
  before_food: '≈30 мин преди храна',
  after_food: '≈30 мин след храна',
  before_food_60: '≈60 мин преди храна',
  after_food_60: '≈60 мин след храна',
  evening_empty: 'Вечер на гладно'
};

const DEPENDS_REL_LABELS = {
  after: 'след',
  before: 'преди',
  together: 'заедно с'
};

// Household members (self + optional people/pets)
let members = [{ id: 'self', name: 'Аз', type: 'person', avatar: '👤' }];
let currentMemberId = 'self';
let _memberAvatar = '🧒';
let householdId = null;
let householdCode = null;
let householdPeers = []; // [{uid, name, avatar, shareWithHousehold}]
let shareWithHousehold = true;
let viewingRemoteUid = null; // when viewing another user's shared profile
let unsubRemoteMeds = null;
let unsubRemoteLogs = null;



// ==================== HELPERS ====================
// date helpers → js/dates.js



function getCurrentMember() {
  return members.find(function (m) { return m.id === currentMemberId; }) || members[0];
}

function medBelongsToCurrent(med) {
  // Remote household mate: show all their meds (incl. pet profiles on their account)
  if (viewingRemoteUid) return true;
  var mid = med.memberId || 'self';
  return mid === currentMemberId;
}

function activeMeds() {
  return meds.filter(medBelongsToCurrent);
}

function logDocId(dateStr) {
  // Use "__" so member ids like m_abc123 do not break parsing
  if (!currentMemberId || currentMemberId === 'self') return dateStr;
  return currentMemberId + '__' + dateStr;
}

function dataUid() {
  // Whose Firestore path we read/write for meds/logs
  return viewingRemoteUid || (currentUser && currentUser.uid);
}

function parseLogDocId(docId) {
  // returns { memberId, dateStr }
  // Prefer "__" separator; also accept legacy single "_" for self-safe dates only
  if (/^\d{4}-\d{2}-\d{2}$/.test(docId)) return { memberId: 'self', dateStr: docId };
  var idx = docId.indexOf('__');
  if (idx > 0) {
    return { memberId: docId.slice(0, idx), dateStr: docId.slice(idx + 2) };
  }
  // legacy: only if suffix is a pure date
  var m = docId.match(/^(.*)_(........\d{2}-\d{2}-\d{2})$/);
  if (m && /^\d{4}-\d{2}-\d{2}$/.test(m[2])) {
    return { memberId: m[1], dateStr: m[2] };
  }
  return { memberId: 'self', dateStr: docId };
}

function applyDoseTemplate(n) {
  // legacy: exact clock times
  document.querySelectorAll('.time-check').forEach(function (c) { c.checked = false; });
  _customTimes = [];
  var presets = {
    1: ['08:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '14:00', '20:00'],
    4: ['08:00', '12:00', '16:00', '20:00']
  };
  _customTimes = (presets[n] || presets[1]).slice();
  renderCustomTimesList();
}

function applyPeriodTemplate(periods) {
  document.querySelectorAll('.time-check').forEach(function (c) {
    c.checked = periods.indexOf(c.value) !== -1;
  });
  _customTimes = [];
  renderCustomTimesList();
}

function updateDependsMinVisibility() {
  var rel = document.getElementById('med-depends-rel');
  var row = document.getElementById('depends-min-row');
  if (!row) return;
  var v = rel ? rel.value : 'after';
  row.classList.toggle('hidden', v !== 'after');
}

function checkConditionConflicts(newMed) {
  // soft warning if same slot has empty vs food-type conditions
  var foodish = { empty: 1, food: 1, before_food: 1, after_food: 1, before_food_60: 1, after_food_60: 1, evening_empty: 1 };
  if (!newMed.condition || newMed.condition === 'any' || !foodish[newMed.condition]) return null;
  var conflicts = [];
  activeMeds().forEach(function (m) {
    if (m.id === newMed.id) return;
    if (m.archived || m.active === false) return;
    if (!m.condition || m.condition === 'any' || !foodish[m.condition]) return;
    var emptySide = (newMed.condition === 'empty' || newMed.condition === 'evening_empty' || (newMed.condition || '').indexOf('before') === 0);
    var otherEmpty = (m.condition === 'empty' || m.condition === 'evening_empty' || (m.condition || '').indexOf('before') === 0);
    var foodSide = (newMed.condition === 'food' || (newMed.condition || '').indexOf('after') === 0);
    var otherFood = (m.condition === 'food' || (m.condition || '').indexOf('after') === 0);
    var shareTime = (newMed.times || []).some(function (t) { return (m.times || []).indexOf(t) !== -1; });
    if (shareTime && ((emptySide && otherFood) || (foodSide && otherEmpty))) {
      conflicts.push(m.name + ' (' + (CONDITION_LABELS[m.condition] || m.condition) + ')');
    }
  });
  return conflicts.length ? conflicts : null;
}


function showRegister() {
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');
  if (loginForm) loginForm.classList.add('hidden');
  if (regForm) {
    regForm.classList.remove('hidden');
    regForm.style.display = 'block';
  }
}

function showLogin() {
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');
  if (regForm) {
    regForm.classList.add('hidden');
    regForm.style.display = '';
  }
  if (loginForm) loginForm.classList.remove('hidden');
}

function handleRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;

  if (!name || !email || !password) {
    alert('Моля попълни всички полета');
    return;
  }
  if (password.length < 6) {
    alert('Паролата трябва да е поне 6 символа');
    return;
  }

  if (!firebaseReady) {
    localRegister(name, email, password);
    return;
  }

  auth.createUserWithEmailAndPassword(email, password)
    .then(cred => {
      return cred.user.updateProfile({ displayName: name }).then(() => {
        currentUser = {
          uid: cred.user.uid,
          email: cred.user.email,
          displayName: name
        };
        enterApp();
      });
    })
    .catch(err => {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        alert('Този имейл вече е регистриран');
      } else {
        alert('Грешка при регистрация: ' + err.message);
      }
    });
}

function handleLogin() {
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    alert('Моля попълни имейл и парола');
    return;
  }

  if (!firebaseReady) {
    localLogin(email, password);
    return;
  }

  auth.signInWithEmailAndPassword(email, password)
    .then(cred => {
      currentUser = {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || email.split('@')[0]
      };
      enterApp();
    })
    .catch(err => {
      console.error(err);
      alert('Грешен имейл или парола');
    });
}

function logout() {
  stopListeners();
  if (firebaseReady && auth) {
    auth.signOut();
  }
  currentUser = null;
  meds = [];
  logs = {};
  localStorage.removeItem('pillflow_session');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

// ==================== LOCAL FALLBACK ====================
function getLocalUsers() {
  return JSON.parse(localStorage.getItem('pillflow_users') || '{}');
}
function saveLocalUsers(u) {
  localStorage.setItem('pillflow_users', JSON.stringify(u));
}
function getLocalData(uid) {
  return JSON.parse(localStorage.getItem(`pillflow_data_${uid}`) || '{"meds":[],"logs":{}}');
}
function saveLocalData(uid, data) {
  localStorage.setItem(`pillflow_data_${uid}`, JSON.stringify(data));
}

function localRegister(name, email, password) {
  const users = getLocalUsers();
  if (users[email]) {
    alert('Този имейл вече е регистриран');
    return;
  }
  const id = 'local_' + Date.now();
  users[email] = { id, name, email, password };
  saveLocalUsers(users);
  saveLocalData(id, { meds: [], logs: {} });
  currentUser = { uid: id, email, displayName: name };
  localStorage.setItem('pillflow_session', JSON.stringify(currentUser));
  enterApp();
}

function localLogin(email, password) {
  const users = getLocalUsers();
  const user = users[email];
  if (!user || user.password !== password) {
    alert('Грешен имейл или парола');
    return;
  }
  currentUser = { uid: user.id, email: user.email, displayName: user.name };
  localStorage.setItem('pillflow_session', JSON.stringify(currentUser));
  enterApp();
}

// ==================== REAL-TIME LISTENERS ====================
function startListeners() {
  if (!currentUser) return;

  stopListeners();

  if (firebaseReady) {
    var uidPath = dataUid();
    unsubMeds = db.collection('users').doc(uidPath).collection('meds')
      .onSnapshot(snap => {
        meds = [];
        snap.forEach(doc => {
          meds.push({ id: doc.id, ...doc.data() });
        });
        meds.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        renderMeds();
        renderToday();
        renderCalendar();
      }, err => console.error('Meds listener error', err));

    unsubLogs = db.collection('users').doc(uidPath).collection('logs')
      .onSnapshot(snap => {
        logs = {};
        snap.forEach(doc => {
          var parsed = parseLogDocId(doc.id);
          if (viewingRemoteUid || currentMemberId === 'self') {
            if (!logs[parsed.dateStr]) logs[parsed.dateStr] = {};
            Object.assign(logs[parsed.dateStr], doc.data());
          } else if (parsed.memberId === currentMemberId) {
            logs[parsed.dateStr] = doc.data();
          }
        });
        renderToday();
        renderCalendar();
        if (typeof renderTakenHistory === 'function') renderTakenHistory();
      }, err => console.error('Logs listener error', err));
  } else {
    const data = getLocalData(currentUser.uid);
    meds = data.meds || [];
    logs = data.logs || {};
    renderMeds();
    renderToday();
    renderCalendar();
  }
}

function stopListeners() {
  if (unsubMeds) { unsubMeds(); unsubMeds = null; }
  if (unsubLogs) { unsubLogs(); unsubLogs = null; }
  if (unsubProfile) { unsubProfile(); unsubProfile = null; }
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.style.opacity = '0';
    splash.style.transition = 'opacity 0.3s ease';
    setTimeout(() => splash.classList.add('hidden'), 300);
  }
}

function applyProfileToUI() {
  if (!currentUser) return;
  var name = profile.name || currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : '—');
  var avatar = profile.avatar || '👩';
  var gender = profile.gender || 'f';
  selectedAvatar = avatar;

  var setVal = function (id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val == null ? '' : String(val);
  };
  setVal('profile-name', profile.name || name);
  setVal('profile-weight', profile.weight || '');
  setVal('profile-height', profile.height || '');
  setVal('profile-blood', profile.blood || '');
  setVal('profile-allergies', profile.allergies || '');

  var avEls = ['profile-avatar', 'profile-page-avatar', 'hero-avatar'];
  avEls.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = avatar;
  });
  var pn = document.getElementById('profile-page-name');
  if (pn) pn.textContent = name;
  var pe = document.getElementById('profile-page-email');
  if (pe) pe.textContent = currentUser.email || '';
  var pdn = document.getElementById('profile-display-name');
  if (pdn) pdn.textContent = name;
  var se = document.getElementById('settings-email');
  if (se) se.textContent = (currentUser.email || '') + (firebaseReady ? ' · облак' : ' · локално');

  document.querySelectorAll('.avatar-opt').forEach(function (btn) {
    if (btn.textContent.trim() === avatar) {
      btn.classList.add('ring-2', 'ring-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
    } else {
      btn.classList.remove('ring-2', 'ring-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
    }
  });
  var gf = document.getElementById('gender-f');
  var gm = document.getElementById('gender-m');
  if (gf && gm) {
    var active = 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-600';
    var inactive = 'border-slate-200 dark:border-slate-600 text-slate-500';
    gf.className = 'flex-1 py-2 rounded-xl border text-sm font-medium transition ' + (gender === 'f' ? active : inactive);
    gm.className = 'flex-1 py-2 rounded-xl border text-sm font-medium transition ' + (gender === 'm' ? active : inactive);
  }
}


function toggleProfileSection() {
  const body = document.getElementById('profile-body');
  const chevron = document.getElementById('profile-chevron');
  const isHidden = body.classList.contains('hidden');
  body.classList.toggle('hidden', !isHidden);
  chevron.style.transform = isHidden ? 'rotate(90deg)' : '';
}

function selectGender(g) {
  profile.gender = g;
  // visual only until save
  const gf = document.getElementById('gender-f');
  const gm = document.getElementById('gender-m');
  const active = 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-600';
  const inactive = 'border-slate-200 dark:border-slate-600 text-slate-500';
  gf.className = 'flex-1 py-2 rounded-xl border text-sm font-medium transition ' + (g === 'f' ? active : inactive);
  gm.className = 'flex-1 py-2 rounded-xl border text-sm font-medium transition ' + (g === 'm' ? active : inactive);
}



function getNavMode() {
  try { return localStorage.getItem('pillflow_nav_mode') || 'short'; } catch (e) { return 'short'; }
}

function cycleNavMode() {
  var next = getNavMode() === 'short' ? 'expanded' : 'short';
  try { localStorage.setItem('pillflow_nav_mode', next); } catch (e) {}
  applyNavMode();
}

function isTakenHistoryEnabled() {
  try {
    var v = localStorage.getItem('pillflow_taken_history');
    if (v === null || v === undefined) return true; // default on
    return v === '1';
  } catch (e) { return true; }
}

function toggleTakenHistorySetting() {
  var on = !isTakenHistoryEnabled();
  try { localStorage.setItem('pillflow_taken_history', on ? '1' : '0'); } catch (e) {}
  applyTakenHistorySetting();
}

function applyTakenHistorySetting() {
  var on = isTakenHistoryEnabled();
  var sec = document.getElementById('taken-history-section');
  if (sec) sec.classList.toggle('hidden', !on);
  var tog = document.getElementById('taken-history-toggle');
  var knob = document.getElementById('taken-history-knob');
  if (tog && knob) {
    if (on) {
      tog.classList.add('bg-primary-500');
      tog.classList.remove('bg-slate-200', 'dark:bg-slate-600');
      knob.style.transform = 'translateX(20px)';
    } else {
      tog.classList.remove('bg-primary-500');
      tog.classList.add('bg-slate-200', 'dark:bg-slate-600');
      knob.style.transform = 'translateX(0)';
    }
  }
  if (on && typeof renderTakenHistory === 'function') renderTakenHistory();
}

function applyNavMode() {
  var mode = getNavMode();
  var inner = document.getElementById('bottom-nav-inner');
  var extras = document.querySelectorAll('.nav-extra');
  var btn = document.getElementById('nav-mode-btn');
  var hint = document.getElementById('nav-mode-hint');
  if (mode === 'expanded') {
    if (inner) {
      inner.classList.remove('grid-cols-3');
      inner.classList.add('grid-cols-5');
    }
    extras.forEach(function (el) { el.classList.remove('hidden'); });
    if (btn) btn.textContent = 'Разширена';
    if (hint) hint.textContent = 'Разширена · 5 бутона (Дом, Календар, Днес, Лекарства, Добави)';
  } else {
    if (inner) {
      inner.classList.remove('grid-cols-5');
      inner.classList.add('grid-cols-3');
    }
    extras.forEach(function (el) { el.classList.add('hidden'); });
    if (btn) btn.textContent = 'Кратка';
    if (hint) hint.textContent = 'Кратка · 3 бутона (Календар, Днес, Добави)';
  }
}

function cycleTheme() {
  // cycle: system → light → dark → system
  const current = localStorage.getItem('pillflow_theme') || 'system';
  let next;
  if (current === 'system') next = 'light';
  else if (current === 'light') next = 'dark';
  else next = 'system';
  localStorage.setItem('pillflow_theme', next);
  applyTheme();
}

function applyTheme() {
  const mode = localStorage.getItem('pillflow_theme') || 'system';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  // toggle knob
  const knob = document.getElementById('theme-knob');
  const btn = document.getElementById('theme-toggle');
  if (knob && btn) {
    if (isDark) {
      knob.style.transform = 'translateX(20px)';
      btn.classList.add('bg-primary-500');
      btn.classList.remove('bg-slate-200', 'dark:bg-slate-600');
    } else {
      knob.style.transform = 'translateX(0)';
      btn.classList.remove('bg-primary-500');
      btn.classList.add('bg-slate-200');
    }
  }
}

function toggleCalDots() {
  const on = localStorage.getItem('pillflow_cal_dots') === '1';
  localStorage.setItem('pillflow_cal_dots', on ? '0' : '1');
  applyCalDotsToggle();
  renderCalendar();
}

function applyCalDotsToggle() {
  const on = localStorage.getItem('pillflow_cal_dots') === '1';
  const knob = document.getElementById('cal-dots-knob');
  const btn = document.getElementById('cal-dots-toggle');
  if (knob && btn) {
    if (on) {
      knob.style.transform = 'translateX(20px)';
      btn.classList.add('bg-primary-500');
      btn.classList.remove('bg-slate-200', 'dark:bg-slate-600');
    } else {
      knob.style.transform = 'translateX(0)';
      btn.classList.remove('bg-primary-500');
      btn.classList.add('bg-slate-200');
    }
  }
}

function isStockTrackingEnabled() {
  // default ON if never set — user can turn off in settings
  const v = localStorage.getItem('pillflow_stock');
  return v !== '0';
}

function toggleStockTracking() {
  localStorage.setItem('pillflow_stock', isStockTrackingEnabled() ? '0' : '1');
  applyStockToggle();
  renderToday();
  renderMeds();
}

function applyStockToggle() {
  const on = isStockTrackingEnabled();
  const knob = document.getElementById('stock-knob');
  const btn = document.getElementById('stock-toggle');
  if (knob && btn) {
    if (on) {
      knob.style.transform = 'translateX(20px)';
      btn.classList.add('bg-primary-500');
      btn.classList.remove('bg-slate-200', 'dark:bg-slate-600');
    } else {
      knob.style.transform = 'translateX(0)';
      btn.classList.remove('bg-primary-500');
      btn.classList.add('bg-slate-200');
    }
  }
  // Hide per-med stock UI in modal when global off
  const stockWrap = document.getElementById('stock-track-wrap');
  if (stockWrap) stockWrap.classList.toggle('hidden', !on);
}

function selectAvatar(emoji) {
  selectedAvatar = emoji;
  ['profile-avatar', 'profile-page-avatar'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = emoji;
  });
  document.querySelectorAll('.avatar-opt').forEach(btn => {
    if (btn.textContent.trim() === emoji) {
      btn.classList.add('ring-2', 'ring-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
    } else {
      btn.classList.remove('ring-2', 'ring-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
    }
  });
}

function saveProfile() {
  var nameEl = document.getElementById('profile-name');
  var name = (nameEl && nameEl.value || '').trim();
  if (!name) {
    alert('Моля въведи име');
    return;
  }

  var weightEl = document.getElementById('profile-weight');
  var heightEl = document.getElementById('profile-height');
  var bloodEl = document.getElementById('profile-blood');
  var allergiesEl = document.getElementById('profile-allergies');

  // Read gender from buttons state
  var gender = profile.gender || 'f';
  var gf = document.getElementById('gender-f');
  if (gf && gf.className.indexOf('border-primary-500') >= 0) gender = 'f';
  var gm = document.getElementById('gender-m');
  if (gm && gm.className.indexOf('border-primary-500') >= 0) gender = 'm';

  profile = {
    name: name,
    avatar: selectedAvatar || profile.avatar || '👩',
    gender: gender,
    weight: weightEl ? String(weightEl.value || '').trim() : '',
    height: heightEl ? String(heightEl.value || '').trim() : '',
    blood: bloodEl ? String(bloodEl.value || '') : '',
    allergies: allergiesEl ? String(allergiesEl.value || '').trim() : '',
    updatedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem('pillflow_profile_' + currentUser.uid, JSON.stringify(profile));
  } catch (e) { console.warn(e); }

  currentUser.displayName = name;
  applyProfileToUI();
  if (typeof renderToday === 'function') renderToday();
  if (typeof renderProfilePage === 'function') renderProfilePage();
  closeProfileEditModal();

  if (firebaseReady && db) {
    db.collection('users').doc(currentUser.uid).collection('profile').doc('main')
      .set(Object.assign({}, profile), { merge: false })
      .then(function () {
        if (auth && auth.currentUser) {
          auth.currentUser.updateProfile({ displayName: name }).catch(function () {});
        }
        console.log('Profile saved to cloud', profile);
        if (householdId) {
          var u = {};
          u['members.' + currentUser.uid + '.name'] = profile.name || 'Аз';
          u['members.' + currentUser.uid + '.avatar'] = profile.avatar || '👤';
          db.collection('households').doc(householdId).update(u).catch(function () {});
        }
      })
      .catch(function (err) {
        console.error(err);
        alert('Запазено на устройството. Облак: ' + err.message);
      });
  }
}

function loadProfile() {
  var defaults = { name: '', avatar: '👩', gender: 'f', weight: '', height: '', blood: '', allergies: '' };

  // 1) Local first
  try {
    var saved = localStorage.getItem('pillflow_profile_' + currentUser.uid);
    if (saved) {
      profile = Object.assign({}, defaults, JSON.parse(saved));
    } else {
      profile = Object.assign({}, defaults, { name: currentUser.displayName || '' });
    }
  } catch (e) {
    profile = Object.assign({}, defaults, { name: currentUser.displayName || '' });
  }
  selectedAvatar = profile.avatar || '👩';
  applyProfileToUI();

  // 2) Cloud overrides
  if (firebaseReady && db) {
    if (unsubProfile) { unsubProfile(); unsubProfile = null; }
    unsubProfile = db.collection('users').doc(currentUser.uid)
      .collection('profile').doc('main')
      .onSnapshot(function (doc) {
        if (doc.exists) {
          profile = Object.assign({}, defaults, doc.data());
          selectedAvatar = profile.avatar || '👩';
          try {
            localStorage.setItem('pillflow_profile_' + currentUser.uid, JSON.stringify(profile));
          } catch (e) {}
          applyProfileToUI();
          if (typeof renderToday === 'function') renderToday();
          if (typeof renderProfilePage === 'function') renderProfilePage();
        }
      }, function (err) { console.error('Profile load error', err); });
  }
}

// ==================== ENTER APP ====================
function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  hideSplash();
  currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  loadProfile();
  loadMembers();
  loadHousehold();
  startListeners();
  scheduleNotifications();
  applyStockToggle();
  applyCalDotsToggle();
  updateMemberSwitchLabel();
  if (typeof applyNavMode === 'function') applyNavMode();
  if (typeof applyTheme === 'function') applyTheme();
  if (typeof applyTakenHistorySetting === 'function') applyTakenHistorySetting();
}

// ==================== APP MENU ====================
function toggleAppMenu() {
  var menu = document.getElementById('app-menu');
  if (menu) menu.classList.toggle('hidden');
}

function menuGo(where) {
  var menu = document.getElementById('app-menu');
  if (menu) menu.classList.add('hidden');
  if (where === 'profile') {
    switchTab('profile');
  } else if (where === 'meds') {
    switchTab('meds');
  } else if (where === 'settings') {
    switchTab('settings');
    if (typeof renderHouseholdSettings === 'function') renderHouseholdSettings();
  } else if (where === 'household') {
    switchTab('household');
  } else if (where === 'logout') {
    logout();
  }
}

function openProfileEditModal() {
  applyProfileToUI();
  var m = document.getElementById('profile-modal');
  if (m) m.classList.remove('hidden');
}

function closeProfileEditModal() {
  var m = document.getElementById('profile-modal');
  if (m) m.classList.add('hidden');
}

function updateHeaderForTab(tab) {
  // Header stays brand-only: PillFlow + app icon
}

function renderProfilePage() {
  var isSelf = !viewingRemoteUid && (!currentMemberId || currentMemberId === 'self');
  var mem = getCurrentMember();
  var name, avatar, subtitle;
  if (isSelf) {
    name = (profile.name || (currentUser && currentUser.displayName) || '—');
    avatar = profile.avatar || '👩';
    subtitle = (currentUser && currentUser.email) || '';
  } else if (viewingRemoteUid) {
    var peer = householdPeers.find(function (p) { return p.uid === viewingRemoteUid; }) || {};
    name = peer.name || 'Член';
    avatar = peer.avatar || '👤';
    subtitle = 'Споделен профил от домакинството';
  } else {
    name = (mem && mem.name) || 'Профил';
    avatar = (mem && mem.avatar) || '👤';
    subtitle = (mem && mem.type === 'pet') ? 'Домашен любимец' : 'Профил в домакинството';
  }
  var av = document.getElementById('profile-page-avatar');
  var nm = document.getElementById('profile-page-name');
  var em = document.getElementById('profile-page-email');
  var editBtn = document.getElementById('profile-edit-btn');
  if (av) av.textContent = avatar;
  if (nm) nm.textContent = name;
  if (em) em.textContent = subtitle;
  if (editBtn) {
    editBtn.textContent = isSelf ? 'Редактирай данните →' : ('Редактирай ' + name + ' →');
    editBtn.classList.toggle('hidden', !!viewingRemoteUid);
  }

  // stats — already filtered by current member via getMedsForDate / medBelongsToCurrent
  var streak = typeof calculateStreak === 'function' ? calculateStreak() : 0;
  var se = document.getElementById('stat-streak');
  if (se) se.textContent = streak;
  var sm = document.getElementById('stat-meds');
  if (sm) sm.textContent = meds.filter(function (m) { return medBelongsToCurrent(m) && m.archived !== true; }).length;

  // perfect days last 7
  var today = new Date();
  today.setHours(0,0,0,0);
  var perfect = 0, takenTotal = 0;
  for (var i = 0; i < 7; i++) {
    var d = new Date(today);
    d.setDate(d.getDate() - i);
    if (typeof isDayComplete === 'function' && isDayComplete(d)) perfect++;
    var dayMeds = typeof getMedsForDate === 'function' ? getMedsForDate(d) : [];
    var dayLog = logs[formatDate(d)] || {};
    dayMeds.forEach(function (med) {
      (med.times || []).forEach(function (t) {
        if (isLogTaken(dayLog, med.id + '_' + t)) takenTotal++;
      });
    });
  }
  // all-time taken approx from logs
  var allTaken = 0;
  Object.keys(logs || {}).forEach(function (ds) {
    Object.keys(logs[ds] || {}).forEach(function (k) {
      if (logs[ds][k]) allTaken++;
    });
  });
  var sp = document.getElementById('stat-perfect-week');
  if (sp) sp.textContent = perfect;
  var st = document.getElementById('stat-taken-total');
  if (st) st.textContent = allTaken;

  // health / member summary
  var hs = document.getElementById('profile-health-summary');
  var ht = document.getElementById('profile-health-title');
  if (hs) {
    var rows = [];
    if (isSelf) {
      if (ht) ht.textContent = 'Здравни данни';
      if (profile.weight) rows.push('<div class="flex justify-between"><span class="text-slate-400">Тегло</span><span class="font-medium">' + profile.weight + ' кг</span></div>');
      if (profile.height) rows.push('<div class="flex justify-between"><span class="text-slate-400">Височина</span><span class="font-medium">' + profile.height + ' см</span></div>');
      if (profile.blood) rows.push('<div class="flex justify-between"><span class="text-slate-400">Кръвна група</span><span class="font-medium">' + profile.blood + '</span></div>');
      if (profile.allergies) rows.push('<div class="flex justify-between gap-4"><span class="text-slate-400">Алергии</span><span class="font-medium text-right">' + profile.allergies + '</span></div>');
      if (profile.gender) rows.push('<div class="flex justify-between"><span class="text-slate-400">Род</span><span class="font-medium">' + (profile.gender === 'm' ? 'Мъж' : 'Жена') + '</span></div>');
      hs.innerHTML = rows.length ? rows.join('') : '<p class="text-slate-400">Все още няма попълнени данни. Натисни „Редактирай данните“.</p>';
    } else if (mem && !viewingRemoteUid) {
      if (ht) ht.textContent = (mem.type === 'pet') ? 'Данни за любимеца' : 'Данни за профила';
      if (mem.breed) rows.push('<div class="flex justify-between"><span class="text-slate-400">Порода / бележка</span><span class="font-medium">' + mem.breed + '</span></div>');
      if (mem.weight) rows.push('<div class="flex justify-between"><span class="text-slate-400">Тегло</span><span class="font-medium">' + mem.weight + '</span></div>');
      if (mem.birthDate) rows.push('<div class="flex justify-between"><span class="text-slate-400">Рождена дата</span><span class="font-medium">' + mem.birthDate + (typeof memberAgeLabel === 'function' ? ' · ' + memberAgeLabel(mem.birthDate) : '') + '</span></div>');
      rows.push('<div class="flex justify-between"><span class="text-slate-400">В моя календар</span><span class="font-medium">' + (mem.showOnMyCalendar ? 'Да 📌' : 'Не') + '</span></div>');
      hs.innerHTML = rows.length ? rows.join('') : '<p class="text-slate-400">Няма попълнени данни. Натисни „Редактирай“.</p>';
    } else {
      if (ht) ht.textContent = 'Информация';
      hs.innerHTML = '<p class="text-slate-400">Споделен профил — данните се управляват от собственика.</p>';
    }
  }

  // achievements
  var al = document.getElementById('achievements-list');
  if (al) {
    var badges = [
      { id: 'first', label: 'Първо хапче', ok: allTaken >= 1, icon: '🌱' },
      { id: 'streak3', label: '3 дни подред', ok: streak >= 3, icon: '🔥' },
      { id: 'streak7', label: '7 дни подред', ok: streak >= 7, icon: '⭐' },
      { id: 'streak30', label: '30 дни подред', ok: streak >= 30, icon: '🏆' },
      { id: 'week', label: 'Перфектна седмица', ok: perfect >= 7, icon: '✨' },
      { id: 'fifty', label: '50 взети', ok: allTaken >= 50, icon: '💪' }
    ];
    al.innerHTML = badges.map(function (b) {
      return '<div class="p-3 rounded-xl border text-center ' + (b.ok
        ? 'border-primary-200 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20'
        : 'border-slate-100 dark:border-slate-700 opacity-40') + '">' +
        '<div class="text-xl mb-1">' + b.icon + '</div>' +
        '<div class="text-xs font-medium">' + b.label + '</div>' +
        (b.ok ? '<div class="text-[10px] text-emerald-500 mt-0.5">отключено</div>' : '<div class="text-[10px] text-slate-400 mt-0.5">заключено</div>') +
        '</div>';
    }).join('');
  }
}

document.addEventListener('click', function (e) {
  var menu = document.getElementById('app-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (!e.target.closest) return;
  if (!e.target.closest('#app-menu') && !e.target.closest('#hamburger-btn') && !e.target.closest('[onclick*="toggleAppMenu"]')) {
    menu.classList.add('hidden');
  }
});

// ==================== TABS ====================
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`tab-${tab}`);
  if (el) {
    el.classList.add('active');
    el.classList.add('fade-in');
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('text-primary-500');
    btn.classList.add('text-slate-400');
  });
  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-400');
    activeBtn.classList.add('text-primary-500');
  }

  updateHeaderForTab(tab);
  if (tab === 'today') {
    // Default: jump to real today. Calendar "open full day" sets _preserveCurrentDate
    if (!window._preserveCurrentDate) {
      currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);
    }
    window._preserveCurrentDate = false;
    renderToday();
  }
  if (tab === 'calendar') {
    renderCalendar();
    renderWeekReview();
    renderTrendsChart();
    renderTakenHistory();
  }
  if (tab === 'meds') renderMeds();
  if (tab === 'profile') renderProfilePage();
  if (tab === 'household') {
    if (typeof renderHouseholdSettings === 'function') renderHouseholdSettings();
  }
  if (tab === 'settings') {
    applyNotifToggle();
    loadNotifTimes();
    applyTheme();
    applyCalDotsToggle();
    applyStockToggle();
    if (typeof applyNavMode === 'function') applyNavMode();
    if (typeof applyTakenHistorySetting === 'function') applyTakenHistorySetting();
  }
  var menu = document.getElementById('app-menu');
  if (menu) menu.classList.add('hidden');
}

// ==================== SCHEDULE LOGIC ====================
function shouldTakeOnDate(med, date) {
  // Paused or archived — keep history, not on schedule
  if (med.active === false || med.archived === true) return false;

  const dayOfWeek = date.getDay();
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  // Start date: explicit startDate, else createdAt (date only), else TODAY
  // Never schedule in the past relative to when the med was added
  let start = med.startDate ? parseLocalDate(med.startDate) : null;
  if (!start && med.createdAt) {
    start = new Date(med.createdAt);
  }
  if (!start) {
    start = new Date();
  }
  start.setHours(0, 0, 0, 0);
  if (d < start) return false;

  if (med.endDate) {
    const end = parseLocalDate(med.endDate);
    if (end) {
      end.setHours(0, 0, 0, 0);
      if (d > end) return false;
    }
  }

  // Frequency
  if (med.frequency === 'every_other') {
    const ref = start;
    const diff = Math.floor((d - ref) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff % 2 === 0;
  }

  if (med.frequency === 'specific_days') {
    return (med.days || []).includes(dayOfWeek);
  }

  if (med.frequency === 'interval') {
    var every = Math.max(1, parseInt(med.intervalValue, 10) || 1);
    var unit = med.intervalUnit || 'days';
    if (unit === 'months') {
      var day = start.getDate();
      var cursor = new Date(start.getFullYear(), start.getMonth(), day);
      cursor.setHours(0,0,0,0);
      var guard = 0;
      while (cursor < d && guard < 240) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + every, day);
        cursor.setHours(0,0,0,0);
        guard++;
      }
      return cursor.getTime() === d.getTime();
    }
    var stepDays = every;
    if (unit === 'weeks') stepDays = every * 7;
    var diff = Math.floor((d - start) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff % stepDays === 0;
  }

  // daily / lifelong — only from start date forward
  return true;
}

function memberAgeLabel(birthDate) {
  if (!birthDate) return '';
  try {
    var b = parseLocalDate(birthDate) || new Date(birthDate);
    if (!b || isNaN(b.getTime())) return birthDate;
    var now = new Date();
    var years = now.getFullYear() - b.getFullYear();
    var m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) years--;
    if (years < 1) {
      var months = (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth();
      if (now.getDate() < b.getDate()) months--;
      return months <= 0 ? 'новородено' : months + ' мес.';
    }
    return years + (years === 1 ? ' г.' : ' г.');
  } catch (e) { return birthDate; }
}

function findLastTakenDate(depMedId, beforeDate) {
  if (!depMedId) return null;
  var depMed = meds.find(function (m) { return m.id === depMedId; });
  var times = (depMed && depMed.times) ? depMed.times : [];
  var d = new Date(beforeDate || new Date());
  d.setHours(0,0,0,0);
  for (var i = 0; i < 400; i++) {
    var ds = formatDate(d);
    var dayLog = logs[ds] || {};
    var taken = false;
    if (times.length) {
      times.forEach(function (t) {
        if (isLogTaken(dayLog, depMedId + '_' + t)) taken = true;
      });
    } else {
      Object.keys(dayLog).forEach(function (k) {
        if (k.indexOf(depMedId + '_') === 0 && isLogTaken(dayLog, k)) taken = true;
      });
    }
    if (taken) return new Date(d);
    d.setDate(d.getDate() - 1);
  }
  return null;
}

function getMemberMeta(memberId) {
  var mid = memberId || 'self';
  var m = members.find(function (x) { return x.id === mid; });
  if (m) return m;
  return { id: mid, name: mid === 'self' ? 'Аз' : 'Профил', type: 'person', avatar: '👤' };
}

function intervalLabel(med) {
  if (med.frequency !== 'interval') return '';
  var v = med.intervalValue || 1;
  var u = med.intervalUnit || 'days';
  var map = { days: 'дни', weeks: 'седмици', months: 'месеци' };
  return 'на ' + v + ' ' + (map[u] || u);
}

function getNextDoseDate(med, fromDate) {
  var from = fromDate ? new Date(fromDate) : new Date();
  from.setHours(0, 0, 0, 0);
  for (var i = 0; i < 800; i++) {
    var d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    if (shouldTakeOnDate(med, d)) return d;
  }
  return null;
}

function formatCountdown(med) {
  var next = getNextDoseDate(med, new Date());
  if (!next) return null;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var diff = Math.round((next - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return null;
  if (diff === 0) return { days: 0, label: 'Днес е денят за прием', next: next };
  if (diff === 1) return { days: 1, label: 'Утре', next: next };
  if (diff < 30) return { days: diff, label: 'След ' + diff + ' дни', next: next };
  var months = Math.floor(diff / 30);
  var rest = diff % 30;
  var t = 'След ~' + months + (months === 1 ? ' месец' : ' месеца');
  if (rest && months < 3) t += ' и ' + rest + ' дни';
  return { days: diff, label: t, next: next };
}

function getCountdownMeds() {
  return meds.filter(function (med) {
    if (!med.showCountdown) return false;
    if (med.active === false || med.archived === true) return false;
    if (viewingRemoteUid) return true;
    var mid = med.memberId || 'self';
    var meta = getMemberMeta(mid);
    // Member-level master switch for countdowns (default on)
    if (mid !== 'self' && meta && meta.showCountdowns === false) return false;
    if (medBelongsToCurrent(med)) return true;
    // On owner "self": show other members' countdowns only if they pin + allow on my profile
    if (!viewingRemoteUid && currentMemberId === 'self' && mid !== 'self') {
      if (meta && meta.showCountdownOnMyProfile) return true;
    }
    return false;
  });
}

function getMedsForDate(date) {
  var list = meds.filter(function (med) {
    return medBelongsToCurrent(med) && shouldTakeOnDate(med, date);
  });
  if (!viewingRemoteUid && currentMemberId === 'self') {
    meds.forEach(function (med) {
      if ((med.memberId || 'self') === 'self') return;
      var meta = getMemberMeta(med.memberId);
      var memberPinned = !!(meta && meta.showOnMyCalendar);
      if (!memberPinned && !med.showOnOwnerToday) return;
      if (med.active === false || med.archived === true) return;
      if (!shouldTakeOnDate(med, date)) return;
      if (list.some(function (x) { return x.id === med.id; })) return;
      list.push(med);
    });
  }
  return list;
}

// ==================== TODAY VIEW ====================
function changeDay(delta) {
  currentDate.setDate(currentDate.getDate() + delta);
  renderToday();
}

function goToToday() {
  currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  // Ensure Today tab is visible
  var tab = document.getElementById('tab-today');
  if (tab && !tab.classList.contains('active')) {
    switchTab('today');
    return;
  }
  renderToday();
}

function getGreeting() {
  const h = new Date().getHours();
  // Different pools by time of day – pick one at random each load
  let options;
  if (h >= 5 && h < 12) {
    options = ['Добро утро', 'Здравей', 'Привет', 'Хубав ден', 'Добро утро'];
  } else if (h >= 12 && h < 18) {
    options = ['Добър ден', 'Здравей', 'Привет', 'Хубав следобед', 'Добър ден'];
  } else if (h >= 18 && h < 22) {
    options = ['Добър вечер', 'Здравей', 'Привет', 'Добър вечер'];
  } else {
    options = ['Здравей', 'Привет', 'Добра нощ', 'Здравей'];
  }
  // Stable per session hour so it doesn't jump on every re-render
  if (!window._pillGreeting || window._pillGreetingHour !== h) {
    window._pillGreeting = options[Math.floor(Math.random() * options.length)];
    window._pillGreetingHour = h;
  }
  return window._pillGreeting;
}

function isDayComplete(date) {
  const dateStr = formatDate(date);
  const dayMeds = getMedsForDate(date);
  if (dayMeds.length === 0) return false;
  const dayLog = logs[dateStr] || {};
  let total = 0, taken = 0;
  dayMeds.forEach(med => {
    (med.times || []).forEach(t => {
      total++;
      if (isLogTaken(dayLog, med.id + '_' + t)) taken++;
    });
  });
  return total > 0 && taken === total;
}

function calculateStreak() {
  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // If today is not complete yet, start from yesterday
  if (!isDayComplete(d)) {
    d.setDate(d.getDate() - 1);
  }
  for (let i = 0; i < 365; i++) {
    const dayMeds = getMedsForDate(d);
    if (dayMeds.length === 0) {
      // no meds that day – skip without breaking streak
      d.setDate(d.getDate() - 1);
      continue;
    }
    if (isDayComplete(d)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}


function ownerBadgeHtml(med) {
  var mid = med.memberId || 'self';
  if (mid === 'self') return '';
  if (viewingRemoteUid) return '';
  if (currentMemberId !== 'self') return '';
  var meta = getMemberMeta(mid);
  return ' <span class="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-md align-middle">' +
    (meta.avatar || '👤') + ' ' + (meta.name || '') + '</span>';
}

function buildCountdownHtml() {
  var list = typeof getCountdownMeds === 'function' ? getCountdownMeds() : [];
  if (!list.length) return '';
  var blocks = [];
  list.forEach(function (med) {
    var cd = formatCountdown(med);
    if (!cd) return;
    var meta = getMemberMeta(med.memberId || 'self');
    var who = (med.memberId && med.memberId !== 'self') ? (meta.avatar + ' ' + meta.name + ' · ') : '';
    var extra = intervalLabel(med);
    blocks.push(
      '<div class="p-3.5 rounded-2xl bg-gradient-to-r from-violet-50 to-sky-50 dark:from-violet-900/25 dark:to-sky-900/20 border border-violet-100 dark:border-violet-800/40">' +
      '<div class="flex items-start justify-between gap-2">' +
      '<div class="min-w-0">' +
      '<p class="text-[11px] font-semibold text-violet-500 uppercase tracking-wide">Следващ прием</p>' +
      '<p class="font-semibold text-slate-800 dark:text-slate-100 truncate">' + who + med.name + (med.dose ? ' · ' + med.dose : '') + '</p>' +
      (extra ? '<p class="text-xs text-slate-400 mt-0.5">' + extra + '</p>' : '') +
      '</div>' +
      '<div class="text-right flex-shrink-0">' +
      '<p class="text-lg font-bold text-violet-600 dark:text-violet-300">' + (cd.days === 0 ? 'Днес' : cd.days + 'д') + '</p>' +
      '<p class="text-[11px] text-slate-400">' + cd.label + '</p>' +
      '</div></div></div>'
    );
  });
  if (!blocks.length) return '';
  return '<div class="mb-4 space-y-2.5">' + blocks.join('') + '</div>';
}

function renderToday() {
  const dateStr = formatDate(currentDate);
  const isToday = isSameDay(currentDate, new Date());
  const mem = getCurrentMember();
  const isSelf = !viewingRemoteUid && (!currentMemberId || currentMemberId === 'self');
  const firstName = isSelf
    ? (profile.name || currentUser?.displayName || '').split(' ')[0]
    : (viewingRemoteUid
        ? ((householdPeers.find(function (p) { return p.uid === viewingRemoteUid; }) || {}).name || 'Член')
        : (mem && mem.name) || 'Профил');
  const avatar = isSelf
    ? (profile.avatar || '👩')
    : (viewingRemoteUid
        ? ((householdPeers.find(function (p) { return p.uid === viewingRemoteUid; }) || {}).avatar || '👤')
        : (mem && mem.avatar) || '👤');

  // Hero avatar + greeting (main blue card – clear and visible)
  const heroAv = document.getElementById('hero-avatar');
  if (heroAv) heroAv.textContent = avatar;

  const greetEl = document.getElementById('today-greeting');
  const nameEl = document.getElementById('today-name');
  const heroExtra = document.getElementById('hero-member-extra');
  if (isToday) {
    if (isSelf) {
      if (greetEl) greetEl.textContent = getGreeting();
      if (nameEl) nameEl.textContent = firstName || 'Ти';
    } else {
      if (greetEl) greetEl.textContent = (mem && mem.type === 'pet') ? 'Профил · любимец' : 'Профил';
      if (nameEl) nameEl.textContent = firstName;
    }
  } else {
    if (greetEl) greetEl.textContent = firstName || 'PillFlow';
    if (nameEl) nameEl.textContent = formatDisplayDate(currentDate);
  }
  if (heroExtra) {
    if (!isSelf && mem && !viewingRemoteUid) {
      var bits = [];
      if (mem.breed) bits.push(mem.breed);
      if (mem.weight) bits.push(mem.weight + (String(mem.weight).match(/кг|kg/i) ? '' : ' кг'));
      if (mem.birthDate) bits.push(memberAgeLabel(mem.birthDate));
      heroExtra.textContent = bits.join(' · ') || (mem.type === 'pet' ? 'Домашен любимец' : 'Член на домакинството');
      heroExtra.classList.remove('hidden');
    } else {
      heroExtra.textContent = '';
      heroExtra.classList.add('hidden');
    }
  }

  const dayMeds = getMedsForDate(currentDate);
  const dayLog = logs[dateStr] || {};

  let total = 0, taken = 0;
  dayMeds.forEach(med => {
    (med.times || []).forEach(t => {
      total++;
      if (isLogTaken(dayLog, med.id + '_' + t)) taken++;
    });
  });

  // Subtitle + progress bar + motivation
  const subtitle = document.getElementById('today-subtitle');
  const bar = document.getElementById('progress-bar');
  const mot = document.getElementById('motivation-text');
  const motChip = document.getElementById('motivation-chip');
  const pctBar = total === 0 ? 0 : Math.round((taken / total) * 100);
  if (bar) bar.style.width = pctBar + '%';

  if (subtitle) {
    if (!isToday) {
      subtitle.textContent = formatDisplayDate(currentDate);
    } else if (total === 0) {
      subtitle.textContent = 'Добави медикамент, за да започнеш';
    } else if (taken === total) {
      subtitle.textContent = 'Всичко е взето — страхотен ден';
    } else if (taken === 0) {
      subtitle.textContent = total + ' предстоят · още нищо не е отбелязано';
    } else {
      subtitle.textContent = taken + ' от ' + total + ' взети · остават ' + (total - taken);
    }
  }

  if (mot && motChip) {
    if (!isToday) {
      motChip.classList.add('hidden');
    } else if (total === 0) {
      motChip.classList.remove('hidden');
      mot.textContent = 'Готов за нов старт';
    } else if (taken === total) {
      motChip.classList.add('hidden'); // complete badge shows instead
    } else if (taken === 0) {
      motChip.classList.remove('hidden');
      mot.textContent = 'Първата стъпка е най-важната';
    } else if (pctBar >= 70) {
      motChip.classList.remove('hidden');
      mot.textContent = (profile.gender === 'm') ? 'Почти си готов' : 'Почти си готова';
    } else {
      motChip.classList.remove('hidden');
      mot.textContent = 'Продължаваш добре';
    }
  }

  // Circular progress
  const pct = total === 0 ? 0 : taken / total;
  const circumference = 97.4;
  const offset = circumference * (1 - pct);
  const circle = document.getElementById('progress-circle');
  if (circle) {
    circle.style.strokeDashoffset = offset;
    if (taken === total && total > 0) {
      circle.setAttribute('stroke', '#6ee7b7'); // emerald
    } else {
      circle.setAttribute('stroke', 'white');
    }
  }
  document.getElementById('progress-text').textContent = total === 0 ? '—' : `${taken}/${total}`;

  // Streak
  const streak = calculateStreak();
  const streakBadge = document.getElementById('streak-badge');
  const completeBadge = document.getElementById('complete-badge');
  if (streak >= 1) {
    streakBadge.classList.remove('hidden');
    streakBadge.classList.add('inline-flex');
    document.getElementById('streak-count').textContent = streak;
  } else {
    streakBadge.classList.add('hidden');
    streakBadge.classList.remove('inline-flex');
  }

  if (taken === total && total > 0) {
    completeBadge.classList.remove('hidden');
    completeBadge.classList.add('inline-flex');
  } else {
    completeBadge.classList.add('hidden');
    completeBadge.classList.remove('inline-flex');
  }

  const container = document.getElementById('today-sections');
  const empty = document.getElementById('today-empty');

  if (dayMeds.length === 0) {
    var pre = '';
    if (!viewingRemoteUid && currentMemberId && currentMemberId !== 'self') {
      var cm0 = getCurrentMember();
      if (cm0) {
        var pinned0 = !!cm0.showOnMyCalendar;
        pre = '<div class="mb-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 flex items-center justify-between gap-3">' +
          '<div class="min-w-0 text-sm"><p class="font-semibold text-slate-800 dark:text-slate-100">📌 В моя календар</p>' +
          '<p class="text-xs text-slate-500">' + (pinned0 ? 'Хапчетата се виждат и при „Аз“' : 'Скрити от основния ти изглед') + '</p></div>' +
          pinToggleHtml(cm0.id, pinned0) + '</div>';
      }
    }
    var onlyCd = buildCountdownHtml();
    if (pre || onlyCd) {
      empty.classList.add('hidden');
      container.innerHTML = pre + (onlyCd || '<p class="text-sm text-slate-400 text-center py-6">Няма хапчета за този ден</p>');
      return;
    }
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Group by time key (period or HH:MM), then render in clock order
  const sections = {};
  dayMeds.forEach(med => {
    (med.times || []).forEach(t => {
      if (!sections[t]) sections[t] = [];
      sections[t].push({ med, time: t });
    });
  });

  const sectionIcons = { morning: '🌅', noon: '☀️', evening: '🌆', night: '🌙' };
  const orderedKeys = sortTimeKeys(Object.keys(sections));

  // Course ending soon banner
  let html = '';
  const endingSoon = dayMeds.filter(m => {
    const r = daysRemaining(m);
    return r !== null && r >= 0 && r <= 3;
  });
  if (endingSoon.length > 0) {
    html += `<div class="mb-3 p-3 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
      ${endingSoon.map(m => {
        const r = daysRemaining(m);
        return r === 0 ? `<div>⚠️ <b>${m.name}</b> — последен ден</div>` : `<div>⏳ <b>${m.name}</b> — остават ${r} дни</div>`;
      }).join('')}
    </div>`;
  }
  const lowStock = (isStockTrackingEnabled() ? dayMeds.filter(m => m.stock != null && m.stock !== '' && Number(m.stock) <= (Number(m.stockLow) || 5)) : []);
  if (lowStock.length > 0) {
    html += `<div class="mb-3 p-3 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-200">
      ${lowStock.map(m => `<div>🛒 <b>${m.name}</b> — остават ${m.stock} бр. (време за нова опаковка)</div>`).join('')}
    </div>`;
  }

  // Pin banner for pet/child profile
  if (!viewingRemoteUid && currentMemberId && currentMemberId !== 'self') {
    var cm = getCurrentMember();
    if (cm) {
      var pinned = !!cm.showOnMyCalendar;
      var cdOn = cm.showCountdowns !== false;
      var cdMine = !!cm.showCountdownOnMyProfile;
      html += '<div class="mb-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 space-y-3">' +
        '<div class="flex items-center justify-between gap-3">' +
        '<div class="min-w-0 text-sm"><p class="font-semibold text-slate-800 dark:text-slate-100">📌 В моя календар</p>' +
        '<p class="text-xs text-slate-500">' + (pinned
          ? 'Хапчетата на ' + cm.name + ' се виждат и при „Аз“'
          : 'Скрити от основния ти Днес / календар') + '</p></div>' +
        pinToggleHtml(cm.id, pinned) + '</div>' +
        '<div class="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-700 pt-3">' +
        '<div class="min-w-0 text-sm"><p class="font-semibold text-slate-800 dark:text-slate-100">⏳ Обратно броене</p>' +
        '<p class="text-xs text-slate-500">' + (cdOn ? 'Показва се в профила на ' + cm.name : 'Скрито в този профил') + '</p></div>' +
        '<button type="button" onclick="toggleMemberShowCountdowns(\'' + cm.id + '\')" class="relative w-12 h-7 flex-shrink-0 rounded-full transition ' + (cdOn ? 'bg-violet-500' : 'bg-slate-200 dark:bg-slate-600') + '">' +
        '<span class="absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform" style="transform:' + (cdOn ? 'translateX(20px)' : 'translateX(0)') + '"></span></button></div>' +
        '<div class="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-700 pt-3">' +
        '<div class="min-w-0 text-sm"><p class="font-semibold text-slate-800 dark:text-slate-100">⏳ И при „Аз“</p>' +
        '<p class="text-xs text-slate-500">' + (cdMine ? 'Countdown на ' + cm.name + ' се вижда и при теб' : 'Само в профила на ' + cm.name) + '</p></div>' +
        '<button type="button" onclick="toggleMemberCountdownOnMyProfile(\'' + cm.id + '\')" class="relative w-12 h-7 flex-shrink-0 rounded-full transition ' + (cdMine ? 'bg-violet-500' : 'bg-slate-200 dark:bg-slate-600') + '">' +
        '<span class="absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform" style="transform:' + (cdMine ? 'translateX(20px)' : 'translateX(0)') + '"></span></button></div></div>';
    }
  }

  html += buildCountdownHtml();

  orderedKeys.forEach(timeKey => {
    const items = sections[timeKey];
    if (!items || items.length === 0) return;

    const sectionTaken = items.filter(({ med, time }) => isLogTaken(dayLog, med.id + '_' + time)).length;

    const allDone = sectionTaken === items.length && items.length > 0;
    const icon = sectionIcons[timeKey] || '🕐';
    const label = timeLabelWithClock(timeKey);
    html += `<div>
      <div class="flex items-center justify-between mb-2.5 gap-2">
        <h3 class="text-xs font-semibold text-slate-400 dark:text-slate-500 section-label flex items-center gap-1.5">
          <span>${icon}</span> ${label}
        </h3>
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400">${sectionTaken}/${items.length}</span>
          ${(!allDone && isSameDay(currentDate, new Date())) ? `<button onclick="takeAllForSlot('${timeKey}')" class="text-[11px] font-semibold text-primary-500 bg-primary-50 dark:bg-primary-900/30 px-2.5 py-1 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/50 transition">Всички ✓</button>` : ''}
        </div>
      </div>
      <div class="space-y-2.5">`;

    items.forEach(({ med, time }) => {
      const key = `${med.id}_${time}`;
      const isTaken = isLogTaken(dayLog, key);
      const skipReason = getLogReason(dayLog, key);
      const condition = CONDITION_LABELS[med.condition] || '';
      const note = med.note ? med.note : '';

      // Dependency check (after / before / together)
      let locked = false;
      let lockMsg = '';
      const depRel = med.dependsRel || 'after';
      if (med.dependsOn && !isTaken) {
        const depMed = meds.find(m => m.id === med.dependsOn);
        let anyDepTaken = false;
        if (depMed) {
          (depMed.times || []).forEach(t => {
            if (isLogTaken(dayLog, depMed.id + '_' + t)) anyDepTaken = true;
          });
        }
        if (depRel === 'after') {
          var unit = med.dependsUnit || 'minutes';
          var amt = med.dependsMin != null ? Number(med.dependsMin) : 30;
          if (unit === 'days') {
            var lastDep = findLastTakenDate(med.dependsOn, currentDate);
            if (!lastDep) {
              locked = true;
              lockMsg = 'Първо вземи ' + (depMed ? depMed.name : 'другото');
            } else {
              var waitDays = amt;
              var unlock = new Date(lastDep);
              unlock.setDate(unlock.getDate() + waitDays);
              unlock.setHours(0,0,0,0);
              var today0 = new Date(currentDate);
              today0.setHours(0,0,0,0);
              if (today0 < unlock) {
                locked = true;
                var left = Math.ceil((unlock - today0) / 86400000);
                lockMsg = (depMed ? depMed.name : 'Другото') + ' · още ' + left + ' дн. (след ' + amt + ' дни)';
              } else {
                lockMsg = amt + ' дни след ' + (depMed ? depMed.name : '');
              }
            }
          } else if (!anyDepTaken) {
            locked = true;
            lockMsg = 'Първо вземи ' + (depMed ? depMed.name : 'другото');
          } else {
            var unitLabel = unit === 'hours' ? 'ч' : 'мин';
            lockMsg = amt + ' ' + unitLabel + ' след ' + (depMed ? depMed.name : '');
          }
        } else if (depRel === 'before') {
          // this med should be taken before dependsOn — no lock on this one
          lockMsg = 'Преди ' + (depMed ? depMed.name : 'другото');
        } else if (depRel === 'together') {
          lockMsg = 'Заедно с ' + (depMed ? depMed.name : 'другото');
        }
      }
      // Reverse: someone depends on ME with "before" → they take first, lock me
      if (!isTaken && !locked) {
        activeMeds().forEach(function (other) {
          if (other.dependsOn === med.id && (other.dependsRel || 'after') === 'before') {
            var otherTaken = false;
            (other.times || []).forEach(function (t) {
              if (isLogTaken(dayLog, other.id + '_' + t)) otherTaken = true;
            });
            if (!otherTaken) {
              locked = true;
              lockMsg = 'Първо: ' + other.name + ' (преди това)';
            }
          }
        });
      }

      html += `
        <div class="pill-card bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-100 dark:border-slate-700/80 p-4 flex items-center gap-3.5 ${isTaken ? 'taken' : ''} ${locked ? 'opacity-60' : ''}">
          <div class="flex-1 min-w-0">
            <p class="pill-name font-semibold text-[15px] truncate text-slate-800 dark:text-slate-100">${med.name}</p>
            <p class="text-sm text-slate-400 dark:text-slate-500 mt-0.5 flex flex-wrap gap-x-1.5">
              <span class="text-primary-500 font-medium">${resolveSlotClock(time)}</span>
              ${med.dose ? `<span>· ${med.dose}</span>` : ''}
              ${med.form ? `<span>· ${med.form}</span>` : ''}
              ${condition ? `<span class="text-amber-500 dark:text-amber-400">· ${condition}</span>` : ''}
              ${(isStockTrackingEnabled() && med.stock != null && med.stock !== '') ? `<span class="${Number(med.stock) <= (Number(med.stockLow)||5) ? 'text-red-500 font-medium' : ''}">· ${med.stock} бр.</span>` : ''}
            </p>
            ${locked ? `<p class="text-xs text-violet-500 mt-1">🔒 ${lockMsg}</p>` : ''}
            ${!locked && med.dependsOn && !isTaken ? `<p class="text-xs text-violet-400 mt-1">${lockMsg}</p>` : ''}
            ${skipReason ? `<p class="text-xs text-amber-600 mt-1">Пропуск: ${SKIP_REASON_LABELS[skipReason] || skipReason}</p>` : ''}
            ${note ? `<p class="text-xs text-slate-400 mt-1">${note}</p>` : ''}
          </div>
          <div class="flex flex-col gap-1 flex-shrink-0">
            <button onclick="${locked ? 'void(0)' : `toggleTaken('${med.id}', '${time}')`}"
              class="w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 text-lg
                ${isTaken
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                  : locked
                    ? 'bg-slate-100 dark:bg-slate-700 text-slate-300 cursor-not-allowed'
                    : 'bg-slate-50 dark:bg-slate-700/80 hover:bg-primary-50 dark:hover:bg-primary-900/40 text-slate-300 hover:text-primary-500 border border-slate-100 dark:border-slate-600'}">
              ${isTaken ? '✓' : locked ? '🔒' : ''}
            </button>
            ${(!isTaken && !locked && isSameDay(currentDate, new Date())) ? `<button onclick="markSkipped('${med.id}', '${time}')" class="text-[10px] text-slate-400 hover:text-amber-600 py-0.5" title="Отбележи пропуск">пропуск</button>` : ''}
          </div>
        </div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;
}

let lastCompleteState = false;

function showCompleteToast() {
  const toast = document.getElementById('complete-toast');
  if (!toast) return;
  const gender = profile.gender || 'f';
  const msg = gender === 'm' ? '✨ Браво! Денят е завършен' : '✨ Браво! Денят е завършен';
  // In Bulgarian the phrase is the same, but we can vary slightly:
  toast.querySelector('div').textContent = gender === 'm' ? '✨ Супер! Всичко е взето' : '✨ Браво! Всичко е взето';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

function adjustStock(medId, delta) {
  if (!isStockTrackingEnabled()) return;
  const med = meds.find(m => m.id === medId);
  if (!med || med.stock == null || med.stock === '') return;
  const next = Math.max(0, Number(med.stock) + delta);
  med.stock = next;
  if (firebaseReady) {
    db.collection('users').doc(dataUid()).collection('meds').doc(medId)
      .update({ stock: next }).catch(err => console.warn('stock update', err));
  } else {
    saveLocalData(currentUser.uid, { meds, logs });
  }
}

function toggleMedAdvanced() {
  const el = document.getElementById('med-advanced');
  const btn = document.getElementById('med-advanced-btn');
  if (!el) return;
  const open = el.classList.toggle('hidden') === false;
  // classList.toggle returns boolean: true if class was added
  // we want open when NOT hidden
  const isHidden = el.classList.contains('hidden');
  if (btn) btn.textContent = isHidden ? '▸ Разширени настройки' : '▾ Разширени настройки';
}

function onMedsSearch() {
  renderMeds();
}

let _skipPending = null; // { medId, time, dateStr }

function openSkipModal(medId, time, fromUnmark) {
  _skipPending = { medId: medId, time: time, dateStr: formatDate(currentDate), fromUnmark: !!fromUnmark };
  const med = meds.find(m => m.id === medId);
  const label = document.getElementById('skip-med-label');
  if (label) label.textContent = (med ? med.name : 'Медикамент') + ' · ' + (timeLabel(time) || time);
  const m = document.getElementById('skip-modal');
  if (m) m.classList.remove('hidden');
}

function closeSkipModal(writeSkip) {
  const m = document.getElementById('skip-modal');
  if (m) m.classList.add('hidden');
  // if dismiss without reason and was unchecking taken → just unmark without reason
  if (writeSkip && _skipPending && _skipPending.fromUnmark) {
    applyLogChange(_skipPending.medId, _skipPending.time, { taken: false, reason: null });
  }
  _skipPending = null;
}

function confirmSkip(reason) {
  if (!_skipPending) return;
  const { medId, time } = _skipPending;
  _skipPending = null;
  const m = document.getElementById('skip-modal');
  if (m) m.classList.add('hidden');
  applyLogChange(medId, time, { taken: false, reason: reason });
}

function applyLogChange(medId, time, state) {
  // state: { taken: true } | { taken: false, reason }
  const dateStr = formatDate(currentDate);
  const key = medId + '_' + time;
  const wasTaken = isLogTaken(logs[dateStr] || {}, key);
  const wasComplete = isDayComplete(currentDate);
  const medRef = meds.find(function (m) { return m.id === medId; });
  const memberForLog = (medRef && medRef.memberId) ? medRef.memberId : (currentMemberId || 'self');
  function docIdForMember(mid, ds) {
    if (!mid || mid === 'self') return ds;
    return mid + '__' + ds;
  }

  let value;
  if (state.taken) {
    value = true;
  } else if (state.reason) {
    value = logEntrySkipped(state.reason);
  } else {
    value = null; // delete
  }

  // Optimistic local update (fixes lag / "can't mark" feel for member profiles)
  if (!logs[dateStr]) logs[dateStr] = {};
  if (value === null) delete logs[dateStr][key];
  else logs[dateStr][key] = value;

  if (firebaseReady) {
    const ref = db.collection('users').doc(dataUid()).collection('logs').doc(docIdForMember(memberForLog, dateStr));
    if (value === null) {
      ref.update({ [key]: firebase.firestore.FieldValue.delete() }).catch(function (err) {
        console.warn(err);
        ref.set({ [key]: firebase.firestore.FieldValue.delete() }, { merge: true }).catch(function () {
          // fallback clear
          var o = {}; o[key] = null;
          ref.set(logs[dateStr] || {}, { merge: true });
        });
      });
    } else {
      ref.set({ [key]: value }, { merge: true }).catch(function (err) {
        console.warn('log write', err);
        alert('Не можа да се запише отметката. Провери връзката / Firebase rules.');
      });
    }
    if (wasTaken && !state.taken && !state.skipStock) adjustStock(medId, +1);
    if (!wasTaken && state.taken && !state.skipStock) adjustStock(medId, -1);
    renderToday();
    renderCalendar();
    setTimeout(function () {
      if (!wasComplete && isDayComplete(currentDate)) showCompleteToast();
      if (typeof renderTakenHistory === 'function') renderTakenHistory();
    }, 200);
  } else {
    if (!logs[dateStr]) logs[dateStr] = {};
    if (value === null) delete logs[dateStr][key];
    else logs[dateStr][key] = value;
    if (wasTaken && !state.taken) adjustStock(medId, +1);
    if (!wasTaken && state.taken) adjustStock(medId, -1);
    saveLocalData(currentUser.uid, { meds, logs });
    renderToday();
    renderCalendar();
    if (typeof renderTakenHistory === 'function') renderTakenHistory();
    if (!wasComplete && isDayComplete(currentDate)) showCompleteToast();
  }
}

function toggleTaken(medId, time, opts) {
  opts = opts || {};
  const dateStr = formatDate(currentDate);
  const key = medId + '_' + time;
  const current = isLogTaken(logs[dateStr] || {}, key);

  if (current) {
    // Unmarking taken → ask for skip reason (unless silent batch)
    if (opts.silent) {
      applyLogChange(medId, time, { taken: false, reason: null, skipStock: opts.skipStock });
    } else {
      openSkipModal(medId, time, true);
    }
  } else {
    applyLogChange(medId, time, { taken: true, skipStock: opts.skipStock });
  }
}

function markSkipped(medId, time) {
  openSkipModal(medId, time, false);
}

function takeAllForSlot(timeKey) {
  const dayMeds = getMedsForDate(currentDate);
  const dateStr = formatDate(currentDate);
  const dayLog = logs[dateStr] || {};
  const wasComplete = isDayComplete(currentDate);
  let count = 0;

  dayMeds.forEach(med => {
    if (!(med.times || []).includes(timeKey)) return;
    const key = med.id + '_' + timeKey;
    if (isLogTaken(dayLog, key)) return;
    // skip locked by dependency
    if (med.dependsOn) {
      const depMed = meds.find(m => m.id === med.dependsOn);
      let anyDep = false;
      if (depMed) {
        (depMed.times || []).forEach(t => { if (isLogTaken(dayLog, depMed.id + '_' + t)) anyDep = true; });
      }
      if (!anyDep) return;
    }
    toggleTaken(med.id, timeKey, { silent: true });
    count++;
  });

  setTimeout(() => {
    renderToday();
    renderCalendar();
    if (count > 0 && !wasComplete && isDayComplete(currentDate)) showCompleteToast();
  }, 400);
}

// ==================== MEDS CRUD ====================
function daysRemaining(med) {
  if (!med.endDate) return null;
  const end = parseLocalDate(med.endDate);
  if (!end) return null;
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((end - today) / (1000 * 60 * 60 * 24));
  return diff;
}

function fillDependsOnSelect(excludeId) {
  const sel = document.getElementById('med-depends-on');
  if (!sel) return;
  sel.innerHTML = '<option value="">Няма</option>';
  meds.forEach(m => {
    if (m.id === excludeId) return;
    if (m.archived === true) return;
    if (!medBelongsToCurrent(m)) return;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name + (m.active === false ? ' (пауза)' : '');
    sel.appendChild(opt);
  });
}

function renderMeds() {
  const list = document.getElementById('meds-list');
  const empty = document.getElementById('meds-empty');
  if (!list) return;

  const sub = window._medsSubTab || 'active';
  const activeBtn = document.getElementById('meds-sub-active');
  const archiveBtn = document.getElementById('meds-sub-archive');
  if (activeBtn && archiveBtn) {
    if (sub === 'active') {
      activeBtn.className = 'flex-1 py-2 rounded-lg text-sm font-semibold bg-white dark:bg-slate-700 shadow-sm text-primary-600';
      archiveBtn.className = 'flex-1 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300';
    } else {
      archiveBtn.className = 'flex-1 py-2 rounded-lg text-sm font-semibold bg-white dark:bg-slate-700 shadow-sm text-primary-600';
      activeBtn.className = 'flex-1 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300';
    }
  }

  let filtered = meds.filter(m => medBelongsToCurrent(m) && (sub === 'archive' ? m.archived === true : m.archived !== true));
  const q = (document.getElementById('meds-search') && document.getElementById('meds-search').value || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(m => {
      const hay = [m.name, m.dose, m.form, m.note].filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  if (filtered.length === 0) {
    list.innerHTML = '';
    if (empty) {
      empty.classList.remove('hidden');
      const t = document.getElementById('meds-empty-text');
      const b = document.getElementById('meds-empty-btn');
      if (sub === 'archive') {
        if (t) t.textContent = 'Архивът е празен';
        if (b) b.classList.add('hidden');
      } else {
        if (t) t.textContent = 'Все още нямаш добавени медикаменти';
        if (b) { b.classList.remove('hidden'); b.textContent = 'Добави първия'; }
      }
    }
    return;
  }
  if (empty) empty.classList.add('hidden');

  list.innerHTML = filtered.map(med => {
    const times = (med.times || []).map(t => timeLabelWithClock(t)).join(', ');
    const freqMap = {
      daily: 'Всеки ден',
      every_other: 'През ден',
      specific_days: 'Конкретни дни'
    };
    const condition = CONDITION_LABELS[med.condition] || '';
    const rem = daysRemaining(med);
    let remHtml = '';
    if (rem !== null && med.archived !== true) {
      if (rem < 0) remHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 text-xs">Курсът приключи</span>`;
      else if (rem === 0) remHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 text-xs font-medium">Последен ден</span>`;
      else if (rem <= 3) remHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 text-xs font-medium">Остават ${rem} дни</span>`;
      else remHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 text-xs">Остават ${rem} дни</span>`;
    }
    const depMed = med.dependsOn ? meds.find(m => m.id === med.dependsOn) : null;
    const depHtml = depMed
      ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs">${DEPENDS_REL_LABELS[med.dependsRel || 'after'] || ''} ${depMed.name}${(med.dependsRel || 'after') === 'after' ? ' (' + (med.dependsMin || 30) + ' ' + ({minutes:'мин',hours:'ч',days:'дни'}[med.dependsUnit||'minutes']||'мин') + ')' : ''}</span>`
      : '';

    const paused = med.active === false && med.archived !== true;
    const archived = med.archived === true;
    const stockOn = typeof isStockTrackingEnabled === 'function' && isStockTrackingEnabled();
    const stockHtml = (stockOn && med.stock != null && med.stock !== '')
      ? '<span class="inline-flex items-center px-2 py-0.5 rounded-md ' + (Number(med.stock) <= (Number(med.stockLow)||5) ? 'bg-red-50 text-red-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300') + ' text-xs">' + med.stock + ' бр.</span>'
      : '';

    let statusBadge = '';
    if (archived) statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs font-medium">📦 Архив</span>';
    else if (paused) statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 text-xs font-medium">⏸ Пауза</span>';
    else statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 text-xs font-medium">▶ Активен</span>';

    let actions = '';
    if (archived) {
      actions = `
        <button onclick="restoreMed('${med.id}')" class="p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-slate-400 hover:text-emerald-500 text-sm" title="Активирай отново">▶</button>
        <button onclick="editMed('${med.id}')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-primary-500" title="Редактирай">✏️</button>
        <button onclick="deleteMedPermanently('${med.id}')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500" title="Изтрий завинаги">🗑️</button>`;
    } else {
      actions = `
        <button onclick="toggleMedActive('${med.id}')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-primary-500 text-sm" title="${paused ? 'Продължи' : 'Пауза'}">${paused ? '▶' : '⏸'}</button>
        <button onclick="editMed('${med.id}')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-primary-500" title="Редактирай">✏️</button>
        <button onclick="archiveMed('${med.id}')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-amber-600 text-sm" title="Деактивирай (архив)">📦</button>`;
    }

    return `
      <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 ${paused || archived ? 'opacity-75' : ''}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="font-semibold text-lg">${med.name}</p>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              ${med.dose || ''} ${med.form ? '· ' + med.form : ''}
            </p>
            <div class="flex flex-wrap gap-1.5 mt-2">
              ${statusBadge}
              <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-medium">${times}</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs">${freqMap[med.frequency] || 'Всеки ден'}</span>
              ${condition ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs">${condition}</span>` : ''}
              ${remHtml}
              ${depHtml}
              ${med.notify ? '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-xs">🔔 ' + (med.notifyBefore || 15) + ' мин</span>' : ''}
              ${stockHtml}
            </div>
            ${med.note ? `<p class="text-xs text-slate-400 mt-2">${med.note}</p>` : ''}
          </div>
          <div class="flex flex-col gap-1">${actions}</div>
        </div>
      </div>`;
  }).join('');
}

function setMedsSubTab(sub) {
  window._medsSubTab = sub;
  renderMeds();
}

function archiveMed(id) {
  if (!confirm('Деактивирай медикамента? Ще отиде в Архив. Историята се запазва.')) return;
  const med = meds.find(m => m.id === id);
  if (!med) return;
  med.archived = true;
  med.active = false;
  med.archivedAt = new Date().toISOString();
  if (firebaseReady) {
    db.collection('users').doc(dataUid()).collection('meds').doc(id)
      .update({ archived: true, active: false, archivedAt: med.archivedAt })
      .then(() => { renderMeds(); renderToday(); renderCalendar(); renderTakenHistory(); })
      .catch(err => alert('Грешка: ' + err.message));
  } else {
    saveLocalData(currentUser.uid, { meds, logs });
    renderMeds();
    renderToday();
    renderCalendar();
    if (typeof renderTakenHistory === 'function') renderTakenHistory();
  }
}

function restoreMed(id) {
  const med = meds.find(m => m.id === id);
  if (!med) return;
  med.archived = false;
  med.active = true;
  med.archivedAt = null;
  med.resumedAt = new Date().toISOString();
  // optional: bump start to today so it doesn't flood past calendar — user may want old start
  // keep startDate as is for history continuity of schedule rules going forward is ok
  if (firebaseReady) {
    db.collection('users').doc(dataUid()).collection('meds').doc(id)
      .update({ archived: false, active: true, archivedAt: null, resumedAt: med.resumedAt })
      .then(() => {
        window._medsSubTab = 'active';
        renderMeds();
        renderToday();
        renderCalendar();
      })
      .catch(err => alert('Грешка: ' + err.message));
  } else {
    saveLocalData(currentUser.uid, { meds, logs });
    window._medsSubTab = 'active';
    renderMeds();
    renderToday();
    renderCalendar();
  }
}

function deleteMedPermanently(id) {
  if (!confirm('Изтрий завинаги? Историята в логовете ще остане, но името може да се покаже като „премахнат медикамент“.')) return;
  if (firebaseReady) {
    db.collection('users').doc(dataUid()).collection('meds').doc(id).delete()
      .catch(err => alert('Грешка: ' + err.message));
  } else {
    meds = meds.filter(m => m.id !== id);
    saveLocalData(currentUser.uid, { meds, logs });
    renderMeds();
    renderToday();
    renderCalendar();
  }
}

function toggleMedActive(id) {
  const med = meds.find(m => m.id === id);
  if (!med) return;
  const next = med.active === false; // if paused -> activate true
  const active = next ? true : false;
  // if currently active (undefined or true), pause
  const newActive = (med.active === false) ? true : false;

  med.active = newActive;
  if (newActive) {
    med.pausedAt = null;
    med.resumedAt = new Date().toISOString();
  } else {
    med.pausedAt = new Date().toISOString();
  }

  if (firebaseReady) {
    db.collection('users').doc(dataUid()).collection('meds').doc(id)
      .update({ active: newActive, pausedAt: med.pausedAt || null, resumedAt: med.resumedAt || null })
      .then(() => { renderMeds(); renderToday(); renderCalendar(); })
      .catch(err => alert('Грешка: ' + err.message));
  } else {
    saveLocalData(currentUser.uid, { meds, logs });
    renderMeds();
    renderToday();
    renderCalendar();
  }
}

function toggleStockFields() {
  var on = document.getElementById('med-track-stock');
  var fields = document.getElementById('stock-fields');
  if (!on || !fields) return;
  fields.classList.toggle('hidden', !on.checked);
  if (on.checked) {
    var low = document.getElementById('med-stock-low');
    if (low && !low.value) low.value = '5';
  }
}

function openAddMedModal() {
  editingMedId = null;
  document.getElementById('modal-title').textContent = 'Нов медикамент';
  var adv = document.getElementById('med-advanced');
  if (adv) adv.classList.add('hidden');
  var advBtn = document.getElementById('med-advanced-btn');
  if (advBtn) advBtn.textContent = '▸ Разширени настройки';
  var pauseBox = document.getElementById('med-pause-box');
  if (pauseBox) pauseBox.classList.add('hidden');
  var act = document.getElementById('med-active');
  if (act) act.checked = true;
  document.getElementById('med-name').value = '';
  document.getElementById('med-dose').value = '';
  document.getElementById('med-form').value = 'Таблетка';
  var track = document.getElementById('med-track-stock');
  if (track) track.checked = false;
  var ms = document.getElementById('med-stock'); if (ms) ms.value = '';
  var msl = document.getElementById('med-stock-low'); if (msl) msl.value = '5';
  toggleStockFields();
  applyStockToggle();
  document.getElementById('med-condition').value = 'any';
  document.getElementById('med-frequency').value = 'daily';
  var iv = document.getElementById('med-interval-value');
  if (iv) iv.value = '3';
  var iu = document.getElementById('med-interval-unit');
  if (iu) iu.value = 'months';
  var sc = document.getElementById('med-show-countdown');
  if (sc) sc.checked = false;
  var so = document.getElementById('med-show-on-owner');
  if (so) so.checked = false;
  if (typeof updateShowOnOwnerVisibility === 'function') updateShowOnOwnerVisibility();
  document.getElementById('med-note').value = '';
  document.getElementById('med-start').value = localDateInputValue(new Date());
  document.getElementById('med-end').value = '';
  document.getElementById('med-duration').value = 'lifelong';
  document.getElementById('med-duration-value').value = '';
  document.getElementById('med-depends-min').value = '30';
  var du0 = document.getElementById('med-depends-unit');
  if (du0) du0.value = 'minutes';
  var relN = document.getElementById('med-depends-rel');
  if (relN) relN.value = 'after';
  updateDependsMinVisibility();
  var nEl = document.getElementById('med-notify');
  if (nEl) nEl.checked = false;
  var nbEl = document.getElementById('med-notify-before');
  if (nbEl) nbEl.value = '15';
  document.querySelectorAll('.time-check').forEach(c => c.checked = false);
  document.querySelectorAll('.day-check').forEach(c => c.checked = false);
  _customTimes = [];
  renderCustomTimesList();
  var cti = document.getElementById('custom-time-input');
  if (cti) cti.value = '08:00';
  fillDependsOnSelect(null);
  document.getElementById('med-depends-on').value = '';
  toggleFrequencyOptions();
  toggleDurationOptions();
  var relSel = document.getElementById('med-depends-rel');
  if (relSel) relSel.onchange = updateDependsMinVisibility;
  document.getElementById('med-modal').classList.remove('hidden');
}

function editMed(id) {
  const med = meds.find(m => m.id === id);
  if (!med) return;

  editingMedId = id;
  document.getElementById('modal-title').textContent = 'Редактирай медикамент';
  var adv = document.getElementById('med-advanced');
  if (adv) adv.classList.remove('hidden');
  var advBtn = document.getElementById('med-advanced-btn');
  if (advBtn) advBtn.textContent = '▾ Разширени настройки';
  var pauseBox = document.getElementById('med-pause-box');
  if (pauseBox) pauseBox.classList.remove('hidden');
  var act = document.getElementById('med-active');
  if (act) act.checked = med.active !== false;
  document.getElementById('med-name').value = med.name;
  document.getElementById('med-dose').value = med.dose || '';
  document.getElementById('med-form').value = med.form || 'Таблетка';
  var hasStock = med.stock != null && med.stock !== '';
  var track2 = document.getElementById('med-track-stock');
  if (track2) track2.checked = hasStock;
  var ms2 = document.getElementById('med-stock'); if (ms2) ms2.value = hasStock ? med.stock : '';
  var msl2 = document.getElementById('med-stock-low'); if (msl2) msl2.value = (med.stockLow != null) ? med.stockLow : 5;
  toggleStockFields();
  document.getElementById('med-condition').value = med.condition || 'any';
  document.getElementById('med-frequency').value = med.frequency || 'daily';
  var iv2 = document.getElementById('med-interval-value');
  if (iv2) iv2.value = med.intervalValue || 3;
  var iu2 = document.getElementById('med-interval-unit');
  if (iu2) iu2.value = med.intervalUnit || 'months';
  var sc2 = document.getElementById('med-show-countdown');
  if (sc2) sc2.checked = !!med.showCountdown;
  var so2 = document.getElementById('med-show-on-owner');
  if (so2) so2.checked = !!med.showOnOwnerToday;
  if (typeof updateShowOnOwnerVisibility === 'function') updateShowOnOwnerVisibility();
  document.getElementById('med-note').value = med.note || '';
  document.getElementById('med-start').value = med.startDate || '';
  document.getElementById('med-end').value = med.endDate || '';
  document.getElementById('med-duration').value = med.durationType || (med.endDate ? 'until' : 'lifelong');
  document.getElementById('med-duration-value').value = med.durationValue || '';
  document.getElementById('med-depends-min').value = med.dependsMin || 30;
  var du = document.getElementById('med-depends-unit');
  if (du) du.value = med.dependsUnit || 'minutes';
  var relEl = document.getElementById('med-depends-rel');
  if (relEl) relEl.value = med.dependsRel || 'after';
  updateDependsMinVisibility();
  var nEl2 = document.getElementById('med-notify');
  if (nEl2) nEl2.checked = !!med.notify;
  var nbEl2 = document.getElementById('med-notify-before');
  if (nbEl2) nbEl2.value = String(med.notifyBefore || 15);

  var medTimes = med.times || [];
  document.querySelectorAll('.time-check').forEach(c => {
    c.checked = medTimes.includes(c.value);
  });
  _customTimes = medTimes.filter(function (t) { return isClockTime(t); }).map(normalizeClock);
  _customTimes.sort();
  renderCustomTimesList();
  document.querySelectorAll('.day-check').forEach(c => {
    c.checked = (med.days || []).includes(parseInt(c.value));
  });
  fillDependsOnSelect(id);
  document.getElementById('med-depends-on').value = med.dependsOn || '';
  toggleFrequencyOptions();
  toggleDurationOptions();
  document.getElementById('med-modal').classList.remove('hidden');
}

function closeMedModal() {
  document.getElementById('med-modal').classList.add('hidden');
}

function updateShowOnOwnerVisibility() {
  var wrap = document.getElementById('med-show-on-owner-wrap');
  if (!wrap) return;
  var show = currentMemberId && currentMemberId !== 'self' && !viewingRemoteUid;
  wrap.classList.toggle('hidden', !show);
}

function toggleFrequencyOptions() {
  const freq = document.getElementById('med-frequency').value;
  var sd = document.getElementById('specific-days-options');
  var io = document.getElementById('interval-options');
  if (sd) sd.classList.toggle('hidden', freq !== 'specific_days');
  if (io) io.classList.toggle('hidden', freq !== 'interval');
}

function toggleDurationOptions() {
  const dur = document.getElementById('med-duration').value;
  document.getElementById('duration-number-options').classList.toggle('hidden', !['days','weeks','months'].includes(dur));
  document.getElementById('duration-until-options').classList.toggle('hidden', dur !== 'until');
}

function saveMed() {
  const name = document.getElementById('med-name').value.trim();
  if (!name) {
    alert('Моля въведи име');
    return;
  }

  const times = getSelectedTimes();
  if (times.length === 0) {
    alert('Избери поне едно време на деня');
    return;
  }

  const frequency = document.getElementById('med-frequency').value;
  let days = [];
  if (frequency === 'specific_days') {
    days = Array.from(document.querySelectorAll('.day-check:checked')).map(c => parseInt(c.value));
    if (days.length === 0) {
      alert('Избери поне един ден');
      return;
    }
  }

  // Duration → calculate endDate
  let startDate = document.getElementById('med-start').value || null;
  let endDate = null;
  const durationType = document.getElementById('med-duration').value;
  const durationValue = parseInt(document.getElementById('med-duration-value').value) || 0;

  if (!startDate) {
    startDate = localDateInputValue(new Date()); // today by default (local)
  }
  // Never allow scheduling before "today" when creating new med without explicit past start
  // (user can still set start in the future via the field)


  if (durationType === 'until') {
    endDate = document.getElementById('med-end').value || null;
  } else if (durationType === 'days' && durationValue > 0) {
    const s = parseLocalDate(startDate) || new Date();
    s.setDate(s.getDate() + durationValue - 1);
    endDate = formatDate(s);
  } else if (durationType === 'weeks' && durationValue > 0) {
    const s = parseLocalDate(startDate) || new Date();
    s.setDate(s.getDate() + (durationValue * 7) - 1);
    endDate = formatDate(s);
  } else if (durationType === 'months' && durationValue > 0) {
    const s = parseLocalDate(startDate) || new Date();
    s.setMonth(s.getMonth() + durationValue);
    s.setDate(s.getDate() - 1);
    endDate = formatDate(s);
  }
  // lifelong → endDate stays null

  const dependsOn = document.getElementById('med-depends-on').value || null;
  const dependsMin = parseInt(document.getElementById('med-depends-min').value) || 30;
  const notifyEl = document.getElementById('med-notify');
  const notifyBeforeEl = document.getElementById('med-notify-before');

  const medData = {
    name,
    dose: document.getElementById('med-dose').value.trim(),
    form: document.getElementById('med-form').value,
    stock: (function(){
      var t = document.getElementById('med-track-stock');
      if (!t || !t.checked) return null;
      var v = document.getElementById('med-stock');
      if (!v || v.value === '') return 0;
      return parseInt(v.value, 10);
    })(),
    stockLow: (function(){
      var t = document.getElementById('med-track-stock');
      if (!t || !t.checked) return null;
      var v = document.getElementById('med-stock-low');
      if (!v || v.value === '') return 5;
      return parseInt(v.value, 10);
    })(),
    times,
    condition: document.getElementById('med-condition').value,
    frequency,
    days,
    intervalValue: frequency === 'interval' ? (parseInt((document.getElementById('med-interval-value') || {}).value, 10) || 1) : null,
    intervalUnit: frequency === 'interval' ? ((document.getElementById('med-interval-unit') || {}).value || 'months') : null,
    showCountdown: !!(document.getElementById('med-show-countdown') || {}).checked,
    showOnOwnerToday: !!(document.getElementById('med-show-on-owner') || {}).checked,
    startDate,
    endDate,
    durationType,
    durationValue: durationValue || null,
    dependsOn,
    dependsRel: dependsOn ? ((document.getElementById('med-depends-rel') || {}).value || 'after') : null,
    dependsMin: dependsOn ? dependsMin : null,
    dependsUnit: dependsOn ? ((document.getElementById('med-depends-unit') || {}).value || 'minutes') : null,
    memberId: currentMemberId || 'self',
    notify: notifyEl ? !!notifyEl.checked : false,
    notifyBefore: notifyBeforeEl ? parseInt(notifyBeforeEl.value) || 15 : 15,
    active: (function(){
      if (!editingMedId) return true;
      var a = document.getElementById('med-active');
      return a ? !!a.checked : true;
    })(),
    note: document.getElementById('med-note').value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (medData.active === false) medData.pausedAt = new Date().toISOString();
  if (medData.active === true && editingMedId) medData.resumedAt = new Date().toISOString();

  var conflicts = checkConditionConflicts(Object.assign({ id: editingMedId }, medData));
  if (conflicts && conflicts.length) {
    if (!confirm('Възможен конфликт с храна/условия със:\n• ' + conflicts.join('\n• ') + '\n\nЗапази въпреки това?')) return;
  }

  if (firebaseReady) {
    if (editingMedId) {
      db.collection('users').doc(dataUid()).collection('meds').doc(editingMedId)
        .update(medData)
        .then(() => { closeMedModal(); scheduleNotifications(); })
        .catch(err => alert('Грешка: ' + err.message));
    } else {
      medData.createdAt = new Date().toISOString();
      db.collection('users').doc(dataUid()).collection('meds').add(medData)
        .then(() => { closeMedModal(); scheduleNotifications(); })
        .catch(err => alert('Грешка: ' + err.message));
    }
  } else {
    if (editingMedId) {
      const idx = meds.findIndex(m => m.id === editingMedId);
      if (idx !== -1) {
        meds[idx] = { ...meds[idx], ...medData };
      }
    } else {
      medData.id = 'm_' + Date.now();
      medData.createdAt = new Date().toISOString();
      meds.push(medData);
    }
    saveLocalData(currentUser.uid, { meds, logs });
    closeMedModal();
    renderMeds();
    renderToday();
    renderCalendar();
    scheduleNotifications();
  }
}

function deleteMed(id) {
  // Back-compat: deactivating instead of hard delete
  archiveMed(id);
}

// ==================== CALENDAR ====================
function changeMonth(delta) {
  calendarMonth.setMonth(calendarMonth.getMonth() + delta);
  renderCalendar();
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const monthNames = ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'];
  document.getElementById('calendar-month').textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  let startDay = firstDay.getDay();
  startDay = startDay === 0 ? 6 : startDay - 1;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let html = '';
  for (let i = 0; i < startDay; i++) {
    html += `<div class="bg-white dark:bg-slate-800 p-2 min-h-[52px]"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = formatDate(date);
    const dayMeds = getMedsForDate(date);
    const dayLog = logs[dateStr] || {};

    let total = 0, taken = 0;
    dayMeds.forEach(med => {
      var times = (med.times && med.times.length) ? med.times : ['morning'];
      times.forEach(t => {
        total++;
        if (isLogTaken(dayLog, med.id + '_' + t)) taken++;
      });
    });

    let statusClass = '';
    let dot = '';
    const showPillDots = localStorage.getItem('pillflow_cal_dots') === '1';

    if (total > 0) {
      if (showPillDots) {
        // One dot per pill dose
        const dots = [];
        dayMeds.forEach(med => {
          (med.times || []).forEach(t => {
            const isTaken = isLogTaken(dayLog, med.id + '_' + t);
            if (isTaken) {
              dots.push('<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>');
            } else if (date <= today) {
              dots.push('<span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>');
            } else {
              dots.push('<span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></span>');
            }
          });
        });
        dot = dots.join('');
        if (taken === total) statusClass = 'bg-emerald-50 dark:bg-emerald-900/20';
        else if (taken > 0) statusClass = 'bg-amber-50 dark:bg-amber-900/20';
        else if (date <= today) statusClass = 'bg-red-50 dark:bg-red-900/10';
      } else {
        // Only background tint, no dots
        if (taken === total) {
          statusClass = 'bg-emerald-50 dark:bg-emerald-900/20';
        } else if (taken > 0) {
          statusClass = 'bg-amber-50 dark:bg-amber-900/20';
        } else if (date <= today) {
          statusClass = 'bg-red-50 dark:bg-red-900/10';
        }
        // future days with meds: no tint
        dot = '';
      }
    }

    const isToday = isSameDay(date, today);
    const isSelected = isSameDay(date, currentDate);

    // Small avatars for other members' meds when viewing "Аз"
    var memberIcons = '';
    if (!viewingRemoteUid && currentMemberId === 'self' && total > 0) {
      var seen = {};
      dayMeds.forEach(function (med) {
        var mid = med.memberId || 'self';
        if (mid === 'self' || seen[mid]) return;
        seen[mid] = true;
        var meta = getMemberMeta(mid);
        memberIcons += '<span class="text-[10px] leading-none" title="' + (meta.name || '') + '">' + (meta.avatar || '🐾') + '</span>';
      });
    }

    html += `
      <div onclick="selectCalendarDay(${year}, ${month}, ${d})"
        class="bg-white dark:bg-slate-800 p-1.5 min-h-[56px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition ${statusClass}
          ${isToday ? 'ring-2 ring-inset ring-primary-500' : ''}
          ${isSelected ? 'bg-primary-50 dark:bg-primary-900/30' : ''}">
        <div class="text-sm font-medium ${isToday ? 'text-primary-600' : ''} flex items-center justify-between gap-0.5">
          <span>${d}</span>
          <span class="flex gap-0.5">${memberIcons}</span>
        </div>
        <div class="mt-1 flex flex-wrap justify-center gap-0.5">${dot}</div>
      </div>`;
  }

  document.getElementById('calendar-grid').innerHTML = html;
}

function selectCalendarDay(year, month, day) {
  currentDate = new Date(year, month, day);
  currentDate.setHours(0, 0, 0, 0);
  renderCalendar();
  renderCalendarDayDetail();
}

/** Open Today tab for the date already selected in the calendar (do not reset to real today) */
function openFullDayFromCalendar() {
  window._preserveCurrentDate = true;
  switchTab('today');
}

function renderCalendarDayDetail() {
  const dayMeds = getMedsForDate(currentDate);
  const detail = document.getElementById('calendar-day-detail');
  const list = document.getElementById('calendar-day-list');
  const summary = document.getElementById('calendar-day-summary');
  document.getElementById('calendar-day-title').textContent = formatDisplayDate(currentDate);

  const dayLog = logs[formatDate(currentDate)] || {};
  let html = '';
  let takenCount = 0, totalCount = 0;
  const takenNames = [];

  dayMeds.forEach(med => {
    var times = (med.times && med.times.length) ? med.times : ['morning'];
    times.forEach(t => {
      totalCount++;
      const isTaken = isLogTaken(dayLog, med.id + '_' + t);
      if (isTaken) {
        takenCount++;
        takenNames.push(med.name + (med.dose ? ' (' + med.dose + ')' : '') + ' · ' + (timeLabel(t) || t));
      }
      const badge = ownerBadgeHtml(med);
      html += `
        <div class="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
          <div class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${isTaken ? 'bg-emerald-500' : 'bg-red-400'}"></div>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-sm truncate">${med.name}${badge}</p>
            <p class="text-xs text-slate-400">${timeLabelWithClock ? timeLabelWithClock(t) : timeLabel(t)}${med.dose ? ' · ' + med.dose : ''}</p>
          </div>
          <span class="text-xs font-medium ${isTaken ? 'text-emerald-500' : 'text-slate-400'}">${isTaken ? 'Взето' : (getLogReason(dayLog, med.id + '_' + t) ? 'Пропуск: ' + (SKIP_REASON_LABELS[getLogReason(dayLog, med.id + '_' + t)] || '') : 'Очаква')}</span>
        </div>`;
    });
  });

  // Also show log entries for meds no longer scheduled that day
  Object.keys(dayLog).forEach(function (key) {
    if (!isLogTaken(dayLog, key) && !(dayLog[key] && typeof dayLog[key] === 'object')) return;
    const parts = key.split('_');
    const medId = parts[0];
    const slot = parts.slice(1).join('_');
    const already = dayMeds.some(m => m.id === medId && (m.times || []).includes(slot));
    if (already) return;
    const med = meds.find(m => m.id === medId);
    const name = med ? med.name : 'Премахнат медикамент';
    takenCount++;
    takenNames.push(name + ' · ' + (timeLabel(slot) || slot));
    html += `
      <div class="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-800 p-3">
        <div class="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-emerald-500"></div>
        <div class="flex-1 min-w-0">
          <p class="font-medium text-sm truncate">${name}</p>
          <p class="text-xs text-slate-400">${timeLabel(slot) || slot}</p>
        </div>
        <span class="text-xs font-medium text-emerald-500">Взето</span>
      </div>`;
  });

  if (summary) {
    if (totalCount === 0 && takenCount === 0) summary.textContent = 'Няма записи за този ден';
    else summary.textContent = takenCount + ' взети' + (totalCount ? ' · ' + totalCount + ' планирани' : '');
  }

  if (!html) {
    list.innerHTML = '<p class="text-sm text-slate-500">Няма медикаменти / записи за този ден</p>';
  } else {
    html += `
      <button onclick="openFullDayFromCalendar()" class="w-full mt-3 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition shadow-md shadow-primary-500/20">
        Отвори пълния ден →
      </button>`;
    list.innerHTML = html;
  }
  detail.classList.remove('hidden');
}

function renderTakenHistory() {
  if (typeof isTakenHistoryEnabled === 'function' && !isTakenHistoryEnabled()) {
    var sec = document.getElementById('taken-history-section');
    if (sec) sec.classList.add('hidden');
    return;
  }
  const el = document.getElementById('taken-history');
  if (!el) return;

  // Collect last 40 taken entries across dates
  const entries = [];
  Object.keys(logs || {}).sort().reverse().forEach(function (dateStr) {
    const dayLog = logs[dateStr] || {};
    Object.keys(dayLog).forEach(function (key) {
      if (!isLogTaken(dayLog, key) && !(dayLog[key] && typeof dayLog[key] === 'object')) return;
      const parts = key.split('_');
      const medId = parts[0];
      const slot = parts.slice(1).join('_');
      const med = meds.find(m => m.id === medId);
      entries.push({
        dateStr: dateStr,
        name: med ? med.name : 'Премахнат медикамент',
        dose: med ? (med.dose || '') : '',
        slot: timeLabel(slot) || slot
      });
    });
  });

  if (entries.length === 0) {
    el.innerHTML = '<p class="text-slate-400 text-sm">Все още няма отбелязани приеми</p>';
    return;
  }

  el.innerHTML = entries.slice(0, 40).map(function (e) {
    let display = e.dateStr;
    try {
      const p = parseLocalDate(e.dateStr);
      if (p) display = p.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', weekday: 'short' });
    } catch (err) {}
    return `<div class="flex items-start gap-2 py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <span class="text-emerald-500 mt-0.5">✓</span>
      <div class="min-w-0 flex-1">
        <p class="font-medium truncate">${e.name}${e.dose ? ' <span class="text-slate-400 font-normal">· ' + e.dose + '</span>' : ''}</p>
        <p class="text-xs text-slate-400">${display} · ${e.slot}</p>
      </div>
    </div>`;
  }).join('');
}

// ==================== WEEKLY REVIEW ====================
function renderWeekReview() {
  const el = document.getElementById('week-review');
  if (!el) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Monday–Sunday of the current week (Mon = start)
  const day = today.getDay(); // 0 Sun .. 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  var sub = document.getElementById('week-review-sub');
  if (sub) {
    var sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sub.textContent = 'Пон ' + monday.getDate() + ' – Нед ' + sunday.getDate() + '.' + (sunday.getMonth() + 1);
  }

  let perfect = 0, partial = 0, missed = 0, empty = 0;
  const days = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dayMeds = getMedsForDate(d);
    const dateStr = formatDate(d);
    const dayLog = logs[dateStr] || {};
    let total = 0, taken = 0;
    dayMeds.forEach(med => {
      var times = (med.times && med.times.length) ? med.times : ['morning'];
      times.forEach(t => {
        total++;
        if (isLogTaken(dayLog, med.id + '_' + t)) taken++;
      });
    });
    let status = 'empty';
    if (total === 0) empty++;
    else if (taken === total) { perfect++; status = 'perfect'; }
    else if (taken > 0) { partial++; status = 'partial'; }
    else if (d <= today) { missed++; status = 'missed'; }

    const label = d.toLocaleDateString('bg-BG', { weekday: 'short', day: 'numeric' });
    const colors = {
      perfect: 'bg-emerald-500',
      partial: 'bg-amber-400',
      missed: 'bg-red-400',
      empty: 'bg-slate-200 dark:bg-slate-600'
    };
    const isTodayCell = isSameDay(d, today);
    days.push(`<div class="flex flex-col items-center gap-1">
      <div class="w-8 h-8 rounded-full ${colors[status]} flex items-center justify-center text-white text-xs font-bold ${isTodayCell ? 'ring-2 ring-primary-400 ring-offset-1 dark:ring-offset-slate-900' : ''}">${taken || ''}</div>
      <span class="text-[10px] ${isTodayCell ? 'text-primary-500 font-semibold' : 'text-slate-400'}">${label}</span>
    </div>`);
  }

  el.innerHTML = `
    <div class="flex justify-between mb-3">${days.join('')}</div>
    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
        <p class="text-lg font-bold text-emerald-600">${perfect}</p>
        <p class="text-[10px] text-slate-500">перфектни</p>
      </div>
      <div class="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/20">
        <p class="text-lg font-bold text-amber-600">${partial}</p>
        <p class="text-[10px] text-slate-500">частични</p>
      </div>
      <div class="p-2 rounded-xl bg-red-50 dark:bg-red-900/20">
        <p class="text-lg font-bold text-red-500">${missed}</p>
        <p class="text-[10px] text-slate-500">пропуснати</p>
      </div>
    </div>
    <p class="text-xs text-slate-400 mt-2 text-center">Последните 7 дни</p>
  `;
}

// ==================== NOTIFICATIONS ====================
function applyNotifToggle() {
  const on = localStorage.getItem('pillflow_notif') === '1';
  const knob = document.getElementById('notif-knob');
  const btn = document.getElementById('notif-toggle');
  if (knob && btn) {
    if (on) {
      knob.style.transform = 'translateX(20px)';
      btn.classList.add('bg-primary-500');
      btn.classList.remove('bg-slate-200', 'dark:bg-slate-600');
    } else {
      knob.style.transform = 'translateX(0)';
      btn.classList.remove('bg-primary-500');
      btn.classList.add('bg-slate-200');
    }
  }
}

function loadNotifTimes() {
  const times = JSON.parse(localStorage.getItem('pillflow_notif_times') || '{}');
  if (document.getElementById('notif-morning')) {
    document.getElementById('notif-morning').value = times.morning || '08:00';
    document.getElementById('notif-noon').value = times.noon || '13:00';
    document.getElementById('notif-evening').value = times.evening || '19:00';
    document.getElementById('notif-night').value = times.night || '22:00';
  }
}

function saveNotifTimes() {
  const times = {
    morning: document.getElementById('notif-morning').value || '08:00',
    noon: document.getElementById('notif-noon').value || '13:00',
    evening: document.getElementById('notif-evening').value || '19:00',
    night: document.getElementById('notif-night').value || '22:00'
  };
  localStorage.setItem('pillflow_notif_times', JSON.stringify(times));
  scheduleNotifications();
  alert('Часовете са запазени');
}

async function toggleNotifications() {
  const on = localStorage.getItem('pillflow_notif') === '1';
  if (!on) {
    if (!('Notification' in window)) {
      alert('Браузърът не поддържа известия');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      alert('Нужно е разрешение за известия');
      return;
    }
    localStorage.setItem('pillflow_notif', '1');
    scheduleNotifications();
  } else {
    localStorage.setItem('pillflow_notif', '0');
    // clear scheduled
    if (window._notifTimers) {
      window._notifTimers.forEach(t => clearTimeout(t));
      window._notifTimers = [];
    }
  }
  applyNotifToggle();
}


function showPillNotification(title, body, tag) {
  var opts = {
    body: body,
    icon: 'icon-192.png',
    tag: tag || 'pillflow',
    requireInteraction: true,
    data: { title: title, body: body, tag: tag },
    actions: [
      { action: 'snooze10', title: 'Снууз 10 мин' },
      { action: 'snooze30', title: 'Снууз 30 мин' }
    ]
  };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(function (reg) {
      // actions only work with service worker notifications
      return reg.showNotification(title, opts);
    }).catch(function () {
      new Notification(title, { body: body, icon: 'icon-192.png', tag: tag });
    });
  } else {
    try { new Notification(title, { body: body, icon: 'icon-192.png', tag: tag }); } catch (e) {}
  }
}

function scheduleSnooze(mins, title, body, tag) {
  setTimeout(function () {
    showPillNotification(title || 'PillFlow', body || 'Напомняне за хапче', tag || 'pillflow-snooze');
  }, mins * 60 * 1000);
}

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', function (event) {
    var d = event.data || {};
    if (d.type === 'PILLFLOW_SNOOZE') {
      scheduleSnooze(d.mins || 10, d.title, d.body, d.tag);
    }
  });
}

function scheduleNotifications() {
  if (localStorage.getItem('pillflow_notif') !== '1') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  if (window._notifTimers) window._notifTimers.forEach(function (t) { clearTimeout(t); });
  window._notifTimers = [];

  var times = JSON.parse(localStorage.getItem('pillflow_notif_times') || '{}');
  var slots = {
    morning: times.morning || '08:00',
    noon: times.noon || '13:00',
    evening: times.evening || '19:00',
    night: times.night || '22:00'
  };

  var now = new Date();
  var todayMeds = (typeof getMedsForDate === 'function') ? getMedsForDate(now) : (meds || []);

  todayMeds.forEach(function (med) {
    if (!med.notify) return;
    var before = med.notifyBefore || 15;
    (med.times || []).forEach(function (slot) {
      var hhmm = isClockTime(slot) ? normalizeClock(slot) : slots[slot];
      if (!hhmm) return;
      var parts = hhmm.split(':').map(Number);
      var target = new Date();
      target.setHours(parts[0], parts[1], 0, 0);
      target.setMinutes(target.getMinutes() - before);
      if (target <= now) target.setDate(target.getDate() + 1);
      var delay = target - now;
      if (delay < 0 || delay > 48 * 3600 * 1000) return;
      var timer = setTimeout(function () {
        var d = new Date();
        var dateStr = formatDate(d);
        var dayLog = logs[dateStr] || {};
        if (isLogTaken(dayLog, med.id + '_' + slot)) {
          scheduleNotifications();
          return;
        }
        var title = 'PillFlow – ' + med.name;
        var body = 'След ' + before + ' мин: ' + (timeLabel(slot) || slot) + (med.dose ? ' · ' + med.dose : '');
        var tag = 'pillflow-' + med.id + '-' + slot;
        showPillNotification(title, body, tag);
        scheduleNotifications();
      }, delay);
      window._notifTimers.push(timer);
    });
  });
}


// ==================== SETTINGS ====================
function toggleDarkMode() {
  // Quick toggle light ↔ dark (header button)
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('pillflow_theme', isDark ? 'light' : 'dark');
  applyTheme();
}

function exportData() {
  const data = { meds, logs };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pillflow_${currentUser.displayName || 'user'}_${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function clearAllData() {
  if (!confirm('Това ще изтрие ВСИЧКИ твои медикаменти и история. Сигурен ли си?')) return;
  if (!confirm('Наистина ли? Това действие е необратимо.')) return;

  if (firebaseReady) {
    const batch = db.batch();
    meds.forEach(m => {
      batch.delete(db.collection('users').doc(dataUid()).collection('meds').doc(m.id));
    });
    Object.keys(logs).forEach(dateStr => {
      batch.delete(db.collection('users').doc(currentUser.uid).collection('logs').doc(dateStr));
    });
    batch.commit().then(() => alert('Данните са изтрити'));
  } else {
    meds = [];
    logs = {};
    saveLocalData(currentUser.uid, { meds, logs });
    renderMeds();
    renderToday();
    renderCalendar();
    alert('Данните са изтрити');
  }
}



// ==================== TRENDS + DOCTOR REPORT ====================
function renderTrendsChart() {
  const chart = document.getElementById('trends-chart');
  const labels = document.getElementById('trends-labels');
  if (!chart) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let bars = '';
  let labs = '';

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayMeds = getMedsForDate(d);
    const dayLog = logs[formatDate(d)] || {};
    let total = 0, taken = 0;
    dayMeds.forEach(med => {
      var times = (med.times && med.times.length) ? med.times : ['morning'];
      times.forEach(t => {
        total++;
        if (isLogTaken(dayLog, med.id + '_' + t)) taken++;
      });
    });
    const pct = total === 0 ? 0 : Math.round((taken / total) * 100);
    const h = total === 0 ? 8 : Math.max(8, Math.round((pct / 100) * 100));
    let color = 'bg-slate-200 dark:bg-slate-600';
    if (total > 0) {
      if (pct === 100) color = 'bg-emerald-500';
      else if (pct >= 50) color = 'bg-amber-400';
      else color = 'bg-red-400';
    }
    const label = d.toLocaleDateString('bg-BG', { weekday: 'narrow' });
    bars += `<div class="flex-1 flex flex-col items-center justify-end h-full">
      <span class="text-[9px] text-slate-400 mb-0.5">${total ? pct + '%' : '—'}</span>
      <div class="w-full ${color} rounded-t-md transition-all" style="height:${h}%"></div>
    </div>`;
    labs += `<div class="flex-1 text-center text-[10px] text-slate-400">${label}</div>`;
  }
  chart.innerHTML = bars;
  if (labels) labels.innerHTML = labs;
}

function generateDoctorReport() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const name = (profile && profile.name) || (currentUser && currentUser.displayName) || 'Пациент';
  const days = [];
  let totalDoses = 0, takenDoses = 0;

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayMeds = getMedsForDate(d);
    const dayLog = logs[formatDate(d)] || {};
    let t = 0, tk = 0;
    const lines = [];
    dayMeds.forEach(med => {
      (med.times || []).forEach(slot => {
        t++;
        const ok = isLogTaken(dayLog, med.id + '_' + slot);
        if (ok) tk++;
        const reason = getLogReason(dayLog, med.id + '_' + slot);
        lines.push({ med: med.name, slot: timeLabel(slot) || slot, ok: ok, dose: med.dose || '', reason: reason });
      });
    });
    totalDoses += t;
    takenDoses += tk;
    days.push({ date: formatDate(d), display: d.toLocaleDateString('bg-BG'), total: t, taken: tk, lines: lines });
  }

  const pct = totalDoses ? Math.round((takenDoses / totalDoses) * 100) : 0;
  const medsList = meds.map(m => {
    const stock = (m.stock != null && m.stock !== '') ? m.stock + ' бр.' : '—';
    return `<tr><td>${m.name}</td><td>${m.dose || '—'}</td><td>${(m.times||[]).map(t=>timeLabel(t)).join(', ')}</td><td>${stock}</td></tr>`;
  }).join('');

  const dayRows = days.filter(d => d.total > 0).map(d => {
    const status = d.taken === d.total ? '✓' : (d.taken === 0 ? '✗' : d.taken + '/' + d.total);
    return `<tr><td>${d.display}</td><td>${status}</td><td>${d.total ? Math.round(d.taken/d.total*100) : 0}%</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="bg"><head><meta charset="UTF-8"><title>PillFlow справка – ${name}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:800px;margin:24px auto;padding:0 16px;color:#0f172a}
    h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:24px 0 8px;color:#0369a1}
    .meta{color:#64748b;font-size:13px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px}
    th,td{border:1px solid #e2e8f0;padding:8px;text-align:left}
    th{background:#f8fafc}
    .summary{display:flex;gap:12px;margin:16px 0}
    .card{flex:1;border:1px solid #e2e8f0;border-radius:12px;padding:12px;text-align:center}
    .card b{display:block;font-size:22px;color:#0284c7}
    @media print{button{display:none}}
  </style></head><body>
  <button onclick="window.print()" style="padding:10px 16px;border-radius:8px;background:#0ea5e9;color:#fff;border:0;font-weight:600;cursor:pointer;margin-bottom:16px">Печат / Запази PDF</button>
  <h1>Справка за прием на медикаменти</h1>
  <p class="meta">Пациент: <b>${name}</b> · Период: последните 30 дни · Генерирано: ${today.toLocaleDateString('bg-BG')} · PillFlow</p>
  <div class="summary">
    <div class="card"><b>${pct}%</b>спазване</div>
    <div class="card"><b>${takenDoses}</b>взети дози</div>
    <div class="card"><b>${totalDoses - takenDoses}</b>пропуски</div>
  </div>
  <h2>Медикаменти</h2>
  <table><thead><tr><th>Име</th><th>Доза</th><th>Време</th><th>Наличност</th></tr></thead><tbody>${medsList || '<tr><td colspan=4>Няма</td></tr>'}</tbody></table>
  <h2>Дневен преглед (30 дни)</h2>
  <table><thead><tr><th>Дата</th><th>Статус</th><th>%</th></tr></thead><tbody>${dayRows || '<tr><td colspan=3>Няма данни</td></tr>'}</tbody></table>
  <p class="meta">Тази справка е генерирана от PillFlow и е информативна. Не замества медицинска документация.</p>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Разреши pop-up за справката'); return; }
  w.document.write(html);
  w.document.close();
}





// ==================== HOUSEHOLD (shared profiles) ====================
function randomHouseholdCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = 'PILL-';
  for (var i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function renderHouseholdSettings() {
  var listEl = document.getElementById('household-members-list');
  if (listEl) {
    listEl.innerHTML = members.map(function (mem) {
      if (mem.id === 'self') {
        return '<div class="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/40">' +
          '<span class="text-xl">' + (mem.avatar || profile.avatar || '👤') + '</span>' +
          '<div class="flex-1 min-w-0"><p class="text-sm font-semibold truncate">' + (profile.name || mem.name || 'Аз') + '</p>' +
          '<p class="text-[11px] text-slate-400">Ти (основен профил)</p></div></div>';
      }
      var on = !!mem.showOnMyCalendar;
      var cdOn = mem.showCountdowns !== false;
      var cdMine = !!mem.showCountdownOnMyProfile;
      return '<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/40 space-y-2">' +
        '<div class="flex items-center gap-3">' +
        '<span class="text-xl">' + (mem.avatar || '👤') + '</span>' +
        '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-semibold truncate">' + mem.name + '</p>' +
        '<p class="text-[11px] text-slate-400">' + (mem.type === 'pet' ? 'Любимец' : 'Профил') +
        (mem.breed ? ' · ' + mem.breed : '') + '</p></div>' +
        '<button type="button" onclick="openEditMember(\'' + mem.id + '\')" class="text-xs text-primary-500 px-2 py-1">✎</button></div>' +
        '<div class="flex items-center justify-between gap-2 pl-1">' +
        '<span class="text-[11px] text-slate-500">📌 В моя календар</span>' + pinToggleHtml(mem.id, on, 'sm') + '</div>' +
        '<div class="flex items-center justify-between gap-2 pl-1">' +
        '<span class="text-[11px] text-slate-500">⏳ Обратно броене тук</span>' +
        '<button type="button" onclick="toggleMemberShowCountdowns(\'' + mem.id + '\')" class="relative w-11 h-6 flex-shrink-0 rounded-full transition ' + (cdOn ? 'bg-violet-500' : 'bg-slate-200 dark:bg-slate-600') + '"><span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform" style="transform:' + (cdOn ? 'translateX(18px)' : 'translateX(0)') + '"></span></button></div>' +
        '<div class="flex items-center justify-between gap-2 pl-1">' +
        '<span class="text-[11px] text-slate-500">⏳ Countdown и при „Аз“</span>' +
        '<button type="button" onclick="toggleMemberCountdownOnMyProfile(\'' + mem.id + '\')" class="relative w-11 h-6 flex-shrink-0 rounded-full transition ' + (cdMine ? 'bg-violet-500' : 'bg-slate-200 dark:bg-slate-600') + '"><span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform" style="transform:' + (cdMine ? 'translateX(18px)' : 'translateX(0)') + '"></span></button></div></div>';
    }).join('');
  }
  var status = document.getElementById('household-status');
  var actions = document.getElementById('household-actions');
  if (!status) return;
  if (!firebaseReady) {
    status.textContent = 'Споделянето с друг акаунт изисква Firebase (облак).';
    if (actions) actions.classList.add('hidden');
    return;
  }
  if (actions) actions.classList.remove('hidden');
  if (householdId && householdCode) {
    var peerNames = householdPeers.map(function (p) { return p.name || 'Член'; }).join(', ');
    status.innerHTML = '<p class="font-medium text-slate-700 dark:text-slate-200">Код: <span class="font-mono text-primary-600">' + householdCode + '</span></p>' +
      '<p class="text-xs mt-1">Членове: ' + (peerNames || 'само ти') + '</p>' +
      '<button type="button" onclick="leaveHousehold()" class="text-xs text-red-500 mt-2 hover:underline">Напусни домакинството</button>';
    if (actions) actions.classList.add('hidden');
  } else {
    status.textContent = 'Не си в домакинство. Създай или се присъедини с код.';
    if (actions) actions.classList.remove('hidden');
  }
  function syncShareToggle(togId, knobId) {
    var knob = document.getElementById(knobId);
    var tog = document.getElementById(togId);
    if (!knob || !tog) return;
    if (shareWithHousehold) {
      knob.style.transform = 'translateX(20px)';
      tog.classList.add('bg-primary-500');
      tog.classList.remove('bg-slate-200', 'dark:bg-slate-600');
    } else {
      knob.style.transform = 'translateX(0)';
      tog.classList.remove('bg-primary-500');
      tog.classList.add('bg-slate-200', 'dark:bg-slate-600');
    }
  }
  syncShareToggle('share-household-toggle', 'share-household-knob');
  syncShareToggle('share-household-toggle-menu', 'share-household-knob-menu');
}

function createHousehold() {
  if (!firebaseReady || !currentUser) {
    alert('Влез с Firebase акаунт, за да създадеш домакинство.');
    return;
  }
  var code = randomHouseholdCode();
  var hid = 'hh_' + Date.now().toString(36);
  var data = {
    code: code,
    codeUpper: code.toUpperCase(),
    ownerUid: currentUser.uid,
    memberUids: [currentUser.uid],
    members: {},
    createdAt: new Date().toISOString()
  };
  data.members[currentUser.uid] = {
    uid: currentUser.uid,
    name: (profile && profile.name) || currentUser.displayName || currentUser.email || 'Аз',
    avatar: (profile && profile.avatar) || '👤',
    shareWithHousehold: shareWithHousehold !== false,
    joinedAt: new Date().toISOString()
  };
  db.collection('households').doc(hid).set(data).then(function () {
    return db.collection('users').doc(currentUser.uid).collection('settings').doc('household').set({
      householdId: hid,
      code: code,
      shareWithHousehold: shareWithHousehold !== false
    }, { merge: true });
  }).then(function () {
    householdId = hid;
    householdCode = code;
    alert('Домакинство създадено!\n\nКод за покана: ' + code + '\n\nСподели го с Нина (или друг).');
    loadHousehold();
  }).catch(function (err) {
    alert('Грешка: ' + err.message);
  });
}

function promptJoinHousehold() {
  var code = prompt('Въведи кода на домакинството (напр. PILL-A3K2):');
  if (!code) return;
  joinHousehold(code.trim().toUpperCase());
}

function joinHousehold(code) {
  if (!firebaseReady || !currentUser) {
    alert('Влез с Firebase акаунт.');
    return;
  }
  code = (code || '').toUpperCase().trim();
  db.collection('households').where('codeUpper', '==', code).limit(1).get()
    .then(function (snap) {
      if (snap.empty) {
        // fallback without codeUpper
        return db.collection('households').where('code', '==', code).limit(1).get();
      }
      return snap;
    })
    .then(function (snap) {
      if (!snap || snap.empty) {
        alert('Невалиден код.');
        return null;
      }
      var doc = snap.docs[0];
      var hid = doc.id;
      var data = doc.data();
      var uids = data.memberUids || [];
      if (uids.indexOf(currentUser.uid) === -1) uids.push(currentUser.uid);
      var members = data.members || {};
      members[currentUser.uid] = {
        uid: currentUser.uid,
        name: (profile && profile.name) || currentUser.displayName || currentUser.email || 'Аз',
        avatar: (profile && profile.avatar) || '👤',
        shareWithHousehold: shareWithHousehold !== false,
        joinedAt: new Date().toISOString()
      };
      return doc.ref.update({
        memberUids: uids,
        members: members
      }).then(function () {
        return db.collection('users').doc(currentUser.uid).collection('settings').doc('household').set({
          householdId: hid,
          code: data.code || code,
          shareWithHousehold: shareWithHousehold !== false
        }, { merge: true });
      }).then(function () {
        householdId = hid;
        householdCode = data.code || code;
        alert('Присъединен към домакинство ' + householdCode);
        loadHousehold();
      });
    })
    .catch(function (err) {
      alert('Грешка: ' + err.message + '\n\nПровери Firestore rules за households.');
    });
}

function leaveHousehold() {
  if (!householdId || !currentUser) return;
  if (!confirm('Напускаш домакинството? Споделените профили на другите няма да се виждат.')) return;
  var href = db.collection('households').doc(householdId);
  href.get().then(function (doc) {
    if (!doc.exists) return;
    var data = doc.data();
    var uids = (data.memberUids || []).filter(function (u) { return u !== currentUser.uid; });
    var members = data.members || {};
    delete members[currentUser.uid];
    return href.update({ memberUids: uids, members: members });
  }).then(function () {
    return db.collection('users').doc(currentUser.uid).collection('settings').doc('household').set({
      householdId: null,
      code: null
    }, { merge: true });
  }).then(function () {
    householdId = null;
    householdCode = null;
    householdPeers = [];
    viewingRemoteUid = null;
    renderHouseholdSettings();
    updateMemberSwitchLabel();
    startListeners();
  }).catch(function (err) { alert(err.message); });
}

function toggleShareWithHousehold() {
  shareWithHousehold = !shareWithHousehold;
  renderHouseholdSettings();
  if (!firebaseReady || !currentUser) return;
  db.collection('users').doc(currentUser.uid).collection('settings').doc('household')
    .set({ shareWithHousehold: shareWithHousehold }, { merge: true }).catch(function () {});
  if (householdId) {
    var update = {};
    update['members.' + currentUser.uid + '.shareWithHousehold'] = shareWithHousehold;
    update['members.' + currentUser.uid + '.name'] = (profile && profile.name) || currentUser.displayName || 'Аз';
    update['members.' + currentUser.uid + '.avatar'] = (profile && profile.avatar) || '👤';
    db.collection('households').doc(householdId).update(update).catch(function () {});
  }
}

function loadHousehold() {
  if (!firebaseReady || !currentUser) {
    renderHouseholdSettings();
    return;
  }
  db.collection('users').doc(currentUser.uid).collection('settings').doc('household')
    .onSnapshot(function (doc) {
      if (doc.exists) {
        var d = doc.data();
        householdId = d.householdId || null;
        householdCode = d.code || null;
        if (typeof d.shareWithHousehold === 'boolean') shareWithHousehold = d.shareWithHousehold;
      } else {
        householdId = null;
        householdCode = null;
      }
      renderHouseholdSettings();
      if (householdId) {
        subscribeHouseholdDoc(householdId);
      } else {
        householdPeers = [];
        renderMemberMenuList();
      }
    }, function () {});
}

function subscribeHouseholdDoc(hid) {
  db.collection('households').doc(hid).onSnapshot(function (doc) {
    if (!doc.exists) {
      householdPeers = [];
      return;
    }
    var data = doc.data();
    householdCode = data.code || householdCode;
    var members = data.members || {};
    householdPeers = [];
    Object.keys(members).forEach(function (uid) {
      if (uid === currentUser.uid) return;
      var m = members[uid];
      if (m && m.shareWithHousehold !== false) {
        householdPeers.push({
          uid: uid,
          name: m.name || 'Член',
          avatar: m.avatar || '👤',
          shareWithHousehold: true
        });
      }
    });
    // also update my entry name/avatar occasionally
    renderHouseholdSettings();
    renderMemberMenuList();
    updateMemberSwitchLabel();
  }, function (err) { console.warn('household', err); });
}


// ==================== HOUSEHOLD MEMBERS ====================
function toggleMemberMenu() {
  var m = document.getElementById('member-menu');
  if (!m) return;
  renderMemberMenuList();
  if (typeof renderHouseholdSettings === 'function') renderHouseholdSettings();
  m.classList.toggle('hidden');
}
function closeMemberMenu() {
  var m = document.getElementById('member-menu');
  if (m) m.classList.add('hidden');
}
function renderMemberMenuList() {
  var list = document.getElementById('member-menu-list');
  if (!list) return;
  var html = members.map(function (mem) {
    var active = !viewingRemoteUid && mem.id === currentMemberId;
    var pin = '';
    if (mem.id !== 'self') {
      var on = !!mem.showOnMyCalendar;
      pin = '<div class="pr-2 flex-shrink-0" title="В моя календар">' + pinToggleHtml(mem.id, on, 'sm') + '</div>';
    }
    return '<div class="flex items-center gap-1 pr-2 ' + (active ? 'bg-primary-50 dark:bg-primary-900/30' : '') + '">' +
      '<button type="button" onclick="switchMember(\'' + mem.id + '\')" class="flex-1 min-w-0 px-4 py-3 text-left text-sm flex items-center gap-3 ' +
      (active ? 'text-primary-700 dark:text-primary-300 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-700') + '">' +
      '<span class="text-lg">' + (mem.avatar || '👤') + '</span><span class="flex-1 truncate">' + mem.name + '</span>' +
      (active ? '<span class="text-primary-500">✓</span>' : '') + '</button>' + pin + '</div>';
  }).join('');
  if (householdPeers && householdPeers.length) {
    html += '<p class="px-4 pt-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase">Домакинство</p>';
    householdPeers.forEach(function (p) {
      var active = viewingRemoteUid === p.uid;
      var safeName = String(p.name || 'Член').replace(/'/g, '');
      var av = String(p.avatar || '👤').replace(/'/g, '');
      html += '<button type="button" onclick="switchRemoteMember(\'' + p.uid + '\',\'' + safeName + '\',\'' + av + '\')" class="w-full px-4 py-3 text-left text-sm flex items-center gap-3 ' +
        (active ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-700') + '">' +
        '<span class="text-lg">' + (p.avatar || '👤') + '</span><span class="flex-1 truncate">' + (p.name || 'Член') + ' <span class="text-[10px] text-slate-400">споделен</span></span>' +
        (active ? '<span class="text-primary-500">✓</span>' : '') + '</button>';
    });
  }
  list.innerHTML = html;
}

function updateMemberSwitchLabel() {
  var el = document.getElementById('member-switch-label');
  if (!el) return;
  if (viewingRemoteUid) {
    var p = householdPeers.find(function (x) { return x.uid === viewingRemoteUid; });
    if (p) { el.textContent = (p.avatar || '👤') + ' ' + p.name; return; }
  }
  var mem = getCurrentMember();
  if (mem) el.textContent = (mem.avatar ? mem.avatar + ' ' : '') + mem.name;
}
function switchMember(id) {
  viewingRemoteUid = null;
  currentMemberId = id;
  try { localStorage.setItem('pillflow_member_' + (currentUser && currentUser.uid), id); } catch (e) {}
  closeMemberMenu();
  updateMemberSwitchLabel();
  startListeners();
  renderMeds();
  renderToday();
  renderCalendar();
  if (typeof renderTakenHistory === 'function') renderTakenHistory();
  if (typeof renderProfilePage === 'function') renderProfilePage();
  if (typeof renderHouseholdSettings === 'function') renderHouseholdSettings();
}

function switchRemoteMember(uid, name, avatar) {
  viewingRemoteUid = uid;
  currentMemberId = 'self'; // their personal meds
  closeMemberMenu();
  var el = document.getElementById('member-switch-label');
  if (el) el.textContent = (avatar || '👤') + ' ' + (name || 'Член');
  startListeners();
  renderMeds();
  renderToday();
  renderCalendar();
}
function selectMemberAvatar(a) {
  _memberAvatar = a;
  document.querySelectorAll('.member-av').forEach(function (btn) {
    btn.classList.toggle('ring-2', btn.textContent.trim() === a);
    btn.classList.toggle('ring-primary-500', btn.textContent.trim() === a);
  });
}

function onMemberTypeChange() {
  var t = document.getElementById('member-type');
  var type = t ? t.value : 'person';
  var pet = document.getElementById('member-fields-pet');
  var person = document.getElementById('member-fields-person');
  if (pet) pet.classList.toggle('hidden', type !== 'pet');
  if (person) person.classList.toggle('hidden', type !== 'person');
  var sub = document.getElementById('member-modal-sub');
  if (sub) sub.textContent = type === 'pet' ? 'Порода, тегло, възраст — без кръвна група' : 'Данни за човек в домакинството';
  var title = document.getElementById('member-modal-title');
  if (title && !window._editingMemberId) {
    title.textContent = type === 'pet' ? 'Нов любимец' : 'Нов профил';
  }
}

function pinToggleHtml(memberId, on, size) {
  // Visual on/off switch
  var w = size === 'sm' ? 'w-11 h-6' : 'w-12 h-7';
  var knob = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  var tx = on ? 'translateX(20px)' : 'translateX(0)';
  if (size === 'sm') tx = on ? 'translateX(18px)' : 'translateX(0)';
  return '<button type="button" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" onclick="event.stopPropagation(); toggleMemberOnMyCalendar(\'' + memberId + '\')" class="relative ' + w + ' flex-shrink-0 rounded-full transition ' +
    (on ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-600') + '">' +
    '<span class="absolute top-0.5 left-0.5 ' + knob + ' rounded-full bg-white shadow transition-transform" style="transform:' + tx + '"></span></button>';
}

function openAddMemberModal() {
  closeMemberMenu();
  window._editingMemberId = null;
  var n = document.getElementById('member-name');
  if (n) n.value = '';
  var t = document.getElementById('member-type');
  if (t) t.value = 'person';
  var b = document.getElementById('member-breed');
  if (b) b.value = '';
  var w = document.getElementById('member-weight');
  if (w) w.value = '';
  var bd = document.getElementById('member-birth');
  if (bd) bd.value = '';
  var wp = document.getElementById('member-weight-person');
  if (wp) wp.value = '';
  var bp = document.getElementById('member-birth-person');
  if (bp) bp.value = '';
  var np = document.getElementById('member-note-person');
  if (np) np.value = '';
  var h = document.getElementById('member-height');
  if (h) h.value = '';
  _memberAvatar = '🧒';
  selectMemberAvatar('🧒');
  var title = document.getElementById('member-modal-title');
  if (title) title.textContent = 'Нов профил';
  onMemberTypeChange();
  var m = document.getElementById('member-modal');
  if (m) m.classList.remove('hidden');
}
function closeMemberModal() {
  var m = document.getElementById('member-modal');
  if (m) m.classList.add('hidden');
}
function readMemberFormFields(type) {
  var breed = '', weight = '', birthDate = '', height = '', note = '';
  if (type === 'pet') {
    var breedEl = document.getElementById('member-breed');
    var weightEl = document.getElementById('member-weight');
    var birthEl = document.getElementById('member-birth');
    var heightEl = document.getElementById('member-height');
    breed = breedEl ? breedEl.value.trim() : '';
    weight = weightEl ? weightEl.value.trim() : '';
    birthDate = birthEl ? birthEl.value : '';
    height = heightEl ? heightEl.value.trim() : '';
  } else {
    var wp = document.getElementById('member-weight-person');
    var bp = document.getElementById('member-birth-person');
    var np = document.getElementById('member-note-person');
    weight = wp ? wp.value.trim() : '';
    birthDate = bp ? bp.value : '';
    note = np ? np.value.trim() : '';
    breed = note; // store note in breed field for people as free text label
  }
  return { breed: breed, weight: weight, birthDate: birthDate, height: height, note: note };
}

function saveNewMember() {
  var nameEl = document.getElementById('member-name');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { alert('Въведи име'); return; }
  var typeEl = document.getElementById('member-type');
  var type = typeEl ? typeEl.value : 'person';
  var id = 'm_' + Date.now().toString(36);
  var f = readMemberFormFields(type);
  var mem = {
    id: id,
    name: name,
    type: type,
    avatar: _memberAvatar || (type === 'pet' ? '🐶' : '🧒'),
    breed: f.breed,
    weight: f.weight,
    birthDate: f.birthDate,
    height: f.height,
    note: f.note,
    showOnMyCalendar: true
  };
  members.push(mem);
  persistMembers();
  closeMemberModal();
  switchMember(id);
}

function toggleMemberOnMyCalendar(memberId) {
  var m = members.find(function (x) { return x.id === memberId; });
  if (!m || m.id === 'self') return;
  m.showOnMyCalendar = !m.showOnMyCalendar;
  persistMembers();
  renderHouseholdSettings();
  renderMemberMenuList();
  if (typeof renderToday === 'function') renderToday();
  if (typeof renderCalendar === 'function') renderCalendar();
}

function toggleMemberShowCountdowns(memberId) {
  var m = members.find(function (x) { return x.id === memberId; });
  if (!m || m.id === 'self') return;
  // default true when undefined
  var currentlyOn = m.showCountdowns !== false;
  m.showCountdowns = !currentlyOn;
  persistMembers();
  renderHouseholdSettings();
  if (typeof renderToday === 'function') renderToday();
}

function toggleMemberCountdownOnMyProfile(memberId) {
  var m = members.find(function (x) { return x.id === memberId; });
  if (!m || m.id === 'self') return;
  m.showCountdownOnMyProfile = !m.showCountdownOnMyProfile;
  persistMembers();
  renderHouseholdSettings();
  if (typeof renderToday === 'function') renderToday();
}

function openEditMember(memberId) {
  var m = members.find(function (x) { return x.id === memberId; });
  if (!m || m.id === 'self') return;
  window._editingMemberId = memberId;
  var n = document.getElementById('member-name');
  if (n) n.value = m.name || '';
  var t = document.getElementById('member-type');
  if (t) t.value = m.type || 'person';
  var b = document.getElementById('member-breed');
  if (b) b.value = m.breed || '';
  var w = document.getElementById('member-weight');
  if (w) w.value = m.type === 'pet' ? (m.weight || '') : '';
  var bd = document.getElementById('member-birth');
  if (bd) bd.value = m.type === 'pet' ? (m.birthDate || '') : '';
  var wp = document.getElementById('member-weight-person');
  if (wp) wp.value = m.type !== 'pet' ? (m.weight || '') : '';
  var bp = document.getElementById('member-birth-person');
  if (bp) bp.value = m.type !== 'pet' ? (m.birthDate || '') : '';
  var np = document.getElementById('member-note-person');
  if (np) np.value = m.note || m.breed || '';
  var h = document.getElementById('member-height');
  if (h) h.value = m.height || '';
  _memberAvatar = m.avatar || (m.type === 'pet' ? '🐶' : '🧒');
  selectMemberAvatar(_memberAvatar);
  var title = document.getElementById('member-modal-title');
  if (title) title.textContent = 'Данни за ' + (m.name || 'профила');
  onMemberTypeChange();
  closeMemberMenu();
  var modal = document.getElementById('member-modal');
  if (modal) modal.classList.remove('hidden');
}

function saveMemberFromModal() {
  if (window._editingMemberId) {
    var m = members.find(function (x) { return x.id === window._editingMemberId; });
    if (!m) return;
    var nameEl = document.getElementById('member-name');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) { alert('Въведи име'); return; }
    m.name = name;
    var typeEl = document.getElementById('member-type');
    if (typeEl) m.type = typeEl.value;
    var f = readMemberFormFields(m.type || 'person');
    m.breed = f.breed;
    m.weight = f.weight;
    m.birthDate = f.birthDate;
    m.height = f.height;
    m.note = f.note;
    m.avatar = _memberAvatar || m.avatar;
    persistMembers();
    window._editingMemberId = null;
    closeMemberModal();
    updateMemberSwitchLabel();
    if (typeof renderToday === 'function') renderToday();
    if (typeof renderProfilePage === 'function') renderProfilePage();
    renderHouseholdSettings();
    return;
  }
  saveNewMember();
}
function persistMembers() {
  if (!currentUser) return;
  try {
    localStorage.setItem('pillflow_members_' + currentUser.uid, JSON.stringify(members));
  } catch (e) {}
  if (firebaseReady && db) {
    db.collection('users').doc(currentUser.uid).collection('settings').doc('household')
      .set({ members: members, updatedAt: new Date().toISOString() }, { merge: true })
      .catch(function (err) { console.warn(err); });
  }
}
function loadMembers() {
  if (!currentUser) return;
  members = [{ id: 'self', name: (profile && profile.name) || 'Аз', type: 'person', avatar: (profile && profile.avatar) || '👤' }];
  try {
    var saved = localStorage.getItem('pillflow_members_' + currentUser.uid);
    if (saved) {
      var arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length) {
        // ensure self exists
        var hasSelf = arr.some(function (m) { return m.id === 'self'; });
        members = hasSelf ? arr : members.concat(arr.filter(function (m) { return m.id !== 'self'; }));
      }
    }
    var cur = localStorage.getItem('pillflow_member_' + currentUser.uid);
    if (cur && members.some(function (m) { return m.id === cur; })) currentMemberId = cur;
  } catch (e) {}
  updateMemberSwitchLabel();
  if (firebaseReady && db) {
    db.collection('users').doc(currentUser.uid).collection('settings').doc('household')
      .onSnapshot(function (doc) {
        if (doc.exists && Array.isArray(doc.data().members) && doc.data().members.length) {
          members = doc.data().members;
          members.forEach(function (m) {
            if (m.id !== 'self' && typeof m.showOnMyCalendar === 'undefined') m.showOnMyCalendar = true;
          });
          if (!members.some(function (m) { return m.id === 'self'; })) {
            members.unshift({ id: 'self', name: (profile && profile.name) || 'Аз', type: 'person', avatar: (profile && profile.avatar) || '👤' });
          }
          try { localStorage.setItem('pillflow_members_' + currentUser.uid, JSON.stringify(members)); } catch (e) {}
          updateMemberSwitchLabel();
        }
      }, function () {});
  }
}

// ==================== INIT ====================
function init() {
  // Theme: support system / light / dark
  if (!localStorage.getItem('pillflow_theme')) localStorage.setItem('pillflow_theme', 'system');
  applyTheme();
  applyCalDotsToggle();
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('pillflow_theme') || 'system') === 'system') applyTheme();
  });

  if (firebaseReady) {
    auth.onAuthStateChanged(user => {
      if (user) {
        currentUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email.split('@')[0]
        };
        enterApp();
      } else {
        document.getElementById('app').classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
        hideSplash();
      }
    });
  } else {
    const session = localStorage.getItem('pillflow_session');
    if (session) {
      currentUser = JSON.parse(session);
      enterApp();
    } else {
      document.getElementById('login-screen').classList.remove('hidden');
      hideSplash();
    }
  }

  // PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW error', err));
  }
}

init();
