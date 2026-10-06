'use strict';

// Calcule de dată/oră în fusul orar Europe/Bucharest, fără dependențe externe.

const TZ = 'Europe/Bucharest';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23'
});

function localParts(epochMs) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(epochMs))) p[type] = value;
  return p;
}

/** Data locală (YYYY-MM-DD) în București. */
function localDate(epochMs = Date.now()) {
  const p = localParts(epochMs);
  return `${p.year}-${p.month}-${p.day}`;
}

function offsetMs(epochMs) {
  const p = localParts(epochMs);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Momentul (epoch ms) corespunzător datei locale + minutelor de la miezul nopții, ora Bucureștiului. */
function localToEpoch(dateStr, minutesOfDay) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  let epoch = guess - offsetMs(guess);
  const off2 = offsetMs(epoch);
  epoch = guess - off2;
  return epoch;
}

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** 0 = duminică … 6 = sâmbătă */
function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

module.exports = { TZ, localDate, localToEpoch, isValidDate, addDays, weekday };
