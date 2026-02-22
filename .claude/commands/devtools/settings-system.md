---
name: devtools:settings-system
description: How to add new settings — AppConfig structure, ConfigManager, IPC wiring, and settings UI patterns. Use when adding a new toggle, option, or config section.
---

# Settings System

## AppConfig Structure

Defined in `src/main/services/infrastructure/ConfigManager.ts` (source of truth) and mirrored in `src/shared/types/notifications.ts`.

```typescript
interface AppConfig {
  general: {
    launchAtLogin: boolean
    showDockIcon: boolean
    theme: 'dark' | 'light' | 'system'
    defaultTab: 'dashboard' | 'sessions'
    claudeRootPath: string | null
    autoExpandAIGroups: boolean
    autoExpandTools: string[]         // tool names to auto-expand
  }
  display: {
    showTimestamps: boolean
    compactMode: boolean
    syntaxHighlighting: boolean
  }
  notifications: NotificationConfig   // triggers, sound, snooze, etc.
  sessions: { pinnedSessions: {}; hiddenSessions: {} }
  ssh: SshPersistConfig
  httpServer: { enabled: boolean; port: number }
}
```

Config persists to `~/.claude/claude-devtools-config.json`.

## Adding a New Setting — Checklist

### 1. Type (`ConfigManager.ts`)
Add field to the relevant interface and `DEFAULT_CONFIG`:
```typescript
general: {
  myNewSetting: boolean   // add here
}
// In DEFAULT_CONFIG:
general: { ..., myNewSetting: false }
```

### 2. Shared type (`src/shared/types/notifications.ts`)
Mirror the same change — both files define `AppConfig` and must stay in sync.

### 3. IPC (`src/main/ipc/config.ts`)
`config.get` / `config.update` IPC handlers already handle the full `AppConfig` generically — no handler changes needed for adding fields to existing sections.

### 4. Store (`src/renderer/store/slices/configSlice.ts`)
Config is stored as `appConfig: AppConfig | null`. Reading a new field:
```typescript
const myValue = useStore(s => s.appConfig?.general.myNewSetting ?? false);
```

Updating via IPC:
```typescript
await window.electronAPI.config.update('general', {
  ...appConfig.general,
  myNewSetting: newValue,
});
// Then reload:
const updated = await window.electronAPI.config.get();
set({ appConfig: updated });
```

### 5. Settings UI (`src/renderer/components/settings/sections/`)

Settings sections: `GeneralSection.tsx`, `DisplaySection.tsx`, `NotificationsSection.tsx`, `AdvancedSection.tsx`.

Use the `SettingsToggle` pattern:
```tsx
// src/renderer/components/settings/components/SettingsToggle.tsx
<SettingsToggle
  label="My New Setting"
  description="What this does"
  checked={appConfig?.general.myNewSetting ?? false}
  onChange={(val) => handleUpdate('general', { myNewSetting: val })}
/>
```

`handleUpdate` from `useSettingsHandlers` handles the IPC call + store refresh.

## Key Files

| File | Role |
|------|------|
| `src/main/services/infrastructure/ConfigManager.ts` | Source of truth — interfaces + defaults + file I/O |
| `src/shared/types/notifications.ts` | Mirror of AppConfig for renderer |
| `src/main/ipc/config.ts` | IPC handlers (`config.get`, `config.update`, etc.) |
| `src/renderer/store/slices/configSlice.ts` | `appConfig` state + `loadConfig` action |
| `src/renderer/components/settings/hooks/useSettingsHandlers.ts` | `handleUpdate` — IPC + store refresh |
| `src/renderer/components/settings/sections/GeneralSection.tsx` | General settings UI |
| `src/renderer/components/settings/components/SettingsToggle.tsx` | Reusable toggle row |

## Reading Config in Components

```typescript
// Single value
const autoExpand = useStore(s => s.appConfig?.general.autoExpandAIGroups ?? false);

// Full section
const general = useStore(s => s.appConfig?.general);
```

## Config Used at Runtime (Main Process)

Some settings are consumed directly in main-process services:
- `general.claudeRootPath` → `ProjectScanner` override
- `httpServer.*` → HTTP server enable/port
- `notifications.*` → `NotificationManager` / `ErrorTriggerChecker`

For these, main process reads via `ConfigManager.getConfig()` directly.
