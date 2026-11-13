// 本地 fixtures only。setup.mjs 保持此目录在两个上传根之外。
// 用内存依赖执行真实业务路由（functions/routes.mjs），无需云凭据、无需 Deno。
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class LocalError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function createMemoryRuntime() {
  const tables = { tournaments: [] };
  const state = { failRead: false, loseCreate: false, conflict: false };
  function reset(empty = false) {
    tables.tournaments.length = 0;
    Object.assign(state, { failRead: false, loseCreate: false, conflict: false });
    if (empty) return;
    // 默认空库：前端首页自带示例副本，创建赛事时写入。
  }
  reset();

  const db = {
    from(table) {
      if (!(table in tables)) throw new LocalError('invalid_table', 400);
      const filters = [];
      const order = [];
      let mode = 'read';
      let values;
      let conflict;
      let columns;
      let count = 1000;
      const query = {
        select(value) { columns = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order(key, options = {}) { order.push([key, options.ascending !== false]); return query; },
        limit(value) { count = value; return query; },
        insert(value) { mode = 'insert'; values = value; return query; },
        insertIfAbsent(value, options) { mode = 'insert'; values = value; conflict = options.onConflict.split(','); return query; },
        update(value) { mode = 'update'; values = value; return query; },
        delete() { mode = 'delete'; return query; },
        then(fulfilled, rejected) {
          return Promise.resolve()
            .then(() => {
              let result;
              if (mode === 'insert') {
                if (conflict && tables[table].some((row) => conflict.every((key) => row[key] === values[key]))) result = [];
                else {
                  const row = { id: randomUUID(), created_at: new Date().toISOString(), version: 1, ...values };
                  tables[table].push(row);
                  result = [row];
                }
              } else {
                const matched = tables[table].filter((row) => filters.every(([key, value]) => row[key] === value));
                if (mode === 'update') { matched.forEach((row) => Object.assign(row, values)); result = matched; }
                else if (mode === 'delete') {
                  const ids = new Set(matched.map((r) => r.id));
                  tables[table] = tables[table].filter((row) => !ids.has(row.id));
                  result = matched;
                } else result = matched;
              }
              for (const [key, asc] of [...order].reverse())
                result = [...result].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (asc ? 1 : -1));
              result = result.slice(0, count).map((row) => (columns ? Object.fromEntries(columns.split(',').map((key) => [key, row[key]])) : { ...row }));
              return { data: result, error: null };
            })
            .then(fulfilled, rejected);
        },
      };
      return query;
    },
  };

  return {
    db,
    state,
    tables,
    reset,
    BackendError: LocalError,
    requireUser(ctx) { return ctx.user ?? null; },
  };
}

const controls = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地测试控制台</title><style>body{font:16px/1.7 system-ui;max-width:700px;margin:50px auto;padding:20px;color:#1f2937}button{font:inherit;padding:10px;margin:6px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;cursor:pointer}p{color:#64748b}</style><h1>本地测试控制台</h1><p>只影响本次内存数据，不连接云端。故障只影响下一次匹配请求；操作后回到编辑器重试。</p><p><a href="/">← 返回工作台</a></p><div id="controls"></div><p id="status" role="status"></p><script>const actions={'fail-read':'下一次读取失败','lose-create':'下一次创建成功但丢失响应','conflict':'下一次保存发生版本冲突','empty':'清空数据','reset':'重置'};for(const [action,label]of Object.entries(actions)){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{const r=await fetch('/__local/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});document.querySelector('#status').textContent=r.ok?'已设置：'+label:'设置失败'};document.querySelector('#controls').append(b)}</script></html>`;

export async function startLocalBackend(application, { port = 0 } = {}) {
  const runtime = createMemoryRuntime();
  const handle = application(runtime);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, `http://${incoming.headers.host}`);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new LocalError('invalid_host', 403);
      if (!['GET', 'HEAD'].includes(incoming.method) && incoming.headers.origin && incoming.headers.origin !== url.origin)
        throw new LocalError('invalid_origin', 403);
      let size = 0;
      const chunks = [];
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) throw new LocalError('payload_too_large', 413);
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      let response;
      if (url.pathname === '/__local/' && incoming.method === 'GET')
        response = new Response(controls, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      else if (url.pathname === '/__local/control' && incoming.method === 'POST') {
        const { action } = await request.json();
        if (action === 'reset' || action === 'empty') runtime.reset(action === 'empty');
        else if (action === 'fail-read') runtime.state.failRead = true;
        else if (action === 'lose-create') runtime.state.loseCreate = true;
        else if (action === 'conflict') runtime.state.conflict = true;
        else throw new LocalError('invalid_control', 400);
        response = Response.json({ ok: true });
      } else {
        const isRead = /^\/api\/tournaments\/[0-9a-f-]{36}$/.test(url.pathname) && request.method === 'GET';
        if (isRead && runtime.state.failRead) {
          runtime.state.failRead = false;
          throw new LocalError('database_unavailable', 503);
        }
        if (request.method === 'PATCH' && runtime.state.conflict) {
          runtime.state.conflict = false;
          const id = url.pathname.split('/').at(-1);
          const row = runtime.tables.tournaments.find((r) => r.id === id);
          if (row) row.version++; // 模拟另一处已更新 → 客户端 CAS 失败
        }
        response = await handle({ request, user: null });
        const create = url.pathname.endsWith('/api/tournaments') && request.method === 'POST';
        if (create && runtime.state.loseCreate) {
          runtime.state.loseCreate = false;
          response = Response.json({ error: 'response_lost' }, { status: 503 });
        }
      }
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(error instanceof LocalError ? error.status : 500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify({ error: error instanceof LocalError ? error.code : 'local_failure' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { runtime, server, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { application } = await import(/* @vite-ignore */ new URL('../functions/routes.mjs', import.meta.url).href);
  const backend = await startLocalBackend(application);
  process.env.RECORDS_LOCAL_API = backend.origin;
  const vite = await import('vite');
  let frontend;
  try {
    frontend = await vite.createServer();
    await frontend.listen();
    frontend.printUrls();
  } catch (error) {
    await backend.close();
    throw error;
  }
  console.log('Local fixture mode. Data resets on restart. Open /__local/ for failure controls.');
  const stop = async () => { await frontend.close(); await backend.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}