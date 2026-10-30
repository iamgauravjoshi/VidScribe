import type { ThemeMode } from '../types/types';

interface Props {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
  compact?: boolean;
}

export function ThemeSwitch({ theme, onChange, compact = false }: Props) {
  const isDark = theme === 'dark';

  return (
    <button
      aria-checked={isDark}
      aria-label={`Dark mode ${isDark ? 'on' : 'off'}`}
      className={`theme-switch${compact ? ' theme-switch-compact' : ''}`}
      onClick={() => onChange(isDark ? 'light' : 'dark')}
      role="switch"
      type="button"
    >
      <span className="theme-switch-label">Dark mode</span>
      <span aria-hidden="true" className="theme-switch-track">
        <span className="theme-switch-thumb" />
      </span>
    </button>
  );
}
