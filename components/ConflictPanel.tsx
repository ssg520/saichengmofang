// 赛程魔方 · 冲突面板（全量冲突清单，点击定位到比赛）
import { useState } from 'react';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import type { Conflict } from '@/engine/types';
import { cn } from '@/lib/utils';

interface Props {
  conflicts: Conflict[];
  onLocate: (matchId: string) => void;
}

export function ConflictPanel({ conflicts, onLocate }: Props) {
  const [open, setOpen] = useState(true);
  if (conflicts.length === 0) return null;
  return (
    <div className="no-print rounded-lg border border-[var(--danger)]/50 bg-[color-mix(in_srgb,var(--danger)_10%,var(--card))]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--danger)]"
      >
        <TriangleAlert className="size-4" />
        {conflicts.length} 项冲突待处理
        <ChevronDown className={cn('ml-auto size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto px-3 pb-2">
          {conflicts.map((c, i) => (
            <li key={i}>
              <button
                onClick={() => c.matchIds[0] && onLocate(c.matchIds[0])}
                className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]"
              >
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-[var(--danger)]" />
                <span className="flex-1">{c.message}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">定位</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}