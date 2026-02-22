---
name: devtools:auto-scroll
description: Auto-scroll system — useAutoScrollBottom hook, scroll-to-bottom button, StrictMode-safe patterns, and live-update scroll behavior. Use when working on scroll behavior in ChatHistory, the scroll button, or useAutoScrollBottom.
---

# Auto-Scroll System

## Files

| File | Role |
|------|------|
| `src/renderer/hooks/useAutoScrollBottom.ts` | Core hook — tracks position, scrolls on content change |
| `src/renderer/components/chat/ChatHistory.tsx` | Consumes hook, owns scroll container, renders button |

## `useAutoScrollBottom` API

```typescript
const { scrollToBottom, getIsAtBottom, checkIsAtBottom } = useAutoScrollBottom(
  [conversation],          // dependency array — fires when any dep changes
  {
    threshold: 300,        // px from bottom = "at bottom"
    autoBehavior: 'auto',  // 'auto' = instant, 'smooth' = animated
    disabled: shouldDisableAutoScroll,  // true during navigation
    externalRef: scrollContainerRef,    // share ref with navigation controller
    resetKey: effectiveTabId,           // resets isAtBottom=true on tab/session switch
  }
);
```

## Core Refs

| Ref | Purpose |
|-----|---------|
| `isAtBottomRef` | Whether container is currently near bottom |
| `wasAtBottomBeforeUpdateRef` | Captured before each render — gates auto-scroll |
| `needsInitialScrollRef` | Set by resetKey change; consumed by content effect to force first-load scroll |
| `disabledRef` | Mirrors `disabled` prop for RAF callbacks |
| `prevResetKeyRef` | Detects resetKey changes |

## Scroll Logic Flow

```
resetKey changes (new tab/session)
  → needsInitialScrollRef = true
  → isAtBottomRef = true
  → wasAtBottomBeforeUpdateRef = true

conversation dependency changes (content loaded or live update)
  → content effect fires
  → double RAF (DOM settle)
  → if needsInitialScrollRef OR wasAtBottomBeforeUpdateRef → scrollToBottom()
  → needsInitialScrollRef = false
```

## StrictMode Safety

React StrictMode double-invokes effects. **Never use ref-transition detection** (prev → current) inside effects for scroll triggers — the second invocation sees the already-updated ref and misses the transition.

**Safe pattern** (what we use):
- Set a **flag ref** (`needsInitialScrollRef`) in one effect
- **Consume + clear** the flag in another effect that has RAF cleanup
- RAF cleanup cancels the in-flight scroll before StrictMode's second invoke

**Broken pattern** (don't use):
```typescript
// WRONG — StrictMode breaks this
const prevLoadingRef = useRef(loading);
useEffect(() => {
  const wasLoading = prevLoadingRef.current;
  prevLoadingRef.current = loading;
  if (wasLoading && !loading) scrollToBottom(); // fires on 1st invoke, prevRef already updated on 2nd
}, [loading]);
```

## Why Session-Open Scroll Is Hard

When a new session loads, `fetchSessionDetail` does two `set()` calls:
1. Global `conversation + conversationLoading: false` → `td?.conversationLoading` still `true` (per-tab not updated yet) → ChatHistory still shows loading, scroll container not in DOM
2. Per-tab `conversation + conversationLoading: false` → ChatHistory renders content

`conversation` reference changes in step 1 (before scroll container exists), so the content effect fires before the DOM is ready. By step 2, `conversation` hasn't changed again → effect doesn't re-fire. The `needsInitialScrollRef` flag survives this because it's set by `resetKey` change (before any of this), and the content effect retries via RAF.

## Scroll-to-Bottom Button

Location: `ChatHistory.tsx` — absolute positioned, bottom-right of the chat area.

```typescript
const [showScrollButton, setShowScrollButton] = useState(false);

const checkScrollButton = useCallback(() => {
  const { scrollTop, scrollHeight, clientHeight } = container;
  setShowScrollButton(!isNearBottom(scrollTop, scrollHeight, clientHeight, 300));
}, []);
```

- Triggered by: `onScroll` on scroll container + `useEffect([conversation])`
- Hides when: user scrolls to bottom OR button is clicked
- Shifts left when context panel is open: `right: isContextPanelVisible ? 'calc(320px + 1rem)' : '1rem'`
- On click: `scrollToBottom('smooth')` + `setShowScrollButton(false)`

## Live-Update Auto-Scroll

`refreshSessionInPlace` creates a new `conversation` reference → content effect fires → if `wasAtBottomBeforeUpdateRef = true` (user was at bottom before update), auto-scroll follows. If user scrolled up, `wasAtBottomBeforeUpdateRef = false` → no auto-scroll, button appears instead.

## `isNearBottom` (exported from hook)

```typescript
isNearBottom(scrollTop, scrollHeight, clientHeight, threshold: 300)
// returns true if (scrollHeight - scrollTop - clientHeight) <= threshold
```
