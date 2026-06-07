import { useMemo } from 'react';
import { selectActiveTab, useBrowserStore } from '../store/tabsStore';

export function PasswordsPrompt() {
  const activeTab = useBrowserStore(selectActiveTab);
  const prompt = useBrowserStore((s) => s.passwords.pendingPrompt);
  const available = useBrowserStore((s) => s.passwords.available);

  const visible = useMemo(() => {
    if (!available || !prompt || !activeTab) return false;
    return prompt.tabId === activeTab.id;
  }, [available, prompt, activeTab]);

  if (!visible || !prompt) return null;

  const title =
    prompt.kind === 'update' ? 'Обновить сохранённый пароль?' : 'Сохранить пароль для этого сайта?';

  return (
    <div className="pw-prompt" role="dialog" aria-live="polite" aria-label="Сохранение пароля">
      <div className="pw-prompt-main">
        <div className="pw-prompt-title">{title}</div>
        <div className="pw-prompt-sub">
          <span className="pw-prompt-origin">{prompt.origin}</span>
          {prompt.username ? <span className="pw-prompt-user">{prompt.username}</span> : null}
        </div>
      </div>
      <div className="pw-prompt-actions">
        <button
          type="button"
          className="pw-prompt-btn pw-prompt-btn-primary"
          onClick={() => void window.alpha.passwords.promptAction(prompt.id, 'save')}
        >
          {prompt.kind === 'update' ? 'Обновить' : 'Сохранить'}
        </button>
        <button
          type="button"
          className="pw-prompt-btn"
          onClick={() => void window.alpha.passwords.promptAction(prompt.id, 'dismiss')}
        >
          Не сейчас
        </button>
        {prompt.kind !== 'update' ? (
          <button
            type="button"
            className="pw-prompt-btn pw-prompt-btn-danger"
            onClick={() => void window.alpha.passwords.promptAction(prompt.id, 'never')}
          >
            Никогда для сайта
          </button>
        ) : null}
      </div>
    </div>
  );
}

