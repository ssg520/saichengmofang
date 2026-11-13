// 赛程魔方 · 创建向导（4 步：名称赛制 → 队伍 → 场地评委 → 时段约束）
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, GitBranch, Layers, Loader2, Plus, Repeat, Trash2, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { CubeLogo } from '@/components/CubeLogo';
import { makeDoc } from '@/engine/fixtures';
import { solve } from '@/engine/solver';
import { FORMAT_LABELS, type Format } from '@/engine/types';
import { useStore } from '@/store/tournament';
import { uuid } from '@/lib/crypto';
import { cn } from '@/lib/utils';

const FORMAT_INFO: { value: Format; desc: string; icon: typeof Trophy }[] = [
  { value: 'round_robin', desc: '每两队相遇一次，适合小组赛/联赛', icon: Repeat },
  { value: 'single_elim', desc: '输一场即淘汰，适合杯赛', icon: Trophy },
  { value: 'swiss', desc: '按积分逐轮配对，适合中等规模', icon: Layers },
  { value: 'double_elim', desc: '输两场才淘汰（限 8/16/32 队）', icon: GitBranch },
];

const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const isPow2 = (n: number) => n >= 2 && (n & (n - 1)) === 0;

export function WizardPage() {
  const navigate = useNavigate();
  const loadDoc = useStore((s) => s.loadDoc);
  const createCloud = useStore((s) => s.createCloud);
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState('高校辩论邀请赛');
  const [format, setFormat] = useState<Format>('round_robin');
  const [teamText, setTeamText] = useState('文学院\n法学院\n计算机学院\n经济学院\n外国语学院\n数学学院\n物理学院\n医学院');
  const [venues, setVenues] = useState([{ name: '第一报告厅', capacity: 1 }, { name: '第二报告厅', capacity: 1 }]);
  const [judges, setJudges] = useState<{ name: string; aff: number[] }[]>([{ name: '张教授', aff: [0] }, { name: '李教授', aff: [] }, { name: '王教授', aff: [] }]);
  const [blocks, setBlocks] = useState([{ date: '2026-11-14', startMin: 540, endMin: 1080, matchMin: 50, breakMin: 10 }]);
  const [minRest, setMinRest] = useState(20);
  const [roundGap, setRoundGap] = useState(20);
  const [jpm, setJpm] = useState(1);
  const [swissRounds, setSwissRounds] = useState(3);

  const teamNames = useMemo(() => [...new Set(teamText.split('\n').map((s) => s.trim()).filter(Boolean))], [teamText]);

  function validateStep(): boolean {
    if (step === 0 && !title.trim()) { toast.error('请填写赛事名称'); return false; }
    if (step === 1) {
      if (teamNames.length < 2) { toast.error('至少需要 2 支队伍'); return false; }
      if (format === 'double_elim' && !isPow2(teamNames.length)) { toast.error('双败淘汰仅支持 8/16/32 等 2 的幂队伍数'); return false; }
    }
    if (step === 2) {
      if (venues.length === 0) { toast.error('至少需要 1 个场地'); return false; }
      if (judges.length < jpm) { toast.error(`每场需 ${jpm} 名评委，请至少添加 ${jpm} 名`); return false; }
    }
    if (step === 3 && blocks.every((b) => !b.date || b.endMin <= b.startMin)) { toast.error('请配置有效的时段'); return false; }
    return true;
  }

  async function finish() {
    if (!validateStep()) return;
    setCreating(true);
    try {
      const doc = makeDoc({
        title: title.trim(),
        format,
        teams: teamNames.map((name, i) => ({ id: `team-${i}`, name, unavailableDates: [] })),
        venues: venues.map((v, i) => ({ id: `venue-${i}`, name: v.name || `${i + 1} 号场地`, capacity: v.capacity })),
        judges: judges.map((j, i) => ({ id: `judge-${i}`, name: j.name || `评委${i + 1}`, affiliatedTeamIds: j.aff.map((idx) => `team-${idx}`), unavailableDates: [] })),
        timeBlocks: blocks,
        constraints: { minRestMin: minRest, roundGapMin: roundGap, judgesPerMatch: jpm },
        swissRounds: format === 'swiss' ? swissRounds : undefined,
      });
      const solved = solve(doc, { seed: (Date.now() % 100000) + 1, timeBudgetMs: 800, nodeBudget: 8000 });
      // 离线演示版（云端不可用）：用本地 id 持久化到浏览器，刷新不丢，可随时导出备份。
      if (useStore.getState().cloudAvailable === false) {
        loadDoc({ ...doc, matches: solved.matches }, { id: `local-${uuid()}`, shareId: null, editToken: null, version: 1, mode: 'local' });
        toast.success('比赛已创建（本地保存）', { description: '离线演示版：数据存于本浏览器，可用「分享」里的导出备份' });
        navigate('/');
        return;
      }
      loadDoc({ ...doc, matches: solved.matches }, { id: null, shareId: null, editToken: null, version: 1, mode: 'local' });
      const ok = await createCloud();
      const m = useStore.getState().meta;
      if (ok && m.id) navigate(`/t/${m.id}#k=${m.editToken}`);
      else { toast.info('已创建本地副本，可稍后保存到云端'); navigate('/'); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }

  const steps = ['名称与赛制', '队伍名单', '场地与评委', '时间与约束'];

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <CubeLogo size={36} />
        <div>
          <h1 className="text-lg font-bold tracking-tight">新建比赛</h1>
          <p className="text-xs text-muted-foreground">四步配置，一键自动排程</p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => navigate('/')}>取消</Button>
      </div>

      {/* 步骤指示 */}
      <div className="mb-6 flex items-center gap-2">
        {steps.map((label, i) => (
          <div key={i} className="flex flex-1 items-center gap-2">
            <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
              i < step ? 'bg-[var(--success)] text-black' : i === step ? 'bg-[var(--site-accent)] text-[var(--site-on-accent)]' : 'bg-secondary text-muted-foreground')}>
              {i < step ? <Check className="size-4" /> : i + 1}
            </div>
            <span className={cn('hidden text-xs sm:inline', i === step ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
            {i < steps.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>

      <div className="fade-up flex-1 rounded-xl border border-border bg-card/60 p-5">
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <Label className="mb-1.5 text-sm">赛事名称</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：新生杯辩论赛" className="h-11 text-base" />
            </div>
            <div>
              <Label className="mb-2 text-sm">赛制</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {FORMAT_INFO.map((f) => {
                  const Icon = f.icon;
                  const active = format === f.value;
                  return (
                    <button key={f.value} onClick={() => setFormat(f.value)}
                      className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                        active ? 'border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_12%,transparent)]' : 'border-border hover:border-[var(--site-accent)]/40')}>
                      <Icon className={cn('mt-0.5 size-5 shrink-0', active ? 'text-[var(--site-accent)]' : 'text-muted-foreground')} />
                      <div>
                        <div className="text-sm font-semibold">{FORMAT_LABELS[f.value]}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{f.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <Label className="text-sm">队伍名单（一行一个，自动去重）</Label>
            <Textarea value={teamText} onChange={(e) => setTeamText(e.target.value)} rows={10} className="text-sm" placeholder="文学院&#10;法学院&#10;计算机学院" />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              已识别 <span className="stat-num font-semibold text-[var(--site-accent)]">{teamNames.length}</span> 支队伍
              {format === 'double_elim' && !isPow2(teamNames.length) && <span className="text-[var(--cube-4)]">· 双败需 2 的幂（8/16/32）</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {teamNames.map((n, i) => <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{n}</span>)}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-sm">场地</Label>
                <Button size="xs" variant="outline" onClick={() => setVenues((v) => [...v, { name: `${v.length + 1} 号场地`, capacity: 1 }])}><Plus className="size-3" /> 添加</Button>
              </div>
              <div className="space-y-2">
                {venues.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={v.name} onChange={(e) => setVenues((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} className="h-9 flex-1 text-sm" />
                    <Label className="text-xs text-muted-foreground">并行</Label>
                    <Input type="number" min={1} max={16} value={v.capacity} onChange={(e) => setVenues((prev) => prev.map((x, idx) => idx === i ? { ...x, capacity: Math.max(1, Number(e.target.value) || 1) } : x))} className="stat-num h-9 w-16" />
                    <Button size="icon-xs" variant="ghost" onClick={() => setVenues((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4 text-muted-foreground" /></Button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-sm">评委</Label>
                <Button size="xs" variant="outline" onClick={() => setJudges((j) => [...j, { name: `评委${j.length + 1}`, aff: [] }])}><Plus className="size-3" /> 添加</Button>
              </div>
              <div className="space-y-2">
                {judges.map((j, i) => (
                  <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
                    <div className="flex items-center gap-2">
                      <Input value={j.name} onChange={(e) => setJudges((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} className="h-8 flex-1 text-sm" />
                      <Button size="icon-xs" variant="ghost" onClick={() => setJudges((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4 text-muted-foreground" /></Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">回避：</span>
                      {teamNames.map((n, ti) => {
                        const on = j.aff.includes(ti);
                        return <button key={ti} onClick={() => setJudges((prev) => prev.map((x, idx) => idx === i ? { ...x, aff: on ? x.aff.filter((a) => a !== ti) : [...x.aff, ti] } : x))}
                          className={cn('rounded-full border px-1.5 py-px text-[10px]', on ? 'border-[var(--cube-4)] text-[var(--cube-4)]' : 'border-border text-muted-foreground')}>{n}</button>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="mb-1 flex items-center justify-between">
                <Label className="text-sm">比赛日与时段</Label>
                <Button size="xs" variant="outline" onClick={() => setBlocks((b) => [...b, { date: b[b.length - 1]?.date ?? '2026-11-14', startMin: 540, endMin: 1080, matchMin: 50, breakMin: 10 }])}><Plus className="size-3" /> 添加日</Button>
              </div>
              {blocks.map((b, i) => (
                <div key={i} className="space-y-2 rounded-md border border-border p-2">
                  <div className="flex items-center gap-2">
                    <Input type="date" value={b.date} onChange={(e) => setBlocks((prev) => prev.map((x, idx) => idx === i ? { ...x, date: e.target.value } : x))} className="stat-num h-8 flex-1 text-xs" />
                    <Button size="icon-xs" variant="ghost" onClick={() => setBlocks((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4 text-muted-foreground" /></Button>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Input type="time" value={toTime(b.startMin)} onChange={(e) => setBlocks((prev) => prev.map((x, idx) => idx === i ? { ...x, startMin: toMin(e.target.value) } : x))} className="stat-num h-8 flex-1" />
                    <span className="text-muted-foreground">至</span>
                    <Input type="time" value={toTime(b.endMin)} onChange={(e) => setBlocks((prev) => prev.map((x, idx) => idx === i ? { ...x, endMin: toMin(e.target.value) } : x))} className="stat-num h-8 flex-1" />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Label className="text-muted-foreground">单场</Label>
                    <Input type="number" min={5} value={b.matchMin} onChange={(e) => setBlocks((prev) => prev.map((x, idx) => idx === i ? { ...x, matchMin: Number(e.target.value) || 0 } : x))} className="stat-num h-8 w-16" />
                    <Label className="text-muted-foreground">分 · 场间</Label>
                    <Input type="number" min={0} value={b.breakMin} onChange={(e) => setBlocks((prev) => prev.map((x, idx) => idx === i ? { ...x, breakMin: Number(e.target.value) || 0 } : x))} className="stat-num h-8 w-16" />
                    <Label className="text-muted-foreground">分</Label>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="mb-1 text-xs text-muted-foreground">队伍最小休息（分）</Label><Input type="number" min={0} value={minRest} onChange={(e) => setMinRest(Number(e.target.value) || 0)} className="stat-num h-9" /></div>
              <div><Label className="mb-1 text-xs text-muted-foreground">轮次间隔（分）</Label><Input type="number" min={0} value={roundGap} onChange={(e) => setRoundGap(Number(e.target.value) || 0)} className="stat-num h-9" /></div>
              <div><Label className="mb-1 text-xs text-muted-foreground">每场评委数</Label>
                <NativeSelect value={String(jpm)} onChange={(e) => setJpm(Number(e.target.value))} className="h-9"><NativeSelectOption value="1">1 人</NativeSelectOption><NativeSelectOption value="2">2 人</NativeSelectOption></NativeSelect>
              </div>
              {format === 'swiss' && <div><Label className="mb-1 text-xs text-muted-foreground">瑞士制轮数</Label><Input type="number" min={3} max={6} value={swissRounds} onChange={(e) => setSwissRounds(Math.max(3, Math.min(6, Number(e.target.value) || 3)))} className="stat-num h-9" /></div>}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || creating}>
          <ArrowLeft className="size-4" /> 上一步
        </Button>
        {step < 3 ? (
          <Button onClick={() => { if (validateStep()) setStep((s) => s + 1); }}>
            下一步 <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={() => void finish()} disabled={creating} className="bg-[var(--site-accent)] text-[var(--site-on-accent)]">
            {creating ? <Loader2 className="size-4 cube-spin" /> : <Check className="size-4" />}
            {creating ? '创建并排程中…' : '创建并自动排程'}
          </Button>
        )}
      </div>
    </div>
  );
}