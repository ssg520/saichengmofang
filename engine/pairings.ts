// 赛程魔方 · 对阵生成（赛制插件）
// 设计原则：对阵生成与约束分配彻底解耦——新增赛制只加一个生成器，求解器不动。
// 循环赛复用 roundrobin（轮转法），瑞士制复用 swiss-pairing（积分排序+避免重赛）。
// 单败/双败的种子位序与路由表为本项目自研。

import robin from 'roundrobin';
import createSwiss from 'swiss-pairing';
import { newId, type Format, type Match, type MatchResult, type TournamentDoc } from './types';

// ---- 循环赛 ----
export function generateRoundRobin(teamIds: string[]): Match[] {
  const n = teamIds.length;
  if (n < 2) return [];
  const rounds = robin(n, teamIds);
  const matches: Match[] = [];
  rounds.forEach((pairs, r) => {
    for (const [away, home] of pairs) {
      matches.push({
        id: newId(),
        round: r + 1,
        teamA: home,
        teamB: away,
        label: `第${r + 1}轮`,
      });
    }
  });
  return matches;
}

// ---- 工具 ----
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// 标准种子位序：1 号与 2 号分居两半区，轮空优先给高种子
function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const m = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(m + 1 - s);
    }
    order = next;
  }
  return order;
}

// ---- 单败淘汰 ----
export function generateSingleElim(teamIds: string[]): Match[] {
  const n = teamIds.length;
  if (n < 2) return [];
  const B = nextPow2(n);
  const R = Math.log2(B);
  const order = seedOrder(B);
  // 预分配每轮每席的 id
  const ids: string[][] = [];
  for (let r = 1; r <= R; r++) ids[r] = Array.from({ length: B / 2 ** r }, () => newId());

  const matches: Match[] = [];
  let advancers: (string | null)[] = order.map((seed) => (seed <= n ? teamIds[seed - 1] : null));
  for (let r = 1; r <= R; r++) {
    const slotCount = B / 2 ** r;
    const next: (string | null)[] = [];
    for (let i = 0; i < slotCount; i++) {
      const a = advancers[2 * i];
      const b = advancers[2 * i + 1];
      const feedsInto = r < R ? { matchId: ids[r + 1][Math.floor(i / 2)], slot: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B' } : null;
      if (r === 1 && (!a || !b)) {
        // 轮空：无实体场次，高种子直接晋级
        next[i] = a || b;
        continue;
      }
      matches.push({
        id: ids[r][i],
        round: r,
        teamA: a,
        teamB: b,
        feedsInto,
        bracketSide: 'W',
        label: r === R ? '决赛' : r === R - 1 ? '半决赛' : `第${r}轮`,
      });
      next[i] = null; // 胜者待定
    }
    advancers = next;
  }
  return matches;
}

// ---- 双败淘汰（仅 2 幂规模 8/16/32）----
// 胜者组 k 轮；败者组 2(k-1) 轮（minor/major 交替）；总决赛 1 场。总场次 2n-2。
export function generateDoubleElim(teamIds: string[]): Match[] {
  const n = teamIds.length;
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error('双败淘汰仅支持 2 的幂规模（如 8/16/32 队）');
  }
  const k = Math.log2(n);
  const matches: Match[] = [];

  // 预分配 id：WR[r][i]、LR[l][i]、GF
  const WR: string[][] = [];
  for (let r = 1; r <= k; r++) WR[r] = Array.from({ length: n / 2 ** r }, () => newId());
  const LR: string[][] = [];
  const lrCount = 2 * (k - 1);
  for (let l = 1; l <= lrCount; l++) {
    const j = Math.ceil(l / 2); // 第 j 对 minor/major
    const count = n / 2 ** (j + 1);
    LR[l] = Array.from({ length: Math.max(count, 1) }, () => newId());
  }
  const GF = newId();

  const wrLabel = (r: number) => (r === k ? '胜者组决赛' : `胜者组 第${r}轮`);
  const lrLabel = (l: number) => (l === lrCount ? '败者组决赛' : `败者组 第${l}轮`);

  // 胜者组
  let advancers: (string | null)[] = teamIds.slice();
  // 初始按种子位序填入，保证 1/2 号种子分居两半区
  const order = seedOrder(n);
  advancers = order.map((seed) => teamIds[seed - 1]);
  for (let r = 1; r <= k; r++) {
    const slotCount = n / 2 ** r;
    const next: (string | null)[] = [];
    for (let i = 0; i < slotCount; i++) {
      const a = advancers[2 * i];
      const b = advancers[2 * i + 1];
      const feedsInto = r < k ? { matchId: WR[r + 1][Math.floor(i / 2)], slot: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B' } : { matchId: GF, slot: 'A' as const };
      // 败者去向
      let losesInto: Match['losesInto'] = null;
      if (r === 1) {
        // WR1 败者进入 LR1：相邻两场败者配对
        losesInto = { matchId: LR[1][Math.floor(i / 2)], slot: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B' };
      } else {
        // WR[r] 败者进入 LR[2(r-1)]（major 轮），反序映射避免过早重赛
        const lrRound = 2 * (r - 1);
        const count = LR[lrRound].length;
        const idx = count - 1 - i;
        losesInto = { matchId: LR[lrRound][idx], slot: 'B' as const };
      }
      matches.push({
        id: WR[r][i],
        round: r,
        teamA: r === 1 ? a : null,
        teamB: r === 1 ? b : null,
        feedsInto,
        losesInto,
        bracketSide: 'W',
        label: wrLabel(r),
      });
      next[i] = null;
    }
    advancers = next;
  }

  // 败者组
  for (let l = 1; l <= lrCount; l++) {
    const count = LR[l].length;
    const isMinor = l % 2 === 1;
    for (let i = 0; i < count; i++) {
      let feedsInto: Match['feedsInto'];
      if (l === lrCount) {
        feedsInto = { matchId: GF, slot: 'B' };
      } else if (isMinor) {
        // minor 轮胜者进入下一个 major 轮的同席（A 侧）
        feedsInto = { matchId: LR[l + 1][i], slot: 'A' };
      } else {
        // major 轮胜者进入下一个 minor 轮：相邻两场配对
        feedsInto = { matchId: LR[l + 1][Math.floor(i / 2)], slot: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B' };
      }
      matches.push({
        id: LR[l][i],
        round: k + l, // 败者组轮次排在胜者组之后，便于按轮次排程
        teamA: null,
        teamB: null,
        feedsInto,
        losesInto: null, // 败者组再败即淘汰
        bracketSide: 'L',
        label: lrLabel(l),
      });
    }
  }

  // 总决赛
  matches.push({
    id: GF,
    round: k + lrCount + 1,
    teamA: null,
    teamB: null,
    feedsInto: null,
    losesInto: null,
    bracketSide: 'GF',
    label: '总决赛',
  });

  return matches;
}

// ---- 瑞士制 ----
const swiss = createSwiss({ maxPointsPerRound: 1, rematchWeight: 100, standingPower: 2 });

export function pointsFor(result: MatchResult, side: 'A' | 'B'): number {
  if (result === 'draw') return 0.5;
  if (result === side) return 1;
  if (result === null || result === undefined) return 0;
  return 0;
}

// 计算某队当前积分（含轮空 1 分）
export function teamPoints(doc: TournamentDoc, teamId: string, beforeRound = Infinity): number {
  let pts = 0;
  for (const m of doc.matches) {
    if (m.round >= beforeRound) continue;
    if (m.bye && m.teamA === teamId) {
      pts += 1;
      continue;
    }
    if (m.teamA === teamId) pts += pointsFor(m.result ?? null, 'A');
    else if (m.teamB === teamId) pts += pointsFor(m.result ?? null, 'B');
  }
  return pts;
}

// 生成瑞士制第 round 轮（依赖前序轮次结果已录入）
export function generateSwissRound(doc: TournamentDoc, round: number): Match[] {
  const participants = doc.teams.map((t, i) => ({ id: t.id, seed: i + 1 }));
  const priorMatches = doc.matches
    .filter((m) => m.round < round && m.teamA && m.teamB && !m.bye && m.result)
    .map((m) => ({
      round: m.round,
      home: { id: m.teamA as string, points: pointsFor(m.result ?? null, 'A') },
      away: { id: m.teamB as string, points: pointsFor(m.result ?? null, 'B') },
    }));
  const matchups = swiss.getMatchups(round, participants, priorMatches);
  const matches: Match[] = [];
  for (const p of matchups) {
    if (p.away === null || p.away === undefined) {
      // 轮空：_library_ 以 away:null 表示，计 1 分
      matches.push({
        id: newId(),
        round,
        teamA: p.home,
        teamB: null,
        bye: true,
        result: 'A',
        label: `第${round}轮 · 轮空`,
      });
    } else {
      matches.push({ id: newId(), round, teamA: p.home, teamB: p.away, label: `第${round}轮` });
    }
  }
  return matches;
}

// ---- 初始对阵分发 ----
export function generateInitialMatches(doc: TournamentDoc): Match[] {
  const ids = doc.teams.map((t) => t.id);
  switch (doc.format) {
    case 'round_robin':
      return generateRoundRobin(ids);
    case 'single_elim':
      return generateSingleElim(ids);
    case 'double_elim':
      return generateDoubleElim(ids);
    case 'swiss':
      return generateSwissRound(doc, 1);
    default:
      return [];
  }
}

// ---- 结果录入与晋级 ----
// 返回新的 matches 数组（不可变）。淘汰赛自动把胜/败者送入路由目标。
export function applyResult(matches: Match[], matchId: string, result: MatchResult): Match[] {
  const next = matches.map((m) => ({ ...m }));
  const idx = next.findIndex((m) => m.id === matchId);
  if (idx < 0) return next;
  const m = next[idx];
  m.result = result;
  if (m.bye) return next;

  const winner = result === 'A' ? m.teamA : result === 'B' ? m.teamB : null;
  const loser = result === 'A' ? m.teamB : result === 'B' ? m.teamA : null;

  const fill = (target: Match['feedsInto'], teamId: string | null) => {
    if (!target || !teamId) return;
    const t = next.find((x) => x.id === target.matchId);
    if (!t) return;
    if (target.slot === 'A') t.teamA = teamId;
    else t.teamB = teamId;
  };
  fill(m.feedsInto ?? null, winner);
  fill(m.losesInto ?? null, loser);
  return next;
}

// 某轮是否已全部录入结果（瑞士制推进下一轮的前置条件）
export function isRoundComplete(matches: Match[], round: number): boolean {
  const roundMatches = matches.filter((m) => m.round === round && !m.bye);
  return roundMatches.length > 0 && roundMatches.every((m) => !!m.result && !!m.teamA && !!m.teamB);
}

export function maxRound(matches: Match[]): number {
  return matches.reduce((mx, m) => Math.max(mx, m.round), 0);
}

export const FORMAT_GENERATORS: Record<Format, (doc: TournamentDoc) => Match[]> = {
  round_robin: generateInitialMatches,
  single_elim: generateInitialMatches,
  swiss: generateInitialMatches,
  double_elim: generateInitialMatches,
};