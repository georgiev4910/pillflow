// PillFlow — log entry helpers (supports legacy boolean + {taken, reason})
const SKIP_REASON_LABELS = {
  forgotten: 'Забравих',
  out_of_stock: 'Свършиха',
  doctor: 'По лекарска препоръка',
  side_effects: 'Странични ефекти',
  other: 'Друго'
};

function isLogTaken(dayLog, key) {
  if (!dayLog) return false;
  const v = dayLog[key];
  if (v === true) return true;
  if (v && typeof v === 'object') return !!v.taken;
  return false;
}

function getLogReason(dayLog, key) {
  if (!dayLog) return null;
  const v = dayLog[key];
  if (v && typeof v === 'object' && v.reason) return v.reason;
  return null;
}

function logEntryTaken() {
  return true; // stored as true for compactness
}

function logEntrySkipped(reason) {
  return { taken: false, reason: reason || 'other', at: new Date().toISOString() };
}
