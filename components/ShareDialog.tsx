// 赛程魔方 · 分享与导出（二维码 / 只读链接 / 管理链接 / CSV·PNG·打印·JSON）
import { QRCodeSVG } from 'qrcode.react';
import { Copy, CloudOff, Download, FileJson, Image as ImageIcon, Link2, Printer, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import type { TournamentDoc } from '@/engine/types';
import { downloadCSV, exportJSON, exportPNG, printView } from '@/lib/export';
import { useStore, type SessionMeta } from '@/store/tournament';

interface Props {
  doc: TournamentDoc;
  meta: SessionMeta;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  getBoardEl: () => HTMLElement | null;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}已复制`);
  } catch {
    toast.error('复制失败，请手动选择文本');
  }
}

export function ShareDialog({ doc, meta, open, onOpenChange, getBoardEl }: Props) {
  const createCloud = useStore((s) => s.createCloud);
  const patchDoc = useStore((s) => s.patchDoc);
  const saveState = useStore((s) => s.saveState);
  const cloudAvailable = useStore((s) => s.cloudAvailable);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl = meta.shareId ? `${origin}/s/${meta.shareId}` : '';
  const manageUrl = meta.id && meta.editToken ? `${origin}/t/${meta.id}#k=${meta.editToken}` : '';

  async function handlePNG() {
    const el = getBoardEl();
    if (!el) {
      toast.error('未找到赛程看板');
      return;
    }
    try {
      toast.info('正在生成图片…');
      await exportPNG(el, doc.title);
      toast.success('图片已导出');
    } catch {
      toast.error('图片导出失败，请重试');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto scrollbar-thin sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-5 text-[var(--site-accent)]" />
            分享与导出
          </DialogTitle>
          <DialogDescription>参赛队无需登录即可查看，还能只筛自己队的比赛。</DialogDescription>
        </DialogHeader>

        {meta.shareId ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={shareUrl} size={168} level="M" />
            </div>
            <div className="w-full">
              <Label className="mb-1 text-xs text-muted-foreground">只读分享链接</Label>
              <div className="flex gap-2">
                <Input readOnly value={shareUrl} className="stat-num h-8 text-xs" onFocus={(e) => e.target.select()} />
                <Button size="sm" variant="outline" onClick={() => copy(shareUrl, '分享链接')}><Copy className="size-4" /></Button>
              </div>
            </div>
            <label className="flex w-full items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">分享页隐藏评委姓名</span>
              <Switch
                checked={doc.shareSettings.hideJudges}
                onCheckedChange={(v) => patchDoc({ shareSettings: { hideJudges: v } })}
              />
            </label>
          </div>
        ) : cloudAvailable === false ? (
          <div className="rounded-lg border border-dashed border-[var(--cube-4)]/50 bg-[color-mix(in_srgb,var(--cube-4)_8%,transparent)] p-4 text-center text-sm">
            <CloudOff className="mx-auto mb-2 size-6 text-[var(--cube-4)]" />
            <div className="font-medium text-[var(--cube-4)]">离线演示版 · 云端分享暂不可用</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              当前为纯前端演示，云端保存与公开分享链接正在升级中。
              下方导出（CSV / 图片 / 打印 / JSON）在浏览器内完全可用，可先把赛程发给参赛队。
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            <Link2 className="mx-auto mb-2 size-6" />
            保存到云端后即可生成分享链接与二维码。
            <Button className="mt-3" size="sm" onClick={() => void createCloud()} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? '保存中…' : '保存到云端'}
            </Button>
          </div>
        )}

        {manageUrl && (
          <div>
            <Label className="mb-1 text-xs text-muted-foreground">管理链接（含密钥，仅自己保存，可换电脑编辑）</Label>
            <div className="flex gap-2">
              <Input readOnly value={manageUrl} className="stat-num h-8 text-xs" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="outline" onClick={() => copy(manageUrl, '管理链接')}><Copy className="size-4" /></Button>
            </div>
          </div>
        )}

        <Separator />

        <div>
          <Label className="mb-2 text-xs text-muted-foreground">导出</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={() => { downloadCSV(doc); toast.success('CSV 已导出（Excel 中文不乱码）'); }}>
              <Download className="size-4" /> Excel CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handlePNG()}>
              <ImageIcon className="size-4" /> 赛程图片
            </Button>
            <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); setTimeout(printView, 200); }}>
              <Printer className="size-4" /> 打印版
            </Button>
            <Button variant="outline" size="sm" onClick={() => { exportJSON(doc); toast.success('JSON 备份已导出'); }}>
              <FileJson className="size-4" /> JSON 备份
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}