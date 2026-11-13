// 赛程魔方 · 排程报告（把算法威力翻译成秒懂画面）
import { CheckCircle2, Clock, Layers, Timer, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TournamentDoc } from '@/engine/types';
import { reasonText, type SolveReport, type UnplacedInfo } from '@/engine/solver';
import { CUBE_COLORS } from '@/lib/ui';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  report: SolveReport | null;
  unplaced: UnplacedInfo[];
  doc: TournamentDoc;
}

function spanText(min: number): string {
  if (min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function LoadBars({ title, entries, max }: { title: string; entries: { id: string; name: string; count: number }[]; max: number }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="space-y-1.5">
        {entries.map((e, i) => (
          <div key={e.id} className="flex items-center gap-2">
            <span className="w-20 shrink-0 truncate text-xs">{e.name}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${max > 0 ? (e.count / max) * 100 : 0}%`, background: CUBE_COLORS[i % CUBE_COLORS.length] }}
              />
            </div>
            <span className="stat-num w-8 shrink-0 text-right text-xs text-muted-foreground">{e.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SolveReportDialog({ open, onOpenChange, report, unplaced, doc }: Props) {
  if (!report) return null;
  const perfect = report.unplaced === 0 && report.conflicts === 0;
  const reasonTally = new Map<string, number>();
  for (const u of unplaced) reasonTally.set(u.reason, (reasonTally.get(u.reason) ?? 0) + 1);
  const maxVenue = report.venueLoad.reduce((m, v) => Math.max(m, v.count), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto scrollbar-thin sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Layers className="size-5 text-[var(--site-accent)]" />
            排程报告
          </DialogTitle>
          <DialogDescription>
            {perfect ? '全部场次各就各位，零冲突。' : '已尽力排程，部分场次需补充资源或手动调整。'}
          </DialogDescription>
        </DialogHeader>

        {/* 英雄数字 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="fade-up rounded-lg border border-border bg-card p-3 text-center">
            <div className="stat-num text-3xl font-bold text-[var(--site-accent)]">
              {report.placed}<span className="text-base text-muted-foreground">/{report.total}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">已排场次</div>
          </div>
          <div className="fade-up rounded-lg border border-border bg-card p-3 text-center" style={{ animationDelay: '60ms' }}>
            <div className={`stat-num flex items-center justify-center gap-1 text-3xl font-bold ${report.conflicts === 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
              {report.conflicts === 0 && <CheckCircle2 className="size-6" />}
              {report.conflicts}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">硬冲突</div>
          </div>
          <div className="fade-up rounded-lg border border-border bg-card p-3 text-center" style={{ animationDelay: '120ms' }}>
            <div className="stat-num text-3xl font-bold">{(report.durationMs / 1000).toFixed(2)}<span className="text-base text-muted-foreground">s</span></div>
            <div className="mt-1 text-xs text-muted-foreground">求解耗时</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div className="rounded-md bg-secondary/60 py-2">
            <Layers className="mx-auto mb-1 size-4 text-muted-foreground" />
            <span className="stat-num font-semibold">{report.rounds}</span> 轮次
          </div>
          <div className="rounded-md bg-secondary/60 py-2">
            <Clock className="mx-auto mb-1 size-4 text-muted-foreground" />
            跨度 <span className="stat-num font-semibold">{spanText(report.makespanMin)}</span>
          </div>
          <div className="rounded-md bg-secondary/60 py-2">
            <Timer className="mx-auto mb-1 size-4 text-muted-foreground" />
            评委最重 <span className="stat-num font-semibold">{report.maxJudgeLoad}</span> 场
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <LoadBars title="评委负载（场）" entries={report.judgeLoad} max={report.maxJudgeLoad} />
          <LoadBars title="场地使用（场）" entries={report.venueLoad} max={maxVenue} />
        </div>

        {report.unplaced > 0 && (
          <div className="rounded-lg border border-[var(--cube-4)]/40 bg-[color-mix(in_srgb,var(--cube-4)_10%,transparent)] p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--cube-4)]">
              <TriangleAlert className="size-4" />
              {report.unplaced} 场未排上 · 差什么
            </div>
            <ul className="mb-2 space-y-1 text-xs">
              {[...reasonTally.entries()].map(([reason, count]) => (
                <li key={reason} className="flex justify-between gap-2">
                  <span>{reasonText(reason as never)}</span>
                  <span className="stat-num text-muted-foreground">{count} 场</span>
                </li>
              ))}
            </ul>
            {report.suggestions.length > 0 && (
              <div className="space-y-1 border-t border-[var(--cube-4)]/20 pt-2 text-xs text-muted-foreground">
                {report.suggestions.map((s, i) => (
                  <div key={i}>· {s}</div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={() => onOpenChange(false)}>继续调整赛程</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}