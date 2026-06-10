const https = require('https');

// ─────────────────────────────────────────────
//  Calendars to fetch (v2)
// ─────────────────────────────────────────────
const CAL_IDS = [
  { id: 'brittlallen@gmail.com',                                       name: 'Personal',     color: '#EC4899' },
  { id: 'brittany@parkerwells.co',                                     name: 'Parker Wells', color: '#3B82F6' },
  { id: 'iambrittanylyn@gmail.com',                                    name: 'Creator',      color: '#8B5CF6' },
  { id: 'en.usa#holiday@group.v.calendar.google.com',                  name: 'Holidays',     color: '#10B981' },
  { id: 'qk9ba4kukmp8ail5vrnoagnkv5pvid20@import.calendar.google.com', name: 'GOTR',         color: '#F97316' },
];

// ─────────────────────────────────────────────
//  Exchange refresh token → access token
// ─────────────────────────────────────────────
function refreshAccessToken(clientId, clientSecret, refreshToken) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('Token refresh failed: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────
//  Fetch events from one calendar
// ─────────────────────────────────────────────
function fetchCalendarEvents(accessToken, calId, timeMin, timeMax) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '50',
    }).toString();

    const options = {
      hostname: 'www.googleapis.com',
      path:     `/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
      method:   'GET',
      headers:  { 'Authorization': `Bearer ${accessToken}` },
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
    req.end();
  });
}

// ─────────────────────────────────────────────
//  Handler
// ─────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Cache for 5 minutes — fresh enough for a dashboard
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    // Debug: show which vars are present/missing (no values exposed)
    return res.status(200).json({
      meetings: [],
      warning: 'Google Calendar env vars not set',
      debug: {
        hasClientId:     !!clientId,
        hasClientSecret: !!clientSecret,
        hasRefreshToken: !!refreshToken,
        googleKeys:      Object.keys(process.env).filter(k => k.startsWith('GOOGLE')),
        allKeyCount:     Object.keys(process.env).length,
      },
    });
  }

  try {
    const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);

    // Current week: Sunday 00:00 → Saturday 23:59
    const now = new Date();
    const sun = new Date(now);
    sun.setDate(now.getDate() - now.getDay());
    sun.setHours(0, 0, 0, 0);
    const sat = new Date(sun);
    sat.setDate(sun.getDate() + 6);
    sat.setHours(23, 59, 59, 999);

    const timeMin = sun.toISOString();
    const timeMax = sat.toISOString();

    const results = await Promise.allSettled(
      CAL_IDS.map(async (cal) => {
        try {
          const data = await fetchCalendarEvents(accessToken, cal.id, timeMin, timeMax);
          return (data.items || []).map(ev => ({
            title:    ev.summary || 'Untitled',
            start:    ev.start?.dateTime || ev.start?.date || '',
            end:      ev.end?.dateTime   || ev.end?.date   || '',
            allDay:   !ev.start?.dateTime,
            date:     (ev.start?.dateTime || ev.start?.date || '').slice(0, 10),
            calendar: cal.name,
            color:    cal.color,
          }));
        } catch (e) {
          console.error(`Calendar fetch failed for ${cal.id}:`, e.message);
          return [];
        }
      })
    );

    const meetings = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    meetings.sort((a, b) => a.start.localeCompare(b.start));

    res.json({ meetings, ts: new Date().toISOString() });
  } catch (err) {
    console.error('Calendar API error:', err);
    // Degrade gracefully — never break the dashboard
    res.status(200).json({ meetings: [], error: err.message });
  }
};
