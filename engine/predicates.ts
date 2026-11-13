// 赛程魔方 · 约束谓词与占用索引
// 求解器与拖拽冲突检测共用这一套硬约束谓词，杜绝口径漂移。
// H1 场地容量 / H2 队伍撞场 / H3 队伍休息 / H4 队伍不可用 /
// H5 评委可用 / H6 评委回避 / H7 评委撞场 / H8 轮次与晋级次序。

import {
  absEnd,
  absStart,
  buildDayIndex,
  type Assignment,
  type Conflict,
  type Match,
  type Slot,
  type TournamentDoc,
} from './types';

export interface TimelineEntry {
  matchId: string;
  start: number;
  end: number;
  slotId: string;
}

export interface ScheduleIndex {
  dayIndex: Map<string, number>;
  slotById: Map<string, Slot>;
  venueSlot: Map<string, string[]>; // `${slotId}|${venueId}` -> matchIds
  teamTimeline: Map<string, TimelineEntry[]>;
  judgeTimeline: Map<string, TimelineEntry[]>;
  roundMaxEnd: Map<number, number>;
  roundMinStart: Map<number, number>;
  feeders: Map<string, string[]>; // matchId -> 上游 feeder matchIds
  placedById: Map<string, Match>;
}

const key = (slotId: string, venueId: string) => `${slotId}|${venueId}`;

// 从「已落位」的比赛构建索引。传入的 placed 应排除正在被放置/移动的那一场。
export function buildIndex(doc: TournamentDoc, placed: Match[]): ScheduleIndex {
  const dayIndex = buildDayIndex(doc.slots);
  const slotById = new Map(doc.slots.map((s) => [s.id, s]));
  const venueSlot = new Map<string, string[]>();
  const teamTimeline = new Map<string, TimelineEntry[]>();
  const judgeTimeline = new Map<string, TimelineEntry[]>();
  const roundMaxEnd = new Map<number, number>();
  const roundMinStart = new Map<number, number>();
  const feeders = new Map<string, string[]>();
  const placedById = new Map<string, Match>();

  const pushTeam = (teamId: string | null, e: TimelineEntry) => {
    if (!teamId) return;
    const arr = teamTimeline.get(teamId) ?? [];
    arr.push(e);
    teamTimeline.set(teamId, arr);
  };
  const pushJudge = (judgeId: string, e: TimelineEntry) => {
    const arr = judgeTimeline.get(judgeId) ?? [];
    arr.push(e);
    judgeTimeline.set(judgeId, arr);
  };

  for (const m of placed) {
    const a = m.assignment;
    if (!a) continue;
    const slot = slotById.get(a.slotId);
    if (!slot) continue;
    const start = absStart(slot, dayIndex);
    const end = absEnd(slot, dayIndex);
    const e: TimelineEntry = { matchId: m.id, start, end, slotId: a.slotId };
    placedById.set(m.id, m);

    const vk = key(a.slotId, a.venueId);
    const vs = venueSlot.get(vk) ?? [];
    vs.push(m.id);
    venueSlot.set(vk, vs);

    pushTeam(m.teamA, e);
    pushTeam(m.teamB, e);
    for (const j of a.judgeIds) pushJudge(j, e);

    roundMaxEnd.set(m.round, Math.max(roundMaxEnd.get(m.round) ?? -Infinity, end));
    roundMinStart.set(m.round, Math.min(roundMinStart.get(m.round) ?? Infinity, start));

    if (m.feedsInto) {
      const arr = feeders.get(m.feedsInto.matchId) ?? [];
      arr.push(m.id);
      feeders.set(m.feedsInto.matchId, arr);
    }
    if (m.losesInto) {
      const arr = feeders.get(m.losesInto.matchId) ?? [];
      arr.push(m.id);
      feeders.set(m.losesInto.matchId, arr);
    }
  }
  return { dayIndex, slotById, venueSlot, teamTimeline, judgeTimeline, roundMaxEnd, roundMinStart, feeders, placedById };
}

function teamName(doc: TournamentDoc, id: string | null): string {
  return doc.teams.find((t) => t.id === id)?.name ?? '待定';
}
function judgeName(doc: TournamentDoc, id: string): string {
  return doc.judges.find((j) => j.id === id)?.name ?? id;
}
function venueName(doc: TournamentDoc, id: string): string {
  return doc.venues.find((v) => v.id === id)?.name ?? id;
}

// 检查把 match 放到 candidate 是否违反硬约束。index 必须已排除 match 自身。
export function placementConflicts(
  doc: TournamentDoc,
  index: ScheduleIndex,
  match: Match,
  candidate: Assignment,
): Conflict[] {
  const out: Conflict[] = [];
  const slot = index.slotById.get(candidate.slotId);
  if (!slot) {
    out.push({ code: 'invalid_slot', severity: 'hard', message: '时段不存在', matchIds: [match.id] });
    return out;
  }
  const venue = doc.venues.find((v) => v.id === candidate.venueId);
  if (!venue) {
    out.push({ code: 'invalid_venue', severity: 'hard', message: '场地不存在', matchIds: [match.id] });
    return out;
  }
  const start = absStart(slot, index.dayIndex);
  const end = absEnd(slot, index.dayIndex);
  const teams = [match.teamA, match.teamB].filter(Boolean) as string[];
  const { minRestMin, roundGapMin } = doc.constraints;

  // H1 场地容量
  const occupants = index.venueSlot.get(key(candidate.slotId, candidate.venueId)) ?? [];
  if (occupants.length + 1 > venue.capacity) {
    out.push({
      code: 'venue_capacity',
      severity: 'hard',
      message: `${venue.name} 在该时段已满（容量 ${venue.capacity}）`,
      matchIds: [match.id, ...occupants],
    });
  }

  // H2 队伍撞场 + H3 队伍休息 + H4 队伍不可用
  for (const teamId of teams) {
    const timeline = index.teamTimeline.get(teamId) ?? [];
    const clash = timeline.filter((e) => e.slotId === candidate.slotId);
    if (clash.length) {
      out.push({
        code: 'team_clash',
        severity: 'hard',
        message: `${teamName(doc, teamId)} 在该时段已有比赛`,
        matchIds: [match.id, ...clash.map((e) => e.matchId)],
      });
    }
    const merged = [...timeline.map((e) => ({ start: e.start, end: e.end, matchId: e.matchId })), { start, end, matchId: match.id }].sort(
      (a, b) => a.start - b.start,
    );
    for (let i = 1; i < merged.length; i++) {
      const gap = merged[i].start - merged[i - 1].end;
      if (gap < minRestMin) {
        const other = merged[i - 1].matchId === match.id ? merged[i].matchId : merged[i - 1].matchId;
        out.push({
          code: 'team_rest',
          severity: 'hard',
          message: `${teamName(doc, teamId)} 两场间隔不足 ${minRestMin} 分钟`,
          matchIds: [match.id, other],
        });
        break;
      }
    }
    const team = doc.teams.find((t) => t.id === teamId);
    if (team?.unavailableDates.includes(slot.date)) {
      out.push({
        code: 'team_unavailable',
        severity: 'hard',
        message: `${teamName(doc, teamId)} 在 ${slot.date} 不可用`,
        matchIds: [match.id],
      });
    }
  }

  // H5/H6/H7 评委
  for (const judgeId of candidate.judgeIds) {
    const judge = doc.judges.find((j) => j.id === judgeId);
    if (!judge) {
      out.push({ code: 'invalid_judge', severity: 'hard', message: '评委不存在', matchIds: [match.id] });
      continue;
    }
    if (judge.unavailableDates.includes(slot.date)) {
      out.push({
        code: 'judge_unavailable',
        severity: 'hard',
        message: `${judge.name} 在 ${slot.date} 不可用`,
        matchIds: [match.id],
      });
    }
    const affiliated = judge.affiliatedTeamIds.filter((t) => teams.includes(t));
    if (affiliated.length) {
      out.push({
        code: 'judge_affiliation',
        severity: 'hard',
        message: `${judge.name} 需回避 ${affiliated.map((t) => teamName(doc, t)).join('、')}`,
        matchIds: [match.id],
      });
    }
    const jTimeline = index.judgeTimeline.get(judgeId) ?? [];
    const jClash = jTimeline.filter((e) => e.slotId === candidate.slotId);
    if (jClash.length) {
      out.push({
        code: 'judge_clash',
        severity: 'hard',
        message: `${judge.name} 在该时段已在其他场地执裁`,
        matchIds: [match.id, ...jClash.map((e) => e.matchId)],
      });
    }
  }

  // H8 轮次 / 晋级次序
  const isElim = !!match.bracketSide;
  if (isElim) {
    // 上游 feeder 必须先结束
    for (const feederId of index.feeders.get(match.id) ?? []) {
      const feeder = index.placedById.get(feederId);
      const fa = feeder?.assignment;
      if (!fa) continue;
      const fSlot = index.slotById.get(fa.slotId);
      if (!fSlot) continue;
      const fEnd = absEnd(fSlot, index.dayIndex);
      if (fEnd > start) {
        out.push({
          code: 'feed_order',
          severity: 'hard',
          message: `本场需等上游比赛结束后才能开始`,
          matchIds: [match.id, feederId],
        });
      }
    }
    // 下游目标必须在本场之后
    const targets = [match.feedsInto, match.losesInto].filter(Boolean) as NonNullable<Match['feedsInto']>[];
    for (const t of targets) {
      const target = index.placedById.get(t.matchId);
      const ta = target?.assignment;
      if (!ta) continue;
      const tSlot = index.slotById.get(ta.slotId);
      if (!tSlot) continue;
      const tStart = absStart(tSlot, index.dayIndex);
      if (end > tStart) {
        out.push({
          code: 'feed_order',
          severity: 'hard',
          message: `本场结束时间晚于晋级目标场次`,
          matchIds: [match.id, t.matchId],
        });
      }
    }
  } else {
    const prevEnd = index.roundMaxEnd.get(match.round - 1);
    if (prevEnd !== undefined && start < prevEnd + roundGapMin) {
      out.push({
        code: 'round_order',
        severity: 'hard',
        message: `第${match.round}轮需在第${match.round - 1}轮结束 ${roundGapMin} 分钟后开始`,
        matchIds: [match.id],
      });
    }
    const nextStart = index.roundMinStart.get(match.round + 1);
    if (nextStart !== undefined && end > nextStart - roundGapMin) {
      out.push({
        code: 'round_order',
        severity: 'hard',
        message: `第${match.round}轮需在第${match.round + 1}轮开始前 ${roundGapMin} 分钟结束`,
        matchIds: [match.id],
      });
    }
  }

  return out;
}

// 全量扫描：驱动卡片红徽与冲突面板
export function detectAllConflicts(doc: TournamentDoc): Conflict[] {
  const assigned = doc.matches.filter((m) => m.assignment && m.teamA && m.teamB && !m.bye);
  const out: Conflict[] = [];
  const seen = new Set<string>();
  for (const m of assigned) {
    const others = assigned.filter((x) => x.id !== m.id);
    const index = buildIndex(doc, others);
    const conflicts = placementConflicts(doc, index, m, m.assignment as Assignment);
    for (const c of conflicts) {
      const sig = `${c.code}:${[...c.matchIds].sort().join(',')}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(c);
    }
  }
  return out;
}

// 增量检测：虚拟移除被拖场次后在目标位跑同款谓词
export function validateMove(
  doc: TournamentDoc,
  matchId: string,
  target: Assignment,
): Conflict[] {
  const match = doc.matches.find((m) => m.id === matchId);
  if (!match) return [{ code: 'not_found', severity: 'hard', message: '比赛不存在', matchIds: [matchId] }];
  if (!match.teamA || !match.teamB) {
    return [{ code: 'no_teams', severity: 'hard', message: '双方队伍未定，无法排程', matchIds: [matchId] }];
  }
  const others = doc.matches.filter((m) => m.assignment && m.id !== matchId && !m.bye);
  const index = buildIndex(doc, others);
  return placementConflicts(doc, index, match, target);
}