// api/proxy.js
// Vercel serverless function (Node) that forwards requests to your Apps Script
import fetch from 'node-fetch';

export default async function handler(req, res) {
  // server-side env: set this in Vercel as VITE_GOOGLE_SCRIPT_URL (or VITE_APPS_SCRIPT_URL)
  const SCRIPT_URL = process.env.VITE_GOOGLE_SCRIPT_URL || process.env.VITE_APPS_SCRIPT_URL;
  if (!SCRIPT_URL) {
    return res.status(500).json({ success: false, error: 'Missing Apps Script URL in server env' });
  }

  try {
    // forward body as JSON
    const forwardRes = await fetch(SCRIPT_URL, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      // body: JSON.stringify(req.body) -> req.body is already parsed by Vercel runtime only for JSON content-type
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body)
    });

    const text = await forwardRes.text();
    // try parse JSON, else return text
    try {
      const j = JSON.parse(text);
      return res.status(forwardRes.status).json(j);
    } catch (e) {
      res.status(forwardRes.status).setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(text);
    }
  } catch (err) {
    console.error('proxy error', err);
    return res.status(502).json({ success: false, error: 'Proxy failed', details: err.message });
  }
}
