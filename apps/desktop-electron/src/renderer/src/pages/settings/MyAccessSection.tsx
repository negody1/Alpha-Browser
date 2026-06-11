import { useEffect, useState, type ReactNode } from 'react';
import { ShieldCheck, RotateCw, DownloadCloud, ExternalLink } from 'lucide-react';
import type { AccessDetails, ProxyDiagnosticsSnapshot, ActivationStatus } from '@alpha/shared-types';

const ACCESS_PAGE_URL = 'https://3d.negody.ru/alpha';

/** Friendly access-status label + tone. */
function accessLabel(s: ActivationStatus, hasProfile: boolean): { text: string; tone: string } {
  switch (s) {
    case 'connected':
      return hasProfile
        ? { text: 'Доступ активен', tone: 'ok' }
        : { text: 'Восстановление доступа…', tone: 'wait' };
    case 'pending':
      return { text: 'Ожидает подтверждения', tone: 'wait' };
    case 'enter_code':
      return { text: 'Код не введён', tone: 'wait' };
    case 'revoked':
      return { text: 'Доступ отключён', tone: 'bad' };
    case 'denied':
      return { text: 'Заявка отклонена', tone: 'bad' };
    default:
      return { text: 'Доступ не активирован', tone: 'mut' };
  }
}

/** Friendly proxy-readiness label derived from real transport diagnostics. */
function proxyLabel(d: ProxyDiagnosticsSnapshot | null): { text: string; tone: string } {
  if (!d || d.status === 'DISCONNECTED') return { text: 'Отключён', tone: 'mut' };
  if (d.status === 'ERROR') return { text: 'Недоступен', tone: 'bad' };
  if (d.status === 'CONNECTING' || d.status === 'RECONNECTING') return { text: 'Запуск…', tone: 'wait' };
  // CONNECTED
  if (!d.egress) return { text: 'Проверка соединения…', tone: 'wait' };
  return d.egress.remoteEgressOk
    ? { text: 'Готов к работе', tone: 'ok' }
    : { text: 'Соединение не прошло проверку', tone: 'bad' };
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export function MyAccessSection() {
  const [details, setDetails] = useState<AccessDetails | null>(null);
  const [diag, setDiag] = useState<ProxyDiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState<'access' | 'updates' | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  async function refresh() {
    const [d, p] = await Promise.all([window.alpha.activation.getDetails(), window.alpha.proxy.diagnostics()]);
    setDetails(d);
    setDiag(p);
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function checkAccess() {
    setBusy('access');
    try {
      await window.alpha.activation.checkStatus();
      await refresh();
    } finally {
      setBusy(null);
    }
  }
  async function checkUpdates() {
    setBusy('updates');
    setUpdateMsg(null);
    try {
      const u = await window.alpha.updates.check();
      if (!u) setUpdateMsg('Не удалось проверить обновления.');
      else if (u.available) setUpdateMsg(`Доступна новая версия ${u.latestVersion}. Откройте страницу релиза, чтобы скачать установщик.`);
      else setUpdateMsg('У вас последняя версия.');
    } finally {
      setBusy(null);
    }
  }

  const acc = details ? accessLabel(details.status, details.hasProfile) : { text: '—', tone: 'mut' };
  const prx = proxyLabel(diag);

  const rows: { label: string; value: ReactNode; tone?: string }[] = [
    { label: 'Статус доступа', value: acc.text, tone: acc.tone },
    { label: 'Alpha Proxy', value: prx.text, tone: prx.tone },
    { label: 'Email', value: details?.email ?? '—' },
    { label: 'Активирован / обновлён', value: fmt(details?.profileUpdatedAt ?? null) },
    { label: 'Версия профиля', value: details?.profileVersion ?? '—' },
    { label: 'Версия браузера', value: details?.browserVersion ?? '—' },
    { label: 'Последняя проверка доступа', value: fmt(details?.lastCheckedAt ?? null) },
  ];

  return (
    <>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={18} /> Мой доступ
            </strong>
            <span className="settings-muted">Текущее состояние доступа к Alpha Proxy</span>
          </div>
          <span className={`settings-badge ${prx.tone === 'ok' ? 'is-ok' : prx.tone === 'bad' ? 'is-error' : ''}`}>{prx.text}</span>
        </div>

        <dl className="access-grid">
          {rows.map((r) => (
            <div className="access-row" key={r.label}>
              <dt>{r.label}</dt>
              <dd className={r.tone ? `access-${r.tone}` : undefined}>{r.value}</dd>
            </div>
          ))}
        </dl>

        <div className="settings-form-actions" style={{ marginTop: 14 }}>
          <button className="settings-btn settings-btn-primary" disabled={busy !== null} onClick={() => void checkAccess()}>
            <RotateCw size={15} /> {busy === 'access' ? 'Проверка…' : 'Проверить доступ'}
          </button>
          <button className="settings-btn" disabled={busy !== null} onClick={() => void checkUpdates()}>
            <DownloadCloud size={15} /> {busy === 'updates' ? 'Проверка…' : 'Проверить обновления'}
          </button>
          <button className="settings-btn" onClick={() => void window.alpha.tabs.create({ url: ACCESS_PAGE_URL })}>
            <ExternalLink size={15} /> Страница доступа
          </button>
        </div>
        {updateMsg && <p className="settings-muted" style={{ marginTop: 10 }}>{updateMsg}</p>}
      </div>

      {(details?.status === 'idle' || details?.status === 'pending' || details?.status === 'enter_code') && (
        <div className="settings-notice settings-notice-warn">
          <strong>Доступ ещё не активирован.</strong>
          <span className="settings-muted">Подключение настраивается в разделе «Прокси и маршрутизация» — введите email и код активации.</span>
        </div>
      )}
    </>
  );
}
