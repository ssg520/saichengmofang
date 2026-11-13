// 赛程魔方 · 文档构造与示例数据（纯函数，测试与首页示例共用）
import {
  SCHEMA_VERSION,
  expandSlots,
  newId,
  type Constraints,
  type Format,
  type Judge,
  type Match,
  type Team,
  type TimeBlock,
  type TournamentDoc,
  type Venue,
} from './types';
import { generateInitialMatches } from './pairings';

export interface MakeDocOptions {
  title?: string;
  format?: Format;
  teams: (string | Partial<Team>)[];
  venues?: Partial<Venue>[];
  judges?: Partial<Judge>[];
  timeBlocks?: TimeBlock[];
  constraints?: Partial<Constraints>;
  matches?: Match[];
  swissRounds?: number;
  hideJudges?: boolean;
}

export function makeDoc(opts: MakeDocOptions): TournamentDoc {
  const teams: Team[] = opts.teams.map((t, i) =>
    typeof t === 'string'
      ? { id: `team-${i}`, name: t, unavailableDates: [] }
      : { id: t.id ?? `team-${i}`, name: t.name ?? `队伍${i + 1}`, unavailableDates: t.unavailableDates ?? [] },
  );
  const venues: Venue[] = (opts.venues ?? [{ name: '1 号场地' }, { name: '2 号场地' }]).map((v, i) => ({
    id: v.id ?? `venue-${i}`,
    name: v.name ?? `${i + 1} 号场地`,
    capacity: v.capacity ?? 1,
  }));
  const judges: Judge[] = (opts.judges ?? [{ name: '评委甲' }, { name: '评委乙' }, { name: '评委丙' }]).map((j, i) => ({
    id: j.id ?? `judge-${i}`,
    name: j.name ?? `评委${i + 1}`,
    affiliatedTeamIds: j.affiliatedTeamIds ?? [],
    unavailableDates: j.unavailableDates ?? [],
  }));
  const timeBlocks: TimeBlock[] = opts.timeBlocks ?? [
    { date: '2026-11-14', startMin: 9 * 60, endMin: 18 * 60, matchMin: 60, breakMin: 15 },
  ];
  const constraints: Constraints = {
    minRestMin: opts.constraints?.minRestMin ?? 30,
    roundGapMin: opts.constraints?.roundGapMin ?? 30,
    judgesPerMatch: opts.constraints?.judgesPerMatch ?? 1,
  };
  const slots = expandSlots(timeBlocks);
  const doc: TournamentDoc = {
    schemaVersion: SCHEMA_VERSION,
    title: opts.title ?? '未命名赛事',
    format: opts.format ?? 'round_robin',
    teams,
    venues,
    judges,
    timeBlocks,
    slots,
    constraints,
    matches: opts.matches ?? [],
    shareSettings: { hideJudges: opts.hideJudges ?? false },
    swissRounds: opts.swissRounds,
    updatedAt: new Date().toISOString(),
  };
  if (!opts.matches) doc.matches = generateInitialMatches(doc);
  return doc;
}

// 首页默认示例：8 队循环赛，已排好，评委 3 人含 1 回避，2 场地。
// 每个访客载入的是独立副本（前端生成新 id），随意拖改不影响他人。
export function buildSampleTournament(): TournamentDoc {
  const doc = makeDoc({
    title: '示例 · 高校辩论邀请赛',
    format: 'round_robin',
    teams: ['文学院', '法学院', '计算机学院', '经济学院', '外国语学院', '数学学院', '物理学院', '医学院'],
    venues: [
      { name: '第一报告厅', capacity: 1 },
      { name: '第二报告厅', capacity: 1 },
      { name: '第三报告厅', capacity: 1 },
      { name: '第四报告厅', capacity: 1 },
    ],
    judges: [
      { name: '张教授', affiliatedTeamIds: ['team-0'] }, // 回避文学院
      { name: '李教授', affiliatedTeamIds: [] },
      { name: '王教授', affiliatedTeamIds: [] },
      { name: '赵教授', affiliatedTeamIds: [] },
      { name: '陈教授', affiliatedTeamIds: [] },
    ],
    timeBlocks: [
      { date: '2026-11-14', startMin: 9 * 60, endMin: 18 * 60, matchMin: 50, breakMin: 10 },
      { date: '2026-11-15', startMin: 9 * 60, endMin: 18 * 60, matchMin: 50, breakMin: 10 },
    ],
    constraints: { minRestMin: 20, roundGapMin: 20, judgesPerMatch: 1 },
  });
  return doc;
}

export { newId };