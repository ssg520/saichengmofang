// 赛程魔方 · 赛程看板（演示主舞台）
// 时间×场地网格 + DndContext 拖拽 + 共享谓词实时冲突预览（绿/红格 + 人话提示）。
// 拖拽允许带冲突落位（红色高亮 + 冲突面板兜底），不强制阻止。

import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import { Fragment, useMemo, useState } from 'react';
import { autoAssignJudges, validateMove } from '@/engine/conflicts';
import { absStart, buildDayIndex, formatMin, type Conflict, type Match, type TournamentDoc } from '@/engine/types';
import type { UnplacedInfo } from '@/engine/solver';
import { useStore } from '@/store/tournament';
import { cn } from '@/lib/utils';
import { MatchCard } from './MatchCard';
import { UnplacedTray } from './UnplacedTray';
import { VenueCell } from './VenueCell';

interface Props {
  doc: TournamentDoc;
  conflictMatchIds: Set<string>;
  unplaced: UnplacedInfo[];
  draggable: boolean;
  showJudge: boolean;
  flying: boolean;
  teamFilter: string | null;
  onCardClick: (id: string) => void;
}

interface Preview {
  overId: string;
  conflict: boolean;
  messages: Conflict[];
}

export function ScheduleBoard({ doc, conflictMatchIds, unplaced, draggable, showJudge, flying, teamFilter, onCardClick }: Props) {
  const moveMatch = useStore((s) => s.moveMatch);
  const unplaceMatch = useStore((s) => s.unplaceMatch);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const dayIndex = useMemo(() => buildDayIndex(doc.slots), [doc.slots]);
  const orderedSlots = useMemo(
    () => [...doc.slots].sort((a, b) => absStart(a, dayIndex) - absStart(b, dayIndex) || a.id.localeCompare(b.id)),
    [doc.slots, dayIndex],
  );

  // 单元格索引：`${slotId}|${venueId}` -> Match[]
  const cellMap = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of doc.matches) {
      if (!m.assignment) continue;
      if (teamFilter && m.teamA !== teamFilter && m.teamB !== teamFilter) continue;
      const key = `${m.assignment.slotId}|${m.assignment.venueId}`;
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }, [doc.matches, teamFilter]);

  const unplacedMatches = useMemo(
    () => doc.matches.filter((m) => !m.assignment && !m.bye && m.teamA && m.teamB && (!teamFilter || m.teamA === teamFilter || m.teamB === teamFilter)),
    [doc.matches, teamFilter],
  );

  const activeMatch = activeId ? doc.matches.find((m) => m.id === activeId) ?? null : null;

  function parseCell(id: string): { slotId: string; venueId: string } | null {
    const idx = id.indexOf('|');
    if (idx < 0) return null;
    return { slotId: id.slice(0, idx), venueId: id.slice(idx + 1) };
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const overId = e.over?.id ? String(e.over.id) : null;
    const id = String(e.active.id);
    if (!overId || overId === 'unplaced') {
      setPreview(null);
      return;
    }
    const cell = parseCell(overId);
    if (!cell) {
      setPreview(null);
      return;
    }
    const judgeIds = autoAssignJudges(doc, id, cell.slotId, cell.venueId);
    const conflicts = validateMove(doc, id, { slotId: cell.slotId, venueId: cell.venueId, judgeIds });
    setPreview({ overId, conflict: conflicts.length > 0, messages: conflicts });
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (overId === 'unplaced') {
      unplaceMatch(id);
    } else if (overId) {
      const cell = parseCell(overId);
      if (cell) moveMatch(id, cell.slotId, cell.venueId);
    }
    setActiveId(null);
    setPreview(null);
  }

  if (doc.venues.length === 0 || doc.slots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        请先在「资源」与「时间」中配置场地和时段
      </div>
    );
  }

  const gridCols = `76px repeat(${doc.venues.length}, minmax(158px, 1fr))`;
  let lastDate = '';

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setPreview(null); }}>
      <div className="flex h-full min-h-0 gap-3">
        <div className="scrollbar-thin relative flex-1 overflow-auto rounded-lg border border-border bg-card/30">
          {preview?.conflict && (
            <div className="sticky top-0 z-30 mx-2 mt-2 rounded-md border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_18%,var(--card))] px-3 py-1.5 text-xs text-[var(--danger)] shadow-lg">
              {preview.messages[0]?.message}
              {preview.messages.length > 1 && ` 等 ${preview.messages.length} 项冲突`}
            </div>
          )}
          <div className="grid min-w-max" style={{ gridTemplateColumns: gridCols }}>
            {/* 表头 */}
            <div className="sticky top-0 z-20 border-b border-border bg-[var(--sidebar)] px-2 py-2 text-[11px] font-medium text-muted-foreground">
              时间
            </div>
            {doc.venues.map((v) => (
              <div key={v.id} className="sticky top-0 z-20 border-b border-l border-border bg-[var(--sidebar)] px-2 py-2 text-center text-xs font-semibold">
                {v.name}
                {v.capacity > 1 && <span className="ml-1 text-[10px] font-normal text-muted-foreground">×{v.capacity}</span>}
              </div>
            ))}
            {/* 行 */}
            {orderedSlots.map((slot) => {
              const showDate = slot.date !== lastDate;
              lastDate = slot.date;
              return (
                <Fragment key={slot.id}>
                  {showDate && (
                    <div className="col-span-full border-y border-border bg-[color-mix(in_srgb,var(--site-accent)_7%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--site-accent)]">
                      {slot.date}
                    </div>
                  )}
                  <div className="stat-num flex flex-col justify-center border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
                    <span>{formatMin(slot.startMin)}</span>
                    <span className="opacity-60">{formatMin(slot.endMin)}</span>
                  </div>
                  {doc.venues.map((v) => {
                    const key = `${slot.id}|${v.id}`;
                    return (
                      <div key={v.id} className="border-b border-l border-border/60 p-1">
                        <VenueCell
                          doc={doc}
                          slot={slot}
                          venue={v}
                          matches={cellMap.get(key) ?? []}
                          conflictMatchIds={conflictMatchIds}
                          draggable={draggable}
                          overConflict={preview?.overId === key && preview.conflict}
                          flying={flying}
                          showJudge={showJudge}
                          onCardClick={onCardClick}
                        />
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
        {draggable && (
          <div className="hidden w-60 shrink-0 md:block">
            <UnplacedTray
              doc={doc}
              matches={unplacedMatches}
              unplaced={unplaced}
              conflictMatchIds={conflictMatchIds}
              draggable={draggable}
              onCardClick={onCardClick}
            />
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeMatch ? <MatchCard doc={doc} match={activeMatch} preview showJudge={showJudge} /> : null}
      </DragOverlay>
    </DndContext>
  );
}