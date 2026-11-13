// 赛程魔方 · 展示辅助（轮次配色 / 名称解析 / 结果文案）
import type { Match, TournamentDoc } from '@/engine/types';

export const CUBE_COLORS = [
  'var(--cube-1)',
  'var(--cube-2)',
  'var(--cube-3)',
  'var(--cube-4)',
  'var(--cube-5)',
  'var(--cube-6)',
  'var(--cube-7)',
  'var(--cube-8)',
];

export function roundColor(round: number): string {
  return CUBE_COLORS[(Math.max(1, round) - 1) % CUBE_COLORS.length];
}

export function teamName(doc: TournamentDoc, id: string | null): string {
  if (!id) return '待定';
  return doc.teams.find((t) => t.id === id)?.name ?? id;
}
export function venueName(doc: TournamentDoc, id: string): string {
  return doc.venues.find((v) => v.id === id)?.name ?? id;
}
export function judgeName(doc: TournamentDoc, id: string): string {
  return doc.judges.find((j) => j.id === id)?.name ?? id;
}

export function matchTitle(doc: TournamentDoc, m: Match): string {
  if (m.bye) return `${teamName(doc, m.teamA)} · 轮空`;
  return `${teamName(doc, m.teamA)} vs ${teamName(doc, m.teamB)}`;
}

export function resultLabel(doc: TournamentDoc, m: Match): string {
  if (m.bye) return '轮空晋级';
  if (!m.result) return '未赛';
  if (m.result === 'draw') return '平局';
  return `${teamName(doc, m.result === 'A' ? m.teamA : m.teamB)} 胜`;
}

export function winnerSide(m: Match): 'A' | 'B' | null {
  if (m.result === 'A' || m.result === 'B') return m.result;
  return null;
}