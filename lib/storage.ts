// 赛程魔方 · 本地存储（"我的赛事"注册表 + 文档镜像兜底）
// 每个浏览器只看到自己的赛事列表；示例载入的是独立副本。
// 离线/后端不可用时，文档镜像保证刷新可恢复，不冒充"已保存到云端"。

import type { Format, TournamentDoc } from '@/engine/types';

export interface RegistryEntry {
  id: string;
  title: string;
  shareId: string | null;
  editToken: string | null; // 明文，仅创建者浏览器
  format: Format;
  mode: 'local' | 'cloud';
  updatedAt: string;
}

const REG_KEY = 'schedulecube.registry.v1';
const docKey = (id: string) => `schedulecube.doc.${id}`;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function listRegistry(): RegistryEntry[] {
  const list = safeParse<RegistryEntry[]>(localStorage.getItem(REG_KEY)) ?? [];
  return list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function upsertRegistry(entry: RegistryEntry): void {
  const list = listRegistry().filter((e) => e.id !== entry.id);
  list.unshift(entry);
  try {
    localStorage.setItem(REG_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* 配额满则忽略，镜像仍可用 */
  }
}

export function removeRegistry(id: string): void {
  const list = listRegistry().filter((e) => e.id !== id);
  try {
    localStorage.setItem(REG_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  removeMirror(id);
}

export function getRegistry(id: string): RegistryEntry | null {
  return listRegistry().find((e) => e.id === id) ?? null;
}

export function saveMirror(id: string, doc: TournamentDoc): void {
  try {
    localStorage.setItem(docKey(id), JSON.stringify(doc));
  } catch {
    /* ignore */
  }
}

export function loadMirror(id: string): TournamentDoc | null {
  return safeParse<TournamentDoc>(localStorage.getItem(docKey(id)));
}

export function removeMirror(id: string): void {
  try {
    localStorage.removeItem(docKey(id));
  } catch {
    /* ignore */
  }
}