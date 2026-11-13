// 赛程魔方 · 冲突检测与手动调整（公共 API）
// 检测谓词与求解器共享（见 predicates.ts），杜绝口径漂移。
// 手动拖拽允许「带冲突放置」——红色高亮 + 冲突面板兜底，不强制阻止。

import { buildIndex } from './predicates';
import type { Assignment, Match, TournamentDoc } from './types';

export { validateMove, detectAllConflicts, placementConflicts, buildIndex } from './predicates';

// 不可变更新：把 match 放到 target（进入 undo 栈）
export function applyMove(doc: TournamentDoc, matchId: string, target: Assignment | null): TournamentDoc {
  return {
    ...doc,
    matches: doc.matches.map((m) => (m.id === matchId ? { ...m, assignment: target } : m)),
    updatedAt: new Date().toISOString(),
  };
}

export function setPinned(doc: TournamentDoc, matchId: string, pinned: boolean): TournamentDoc {
  return {
    ...doc,
    matches: doc.matches.map((m) => (m.id === matchId ? { ...m, pinned } : m)),
    updatedAt: new Date().toISOString(),
  };
}

// 为手动落位挑选 k 个可行评委（尽力而为；返回可能为空，由冲突检测兜底）
export function autoAssignJudges(doc: TournamentDoc, matchId: string, slotId: string, venueId: string): string[] {
  const match = doc.matches.find((m) => m.id === matchId);
  const slot = doc.slots.find((s) => s.id === slotId);
  if (!match || !slot) return [];
  const k = Math.max(1, Math.min(2, doc.constraints.judgesPerMatch || 1));
  const others = doc.matches.filter((m) => m.assignment && m.id !== matchId && !m.bye);
  const index = buildIndex(doc, others);
  const teams = [match.teamA, match.teamB].filter(Boolean) as string[];
  const load = (jid: string) => index.judgeTimeline.get(jid)?.length ?? 0;
  const available = doc.judges.filter(
    (j) =>
      !j.unavailableDates.includes(slot.date) &&
      !j.affiliatedTeamIds.some((t) => teams.includes(t)) &&
      !(index.judgeTimeline.get(j.id) ?? []).some((e) => e.slotId === slotId),
  );
  available.sort((a, b) => load(a.id) - load(b.id) || a.id.localeCompare(b.id));
  return available.slice(0, k).map((j) => j.id);
}

// 汇总：某场比赛当前是否存在硬冲突（驱动卡片红徽）
export function matchHasConflict(conflictMatchIds: Set<string>, matchId: string): boolean {
  return conflictMatchIds.has(matchId);
}

export function collectConflictMatchIds(conflicts: { matchIds: string[] }[]): Set<string> {
  const set = new Set<string>();
  for (const c of conflicts) for (const id of c.matchIds) set.add(id);
  return set;
}

export type { Match };