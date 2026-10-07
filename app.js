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

const CONDITION_LABELS = {
  any: '',
  empty: 'На гладно',
  food: 'С храна',
  before_food: '30 мин преди храна',
  after_food: '30 мин след храна'
};

// ==================== HELPERS ====================
function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(d) {
  return d.toLocaleDateString('bg-BG', { weekday: 'long', day: 'numeric', month: 'long' });
}

function isSameDay(d1, d2) {
  return formatDate(d1) === formatDate(d2);
}

// ==================== AUTH UI ====================
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
    unsubMeds = db.collection('users').doc(currentUser.uid).collection('meds')
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

    unsubLogs = db.collection('users').doc(currentUser.uid).collection('logs')
      .onSnapshot(snap => {
        logs = {};
        snap.forEach(doc => {
          logs[doc.id] = doc.data();
        });
        renderToday();
        renderCalendar();
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
  startListeners();
  scheduleNotifications();
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
  var name = (profile.name || (currentUser && currentUser.displayName) || '—');
  var avatar = profile.avatar || '👩';
  var av = document.getElementById('profile-page-avatar');
  var nm = document.getElementById('profile-page-name');
  var em = document.getElementById('profile-page-email');
  if (av) av.textContent = avatar;
  if (nm) nm.textContent = name;
  if (em) em.textContent = (currentUser && currentUser.email) || '';

  // stats
  var streak = typeof calculateStreak === 'function' ? calculateStreak() : 0;
  var se = document.getElementById('stat-streak');
  if (se) se.textContent = streak;
  var sm = document.getElementById('stat-meds');
  if (sm) sm.textContent = meds.length;

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
        if (dayLog[med.id + '_' + t]) takenTotal++;
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

  // health summary
  var hs = document.getElementById('profile-health-summary');
  if (hs) {
    var rows = [];
    if (profile.weight) rows.push('<div class="flex justify-between"><span class="text-slate-400">Тегло</span><span class="font-medium">' + profile.weight + ' кг</span></div>');
    if (profile.height) rows.push('<div class="flex justify-between"><span class="text-slate-400">Височина</span><span class="font-medium">' + profile.height + ' см</span></div>');
    if (profile.blood) rows.push('<div class="flex justify-between"><span class="text-slate-400">Кръвна група</span><span class="font-medium">' + profile.blood + '</span></div>');
    if (profile.allergies) rows.push('<div class="flex justify-between gap-4"><span class="text-slate-400">Алергии</span><span class="font-medium text-right">' + profile.allergies + '</span></div>');
    if (profile.gender) rows.push('<div class="flex justify-between"><span class="text-slate-400">Род</span><span class="font-medium">' + (profile.gender === 'm' ? 'Мъж' : 'Жена') + '</span></div>');
    hs.innerHTML = rows.length ? rows.join('') : '<p class="text-slate-400">Все още няма попълнени данни. Натисни „Редактирай данните“.</p>';
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
  if (tab === 'today') renderToday();
  if (tab === 'calendar') {
    renderCalendar();
    renderWeekReview();
  }
  if (tab === 'meds') renderMeds();
  if (tab === 'profile') renderProfilePage();
  if (tab === 'settings') {
    applyNotifToggle();
    loadNotifTimes();
    applyTheme();
    applyCalDotsToggle();
  }
  var menu = document.getElementById('app-menu');
  if (menu) menu.classList.add('hidden');
}

// ==================== SCHEDULE LOGIC ====================
function shouldTakeOnDate(med, date) {
  const dayOfWeek = date.getDay();
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  // Duration check (start / end)
  const start = med.startDate ? new Date(med.startDate) : null;
  if (start) {
    start.setHours(0, 0, 0, 0);
    if (d < start) return false;
  }
  if (med.endDate) {
    const end = new Date(med.endDate);
    end.setHours(0, 0, 0, 0);
    if (d > end) return false;
  }

  // Frequency
  if (med.frequency === 'every_other') {
    const ref = start || (med.createdAt ? new Date(med.createdAt) : new Date());
    ref.setHours(0, 0, 0, 0);
    const diff = Math.floor((d - ref) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff % 2 === 0;
  }

  if (med.frequency === 'specific_days') {
    return (med.days || []).includes(dayOfWeek);
  }

  // daily (default)
  return true;
}

function getMedsForDate(date) {
  return meds.filter(med => shouldTakeOnDate(med, date));
}

// ==================== TODAY VIEW ====================
function changeDay(delta) {
  currentDate.setDate(currentDate.getDate() + delta);
  renderToday();
}

function goToToday() {
  currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
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
      if (dayLog[`${med.id}_${t}`]) taken++;
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

function renderToday() {
  const dateStr = formatDate(currentDate);
  const isToday = isSameDay(currentDate, new Date());
  const firstName = (profile.name || currentUser?.displayName || '').split(' ')[0];
  const avatar = profile.avatar || '👩';

  // Hero avatar + greeting (main blue card – clear and visible)
  const heroAv = document.getElementById('hero-avatar');
  if (heroAv) heroAv.textContent = avatar;

  const greetEl = document.getElementById('today-greeting');
  const nameEl = document.getElementById('today-name');
  if (isToday) {
    if (greetEl) greetEl.textContent = getGreeting();
    if (nameEl) nameEl.textContent = firstName || 'Ти';
  } else {
    if (greetEl) greetEl.textContent = firstName || 'PillFlow';
    if (nameEl) nameEl.textContent = formatDisplayDate(currentDate);
  }

  const dayMeds = getMedsForDate(currentDate);
  const dayLog = logs[dateStr] || {};

  let total = 0, taken = 0;
  dayMeds.forEach(med => {
    (med.times || []).forEach(t => {
      total++;
      if (dayLog[`${med.id}_${t}`]) taken++;
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
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const sections = { morning: [], noon: [], evening: [], night: [] };
  dayMeds.forEach(med => {
    (med.times || []).forEach(t => {
      if (sections[t]) sections[t].push({ med, time: t });
    });
  });

  const sectionIcons = { morning: '🌅', noon: '☀️', evening: '🌆', night: '🌙' };

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

  ['morning', 'noon', 'evening', 'night'].forEach(timeKey => {
    const items = sections[timeKey];
    if (items.length === 0) return;

    const sectionTaken = items.filter(({ med, time }) => dayLog[`${med.id}_${time}`]).length;

    html += `<div>
      <div class="flex items-center justify-between mb-2.5">
        <h3 class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase section-label flex items-center gap-1.5">
          <span>${sectionIcons[timeKey]}</span> ${TIME_LABELS[timeKey]}
        </h3>
        <span class="text-xs text-slate-400">${sectionTaken}/${items.length}</span>
      </div>
      <div class="space-y-2.5">`;

    items.forEach(({ med, time }) => {
      const key = `${med.id}_${time}`;
      const isTaken = !!dayLog[key];
      const condition = CONDITION_LABELS[med.condition] || '';
      const note = med.note ? med.note : '';

      // Dependency check
      let locked = false;
      let lockMsg = '';
      if (med.dependsOn && !isTaken) {
        const depTaken = (med.times || []).some(t => dayLog[`${med.dependsOn}_${t}`]) ||
          Object.keys(dayLog).some(k => k.startsWith(med.dependsOn + '_') && dayLog[k]);
        // Check if any dose of dependency med was taken today
        const depMed = meds.find(m => m.id === med.dependsOn);
        let anyDepTaken = false;
        if (depMed) {
          (depMed.times || []).forEach(t => {
            if (dayLog[`${depMed.id}_${t}`]) anyDepTaken = true;
          });
        }
        if (!anyDepTaken) {
          locked = true;
          lockMsg = `Първо вземи ${depMed ? depMed.name : 'другото хапче'}`;
        } else {
          // Could show "wait X min" - simplified: unlock once dependency is taken
          lockMsg = `${med.dependsMin || 30} мин след ${depMed ? depMed.name : ''}`;
        }
      }

      html += `
        <div class="pill-card bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-100 dark:border-slate-700/80 p-4 flex items-center gap-3.5 ${isTaken ? 'taken' : ''} ${locked ? 'opacity-60' : ''}">
          <div class="flex-1 min-w-0">
            <p class="pill-name font-semibold text-[15px] truncate text-slate-800 dark:text-slate-100">${med.name}</p>
            <p class="text-sm text-slate-400 dark:text-slate-500 mt-0.5 flex flex-wrap gap-x-1.5">
              ${med.dose ? `<span>${med.dose}</span>` : ''}
              ${med.form ? `<span>· ${med.form}</span>` : ''}
              ${condition ? `<span class="text-amber-500 dark:text-amber-400">· ${condition}</span>` : ''}
            </p>
            ${locked ? `<p class="text-xs text-violet-500 mt-1">🔒 ${lockMsg}</p>` : ''}
            ${!locked && med.dependsOn && !isTaken ? `<p class="text-xs text-violet-400 mt-1">${lockMsg}</p>` : ''}
            ${note ? `<p class="text-xs text-slate-400 mt-1">${note}</p>` : ''}
          </div>
          <button onclick="${locked ? 'void(0)' : `toggleTaken('${med.id}', '${time}')`}"
            class="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 text-lg
              ${isTaken
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                : locked
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-300 cursor-not-allowed'
                  : 'bg-slate-50 dark:bg-slate-700/80 hover:bg-primary-50 dark:hover:bg-primary-900/40 text-slate-300 hover:text-primary-500 border border-slate-100 dark:border-slate-600'}">
            ${isTaken ? '✓' : locked ? '🔒' : ''}
          </button>
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

function toggleTaken(medId, time) {
  const dateStr = formatDate(currentDate);
  const key = `${medId}_${time}`;
  const current = !!(logs[dateStr] && logs[dateStr][key]);
  const wasComplete = isDayComplete(currentDate);

  if (firebaseReady) {
    const ref = db.collection('users').doc(currentUser.uid).collection('logs').doc(dateStr);
    if (current) {
      ref.update({ [key]: firebase.firestore.FieldValue.delete() }).catch(() => {
        ref.set({}, { merge: true });
      });
    } else {
      ref.set({ [key]: true }, { merge: true });
    }
    // Check completion after short delay (wait for snapshot)
    setTimeout(() => {
      if (!wasComplete && isDayComplete(currentDate)) {
        showCompleteToast();
      }
    }, 400);
  } else {
    if (!logs[dateStr]) logs[dateStr] = {};
    if (current) delete logs[dateStr][key];
    else logs[dateStr][key] = true;
    saveLocalData(currentUser.uid, { meds, logs });
    renderToday();
    renderCalendar();
    if (!wasComplete && isDayComplete(currentDate)) {
      showCompleteToast();
    }
  }
}

// ==================== MEDS CRUD ====================
function daysRemaining(med) {
  if (!med.endDate) return null;
  const end = new Date(med.endDate);
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
  return diff;
}

function fillDependsOnSelect(excludeId) {
  const sel = document.getElementById('med-depends-on');
  if (!sel) return;
  sel.innerHTML = '<option value="">Няма</option>';
  meds.forEach(m => {
    if (m.id === excludeId) return;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
}

function renderMeds() {
  const list = document.getElementById('meds-list');
  const empty = document.getElementById('meds-empty');

  if (meds.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = meds.map(med => {
    const times = (med.times || []).map(t => TIME_LABELS[t]).join(', ');
    const freqMap = {
      daily: 'Всеки ден',
      every_other: 'През ден',
      specific_days: 'Конкретни дни'
    };
    const condition = CONDITION_LABELS[med.condition] || '';
    const rem = daysRemaining(med);
    let remHtml = '';
    if (rem !== null) {
      if (rem < 0) remHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 text-xs">Курсът приключи</span>`;
      else if (rem === 0) remHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 text-xs font-medium">Последен ден</span>`;
      else if (rem <= 3) remHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 text-xs font-medium">Остават ${rem} дни</span>`;
      else remHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 text-xs">Остават ${rem} дни</span>`;
    }
    const depMed = med.dependsOn ? meds.find(m => m.id === med.dependsOn) : null;
    const depHtml = depMed
      ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs">${med.dependsMin || 30} мин след ${depMed.name}</span>`
      : '';

    return `
      <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="font-semibold text-lg">${med.name}</p>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              ${med.dose || ''} ${med.form ? '· ' + med.form : ''}
            </p>
            <div class="flex flex-wrap gap-1.5 mt-2">
              <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-medium">${times}</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs">${freqMap[med.frequency] || 'Всеки ден'}</span>
              ${condition ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs">${condition}</span>` : ''}
              ${remHtml}
              ${depHtml}
              ${med.notify ? '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-xs">🔔 ' + (med.notifyBefore || 15) + ' мин</span>' : ''}
            </div>
            ${med.note ? `<p class="text-xs text-slate-400 mt-2">${med.note}</p>` : ''}
          </div>
          <div class="flex gap-1">
            <button onclick="editMed('${med.id}')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-primary-500" title="Редактирай">✏️</button>
            <button onclick="deleteMed('${med.id}')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500" title="Изтрий">🗑️</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function openAddMedModal() {
  editingMedId = null;
  document.getElementById('modal-title').textContent = 'Нов медикамент';
  document.getElementById('med-name').value = '';
  document.getElementById('med-dose').value = '';
  document.getElementById('med-form').value = 'Таблетка';
  document.getElementById('med-condition').value = 'any';
  document.getElementById('med-frequency').value = 'daily';
  document.getElementById('med-note').value = '';
  document.getElementById('med-start').value = new Date().toISOString().slice(0, 10);
  document.getElementById('med-end').value = '';
  document.getElementById('med-duration').value = 'lifelong';
  document.getElementById('med-duration-value').value = '';
  document.getElementById('med-depends-min').value = '30';
  var nEl = document.getElementById('med-notify');
  if (nEl) nEl.checked = false;
  var nbEl = document.getElementById('med-notify-before');
  if (nbEl) nbEl.value = '15';
  document.querySelectorAll('.time-check').forEach(c => c.checked = false);
  document.querySelectorAll('.day-check').forEach(c => c.checked = false);
  fillDependsOnSelect(null);
  document.getElementById('med-depends-on').value = '';
  toggleFrequencyOptions();
  toggleDurationOptions();
  document.getElementById('med-modal').classList.remove('hidden');
}

function editMed(id) {
  const med = meds.find(m => m.id === id);
  if (!med) return;

  editingMedId = id;
  document.getElementById('modal-title').textContent = 'Редактирай медикамент';
  document.getElementById('med-name').value = med.name;
  document.getElementById('med-dose').value = med.dose || '';
  document.getElementById('med-form').value = med.form || 'Таблетка';
  document.getElementById('med-condition').value = med.condition || 'any';
  document.getElementById('med-frequency').value = med.frequency || 'daily';
  document.getElementById('med-note').value = med.note || '';
  document.getElementById('med-start').value = med.startDate || '';
  document.getElementById('med-end').value = med.endDate || '';
  document.getElementById('med-duration').value = med.durationType || (med.endDate ? 'until' : 'lifelong');
  document.getElementById('med-duration-value').value = med.durationValue || '';
  document.getElementById('med-depends-min').value = med.dependsMin || 30;
  var nEl2 = document.getElementById('med-notify');
  if (nEl2) nEl2.checked = !!med.notify;
  var nbEl2 = document.getElementById('med-notify-before');
  if (nbEl2) nbEl2.value = String(med.notifyBefore || 15);

  document.querySelectorAll('.time-check').forEach(c => {
    c.checked = (med.times || []).includes(c.value);
  });
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

function toggleFrequencyOptions() {
  const freq = document.getElementById('med-frequency').value;
  document.getElementById('specific-days-options').classList.toggle('hidden', freq !== 'specific_days');
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

  const times = Array.from(document.querySelectorAll('.time-check:checked')).map(c => c.value);
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
    startDate = new Date().toISOString().slice(0, 10); // today by default
  }

  if (durationType === 'until') {
    endDate = document.getElementById('med-end').value || null;
  } else if (durationType === 'days' && durationValue > 0) {
    const s = new Date(startDate);
    s.setDate(s.getDate() + durationValue - 1);
    endDate = s.toISOString().slice(0, 10);
  } else if (durationType === 'weeks' && durationValue > 0) {
    const s = new Date(startDate);
    s.setDate(s.getDate() + (durationValue * 7) - 1);
    endDate = s.toISOString().slice(0, 10);
  } else if (durationType === 'months' && durationValue > 0) {
    const s = new Date(startDate);
    s.setMonth(s.getMonth() + durationValue);
    s.setDate(s.getDate() - 1);
    endDate = s.toISOString().slice(0, 10);
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
    times,
    condition: document.getElementById('med-condition').value,
    frequency,
    days,
    startDate,
    endDate,
    durationType,
    durationValue: durationValue || null,
    dependsOn,
    dependsMin: dependsOn ? dependsMin : null,
    notify: notifyEl ? !!notifyEl.checked : false,
    notifyBefore: notifyBeforeEl ? parseInt(notifyBeforeEl.value) || 15 : 15,
    note: document.getElementById('med-note').value.trim(),
    updatedAt: new Date().toISOString()
  };

  if (firebaseReady) {
    if (editingMedId) {
      db.collection('users').doc(currentUser.uid).collection('meds').doc(editingMedId)
        .update(medData)
        .then(() => { closeMedModal(); scheduleNotifications(); })
        .catch(err => alert('Грешка: ' + err.message));
    } else {
      medData.createdAt = new Date().toISOString();
      db.collection('users').doc(currentUser.uid).collection('meds').add(medData)
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
  if (!confirm('Сигурен ли си, че искаш да изтриеш този медикамент?')) return;

  if (firebaseReady) {
    db.collection('users').doc(currentUser.uid).collection('meds').doc(id).delete()
      .catch(err => alert('Грешка: ' + err.message));
  } else {
    meds = meds.filter(m => m.id !== id);
    saveLocalData(currentUser.uid, { meds, logs });
    renderMeds();
    renderToday();
    renderCalendar();
  }
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
      (med.times || []).forEach(t => {
        total++;
        if (dayLog[`${med.id}_${t}`]) taken++;
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
            const isTaken = !!dayLog[`${med.id}_${t}`];
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

    html += `
      <div onclick="selectCalendarDay(${year}, ${month}, ${d})"
        class="bg-white dark:bg-slate-800 p-1.5 min-h-[56px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition ${statusClass}
          ${isToday ? 'ring-2 ring-inset ring-primary-500' : ''}
          ${isSelected ? 'bg-primary-50 dark:bg-primary-900/30' : ''}">
        <div class="text-sm font-medium ${isToday ? 'text-primary-600' : ''}">${d}</div>
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

function renderCalendarDayDetail() {
  const dayMeds = getMedsForDate(currentDate);
  const detail = document.getElementById('calendar-day-detail');
  const list = document.getElementById('calendar-day-list');
  document.getElementById('calendar-day-title').textContent = formatDisplayDate(currentDate);

  if (dayMeds.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-500">Няма медикаменти за този ден</p>';
  } else {
    const dayLog = logs[formatDate(currentDate)] || {};
    let html = '';
    let takenCount = 0, totalCount = 0;
    dayMeds.forEach(med => {
      (med.times || []).forEach(t => {
        totalCount++;
        const isTaken = !!dayLog[`${med.id}_${t}`];
        if (isTaken) takenCount++;
        html += `
          <div class="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${isTaken ? 'bg-emerald-500' : 'bg-red-400'}"></div>
            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm truncate">${med.name}</p>
              <p class="text-xs text-slate-400">${TIME_LABELS[t]}${med.dose ? ' · ' + med.dose : ''}</p>
            </div>
            <span class="text-xs font-medium ${isTaken ? 'text-emerald-500' : 'text-slate-400'}">${isTaken ? 'Взето' : 'Пропуснато'}</span>
          </div>`;
      });
    });
    html = `<p class="text-xs text-slate-400 mb-2">${takenCount} от ${totalCount} взети</p>` + html;
    html += `
      <button onclick="switchTab('today')" class="w-full mt-3 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition shadow-md shadow-primary-500/20">
        Отвори пълния ден →
      </button>`;
    list.innerHTML = html;
  }
  detail.classList.remove('hidden');
}

// ==================== WEEKLY REVIEW ====================
function renderWeekReview() {
  const el = document.getElementById('week-review');
  if (!el) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let perfect = 0, partial = 0, missed = 0, empty = 0;
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayMeds = getMedsForDate(d);
    const dateStr = formatDate(d);
    const dayLog = logs[dateStr] || {};
    let total = 0, taken = 0;
    dayMeds.forEach(med => {
      (med.times || []).forEach(t => {
        total++;
        if (dayLog[`${med.id}_${t}`]) taken++;
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
    days.push(`<div class="flex flex-col items-center gap-1">
      <div class="w-8 h-8 rounded-full ${colors[status]} flex items-center justify-center text-white text-xs font-bold">${taken || ''}</div>
      <span class="text-[10px] text-slate-400">${label}</span>
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
      var hhmm = slots[slot];
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
        if (dayLog[med.id + '_' + slot]) {
          scheduleNotifications();
          return;
        }
        new Notification('PillFlow – ' + med.name, {
          body: 'След ' + before + ' мин: ' + (TIME_LABELS[slot] || slot) + (med.dose ? ' · ' + med.dose : ''),
          icon: 'icon-192.png',
          tag: 'pillflow-' + med.id + '-' + slot
        });
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
      batch.delete(db.collection('users').doc(currentUser.uid).collection('meds').doc(m.id));
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
