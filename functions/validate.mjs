// 赛程魔方 · 自包含文档校验（不引 npm 依赖，Deno/Node 通用）
// 平台无 CHECK 约束，一切输入校验在此。限额与前端 src/engine/types.ts LIMITS 一致。

const LIMITS = { teams: 64, venues: 16, judges: 32, slots: 400, matches: 2048, string: 200 };
const FORMATS = new Set(['round_robin', 'single_elim', 'swiss', 'double_elim']);

function bad(message) {
  const e = new Error(message);
  e.code = 'invalid_input';
  throw e;
}
const isStr = (v) => typeof v === 'string';
const isInt = (v) => Number.isInteger(v);
const str = (v, label, max = LIMITS.string) => {
  if (!isStr(v) || v.length === 0 || v.length > max) bad(`${label} 非法或超长`);
  return v;
};
const arr = (v, label, max) => {
  if (!Array.isArray(v) || v.length > max) bad(`${label} 非法或超出上限 ${max}`);
  return v;
};
const dateStr = (v, label) => {
  if (!isStr(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`${label} 日期格式非法`);
  return v;
};
const min = (v, label) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1440) bad(`${label} 分钟非法`);
  return v;
};

export function validateDoc(doc) {
  if (!doc || typeof doc !== 'object') bad('文档为空');
  if (doc.schemaVersion !== 1) bad('schemaVersion 必须为 1');
  if (!FORMATS.has(doc.format)) bad('赛制非法');
  str(doc.title, '标题');

  const teams = arr(doc.teams, '队伍', LIMITS.teams);
  const teamIds = new Set();
  for (const t of teams) {
    str(t.id, '队伍 id');
    str(t.name, '队伍名');
    if (teamIds.has(t.id)) bad('队伍 id 重复');
    teamIds.add(t.id);
    arr(t.unavailableDates ?? [], '队伍不可用日期', 366).forEach((d) => dateStr(d, '队伍不可用日期'));
  }

  const venues = arr(doc.venues, '场地', LIMITS.venues);
  const venueIds = new Set();
  for (const v of venues) {
    str(v.id, '场地 id');
    str(v.name, '场地名');
    if (venueIds.has(v.id)) bad('场地 id 重复');
    venueIds.add(v.id);
    if (!isInt(v.capacity) || v.capacity < 1 || v.capacity > 16) bad('场地容量须为 1–16');
  }

  const judges = arr(doc.judges, '评委', LIMITS.judges);
  const judgeIds = new Set();
  for (const j of judges) {
    str(j.id, '评委 id');
    str(j.name, '评委名');
    if (judgeIds.has(j.id)) bad('评委 id 重复');
    judgeIds.add(j.id);
    arr(j.affiliatedTeamIds ?? [], '评委回避队伍', LIMITS.teams).forEach((t) => {
      if (!teamIds.has(t)) bad('回避队伍不存在');
    });
    arr(j.unavailableDates ?? [], '评委不可用日期', 366).forEach((d) => dateStr(d, '评委不可用日期'));
  }

  arr(doc.timeBlocks ?? [], '时段块', 64).forEach((b) => {
    dateStr(b.date, '时段块日期');
    min(b.startMin, '起始');
    min(b.endMin, '结束');
    if (b.endMin <= b.startMin) bad('时段块结束须晚于起始');
    if (!isInt(b.matchMin) || b.matchMin < 1 || b.matchMin > 1440) bad('单场时长非法');
    if (!isInt(b.breakMin) || b.breakMin < 0 || b.breakMin > 1440) bad('场间休息非法');
  });

  const slots = arr(doc.slots, '时段', LIMITS.slots);
  const slotIds = new Set();
  for (const s of slots) {
    str(s.id, '时段 id');
    if (slotIds.has(s.id)) bad('时段 id 重复');
    slotIds.add(s.id);
    dateStr(s.date, '时段日期');
    min(s.startMin, '时段起始');
    min(s.endMin, '时段结束');
  }

  const c = doc.constraints;
  if (!c || typeof c !== 'object') bad('约束缺失');
  if (!isInt(c.minRestMin) || c.minRestMin < 0 || c.minRestMin > 1440) bad('最小休息非法');
  if (!isInt(c.roundGapMin) || c.roundGapMin < 0 || c.roundGapMin > 1440) bad('轮次间隔非法');
  if (!isInt(c.judgesPerMatch) || c.judgesPerMatch < 1 || c.judgesPerMatch > 2) bad('每场评委数须为 1–2');

  const matches = arr(doc.matches, '比赛', LIMITS.matches);
  const matchIds = new Set();
  for (const m of matches) {
    str(m.id, '比赛 id');
    if (matchIds.has(m.id)) bad('比赛 id 重复');
    matchIds.add(m.id);
    if (!isInt(m.round) || m.round < 1 || m.round > 256) bad('轮次非法');
    if (m.teamA !== null && !teamIds.has(m.teamA)) bad('甲方队伍不存在');
    if (m.teamB !== null && !teamIds.has(m.teamB)) bad('乙方队伍不存在');
    if (m.assignment) {
      const a = m.assignment;
      if (!slotIds.has(a.slotId)) bad('落位时段不存在');
      if (!venueIds.has(a.venueId)) bad('落位场地不存在');
      arr(a.judgeIds ?? [], '落位评委', 2).forEach((j) => {
        if (!judgeIds.has(j)) bad('落位评委不存在');
      });
    }
    if (m.result !== undefined && m.result !== null && !['A', 'B', 'draw'].includes(m.result)) bad('结果非法');
  }

  if (!doc.shareSettings || typeof doc.shareSettings.hideJudges !== 'boolean') bad('分享设置非法');
  return true;
}

export { LIMITS };