// 赛程魔方 · 比赛详情抽屉（结果录入 / 评委调整 / 锁定 / 取消排程）
import { Pin, PinOff, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { formatSlot, type MatchResult, type TournamentDoc } from '@/engine/types';
import { judgeName, matchTitle, teamName, venueName } from '@/lib/ui';
import { useStore } from '@/store/tournament';
import { cn } from '@/lib/utils';

interface Props {
  doc: TournamentDoc;
  matchId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  readOnly?: boolean;
}

export function MatchDetailSheet({ doc, matchId, open, onOpenChange, readOnly }: Props) {
  const setResult = useStore((s) => s.setResult);
  const setJudges = useStore((s) => s.setJudges);
  const togglePin = useStore((s) => s.togglePin);
  const unplaceMatch = useStore((s) => s.unplaceMatch);
  const match = matchId ? doc.matches.find((m) => m.id === matchId) ?? null : null;
  if (!match) return null;

  const slot = match.assignment ? doc.slots.find((s) => s.id === match.assignment!.slotId) : null;
  const teams = [match.teamA, match.teamB].filter(Boolean) as string[];
  const selectedJudges = match.assignment?.judgeIds ?? [];

  const resultBtn = (value: MatchResult, label: string) => (
    <Button
      size="sm"
      variant={match.result === value ? 'default' : 'outline'}
      disabled={readOnly || !match.teamA || !match.teamB}
      onClick={() => setResult(match.id, match.result === value ? null : value)}
      className="flex-1"
    >
      {label}
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto scrollbar-thin sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="pr-6 text-base">{matchTitle(doc, match)}</SheetTitle>
          <SheetDescription>
            {match.label ?? `第${match.round}轮`}
            {match.bracketSide === 'W' && ' · 胜者组'}
            {match.bracketSide === 'L' && ' · 败者组'}
            {match.bracketSide === 'GF' && ' · 总决赛'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {/* 排程信息 */}
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            {match.assignment && slot ? (
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">时间</span><span className="stat-num">{slot.date} {formatSlot(slot)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">场地</span><span>{venueName(doc, match.assignment.venueId)}</span></div>
              </div>
            ) : (
              <div className="text-muted-foreground">尚未排程{match.bye ? '（轮空自动晋级）' : '，可拖入看板或一键排程'}</div>
            )}
          </div>

          {/* 结果录入 */}
          {!match.bye && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">录入结果{doc.format === 'swiss' && '（用于生成下一轮）'}</div>
              <div className="flex gap-2">
                {resultBtn('A', `${teamName(doc, match.teamA)} 胜`)}
                {resultBtn('B', `${teamName(doc, match.teamB)} 胜`)}
                {doc.format !== 'single_elim' && doc.format !== 'double_elim' && resultBtn('draw', '平局')}
              </div>
              {match.result && (
                <div className="mt-2 text-xs text-[var(--success)]">已记录，淘汰赛胜/败者已自动晋级。</div>
              )}
            </div>
          )}

          {!readOnly && <Separator />}

          {/* 评委 */}
          {!readOnly && match.assignment && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">执裁评委（每场 {doc.constraints.judgesPerMatch} 人）</div>
              <div className="space-y-1.5">
                {doc.judges.map((j) => {
                  const affiliated = j.affiliatedTeamIds.some((t) => teams.includes(t));
                  const checked = selectedJudges.includes(j.id);
                  return (
                    <label key={j.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm', affiliated && 'opacity-70')}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const next = v ? [...selectedJudges, j.id] : selectedJudges.filter((x) => x !== j.id);
                          setJudges(match.id, next);
                        }}
                      />
                      <span className="flex-1">{j.name}</span>
                      {affiliated && <Badge variant="outline" className="border-[var(--cube-4)]/50 text-[10px] text-[var(--cube-4)]">需回避</Badge>}
                    </label>
                  );
                })}
                {doc.judges.length === 0 && <div className="text-xs text-muted-foreground">尚未配置评委</div>}
              </div>
            </div>
          )}

          {/* 操作 */}
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => togglePin(match.id)}>
                {match.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                {match.pinned ? '取消锁定' : '锁定本场'}
              </Button>
              {match.assignment && (
                <Button size="sm" variant="outline" onClick={() => { unplaceMatch(match.id); }}>
                  <Trash2 className="size-4" />
                  取消排程
                </Button>
              )}
            </div>
          )}
          {!readOnly && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              锁定的场次在「一键排程」时会被保留，不被打乱。
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}