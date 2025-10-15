// api/proxy.js
// Vercel Serverless Function — forwards requests to your Google Apps Script
// Uses global fetch provided by Vercel runtimes (no node-fetch dependency)

export default async function handler(req, res) {
  const SCRIPT_URL = process.env.VITE_GOOGLE_SCRIPT_URL || process.env.VITE_APPS_SCRIPT_URL;
  if (!SCRIPT_URL) {
    return res.status(500).json({ success: false, error: 'Missing Apps Script URL in server env' });
  }

  try {
    // forward request to Apps Script
    const forwardRes = await fetch(SCRIPT_URL, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body)
    });

    const text = await forwardRes.text();

    try {
      const json = JSON.parse(text);
      return res.status(forwardRes.status).json(json);
    } catch (e) {
      res.status(forwardRes.status).setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(text);
    }
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(502).json({ success: false, error: 'Proxy failed', details: String(err) });
  }
}