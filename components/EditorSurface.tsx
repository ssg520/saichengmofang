// 赛程魔方 · 编辑工作面（首页与编辑器共用：工具栏 + 看板 + 面板 + 弹窗）
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CalendarClock, Check, CloudOff, Home, Loader2, Redo2, RefreshCw, Save, Share2, Undo2, Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CubeLogo } from '@/components/CubeLogo';
import { ConflictPanel } from '@/components/ConflictPanel';
import { ConstraintsPanel } from '@/components/ConstraintsPanel';
import { MatchDetailSheet } from '@/components/MatchDetailSheet';
import { ResourcesPanel } from '@/components/ResourcesPanel';
import { ShareDialog } from '@/components/ShareDialog';
import { SolveReportDialog } from '@/components/SolveReportDialog';
import { ScheduleBoard } from '@/components/board/ScheduleBoard';
import { FORMAT_LABELS } from '@/engine/types';
import { useStore, type SaveState } from '@/store/tournament';

const SAVE_META: Record<SaveState, { label: string; className: string }> = {
  idle: { label: '就绪', className: 'text-muted-foreground' },
  local: { label: '本地副本', className: 'text-[var(--cube-4)]' },
  saving: { label: '保存中…', className: 'text-muted-foreground' },
  saved: { label: '已保存到云端', className: 'text-[var(--success)]' },
  conflict: { label: '云端有更新', className: 'text-[var(--danger)]' },
  offline: { label: '离线 · 已存本地', className: 'text-muted-foreground' },
};

export function EditorSurface({ onOpenLibrary }: { onOpenLibrary?: () => void }) {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const saveState = useStore((s) => s.saveState);
  const cloudAvailable = useStore((s) => s.cloudAvailable);
  const conflicts = useStore((s) => s.conflicts);
  const conflictMatchIds = useStore((s) => s.conflictMatchIds);
  const report = useStore((s) => s.report);
  const unplaced = useStore((s) => s.unplaced);
  const solving = useStore((s) => s.solving);
  const flyNonce = useStore((s) => s.flyNonce);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const ui = useStore((s) => s.ui);
  const setUi = useStore((s) => s.setUi);
  const selectMatch = useStore((s) => s.selectMatch);
  const solveNow = useStore((s) => s.solveNow);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const saveNow = useStore((s) => s.saveNow);
  const reloadFromCloud = useStore((s) => s.reloadFromCloud);
  const generateNextSwissRound = useStore((s) => s.generateNextSwissRound);

  const boardRef = useRef<HTMLDivElement>(null);
  const [flying, setFlying] = useState(false);
  const firstFly = useRef(true);

  useEffect(() => {
    if (firstFly.current) {
      firstFly.current = false;
      return;
    }
    setFlying(true);
    const t = setTimeout(() => setFlying(false), 700);
    return () => clearTimeout(t);
  }, [flyNonce]);

  // 键盘快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+S
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
      else if (key === 's') { e.preventDefault(); void saveNow(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveNow]);

  if (!doc) return null;
  const save = SAVE_META[saveState];
  const placedCount = doc.matches.filter((m) => m.assignment).length;
  const playableCount = doc.matches.filter((m) => m.teamA && m.teamB && !m.bye).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <header className="no-print flex flex-wrap items-center gap-2 border-b border-border bg-[var(--sidebar)]/80 px-3 py-2 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent" title="返回首页">
          <CubeLogo size={28} />
          <span className="hidden text-sm font-bold tracking-tight sm:inline">赛程魔方</span>
        </Link>
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{doc.title}</span>
          <Badge variant="outline" className="shrink-0 border-[var(--site-accent)]/40 text-[10px] text-[var(--site-accent)]">
            {FORMAT_LABELS[doc.format]}
          </Badge>
          {cloudAvailable === false && (
            <Tooltip><TooltipTrigger asChild>
              <Badge variant="outline" className="shrink-0 cursor-help border-[var(--cube-4)]/40 text-[10px] text-[var(--cube-4)]">本地演示</Badge>
            </TooltipTrigger><TooltipContent>纯前端演示版：排程/拖拽/导出在浏览器内可用，云端保存与分享升级中</TooltipContent></Tooltip>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="stat-num mr-1 hidden text-xs text-muted-foreground lg:inline">
            {placedCount}/{playableCount} 场
          </span>

          <Button size="sm" onClick={solveNow} disabled={solving} className="bg-[var(--site-accent)] text-[var(--site-on-accent)] hover:bg-[var(--site-accent)]/90">
            {solving ? <Loader2 className="size-4 cube-spin" /> : <Zap className="size-4" />}
            {solving ? '求解中…' : '一键排程'}
          </Button>

          {doc.format === 'swiss' && (
            <Button size="sm" variant="outline" onClick={generateNextSwissRound}>
              <RefreshCw className="size-4" /> 下一轮
            </Button>
          )}

          <Tooltip><TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={undo} disabled={!past.length} aria-label="撤销"><Undo2 className="size-4" /></Button>
          </TooltipTrigger><TooltipContent>撤销 (Ctrl+Z)</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={redo} disabled={!future.length} aria-label="重做"><Redo2 className="size-4" /></Button>
          </TooltipTrigger><TooltipContent>重做 (Ctrl+Shift+Z)</TooltipContent></Tooltip>

          <Button size="sm" variant="outline" onClick={() => setUi({ resourcesOpen: true })}><Users className="size-4" /> <span className="hidden sm:inline">资源</span></Button>
          <Button size="sm" variant="outline" onClick={() => setUi({ constraintsOpen: true })}><CalendarClock className="size-4" /> <span className="hidden sm:inline">时间</span></Button>
          <Button size="sm" variant="outline" onClick={() => setUi({ shareOpen: true })}><Share2 className="size-4" /> <span className="hidden sm:inline">分享</span></Button>

          <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

          <span className={`flex items-center gap-1 text-xs ${save.className}`}>
            {saveState === 'saved' && <Check className="size-3.5" />}
            {saveState === 'offline' && <CloudOff className="size-3.5" />}
            {saveState === 'saving' && <Loader2 className="size-3.5 cube-spin" />}
            <span className="hidden md:inline">{save.label}</span>
          </span>
          {saveState === 'conflict' ? (
            <Button size="sm" variant="outline" onClick={() => void reloadFromCloud()}>读取最新</Button>
          ) : (
            <Tooltip><TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => void saveNow()} aria-label="保存"><Save className="size-4" /></Button>
            </TooltipTrigger><TooltipContent>保存到云端 (Ctrl+S)</TooltipContent></Tooltip>
          )}
          <Tooltip><TooltipTrigger asChild>
            {onOpenLibrary ? (
              <Button size="icon-sm" variant="ghost" aria-label="我的赛事" onClick={onOpenLibrary}><Home className="size-4" /></Button>
            ) : (
              <Link to="/"><Button size="icon-sm" variant="ghost" aria-label="首页"><Home className="size-4" /></Button></Link>
            )}
          </TooltipTrigger><TooltipContent>我的赛事</TooltipContent></Tooltip>
        </div>
      </header>

      {/* 冲突面板 */}
      {conflicts.length > 0 && (
        <div className="no-print px-3 pt-2">
          <ConflictPanel conflicts={conflicts} onLocate={(id) => selectMatch(id)} />
        </div>
      )}

      {/* 看板 */}
      <div ref={boardRef} className="min-h-0 flex-1 p-3">
        <ScheduleBoard
          doc={doc}
          conflictMatchIds={conflictMatchIds}
          unplaced={unplaced}
          draggable
          showJudge={!doc.shareSettings.hideJudges}
          flying={flying}
          teamFilter={ui.teamFilter}
          onCardClick={(id) => selectMatch(id)}
        />
      </div>

      {/* 弹窗与抽屉 */}
      <SolveReportDialog open={ui.reportOpen} onOpenChange={(v) => setUi({ reportOpen: v })} report={report} unplaced={unplaced} doc={doc} />
      <ShareDialog open={ui.shareOpen} onOpenChange={(v) => setUi({ shareOpen: v })} doc={doc} meta={meta} getBoardEl={() => boardRef.current} />
      <MatchDetailSheet doc={doc} matchId={ui.selectedMatchId} open={ui.detailOpen} onOpenChange={(v) => setUi({ detailOpen: v, selectedMatchId: v ? ui.selectedMatchId : null })} />
      <ResourcesPanel doc={doc} open={ui.resourcesOpen} onOpenChange={(v) => setUi({ resourcesOpen: v })} />
      <ConstraintsPanel doc={doc} open={ui.constraintsOpen} onOpenChange={(v) => setUi({ constraintsOpen: v })} />
    </div>
  );
}