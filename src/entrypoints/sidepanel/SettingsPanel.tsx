import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, db } from '../../lib/db';
import type { Settings } from '../../lib/types';
import './settings.css';

interface SettingsPanelProps {
  onClose: () => void;
}

async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = (await db.settings.get('main')) ?? DEFAULT_SETTINGS;
  await db.settings.put({ ...current, ...patch, id: 'main' });
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = useLiveQuery(
    () => db.settings.get('main'),
    [],
    DEFAULT_SETTINGS,
  );
  const currentSettings = settings ?? DEFAULT_SETTINGS;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-panel"
        role="dialog"
      >
        <header className="settings-heading">
          <div>
            <p>轻量设置</p>
            <h2 id="settings-title">提醒</h2>
          </div>
          <button
            aria-label="关闭设置"
            className="settings-close"
            onClick={onClose}
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
              <path
                d="m6 6 12 12M18 6 6 18"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </header>

        <label className="settings-row settings-row--toggle">
          <span>
            <strong>每日复习提醒</strong>
            <small>有题到期时，每天最多通知一次</small>
          </span>
          <input
            checked={currentSettings.reminderEnabled}
            onChange={(event) => {
              void updateSettings({ reminderEnabled: event.target.checked });
            }}
            type="checkbox"
          />
        </label>

        <label
          className={`settings-row ${currentSettings.reminderEnabled ? '' : 'is-disabled'}`}
        >
          <span>
            <strong>提醒时间</strong>
            <small>按当前设备的本地时间</small>
          </span>
          <select
            aria-label="每日提醒时间"
            disabled={!currentSettings.reminderEnabled}
            onChange={(event) => {
              void updateSettings({ reminderHour: Number(event.target.value) });
            }}
            value={currentSettings.reminderHour}
          >
            {Array.from({ length: 16 }, (_, index) => index + 7).map((hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>

        <p className="settings-note">
          记录和排期都只保存在此浏览器中；关闭提醒不会停止自动记录。
        </p>
      </section>
    </div>
  );
}
