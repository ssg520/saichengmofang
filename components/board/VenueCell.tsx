// 赛程魔方 · 看板格子（时段×场地，droppable，可容纳 capacity 场）
import { useDroppable } from '@dnd-kit/core';
import type { Match, Slot, TournamentDoc, Venue } from '@/engine/types';
import { cn } from '@/lib/utils';
import { MatchCard } from './MatchCard';

interface Props {
  doc: TournamentDoc;
  slot: Slot;
  venue: Venue;
  matches: Match[];
  conflictMatchIds: Set<string>;
  draggable: boolean;
  overConflict: boolean;
  flying: boolean;
  showJudge: boolean;
  onCardClick: (id: string) => void;
}

export function VenueCell({ doc, slot, venue, matches, conflictMatchIds, draggable, overConflict, flying, showJudge, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `${slot.id}|${venue.id}` });
  const full = matches.length >= venue.capacity;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'cell-drop flex min-h-[64px] flex-col gap-1 p-1',
        isOver && (overConflict ? 'is-over-conflict' : 'is-over'),
      )}
    >
      {matches.map((m) => (
        <MatchCard
          key={m.id}
          doc={doc}
          match={m}
          conflict={conflictMatchIds.has(m.id)}
          draggable={draggable}
          flying={flying}
          showJudge={showJudge}
          onClick={() => onCardClick(m.id)}
        />
      ))}
      {matches.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-[10px] text-muted-foreground/40">
          {isOver ? '松开落位' : full ? '' : '空'}
        </div>
      )}
    </div>
  );
}