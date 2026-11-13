// 赛程魔方 · 比赛卡（按轮次着色 / 可拖拽 / 冲突红徽 / 锁定标记）
import { useDraggable } from '@dnd-kit/core';
import { AlertTriangle, Pin, Trophy } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Match, TournamentDoc } from '@/engine/types';
import { judgeName, matchTitle, roundColor, teamName, winnerSide } from '@/lib/ui';
import { cn } from '@/lib/utils';

interface Props {
  doc: TournamentDoc;
  match: Match;
  conflict?: boolean;
  draggable?: boolean;
  preview?: boolean; // DragOverlay 中的浮层副本
  flying?: boolean; // 一键排程飞入动画
  showJudge?: boolean;
  onClick?: () => void;
}

export function MatchCard({ doc, match, conflict, draggable, preview, flying, showJudge = true, onClick }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: match.id,
    disabled: !draggable || preview,
  });
  const win = winnerSide(match);
  const judges = match.assignment?.judgeIds ?? [];
  const style = { '--rc': roundColor(match.round) } as CSSProperties;

  const teamRow = (side: 'A' | 'B') => {
    const id = side === 'A' ? match.teamA : match.teamB;
    const isWin = win === side;
    const isLose = win !== null && win !== side;
    return (
      <div className={cn('flex items-center gap-1 truncate text-[13px] leading-tight', isWin && 'font-semibold', isLose && 'opacity-55')}>
        {isWin && <Trophy className="size-3 shrink-0 text-[var(--cube-4)]" />}
        <span className="truncate">{teamName(doc, id)}</span>
      </div>
    );
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable && !preview ? { ...attributes, ...listeners } : {})}
      onClick={onClick}
      role={draggable ? 'button' : undefined}
      tabIndex={draggable ? 0 : undefined}
      onKeyDown={draggable ? (e) => { if (e.key === 'Enter') onClick?.(); } : undefined}
      className={cn(
        'match-card group cursor-grab px-2 py-1.5 active:cursor-grabbing',
        conflict && 'is-conflict',
        match.pinned && 'is-pinned',
        isDragging && !preview && 'is-dragging',
        flying && 'fly-in',
        preview && 'cursor-grabbing shadow-2xl rotate-1',
        !draggable && 'cursor-pointer',
      )}
      title={matchTitle(doc, match)}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="round-chip stat-num rounded px-1.5 py-px text-[10px] font-medium">
          {match.label ?? `R${match.round}`}
        </span>
        <span className="flex items-center gap-1">
          {match.pinned && <Pin className="size-3 text-[var(--cube-4)]" />}
          {conflict && <AlertTriangle className="size-3.5 text-[var(--danger)]" />}
        </span>
      </div>
      {match.bye ? (
        <div className="truncate text-[13px] font-medium">{teamName(doc, match.teamA)} <span className="text-muted-foreground">轮空</span></div>
      ) : (
        <div className="space-y-0.5">
          {teamRow('A')}
          {teamRow('B')}
        </div>
      )}
      {showJudge && judges.length > 0 && (
        <div className="mt-1 truncate text-[10px] text-muted-foreground">
          {judges.map((j) => judgeName(doc, j)).join('、')}
        </div>
      )}
    </div>
  );
}