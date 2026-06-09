const https = require('https');

const NOTION_VERSION = '2022-06-28';

const DB = {
  tasks:     'b43aa2cb03a94351b50e0c2e5e6ef998',
  habits:    'b67bc49098e74cabae1b88646b5abfbe',
  inventory: 'db5157429e0a41db834870127a58c949',
  finance:   '4bff6adfd43a4fda980be59f20d3bf15',
  wishlist:  '2ff525e0f783441db1d1009a139a678d',
  timetrack: '73e595478c19447cb2c8e7ad1cf210a2',
  meetings:  '89ea74e105bc400c96cd16a13684f1fe',
};

function queryDB(dbId, token, filter) {
  return new Promise((resolve, reject) => {
    const bodyObj = filter ? { filter } : {};
    const body = JSON.stringify(bodyObj);
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

const txt  = p => p?.title?.[0]?.plain_text || p?.rich_text?.[0]?.plain_text || '';
const sel  = p => p?.select?.name || null;
const num  = p => p?.number ?? null;
const date = p => p?.date?.start || null;
const chk  = p => p?.checkbox ?? false;
const url  = p => p?.url || null;
const frm  = p => p?.formula?.number ?? p?.formula?.string ?? null;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not set' });

  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayFilter = { property: 'Date', date: { equals: todayStr } };

    const [tasksRes, habitsRes, invRes, finRes, wishRes, timeRes, meetingsRes] = await Promise.all([
      queryDB(DB.tasks,     token),
      queryDB(DB.habits,    token),
      queryDB(DB.inventory, token),
      queryDB(DB.finance,   token),
      queryDB(DB.wishlist,  token),
      queryDB(DB.timetrack, token),
      queryDB(DB.meetings,  token, todayFilter),
    ]);

    const tasks = (tasksRes.results || []).map(p => ({
      id:            p.id,
      task:          txt(p.properties['Task']),
      ecosystem:     sel(p.properties['Ecosystem']),
      status:        sel(p.properties['Status']),
      assignee:      sel(p.properties['Assignee']),
      priority:      sel(p.properties['Priority']),
      frequency:     sel(p.properties['Frequency']),
      timeEst:       num(p.properties['Time Estimate (mins)']),
      dueDate:       date(p.properties['Due Date']),
      intendedDate:  date(p.properties['Intended Date']),
      completedDate: date(p.properties['Completed Date']),
      energyLevel:   sel(p.properties['Energy Level']),
      week:          sel(p.properties['Week']),
      blocked:       chk(p.properties['Blocked']),
      notes:         txt(p.properties['Notes']),
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
      id:        p.id,
      name:      txt(p.properties['Name']),
      type:      sel(p.properties['Type']),
      amount:    num(p.properties['Amount']),
      target:    num(p.properties['Target Amount']),
      ecosystem: sel(p.properties['Ecosystem']),
      status:    sel(p.properties['Status']),
      frequency: sel(p.properties['Frequency']),
    }));

    const wishlist = (wishRes.results || []).map(p => ({
      id:       p.id,
      item:     txt(p.properties['Item']),
      store:    txt(p.properties['Store']),
      cost:     num(p.properties['Cost']),
      category: sel(p.properties['Category']),
      priority: sel(p.properties['Priority']),
      status:   sel(p.properties['Status']),
      link:     url(p.properties['Link']),
    }));

    const timetrack = (timeRes.results || []).map(p => ({
      id:            p.id,
      project:       txt(p.properties['Project']),
      client:        sel(p.properties['Client']),
      date:          date(p.properties['Date']),
      startTime:     txt(p.properties['Start Time']),
      endTime:       txt(p.properties['End Time']),
      hoursWorked:   num(p.properties['Hours Worked']),
      rate:          num(p.properties['Rate']),
      totalAmount:   frm(p.properties['Total Amount']),
      invoiceStatus: sel(p.properties['Invoice Status']),
      notes:         txt(p.properties['Notes']),
    }));

    const meetings = (meetingsRes.results || []).map(p => ({
      id:          p.id,
      title:       txt(p.properties['Title']),
      date:        date(p.properties['Date']),
      startTime:   txt(p.properties['Start Time']),
      endTime:     txt(p.properties['End Time']),
      calendar:    txt(p.properties['Calendar']),
      location:    txt(p.properties['Location']),
      description: txt(p.properties['Description']),
    })).sort((a, b) => a.startTime.localeCompare(b.startTime));

    // DEBUG: include raw meetings response to diagnose token/access issues
    const meetingsDebug = meetingsRes.results ? null : { status: meetingsRes.status, code: meetingsRes.code, message: meetingsRes.message };

    res.json({ tasks, habits, inventory, finance, wishlist, timetrack, meetings, meetingsDebug, todayStr, ts: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
