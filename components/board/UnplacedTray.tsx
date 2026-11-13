// 赛程魔方 · 未排程托盘（droppable：把卡拖回这里即取消排程）
import { useDroppable } from '@dnd-kit/core';
import { Inbox } from 'lucide-react';
import type { Match, TournamentDoc } from '@/engine/types';
import { reasonText, type UnplacedInfo } from '@/engine/solver';
import { cn } from '@/lib/utils';
import { MatchCard } from './MatchCard';

interface Props {
  doc: TournamentDoc;
  matches: Match[];
  unplaced: UnplacedInfo[];
  conflictMatchIds: Set<string>;
  draggable: boolean;
  onCardClick: (id: string) => void;
}

export function UnplacedTray({ doc, matches, unplaced, conflictMatchIds, draggable, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unplaced' });
  const reasonById = new Map(unplaced.map((u) => [u.matchId, u.reason]));
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full flex-col rounded-lg border border-border bg-card/60 p-3 transition-colors',
        isOver && 'border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_10%,transparent)]',
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Inbox className="size-4 text-muted-foreground" />
        未排程
        <span className="stat-num rounded bg-secondary px-1.5 text-xs text-muted-foreground">{matches.length}</span>
      </div>
      {matches.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center text-xs text-muted-foreground">
          <span className="text-2xl">✓</span>
          全部场次已排程
          <span className="text-[10px] opacity-70">把卡片拖到这里可取消排程</span>
        </div>
      ) : (
        <div className="scrollbar-thin flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {matches.map((m) => {
            const reason = reasonById.get(m.id);
            return (
              <div key={m.id}>
                <MatchCard
                  doc={doc}
                  match={m}
                  conflict={conflictMatchIds.has(m.id)}
                  draggable={draggable}
                  showJudge={false}
                  onClick={() => onCardClick(m.id)}
                />
                {reason && <div className="mt-0.5 px-1 text-[10px] text-[var(--cube-4)]">{reasonText(reason)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}