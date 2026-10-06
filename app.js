// ==================== FIREBASE INIT ====================
let auth = null;
let db = null;
let firebaseReady = false;

try {
  if (typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('...')) {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    firebaseReady = true;
    console.log('✅ Firebase connected');
  } else {
    console.warn('⚠️ Firebase config липсва или е примерна. Работим в локален режим.');
  }
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

let unsubMeds = null;
let unsubLogs = null;

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
}

// ==================== ENTER APP ====================
function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-greeting').textContent = `Здравей, ${currentUser.displayName || currentUser.email}`;
  document.getElementById('settings-email').textContent = currentUser.email + (firebaseReady ? ' · облак' : ' · локално');
  currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
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

  if (med.frequency === 'daily') return true;

  if (med.frequency === 'every_other') {
    const ref = med.startDate ? new Date(med.startDate) : new Date(med.createdAt || Date.now());
    ref.setHours(0, 0, 0, 0);
    const diff = Math.floor((date - ref) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff % 2 === 0;
  }

  if (med.frequency === 'specific_days') {
    return (med.days || []).includes(dayOfWeek);
  }

  if (med.frequency === 'course') {
    if (!med.startDate) return false;
    const start = new Date(med.startDate);
    start.setHours(0, 0, 0, 0);
    const end = med.endDate ? new Date(med.endDate) : null;
    if (end) end.setHours(0, 0, 0, 0);
    return date >= start && (!end || date <= end);
  }

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

function renderToday() {
  const dateStr = formatDate(currentDate);
  const isToday = isSameDay(currentDate, new Date());
  document.getElementById('today-date').textContent = isToday ? 'Днес' : formatDisplayDate(currentDate);

  const dayMeds = getMedsForDate(currentDate);
  const dayLog = logs[dateStr] || {};

  let total = 0, taken = 0;
  dayMeds.forEach(med => {
    (med.times || []).forEach(t => {
      total++;
      if (dayLog[`${med.id}_${t}`]) taken++;
    });
  });
  document.getElementById('today-progress').textContent = `${taken} / ${total} взети`;

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

  let html = '';
  ['morning', 'noon', 'evening', 'night'].forEach(timeKey => {
    const items = sections[timeKey];
    if (items.length === 0) return;

    html += `<div>
      <h3 class="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">${TIME_LABELS[timeKey]}</h3>
      <div class="space-y-2">`;

    items.forEach(({ med, time }) => {
      const key = `${med.id}_${time}`;
      const isTaken = !!dayLog[key];
      const condition = CONDITION_LABELS[med.condition] || '';
      const note = med.note ? ` · ${med.note}` : '';

      html += `
        <div class="pill-card bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3 ${isTaken ? 'taken' : ''}">
          <div class="flex-1 min-w-0">
            <p class="pill-name font-semibold truncate">${med.name}</p>
            <p class="text-sm text-slate-500 dark:text-slate-400">
              ${med.dose || ''} ${med.form ? '· ' + med.form : ''}
              ${condition ? '· <span class="text-amber-600 dark:text-amber-400">' + condition + '</span>' : ''}
              ${note}
            </p>
          </div>
          <button onclick="toggleTaken('${med.id}', '${time}')"
            class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition
              ${isTaken
                ? 'bg-accent-500 text-white'
                : 'bg-slate-100 dark:bg-slate-700 hover:bg-primary-100 dark:hover:bg-primary-900 text-slate-400 hover:text-primary-500'}">
            ${isTaken ? '✓' : '○'}
          </button>
        </div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;
}

function toggleTaken(medId, time) {
  const dateStr = formatDate(currentDate);
  const key = `${medId}_${time}`;
  const current = !!(logs[dateStr] && logs[dateStr][key]);

  if (firebaseReady) {
    const ref = db.collection('users').doc(currentUser.uid).collection('logs').doc(dateStr);
    if (current) {
      ref.update({ [key]: firebase.firestore.FieldValue.delete() }).catch(() => {
        ref.set({}, { merge: true });
      });
    } else {
      ref.set({ [key]: true }, { merge: true });
    }
  } else {
    if (!logs[dateStr]) logs[dateStr] = {};
    if (current) delete logs[dateStr][key];
    else logs[dateStr][key] = true;
    saveLocalData(currentUser.uid, { meds, logs });
    renderToday();
    renderCalendar();
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
  document.getElementById('med-start').value = '';
  document.getElementById('med-end').value = '';
  document.querySelectorAll('.time-check').forEach(c => c.checked = false);
  document.querySelectorAll('.day-check').forEach(c => c.checked = false);
  toggleFrequencyOptions();
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

  document.querySelectorAll('.time-check').forEach(c => {
    c.checked = (med.times || []).includes(c.value);
  });
  document.querySelectorAll('.day-check').forEach(c => {
    c.checked = (med.days || []).includes(parseInt(c.value));
  });
  toggleFrequencyOptions();
  document.getElementById('med-modal').classList.remove('hidden');
}

function closeMedModal() {
  document.getElementById('med-modal').classList.add('hidden');
}

function toggleFrequencyOptions() {
  const freq = document.getElementById('med-frequency').value;
  document.getElementById('specific-days-options').classList.toggle('hidden', freq !== 'specific_days');
  document.getElementById('course-options').classList.toggle('hidden', freq !== 'course');
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

  const medData = {
    name,
    dose: document.getElementById('med-dose').value.trim(),
    form: document.getElementById('med-form').value,
    times,
    condition: document.getElementById('med-condition').value,
    frequency,
    days,
    startDate: document.getElementById('med-start').value || null,
    endDate: document.getElementById('med-end').value || null,
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
    if (total > 0) {
      if (taken === total) {
        statusClass = 'bg-emerald-50 dark:bg-emerald-900/20';
        dot = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>';
      } else if (taken > 0) {
        statusClass = 'bg-amber-50 dark:bg-amber-900/20';
        dot = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>';
      } else if (date <= today) {
        statusClass = 'bg-red-50 dark:bg-red-900/10';
        dot = '<span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>';
      } else {
        dot = '<span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></span>';
      }
    }

    const isToday = isSameDay(date, today);
    const isSelected = isSameDay(date, currentDate);

    html += `
      <div onclick="selectCalendarDay(${year}, ${month}, ${d})"
        class="bg-white dark:bg-slate-800 p-2 min-h-[52px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition ${statusClass}
          ${isToday ? 'ring-2 ring-inset ring-primary-500' : ''}
          ${isSelected ? 'bg-primary-50 dark:bg-primary-900/30' : ''}">
        <div class="text-sm font-medium ${isToday ? 'text-primary-600' : ''}">${d}</div>
        <div class="mt-1 flex justify-center">${dot}</div>
      </div>`;
  }

  document.getElementById('calendar-grid').innerHTML = html;
}

function selectCalendarDay(year, month, day) {
  currentDate = new Date(year, month, day);
  currentDate.setHours(0, 0, 0, 0);
  renderCalendar();

  const dayMeds = getMedsForDate(currentDate);
  const detail = document.getElementById('calendar-day-detail');
  const list = document.getElementById('calendar-day-list');
  document.getElementById('calendar-day-title').textContent = formatDisplayDate(currentDate);

  if (dayMeds.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-500">Няма медикаменти за този ден</p>';
  } else {
    const dayLog = logs[formatDate(currentDate)] || {};
    list.innerHTML = dayMeds.map(med => {
      const times = (med.times || []).map(t => {
        const taken = dayLog[`${med.id}_${t}`];
        return `<span class="${taken ? 'text-emerald-600' : 'text-slate-500'}">${TIME_LABELS[t]}${taken ? ' ✓' : ''}</span>`;
      }).join(', ');
      return `<div class="text-sm bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
        <span class="font-medium">${med.name}</span> <span class="text-slate-400">· ${times}</span>
      </div>`;
    }).join('');
  }
  detail.classList.remove('hidden');
}

// ==================== SETTINGS ====================
function toggleDarkMode() {
  document.documentElement.classList.toggle('dark');
  const isDark = document.documentElement.classList.contains('dark');
  document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('pillflow_theme', isDark ? 'dark' : 'light');
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
  const savedTheme = localStorage.getItem('pillflow_theme');
  if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
    document.getElementById('theme-icon').textContent = '☀️';
  }

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
      }
    });
  } else {
    const session = localStorage.getItem('pillflow_session');
    if (session) {
      currentUser = JSON.parse(session);
      enterApp();
    }
  }
}

init();
