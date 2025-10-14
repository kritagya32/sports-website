// mock-server.cjs
// Simple mock server for Chamba Registration Portal (CommonJS)
// Run: node mock-server.cjs
// Stores data in mock-db.json in same folder.

const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
const PORT = 3001;

app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// CORS (allow calls from localhost dev)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

const DB_PATH = path.join(__dirname, 'mock-db.json');

function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const raw = fs.readFileSync(DB_PATH, 'utf8');
            return JSON.parse(raw || '{}');
        }
    } catch (e) {
        console.warn('Failed reading DB:', e.message);
    }
    return { rows: [], deleteRequests: [] };
}

function saveDB(db) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.warn('Failed writing DB:', e.message);
    }
}

const db = loadDB();
if (!Array.isArray(db.rows)) db.rows = [];
if (!Array.isArray(db.deleteRequests)) db.deleteRequests = [];

// ensure each row has an id (retro-compatibility)
let nextId = db.rows.reduce((m, r) => {
    const idNum = r && r.id ? Number(r.id) : 0;
    return Number.isFinite(idNum) ? Math.max(m, idNum) : m;
}, 0) + 1;

// Helper to assign id
function assignId(row) {
    // if already has stable id, keep it
    if (row.id) return row;
    row.id = String(nextId++);
    return row;
}

// GET handler - supports ?action=getAll
app.get('/', (req, res) => {
    const action = (req.query.action || '').toString();
    if (action === 'getAll') {
        // return copy
        return res.json({ rows: db.rows.slice() });
    }
    return res.json({ message: 'Mock server root. Use ?action=getAll to fetch rows.' });
});

// POST root - supports body.action === 'appendMultiple'
app.post('/', (req, res) => {
    const action = req.body && req.body.action ? req.body.action : null;
    if (action === 'appendMultiple' && Array.isArray(req.body.rows)) {
        const incoming = req.body.rows;
        const appended = incoming.map(r => {
            const toSave = Object.assign({}, r);
            assignId(toSave);
            // ensure status present
            if (!toSave.status) toSave.status = 'Active';
            db.rows.push(toSave);
            return toSave;
        });
        saveDB(db);
        return res.json({ success: true, appended: appended.length, rows: appended });
    }

    return res.status(400).json({ success: false, message: 'Unrecognized action or missing rows' });
});

// POST /requestDelete
// body: { reqId, rowId (optional), teamId, name, timestamp, reason, requestedAt }
// If rowId matches an existing row -> mark that row status = 'Requested' and store the request
// else queue the request in db.deleteRequests
app.post('/requestDelete', (req, res) => {
    const payload = req.body || {};
    const { reqId, rowId, teamId, timestamp, reason, requestedAt } = payload;
    const request = {
        reqId: reqId || `req_${Date.now()}`,
        rowId: rowId || null,
        teamId: teamId || null,
        name: payload.name || '',
        timestamp: timestamp || null,
        reason: reason || '',
        requestedAt: requestedAt || new Date().toISOString()
    };

    let matched = null;
    if (request.rowId) {
        matched = db.rows.find(r => r.id && String(r.id) === String(request.rowId));
    }
    if (!matched && request.timestamp && request.teamId) {
        matched = db.rows.find(r => String(r.timestamp) === String(request.timestamp) && String(r.teamId).toLowerCase() === String(request.teamId).toLowerCase());
    }

    if (matched) {
        matched.status = 'Requested';
        db.deleteRequests.push(Object.assign({}, request, { matchedRowId: matched.id }));
        saveDB(db);
        return res.json({ success: true, message: 'Row marked Requested', rowId: matched.id });
    }

    // no matched row -> queue the request for admin to review
    db.deleteRequests.push(request);
    saveDB(db);
    return res.json({ success: true, message: 'Delete request queued (no matching row found)' });
});

// POST /approveDelete
// body: { action: 'approveDelete', rowId (optional), teamId, timestamp, reqId }
// Marks row status 'Deleted' if found. Returns success boolean.
app.post('/approveDelete', (req, res) => {
    const payload = req.body || {};
    const { rowId, teamId, timestamp, reqId } = payload;

    let matchedIndex = -1;
    if (rowId) {
        matchedIndex = db.rows.findIndex(r => r.id && String(r.id) === String(rowId));
    }
    if (matchedIndex === -1 && timestamp && teamId) {
        matchedIndex = db.rows.findIndex(r => String(r.timestamp) === String(timestamp) && String(r.teamId).toLowerCase() === String(teamId).toLowerCase());
    }

    if (matchedIndex !== -1) {
        db.rows[matchedIndex].status = 'Deleted';
        // also remove any delete request entries that relate to this row
        db.deleteRequests = db.deleteRequests.filter(d => !(d.rowId && d.rowId === db.rows[matchedIndex].id) && !(d.timestamp && d.timestamp === db.rows[matchedIndex].timestamp));
        saveDB(db);
        return res.json({ success: true, message: 'Row marked Deleted', rowId: db.rows[matchedIndex].id });
    }

    // If not found, try matching queued delete request and mark as handled
    const reqIndex = db.deleteRequests.findIndex(d => (d.reqId && reqId && d.reqId === reqId) || (d.rowId && rowId && String(d.rowId) === String(rowId)));
    if (reqIndex !== -1) {
        // remove the queued request
        const reqItem = db.deleteRequests.splice(reqIndex, 1)[0];
        saveDB(db);
        return res.json({ success: true, message: 'Delete request removed from queue (no matching row found in DB)', reqId: reqItem.reqId });
    }

    return res.status(404).json({ success: false, message: 'Row not found to approve delete' });
});

// GET /deleteRequests - list queued requests (for admin offline review)
app.get('/deleteRequests', (req, res) => {
    return res.json({ deleteRequests: db.deleteRequests.slice() });
});

// small health endpoint
app.get('/health', (req, res) => res.json({ ok: true, rows: db.rows.length, queuedDeleteRequests: db.deleteRequests.length }));

// start server
app.listen(PORT, () => {
    console.log(`Mock server running on http://localhost:${PORT}/`);
    console.log(`GET  /?action=getAll`);
    console.log(`POST /  body { action: 'appendMultiple', rows: [...] }`);
    console.log(`POST /requestDelete  body { reqId,rowId?,teamId,timestamp,reason }`);
    console.log(`POST /approveDelete  body { action:'approveDelete', rowId?, teamId?, timestamp?, reqId? }`);
});
