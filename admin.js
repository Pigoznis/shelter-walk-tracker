const ADMIN_PASSWORD = 'shelter123';

const loginForm = document.getElementById('admin-login-form');
const adminPanel = document.getElementById('admin-panel');
const passwordInput = document.getElementById('admin-password');
const logoutBtn = document.getElementById('logout-btn');
const kennelTableBody = document.getElementById('kennel-table-body');
const activityLog = document.getElementById('activity-log');
const totalKennelsEl = document.getElementById('total-kennels');
const totalLogsEl = document.getElementById('total-logs');
const latestActivityEl = document.getElementById('latest-activity');

function isLoggedIn() {
  return sessionStorage.getItem('adminLoggedIn') === 'true';
}

function setLoggedInState(loggedIn) {
  sessionStorage.setItem('adminLoggedIn', String(loggedIn));
  adminPanel.classList.toggle('hidden', !loggedIn);
  loginForm.classList.toggle('hidden', loggedIn);

  if (loggedIn) {
    loadAdminData();
  }
}

function formatDateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options || {});
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

function renderTable(rows) {
  kennelTableBody.innerHTML = '';

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.kennel_id || '—'}</td>
      <td>${formatDateLabel(row.timestamp)}</td>
      <td>${row.name || '—'}</td>
      <td>${row.comment || 'No comment'}</td>
    `;
    kennelTableBody.appendChild(tr);
  });
}

function renderActivity(entries) {
  activityLog.innerHTML = '';

  if (!entries.length) {
    const li = document.createElement('li');
    li.textContent = 'No activity recorded yet.';
    activityLog.appendChild(li);
    return;
  }

  entries.slice(0, 20).forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${formatDateLabel(entry.timestamp)} | ${entry.action} | ${entry.boxId || 'system'}`;
    activityLog.appendChild(li);
  });
}

async function loadAdminData() {
  try {
    const [dogs, activities] = await Promise.all([
      fetchJson('/api/dogs'),
      fetchJson('/api/activity')
    ]);

    const rows = Array.isArray(dogs) ? dogs : [];
    const entries = Array.isArray(activities) ? activities : [];

    totalKennelsEl.textContent = String(rows.length);
    totalLogsEl.textContent = String(entries.length);
    latestActivityEl.textContent = entries.length ? formatDateLabel(entries[0].timestamp) : '-';

    renderTable(rows);
    renderActivity(entries);
  } catch (error) {
    console.error('Failed to load admin data:', error);
    totalKennelsEl.textContent = '0';
    totalLogsEl.textContent = '0';
    latestActivityEl.textContent = '-';
    renderTable([]);
    renderActivity([]);
  }
}

loginForm.addEventListener('submit', function (event) {
  event.preventDefault();

  const entered = passwordInput.value.trim();

  if (entered === ADMIN_PASSWORD) {
    setLoggedInState(true);
    passwordInput.value = '';
    return;
  }

  alert('Incorrect password.');
  passwordInput.value = '';
  passwordInput.focus();
});

logoutBtn.addEventListener('click', function () {
  setLoggedInState(false);
  passwordInput.value = '';
  passwordInput.focus();
});

if (isLoggedIn()) {
  setLoggedInState(true);
} else {
  setLoggedInState(false);
}
