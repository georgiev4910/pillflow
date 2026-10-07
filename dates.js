// PillFlow — date helpers (local timezone)
function formatDate(d) {
  const x = (d instanceof Date) ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function localDateInputValue(d) {
  return formatDate(d || new Date());
}

function parseLocalDate(str) {
  if (!str) return null;
  const p = String(str).split('-').map(Number);
  if (p.length < 3) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}

function isSameDay(d1, d2) {
  return formatDate(d1) === formatDate(d2);
}

function formatDisplayDate(d) {
  try {
    return d.toLocaleDateString('bg-BG', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (e) {
    return formatDate(d);
  }
}
