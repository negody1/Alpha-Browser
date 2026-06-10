import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Mail, KeyRound, Loader2, WifiOff, RotateCw, ClipboardCopy } from 'lucide-react';
import type { ActivationState, ProxyDiagnosticsSnapshot } from '@alpha/shared-types';

/** PART 3: honest readiness derived from the real proxy transport state. */
type Readiness = 'starting' | 'checking' | 'ready' | 'error';
function deriveReadiness(d: ProxyDiagnosticsSnapshot | null): Readiness {
  if (!d) return 'starting';
  if (d.status === 'ERROR') return 'error';
  if (d.status === 'CONNECTED') {
    // P0 FIX: distinguish "egress probe not finished yet" (egress == null) from
    // "egress probe finished and FAILED" (egress present, remoteEgressOk false).
    // The old code returned 'checking' for both → infinite "Проверка соединения"
    // whenever the tunnel was up locally but traffic could not actually egress.
    if (!d.egress) return 'checking';
    return d.egress.remoteEgressOk ? 'ready' : 'error';
  }
  return 'starting'; // CONNECTING / RECONNECTING / DISCONNECTED
}
function readinessError(d: ProxyDiagnosticsSnapshot | null): string {
  if (d?.status === 'CONNECTED' && d.egress && !d.egress.remoteEgressOk) {
    return 'Соединение не прошло проверку. Сайты могут не открываться через Alpha Proxy.';
  }
  if (d?.status === 'CONNECTED' && !d.egress) {
    return 'Проверка соединения не завершилась вовремя. Попробуйте снова.';
  }
  switch (d?.errorReason) {
    case 'REMOTE_PROFILE_MISSING':
      return 'Профиль Alpha Proxy не найден.';
    case 'BINARY_MISSING':
      return 'Компонент Alpha Proxy не найден.';
    default:
      return 'Не удалось запустить Alpha Proxy.';
  }
}

/**
 * Product-facing Alpha Proxy onboarding. No SOCKS/sing-box/file/env terminology —
 * just email → activation code → connected. Technical diagnostics live in the
 * collapsible "Расширенная диагностика" elsewhere in the Proxy section.
 */
export function AlphaProxyOnboarding() {
  const [state, setState] = useState<ActivationState | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<ProxyDiagnosticsSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const healedRef = useRef(false);
  const checkingSinceRef = useRef<number | null>(null);

  useEffect(() => {
    void window.alpha.activation.getState().then((s) => {
      setState(s);
      if (s?.email) setEmail(s.email);
    });
  }, []);

  // PART 3: while the user has a profile, track the REAL transport readiness so
  // the UI never claims "ready" before sing-box is up and egress is verified.
  const activated = state?.status === 'connected' && state?.hasProfile === true;
  useEffect(() => {
    if (!activated) {
      setDiag(null);
      return;
    }
    let alive = true;
    let egressRequested = false;
    const tick = async () => {
      const d = await window.alpha.proxy.diagnostics();
      if (!alive) return;
      setDiag(d);
      // Once transport is CONNECTED, run ONE egress check to confirm tabs work.
      if (d?.status === 'CONNECTED' && !d.egress?.remoteEgressOk && !egressRequested) {
        egressRequested = true;
        const d2 = await window.alpha.proxy.checkEgress();
        if (alive) setDiag(d2);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [activated]);

  async function retryProxy() {
    setBusy(true);
    try {
      // Actually restart the transport (idempotent profile re-check alone won't).
      const d = await window.alpha.proxy.retry();
      setDiag(d);
    } finally {
      setBusy(false);
    }
  }

  async function copyDiagnostics() {
    // Sanitized — the snapshot already excludes uuid/keys. Egress IP is the same
    // value shown in the diagnostics panel.
    const d = diag;
    const lines = [
      'Alpha Proxy diagnostics',
      `status: ${d?.status ?? '-'}`,
      `runtime: ${d?.runtimeMode ?? '-'}`,
      `errorReason: ${d?.errorReason ?? '-'}`,
      `socksPort: ${d?.socksPort ?? '-'}`,
      `egressOk: ${d?.egress?.remoteEgressOk ?? '-'}`,
      `egressIp: ${d?.egress?.egressIp ?? '-'}`,
      `expectedIp: ${d?.egress?.expectedEgressIp ?? '-'}`,
      `activation: ${state?.status ?? '-'} hasProfile=${state?.hasProfile ?? '-'}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function run(fn: () => Promise<ActivationState | null>) {
    setBusy(true);
    try {
      setState(await fn());
    } finally {
      setBusy(false);
    }
  }

  // SCENARIO B: the local profile was deleted while we believed we were
  // connected. Auto-heal once — an active device re-fetches its profile with no
  // new code (server returns connected + profile on a no-code re-check). If that
  // fails (offline / revoked) the UI falls through to the re-onboarding block.
  useEffect(() => {
    if (state?.status === 'connected' && state.hasProfile === false && !healedRef.current) {
      healedRef.current = true;
      void run(() => window.alpha.activation.checkStatus());
    }
  }, [state?.status, state?.hasProfile]);

  const status = state?.status ?? 'idle';
  const spin = busy ? <Loader2 size={16} className="spin-slow" /> : null;
  // SCENARIO A + C: one human banner for "unreachable" (network) and "5xx" (server).
  const conn = state?.error === 'network' || state?.error === 'server';
  const connBanner = conn ? (
    <div className="onb-row onb-err">
      <WifiOff size={16} />
      <span className="settings-muted">
        Alpha Proxy временно недоступен. Проверьте подключение к интернету и попробуйте позже.
      </span>
    </div>
  ) : null;

  return (
    <div className="settings-card">
      {(status === 'idle' || status === 'error' || (status === 'denied' && !state?.email)) && (
        <div className="onb">
          <div className="onb-head"><Mail size={18} /> <strong>Подключите Alpha Proxy</strong></div>
          <p className="settings-muted">Введите email, который был одобрен для доступа к Alpha Proxy.</p>
          <div className="onb-row">
            <input type="email" value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
            <button className="settings-btn settings-btn-primary" disabled={busy || !email.trim()} onClick={() => void run(() => window.alpha.activation.register(email))}>
              {spin} Отправить заявку
            </button>
          </div>
          {state?.error === 'invalid_email' && <span className="settings-muted">Введите корректный email.</span>}
          {connBanner}
        </div>
      )}

      {status === 'pending' && (
        <div className="onb">
          <div className="onb-head"><Loader2 size={18} /> <strong>Заявка отправлена</strong></div>
          <p className="settings-muted">Доступ появится после подтверждения администратором. Если у вас уже есть код активации — введите его ниже.</p>
          <div className="onb-row">
            <input value={code} placeholder="Код активации (XXXX-XXXX)" onChange={(e) => setCode(e.target.value)} />
            <button className="settings-btn settings-btn-primary" disabled={busy || !code.trim()} onClick={() => void run(() => window.alpha.activation.activate(state?.email ?? email, code))}>
              {spin} Активировать
            </button>
          </div>
          <button className="settings-btn" disabled={busy} onClick={() => void run(() => window.alpha.activation.checkStatus())}>
            {spin} Проверить статус
          </button>
          {connBanner}
        </div>
      )}

      {status === 'enter_code' && (
        <div className="onb">
          <div className="onb-head"><KeyRound size={18} /> <strong>Введите код активации</strong></div>
          <p className="settings-muted">{state?.error === 'code_used' ? 'Этот код уже использован. Запросите новый у администратора.' : state?.error === 'invalid_code' ? 'Неверный код. Проверьте и попробуйте снова.' : 'Введите код активации, выданный администратором.'}</p>
          <div className="onb-row">
            <input value={code} placeholder="XXXX-XXXX" onChange={(e) => setCode(e.target.value)} />
            <button className="settings-btn settings-btn-primary" disabled={busy || !code.trim()} onClick={() => void run(() => window.alpha.activation.activate(state?.email ?? email, code))}>
              {spin} Активировать
            </button>
          </div>
        </div>
      )}

      {/* PART 3: profile present → show HONEST readiness from the transport. */}
      {activated && (() => {
        let r = deriveReadiness(diag);
        // Watchdog: never spin on "checking" forever. If the egress probe hasn't
        // resolved within 20s (e.g. a hung request), surface the error state.
        if (r === 'checking') {
          if (checkingSinceRef.current == null) checkingSinceRef.current = Date.now();
          else if (Date.now() - checkingSinceRef.current > 20_000) r = 'error';
        } else {
          checkingSinceRef.current = null;
        }
        if (r === 'ready') {
          return (
            <div className="onb">
              <div className="onb-head onb-ok"><ShieldCheck size={18} /> <strong>Alpha Proxy готов к работе</strong></div>
              <p className="settings-muted">Можно открывать сайты через PROXY-вкладки.</p>
              <div className="settings-row">
                <span className="settings-muted">Маршрут</span>
                <span className="settings-badge is-ok">Нидерланды · Alpha Proxy</span>
              </div>
              <button className="settings-btn" disabled={busy} onClick={() => void run(() => window.alpha.activation.checkStatus())}>
                {spin} Проверить статус
              </button>
            </div>
          );
        }
        if (r === 'error') {
          return (
            <div className="onb">
              <div className="onb-head onb-bad"><WifiOff size={18} /> <strong>Alpha Proxy временно недоступен</strong></div>
              <p className="settings-muted">{readinessError(diag)}</p>
              <div className="onb-row">
                <button className="settings-btn settings-btn-primary" disabled={busy} onClick={() => void retryProxy()}>
                  <RotateCw size={15} /> Проверить снова
                </button>
                <button className="settings-btn" onClick={() => void copyDiagnostics()}>
                  <ClipboardCopy size={15} /> {copied ? 'Скопировано' : 'Скопировать диагностику'}
                </button>
              </div>
            </div>
          );
        }
        // starting | checking
        return (
          <div className="onb">
            <div className="onb-head"><Loader2 size={18} className="spin-slow" /> <strong>{r === 'checking' ? 'Проверяем соединение…' : 'Запускаем Alpha Proxy…'}</strong></div>
            <p className="settings-muted">{r === 'checking' ? 'Проверяем, что вкладки смогут работать через Alpha Proxy.' : 'Обычно это занимает несколько секунд.'}</p>
            <div className="settings-row">
              <span className="settings-muted">Доступ активирован</span>
              <span className="settings-badge">Профиль получен</span>
            </div>
          </div>
        );
      })()}

      {/* SCENARIO B: profile deleted locally — re-establishing, or offer re-activation. */}
      {status === 'connected' && !state?.hasProfile && (
        <div className="onb">
          <div className="onb-head"><Loader2 size={18} className={busy ? 'spin-slow' : ''} /> <strong>Восстановление доступа</strong></div>
          <p className="settings-muted">
            {conn
              ? 'Профиль Alpha Proxy не найден, а сервер сейчас недоступен. Подключение восстановится автоматически, как только связь появится.'
              : 'Профиль Alpha Proxy не найден на этом устройстве. Восстанавливаем доступ…'}
          </p>
          <button className="settings-btn settings-btn-primary" disabled={busy} onClick={() => void run(() => window.alpha.activation.checkStatus())}>
            {spin} Активировать заново
          </button>
          {connBanner}
        </div>
      )}

      {(status === 'revoked' || (status === 'denied' && state?.email)) && (
        <div className="onb">
          <div className="onb-head onb-bad"><strong>Доступ к Alpha Proxy отключён</strong></div>
          <p className="settings-muted">{status === 'revoked' ? 'Администратор отозвал доступ для этого устройства.' : 'Заявка отклонена администратором.'}</p>
        </div>
      )}
    </div>
  );
}
