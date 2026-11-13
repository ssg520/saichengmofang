// 赛程魔方 · 业务路由（薄 CRUD + editToken 鉴权 + 幂等/版本 CAS + 校验）
// 依赖注入仅用于本地测试；index.ts 保留 Deno.serve。
// 匿名可用：创建/编辑不要求平台登录。editToken 由客户端生成，服务端只存 SHA-256 哈希。
// 浏览器永不直连数据库；分享端点绝不返回 token 哈希或 owner_id。

import { validateDoc } from './validate.mjs';

const BODY_LIMIT = 512 * 1024; // 官方示例 8KB 必须调大，否则 32 队文档存不进
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomShareId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let out = '';
  for (const b of bytes) out += B32[b % B32.length];
  return out;
}

export function application({ db, BackendError }) {
  const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
  const hex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const fail = (code, status) => {
    throw new BackendError(code, status);
  };
  const rows = (result) => {
    if (result.error) fail(result.error.code || 'database_unavailable', result.error.status || 503);
    return result.data;
  };

  async function input(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail('invalid_input', 400);
    const reader = request.body?.getReader();
    if (!reader) fail('invalid_input', 400);
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > BODY_LIMIT) {
          await reader.cancel();
          fail('payload_too_large', 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      fail('invalid_input', 400);
    }
  }

  function checkDoc(data) {
    try {
      validateDoc(data);
    } catch {
      fail('invalid_input', 400);
    }
  }

  // 尽力而为的实例内存限流（创建写入）
  const createWindow = [];
  function rateLimitCreate() {
    const now = Date.now();
    while (createWindow.length && createWindow[0] < now - 60_000) createWindow.shift();
    if (createWindow.length >= 60) fail('rate_limited', 429);
    createWindow.push(now);
  }

  async function tokenHash(request) {
    const token = request.headers.get('x-edit-token');
    if (!token || token.length > 200) fail('unauthorized', 403);
    return sha256Hex(token);
  }

  // 分享视图：按 hideJudges 剥离评委，绝不泄漏敏感字段
  function shareView(row) {
    const data = structuredClone(row.data);
    if (data?.shareSettings?.hideJudges) {
      data.judges = [];
      for (const m of data.matches ?? []) if (m.assignment) m.assignment.judgeIds = [];
    }
    return { id: row.id, shareId: row.share_id, title: row.title, version: row.version, format: data.format, data };
  }

  return async (ctx) => {
    const request = ctx.request;
    // Gateway 保留后缀但把 app 替换为部署的物理 Function 名；Provider 可能先剥离 /functions/v1。
    const pathname = new URL(request.url).pathname;
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) fail('not_found', 404);
    const path = match[1] || '/';

    if (path === '/api/health' && request.method === 'GET') return Response.json({ ok: true });

    // 创建（匿名 + 限流 + 幂等）
    if (path === '/api/tournaments' && request.method === 'POST') {
      rateLimitCreate();
      const body = await input(request);
      if (!uuid(body?.id) || !hex64(body?.editTokenHash) || typeof body?.title !== 'string' || !body.title.trim() || body.title.length > 200)
        fail('invalid_input', 400);
      checkDoc(body.data);
      if (body.data.title !== body.title) fail('invalid_input', 400);
      const now = new Date().toISOString();
      for (let attempt = 0; attempt < 3; attempt++) {
        const shareId = randomShareId();
        const res = await db
          .from('tournaments')
          .insertIfAbsent(
            {
              id: body.id,
              share_id: shareId,
              edit_token_hash: body.editTokenHash,
              owner_id: null,
              title: body.title,
              data: body.data,
              version: 1,
              created_at: now,
              updated_at: now,
            },
            { onConflict: 'id' },
          )
          .select('id,share_id,version');
        if (res.error) {
          if (String(res.error.code).includes('unique') || String(res.error.message || '').includes('share_id')) continue;
          fail(res.error.code || 'database_unavailable', res.error.status || 503);
        }
        if (res.data?.length)
          return Response.json({ id: res.data[0].id, shareId: res.data[0].share_id, version: res.data[0].version }, { status: 201 });
      }
      // 重试同 id：比对创建指纹（edit_token_hash），一致则恢复，绝不自动重放写
      const existing = rows(await db.from('tournaments').select('id,share_id,version,edit_token_hash').eq('id', body.id).limit(1));
      if (!existing?.length) fail('database_unavailable', 503);
      if (existing[0].edit_token_hash !== body.editTokenHash) fail('idempotency_conflict', 409);
      return Response.json({ id: existing[0].id, shareId: existing[0].share_id, version: existing[0].version });
    }

    // 组织者读取（editToken）
    const byId = path.match(/^\/api\/tournaments\/([0-9a-f-]{36})$/);
    if (byId && uuid(byId[1]) && request.method === 'GET') {
      const hash = await tokenHash(request);
      const found = rows(await db.from('tournaments').select('id,share_id,title,data,version').eq('id', byId[1]).eq('edit_token_hash', hash).limit(1));
      if (!found?.length) fail('not_found', 404);
      const r = found[0];
      return Response.json({ id: r.id, shareId: r.share_id, title: r.title, data: r.data, version: r.version });
    }

    // 版本 CAS 保存（editToken）
    if (byId && uuid(byId[1]) && request.method === 'PATCH') {
      const hash = await tokenHash(request);
      const body = await input(request);
      if (!Number.isInteger(body?.baseVersion) || body.baseVersion < 1 || body.baseVersion >= 2147483647) fail('invalid_input', 400);
      checkDoc(body.data);
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.slice(0, 200) : body.data.title;
      const updated = rows(
        await db
          .from('tournaments')
          .update({ data: body.data, title, version: body.baseVersion + 1, updated_at: new Date().toISOString() })
          .eq('id', byId[1])
          .eq('edit_token_hash', hash)
          .eq('version', body.baseVersion)
          .select('id,version'),
      );
      if (!updated?.length) fail('write_conflict', 409);
      return Response.json({ id: updated[0].id, version: updated[0].version });
    }

    // 删除（editToken）
    if (byId && uuid(byId[1]) && request.method === 'DELETE') {
      const hash = await tokenHash(request);
      const deleted = rows(await db.from('tournaments').delete().eq('id', byId[1]).eq('edit_token_hash', hash).select('id'));
      if (!deleted?.length) fail('not_found', 404);
      return Response.json({ ok: true });
    }

    // 公开分享（匿名只读）
    const byShare = path.match(/^\/api\/share\/([a-z2-7]{6,16})$/);
    if (byShare && request.method === 'GET') {
      const found = rows(await db.from('tournaments').select('id,share_id,title,data,version').eq('share_id', byShare[1]).limit(1));
      if (!found?.length) fail('not_found', 404);
      return Response.json(shareView(found[0]));
    }

    fail('not_found', 404);
  };
}