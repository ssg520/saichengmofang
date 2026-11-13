import { describe, expect, it } from 'vitest';
import {
  generateDoubleElim,
  generateRoundRobin,
  generateSingleElim,
  generateSwissRound,
  applyResult,
  isRoundComplete,
  teamPoints,
} from './pairings';
import { solve } from './solver';
import { detectAllConflicts, validateMove } from './conflicts';
import { makeDoc, buildSampleTournament } from './fixtures';
import { absEnd, absStart, buildDayIndex, expandSlots, type TournamentDoc } from './types';

// ---- 独立约束检查器（不复用 solver/predicates 的谓词，逐条 brute-force 断言）----
function independentCheck(doc: TournamentDoc): string[] {
  const errs: string[] = [];
  const assigned = doc.matches.filter((m) => m.assignment && m.teamA && m.teamB && !m.bye);
  const slotById = new Map(doc.slots.map((s) => [s.id, s]));
  const dayIndex = buildDayIndex(doc.slots);
  const venueById = new Map(doc.venues.map((v) => [v.id, v]));
  const judgeById = new Map(doc.judges.map((j) => [j.id, j]));
  const teamById = new Map(doc.teams.map((t) => [t.id, t]));
  const start = (m: (typeof assigned)[number]) => absStart(slotById.get(m.assignment!.slotId)!, dayIndex);
  const end = (m: (typeof assigned)[number]) => absEnd(slotById.get(m.assignment!.slotId)!, dayIndex);

  // H1 场地容量
  const vc = new Map<string, number>();
  for (const m of assigned) {
    const key = `${m.assignment!.slotId}|${m.assignment!.venueId}`;
    vc.set(key, (vc.get(key) ?? 0) + 1);
  }
  for (const [key, count] of vc) {
    const venueId = key.split('|')[1];
    const cap = venueById.get(venueId)?.capacity ?? 0;
    if (count > cap) errs.push(`H1 venue ${venueId} over capacity: ${count}>${cap}`);
  }

  // H2 队伍撞场 + H3 休息 + H4 不可用
  const teamMatches = new Map<string, typeof assigned>();
  for (const m of assigned) {
    for (const tid of [m.teamA!, m.teamB!]) {
      const arr = teamMatches.get(tid) ?? [];
      arr.push(m);
      teamMatches.set(tid, arr);
    }
  }
  for (const [tid, ms] of teamMatches) {
    const bySlot = new Map<string, number>();
    for (const m of ms) bySlot.set(m.assignment!.slotId, (bySlot.get(m.assignment!.slotId) ?? 0) + 1);
    for (const [sid, c] of bySlot) if (c > 1) errs.push(`H2 team ${tid} clash at ${sid}`);
    const sorted = [...ms].sort((a, b) => start(a) - start(b));
    for (let i = 1; i < sorted.length; i++) {
      const gap = start(sorted[i]) - end(sorted[i - 1]);
      if (gap < doc.constraints.minRestMin) errs.push(`H3 team ${tid} rest ${gap}<${doc.constraints.minRestMin}`);
    }
    for (const m of ms) {
      const slot = slotById.get(m.assignment!.slotId)!;
      if (teamById.get(tid)?.unavailableDates.includes(slot.date)) errs.push(`H4 team ${tid} unavailable ${slot.date}`);
    }
  }

  // H5/H6/H7 评委
  const judgeMatches = new Map<string, typeof assigned>();
  for (const m of assigned) {
    for (const jid of m.assignment!.judgeIds) {
      const arr = judgeMatches.get(jid) ?? [];
      arr.push(m);
      judgeMatches.set(jid, arr);
    }
  }
  for (const [jid, ms] of judgeMatches) {
    const judge = judgeById.get(jid);
    const bySlot = new Map<string, number>();
    for (const m of ms) bySlot.set(m.assignment!.slotId, (bySlot.get(m.assignment!.slotId) ?? 0) + 1);
    for (const [sid, c] of bySlot) if (c > 1) errs.push(`H7 judge ${jid} clash at ${sid}`);
    for (const m of ms) {
      const slot = slotById.get(m.assignment!.slotId)!;
      if (judge?.unavailableDates.includes(slot.date)) errs.push(`H5 judge ${jid} unavailable ${slot.date}`);
      if (judge?.affiliatedTeamIds.some((t) => t === m.teamA || t === m.teamB)) errs.push(`H6 judge ${jid} affiliation`);
    }
  }

  // H8 轮次序 / 晋级次序
  const byId = new Map(assigned.map((m) => [m.id, m]));
  for (const m of assigned) {
    if (m.bracketSide) {
      for (const other of assigned) {
        if (other.feedsInto?.matchId === m.id && end(other) > start(m)) errs.push(`H8 feed order ${other.id}->${m.id}`);
        if (other.losesInto?.matchId === m.id && end(other) > start(m)) errs.push(`H8 lose order ${other.id}->${m.id}`);
      }
      for (const t of [m.feedsInto, m.losesInto]) {
        if (!t) continue;
        const target = byId.get(t.matchId);
        if (target && end(m) > start(target)) errs.push(`H8 feed forward ${m.id}->${target.id}`);
      }
    } else {
      const prev = assigned.filter((x) => x.round === m.round - 1);
      if (prev.length) {
        const prevEnd = Math.max(...prev.map(end));
        if (start(m) < prevEnd + doc.constraints.roundGapMin) errs.push(`H8 round order r${m.round}`);
      }
    }
  }
  return errs;
}

describe('循环赛对阵', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 16, 32]) {
    it(`${n} 队：场数 n(n-1)/2，每对恰好一次，轮次正确`, () => {
      const ids = Array.from({ length: n }, (_, i) => `t${i}`);
      const matches = generateRoundRobin(ids);
      expect(matches.length).toBe((n * (n - 1)) / 2);
      const pairs = new Set(matches.map((m) => [m.teamA, m.teamB].sort().join('|')));
      expect(pairs.size).toBe(matches.length);
      const rounds = Math.max(...matches.map((m) => m.round));
      expect(rounds).toBe(n % 2 === 0 ? n - 1 : n);
      // 每轮每队 ≤1 场
      for (let r = 1; r <= rounds; r++) {
        const rm = matches.filter((m) => m.round === r);
        const seen = new Set<string>();
        for (const m of rm) {
          expect(seen.has(m.teamA!)).toBe(false);
          expect(seen.has(m.teamB!)).toBe(false);
          seen.add(m.teamA!);
          seen.add(m.teamB!);
        }
      }
      expect(matches.every((m) => !m.bye)).toBe(true);
    });
  }
});

describe('单败淘汰对阵', () => {
  it('8 队 = 7 场 3 轮', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const m = generateSingleElim(ids);
    expect(m.length).toBe(7);
    expect(Math.max(...m.map((x) => x.round))).toBe(3);
  });
  it('5 队 = 4 场，高种子轮空受益', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `t${i}`);
    const m = generateSingleElim(ids);
    expect(m.length).toBe(4);
    // 1 号种子（t0）首轮轮空：首轮无 t0 的实体场次
    const r1 = m.filter((x) => x.round === 1);
    expect(r1.some((x) => x.teamA === 't0' || x.teamB === 't0')).toBe(false);
  });
  it('feedsInto 指向存在的场次', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const m = generateSingleElim(ids);
    const idSet = new Set(m.map((x) => x.id));
    for (const x of m) if (x.feedsInto) expect(idSet.has(x.feedsInto.matchId)).toBe(true);
  });
  it('n=1 边界：无场次', () => {
    expect(generateSingleElim(['t0']).length).toBe(0);
  });
});

describe('双败淘汰对阵', () => {
  it('8 队 = 14 场（含总决赛）', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const m = generateDoubleElim(ids);
    expect(m.length).toBe(14);
    expect(m.filter((x) => x.bracketSide === 'GF').length).toBe(1);
    expect(m.filter((x) => x.bracketSide === 'W').length).toBe(7);
    expect(m.filter((x) => x.bracketSide === 'L').length).toBe(6);
  });
  it('16 队 = 30 场', () => {
    const ids = Array.from({ length: 16 }, (_, i) => `t${i}`);
    expect(generateDoubleElim(ids).length).toBe(30);
  });
  it('路由目标均存在', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const m = generateDoubleElim(ids);
    const idSet = new Set(m.map((x) => x.id));
    for (const x of m) {
      if (x.feedsInto) expect(idSet.has(x.feedsInto.matchId)).toBe(true);
      if (x.losesInto) expect(idSet.has(x.losesInto.matchId)).toBe(true);
    }
  });
  it('非 2 幂规模抛错', () => {
    expect(() => generateDoubleElim(['a', 'b', 'c'])).toThrow();
  });
});

describe('瑞士制', () => {
  it('8 队首轮 4 场，无重赛', () => {
    const doc = makeDoc({ format: 'swiss', teams: Array.from({ length: 8 }, (_, i) => `队${i}`), matches: [] });
    const r1 = generateSwissRound(doc, 1);
    expect(r1.filter((m) => !m.bye).length).toBe(4);
  });
  it('奇数队轮空计 1 分', () => {
    const doc = makeDoc({ format: 'swiss', teams: Array.from({ length: 7 }, (_, i) => `队${i}`), matches: [] });
    const r1 = generateSwissRound(doc, 1);
    const bye = r1.find((m) => m.bye);
    expect(bye).toBeTruthy();
    const doc2 = { ...doc, matches: r1 };
    expect(teamPoints(doc2, bye!.teamA!)).toBe(1);
  });
  it('录入结果后生成下一轮合法且无重赛', () => {
    let doc = makeDoc({ format: 'swiss', teams: Array.from({ length: 8 }, (_, i) => `队${i}`), matches: [] });
    const r1 = generateSwissRound(doc, 1);
    let matches = r1.map((m) => ({ ...m, result: 'A' as const }));
    doc = { ...doc, matches };
    expect(isRoundComplete(matches, 1)).toBe(true);
    const r2 = generateSwissRound(doc, 2);
    expect(r2.filter((m) => !m.bye).length).toBe(4);
    // 无重赛
    const played = new Set(matches.map((m) => [m.teamA, m.teamB].sort().join('|')));
    for (const m of r2) {
      if (m.bye) continue;
      expect(played.has([m.teamA, m.teamB].sort().join('|'))).toBe(false);
    }
  });
});

describe('求解器正确性（独立检查器）', () => {
  it('示例 8 队循环赛：全部排上，0 冲突', () => {
    const doc = buildSampleTournament();
    const res = solve(doc, { seed: 42 });
    expect(res.unplaced.length).toBe(0);
    expect(res.report.conflicts).toBe(0);
    const solved = { ...doc, matches: res.matches };
    expect(independentCheck(solved)).toEqual([]);
  });

  for (const seed of [1, 7, 42, 99, 123]) {
    it(`随机小实例 seed=${seed} 满足全部硬约束`, () => {
      const n = 4 + (seed % 5); // 4..8
      const doc = makeDoc({
        format: 'round_robin',
        teams: Array.from({ length: n }, (_, i) => `队${i}`),
        venues: [{ name: 'A', capacity: 1 }, { name: 'B', capacity: 1 }, { name: 'C', capacity: 1 }],
        judges: [{ name: 'J1' }, { name: 'J2' }, { name: 'J3' }, { name: 'J4', affiliatedTeamIds: ['team-0'] }],
        timeBlocks: [
          { date: '2026-11-14', startMin: 540, endMin: 1200, matchMin: 45, breakMin: 10 },
          { date: '2026-11-15', startMin: 540, endMin: 1200, matchMin: 45, breakMin: 10 },
          { date: '2026-11-16', startMin: 540, endMin: 1200, matchMin: 45, breakMin: 10 },
        ],
        constraints: { minRestMin: 15, roundGapMin: 15, judgesPerMatch: 1 },
      });
      const res = solve(doc, { seed });
      const solved = { ...doc, matches: res.matches };
      expect(independentCheck(solved)).toEqual([]);
    });
  }

  it('单败淘汰可排程且满足晋级次序', () => {
    const doc = makeDoc({
      format: 'single_elim',
      teams: Array.from({ length: 8 }, (_, i) => `队${i}`),
      venues: [{ name: 'A' }, { name: 'B' }],
      judges: [{ name: 'J1' }, { name: 'J2' }, { name: 'J3' }],
      timeBlocks: [
        { date: '2026-11-14', startMin: 540, endMin: 1200, matchMin: 45, breakMin: 10 },
        { date: '2026-11-15', startMin: 540, endMin: 1200, matchMin: 45, breakMin: 10 },
      ],
      constraints: { minRestMin: 15, roundGapMin: 15, judgesPerMatch: 1 },
    });
    const res = solve(doc, { seed: 5 });
    const solved = { ...doc, matches: res.matches };
    expect(independentCheck(solved)).toEqual([]);
  });

  it('确定性：同 seed 两次结果深相等', () => {
    const doc = buildSampleTournament();
    const a = solve(doc, { seed: 2026 });
    const b = solve(doc, { seed: 2026 });
    expect(a.matches).toEqual(b.matches);
    expect(a.report.placed).toBe(b.report.placed);
  });
});

describe('无解降级', () => {
  it('0 评委 → 全部 no_judge', () => {
    const doc = makeDoc({
      format: 'round_robin',
      teams: ['a', 'b', 'c', 'd'],
      judges: [],
      venues: [{ name: 'A' }],
    });
    const res = solve(doc, { seed: 1 });
    expect(res.unplaced.length).toBeGreaterThan(0);
    expect(res.unplaced.every((u) => u.reason === 'no_judge')).toBe(true);
    expect(res.report.suggestions.some((s) => s.includes('评委'))).toBe(true);
  });
  it('休息要求巨大 → 部分排程 + 原因', () => {
    const doc = makeDoc({
      format: 'round_robin',
      teams: Array.from({ length: 6 }, (_, i) => `队${i}`),
      venues: [{ name: 'A' }],
      judges: [{ name: 'J1' }, { name: 'J2' }],
      timeBlocks: [{ date: '2026-11-14', startMin: 540, endMin: 720, matchMin: 45, breakMin: 10 }],
      constraints: { minRestMin: 10000, roundGapMin: 10000, judgesPerMatch: 1 },
    });
    const res = solve(doc, { seed: 1 });
    expect(res.unplaced.length).toBeGreaterThan(0);
    expect(res.report.placed).toBeLessThan(res.report.total);
  });
});

describe('增量冲突检测', () => {
  it('validateMove 与 detectAllConflicts 结论一致', () => {
    const doc = buildSampleTournament();
    const res = solve(doc, { seed: 42 });
    const solved = { ...doc, matches: res.matches };
    expect(detectAllConflicts(solved)).toEqual([]);
    // 把一场移到另一场占用的同时段同场地 → 应报冲突
    const placed = solved.matches.filter((m) => m.assignment);
    const a = placed[0];
    const b = placed.find((m) => m.id !== a.id && m.assignment!.slotId !== a.assignment!.slotId)!;
    const target = { ...b.assignment! };
    const conflicts = validateMove(solved, a.id, target);
    expect(conflicts.length).toBeGreaterThan(0);
  });
  it('队伍撞场 H2 被检出', () => {
    const doc = makeDoc({
      format: 'round_robin',
      teams: ['a', 'b', 'c', 'd'],
      venues: [{ name: 'A', capacity: 2 }],
      judges: [{ name: 'J1' }, { name: 'J2' }, { name: 'J3' }],
    });
    const res = solve(doc, { seed: 1 });
    const solved = { ...doc, matches: res.matches };
    const placed = solved.matches.filter((m) => m.assignment);
    // 找含同一队伍的两场，把其中一场移到另一场的时段
    const team = placed[0].teamA!;
    const sameTeam = placed.filter((m) => m.teamA === team || m.teamB === team);
    if (sameTeam.length >= 2) {
      const target = { ...sameTeam[1].assignment!, venueId: placed[0].assignment!.venueId };
      const conflicts = validateMove(solved, sameTeam[0].id, target);
      expect(conflicts.some((c) => c.code === 'team_clash' || c.code === 'team_rest')).toBe(true);
    }
  });
});

describe('性能', () => {
  it('32 队 496 场在预算内返回', () => {
    const doc = makeDoc({
      format: 'round_robin',
      teams: Array.from({ length: 32 }, (_, i) => `队${i}`),
      venues: Array.from({ length: 8 }, (_, i) => ({ name: `V${i}`, capacity: 1 })),
      judges: Array.from({ length: 10 }, (_, i) => ({ name: `J${i}` })),
      timeBlocks: Array.from({ length: 12 }, (_, d) => ({
        date: `2026-11-${String(14 + d).padStart(2, '0')}`,
        startMin: 540,
        endMin: 1260,
        matchMin: 45,
        breakMin: 10,
      })),
      constraints: { minRestMin: 15, roundGapMin: 15, judgesPerMatch: 1 },
    });
    expect(doc.matches.length).toBe(496);
    const res = solve(doc, { seed: 1, timeBudgetMs: 2000, nodeBudget: 200000 });
    // 预算内必须返回（可能部分），且已排部分满足硬约束
    const solved = { ...doc, matches: res.matches };
    expect(independentCheck(solved)).toEqual([]);
    expect(res.report.durationMs).toBeLessThan(2500);
  });
});

describe('时间工具', () => {
  it('expandSlots 步长正确且不越界', () => {
    const slots = expandSlots([{ date: '2026-11-14', startMin: 540, endMin: 720, matchMin: 45, breakMin: 10 }]);
    expect(slots.length).toBe(3); // 540-585, 595-640, 650-695
    expect(slots.every((s) => s.endMin <= 720)).toBe(true);
  });
});

describe('结果推进', () => {
  it('单败：胜者进入 feedsInto 目标', () => {
    const ids = Array.from({ length: 4 }, (_, i) => `t${i}`);
    const m = generateSingleElim(ids);
    const r1 = m.find((x) => x.round === 1 && x.teamA && x.teamB)!;
    const next = applyResult(m, r1.id, 'A');
    const target = next.find((x) => x.id === r1.feedsInto!.matchId)!;
    const filled = r1.feedsInto!.slot === 'A' ? target.teamA : target.teamB;
    expect(filled).toBe(r1.teamA);
  });
});