// 赛程魔方 · 时间与约束面板（时段块 / 休息 / 轮次间隔 / 每场评委数）
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { expandSlots, LIMITS, type TimeBlock, type TournamentDoc } from '@/engine/types';
import { useStore } from '@/store/tournament';

interface Props {
  doc: TournamentDoc;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function ConstraintsPanel({ doc, open, onOpenChange }: Props) {
  const patchDoc = useStore((s) => s.patchDoc);
  const [blocks, setBlocks] = useState<TimeBlock[]>(doc.timeBlocks);

  function setBlock(i: number, partial: Partial<TimeBlock>) {
    setBlocks((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...partial } : b)));
  }

  function applyTime() {
    const valid = blocks.filter((b) => b.date && b.endMin > b.startMin && b.matchMin > 0);
    const slots = expandSlots(valid);
    if (slots.length === 0) {
      toast.error('时段配置无效，请检查起止时间与单场时长');
      return;
    }
    if (slots.length > LIMITS.slots) {
      toast.error(`时段数超过上限 ${LIMITS.slots}`);
      return;
    }
    const ids = new Set(slots.map((s) => s.id));
    const matches = doc.matches.map((m) =>
      m.assignment && !ids.has(m.assignment.slotId) ? { ...m, assignment: null } : m,
    );
    patchDoc({ timeBlocks: valid, slots, matches });
    toast.success(`已生成 ${slots.length} 个时段`, { description: '失效的排程已退回未排程托盘' });
  }

  const c = doc.constraints;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto scrollbar-thin sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>时间与约束</SheetTitle>
          <SheetDescription>比赛日、时段与硬性约束。修改时段后需重新一键排程。</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <div>
            <Label className="mb-1 text-xs text-muted-foreground">赛事名称</Label>
            <Input value={doc.title} onChange={(e) => patchDoc({ title: e.target.value.slice(0, 200) })} className="h-9 text-sm" />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">时段块</Label>
            {blocks.map((b, i) => (
              <div key={i} className="space-y-2 rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input type="date" value={b.date} onChange={(e) => setBlock(i, { date: e.target.value })} className="stat-num h-8 flex-1 text-xs" />
                  <Button size="icon-xs" variant="ghost" onClick={() => setBlocks((prev) => prev.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Input type="time" value={toTime(b.startMin)} onChange={(e) => setBlock(i, { startMin: toMin(e.target.value) })} className="stat-num h-8 flex-1" />
                  <span className="text-muted-foreground">至</span>
                  <Input type="time" value={toTime(b.endMin)} onChange={(e) => setBlock(i, { endMin: toMin(e.target.value) })} className="stat-num h-8 flex-1" />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Label className="text-muted-foreground">单场</Label>
                  <Input type="number" min={5} value={b.matchMin} onChange={(e) => setBlock(i, { matchMin: Number(e.target.value) || 0 })} className="stat-num h-8 w-16" />
                  <Label className="text-muted-foreground">分钟 · 场间</Label>
                  <Input type="number" min={0} value={b.breakMin} onChange={(e) => setBlock(i, { breakMin: Number(e.target.value) || 0 })} className="stat-num h-8 w-16" />
                  <Label className="text-muted-foreground">分钟</Label>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setBlocks((prev) => [...prev, { date: prev[prev.length - 1]?.date ?? '2026-11-14', startMin: 9 * 60, endMin: 18 * 60, matchMin: 50, breakMin: 10 }])}>
                <Plus className="size-4" /> 添加比赛日
              </Button>
              <Button size="sm" onClick={applyTime}>应用时段</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 text-xs text-muted-foreground">队伍最小休息（分钟）</Label>
              <Input type="number" min={0} value={c.minRestMin} onChange={(e) => patchDoc({ constraints: { ...c, minRestMin: Math.max(0, Number(e.target.value) || 0) } })} className="stat-num h-9" />
            </div>
            <div>
              <Label className="mb-1 text-xs text-muted-foreground">轮次间隔（分钟）</Label>
              <Input type="number" min={0} value={c.roundGapMin} onChange={(e) => patchDoc({ constraints: { ...c, roundGapMin: Math.max(0, Number(e.target.value) || 0) } })} className="stat-num h-9" />
            </div>
            <div>
              <Label className="mb-1 text-xs text-muted-foreground">每场评委数</Label>
              <NativeSelect value={String(c.judgesPerMatch)} onChange={(e) => patchDoc({ constraints: { ...c, judgesPerMatch: Number(e.target.value) } })} className="h-9">
                <NativeSelectOption value="1">1 人</NativeSelectOption>
                <NativeSelectOption value="2">2 人</NativeSelectOption>
              </NativeSelect>
            </div>
            {doc.format === 'swiss' && (
              <div>
                <Label className="mb-1 text-xs text-muted-foreground">瑞士制总轮数</Label>
                <Input type="number" min={3} max={6} value={doc.swissRounds ?? 3} onChange={(e) => patchDoc({ swissRounds: Math.max(3, Math.min(6, Number(e.target.value) || 3)) })} className="stat-num h-9" />
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}