// 赛程魔方 · 资源面板（队伍 / 场地 / 评委，含回避与不可用日期）
import { useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { generateInitialMatches } from '@/engine/pairings';
import { LIMITS, newId, type Judge, type Team, type TournamentDoc, type Venue } from '@/engine/types';
import { useStore } from '@/store/tournament';
import { cn } from '@/lib/utils';

interface Props {
  doc: TournamentDoc;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function parseDates(text: string): string[] {
  return text.split(/[,，\s]+/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
}

export function ResourcesPanel({ doc, open, onOpenChange }: Props) {
  const patchDoc = useStore((s) => s.patchDoc);
  const [teamText, setTeamText] = useState(doc.teams.map((t) => t.name).join('\n'));

  function applyTeams() {
    const names = [...new Set(teamText.split('\n').map((s) => s.trim()).filter(Boolean))].slice(0, LIMITS.teams);
    if (names.length < 2) {
      toast.error('至少需要 2 支队伍');
      return;
    }
    const teams: Team[] = names.map((name, i) => ({
      id: doc.teams[i]?.id ?? `team-${i}`,
      name,
      unavailableDates: doc.teams[i]?.unavailableDates ?? [],
    }));
    const nextDoc = { ...doc, teams };
    try {
      const matches = generateInitialMatches(nextDoc);
      patchDoc({ teams, matches });
      toast.success(`已更新 ${teams.length} 支队伍并重新生成对阵`, { description: '原排程已清空，请重新一键排程' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成对阵失败');
    }
  }

  function setVenue(id: string, partial: Partial<Venue>) {
    patchDoc({ venues: doc.venues.map((v) => (v.id === id ? { ...v, ...partial } : v)) });
  }
  function setJudge(id: string, partial: Partial<Judge>) {
    patchDoc({ judges: doc.judges.map((j) => (j.id === id ? { ...j, ...partial } : j)) });
  }
  function setTeamDates(id: string, text: string) {
    patchDoc({ teams: doc.teams.map((t) => (t.id === id ? { ...t, unavailableDates: parseDates(text) } : t)) });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto scrollbar-thin sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>资源配置</SheetTitle>
          <SheetDescription>队伍、场地与评委。修改队伍会重新生成对阵。</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <Tabs defaultValue="teams">
            <TabsList className="w-full">
              <TabsTrigger value="teams" className="flex-1">队伍 {doc.teams.length}</TabsTrigger>
              <TabsTrigger value="venues" className="flex-1">场地 {doc.venues.length}</TabsTrigger>
              <TabsTrigger value="judges" className="flex-1">评委 {doc.judges.length}</TabsTrigger>
            </TabsList>

            <TabsContent value="teams" className="space-y-3">
              <div>
                <Label className="mb-1 text-xs text-muted-foreground">批量名单（一行一个，自动去重）</Label>
                <Textarea value={teamText} onChange={(e) => setTeamText(e.target.value)} rows={6} className="text-sm" />
                <Button size="sm" className="mt-2" onClick={applyTeams}>
                  <RefreshCw className="size-4" /> 应用队伍并生成对阵
                </Button>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">各队不可用日期（YYYY-MM-DD，逗号分隔）</Label>
                {doc.teams.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-sm">{t.name}</span>
                    <Input
                      defaultValue={t.unavailableDates.join(', ')}
                      placeholder="如 2026-11-14"
                      className="h-8 text-xs"
                      onBlur={(e) => setTeamDates(t.id, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="venues" className="space-y-2">
              {doc.venues.map((v) => (
                <div key={v.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <Input value={v.name} onChange={(e) => setVenue(v.id, { name: e.target.value })} className="h-8 flex-1 text-sm" />
                  <Label className="text-xs text-muted-foreground">并行</Label>
                  <Input
                    type="number" min={1} max={16} value={v.capacity}
                    onChange={(e) => setVenue(v.id, { capacity: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })}
                    className="stat-num h-8 w-16 text-sm"
                  />
                  <Button size="icon-xs" variant="ghost" onClick={() => patchDoc({ venues: doc.venues.filter((x) => x.id !== v.id) })}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" disabled={doc.venues.length >= LIMITS.venues}
                onClick={() => patchDoc({ venues: [...doc.venues, { id: newId('venue'), name: `${doc.venues.length + 1} 号场地`, capacity: 1 }] })}>
                <Plus className="size-4" /> 添加场地
              </Button>
            </TabsContent>

            <TabsContent value="judges" className="space-y-3">
              {doc.judges.map((j) => (
                <div key={j.id} className="space-y-2 rounded-md border border-border p-2">
                  <div className="flex items-center gap-2">
                    <Input value={j.name} onChange={(e) => setJudge(j.id, { name: e.target.value })} className="h-8 flex-1 text-sm" />
                    <Button size="icon-xs" variant="ghost" onClick={() => patchDoc({ judges: doc.judges.filter((x) => x.id !== j.id) })}>
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-muted-foreground">需回避的队伍（点击切换）</div>
                    <div className="flex flex-wrap gap-1">
                      {doc.teams.map((t) => {
                        const on = j.affiliatedTeamIds.includes(t.id);
                        return (
                          <button key={t.id}
                            onClick={() => setJudge(j.id, { affiliatedTeamIds: on ? j.affiliatedTeamIds.filter((x) => x !== t.id) : [...j.affiliatedTeamIds, t.id] })}
                            className={cn('rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                              on ? 'border-[var(--cube-4)] bg-[color-mix(in_srgb,var(--cube-4)_20%,transparent)] text-[var(--cube-4)]' : 'border-border text-muted-foreground hover:border-[var(--cube-4)]/50')}>
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <Input
                    defaultValue={j.unavailableDates.join(', ')}
                    placeholder="不可用日期，如 2026-11-14"
                    className="h-8 text-xs"
                    onBlur={(e) => setJudge(j.id, { unavailableDates: parseDates(e.target.value) })}
                  />
                </div>
              ))}
              <Button size="sm" variant="outline" disabled={doc.judges.length >= LIMITS.judges}
                onClick={() => patchDoc({ judges: [...doc.judges, { id: newId('judge'), name: `评委${doc.judges.length + 1}`, affiliatedTeamIds: [], unavailableDates: [] }] })}>
                <Plus className="size-4" /> 添加评委
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}