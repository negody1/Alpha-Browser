import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Globe,
  ShieldBan,
  ShieldCheck,
  KeyRound,
  Download,
  Lock,
  Info,
} from 'lucide-react';
import { ProxySection } from './ProxySection';
import { MyAccessSection } from './MyAccessSection';
import { PasswordsSection } from './PasswordsSection';
import { SitePermissionsSection } from './SitePermissionsSection';

type SectionId =
  | 'my-access'
  | 'general'
  | 'proxy'
  | 'adblock'
  | 'permissions'
  | 'passwords'
  | 'downloads'
  | 'privacy'
  | 'about';

interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  icon: typeof Search;
  keywords: string[];
}

const SECTIONS: SectionDef[] = [
  {
    id: 'my-access',
    label: 'Мой доступ',
    description: 'Статус доступа, профиль и версия Alpha Browser',
    icon: ShieldCheck,
    keywords: ['доступ', 'access', 'мой доступ', 'статус', 'профиль', 'активация', 'alpha proxy'],
  },
  {
    id: 'general',
    label: 'Общие',
    description: 'Поиск, стартовая страница и поведение браузера',
    icon: SlidersHorizontal,
    keywords: ['общие', 'general', 'поиск', 'startup', 'старт'],
  },
  {
    id: 'proxy',
    label: 'Прокси и маршрутизация',
    description: 'Режим по умолчанию, эндпоинт и правила для сайтов',
    icon: Globe,
    keywords: ['прокси', 'proxy', 'маршрут', 'routing', 'socks', 'pac', 'vpn'],
  },
  {
    id: 'adblock',
    label: 'Блокировка рекламы',
    description: 'Фильтрация запросов и исключения для сайтов',
    icon: ShieldBan,
    keywords: ['реклама', 'adblock', 'блокировка', 'фильтры'],
  },
  {
    id: 'permissions',
    label: 'Разрешения сайтов',
    description: 'Камера, микрофон и уведомления по сайтам',
    icon: ShieldCheck,
    keywords: [
      'разрешения',
      'permissions',
      'камера',
      'camera',
      'микрофон',
      'microphone',
      'уведомления',
      'notifications',
      'сайты',
    ],
  },
  {
    id: 'passwords',
    label: 'Пароли',
    description: 'Сохранённые логины и пароли',
    icon: KeyRound,
    keywords: ['пароли', 'passwords', 'логины', 'учётные'],
  },
  {
    id: 'downloads',
    label: 'Загрузки',
    description: 'Папка загрузок и история файлов',
    icon: Download,
    keywords: ['загрузки', 'downloads', 'файлы', 'папка'],
  },
  {
    id: 'privacy',
    label: 'Приватность',
    description: 'История и данные просмотра',
    icon: Lock,
    keywords: ['приватность', 'privacy', 'история', 'данные', 'очистить', 'прокси', 'proxy', 'сбросить', 'cookies', 'куки'],
  },
  {
    id: 'about',
    label: 'О браузере',
    description: 'Версия и сведения о приложении',
    icon: Info,
    keywords: ['о браузере', 'about', 'версия', 'version'],
  },
];

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>('general');
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    void window.alpha.getVersion().then(setVersion);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.keywords.some((k) => k.includes(q)),
    );
  }, [query]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div className="settings-page">
      <header className="settings-topbar">
        <div className="settings-brand">
          <img src="branding/app-logo.png" alt="" width={28} height={28} />
          <div className="settings-brand-text">
            <strong>Alpha Browser</strong>
            {version && <span>Версия {version}</span>}
          </div>
        </div>
        <label className="settings-search">
          <Search size={16} strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            placeholder="Поиск в настройках"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </header>

      <div className="settings-body">
        <nav className="settings-sidenav" aria-label="Разделы настроек">
          {filtered.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                className={`settings-navitem ${section === s.id ? 'is-active' : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => setSection(s.id)}
              >
                <Icon size={18} strokeWidth={1.75} />
                <span>{s.label}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="settings-navitem-empty">Ничего не найдено</p>
          )}
        </nav>

        <main className="settings-content">
          <div className="settings-content-inner">
            <div className="settings-content-head">
              <h1>{active.label}</h1>
              <p>{active.description}</p>
            </div>
            {section === 'my-access' && <MyAccessSection />}
            {section === 'general' && <GeneralSection />}
            {section === 'proxy' && <ProxySection />}
            {section === 'adblock' && <AdblockSection />}
            {section === 'permissions' && <SitePermissionsSection />}
            {section === 'passwords' && <PasswordsSection />}
            {section === 'downloads' && <DownloadsSection />}
            {section === 'privacy' && <PrivacySection />}
            {section === 'about' && <AboutSection version={version} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function GeneralSection() {
  return (
    <div className="settings-card">
      <p className="settings-muted">
        Основные параметры Alpha скоро появятся здесь. Маршрутизация, блокировка рекламы,
        пароли и загрузки управляются в соответствующих разделах слева.
      </p>
    </div>
  );
}

function AdblockSection() {
  const [enabled, setEnabled] = useState(false);
  const [blockedTotal, setBlockedTotal] = useState(0);

  function refresh() {
    void window.alpha.adblock.getState().then((s) => {
      setEnabled(s?.enabled ?? false);
      setBlockedTotal(s?.blockedTotal ?? 0);
    });
  }

  useEffect(() => {
    refresh();
    return window.alpha.adblock.onChanged(refresh);
  }, []);

  return (
    <div className="settings-card">
      <label className="settings-row settings-row-toggle">
        <div className="settings-row-text">
          <strong>Блокировка рекламы</strong>
          <span className="settings-muted">Фильтрует рекламные и трекинговые запросы</span>
        </div>
        <input
          type="checkbox"
          className="settings-switch"
          checked={enabled}
          onChange={(e) => void window.alpha.adblock.setEnabled(e.target.checked).then(refresh)}
        />
      </label>
      <div className="settings-row">
        <div className="settings-row-text">
          <strong>Заблокировано запросов</strong>
          <span className="settings-muted">За текущую сессию</span>
        </div>
        <span className="settings-stat">{blockedTotal.toLocaleString('ru-RU')}</span>
      </div>
    </div>
  );
}

function DownloadsSection() {
  const [dir, setDir] = useState<string | null>(null);

  function refresh() {
    void window.alpha.downloads.getDownloadDir().then(setDir);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-row-text">
          <strong>Папка загрузок</strong>
          <span className="settings-muted">{dir || 'Системная папка по умолчанию'}</span>
        </div>
        <button
          type="button"
          className="settings-btn"
          onClick={() => void window.alpha.downloads.chooseDownloadDir().then(refresh)}
        >
          Изменить
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <strong>Все загрузки</strong>
          <span className="settings-muted">Открыть панель загрузок</span>
        </div>
        <button
          type="button"
          className="settings-btn"
          onClick={() => void window.alpha.overlay.openPanel('downloads-panel')}
        >
          Открыть
        </button>
      </div>
    </div>
  );
}

function PrivacySection() {
  const [count, setCount] = useState(0);
  const [confirm, setConfirm] = useState(false);

  function refresh() {
    void window.alpha.history.list().then((items) => setCount(items.length));
  }

  useEffect(() => {
    refresh();
    return window.alpha.history.onChanged(refresh);
  }, []);

  return (
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-row-text">
          <strong>История посещений</strong>
          <span className="settings-muted">{count.toLocaleString('ru-RU')} записей</span>
        </div>
        <button type="button" className="settings-btn" onClick={() => void window.alpha.overlay.openPanel('history-panel')}>
          Открыть историю
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <strong>Очистить историю</strong>
          <span className="settings-muted">Удаляет все записи без возможности восстановления</span>
        </div>
        {confirm ? (
          <div className="settings-confirm">
            <button type="button" className="settings-btn" onClick={() => setConfirm(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="settings-btn settings-btn-danger"
              onClick={() => {
                void window.alpha.history.clear().then(() => {
                  setConfirm(false);
                  refresh();
                });
              }}
            >
              Очистить
            </button>
          </div>
        ) : (
          <button type="button" className="settings-btn settings-btn-danger-ghost" onClick={() => setConfirm(true)}>
            Очистить
          </button>
        )}
      </div>
      <ProxyIdentityResetRow />
    </div>
  );
}

function ProxyIdentityResetRow() {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function reset() {
    setBusy(true);
    setStatus(null);
    void window.alpha.privacy
      .resetProxyIdentity()
      .then((res) => {
        if (res.ok) {
          setStatus(
            res.reloadedTabs > 0
              ? `Готово. PROXY-вкладок перезагружено: ${res.reloadedTabs}.`
              : 'Готово. Данные PROXY-профиля очищены.',
          );
        } else {
          setStatus(`Не удалось очистить: ${res.error ?? 'неизвестная ошибка'}`);
        }
      })
      .catch((e) => setStatus(`Ошибка: ${String(e)}`))
      .finally(() => {
        setBusy(false);
        setConfirm(false);
      });
  }

  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <strong>Сбросить данные PROXY-профиля</strong>
        <span className="settings-muted">
          Удалит cookies, кеш и данные сайтов, открытых через PROXY. Это выйдет из аккаунтов
          Google, YouTube, Telegram, Discord и других сайтов только в PROXY-режиме. DIRECT-профиль,
          закладки, история, пароли и настройки браузера не будут затронуты.
        </span>
        {status && <span className="settings-muted">{status}</span>}
      </div>
      {confirm ? (
        <div className="settings-confirm">
          <button type="button" className="settings-btn" disabled={busy} onClick={() => setConfirm(false)}>
            Отмена
          </button>
          <button
            type="button"
            className="settings-btn settings-btn-danger"
            disabled={busy}
            onClick={reset}
            title="Вы уверены? Это удалит данные сайтов только для PROXY-профиля."
          >
            {busy ? 'Очистка…' : 'Сбросить PROXY-профиль'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="settings-btn settings-btn-danger-ghost"
          onClick={() => setConfirm(true)}
        >
          Сбросить PROXY-профиль
        </button>
      )}
    </div>
  );
}

function AboutSection({ version }: { version: string }) {
  return (
    <div className="settings-card settings-about-card">
      <img src="branding/app-logo.png" alt="" width={56} height={56} />
      <div>
        <strong>Alpha Browser</strong>
        {version && <p className="settings-muted">Версия {version}</p>}
      </div>
    </div>
  );
}
