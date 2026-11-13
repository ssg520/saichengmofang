// 赛程魔方 · 同源 Function API 客户端
// 浏览器视角前缀 /functions/v1/app；写操作携带 x-edit-token（明文，仅创建者持有）。
// 分享端点匿名只读。所有错误归一为 ApiError(code, status)，UI 用 apiMessage 翻译成人话。

import type { Format, TournamentDoc } from '@/engine/types';

const BASE = '/functions/v1/app';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

async function req(path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: init?.signal ?? AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError('network_error', 0);
  }
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('invalid_response', res.status);
  }
  if (!res.ok) {
    throw new ApiError(typeof body?.error === 'string' ? body.error : 'request_failed', res.status);
  }
  return body;
}

export interface CreateResult {
  id: string;
  shareId: string;
  version: number;
}
export interface ReadResult {
  id: string;
  shareId: string;
  title: string;
  data: TournamentDoc;
  version: number;
}
export interface ShareResult {
  id: string;
  shareId: string;
  title: string;
  version: number;
  format: Format;
  data: TournamentDoc;
}

export const api = {
  health: (): Promise<{ ok: boolean }> => req('/api/health'),
  create: (id: string, editTokenHash: string, title: string, data: TournamentDoc): Promise<CreateResult> =>
    req('/api/tournaments', { method: 'POST', body: JSON.stringify({ id, editTokenHash, title, data }) }),
  read: (id: string, token: string): Promise<ReadResult> =>
    req(`/api/tournaments/${id}`, { headers: { 'x-edit-token': token } }),
  save: (id: string, token: string, data: TournamentDoc, baseVersion: number, title: string): Promise<{ id: string; version: number }> =>
    req(`/api/tournaments/${id}`, {
      method: 'PATCH',
      headers: { 'x-edit-token': token },
      body: JSON.stringify({ data, baseVersion, title }),
    }),
  remove: (id: string, token: string): Promise<{ ok: boolean }> =>
    req(`/api/tournaments/${id}`, { method: 'DELETE', headers: { 'x-edit-token': token } }),
  share: (shareId: string): Promise<ShareResult> => req(`/api/share/${shareId}`),
};

const MESSAGES: Record<string, string> = {
  network_error: '网络连接中断，本次操作结果尚未确认。已为你保留本地副本。',
  invalid_response: '服务返回了无法识别的结果，请稍后重试。',
  invalid_input: '内容超出限制或格式有误，请检查后重试。',
  unauthorized: '管理密钥不正确，无法编辑该赛事。',
  not_found: '赛事不存在，或已被删除。',
  write_conflict: '该赛事在别处有更新。请先读取最新内容，核对后再保存。',
  idempotency_conflict: '创建命令与已有记录不一致，请核对后重试。',
  payload_too_large: '赛事内容过大（超过 512KB），请减少队伍或场次。',
  rate_limited: '操作过于频繁，请稍后再试。',
  database_unavailable: '云端数据服务暂不可用，已切换为本地保存。',
  request_failed: '暂时无法完成操作，请稍后重试。',
};

export function apiMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : '';
  return MESSAGES[code] ?? '暂时无法完成操作，请稍后重试。';
}