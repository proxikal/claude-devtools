/**
 * Notification slice unit tests.
 * Tests navigateToError behavior for sidebar session highlighting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI, type MockElectronAPI } from '../../mocks/electronAPI';

import { createTestStore, type TestStore } from './storeTestUtils';

import type { DetectedError } from '../../../src/renderer/types/data';

describe('notificationSlice', () => {
  let store: TestStore;
  let mockAPI: MockElectronAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAPI = installMockElectronAPI();
    store = createTestStore();

    // Mock crypto.randomUUID for predictable tab IDs
    let uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('notification mutation fallbacks', () => {
    it('re-fetches notifications when markRead returns false', async () => {
      store.setState({
        notifications: [
          {
            id: 'n1',
            message: 'msg',
            isRead: false,
          },
        ] as never[],
      });

      mockAPI.notifications.markRead.mockResolvedValue(false);
      mockAPI.notifications.get.mockResolvedValue({
        notifications: [{ id: 'n1', message: 'msg', isRead: false }],
      });

      await store.getState().markNotificationRead('n1');

      expect(mockAPI.notifications.get).toHaveBeenCalled();
    });

    it('re-fetches notifications when clear returns false', async () => {
      store.setState({
        notifications: [{ id: 'n1', message: 'msg', isRead: true }] as never[],
      });

      mockAPI.notifications.clear.mockResolvedValue(false);
      mockAPI.notifications.get.mockResolvedValue({
        notifications: [{ id: 'n1', message: 'msg', isRead: true }],
      });

      await store.getState().clearNotifications();

      expect(mockAPI.notifications.get).toHaveBeenCalled();
    });
  });

  describe('navigateToError', () => {
    const createMockError = (overrides?: Partial<DetectedError>): DetectedError => ({
      id: 'error-1',
      sessionId: 'session-target',
      projectId: 'project-1',
      lineNumber: 42,
      timestamp: Date.now(),
      toolUseId: 'tool-1',
      triggerName: 'test-trigger',
      severity: 'error',
      message: 'Test error message',
      isRead: false,
      ...overrides,
    });

    describe('flat mode (viewMode !== grouped)', () => {
      beforeEach(() => {
        store.setState({
          viewMode: 'flat',
          projects: [
            {
              id: 'project-1',
              name: 'Project 1',
              path: '/path/1',
              sessions: ['session-1', 'session-target'],
            },
          ] as never[],
        });

        mockAPI.getSessionsPaginated.mockResolvedValue({
          sessions: [{ id: 'session-1' }] as never[],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        });

        mockAPI.getSessionDetail.mockResolvedValue({
          session: { id: 'session-target' },
          chunks: [],
        } as never);
      });

      it('should set selectedSessionId when navigating to error', () => {
        const error = createMockError();

        store.getState().navigateToError(error);

        // selectedSessionId should be set to the target session
        expect(store.getState().selectedSessionId).toBe('session-target');
      });

      it('should create new tab with correct sessionId and pendingNavigation', () => {
        const error = createMockError();

        store.getState().navigateToError(error);

        expect(store.getState().openTabs).toHaveLength(1);
        expect(store.getState().openTabs[0].sessionId).toBe('session-target');
        expect(store.getState().openTabs[0].projectId).toBe('project-1');
        expect(store.getState().openTabs[0].pendingNavigation?.kind).toBe('error');
      });

      it('should set selectedSessionId even when switching from different project', () => {
        // Start with a different project selected
        store.setState({
          selectedProjectId: 'project-other',
          selectedSessionId: 'session-other',
        });

        const error = createMockError();

        store.getState().navigateToError(error);

        // Should update to target session
        expect(store.getState().selectedSessionId).toBe('session-target');
        expect(store.getState().selectedProjectId).toBe('project-1');
      });

      it('should not highlight wrong session from previous tab state', () => {
        // Setup: Have an old session selected
        store.setState({
          selectedProjectId: 'project-1',
          selectedSessionId: 'session-old',
        });

        const error = createMockError();

        store.getState().navigateToError(error);

        // Should NOT retain old session, should be updated to target
        expect(store.getState().selectedSessionId).not.toBe('session-old');
        expect(store.getState().selectedSessionId).toBe('session-target');
      });
    });

    describe('grouped mode (viewMode === grouped)', () => {
      beforeEach(() => {
        store.setState({
          viewMode: 'grouped',
          repositoryGroups: [
            {
              id: 'repo-1',
              name: 'Repo 1',
              worktrees: [
                {
                  id: 'project-1',
                  name: 'Worktree 1',
                  path: '/path/1',
                  sessions: ['session-1', 'session-target'],
                },
              ],
            },
          ] as never[],
        });

        mockAPI.getSessionsPaginated.mockResolvedValue({
          sessions: [{ id: 'session-1' }] as never[],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        });

        mockAPI.getSessionDetail.mockResolvedValue({
          session: { id: 'session-target' },
          chunks: [],
        } as never);
      });

      it('should set selectedSessionId when navigating to error in grouped mode', () => {
        const error = createMockError();

        store.getState().navigateToError(error);

        // selectedSessionId should be set to the target session
        expect(store.getState().selectedSessionId).toBe('session-target');
      });

      it('should set repository and worktree selection', () => {
        const error = createMockError();

        store.getState().navigateToError(error);

        expect(store.getState().selectedRepositoryId).toBe('repo-1');
        expect(store.getState().selectedWorktreeId).toBe('project-1');
      });

      it('should not highlight wrong session from previous state in grouped mode', () => {
        // Setup: Have an old session selected
        store.setState({
          selectedRepositoryId: 'repo-1',
          selectedWorktreeId: 'project-1',
          selectedSessionId: 'session-old',
        });

        const error = createMockError();

        store.getState().navigateToError(error);

        // Should NOT retain old session
        expect(store.getState().selectedSessionId).not.toBe('session-old');
        expect(store.getState().selectedSessionId).toBe('session-target');
      });
    });

    describe('existing tab behavior', () => {
      it('should focus existing tab if session is already open', () => {
        // Open target session tab first
        store.getState().openTab({
          type: 'session',
          sessionId: 'session-target',
          projectId: 'project-1',
          label: 'Target Session',
        });
        const existingTabId = store.getState().activeTabId;

        // Open another tab
        store.getState().openDashboard();

        const error = createMockError();

        store.getState().navigateToError(error);

        // Should focus existing tab, not create new
        expect(store.getState().openTabs).toHaveLength(2);
        expect(store.getState().activeTabId).toBe(existingTabId);
      });

      it('should enqueue error navigation request on existing tab', () => {
        // Open target session tab first
        store.getState().openTab({
          type: 'session',
          sessionId: 'session-target',
          projectId: 'project-1',
          label: 'Target Session',
        });

        const error = createMockError({
          lineNumber: 100,
        });

        store.getState().navigateToError(error);

        const tab = store.getState().openTabs[0];
        expect(tab.pendingNavigation).toBeDefined();
        expect(tab.pendingNavigation?.kind).toBe('error');
        expect(tab.pendingNavigation?.highlight).toBe('red');
        expect(tab.pendingNavigation?.payload).toMatchObject({
          errorId: 'error-1',
          lineNumber: 100,
          toolUseId: 'tool-1',
        });
      });

      it('should create new nonce on repeated clicks', () => {
        store.getState().openTab({
          type: 'session',
          sessionId: 'session-target',
          projectId: 'project-1',
          label: 'Target Session',
        });

        const error = createMockError();

        store.getState().navigateToError(error);
        const firstId = store.getState().openTabs[0].pendingNavigation?.id;

        store.getState().navigateToError(error);
        const secondId = store.getState().openTabs[0].pendingNavigation?.id;

        expect(firstId).toBeDefined();
        expect(secondId).toBeDefined();
        expect(firstId).not.toBe(secondId);
      });
    });

    describe('sidebar highlighting with pagination', () => {
      /**
       * Test scenario: Session exists but is not in the first page (pagination).
       *
       * The sidebar only renders sessions that are in the `sessions` array.
       * If selectedSessionId is set to a session not in the loaded list,
       * nothing will be highlighted (correct behavior).
       *
       * The fix ensures selectedSessionId is always set to the target session,
       * rather than retaining a stale value that might match a loaded session.
       */
      it('should set selectedSessionId to target even if not in loaded sessions list', () => {
        store.setState({
          viewMode: 'flat',
          projects: [
            {
              id: 'project-1',
              name: 'Project 1',
              path: '/path/1',
              sessions: ['session-1', 'session-target'],
            },
          ] as never[],
          // Simulating: first page loaded, target session not included
          sessions: [{ id: 'session-1', createdAt: '2024-01-15' }] as never[],
        });

        mockAPI.getSessionsPaginated.mockResolvedValue({
          sessions: [{ id: 'session-1' }] as never[],
          nextCursor: 'cursor-1',
          hasMore: true,
          totalCount: 100,
        });

        mockAPI.getSessionDetail.mockResolvedValue({
          session: { id: 'session-target' },
          chunks: [],
        } as never);

        const error = createMockError();

        store.getState().navigateToError(error);

        // selectedSessionId should be set to target, even if not in loaded sessions
        expect(store.getState().selectedSessionId).toBe('session-target');

        // Verify the session is NOT in the current loaded list (simulating pagination)
        const loadedSessionIds = store.getState().sessions.map((s) => s.id);
        expect(loadedSessionIds).not.toContain('session-target');

        // Sidebar behavior: isActive = selectedSessionId === item.session.id
        // Since 'session-target' is not in sessions array, it won't be rendered
        // and therefore won't be highlighted. Only 'session-1' is rendered,
        // but selectedSessionId doesn't match it, so nothing is highlighted.
        // This is the correct behavior.
      });

      it('should correctly highlight when target session IS in loaded list', async () => {
        store.setState({
          viewMode: 'flat',
          projects: [
            {
              id: 'project-1',
              name: 'Project 1',
              path: '/path/1',
              sessions: ['session-1', 'session-target'],
            },
          ] as never[],
        });

        mockAPI.getSessionsPaginated.mockResolvedValue({
          sessions: [{ id: 'session-1' }, { id: 'session-target' }] as never[],
          nextCursor: null,
          hasMore: false,
          totalCount: 2,
        });

        mockAPI.getSessionDetail.mockResolvedValue({
          session: { id: 'session-target' },
          chunks: [],
        } as never);

        const error = createMockError();

        store.getState().navigateToError(error);

        // selectedSessionId should match target immediately
        expect(store.getState().selectedSessionId).toBe('session-target');

        // Wait for async fetch to complete
        await vi.runAllTimersAsync();

        // Verify the session IS in the loaded list after fetch
        const loadedSessionIds = store.getState().sessions.map((s) => s.id);
        expect(loadedSessionIds).toContain('session-target');

        // Sidebar behavior: isActive = selectedSessionId === item.session.id
        // Since 'session-target' is in sessions array and selectedSessionId matches,
        // it will be highlighted correctly.
      });

      it('should not highlight unrelated session when target is not loaded', () => {
        store.setState({
          viewMode: 'flat',
          projects: [
            {
              id: 'project-1',
              name: 'Project 1',
              path: '/path/1',
              sessions: ['session-1', 'session-target'],
            },
          ] as never[],
          // Only session-1 is loaded, and it was previously selected
          sessions: [{ id: 'session-1', createdAt: '2024-01-15' }] as never[],
          selectedSessionId: 'session-1', // Previous selection that might cause wrong highlight
        });

        mockAPI.getSessionsPaginated.mockResolvedValue({
          sessions: [{ id: 'session-1' }] as never[],
          nextCursor: 'cursor-1',
          hasMore: true,
          totalCount: 100,
        });

        mockAPI.getSessionDetail.mockResolvedValue({
          session: { id: 'session-target' },
          chunks: [],
        } as never);

        const error = createMockError();

        // Before fix: selectedSessionId would remain 'session-1' (from selectProject reset)
        // causing session-1 to be highlighted incorrectly

        store.getState().navigateToError(error);

        // After fix: selectedSessionId is updated to 'session-target'
        expect(store.getState().selectedSessionId).toBe('session-target');
        // Since 'session-target' is not in sessions array, nothing will be highlighted
        // (session-1 is in the array but doesn't match selectedSessionId anymore)
      });
    });
  });
});
