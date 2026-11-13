// 赛程魔方 · 约束分配求解器（技术核心）
// 构造启发式（MRV 排序）+ 有限回溯（ejection chain，深度≤2）+ 时间/节点双预算。
// 按轮次屏障构造：同队每轮只打一场、轮间强制 ≥ roundGap，故 H2/H3/H8 在自动排程中
// 由构造保证，搜索空间只剩 H1×H4–H7。确定性：mulberry32 种子 PRNG，平局按 id 字典序。
// 无解时返回部分排程 + 原因码 + 聚合建议，绝不静默失败。

import { buildIndex, detectAllConflicts, placementConflicts, type ScheduleIndex } from './predicates';
import {
  absEnd,
  absStart,
  isPlayable,
  mulberry32,
  type Assignment,
  type Match,
  type Slot,
  type TournamentDoc,
} from './types';

export type ReasonCode =
  | 'no_feasible_slot'
  | 'no_venue_capacity'
  | 'no_judge'
  | 'budget_exhausted'
  | 'no_teams';

export interface UnplacedInfo {
  matchId: string;
  reason: ReasonCode;
}

export interface LoadEntry {
  id: string;
  name: string;
  count: number;
}

export interface SolveReport {
  total: number;
  placed: number;
  unplaced: number;
  conflicts: number;
  durationMs: number;
  rounds: number;
  makespanMin: number;
  judgeLoad: LoadEntry[];
  venueLoad: LoadEntry[];
  maxJudgeLoad: number;
  suggestions: string[];
}

export interface SolveOptions {
  seed?: number;
  timeBudgetMs?: number;
  nodeBudget?: number;
}

export interface SolveResult {
  matches: Match[];
  unplaced: UnplacedInfo[];
  report: SolveReport;
}

const REASON_TEXT: Record<ReasonCode, string> = {
  no_feasible_slot: '没有可用时段（队伍不可用或轮次间隔不足）',
  no_venue_capacity: '场地容量不足',
  no_judge: '可用评委不足（回避/撞场/不可用）',
  budget_exhausted: '搜索预算用尽',
  no_teams: '双方队伍未定',
};

export function reasonText(code: ReasonCode): string {
  return REASON_TEXT[code];
}

export function solve(doc: TournamentDoc, opts: SolveOptions = {}): SolveResult {
  const startTime = Date.now();
  const seed = opts.seed ?? 1;
  const timeBudgetMs = opts.timeBudgetMs ?? 500;
  const nodeBudget = opts.nodeBudget ?? 5000;
  const rng = mulberry32(seed);
  const deadline = startTime + timeBudgetMs;
  let nodes = 0;
  const overBudget = () => nodes > nodeBudget || Date.now() > deadline;

  const k = Math.max(1, Math.min(2, doc.constraints.judgesPerMatch || 1));
  const dayIndex = buildIndex(doc, []).dayIndex;
  const slotsSorted = [...doc.slots].sort(
    (a, b) => absStart(a, dayIndex) - absStart(b, dayIndex) || a.id.localeCompare(b.id),
  );
  const teamById = new Map(doc.teams.map((t) => [t.id, t]));

  const playable = doc.matches.filter((m) => isPlayable(m));
  const pinned = playable.filter((m) => m.pinned && m.assignment);
  const toPlace = playable.filter((m) => !m.pinned);

  // placedMap：matchId -> Assignment（含 pinned）
  const placedMap = new Map<string, Assignment>();
  for (const m of pinned) placedMap.set(m.id, m.assignment as Assignment);

  const placedList = (): Match[] =>
    doc.matches.filter((m) => placedMap.has(m.id)).map((m) => ({ ...m, assignment: placedMap.get(m.id) as Assignment }));

  const teamsAvailable = (m: Match, slot: Slot): boolean => {
    for (const tid of [m.teamA, m.teamB]) {
      if (!tid) return false;
      if (teamById.get(tid)?.unavailableDates.includes(slot.date)) return false;
    }
    return true;
  };

  const judgeLoad = (index: ScheduleIndex, judgeId: string) => index.judgeTimeline.get(judgeId)?.length ?? 0;
  const venueLoad = (index: ScheduleIndex, venueId: string) => {
    let c = 0;
    for (const [key, ids] of index.venueSlot) if (key.endsWith(`|${venueId}`)) c += ids.length;
    return c;
  };

  const pickJudges = (m: Match, slot: Slot, index: ScheduleIndex): string[] | null => {
    const teams = [m.teamA, m.teamB].filter(Boolean) as string[];
    const available = doc.judges.filter(
      (j) =>
        !j.unavailableDates.includes(slot.date) &&
        !j.affiliatedTeamIds.some((t) => teams.includes(t)) &&
        !(index.judgeTimeline.get(j.id) ?? []).some((e) => e.slotId === slot.id),
    );
    if (available.length < k) return null;
    available.sort((a, b) => judgeLoad(index, a.id) - judgeLoad(index, b.id) || a.id.localeCompare(b.id));
    return available.slice(0, k).map((j) => j.id);
  };

  const earliestFor = (m: Match, index: ScheduleIndex): number => {
    if (m.bracketSide) {
      let e = 0;
      for (const feederId of index.feeders.get(m.id) ?? []) {
        const f = index.placedById.get(feederId);
        const fa = f?.assignment;
        if (!fa) continue;
        const fs = index.slotById.get(fa.slotId);
        if (fs) e = Math.max(e, absEnd(fs, index.dayIndex));
      }
      return e;
    }
    const prev = index.roundMaxEnd.get(m.round - 1);
    return prev === undefined ? 0 : prev + doc.constraints.roundGapMin;
  };

  const feasibleSlotCount = (m: Match, earliest: number): number => {
    let c = 0;
    for (const slot of slotsSorted) {
      if (absStart(slot, dayIndex) < earliest) continue;
      if (teamsAvailable(m, slot)) c++;
    }
    return c;
  };

  // 尝试为 m 找一个可行落位；返回 candidate 或失败原因
  const tryPlace = (
    m: Match,
    earliest: number,
    index: ScheduleIndex,
  ): { candidate: Assignment | null; reason: ReasonCode } => {
    let sawSlot = false;
    let sawVenue = false;
    let reason: ReasonCode = 'no_feasible_slot';
    for (const slot of slotsSorted) {
      if (overBudget()) return { candidate: null, reason: 'budget_exhausted' };
      if (absStart(slot, dayIndex) < earliest) continue;
      if (!teamsAvailable(m, slot)) continue;
      sawSlot = true;
      const venuesSorted = [...doc.venues].sort(
        (a, b) => venueLoad(index, a.id) - venueLoad(index, b.id) || a.id.localeCompare(b.id),
      );
      for (const venue of venuesSorted) {
        const occ = index.venueSlot.get(`${slot.id}|${venue.id}`)?.length ?? 0;
        if (occ + 1 > venue.capacity) continue;
        sawVenue = true;
        const judges = pickJudges(m, slot, index);
        if (!judges) {
          reason = 'no_judge';
          continue;
        }
        nodes++;
        const candidate: Assignment = { slotId: slot.id, venueId: venue.id, judgeIds: judges };
        const conflicts = placementConflicts(doc, index, m, candidate);
        if (conflicts.length === 0) return { candidate, reason: 'no_feasible_slot' };
      }
    }
    if (!sawSlot) reason = 'no_feasible_slot';
    else if (!sawVenue) reason = 'no_venue_capacity';
    return { candidate: null, reason };
  };

  const unplaced: UnplacedInfo[] = [];

  // 有限回溯：迁出挡路场次 b 到别处，递归深度≤2
  const backtrack = (m: Match, depth: number, lastReason: ReasonCode): boolean => {
    if (depth <= 0 || overBudget()) {
      unplaced.push({ matchId: m.id, reason: overBudget() ? 'budget_exhausted' : lastReason });
      return false;
    }
    const indexNow = buildIndex(doc, placedList());
    const blockers = placedList()
      .filter((b) => b.round === m.round && b.id !== m.id && !b.pinned)
      .slice(0, 8);
    for (const b of blockers) {
      if (overBudget()) break;
      const bOriginal = placedMap.get(b.id) as Assignment;
      placedMap.delete(b.id);
      const idxWithoutB = buildIndex(doc, placedList());
      const bEarliest = earliestFor(b, idxWithoutB);
      const { candidate: bCand } = tryPlace(b, bEarliest, idxWithoutB);
      if (bCand && (bCand.slotId !== bOriginal.slotId || bCand.venueId !== bOriginal.venueId)) {
        placedMap.set(b.id, bCand);
        const idx2 = buildIndex(doc, placedList());
        const mEarliest = earliestFor(m, idx2);
        const { candidate: mCand, reason } = tryPlace(m, mEarliest, idx2);
        if (mCand) {
          placedMap.set(m.id, mCand);
          return true;
        }
        if (backtrack(m, depth - 1, reason)) return true;
        placedMap.delete(m.id);
        placedMap.set(b.id, bOriginal);
      } else {
        placedMap.set(b.id, bOriginal);
      }
    }
    unplaced.push({ matchId: m.id, reason: overBudget() ? 'budget_exhausted' : lastReason });
    return false;
  };

  // 按轮次升序构造
  const rounds = [...new Set(toPlace.map((m) => m.round))].sort((a, b) => a - b);
  for (const round of rounds) {
    const roundMatches = toPlace.filter((m) => m.round === round);
    const orderIndex = buildIndex(doc, placedList());
    // MRV：可行时段越少越先排；平局按 id 字典序，辅以种子抖动
    const ordered = roundMatches
      .map((m) => ({ m, count: feasibleSlotCount(m, earliestFor(m, orderIndex)), jitter: rng() }))
      .sort((a, b) => a.count - b.count || a.m.id.localeCompare(b.m.id) || a.jitter - b.jitter)
      .map((x) => x.m);
    for (const m of ordered) {
      const index = buildIndex(doc, placedList());
      const earliest = earliestFor(m, index);
      const { candidate, reason } = tryPlace(m, earliest, index);
      if (candidate) {
        placedMap.set(m.id, candidate);
      } else if (reason === 'budget_exhausted') {
        unplaced.push({ matchId: m.id, reason });
      } else {
        backtrack(m, 2, reason);
      }
    }
  }

  // 组装结果
  const finalMatches: Match[] = doc.matches.map((m) => {
    if (placedMap.has(m.id)) return { ...m, assignment: placedMap.get(m.id) as Assignment };
    if (m.pinned && m.assignment) return { ...m };
    return { ...m, assignment: null };
  });
  const finalDoc: TournamentDoc = { ...doc, matches: finalMatches };

  // 报告
  const judgeCount = new Map<string, number>();
  const venueCount = new Map<string, number>();
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const m of finalMatches) {
    const a = m.assignment;
    if (!a) continue;
    for (const j of a.judgeIds) judgeCount.set(j, (judgeCount.get(j) ?? 0) + 1);
    venueCount.set(a.venueId, (venueCount.get(a.venueId) ?? 0) + 1);
    const slot = doc.slots.find((s) => s.id === a.slotId);
    if (slot) {
      minStart = Math.min(minStart, absStart(slot, dayIndex));
      maxEnd = Math.max(maxEnd, absEnd(slot, dayIndex));
    }
  }
  const judgeLoadArr: LoadEntry[] = doc.judges
    .map((j) => ({ id: j.id, name: j.name, count: judgeCount.get(j.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const venueLoadArr: LoadEntry[] = doc.venues
    .map((v) => ({ id: v.id, name: v.name, count: venueCount.get(v.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const conflicts = detectAllConflicts(finalDoc);

  // 聚合建议
  const suggestions: string[] = [];
  const reasonTally = new Map<ReasonCode, number>();
  for (const u of unplaced) reasonTally.set(u.reason, (reasonTally.get(u.reason) ?? 0) + 1);
  if ((reasonTally.get('no_venue_capacity') ?? 0) > 0) suggestions.push('增加场地或提高单场地并行容量，可容纳更多场次');
  if ((reasonTally.get('no_judge') ?? 0) > 0) suggestions.push('增加评委或减少回避约束，缓解评委分身/回避冲突');
  if ((reasonTally.get('no_feasible_slot') ?? 0) > 0) suggestions.push('延长时段块或增加比赛日，提供更多可用时段');
  if ((reasonTally.get('budget_exhausted') ?? 0) > 0) suggestions.push('资源紧张导致搜索超时，可放宽约束后重排');

  const report: SolveReport = {
    total: playable.length,
    placed: placedMap.size,
    unplaced: unplaced.length,
    conflicts: conflicts.length,
    durationMs: Date.now() - startTime,
    rounds: rounds.length,
    makespanMin: maxEnd >= minStart ? maxEnd - minStart : 0,
    judgeLoad: judgeLoadArr,
    venueLoad: venueLoadArr,
    maxJudgeLoad: judgeLoadArr.reduce((mx, j) => Math.max(mx, j.count), 0),
    suggestions,
  };

  return { matches: finalMatches, unplaced, report };
}