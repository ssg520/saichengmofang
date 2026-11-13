// 赛程魔方 · 共享数据模型与时间工具
// 纯 TypeScript，无 React/DOM/网络依赖。引擎可在浏览器与 Node 单测中确定性运行。

export const SCHEMA_VERSION = 1;

export type Format = 'round_robin' | 'single_elim' | 'swiss' | 'double_elim';

export const FORMAT_LABELS: Record<Format, string> = {
  round_robin: '循环赛',
  single_elim: '单败淘汰',
  swiss: '瑞士制',
  double_elim: '双败淘汰',
};

export interface Team {
  id: string;
  name: string;
  unavailableDates: string[]; // YYYY-MM-DD，队伍当天不可用
}

export interface Venue {
  id: string;
  name: string;
  capacity: number; // 同一时段可并行场次
}

export interface Judge {
  id: string;
  name: string;
  affiliatedTeamIds: string[]; // 需回避的队伍
  unavailableDates: string[];
}

export interface TimeBlock {
  date: string; // YYYY-MM-DD
  startMin: number; // 当天起始分钟
  endMin: number; // 当天结束分钟
  matchMin: number; // 单场时长
  breakMin: number; // 场间休息
}

export interface Slot {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
}

export interface Constraints {
  minRestMin: number; // 队伍两场之间最小休息
  roundGapMin: number; // 轮次之间的最小间隔
  judgesPerMatch: number; // 每场评委数 1–2
}

// 结果：'A' = 甲方胜，'B' = 乙方胜，'draw' = 平局，null = 未录入
export type MatchResult = 'A' | 'B' | 'draw' | null;

export interface FeedsInto {
  matchId: string;
  slot: 'A' | 'B';
}

export interface Assignment {
  slotId: string;
  venueId: string;
  judgeIds: string[];
}

export type BracketSide = 'W' | 'L' | 'GF';

export interface Match {
  id: string;
  round: number;
  teamA: string | null; // null = 待定 TBD
  teamB: string | null;
  feedsInto?: FeedsInto | null; // 胜者去向（淘汰赛）
  losesInto?: FeedsInto | null; // 败者去向（双败淘汰）
  bracketSide?: BracketSide | null;
  result?: MatchResult;
  assignment?: Assignment | null;
  pinned?: boolean; // 钉住：重排时保留
  bye?: boolean; // 轮空：自动晋级，无实际对抗
  label?: string; // 展示用标签，如「胜者组 第1轮」
}

export interface ShareSettings {
  hideJudges: boolean;
}

export interface Conflict {
  code: string;
  severity: 'hard' | 'soft';
  message: string; // 中文人话提示
  matchIds: string[]; // 相关比赛
}

export interface TournamentDoc {
  schemaVersion: number;
  title: string;
  format: Format;
  teams: Team[];
  venues: Venue[];
  judges: Judge[];
  timeBlocks: TimeBlock[];
  slots: Slot[];
  constraints: Constraints;
  matches: Match[];
  shareSettings: ShareSettings;
  swissRounds?: number; // 瑞士制总轮数
  updatedAt: string;
}

// ---- 限额（与后端 validate.mjs 保持一致）----
export const LIMITS = {
  teams: 64,
  venues: 16,
  judges: 32,
  slots: 400,
  matches: 2048,
  string: 200,
  bodyBytes: 512 * 1024,
} as const;

// ---- 确定性 PRNG（mulberry32）----
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 时间工具：一律使用绝对分钟 dayIndex*1440+min，规避跨天时区坑 ----
export function buildDayIndex(slots: Slot[]): Map<string, number> {
  const dates = [...new Set(slots.map((s) => s.date))].sort();
  const map = new Map<string, number>();
  dates.forEach((d, i) => map.set(d, i));
  return map;
}

export function absStart(slot: Slot, dayIndex: Map<string, number>): number {
  return (dayIndex.get(slot.date) ?? 0) * 1440 + slot.startMin;
}

export function absEnd(slot: Slot, dayIndex: Map<string, number>): number {
  return (dayIndex.get(slot.date) ?? 0) * 1440 + slot.endMin;
}

// 将时段块展开为具体时段（向导完成时固化）
export function expandSlots(timeBlocks: TimeBlock[]): Slot[] {
  const slots: Slot[] = [];
  const sorted = [...timeBlocks].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin,
  );
  let counter = 0;
  for (const block of sorted) {
    const step = block.matchMin + block.breakMin;
    if (step <= 0 || block.matchMin <= 0) continue;
    for (let start = block.startMin; start + block.matchMin <= block.endMin; start += step) {
      slots.push({
        id: `slot-${counter++}`,
        date: block.date,
        startMin: start,
        endMin: start + block.matchMin,
      });
    }
  }
  return slots;
}

export function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatSlot(slot: Slot): string {
  return `${formatMin(slot.startMin)}–${formatMin(slot.endMin)}`;
}

// 短随机 ID（base32，不可枚举），用于 shareId
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function randomBase32(len: number, rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < len; i++) out += B32[Math.floor(rng() * B32.length)];
  return out;
}

export function newId(prefix = 'm'): string {
  return `${prefix}-${randomBase32(10)}`;
}

// 一场比赛是否已有双方队伍（可被排程）
export function isPlayable(m: Match): boolean {
  return !!m.teamA && !!m.teamB && !m.bye;
}