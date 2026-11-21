const JSON_HEADERS = { 'Content-Type': 'application/json' };

function response(body, status = 200, origin = '', env) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(origin, env) }
  });
}

function corsHeaders(origin, env) {
  const allowed = origin && origin === env.ALLOWED_ORIGIN ? origin : 'null';
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Vary': 'Origin' };
}

function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  return Boolean(env.API_TOKEN) && header === `Bearer ${env.API_TOKEN}`;
}

function validEntry(entry) {
  return entry && typeof entry.id === 'string' && /^[0-9a-f-]{36}$/i.test(entry.id) && typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(Number(entry.hours)) && Number(entry.hours) > 0 && Number(entry.hours) <= 24 && typeof entry.project === 'string' && entry.project.length <= 80 && typeof entry.note === 'string' && entry.note.length <= 180;
}

function toEntry(row) {
  return { id: row.id, date: row.date, hours: row.hours, project: row.project, note: row.note };
}

function jerusalemDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function dateFromTimestamp(timestamp) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp * 1000));
}

function parseCsvLine(line) {
  const fields = [];
  const pattern = /(?:^|,)(?:"((?:[^"]|"")*)"|([^",]*))/g;
  let match;
  while ((match = pattern.exec(line))) fields.push((match[1] ?? match[2]).replace(/""/g, '"'));
  return fields;
}

async function fallbackOpeningRate(today) {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 10);
  const startDate = start.toISOString().slice(0, 10);
  const fallbackResponse = await fetch(`https://data-api.ecb.europa.eu/service/data/EXR/D.USD+ILS.EUR.SP00.A?format=csvdata&startPeriod=${startDate}&endPeriod=${today}`);
  if (!fallbackResponse.ok) throw new Error(`Fallback rate request failed (${fallbackResponse.status})`);
  const rows = (await fallbackResponse.text()).trim().split('\n').slice(1).map(parseCsvLine);
  const rates = new Map();
  rows.forEach((row) => {
    const currency = row[2];
    const date = row[6];
    const value = Number(row[7]);
    if ((currency === 'USD' || currency === 'ILS') && date && Number.isFinite(value)) {
      rates.set(`${date}-${currency}`, value);
    }
  });
  const dates = [...new Set(rows.map((row) => row[6]).filter(Boolean))].sort().reverse();
  const marketDate = dates.find((date) => rates.has(`${date}-USD`) && rates.has(`${date}-ILS`));
  if (!marketDate) throw new Error('Fallback opening rate was not available');
  return { rate: rates.get(`${marketDate}-ILS`) / rates.get(`${marketDate}-USD`), marketDate, valueType: 'reference' };
}

async function openingRateResponse(request, origin, env) {
  const today = jerusalemDate();
  const cacheKey = new Request(`${new URL(request.url).origin}/api/rates/usd-ils?date=${today}&origin=${encodeURIComponent(origin || 'direct')}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const todayDay = new Date(`${today}T12:00:00Z`).getUTCDay();
  const useFridayClose = todayDay === 0 || todayDay === 6;
  let rate;
  try {
    const marketResponse = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/USDILS=X?period1=${now - 10 * 86400}&period2=${now + 86400}&interval=1d&events=history`);
    if (!marketResponse.ok) throw new Error(`Opening rate request failed (${marketResponse.status})`);
    const chart = await marketResponse.json();
    const result = chart.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0] || {};
    const validIndexes = timestamps.map((timestamp, index) => ({ index, date: dateFromTimestamp(timestamp) })).filter(({ index, date }) => date <= today && Number.isFinite(quote.open?.[index]) && Number.isFinite(quote.close?.[index]));
    const latest = validIndexes.at(-1);
    if (!latest) throw new Error('Opening rate was not available');
    const hasTodayCandle = latest.date === today;
    rate = { rate: hasTodayCandle && !useFridayClose ? quote.open[latest.index] : quote.close[latest.index], marketDate: latest.date, valueType: hasTodayCandle && !useFridayClose ? 'open' : 'close' };
  } catch {
    rate = await fallbackOpeningRate(today);
  }
  const rateResponse = response(rate, 200, origin, env);
  if (useFridayClose || rate.marketDate === today) await caches.default.put(cacheKey, rateResponse.clone());
  return rateResponse;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/rates/usd-ils') {
      try {
        return await openingRateResponse(request, origin, env);
      } catch (error) {
        return response({ error: error instanceof Error ? error.message : 'Rate request failed' }, 502, origin, env);
      }
    }
    if (!authorized(request, env)) return response({ error: 'Unauthorized' }, 401, origin, env);
    if (!url.pathname.startsWith('/api/entries')) return response({ error: 'Not found' }, 404, origin, env);

    try {
      if (request.method === 'GET' && url.pathname === '/api/entries') {
        const { results } = await env.DB.prepare('SELECT id, date, hours, project, note FROM entries ORDER BY date DESC').all();
        return response(results.map(toEntry), 200, origin, env);
      }

      const id = url.pathname.split('/').pop();
      if (request.method === 'POST' && url.pathname === '/api/entries') {
        const entry = await request.json();
        if (!validEntry(entry)) return response({ error: 'Invalid entry' }, 422, origin, env);
        await env.DB.prepare('INSERT INTO entries (id, date, hours, project, note) VALUES (?, ?, ?, ?, ?)').bind(entry.id, entry.date, entry.hours, entry.project, entry.note).run();
        return response(entry, 201, origin, env);
      }

      if ((request.method === 'PUT' || request.method === 'DELETE') && !id) return response({ error: 'Entry id required' }, 400, origin, env);
      if (request.method === 'PUT') {
        const entry = await request.json();
        if (!validEntry(entry) || entry.id !== id) return response({ error: 'Invalid entry' }, 422, origin, env);
        const result = await env.DB.prepare('UPDATE entries SET date = ?, hours = ?, project = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(entry.date, entry.hours, entry.project, entry.note, id).run();
        return response(result.meta.changes ? entry : { error: 'Not found' }, result.meta.changes ? 200 : 404, origin, env);
      }

      if (request.method === 'DELETE') {
        const result = await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
        return response(null, result.meta.changes ? 204 : 404, origin, env);
      }
      return response({ error: 'Method not allowed' }, 405, origin, env);
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : 'Request failed' }, 500, origin, env);
    }
  }
};
