import { useEffect, useState } from 'react';
import { ShieldCheck, Mail, KeyRound, Loader2 } from 'lucide-react';
import type { ActivationState } from '@alpha/shared-types';

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

  useEffect(() => {
    void window.alpha.activation.getState().then((s) => {
      setState(s);
      if (s?.email) setEmail(s.email);
    });
  }, []);

  async function run(fn: () => Promise<ActivationState | null>) {
    setBusy(true);
    try {
      setState(await fn());
    } finally {
      setBusy(false);
    }
  }

  const status = state?.status ?? 'idle';
  const spin = busy ? <Loader2 size={16} className="spin-slow" /> : null;

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
          {state?.error === 'network' && <span className="settings-muted">Не удалось связаться с сервером. Попробуйте позже.</span>}
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

      {status === 'connected' && (
        <div className="onb">
          <div className="onb-head onb-ok"><ShieldCheck size={18} /> <strong>Alpha Proxy подключён</strong></div>
          <div className="settings-row">
            <span className="settings-muted">Маршрут</span>
            <span className="settings-badge is-ok">Нидерланды · Alpha Proxy</span>
          </div>
          <button className="settings-btn" disabled={busy} onClick={() => void run(() => window.alpha.activation.checkStatus())}>
            {spin} Проверить соединение
          </button>
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
