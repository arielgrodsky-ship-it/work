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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    if (!authorized(request, env)) return response({ error: 'Unauthorized' }, 401, origin, env);

    const url = new URL(request.url);
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
