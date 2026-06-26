const https = require('https');

const NOTION_VERSION = '2022-06-28';
const HABIT_DB = '8cfe55a110564a898da74130dfaced20';
const TZ = 'America/Chicago';

// The checkbox property names in the Daily Habits DB (must match Notion exactly).
// These mirror the HABIT_TYPES map in api/notion.js — keep them in sync if habits change.
const HABITS = [
  'Read',
  'Walk/Workout',
  'Take Vitamins',
  'Drink 80 oz Water',
  'Devotion Time with God',
  'Make Bed',
];

function notionRequest(method, path, token, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request({ hostname: 'api.notion.com', path, method, headers }, (res) => {
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
    if (body) req.write(body);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
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
    const habit = (b.habit || '').toString();
    const value = b.value === true || b.value === 'true';

    if (!HABITS.includes(habit)) {
      return res.status(400).json({ error: `Unknown habit: "${habit}"` });
    }

    // "Today" in Brittany's timezone (matches the dashboard feed)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD

    // Find today's row (by Date), if it exists
    const query = await notionRequest('POST', `/v1/databases/${HABIT_DB}/query`, token, {
      filter: { property: 'Date', date: { equals: today } },
      page_size: 1,
    });
    const existing = (query.results || [])[0];

    let page;
    if (existing) {
      page = await notionRequest('PATCH', `/v1/pages/${existing.id}`, token, {
        properties: { [habit]: { checkbox: value } },
      });
    } else {
      const dayTitle = new Date().toLocaleDateString('en-US', {
        timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric',
      });
      page = await notionRequest('POST', '/v1/pages', token, {
        parent: { database_id: HABIT_DB },
        properties: {
          'Day':  { title: [{ text: { content: dayTitle } }] },
          'Date': { date: { start: today } },
          [habit]: { checkbox: value },
        },
      });
    }

    res.status(200).json({ ok: true, date: today, habit, value, id: page.id });
  } catch (err) {
    console.error('log-habit error:', err);
    res.status(500).json({ error: err.message });
  }
};
