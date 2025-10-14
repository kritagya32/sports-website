const BASE = import.meta.env.VITE_GOOGLE_SCRIPT_URL || window.__VITE_GOOGLE_SCRIPT_URL || 'http://localhost:3001';

export async function getAll() {
  const url = `${BASE}?action=getAll`;
  const r = await fetch(url);
  return r.json();
}

export async function append(data) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'append', data })
  });
  return r.json();
}

export async function requestDelete(idKey, id) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'requestDelete', idKey, id })
  });
  return r.json();
}

export async function approveDelete(idKey, id) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approveDelete', idKey, id })
  });
  return r.json();
}
