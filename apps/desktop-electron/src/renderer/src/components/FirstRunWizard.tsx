import { useEffect, useState } from 'react';
import { ShieldCheck, Globe, KeyRound, ArrowRight, ArrowLeft } from 'lucide-react';
import type { ActivationState } from '@alpha/shared-types';

/**
 * PRIORITY 4 — first-run onboarding wizard.
 *
 * Shown once, on first launch, ONLY while Alpha Proxy is not yet active. The
 * "seen" flag lives in localStorage so it never re-appears on its own; it can be
 * re-opened later from Settings/Help (host passes `forceOpen`). Product language
 * only — no SOCKS / sing-box / VLESS / Reality terminology.
 */
const SEEN_KEY = 'alpha:firstRunSeen:v1';
const REQUEST_URL = 'https://3d.negody.ru/alpha';

const STATUS_ROWS: { match: (s: ActivationState | null) => boolean; label: string; cls: string }[] = [
  { match: (s) => !s || s.status === 'idle', label: 'Заявка не отправлена', cls: '' },
  { match: (s) => s?.status === 'pending', label: 'Ожидает подтверждения', cls: 'frw-st-wait' },
  { match: (s) => s?.status === 'enter_code', label: 'Код не введён', cls: 'frw-st-wait' },
  { match: (s) => s?.status === 'connected', label: 'Подключаемся / подключено', cls: 'frw-st-ok' },
  { match: (s) => s?.status === 'revoked' || s?.status === 'denied', label: 'Доступ отключён', cls: 'frw-st-bad' },
];

export function FirstRunWizard({ forceOpen = false, onClose }: { forceOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [activation, setActivation] = useState<ActivationState | null>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      /* ignore */
    }
    void window.alpha.activation.getState().then((s) => {
      setActivation(s);
      const activated = s?.status === 'connected';
      // Show on first run only when not already activated; or when forced.
      if (forceOpen || (!seen && !activated)) setOpen(true);
    });
  }, [forceOpen]);

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
  }
  function close() {
    markSeen();
    setOpen(false);
    onClose?.();
  }
  async function openRequestPage() {
    await window.alpha.tabs.create({ url: REQUEST_URL });
    close();
  }
  async function openProxySettings() {
    await window.alpha.tabs.openSettings();
    close();
  }

  if (!open) return null;

  return (
    <div className="frw-backdrop" role="dialog" aria-modal="true">
      <div className="frw-card">
        <div className="frw-dots">
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={`frw-dot ${n === step ? 'is-on' : ''}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="frw-body">
            <div className="frw-head"><ShieldCheck size={22} /> <h2>Добро пожаловать в Alpha Browser</h2></div>
            <p>Alpha Browser работает как обычный браузер. При желании отдельные вкладки можно открывать через защищённое подключение Alpha Proxy.</p>
            <div className="frw-actions">
              <button className="settings-btn settings-btn-primary" onClick={() => setStep(2)}>Настроить Alpha Proxy <ArrowRight size={15} /></button>
              <button className="settings-btn" onClick={close}>Продолжить без прокси</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="frw-body">
            <div className="frw-head"><Globe size={22} /> <h2>Что такое Alpha Proxy</h2></div>
            <p>Это защищённый доступ к сайтам через сервер в Нидерландах. Вы сами выбираете, какие вкладки открывать через Alpha Proxy — остальные продолжают работать напрямую.</p>
            <p className="frw-muted">Подключение включается на отдельных PROXY-вкладках и не влияет на остальной интернет на вашем устройстве.</p>
            <div className="frw-actions">
              <button className="settings-btn" onClick={() => setStep(1)}><ArrowLeft size={15} /> Назад</button>
              <button className="settings-btn settings-btn-primary" onClick={() => setStep(3)}>Далее <ArrowRight size={15} /></button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="frw-body">
            <div className="frw-head"><KeyRound size={22} /> <h2>Как получить доступ</h2></div>
            <ol className="frw-steps">
              <li>Оставьте email на странице заявки.</li>
              <li>Дождитесь одобрения администратором.</li>
              <li>Получите код активации.</li>
              <li>Введите email и код в настройках Alpha Proxy.</li>
            </ol>
            <div className="frw-actions">
              <button className="settings-btn" onClick={() => setStep(2)}><ArrowLeft size={15} /> Назад</button>
              <button className="settings-btn" onClick={() => void openRequestPage()}>Открыть страницу заявки</button>
              <button className="settings-btn settings-btn-primary" onClick={() => setStep(4)}>Далее <ArrowRight size={15} /></button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="frw-body">
            <div className="frw-head"><ShieldCheck size={22} /> <h2>Статус подключения</h2></div>
            <p className="frw-muted">Текущее состояние Alpha Proxy:</p>
            <ul className="frw-status">
              {STATUS_ROWS.map((row) => (
                <li key={row.label} className={`${row.cls} ${row.match(activation) ? 'is-current' : ''}`}>
                  <span className="frw-status-dot" /> {row.label}
                </li>
              ))}
            </ul>
            <div className="frw-actions">
              <button className="settings-btn settings-btn-primary" onClick={() => void openProxySettings()}>Открыть настройки Alpha Proxy</button>
              <button className="settings-btn" onClick={close}>Понятно</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
