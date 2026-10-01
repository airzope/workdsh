import * as React from 'react';
import { Button, Modal, Switch, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives';
import { statusPath, type LocalModelsRequest, type LocalModelsStatus } from '../../local-models-contract.js';

const ROUTE_NAME = '本地模型 (llama.cpp)';

type Load = { readonly kind: 'loading' } | { readonly kind: 'absent' } | { readonly kind: 'ready'; readonly status: LocalModelsStatus };

async function readStatus(): Promise<LocalModelsStatus | undefined> {
  const response = await fetch(statusPath, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return await response.json() as LocalModelsStatus;
}

async function sendRequest(body: LocalModelsRequest): Promise<LocalModelsStatus> {
  const response = await fetch(statusPath, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const value = await response.json().catch(() => undefined) as (LocalModelsStatus & { error?: string }) | undefined;
  if (!response.ok || value === undefined) throw new Error(value?.error ?? `HTTP ${String(response.status)}`);
  return value;
}

/** The local model server's status, polled while shown; absent when this deployment has none. */
function useLocalModels(intervalMs: number) {
  const [load, setLoad] = React.useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string>();
  React.useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      try {
        const status = await readStatus();
        if (!disposed) setLoad(status === undefined ? { kind: 'absent' } : { kind: 'ready', status });
      } catch {
        if (!disposed) setLoad(previous => previous.kind === 'loading' ? { kind: 'absent' } : previous);
      }
      if (!disposed) timer = setTimeout(() => { void tick(); }, intervalMs);
    };
    void tick();
    return () => { disposed = true; clearTimeout(timer); };
  }, [intervalMs]);
  const request = React.useCallback(async (body: LocalModelsRequest): Promise<LocalModelsStatus | undefined> => {
    setBusy(true);
    setFailure(undefined);
    try {
      const status = await sendRequest(body);
      setLoad({ kind: 'ready', status });
      return status;
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { load, busy, failure, request };
}

function CopyPath({ path }: { readonly path: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="wd-local-folder">
      <code title={path}>{path}</code>
      <Button size="sm" variant="outline" onClick={() => { void writeClipboard(path).then(done => { setCopied(done); }); }}>
        {copied ? '已复制' : '复制路径'}
      </Button>
    </div>
  );
}

const onboardingCss = `
[role=dialog].wd-local-onboarding{width:min(600px,100%);max-height:100%;padding:0;gap:0}
.wd-local-onboarding .wd-local-content{display:flex;flex-direction:column;padding:28px;box-sizing:border-box;overflow-y:auto}
.wd-local-onboarding h2{margin:0;font-size:20px;line-height:28px;font-weight:500;color:var(--dsw-alias-label-primary);outline:none}
.wd-local-onboarding p{margin:0;font-size:14px;line-height:24px;color:var(--dsw-alias-label-secondary)}
.wd-local-onboarding .wd-local-lead{margin-top:20px}
.wd-local-options{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.wd-local-option{display:flex;flex-direction:column;gap:2px;width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl,14px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.wd-local-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-local-option[aria-checked=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.wd-local-option:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.wd-local-option strong{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}
.wd-local-option span{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.wd-local-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}
.wd-local-error{color:var(--dsw-alias-state-error-primary)!important;margin-top:12px!important;font-size:13px!important;line-height:20px!important;overflow-wrap:anywhere}
.wd-local-ready{color:var(--dsw-alias-state-success-primary)!important}
.wd-local-folder{display:flex;align-items:center;gap:8px;margin-top:12px;min-width:0}
.wd-local-folder code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-settings-card-fill);font-size:12px;line-height:20px;color:var(--dsw-alias-label-primary)}
.wd-local-tips{margin:12px 0 0;padding-left:18px;font-size:13px;line-height:22px;color:var(--dsw-alias-label-tertiary)}
`;

/**
 * The model choice in first-run setup: start the bundled llama.cpp server for
 * local GGUF models, or go on to the DeepSeek API key. Without a local server
 * in this deployment, the API key editor opens directly.
 */
export function LocalModelSignIn({ complete, useApiKey }: { readonly complete: () => void; readonly useApiKey: () => void }) {
  const { load, busy, failure, request } = useLocalModels(3_000);
  const [choice, setChoice] = React.useState<'local' | 'api'>('local');
  const [waiting, setWaiting] = React.useState(false);

  React.useEffect(() => {
    if (load.kind === 'absent') useApiKey();
  }, [load.kind, useApiKey]);

  // Like the other setup steps, keep the application behind the dialog inert.
  React.useEffect(() => {
    const root = document.getElementById('root');
    if (root === null) return;
    const previous = root.inert;
    root.inert = true;
    return () => { root.inert = previous; };
  }, []);

  if (load.kind !== 'ready') return null;
  const status = load.status;

  const start = async (): Promise<void> => {
    const next = await request({ ...(status.mode === 'managed' ? { enabled: true } : {}), useAsDefault: true });
    if (next === undefined) return;
    if (next.state === 'running' && next.models.length > 0) complete();
    else setWaiting(true);
  };

  const options = [
    { id: 'local' as const, title: ROUTE_NAME, detail: '在这台电脑上运行 GGUF 格式的开源模型。不需要 API Key，对话内容不会离开本机。' },
    { id: 'api' as const, title: 'DeepSeek API Key', detail: '使用 DeepSeek 官方模型，需要先在 DeepSeek 开放平台创建 API Key。' },
  ];

  let body: React.ReactNode;
  if (!waiting) {
    body = (
      <>
        <h2>选择要使用的模型</h2>
        <p className="wd-local-lead">可以在本机运行模型，也可以使用 DeepSeek 官方 API。之后随时可以在“设置 → 模型”中更改。</p>
        <div className="wd-local-options" role="radiogroup" aria-label="模型来源">
          {options.map(option => (
            <button key={option.id} type="button" role="radio" aria-checked={choice === option.id} className="wd-local-option" onClick={() => { setChoice(option.id); }}>
              <strong>{option.title}</strong>
              <span>{option.detail}</span>
            </button>
          ))}
        </div>
        {failure !== undefined && <p className="wd-local-error">本地模型服务没有启动：{failure}</p>}
        <div className="wd-local-actions">
          <Button variant="outline" disabled={busy} onClick={complete}>稍后配置</Button>
          <Button variant="primary" disabled={busy} onClick={() => { if (choice === 'api') useApiKey(); else void start(); }}>
            {choice === 'api' ? '填写 API Key' : busy ? '正在启动…' : '启动本地模型'}
          </Button>
        </div>
      </>
    );
  } else if (status.state === 'failed' || status.state === 'stopped') {
    body = (
      <>
        <h2>本地模型服务没有启动</h2>
        <p className="wd-local-error">{status.error ?? failure ?? 'llama-server 没有响应。'}</p>
        <div className="wd-local-actions">
          <Button variant="outline" disabled={busy} onClick={useApiKey}>改用 API Key</Button>
          <Button variant="primary" disabled={busy} onClick={() => { void start(); }}>{busy ? '正在启动…' : '重试'}</Button>
        </div>
      </>
    );
  } else if (status.models.length > 0) {
    body = (
      <>
        <h2>本地模型已就绪</h2>
        <p className="wd-local-lead wd-local-ready">
          找到 {status.models.length} 个模型{status.isDefault ? '，新会话将默认使用本地模型' : ''}：{status.models.join('、')}
        </p>
        <div className="wd-local-actions">
          <Button variant="primary" onClick={complete}>开始使用</Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h2>{status.state === 'starting' ? '正在启动本地模型服务…' : '本地模型服务已启动'}</h2>
        <p className="wd-local-lead">把 GGUF 模型文件（.gguf）放进下面的文件夹，几秒后就会出现在模型列表中，并成为新会话的默认模型。</p>
        {status.modelsDir !== undefined && <CopyPath path={status.modelsDir} />}
        <ul className="wd-local-tips">
          <li>一个文件对应一个模型，模型名就是文件名。</li>
          <li>可以从 ModelScope 或 Hugging Face 下载 GGUF 模型；需要调用工具时，请选择支持工具调用的模型。</li>
          <li>模型在第一次使用时加载，闲置 10 分钟后自动释放内存。</li>
        </ul>
        <div className="wd-local-actions">
          <Button variant="outline" onClick={useApiKey}>改用 API Key</Button>
          <Button variant="primary" onClick={complete}>完成</Button>
        </div>
      </>
    );
  }

  return (
    <Modal open title="选择要使用的模型" onClose={() => {}} headless className="wd-local-onboarding">
      <style>{onboardingCss}</style>
      <div className="wd-local-content">{body}</div>
    </Modal>
  );
}

const cardCss = `
.wd-local-card{display:flex;flex-direction:column;gap:10px;max-width:720px;margin-top:8px;padding:12px 14px;border:0.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl,14px);background:var(--dsw-alias-settings-card-fill);color:var(--dsw-alias-label-primary);box-sizing:border-box}
.wd-local-card-head{display:flex;align-items:center;gap:10px}
.wd-local-card-identity{display:inline-flex;align-items:center;gap:6px;min-width:0}
.wd-local-card-name{font-size:14px;line-height:22px;font-weight:500}
.wd-local-card-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-quaternary,var(--dsw-alias-border-l3))}
.wd-local-card-dot[data-state=running]{background:var(--dsw-alias-state-success-primary)}
.wd-local-card-dot[data-state=failed]{background:var(--dsw-alias-state-error-primary)}
.wd-local-card-tag{flex:none;padding:1px 6px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs,4px);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.wd-local-card-switch{margin-left:auto}
.wd-local-card p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.wd-local-card .wd-local-folder{margin-top:0}
.wd-local-card .wd-local-error{margin-top:0!important}
.wd-local-card-actions{display:flex;gap:8px}
`;

function stateLabel(status: LocalModelsStatus): string {
  switch (status.state) {
    case 'running': return status.models.length > 0 ? `运行中 · ${String(status.models.length)} 个模型` : '运行中 · 暂无模型';
    case 'starting': return '正在启动';
    case 'failed': return '启动失败';
    default: return status.enabled === false ? '已关闭' : '未启动';
  }
}

function cardSummary(status: LocalModelsStatus): string {
  if (status.mode === 'external') return '模型来自部署方提供的 llama.cpp 服务。';
  if (status.state === 'running' && status.models.length === 0) return '服务已启动。把 GGUF 模型文件放进下面的文件夹，几秒后即可在模型列表中选择。';
  if (status.state === 'running') return `${status.models.join('、')}。放进下面文件夹的 GGUF 模型会自动出现。`;
  if (status.enabled === false) return '已关闭。打开后，下面文件夹中的 GGUF 模型会出现在模型列表中。';
  return '在本机运行 GGUF 模型，无需 API Key。把模型放进下面的文件夹后会自动启动，也可以现在打开。';
}

/** The local model server on the Models settings page: status, folder, on/off and default. */
export function LocalModelsCard() {
  const { load, busy, failure, request } = useLocalModels(5_000);
  if (load.kind !== 'ready') return null;
  const status = load.status;
  const on = status.enabled ?? (status.state === 'running' || status.state === 'starting');
  const error = failure ?? status.error;
  return (
    <section className="wd-local-card" aria-label={ROUTE_NAME}>
      <style>{cardCss}</style>
      <div className="wd-local-card-head">
        <span className="wd-local-card-identity">
          <span className="wd-local-card-dot" data-state={status.state} aria-hidden />
          <span className="wd-local-card-name">{ROUTE_NAME}</span>
          <span className="wd-local-card-tag">{stateLabel(status)}</span>
        </span>
        {status.mode === 'managed' && (
          <span className="wd-local-card-switch">
            <Switch checked={on} disabled={busy} label="本地模型服务" onChange={next => { void request({ enabled: next }); }} />
          </span>
        )}
      </div>
      <p>{cardSummary(status)}</p>
      {status.modelsDir !== undefined && <CopyPath path={status.modelsDir} />}
      {status.state === 'failed' && error !== undefined && <p className="wd-local-error">{error}</p>}
      {status.state !== 'failed' && failure !== undefined && <p className="wd-local-error">{failure}</p>}
      {status.models.length > 0 && !status.isDefault && (
        <div className="wd-local-card-actions">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { void request({ useAsDefault: true }); }}>设为新会话的默认模型</Button>
        </div>
      )}
    </section>
  );
}
