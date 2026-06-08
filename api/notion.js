const https = require('https');

const NOTION_VERSION = '2022-06-28';

// ── Notion Database IDs ─────────────────────────────────────
const DB = {
  tasks:     'b43aa2cb03a94351b50e0c2e5e6ef998',
  habits:    'b67bc49098e74cabae1b88646b5abfbe',
  inventory: 'db5157429e0a41db834870127a58c949',
  finance:   '4bff6adfd43a4fda980be59f20d3bf15',
};

// ── Notion API helper ───────────────────────────────────────
function queryDB(dbId, token, filter = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(Object.keys(filter).length ? filter : {});
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/databases/${dbId}/query`,
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
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Property extractors ─────────────────────────────────────
const txt  = p => p?.title?.[0]?.plain_text || p?.rich_text?.[0]?.plain_text || '';
const sel  = p => p?.select?.name || null;
const num  = p => p?.number ?? null;
const date = p => p?.date?.start || null;
const chk  = p => p?.checkbox ?? false;

// ── Main handler ────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not set' });

  try {
    const [tasksRes, habitsRes, invRes, finRes] = await Promise.all([
      queryDB(DB.tasks,     token),
      queryDB(DB.habits,    token),
      queryDB(DB.inventory, token),
      queryDB(DB.finance,   token),
    ]);

    const tasks = (tasksRes.results || []).map(p => ({
      id:          p.id,
      task:        txt(p.properties['Task']),
      ecosystem:   sel(p.properties['Ecosystem']),
      status:      sel(p.properties['Status']),
      assignee:    sel(p.properties['Assignee']),
      priority:    sel(p.properties['Priority']),
      frequency:   sel(p.properties['Frequency']),
      timeEst:     num(p.properties['Time Estimate (mins)']),
      dueDate:     date(p.properties['Due Date']),
      notes:       txt(p.properties['Notes']),
    }));

    const habits = (habitsRes.results || []).map(p => ({
      id:        p.id,
      habit:     txt(p.properties['Habit']),
      category:  sel(p.properties['Category']),
      frequency: sel(p.properties['Frequency']),
      active:    chk(p.properties['Active']),
    }));

    const inventory = (invRes.results || []).map(p => ({
      id:          p.id,
      item:        txt(p.properties['Item']),
      category:    sel(p.properties['Category']),
      status:      sel(p.properties['Status']),
      quantity:    num(p.properties['Quantity']),
      unit:        sel(p.properties['Unit']),
      lastChecked: date(p.properties['Last Checked']),
    }));

    const finance = (finRes.results || []).map(p => ({
      id:       p.id,
      name:     txt(p.properties['Name']),
      type:     sel(p.properties['Type']),
      amount:   num(p.properties['Amount']),
      target:   num(p.properties['Target Amount']),
      ecosystem:sel(p.properties['Ecosystem']),
      status:   sel(p.properties['Status']),
      frequency:sel(p.properties['Frequency']),
    }));

    res.json({ tasks, habits, inventory, finance, ts: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
