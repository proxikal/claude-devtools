/**
 * GeneralSection - General settings including startup and appearance.
 */

import { SettingRow, SettingsSectionHeader, SettingsSelect, SettingsToggle } from '../components';

import type { SafeConfig } from '../hooks/useSettingsConfig';

// Theme options
const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
] as const;

interface GeneralSectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly onGeneralToggle: (key: 'launchAtLogin' | 'showDockIcon', value: boolean) => void;
  readonly onThemeChange: (value: 'dark' | 'light' | 'system') => void;
}

export const GeneralSection = ({
  safeConfig,
  saving,
  onGeneralToggle,
  onThemeChange,
}: GeneralSectionProps): React.JSX.Element => {
  return (
    <div>
      <SettingsSectionHeader title="Startup" />
      <SettingRow label="Launch at login" description="Automatically start the app when you log in">
        <SettingsToggle
          enabled={safeConfig.general.launchAtLogin}
          onChange={(v) => onGeneralToggle('launchAtLogin', v)}
          disabled={saving}
        />
      </SettingRow>
      {window.navigator.userAgent.includes('Macintosh') && (
        <SettingRow label="Show dock icon" description="Display the app icon in the dock (macOS)">
          <SettingsToggle
            enabled={safeConfig.general.showDockIcon}
            onChange={(v) => onGeneralToggle('showDockIcon', v)}
            disabled={saving}
          />
        </SettingRow>
      )}

      <SettingsSectionHeader title="Appearance" />
      <SettingRow label="Theme" description="Choose your preferred color theme">
        <SettingsSelect
          value={safeConfig.general.theme}
          options={THEME_OPTIONS}
          onChange={onThemeChange}
          disabled={saving}
        />
      </SettingRow>
    </div>
  );
};
