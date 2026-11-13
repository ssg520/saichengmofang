// 后端路由测试：用内存 fake 执行真实 functions/routes.mjs（Node 内置 test runner）
// 运行：node --test dev/routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { application } from '../functions/routes.mjs';
import { createMemoryRuntime } from './local.mjs';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TOKEN = 'test-edit-token-1234567890';
const ID = '11111111-1111-4111-8111-111111111111';

function makeDoc(title = '测试赛') {
  return {
    schemaVersion: 1,
    title,
    format: 'round_robin',
    teams: [
      { id: 'team-0', name: 'A', unavailableDates: [] },
      { id: 'team-1', name: 'B', unavailableDates: [] },
    ],
    venues: [{ id: 'venue-0', name: 'V1', capacity: 1 }],
    judges: [{ id: 'judge-0', name: 'J1', affiliatedTeamIds: [], unavailableDates: [] }],
    timeBlocks: [{ date: '2026-11-14', startMin: 540, endMin: 600, matchMin: 45, breakMin: 10 }],
    slots: [{ id: 'slot-0', date: '2026-11-14', startMin: 540, endMin: 585 }],
    constraints: { minRestMin: 15, roundGapMin: 15, judgesPerMatch: 1 },
    matches: [{ id: 'm-1', round: 1, teamA: 'team-0', teamB: 'team-1', assignment: null }],
    shareSettings: { hideJudges: false },
    updatedAt: new Date().toISOString(),
  };
}

function setup() {
  const runtime = createMemoryRuntime();
  const handle = application(runtime);
  const call = async (method, path, { body, token } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-edit-token'] = token;
    const request = new Request(`http://127.0.0.1/functions/v1/app${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // 镜像 index.ts 的 errorResponse：把 BackendError 转为稳定错误响应
    try {
      return await handle({ request, user: null });
    } catch (e) {
      return Response.json({ error: e.code || 'internal_failure' }, { status: e.status || 500 });
    }
  };
  return { runtime, call };
}

async function create(call, overrides = {}) {
  const editTokenHash = await sha256Hex(TOKEN);
  return call('POST', '/api/tournaments', {
    body: { id: ID, title: '测试赛', editTokenHash, data: makeDoc(), ...overrides },
  });
}

test('health 匿名可用', async () => {
  const { call } = setup();
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('创建返回 shareId/version，幂等重试恢复同一行', async () => {
  const { call } = setup();
  const res = await create(call);
  assert.equal(res.status, 201);
  const first = await res.json();
  assert.ok(first.shareId);
  assert.equal(first.version, 1);
  // 重试同 id 同指纹 → 恢复
  const retry = await create(call);
  assert.equal(retry.status, 200);
  const again = await retry.json();
  assert.equal(again.id, first.id);
  assert.equal(again.shareId, first.shareId);
});

test('创建指纹不一致 → idempotency_conflict 409', async () => {
  const { call } = setup();
  await create(call);
  const otherHash = await sha256Hex('another-token');
  const res = await create(call, { editTokenHash: otherHash });
  assert.equal(res.status, 409);
});

test('错误 token 读取 → 404（不泄漏存在性）', async () => {
  const { call } = setup();
  await create(call);
  const res = await call('GET', `/api/tournaments/${ID}`, { token: 'wrong-token' });
  assert.equal(res.status, 404);
});

test('正确 token 读取含 data/version', async () => {
  const { call } = setup();
  await create(call);
  const res = await call('GET', `/api/tournaments/${ID}`, { token: TOKEN });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.version, 1);
  assert.equal(body.data.title, '测试赛');
});

test('版本不匹配保存 → write_conflict 409 且不落库', async () => {
  const { call, runtime } = setup();
  await create(call);
  const res = await call('PATCH', `/api/tournaments/${ID}`, { token: TOKEN, body: { data: makeDoc('改'), baseVersion: 99 } });
  assert.equal(res.status, 409);
  assert.equal(runtime.tables.tournaments[0].version, 1);
  assert.equal(runtime.tables.tournaments[0].title, '测试赛');
});

test('正确版本保存 → version+1', async () => {
  const { call } = setup();
  await create(call);
  const res = await call('PATCH', `/api/tournaments/${ID}`, { token: TOKEN, body: { data: makeDoc('改'), baseVersion: 1 } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).version, 2);
});

test('分享读匿名可用，绝不返回 token 哈希/owner', async () => {
  const { call } = setup();
  const { shareId } = await (await create(call)).json();
  const res = await call('GET', `/api/share/${shareId}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.title, '测试赛');
  const text = JSON.stringify(body);
  assert.ok(!text.includes('edit_token_hash'));
  assert.ok(!text.includes('owner_id'));
  assert.ok(!text.includes(await sha256Hex(TOKEN)));
});

test('hideJudges 分享剥离评委', async () => {
  const { call } = setup();
  const doc = makeDoc();
  doc.shareSettings.hideJudges = true;
  doc.matches[0].assignment = { slotId: 'slot-0', venueId: 'venue-0', judgeIds: ['judge-0'] };
  const editTokenHash = await sha256Hex(TOKEN);
  const { shareId } = await (await call('POST', '/api/tournaments', { body: { id: ID, title: '测试赛', editTokenHash, data: doc } })).json();
  const body = await (await call('GET', `/api/share/${shareId}`)).json();
  assert.deepEqual(body.data.judges, []);
  assert.deepEqual(body.data.matches[0].assignment.judgeIds, []);
});

test('未知路径 → 404', async () => {
  const { call } = setup();
  const res = await call('GET', '/api/nope');
  assert.equal(res.status, 404);
});

test('超大载荷 → 413', async () => {
  const { call } = setup();
  const big = { id: ID, title: '测试赛', editTokenHash: await sha256Hex(TOKEN), data: makeDoc(), pad: 'x'.repeat(600 * 1024) };
  const res = await call('POST', '/api/tournaments', { body: big });
  assert.equal(res.status, 413);
});

test('非法文档 → 400', async () => {
  const { call } = setup();
  const bad = makeDoc();
  bad.format = 'invalid';
  const res = await create(call, { data: bad });
  assert.equal(res.status, 400);
});

test('GET 无副作用', async () => {
  const { call, runtime } = setup();
  await create(call);
  const before = runtime.tables.tournaments[0].version;
  await call('GET', `/api/tournaments/${ID}`, { token: TOKEN });
  assert.equal(runtime.tables.tournaments[0].version, before);
});

test('删除需正确 token', async () => {
  const { call, runtime } = setup();
  await create(call);
  const wrong = await call('DELETE', `/api/tournaments/${ID}`, { token: 'wrong' });
  assert.equal(wrong.status, 404);
  assert.equal(runtime.tables.tournaments.length, 1);
  const ok = await call('DELETE', `/api/tournaments/${ID}`, { token: TOKEN });
  assert.equal(ok.status, 200);
  assert.equal(runtime.tables.tournaments.length, 0);
});