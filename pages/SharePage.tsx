// 赛程魔方 · 公开分享页（匿名只读 + 队伍过滤 + 二维码 + 导出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Image as ImageIcon, Loader2, Printer, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CubeLogo } from '@/components/CubeLogo';
import { MatchDetailSheet } from '@/components/MatchDetailSheet';
import { ScheduleBoard } from '@/components/board/ScheduleBoard';
import { detectAllConflicts, collectConflictMatchIds } from '@/engine/conflicts';
import { FORMAT_LABELS, type TournamentDoc } from '@/engine/types';
import { api, apiMessage, type ShareResult } from '@/lib/api';
import { downloadCSV, exportPNG, printView } from '@/lib/export';

export function SharePage() {
  const { shareId = '' } = useParams();
  const [data, setData] = useState<ShareResult | null>(null);
  const [error, setError] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.share(shareId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        if (new URLSearchParams(window.location.search).get('view') === 'print') setTimeout(printView, 600);
      })
      .catch((e) => { if (!cancelled) setError(apiMessage(e)); });
    return () => { cancelled = true; };
  }, [shareId]);

  const doc: TournamentDoc | null = data?.data ?? null;
  const conflicts = useMemo(() => (doc ? detectAllConflicts(doc) : []), [doc]);
  const conflictMatchIds = useMemo(() => collectConflictMatchIds(conflicts), [conflicts]);

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center">
          <CubeLogo size={40} className="mx-auto mb-3" />
          {error ? (
            <p className="text-sm text-muted-foreground">{error}</p>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 cube-spin" /> 正在加载分享赛程…</div>
          )}
        </div>
      </div>
    );
  }

  const showJudge = !doc.shareSettings.hideJudges;
  const shareUrl = window.location.href.split('?')[0];

  async function handlePNG() {
    if (!boardRef.current || !doc) return;
    try { toast.info('正在生成图片…'); await exportPNG(boardRef.current, doc.title); toast.success('图片已导出'); }
    catch { toast.error('图片导出失败'); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="no-print flex flex-wrap items-center gap-2 border-b border-border bg-[var(--sidebar)]/80 px-3 py-2 backdrop-blur">
        <CubeLogo size={28} />
        <span className="truncate text-sm font-semibold">{doc.title}</span>
        <Badge variant="outline" className="border-[var(--site-accent)]/40 text-[10px] text-[var(--site-accent)]">{FORMAT_LABELS[doc.format]}</Badge>
        <Badge variant="secondary" className="text-[10px]">只读分享</Badge>
        <div className="ml-auto flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="二维码"><QrCode className="size-4" /></Button></PopoverTrigger>
            <PopoverContent className="w-auto"><div className="rounded bg-white p-2"><QRCodeSVG value={shareUrl} size={150} /></div><p className="mt-2 text-center text-[10px] text-muted-foreground">扫码在手机上查看</p></PopoverContent>
          </Popover>
          <Button size="icon-sm" variant="ghost" onClick={() => { downloadCSV(doc); toast.success('CSV 已导出'); }} aria-label="导出 CSV"><Download className="size-4" /></Button>
          <Button size="icon-sm" variant="ghost" onClick={() => void handlePNG()} aria-label="导出图片"><ImageIcon className="size-4" /></Button>
          <Button size="icon-sm" variant="ghost" onClick={printView} aria-label="打印"><Printer className="size-4" /></Button>
        </div>
      </header>

      <div className="no-print flex items-center gap-2 px-3 py-2">
        <span className="text-xs text-muted-foreground">只看我的队伍：</span>
        <NativeSelect value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="h-8 w-48 text-xs">
          <NativeSelectOption value="all">全部队伍</NativeSelectOption>
          {doc.teams.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.name}</NativeSelectOption>)}
        </NativeSelect>
        {conflicts.length > 0 && <span className="ml-auto text-xs text-[var(--danger)]">{conflicts.length} 项冲突</span>}
      </div>

      <div ref={boardRef} className="min-h-0 flex-1 px-3 pb-3">
        <ScheduleBoard
          doc={doc}
          conflictMatchIds={conflictMatchIds}
          unplaced={[]}
          draggable={false}
          showJudge={showJudge}
          flying={false}
          teamFilter={teamFilter === 'all' ? null : teamFilter}
          onCardClick={(id) => { setSelectedId(id); setDetailOpen(true); }}
        />
      </div>

      <MatchDetailSheet doc={doc} matchId={selectedId} open={detailOpen} onOpenChange={(v) => { setDetailOpen(v); if (!v) setSelectedId(null); }} readOnly />
    </div>
  );
}