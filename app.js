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
  const name = profile.name || currentUser.displayName || currentUser.email.split('@')[0];
  const avatar = profile.avatar || '👩';
  const gender = profile.gender || 'f';
  document.getElementById('user-greeting').textContent = `Здравей, ${name}`;
  document.getElementById('profile-display-name').textContent = name;
  document.getElementById('settings-email').textContent = currentUser.email + (firebaseReady ? ' · облак' : ' · локално');
  document.getElementById('profile-name').value = profile.name || name;
  document.getElementById('profile-weight').value = profile.weight || '';
  document.getElementById('profile-height').value = profile.height || '';
  document.getElementById('profile-blood').value = profile.blood || '';
  document.getElementById('profile-allergies').value = profile.allergies || '';
  document.getElementById('profile-avatar').textContent = avatar;
  const heroAv = document.getElementById('hero-avatar');
  if (heroAv) heroAv.textContent = avatar;
  selectedAvatar = avatar;
  document.querySelectorAll('.avatar-opt').forEach(btn => {
    if (btn.textContent.trim() === avatar) {
      btn.classList.add('ring-2', 'ring-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
    } else {
      btn.classList.remove('ring-2', 'ring-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
    }
  });
  // gender buttons
  const gf = document.getElementById('gender-f');
  const gm = document.getElementById('gender-m');
  if (gf && gm) {
    const active = 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-600';
    const inactive = 'border-slate-200 dark:border-slate-600 text-slate-500';
    gf.className = 'flex-1 py-2 rounded-xl border text-sm font-medium transition ' + (gender === 'f' ? active : inactive);
    gm.className = 'flex-1 py-2 rounded-xl border text-sm font-medium transition ' + (gender === 'm' ? active : inactive);
  }
  // complete badge gender
  const ct = document.getElementById('complete-text');
  if (ct) ct.textContent = gender === 'm' ? 'Денят е завършен' : 'Денят е завършен';
  // greeting
  if (isSameDay(currentDate, new Date())) {
    const firstName = name.split(' ')[0];
    document.getElementById('today-greeting').textContent = getGreeting() + (firstName ? ', ' + firstName : '');
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
  document.getElementById('profile-avatar').textContent = emoji;
  document.querySelectorAll('.avatar-opt').forEach(btn => {
    if (btn.textContent.trim() === emoji) {
      btn.classList.add('ring-2', 'ring-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
    } else {
      btn.classList.remove('ring-2', 'ring-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
    }
  });
}

function saveProfile() {
  const name = document.getElementById('profile-name').value.trim();
  if (!name) {
    alert('Моля въведи име');
    return;
  }
  profile = {
    name,
    avatar: selectedAvatar,
    gender: profile.gender || 'f',
    weight: document.getElementById('profile-weight').value || '',
    height: document.getElementById('profile-height').value || '',
    blood: document.getElementById('profile-blood').value || '',
    allergies: document.getElementById('profile-allergies').value.trim() || '',
    updatedAt: new Date().toISOString()
  };

  // Always save locally as backup
  localStorage.setItem(`pillflow_profile_${currentUser.uid}`, JSON.stringify(profile));
  currentUser.displayName = name;
  applyProfileToUI();
  renderToday();

  if (firebaseReady) {
    // Save under subcollection so Firestore rules allow it
    // path: users/{uid}/profile/main
    db.collection('users').doc(currentUser.uid).collection('profile').doc('main')
      .set(profile, { merge: true })
      .then(() => {
        if (auth.currentUser) {
          auth.currentUser.updateProfile({ displayName: name }).catch(() => {});
        }
        console.log('✅ Profile saved to cloud');
      })
      .catch(err => {
        console.error('Profile save error:', err);
        alert('Запазено локално, но облакът върна грешка: ' + err.message);
      });
  }
}

function loadProfile() {
  // Load local first (instant)
  const saved = localStorage.getItem(`pillflow_profile_${currentUser.uid}`);
  if (saved) {
    try { profile = { gender: 'f', avatar: '👩', ...JSON.parse(saved) }; } catch(e) {}
  } else {
    profile = { name: currentUser.displayName || '', avatar: '👩', gender: 'f', weight: '', height: '', blood: '', allergies: '' };
  }
  applyProfileToUI();
  renderToday();

  if (firebaseReady) {
    // Then sync from cloud (overrides local if exists)
    unsubProfile = db.collection('users').doc(currentUser.uid)
      .collection('profile').doc('main')
      .onSnapshot(doc => {
        if (doc.exists) {
          profile = { gender: 'f', avatar: '👩', ...doc.data() };
          localStorage.setItem(`pillflow_profile_${currentUser.uid}`, JSON.stringify(profile));
          applyProfileToUI();
          renderToday();
        }
      }, err => console.error('Profile load error:', err));
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
}

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

  if (tab === 'today') renderToday();
  if (tab === 'calendar') renderCalendar();
  if (tab === 'meds') renderMeds();
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

  // Hero avatar + greeting
  const heroAv = document.getElementById('hero-avatar');
  if (heroAv) heroAv.textContent = avatar;

  if (isToday) {
    document.getElementById('today-greeting').textContent =
      getGreeting() + (firstName ? ', ' + firstName : '');
  } else {
    document.getElementById('today-greeting').textContent =
      firstName ? firstName : 'PillFlow';
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

  // Subtitle under greeting
  const subtitle = document.getElementById('today-subtitle');
  if (subtitle) {
    if (!isToday) {
      subtitle.textContent = formatDisplayDate(currentDate);
    } else if (total === 0) {
      subtitle.textContent = 'Няма хапчета за днес';
    } else if (taken === total) {
      subtitle.textContent = 'Всичко е взето ✓';
    } else {
      subtitle.textContent = `${taken} от ${total} взети`;
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

  let html = '';
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

      html += `
        <div class="pill-card bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-100 dark:border-slate-700/80 p-4 flex items-center gap-3.5 ${isTaken ? 'taken' : ''}">
          <div class="flex-1 min-w-0">
            <p class="pill-name font-semibold text-[15px] truncate text-slate-800 dark:text-slate-100">${med.name}</p>
            <p class="text-sm text-slate-400 dark:text-slate-500 mt-0.5 flex flex-wrap gap-x-1.5">
              ${med.dose ? `<span>${med.dose}</span>` : ''}
              ${med.form ? `<span>· ${med.form}</span>` : ''}
              ${condition ? `<span class="text-amber-500 dark:text-amber-400">· ${condition}</span>` : ''}
            </p>
            ${note ? `<p class="text-xs text-slate-400 mt-1">${note}</p>` : ''}
          </div>
          <button onclick="toggleTaken('${med.id}', '${time}')"
            class="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 text-lg
              ${isTaken
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                : 'bg-slate-50 dark:bg-slate-700/80 hover:bg-primary-50 dark:hover:bg-primary-900/40 text-slate-300 hover:text-primary-500 border border-slate-100 dark:border-slate-600'}">
            ${isTaken ? '✓' : ''}
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
      specific_days: 'Конкретни дни',
      course: 'Курс'
    };
    const condition = CONDITION_LABELS[med.condition] || '';

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
  document.querySelectorAll('.time-check').forEach(c => c.checked = false);
  document.querySelectorAll('.day-check').forEach(c => c.checked = false);
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

  document.querySelectorAll('.time-check').forEach(c => {
    c.checked = (med.times || []).includes(c.value);
  });
  document.querySelectorAll('.day-check').forEach(c => {
    c.checked = (med.days || []).includes(parseInt(c.value));
  });
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
    note: document.getElementById('med-note').value.trim(),
    updatedAt: new Date().toISOString()
  };

  if (firebaseReady) {
    if (editingMedId) {
      db.collection('users').doc(currentUser.uid).collection('meds').doc(editingMedId)
        .update(medData)
        .then(() => closeMedModal())
        .catch(err => alert('Грешка: ' + err.message));
    } else {
      medData.createdAt = new Date().toISOString();
      db.collection('users').doc(currentUser.uid).collection('meds').add(medData)
        .then(() => closeMedModal())
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
