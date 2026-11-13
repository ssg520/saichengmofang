// 赛程魔方 · 导出与备份（CSV / 打印 / PNG / JSON）
// CSV 手写并加 BOM，确保 Excel 打开中文不乱码。PNG 用 html-to-image。

import { toPng } from 'html-to-image';
import { formatMin, type TournamentDoc } from '@/engine/types';

function teamName(doc: TournamentDoc, id: string | null): string {
  if (!id) return '待定';
  return doc.teams.find((t) => t.id === id)?.name ?? id;
}
function venueName(doc: TournamentDoc, id: string): string {
  return doc.venues.find((v) => v.id === id)?.name ?? id;
}
function judgeNames(doc: TournamentDoc, ids: string[]): string {
  return ids.map((j) => doc.judges.find((x) => x.id === j)?.name ?? j).join('、');
}
function resultText(doc: TournamentDoc, m: TournamentDoc['matches'][number]): string {
  if (m.bye) return '轮空晋级';
  if (!m.result) return '未赛';
  if (m.result === 'draw') return '平局';
  return `${teamName(doc, m.result === 'A' ? m.teamA : m.teamB)} 胜`;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCSV(doc: TournamentDoc): string {
  const slotById = new Map(doc.slots.map((s) => [s.id, s]));
  const header = ['轮次', '日期', '开始', '结束', '场地', '队伍A', '队伍B', '评委', '结果', '状态'];
  const placed = doc.matches.filter((m) => m.assignment);
  placed.sort((a, b) => {
    const sa = slotById.get(a.assignment!.slotId);
    const sb = slotById.get(b.assignment!.slotId);
    const ka = sa ? `${sa.date} ${String(sa.startMin).padStart(4, '0')}` : '';
    const kb = sb ? `${sb.date} ${String(sb.startMin).padStart(4, '0')}` : '';
    return ka < kb ? -1 : ka > kb ? 1 : a.round - b.round;
  });
  const lines = [header.join(',')];
  for (const m of placed) {
    const a = m.assignment!;
    const slot = slotById.get(a.slotId);
    lines.push(
      [
        m.label ?? `第${m.round}轮`,
        slot?.date ?? '',
        slot ? formatMin(slot.startMin) : '',
        slot ? formatMin(slot.endMin) : '',
        venueName(doc, a.venueId),
        teamName(doc, m.teamA),
        teamName(doc, m.teamB),
        judgeNames(doc, a.judgeIds),
        resultText(doc, m),
        m.pinned ? '已锁定' : '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  const unplaced = doc.matches.filter((m) => !m.assignment && !m.bye && m.teamA && m.teamB);
  for (const m of unplaced) {
    lines.push(
      [m.label ?? `第${m.round}轮`, '', '', '', '未排程', teamName(doc, m.teamA), teamName(doc, m.teamB), '', resultText(doc, m), '待排']
        .map(csvCell)
        .join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(title: string): string {
  return (title || '赛程').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

export function downloadCSV(doc: TournamentDoc): void {
  downloadText(`${safeName(doc.title)}-赛程.csv`, toCSV(doc), 'text/csv;charset=utf-8');
}

export function exportJSON(doc: TournamentDoc): void {
  downloadText(`${safeName(doc.title)}-备份.json`, JSON.stringify(doc, null, 2), 'application/json');
}

export function parseImport(text: string): TournamentDoc {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.teams) || !Array.isArray(data.matches)) {
    throw new Error('不是赛程魔方备份文件（schemaVersion 应为 1）');
  }
  return data as TournamentDoc;
}

export async function exportPNG(element: HTMLElement, title: string): Promise<void> {
  const dataUrl = await toPng(element, {
    backgroundColor: '#0b1020',
    pixelRatio: 2,
    cacheBust: true,
    filter: (node) => !(node instanceof HTMLElement && node.dataset?.export === 'exclude'),
  });
  const blob = await (await fetch(dataUrl)).blob();
  triggerDownload(blob, `${safeName(title)}-赛程.png`);
}

export function printView(): void {
  window.print();
}