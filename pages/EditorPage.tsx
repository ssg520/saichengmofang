// 赛程魔方 · 编辑器页（按 id 加载；管理密钥从 URL hash 提取后立即抹掉）
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CubeLogo } from '@/components/CubeLogo';
import { EditorSurface } from '@/components/EditorSurface';
import { api, apiMessage } from '@/lib/api';
import { getRegistry, loadMirror } from '@/lib/storage';
import { useStore } from '@/store/tournament';

export function EditorPage() {
  const { id = '' } = useParams();
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const loadDoc = useStore((s) => s.loadDoc);
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [keyInput, setKeyInput] = useState('');

  useEffect(() => {
    let cancelled = false;
    const hashMatch = window.location.hash.match(/#k=([0-9a-f]{32})/);
    const hashToken = hashMatch?.[1] ?? null;
    if (hashToken) window.history.replaceState(null, '', window.location.pathname);

    const st = useStore.getState();
    if (st.doc && st.meta.id === id) {
      if (hashToken && !st.meta.editToken) useStore.setState({ meta: { ...st.meta, editToken: hashToken } });
      return;
    }
    const reg = getRegistry(id);
    const token = hashToken ?? reg?.editToken ?? null;

    async function load() {
      if (token) {
        try {
          const res = await api.read(id, token);
          if (!cancelled) loadDoc(res.data, { id, shareId: res.shareId, editToken: token, version: res.version, mode: 'cloud' });
          return;
        } catch (e) {
          if (!cancelled) setErrMsg(apiMessage(e));
        }
      }
      const mirror = loadMirror(id);
      if (mirror && !cancelled) {
        loadDoc(mirror, { id, shareId: reg?.shareId ?? null, editToken: token, version: 1, mode: token ? 'cloud' : 'local' });
        return;
      }
      if (!cancelled) setStatus('error');
    }
    void load();
    return () => { cancelled = true; };
  }, [id, loadDoc]);

  async function submitKey() {
    const token = keyInput.trim();
    if (!/^[0-9a-f]{32}$/.test(token)) { setErrMsg('密钥格式不正确（应为 32 位十六进制）'); return; }
    try {
      const res = await api.read(id, token);
      loadDoc(res.data, { id, shareId: res.shareId, editToken: token, version: res.version, mode: 'cloud' });
    } catch (e) {
      setErrMsg(apiMessage(e));
    }
  }

  if (doc && meta.id === id) return <EditorSurface />;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card/70 p-6 text-center">
        <CubeLogo size={40} className="mx-auto mb-3" />
        {status === 'loading' && !errMsg ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 cube-spin" /> 正在加载赛事…
          </div>
        ) : (
          <>
            <h2 className="mb-1 text-base font-semibold">需要管理密钥</h2>
            <p className="mb-4 text-xs text-muted-foreground">{errMsg || '该赛事需管理密钥才能编辑。粘贴密钥或管理链接继续。'}</p>
            <div className="flex gap-2">
              <Input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="32 位管理密钥" className="stat-num h-9 text-xs" onKeyDown={(e) => { if (e.key === 'Enter') void submitKey(); }} />
              <Button size="sm" onClick={() => void submitKey()}><KeyRound className="size-4" /></Button>
            </div>
            <Link to="/" className="mt-4 inline-block text-xs text-[var(--site-accent)] hover:underline">返回首页</Link>
          </>
        )}
      </div>
    </div>
  );
}