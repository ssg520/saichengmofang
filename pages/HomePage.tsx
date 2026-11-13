// 赛程魔方 · 首页 = 工作面
// 首次打开即展示排好的满盘示例（独立副本），评委 3 秒上手拖。
// 「我的赛事」抽屉：本地注册表 + 新建 + 粘贴链接打开 + 载入示例。

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderOpen, Link2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CubeLogo } from '@/components/CubeLogo';
import { EditorSurface } from '@/components/EditorSurface';
import { buildSampleTournament } from '@/engine/fixtures';
import { solve } from '@/engine/solver';
import { FORMAT_LABELS } from '@/engine/types';
import { listRegistry, removeRegistry, type RegistryEntry } from '@/lib/storage';
import { useStore } from '@/store/tournament';

function loadSample() {
  const sample = buildSampleTournament();
  const result = solve(sample, { seed: 20261111, timeBudgetMs: 800 });
  useStore.getState().loadDoc({ ...sample, matches: result.matches }, { id: null, shareId: null, editToken: null, version: 1, mode: 'local' });
}

export function HomePage() {
  const navigate = useNavigate();
  const hasDoc = useStore((s) => !!s.doc);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [linkText, setLinkText] = useState('');

  useEffect(() => {
    if (!useStore.getState().doc) loadSample();
  }, []);

  useEffect(() => {
    if (libraryOpen) setRegistry(listRegistry());
  }, [libraryOpen]);

  function openLink() {
    const t = linkText.trim();
    if (!t) return;
    try {
      const u = new URL(t);
      const s = u.pathname.match(/\/s\/([a-z2-7]{6,16})/);
      if (s) { navigate(`/s/${s[1]}`); return; }
      const e = u.pathname.match(/\/t\/([0-9a-f-]{36})/);
      if (e) { navigate(`/t/${e[1]}${u.hash}`); return; }
    } catch {
      /* 非完整 URL，按裸 shareId 处理 */
    }
    if (/^[a-z2-7]{6,16}$/.test(t)) { navigate(`/s/${t}`); return; }
    toast.error('无法识别的链接，请粘贴分享链接或管理链接');
  }

  return (
    <div className="h-full">
      {hasDoc ? (
        <EditorSurface onOpenLibrary={() => setLibraryOpen(true)} />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <CubeLogo size={40} className="cube-spin" />
        </div>
      )}

      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent side="left" className="w-full overflow-y-auto scrollbar-thin sm:max-w-sm">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><CubeLogo size={26} /> 赛程魔方</SheetTitle>
            <SheetDescription>办比赛的人，不该把通宵花在排赛程上。</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <Button className="w-full" onClick={() => navigate('/new')}>
              <Plus className="size-4" /> 新建比赛
            </Button>
            <Button variant="outline" className="w-full" onClick={() => { loadSample(); setLibraryOpen(false); toast.success('已载入示例副本，随意拖改不影响他人'); }}>
              <Sparkles className="size-4" /> 载入示例比赛
            </Button>

            <div>
              <div className="mb-1 text-xs text-muted-foreground">粘贴链接打开</div>
              <div className="flex gap-2">
                <Input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="分享链接 / 管理链接" className="h-9 text-xs" onKeyDown={(e) => { if (e.key === 'Enter') openLink(); }} />
                <Button size="sm" variant="outline" onClick={openLink}><Link2 className="size-4" /></Button>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FolderOpen className="size-4" /> 我的赛事（存于本浏览器）
              </div>
              {registry.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  还没有赛事。新建或保存示例后会出现在这里。
                </div>
              ) : (
                <div className="space-y-1.5">
                  {registry.map((e) => (
                    <div key={e.id} className="group flex items-center gap-2 rounded-md border border-border p-2 hover:border-[var(--site-accent)]/50">
                      <button className="flex min-w-0 flex-1 flex-col items-start text-left" onClick={() => navigate(e.mode === 'cloud' ? `/t/${e.id}` : '/')}>
                        <span className="truncate text-sm font-medium">{e.title}</span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Badge variant="outline" className="h-4 px-1 text-[9px]">{FORMAT_LABELS[e.format]}</Badge>
                          {e.mode === 'cloud' ? '云端' : '本地'}
                        </span>
                      </button>
                      <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => { removeRegistry(e.id); setRegistry(listRegistry()); }}>
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}