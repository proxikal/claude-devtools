# Phase 2: Service Infrastructure - Research

**Researched:** 2026-02-12
**Domain:** Service lifecycle management, multi-context architecture, IPC routing
**Confidence:** HIGH

## Summary

Phase 2 establishes the infrastructure for managing multiple independent service contexts (local + N SSH connections) with proper lifecycle management, cleanup, and IPC routing. The core challenge is transforming a single-mode application into a multi-context system where the local context is always alive and each SSH connection gets its own isolated service instances.

**Key insight:** The codebase already has all the building blocks needed — FileSystemProvider abstraction (Phase 1), EventEmitter-based services with cleanup paths, and module-level IPC handler references that support re-initialization. The registry pattern will coordinate these existing pieces rather than introducing fundamentally new mechanisms.

**Primary recommendation:** Build ServiceContextRegistry as a Map-based coordinator that creates/destroys service bundles, route IPC requests using context ID stamping, and implement bulletproof dispose() methods on all EventEmitter-based services.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js EventEmitter | Built-in | Event-driven service communication | Already used by FileWatcher, NotificationManager, SshConnectionManager |
| Map | Built-in | Context registry storage | Fast O(1) lookups, iteration support, built-in size tracking |
| Electron IPC (ipcMain/ipcRenderer) | 28.x | Process communication | Existing IPC infrastructure |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ssh2 | Current (Phase 1) | SSH connections | Already integrated for SFTP |
| fs.FSWatcher | Built-in | File watching | Already used in FileWatcher service |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Map | WeakMap | Would enable GC of contexts, but need explicit lifecycle control for cleanup |
| IPC context stamping | Separate IPC channels per context | Would explode channel count (5-10 channels × N contexts), harder to manage |
| Module-level service refs | Dependency injection container | More complex, unnecessary when re-initialization pattern already works |

**Installation:**
No new dependencies required — using existing stack.

## Architecture Patterns

### Recommended Project Structure
```
src/main/
├── services/
│   ├── infrastructure/
│   │   ├── ServiceContext.ts          # NEW: Context bundle class
│   │   ├── ServiceContextRegistry.ts  # NEW: Registry coordinator
│   │   └── [existing services...]     # MODIFY: Add dispose() methods
│   └── [domain services...]
├── ipc/
│   ├── handlers.ts                    # MODIFY: Add context routing
│   ├── context.ts                     # NEW: Context management IPC
│   └── [domain handlers...]           # MODIFY: Route via context ID
└── index.ts                           # MODIFY: Use registry instead of globals
```

### Pattern 1: Service Context Bundle
**What:** A ServiceContext class encapsulates all service instances for a single context (local or SSH).
**When to use:** For each workspace context that needs independent service lifecycle.

**Example:**
```typescript
// Source: Based on existing service initialization in src/main/index.ts (lines 78-92)
export interface ServiceContextConfig {
  id: string;
  type: 'local' | 'ssh';
  fsProvider: FileSystemProvider;
  projectsDir?: string;
  todosDir?: string;
}

export class ServiceContext {
  readonly id: string;
  readonly type: 'local' | 'ssh';

  // Service instances
  readonly projectScanner: ProjectScanner;
  readonly sessionParser: SessionParser;
  readonly subagentResolver: SubagentResolver;
  readonly chunkBuilder: ChunkBuilder;
  readonly dataCache: DataCache;
  readonly fileWatcher: FileWatcher;

  constructor(config: ServiceContextConfig) {
    this.id = config.id;
    this.type = config.type;

    // Initialize services with provider
    this.projectScanner = new ProjectScanner(
      config.projectsDir,
      config.todosDir,
      config.fsProvider
    );
    this.sessionParser = new SessionParser(this.projectScanner);
    this.subagentResolver = new SubagentResolver(this.projectScanner);
    this.chunkBuilder = new ChunkBuilder();
    this.dataCache = new DataCache(MAX_CACHE_SESSIONS, CACHE_TTL_MINUTES);

    // FileWatcher with provider
    this.fileWatcher = new FileWatcher(
      this.dataCache,
      config.projectsDir,
      config.todosDir,
      config.fsProvider
    );
  }

  // Start active services
  start(): void {
    this.fileWatcher.start();
    this.dataCache.startAutoCleanup(CACHE_CLEANUP_INTERVAL_MINUTES);
  }

  // Critical: Proper cleanup
  dispose(): void {
    this.fileWatcher.stop();
    this.dataCache.clear();
    // FileSystemProvider cleanup handled by caller
  }
}
```

### Pattern 2: Registry with Active Context Tracking
**What:** ServiceContextRegistry manages Map of contexts and tracks which one is currently active.
**When to use:** Single registry instance in main process coordinates all context operations.

**Example:**
```typescript
// Source: Adapted from existing SshConnectionManager state management pattern
export class ServiceContextRegistry {
  private contexts = new Map<string, ServiceContext>();
  private activeContextId: string = 'local';

  constructor() {
    // Local context is always alive
    const localContext = this.createContext({
      id: 'local',
      type: 'local',
      fsProvider: new LocalFileSystemProvider(),
    });
    this.contexts.set('local', localContext);
    localContext.start();
  }

  getActive(): ServiceContext {
    const context = this.contexts.get(this.activeContextId);
    if (!context) {
      throw new Error(`Active context ${this.activeContextId} not found`);
    }
    return context;
  }

  switch(contextId: string): void {
    if (!this.contexts.has(contextId)) {
      throw new Error(`Context ${contextId} does not exist`);
    }
    this.activeContextId = contextId;
  }

  createSshContext(
    id: string,
    fsProvider: FileSystemProvider,
    projectsDir: string
  ): ServiceContext {
    if (this.contexts.has(id)) {
      throw new Error(`Context ${id} already exists`);
    }
    const context = this.createContext({
      id,
      type: 'ssh',
      fsProvider,
      projectsDir,
    });
    this.contexts.set(id, context);
    context.start();
    return context;
  }

  destroy(contextId: string): void {
    if (contextId === 'local') {
      throw new Error('Cannot destroy local context');
    }
    const context = this.contexts.get(contextId);
    if (context) {
      context.dispose();
      this.contexts.delete(contextId);
    }
  }

  private createContext(config: ServiceContextConfig): ServiceContext {
    return new ServiceContext(config);
  }
}
```

### Pattern 3: IPC Context Routing
**What:** IPC handlers read context ID from event args and route to correct service context.
**When to use:** All session-data IPC handlers (projects, sessions, search, subagents).

**Example:**
```typescript
// Source: Based on existing IPC handler pattern in src/main/ipc/sessions.ts
let contextRegistry: ServiceContextRegistry;

export function initializeContextHandlers(registry: ServiceContextRegistry): void {
  contextRegistry = registry;
}

// Modified handler with context routing
ipcMain.handle('get-projects', async (event, contextId?: string) => {
  const context = contextId
    ? contextRegistry.get(contextId)
    : contextRegistry.getActive();

  if (!context) {
    return [];
  }

  return context.projectScanner.scan();
});
```

### Pattern 4: EventEmitter Dispose Pattern
**What:** Services extending EventEmitter must remove all listeners and clear resources in dispose().
**When to use:** FileWatcher, NotificationManager, and any EventEmitter-based service.

**Example:**
```typescript
// Source: Best practices from Node.js EventEmitter cleanup research
export class FileWatcher extends EventEmitter {
  private projectsWatcher: fs.FSWatcher | null = null;
  private todosWatcher: fs.FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private catchUpTimer: NodeJS.Timeout | null = null;
  private pollingTimer: NodeJS.Timeout | null = null;

  dispose(): void {
    // Stop watchers first
    this.stop();

    // Clear all timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.catchUpTimer) {
      clearInterval(this.catchUpTimer);
      this.catchUpTimer = null;
    }

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    // CRITICAL: Remove ALL listeners to prevent memory leaks
    this.removeAllListeners();

    // Clear tracking state
    this.lastProcessedLineCount.clear();
    this.lastProcessedSize.clear();
    this.activeSessionFiles.clear();
    this.processingInProgress.clear();
    this.pendingReprocess.clear();
  }
}
```

### Anti-Patterns to Avoid

- **Global service instances:** Don't keep services as global module variables when using registry — use registry.getActive() instead
- **Async dispose:** Keep dispose() synchronous — cleanup should be immediate and deterministic
- **Partial cleanup:** Missing even one timer or listener causes memory leaks — use comprehensive checklists
- **Shared caches across contexts:** Each context must have its own DataCache instance to prevent cross-contamination

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Service lifecycle management | Custom dependency injection container | Map-based registry with explicit create/dispose | DI containers add complexity; explicit lifecycle is easier to debug |
| IPC routing | Separate channels per context | Context ID stamping on existing channels | Channel explosion (N contexts × M channels); harder to manage |
| Event cleanup | Manual tracking of each listener | removeAllListeners() in dispose() | Guaranteed cleanup; prevents missed listeners |
| Context switching race conditions | Custom mutex/lock | Node.js single-threaded execution + synchronous switch | IPC handlers run sequentially; no parallelism within main process |

**Key insight:** The main process is single-threaded, so context switching is naturally serialized. No need for complex synchronization primitives.

## Common Pitfalls

### Pitfall 1: Memory Leaks from Orphaned EventEmitter Listeners
**What goes wrong:** Services extend EventEmitter but don't call removeAllListeners() in dispose(), causing listeners to persist after context destruction.

**Why it happens:** EventEmitter automatically manages a listeners array, but it never auto-clears. Each listener closure captures references to the service instance and any data it touches.

**How to avoid:**
- Add dispose() method to ALL services extending EventEmitter
- Call removeAllListeners() at the END of dispose() (after stopping watchers/timers)
- Test disposal by creating/destroying context 100+ times and monitoring memory

**Warning signs:**
- MaxListenersExceededWarning after multiple context switches
- Memory usage climbs 50-100MB per switch without leveling off
- DevTools heap snapshot shows growing EventEmitter listener arrays

**Example fix:**
```typescript
// Source: Verified pattern from FileWatcher.ts stop() method
dispose(): void {
  // 1. Stop active operations
  if (this.projectsWatcher) {
    this.projectsWatcher.close();
    this.projectsWatcher = null;
  }

  // 2. Clear timers/intervals
  if (this.retryTimer) {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // 3. Clear data structures
  this.debounceTimers.clear();
  this.lastProcessedLineCount.clear();

  // 4. CRITICAL: Remove ALL listeners LAST
  this.removeAllListeners();
}
```

### Pitfall 2: File Watcher Cross-Context Pollution
**What goes wrong:** FileWatcher in background SSH context emits events that trigger IPC sends for wrong context, causing UI to show stale data.

**Why it happens:** FileWatcher.on('file-change') forwards to renderer via mainWindow.webContents.send(). If watcher stays alive in background context, it keeps emitting for inactive context.

**How to avoid:**
- Option A: Only start FileWatcher for active context, stop on switch
- Option B: Scope events with contextId, filter in renderer
- **Recommended:** Option A — simpler, no renderer filtering needed

**Warning signs:**
- Switching from SSH to local shows SSH file change notifications
- Project list updates with data from inactive context
- Cache invalidation affects wrong context

**Implementation:**
```typescript
// In ServiceContextRegistry.switch()
switch(newContextId: string): void {
  const oldContext = this.getActive();

  // Stop file watcher in old context
  oldContext.fileWatcher.stop();

  // Switch active
  this.activeContextId = newContextId;
  const newContext = this.getActive();

  // Start file watcher in new context
  newContext.fileWatcher.start();
}
```

### Pitfall 3: IPC Handler Re-initialization Timing
**What goes wrong:** Switching contexts before re-initializing IPC handlers causes next IPC call to use old service instances from previous context.

**Why it happens:** Module-level variables in ipc/sessions.ts etc. hold service references. Calling registry.switch() doesn't update those refs until reinitializeServiceHandlers() is called.

**How to avoid:**
- Always call reinitializeServiceHandlers() IMMEDIATELY after registry.switch()
- Make switch() method handle re-init internally, don't rely on caller
- Verify with integration test: switch context, call IPC, check which projectsDir was scanned

**Warning signs:**
- Switching to SSH shows local projects for first query
- Race condition where sometimes switch works, sometimes shows stale data
- Logs show scans hitting wrong directory path

**Implementation:**
```typescript
// In ServiceContextRegistry
switch(newContextId: string): void {
  this.activeContextId = newContextId;
  const newContext = this.getActive();

  // CRITICAL: Re-init IPC handlers with new context's services
  reinitializeServiceHandlers(
    newContext.projectScanner,
    newContext.sessionParser,
    newContext.subagentResolver,
    newContext.chunkBuilder,
    newContext.dataCache
  );
}
```

### Pitfall 4: SSH Connection Manager Lifecycle Confusion
**What goes wrong:** SshConnectionManager owns the SSH client and SftpWrapper, but ServiceContext also needs to dispose its SshFileSystemProvider. Double-dispose or leaked connections result.

**Why it happens:** Ownership unclear — does SshConnectionManager own the connection, or does ServiceContext?

**How to avoid:**
- **SshConnectionManager owns:** Client, SFTP channel, SshFileSystemProvider instance
- **ServiceContext receives:** Pre-created FileSystemProvider (interface, not lifecycle)
- **On context destroy:** ServiceContext calls fsProvider.dispose() to end SFTP, SshConnectionManager tracks this and cleans up Client
- **Clean separation:** Context disposal -> provider disposal -> connection manager cleanup chain

**Warning signs:**
- SFTP channel stays open after context destroy
- Multiple SFTP channels open for same SSH connection
- "Channel already closed" errors on reconnect

**Implementation:**
```typescript
// ServiceContext.dispose()
dispose(): void {
  this.fileWatcher.stop();
  this.dataCache.clear();

  // Dispose FileSystemProvider (closes SFTP if SSH)
  if (this.fsProvider.type === 'ssh') {
    this.fsProvider.dispose();
  }
}

// SshConnectionManager watches for provider disposal
connect(config: SshConnectionConfig): Promise<void> {
  // Create SFTP
  const sftp = await this.openSftp();
  const provider = new SshFileSystemProvider(sftp);

  // Track this provider
  this.activeProviders.add(provider);

  return provider;
}

// When provider.dispose() is called, it ends SFTP
// Connection manager can detect and clean up client
```

## Code Examples

Verified patterns from existing codebase and research:

### Service Bundle Creation
```typescript
// Source: Adapted from src/main/index.ts initializeServices() pattern
export class ServiceContext {
  constructor(config: ServiceContextConfig) {
    this.id = config.id;
    this.type = config.type;

    // Chain dependencies: ProjectScanner -> SessionParser/SubagentResolver
    this.projectScanner = new ProjectScanner(
      config.projectsDir,
      config.todosDir,
      config.fsProvider
    );
    this.sessionParser = new SessionParser(this.projectScanner);
    this.subagentResolver = new SubagentResolver(this.projectScanner);
    this.chunkBuilder = new ChunkBuilder();

    // Isolated cache per context
    this.dataCache = new DataCache(
      MAX_CACHE_SESSIONS,
      CACHE_TTL_MINUTES,
      true // enabled
    );

    // FileWatcher with context-specific provider
    this.fileWatcher = new FileWatcher(
      this.dataCache,
      config.projectsDir,
      config.todosDir,
      config.fsProvider
    );
  }
}
```

### Registry Initialization in Main Process
```typescript
// Source: New pattern replacing src/main/index.ts service initialization
let contextRegistry: ServiceContextRegistry;

function initializeServices(): void {
  logger.info('Initializing service context registry...');

  // Registry creates local context internally
  contextRegistry = new ServiceContextRegistry();

  // Initialize IPC with registry
  initializeIpcHandlers(contextRegistry, sshConnectionManager);

  logger.info('Service context registry initialized');
}
```

### IPC Handler with Context Routing
```typescript
// Source: Pattern for src/main/ipc/sessions.ts modification
let registry: ServiceContextRegistry;

export function initializeSessionHandlers(reg: ServiceContextRegistry): void {
  registry = reg;
}

export function registerSessionHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get-session-detail', async (event, projectId, sessionId, contextId?) => {
    try {
      const context = contextId ? registry.get(contextId) : registry.getActive();
      if (!context) {
        return null;
      }

      const sessionPath = context.projectScanner.getSessionPath(projectId, sessionId);
      const messages = await parseJsonlFile(
        sessionPath,
        context.projectScanner.getFileSystemProvider()
      );

      // ... rest of handler using context services
    } catch (error) {
      logger.error('Error getting session detail:', error);
      return null;
    }
  });
}
```

### Context Creation Flow
```typescript
// Source: Integration of SshConnectionManager with ServiceContextRegistry
async function handleSshConnect(config: SshConnectionConfig): Promise<string> {
  // 1. Connect SSH (creates provider)
  await sshConnectionManager.connect(config);
  const provider = sshConnectionManager.getProvider();
  const projectsPath = sshConnectionManager.getRemoteProjectsPath();

  // 2. Create context with SSH provider
  const contextId = `ssh-${config.host}`;
  const context = contextRegistry.createSshContext(
    contextId,
    provider,
    projectsPath
  );

  // 3. Switch to new context
  contextRegistry.switch(contextId);

  // 4. Notify renderer
  if (mainWindow) {
    mainWindow.webContents.send('context-changed', contextId);
  }

  return contextId;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global service instances in main/index.ts | ServiceContext bundles in registry | Phase 2 (this phase) | Enables multiple contexts, proper isolation |
| Mode switching destroys/recreates all services | Local context always alive, SSH contexts independent | Phase 2 | Local data never lost, faster switching |
| Single FileSystemProvider swapped on mode change | Provider per context, passed to services at creation | Phase 1 (completed) | Foundation for multi-context |
| IPC handlers hold direct service refs | IPC handlers route via contextId to registry | Phase 2 | Enables context-aware routing |
| FileWatcher events global | FileWatcher scoped to active context | Phase 2 | Prevents cross-context pollution |

**Deprecated/outdated:**
- **handleModeSwitch callback in main/index.ts:** Will be replaced by registry.switch() method
- **Global projectScanner/sessionParser variables:** Will be replaced by registry.getActive().projectScanner
- **reinitializeServiceHandlers() called manually:** Will be called automatically by registry.switch()

## Open Questions

1. **Should inactive SSH contexts keep FileWatcher running?**
   - What we know: FileWatcher can run in background (SSH polling mode exists)
   - What's unclear: Performance impact of N watchers polling simultaneously
   - Recommendation: Start with "only active context watches" approach (simpler), measure performance, add background watching if users request it

2. **How to handle context switching during active IPC request?**
   - What we know: Node.js event loop serializes IPC handlers
   - What's unclear: Can registry.switch() be called mid-request?
   - Recommendation: Make switch() synchronous and immediate — in-flight requests complete with old context, next request uses new context. Document this behavior.

3. **Should DataCache be shared across contexts or isolated?**
   - What we know: Each SessionDetail is context-specific (local vs SSH paths differ)
   - What's unclear: Could shared cache with composite keys work?
   - Recommendation: Isolate caches — simpler, avoids key collision risks, allows per-context TTL tuning

4. **How to persist context metadata across app restarts?**
   - What we know: Need to restore SSH contexts on app restart
   - What's unclear: Where to persist (ConfigManager? Separate state file?)
   - Recommendation: Add sshContexts array to ConfigManager schema, store connection profiles + last active context ID

## Sources

### Primary (HIGH confidence)
- Codebase analysis: src/main/index.ts, src/main/services/infrastructure/FileWatcher.ts, src/main/ipc/handlers.ts
- FileSystemProvider abstraction (Phase 1): src/main/services/infrastructure/FileSystemProvider.ts
- Existing EventEmitter usage: FileWatcher, NotificationManager, SshConnectionManager

### Secondary (MEDIUM confidence)
- [Process Model | Electron](https://www.electronjs.org/docs/latest/tutorial/process-model) — Electron main process lifecycle
- [Inter-Process Communication | Electron](https://www.electronjs.org/docs/latest/tutorial/ipc) — IPC patterns and channel management
- [How to fix possible EventEmitter memory leak detected](https://cri.dev/posts/2020-07-16-How-to-fix-possible-EventEmitter-memory-leak-detected/) — EventEmitter cleanup patterns
- [Dependency injection in ASP.NET Core | Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) — Service lifetime and disposal patterns
- [Scaling 1M lines of TypeScript: Registries](https://puzzles.slash.com/blog/scaling-1m-lines-of-typescript-registries) — Registry pattern for large codebases

### Tertiary (LOW confidence)
- [Advanced Electron.js architecture - LogRocket Blog](https://blog.logrocket.com/advanced-electron-js-architecture/) — General Electron architecture patterns
- [How to Profile Node.js Applications for Memory Leaks](https://oneuptime.com/blog/post/2026-01-26-nodejs-memory-leak-profiling/view) — Memory leak detection techniques

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components already in codebase (EventEmitter, Map, IPC)
- Architecture: HIGH - Patterns verified against existing services and IPC handlers
- Pitfalls: HIGH - Identified from EventEmitter research + codebase analysis of FileWatcher/SshConnectionManager

**Research date:** 2026-02-12
**Valid until:** 60 days (2026-04-12) — stable domain, established patterns
