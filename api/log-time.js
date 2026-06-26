const https = require('https');

const NOTION_VERSION = '2022-06-28';
const TIMETRACK_DB = '73e595478c19447cb2c8e7ad1cf210a2';

function notionRequest(path, token, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.notion.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(json.message || `Notion error ${res.statusCode}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Read a JSON body (Vercel usually parses it, but be defensive)
function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not set' });

  try {
    const b = await readBody(req);

    const project = (b.project || '').toString().trim();
    const hours   = Number(b.hoursWorked);

    if (!project) return res.status(400).json({ error: 'Project name is required' });
    if (!isFinite(hours) || hours <= 0) return res.status(400).json({ error: 'Hours worked must be greater than 0' });

    // Build properties, only including ones we actually have values for.
    const properties = {
      'Project':        { title: [{ text: { content: project } }] },
      'Hours Worked':   { number: Math.round(hours * 100) / 100 },
      'Date':           { date: { start: b.date || new Date().toISOString().slice(0, 10) } },
      'Invoice Status': { select: { name: 'Uninvoiced' } },
    };

    if (b.client && b.client.toString().trim()) {
      properties['Client'] = { select: { name: b.client.toString().trim() } };
    }
    if (b.rate != null && b.rate !== '' && isFinite(Number(b.rate))) {
      properties['Rate'] = { number: Number(b.rate) };
    }
    if (b.startTime) properties['Start Time'] = { rich_text: [{ text: { content: b.startTime.toString() } }] };
    if (b.endTime)   properties['End Time']   = { rich_text: [{ text: { content: b.endTime.toString() } }] };
    if (b.notes)     properties['Notes']      = { rich_text: [{ text: { content: b.notes.toString() } }] };

    const page = await notionRequest('/v1/pages', token, {
      parent: { database_id: TIMETRACK_DB },
      properties,
    });

    res.status(200).json({ ok: true, id: page.id });
  } catch (err) {
    console.error('log-time error:', err);
    res.status(500).json({ error: err.message });
  }
};
