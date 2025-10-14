// mock-server.cjs
// CommonJS mock server for local dev - supports appendMultiple, delete, deletion requests, etc.

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const PORT = process.env.MOCK_SERVER_PORT || 3001;
const DB_FILE = path.join(__dirname, 'mock-db.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize DB file if missing
function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const init = { rows: [], deleteRequests: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), 'utf8');
      return init;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw || raw.trim() === '') {
      const init = { rows: [], deleteRequests: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), 'utf8');
      return init;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load DB file:', err);
    return { rows: [], deleteRequests: [] };
  }
}

function saveDb(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to save DB file:', err);
    return false;
  }
}

let db = loadDb();

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function normalizeRow(r) {
  return {
    id: r.id || genId(),
    teamId: r.teamId || '',
    name: r.name || '',
    gender: r.gender || '',
    age: r.age || '',
    designation: r.designation || '',
    phone: r.phone || '',
    blood: r.blood || '',
    ageClass: r.ageClass || '',
    vegNon: r.vegNon || '',
    sports: Array.isArray(r.sports) ? r.sports : (r.sports ? [r.sports] : []),
    photoBase64: r.photoBase64 || '',
    timestamp: r.timestamp || new Date().toISOString()
  };
}

// Utility to ensure db has both keys
function ensureDbShape() {
  if (!db) db = {};
  if (!Array.isArray(db.rows)) db.rows = [];
  if (!Array.isArray(db.deleteRequests)) db.deleteRequests = [];
}
ensureDbShape();

// GET /?action=getAll
app.get('/', (req, res) => {
  const action = (req.query && req.query.action) || '';
  if (action === 'getAll') {
    ensureDbShape();
    return res.json({ rows: db.rows });
  }
  res.json({ message: 'Mock server running', rowsCount: db.rows.length });
});

// POST /  { action: 'appendMultiple', rows: [...] }
app.post('/', (req, res) => {
  try {
    const data = req.body || {};
    if (data.action === 'appendMultiple' && Array.isArray(data.rows)) {
      ensureDbShape();
      const incoming = data.rows;
      const toAppend = incoming.map(normalizeRow);
      db.rows = db.rows.concat(toAppend);
      const ok = saveDb(db);
      if (!ok) return res.status(500).json({ success: false, message: 'Failed to persist DB' });
      return res.json({ success: true, appended: toAppend.length, ids: toAppend.map(r => r.id) });
    }
    return res.status(400).json({ success: false, message: 'Invalid payload. Expect { action: "appendMultiple", rows: [...] }' });
  } catch (err) {
    console.error('POST / error:', err);
    return res.status(500).json({ success: false, message: String(err) });
  }
});

// POST /delete  { id: '...' }  - hard delete
app.post('/delete', (req, res) => {
  try {
    ensureDbShape();
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, message: 'id required' });
    const idx = db.rows.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'row not found' });
    const removed = db.rows.splice(idx, 1);
    const ok = saveDb(db);
    if (!ok) return res.status(500).json({ success: false, message: 'Failed to persist DB after delete' });
    return res.json({ success: true, removed: removed.length, id });
  } catch (err) {
    console.error('POST /delete error:', err);
    return res.status(500).json({ success: false, message: String(err) });
  }
});

// POST /requestDelete  { rowId, teamId, name, reason, requestedAt }
app.post('/requestDelete', (req, res) => {
  try {
    ensureDbShape();
    const payload = req.body || {};
    const rowId = payload.rowId || payload.id || null;
    const teamId = payload.teamId || '';
    const name = payload.name || '';
    const reason = payload.reason || '';
    const requestedAt = payload.requestedAt || new Date().toISOString();
    if (!rowId) return res.status(400).json({ success: false, message: 'rowId required' });
    const request = {
      id: payload.id || genId(),
      rowId,
      teamId,
      name,
      reason,
      requestedAt,
      status: 'pending' // pending / approved / rejected
    };
    db.deleteRequests.push(request);
    const ok = saveDb(db);
    if (!ok) return res.status(500).json({ success: false, message: 'Failed to persist request' });
    return res.json({ success: true, request });
  } catch (err) {
    console.error('POST /requestDelete error:', err);
    return res.status(500).json({ success: false, message: String(err) });
  }
});

// GET /deleteRequests
app.get('/deleteRequests', (req, res) => {
  try {
    ensureDbShape();
    return res.json({ requests: db.deleteRequests });
  } catch (err) {
    console.error('GET /deleteRequests error:', err);
    return res.status(500).json({ success: false, message: String(err) });
  }
});

// POST /deleteRequest  { id, action: 'reject'|'approve' (optional) }
// If action === 'approve', server will attempt to delete the row and mark request as approved.
app.post('/deleteRequest', (req, res) => {
  try {
    ensureDbShape();
    const payload = req.body || {};
    const id = payload.id;
    const action = payload.action || ''; // 'approve'|'reject' or ''
    if (!id) return res.status(400).json({ success: false, message: 'id required' });
    const idx = db.deleteRequests.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'request not found' });
    const reqObj = db.deleteRequests[idx];

    if (action === 'approve') {
      // attempt to delete the row
      const rowIdx = db.rows.findIndex(r => r.id === reqObj.rowId);
      if (rowIdx !== -1) {
        db.rows.splice(rowIdx, 1);
      }
      reqObj.status = 'approved';
      reqObj.processedAt = new Date().toISOString();
    } else if (action === 'reject') {
      reqObj.status = 'rejected';
      reqObj.processedAt = new Date().toISOString();
    } else {
      // default: remove request (treat as handled)
      db.deleteRequests.splice(idx, 1);
      const ok = saveDb(db);
      if (!ok) return res.status(500).json({ success: false, message: 'Failed to persist DB after removing request' });
      return res.json({ success: true, removedRequestId: id });
    }

    // persist updated request list and rows
    const ok = saveDb(db);
    if (!ok) return res.status(500).json({ success: false, message: 'Failed to persist DB after processing request' });
    return res.json({ success: true, request: reqObj });
  } catch (err) {
    console.error('POST /deleteRequest error:', err);
    return res.status(500).json({ success: false, message: String(err) });
  }
});

// GET /submittedCount?teamId=...
app.get('/submittedCount', (req, res) => {
  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ success: false, message: 'teamId required' });
    ensureDbShape();
    const count = db.rows.filter(r => String(r.teamId || '').toLowerCase() === String(teamId).toLowerCase()).length;
    return res.json({ success: true, teamId, count });
  } catch (err) {
    console.error('GET /submittedCount error:', err);
    return res.status(500).json({ success: false, message: String(err) });
  }
});

// POST /clear  -> clears DB (rows + deleteRequests)
app.post('/clear', (req, res) => {
  try {
    db = { rows: [], deleteRequests: [] };
    const ok = saveDb(db);
    if (!ok) return res.status(500).json({ success: false, message: 'Failed to clear DB' });
    return res.json({ success: true, message: 'mock DB cleared' });
  } catch (err) {
    console.error('POST /clear error:', err);
    return res.status(500).json({ success: false, message: String(err) });
  }
});

// health
app.get('/health', (req, res) => res.json({ ok: true, rows: db.rows.length, requests: db.deleteRequests.length }));

app.listen(PORT, () => {
  console.log(`Mock server (CommonJS) listening on http://localhost:${PORT}`);
  console.log(`GET  /?action=getAll`);
  console.log(`POST /  { action: 'appendMultiple', rows: [...] }`);
  console.log(`POST /delete  { id: '...' }`);
  console.log(`POST /requestDelete  { rowId, teamId, name, reason, requestedAt }`);
  console.log(`GET  /deleteRequests`);
  console.log(`POST /deleteRequest  { id, action:'approve'|'reject' }`);
  console.log(`GET  /submittedCount?teamId=Chamba`);
  console.log(`POST /clear`);
});
