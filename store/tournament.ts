// 赛程魔方 · 全局状态（zustand）
// doc 不可变更新 + undo/redo 快照栈（上限 50）+ 防抖 1.5s 云端 PATCH + localStorage 镜像兜底。
// 求解/拖拽/结果录入都经 commit() 统一入口：重算冲突 → 镜像 → 调度持久化。

import { create } from 'zustand';
import { toast } from 'sonner';
import {
  detectAllConflicts,
  applyMove,
  setPinned,
  autoAssignJudges,
  collectConflictMatchIds,
} from '@/engine/conflicts';
import { solve, type SolveReport, type UnplacedInfo } from '@/engine/solver';
import {
  applyResult,
  generateInitialMatches,
  generateSwissRound,
  isRoundComplete,
  maxRound,
} from '@/engine/pairings';
import { expandSlots, type Assignment, type Conflict, type MatchResult, type TournamentDoc } from '@/engine/types';
import { api, ApiError, apiMessage } from '@/lib/api';
import { randomToken, sha256Hex, uuid } from '@/lib/crypto';
import { loadMirror, saveMirror, upsertRegistry, type RegistryEntry } from '@/lib/storage';

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'offline' | 'local';

export interface SessionMeta {
  id: string | null;
  shareId: string | null;
  editToken: string | null;
  version: number;
  mode: 'local' | 'cloud';
}

interface UiState {
  selectedMatchId: string | null;
  detailOpen: boolean;
  shareOpen: boolean;
  reportOpen: boolean;
  resourcesOpen: boolean;
  constraintsOpen: boolean;
  teamFilter: string | null;
}

interface StoreState {
  doc: TournamentDoc | null;
  meta: SessionMeta;
  saveState: SaveState;
  cloudAvailable: boolean | null;
  conflicts: Conflict[];
  conflictMatchIds: Set<string>;
  report: SolveReport | null;
  unplaced: UnplacedInfo[];
  solving: boolean;
  flyNonce: number;
  past: TournamentDoc[];
  future: TournamentDoc[];
  ui: UiState;

  checkCloud: () => Promise<void>;
  loadDoc: (doc: TournamentDoc, meta: SessionMeta) => void;
  commit: (next: TournamentDoc, opts?: { history?: boolean; persist?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  solveNow: () => void;
  moveMatch: (matchId: string, slotId: string, venueId: string) => void;
  unplaceMatch: (matchId: string) => void;
  setJudges: (matchId: string, judgeIds: string[]) => void;
  togglePin: (matchId: string) => void;
  setResult: (matchId: string, result: MatchResult) => void;
  generateNextSwissRound: () => void;
  rebuildPairings: () => void;
  patchDoc: (partial: Partial<TournamentDoc>, reexpand?: boolean) => void;
  setUi: (partial: Partial<UiState>) => void;
  selectMatch: (id: string | null) => void;
  saveNow: () => Promise<void>;
  createCloud: () => Promise<boolean>;
  reloadFromCloud: () => Promise<void>;
}

const EMPTY_META: SessionMeta = { id: null, shareId: null, editToken: null, version: 1, mode: 'local' };
const EMPTY_UI: UiState = {
  selectedMatchId: null,
  detailOpen: false,
  shareOpen: false,
  reportOpen: false,
  resourcesOpen: false,
  constraintsOpen: false,
  teamFilter: null,
};
const HISTORY_CAP = 50;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let solveSeed = 1;

function registryFrom(doc: TournamentDoc, meta: SessionMeta): RegistryEntry {
  return {
    id: meta.id ?? 'local',
    title: doc.title,
    shareId: meta.shareId,
    editToken: meta.editToken,
    format: doc.format,
    mode: meta.mode,
    updatedAt: doc.updatedAt,
  };
}

export const useStore = create<StoreState>()((set, get) => {
  // 防抖云端保存：仅 cloud 模式且有 token 时 PATCH
  function schedulePersist() {
    const { meta } = get();
    if (meta.mode !== 'cloud' || !meta.id || !meta.editToken) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void get().saveNow();
    }, 1500);
  }

  function recompute(doc: TournamentDoc) {
    const conflicts = detectAllConflicts(doc);
    return { conflicts, conflictMatchIds: collectConflictMatchIds(conflicts) };
  }

  return {
    doc: null,
    meta: EMPTY_META,
    saveState: 'idle',
    cloudAvailable: null,
    conflicts: [],
    conflictMatchIds: new Set(),
    report: null,
    unplaced: [],
    solving: false,
    flyNonce: 0,
    past: [],
    future: [],
    ui: EMPTY_UI,

    async checkCloud() {
      // 静态部署时 SPA 回退会对 /api/health 返回 HTML → invalid_response → 判定云端不可用。
      // 完整版后端在线时返回 {ok:true} → 云端可用。仅在尚未判定（null）时探测一次。
      if (get().cloudAvailable !== null) return;
      try {
        const res = await api.health();
        set({ cloudAvailable: !!res?.ok });
      } catch {
        set({ cloudAvailable: false });
      }
    },

    loadDoc(doc, meta) {
      if (persistTimer) clearTimeout(persistTimer);
      set({
        doc,
        meta,
        ...recompute(doc),
        report: null,
        unplaced: [],
        solving: false,
        past: [],
        future: [],
        ui: { ...EMPTY_UI },
        saveState: meta.mode === 'cloud' ? 'saved' : 'local',
      });
      if (meta.id) {
        saveMirror(meta.id, doc);
        upsertRegistry(registryFrom(doc, meta));
      }
    },

    commit(next, opts = {}) {
      const { history = true, persist = true } = opts;
      const prev = get().doc;
      const stamped: TournamentDoc = { ...next, updatedAt: new Date().toISOString() };
      const past = history && prev ? [...get().past, prev].slice(-HISTORY_CAP) : get().past;
      set({
        doc: stamped,
        past,
        future: history ? [] : get().future,
        ...recompute(stamped),
      });
      const { meta } = get();
      if (meta.id) saveMirror(meta.id, stamped);
      if (meta.id) upsertRegistry(registryFrom(stamped, meta));
      if (persist) {
        if (meta.mode === 'cloud') {
          set({ saveState: 'saving' });
          schedulePersist();
        } else {
          set({ saveState: 'local' });
        }
      }
    },

    undo() {
      const { past, doc, future } = get();
      if (!past.length || !doc) return;
      const prev = past[past.length - 1];
      set({
        doc: prev,
        past: past.slice(0, -1),
        future: [doc, ...future].slice(0, HISTORY_CAP),
        ...recompute(prev),
        saveState: get().meta.mode === 'cloud' ? 'saving' : 'local',
      });
      const { meta } = get();
      if (meta.id) saveMirror(meta.id, prev);
      if (meta.mode === 'cloud') schedulePersist();
    },

    redo() {
      const { future, doc, past } = get();
      if (!future.length || !doc) return;
      const next = future[0];
      set({
        doc: next,
        future: future.slice(1),
        past: [...past, doc].slice(-HISTORY_CAP),
        ...recompute(next),
        saveState: get().meta.mode === 'cloud' ? 'saving' : 'local',
      });
      const { meta } = get();
      if (meta.id) saveMirror(meta.id, next);
      if (meta.mode === 'cloud') schedulePersist();
    },

    solveNow() {
      const doc = get().doc;
      if (!doc || get().solving) return;
      set({ solving: true });
      // 先渲染 spinner，再同步跑引擎（≤500ms 可接受）
      setTimeout(() => {
        const current = get().doc;
        if (!current) {
          set({ solving: false });
          return;
        }
        const seed = ++solveSeed * 2654435761;
        const result = solve(current, { seed, timeBudgetMs: 600, nodeBudget: 8000 });
        const next: TournamentDoc = { ...current, matches: result.matches };
        get().commit(next);
        set({
          solving: false,
          report: result.report,
          unplaced: result.unplaced,
          ui: { ...get().ui, reportOpen: true },
          flyNonce: get().flyNonce + 1,
        });
        if (result.report.unplaced > 0) {
          toast.warning(`已排 ${result.report.placed} 场，${result.report.unplaced} 场待手动调整`, {
            description: '查看排程报告了解缺什么资源',
          });
        } else {
          toast.success(`一键排程完成：${result.report.placed} 场 · 0 冲突`, {
            description: `耗时 ${(result.report.durationMs / 1000).toFixed(2)} 秒`,
          });
        }
      }, 30);
    },

    moveMatch(matchId, slotId, venueId) {
      const doc = get().doc;
      if (!doc) return;
      const judgeIds = autoAssignJudges(doc, matchId, slotId, venueId);
      const target: Assignment = { slotId, venueId, judgeIds };
      get().commit(applyMove(doc, matchId, target));
    },

    unplaceMatch(matchId) {
      const doc = get().doc;
      if (!doc) return;
      get().commit(applyMove(doc, matchId, null));
    },

    setJudges(matchId, judgeIds) {
      const doc = get().doc;
      if (!doc) return;
      const next: TournamentDoc = {
        ...doc,
        matches: doc.matches.map((m) =>
          m.id === matchId && m.assignment ? { ...m, assignment: { ...m.assignment, judgeIds } } : m,
        ),
      };
      get().commit(next);
    },

    togglePin(matchId) {
      const doc = get().doc;
      if (!doc) return;
      const m = doc.matches.find((x) => x.id === matchId);
      get().commit(setPinned(doc, matchId, !m?.pinned));
    },

    setResult(matchId, result) {
      const doc = get().doc;
      if (!doc) return;
      const matches = applyResult(doc.matches, matchId, result);
      get().commit({ ...doc, matches });
    },

    generateNextSwissRound() {
      const doc = get().doc;
      if (!doc || doc.format !== 'swiss') return;
      const current = maxRound(doc.matches);
      const total = doc.swissRounds ?? 3;
      if (current >= total) {
        toast.info('已是最后一轮，全部轮次已生成');
        return;
      }
      if (!isRoundComplete(doc.matches, current)) {
        toast.warning('请先录完本轮所有比赛结果，再生成下一轮');
        return;
      }
      const nextRound = generateSwissRound(doc, current + 1);
      get().commit({ ...doc, matches: [...doc.matches, ...nextRound] });
      toast.success(`已生成第 ${current + 1} 轮对阵`, { description: '点击「一键排程」为新轮次分配时段' });
    },

    rebuildPairings() {
      const doc = get().doc;
      if (!doc) return;
      try {
        const matches = generateInitialMatches(doc);
        get().commit({ ...doc, matches });
        toast.success('已按当前队伍与赛制重新生成对阵');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '生成对阵失败');
      }
    },

    patchDoc(partial, reexpand = false) {
      const doc = get().doc;
      if (!doc) return;
      let next: TournamentDoc = { ...doc, ...partial };
      if (reexpand && partial.timeBlocks) next = { ...next, slots: expandSlots(partial.timeBlocks) };
      get().commit(next);
    },

    setUi(partial) {
      set({ ui: { ...get().ui, ...partial } });
    },

    selectMatch(id) {
      set({ ui: { ...get().ui, selectedMatchId: id, detailOpen: id !== null } });
    },

    async createCloud() {
      const doc = get().doc;
      if (!doc) return false;
      set({ saveState: 'saving' });
      try {
        const id = uuid();
        const editToken = randomToken();
        const hash = await sha256Hex(editToken);
        const res = await api.create(id, hash, doc.title, doc);
        const meta: SessionMeta = { id: res.id, shareId: res.shareId, editToken, version: res.version, mode: 'cloud' };
        set({ meta, saveState: 'saved' });
        saveMirror(res.id, doc);
        upsertRegistry(registryFrom(doc, meta));
        toast.success('已保存到云端', { description: '换台电脑打开管理链接即可继续编辑' });
        return true;
      } catch (e) {
        set({ saveState: e instanceof ApiError && e.code === 'network_error' ? 'offline' : 'local' });
        toast.error(apiMessage(e));
        return false;
      }
    },

    async saveNow() {
      const { doc, meta } = get();
      if (!doc) return;
      if (meta.mode !== 'cloud' || !meta.id || !meta.editToken) {
        await get().createCloud();
        return;
      }
      set({ saveState: 'saving' });
      try {
        const res = await api.save(meta.id, meta.editToken, doc, meta.version, doc.title);
        set({ meta: { ...meta, version: res.version }, saveState: 'saved' });
        upsertRegistry(registryFrom(doc, { ...meta, version: res.version }));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'write_conflict') {
          set({ saveState: 'conflict' });
          toast.warning('云端有更新', { description: '点击顶栏「读取最新」核对后再保存', duration: 8000 });
        } else if (e instanceof ApiError && (e.code === 'network_error' || e.status >= 500 || e.status === 0)) {
          set({ saveState: 'offline' });
        } else {
          set({ saveState: 'local' });
          toast.error(apiMessage(e));
        }
      }
    },

    async reloadFromCloud() {
      const { meta } = get();
      if (!meta.id || !meta.editToken) return;
      try {
        const res = await api.read(meta.id, meta.editToken);
        get().loadDoc(res.data, { ...meta, shareId: res.shareId, version: res.version, mode: 'cloud' });
        toast.success('已读取云端最新内容');
      } catch (e) {
        toast.error(apiMessage(e));
      }
    },
  };
});

// 便捷选择器
export const selectDoc = (s: StoreState) => s.doc;
export { loadMirror };