/**
 * Tests for agent session discovery functions (Claude and Codex).
 *
 * These tests verify:
 * - Batched parallel directory scanning for Claude sessions
 * - Flattened parallel scanning for Codex sessions
 * - 30-second TTL discovery cache behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain, BrowserWindow } from 'electron';
import {
	registerAgentSessionsHandlers,
	invalidateDiscoveryCache,
} from '../../../../main/ipc/handlers/agentSessions';

// Mock electron
vi.mock('electron', () => ({
	ipcMain: {
		handle: vi.fn(),
		removeHandler: vi.fn(),
	},
	BrowserWindow: vi.fn(),
}));

// Mock the agents module
vi.mock('../../../../main/agents', () => ({
	getSessionStorage: vi.fn(),
	hasSessionStorage: vi.fn(),
	getAllSessionStorages: vi.fn().mockReturnValue([]),
}));

// Mock the logger
vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// Mock IPC error handler to pass through
vi.mock('../../../../main/utils/ipcHandler', () => ({
	withIpcErrorLogging: (_opts: unknown, handler: Function) => {
		return (_event: unknown, ...args: unknown[]) => handler(...args);
	},
}));

// Mock safe-send
vi.mock('../../../../main/utils/safe-send', () => ({
	isWebContentsAvailable: vi.fn().mockReturnValue(false),
}));

// Mock pricing
vi.mock('../../../../main/utils/pricing', () => ({
	calculateClaudeCost: vi.fn().mockReturnValue(0),
}));

// Mock stats cache
vi.mock('../../../../main/utils/statsCache', () => ({
	loadGlobalStatsCache: vi.fn().mockResolvedValue(null),
	saveGlobalStatsCache: vi.fn().mockResolvedValue(undefined),
	GLOBAL_STATS_CACHE_VERSION: 1,
}));

// Mock os
vi.mock('os', () => ({
	default: {
		homedir: vi.fn().mockReturnValue('/home/testuser'),
	},
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
	default: {
		access: vi.fn(),
		readdir: vi.fn(),
		stat: vi.fn(),
		readFile: vi.fn(),
	},
}));

// Import fs after mock declaration so we get the mocked version
import fs from 'fs/promises';
// Use 'any' for mock references to avoid TS PathLike type mismatches in test implementations
const mockAccess = fs.access as any;
const mockReaddir = fs.readdir as any;
const mockStat = fs.stat as any;
const mockReadFile = fs.readFile as any;

describe('Agent Session Discovery', () => {
	let handlers: Map<string, Function>;

	beforeEach(() => {
		vi.clearAllMocks();
		invalidateDiscoveryCache();

		handlers = new Map();
		vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
			handlers.set(channel, handler);
		});

		registerAgentSessionsHandlers({
			getMainWindow: () => null,
		});
	});

	afterEach(() => {
		handlers.clear();
	});

	describe('discoverClaudeSessionFiles (via getGlobalStats)', () => {
		it('should discover Claude session files with batched parallelism', async () => {
			// Set up filesystem mock:
			// ~/.claude/projects/ has 3 project dirs, each with session files
			// access succeeds for Claude, fails for Codex
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.claude/projects') {
					return ['project-a', 'project-b', 'project-c'];
				}
				if (dir === '/home/testuser/.claude/projects/project-a') {
					return ['session1.jsonl', 'session2.jsonl'];
				}
				if (dir === '/home/testuser/.claude/projects/project-b') {
					return ['session3.jsonl'];
				}
				if (dir === '/home/testuser/.claude/projects/project-c') {
					return ['session4.jsonl', 'empty.jsonl', 'not-jsonl.txt'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				// Project directories
				if (fp.endsWith('project-a') || fp.endsWith('project-b') || fp.endsWith('project-c')) {
					return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				}
				// Session files
				if (fp.endsWith('session1.jsonl'))
					return { isDirectory: () => false, size: 500, mtimeMs: 1001 };
				if (fp.endsWith('session2.jsonl'))
					return { isDirectory: () => false, size: 300, mtimeMs: 1002 };
				if (fp.endsWith('session3.jsonl'))
					return { isDirectory: () => false, size: 700, mtimeMs: 1003 };
				if (fp.endsWith('session4.jsonl'))
					return { isDirectory: () => false, size: 200, mtimeMs: 1004 };
				if (fp.endsWith('empty.jsonl')) return { isDirectory: () => false, size: 0, mtimeMs: 1005 };
				throw new Error('ENOENT');
			});

			// Mock readFile for session content parsing
			mockReadFile.mockResolvedValue(
				'{"type":"user","content":"hello"}\n{"type":"assistant","content":"hi"}\n'
			);

			const handler = handlers.get('agentSessions:getGlobalStats');
			const result = await handler!({} as any);

			// Should have discovered 4 non-empty Claude session files
			// (session1, session2, session3, session4; empty.jsonl and not-jsonl.txt excluded)
			expect(result.byProvider['claude-code']).toBeDefined();
			expect(result.byProvider['claude-code'].sessions).toBe(4);
		});

		it('should skip 0-byte session files', async () => {
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.claude/projects') {
					return ['project-x'];
				}
				if (dir === '/home/testuser/.claude/projects/project-x') {
					return ['empty.jsonl', 'valid.jsonl'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				if (fp.endsWith('project-x')) return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				if (fp.endsWith('empty.jsonl')) return { isDirectory: () => false, size: 0, mtimeMs: 1001 };
				if (fp.endsWith('valid.jsonl'))
					return { isDirectory: () => false, size: 100, mtimeMs: 1002 };
				throw new Error('ENOENT');
			});

			mockReadFile.mockResolvedValue('{"type":"user","content":"hello"}\n');

			const handler = handlers.get('agentSessions:getGlobalStats');
			const result = await handler!({} as any);

			// Only the valid (non-empty) file should be counted
			expect(result.byProvider['claude-code'].sessions).toBe(1);
		});

		it('should handle inaccessible project directories gracefully', async () => {
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.claude/projects') {
					return ['good-project', 'bad-project'];
				}
				if (dir === '/home/testuser/.claude/projects/good-project') {
					return ['session.jsonl'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				if (fp.endsWith('good-project')) return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				if (fp.endsWith('bad-project')) throw new Error('EACCES');
				if (fp.endsWith('session.jsonl'))
					return { isDirectory: () => false, size: 100, mtimeMs: 1001 };
				throw new Error('ENOENT');
			});

			mockReadFile.mockResolvedValue('{"type":"user","content":"hello"}\n');

			const handler = handlers.get('agentSessions:getGlobalStats');
			const result = await handler!({} as any);

			// Only the good project's session should be found
			expect(result.byProvider['claude-code'].sessions).toBe(1);
		});
	});

	describe('discoverCodexSessionFiles (via getGlobalStats)', () => {
		it('should discover Codex session files with flattened parallel scanning', async () => {
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.claude')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.codex/sessions') {
					return ['2025', '2026', 'invalid'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025') {
					return ['01', '12'];
				}
				if (dir === '/home/testuser/.codex/sessions/2026') {
					return ['02'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025/01') {
					return ['15', '20'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025/12') {
					return ['31'];
				}
				if (dir === '/home/testuser/.codex/sessions/2026/02') {
					return ['01'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025/01/15') {
					return ['sess-a.jsonl', 'sess-b.jsonl'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025/01/20') {
					return ['sess-c.jsonl'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025/12/31') {
					return ['sess-d.jsonl'];
				}
				if (dir === '/home/testuser/.codex/sessions/2026/02/01') {
					return ['sess-e.jsonl', 'empty.jsonl'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				// Directories
				if (
					fp.endsWith('/2025') ||
					fp.endsWith('/2026') ||
					fp.endsWith('/01') ||
					fp.endsWith('/02') ||
					fp.endsWith('/12') ||
					fp.endsWith('/15') ||
					fp.endsWith('/20') ||
					fp.endsWith('/31')
				) {
					return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				}
				// Session files
				if (fp.endsWith('sess-a.jsonl'))
					return { isDirectory: () => false, size: 100, mtimeMs: 2001 };
				if (fp.endsWith('sess-b.jsonl'))
					return { isDirectory: () => false, size: 200, mtimeMs: 2002 };
				if (fp.endsWith('sess-c.jsonl'))
					return { isDirectory: () => false, size: 300, mtimeMs: 2003 };
				if (fp.endsWith('sess-d.jsonl'))
					return { isDirectory: () => false, size: 400, mtimeMs: 2004 };
				if (fp.endsWith('sess-e.jsonl'))
					return { isDirectory: () => false, size: 500, mtimeMs: 2005 };
				if (fp.endsWith('empty.jsonl')) return { isDirectory: () => false, size: 0, mtimeMs: 2006 };
				throw new Error('ENOENT');
			});

			// Codex sessions are JSONL with specific entry types
			mockReadFile.mockResolvedValue(
				'{"type":"response_item","payload":{"type":"message","role":"user"}}\n' +
					'{"type":"response_item","payload":{"type":"message","role":"assistant"}}\n'
			);

			const handler = handlers.get('agentSessions:getGlobalStats');
			const result = await handler!({} as any);

			// Should have discovered 5 non-empty Codex session files
			expect(result.byProvider['codex']).toBeDefined();
			expect(result.byProvider['codex'].sessions).toBe(5);
		});

		it('should skip invalid year/month/day directories', async () => {
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.claude')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.codex/sessions') {
					return ['2025', 'notayear', 'abc'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025') {
					return ['01', 'xx', '123'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025/01') {
					return ['05', 'ab'];
				}
				if (dir === '/home/testuser/.codex/sessions/2025/01/05') {
					return ['session.jsonl'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				if (fp.endsWith('/2025') || fp.endsWith('/01') || fp.endsWith('/05')) {
					return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				}
				if (fp.endsWith('session.jsonl'))
					return { isDirectory: () => false, size: 100, mtimeMs: 2001 };
				throw new Error('ENOENT');
			});

			mockReadFile.mockResolvedValue(
				'{"type":"response_item","payload":{"type":"message","role":"user"}}\n'
			);

			const handler = handlers.get('agentSessions:getGlobalStats');
			const result = await handler!({} as any);

			// Only one valid session through the valid year/month/day path
			expect(result.byProvider['codex'].sessions).toBe(1);
		});
	});

	describe('Discovery cache (30-second TTL)', () => {
		it('should return cached results on second call within TTL', async () => {
			// Set up minimal Claude filesystem
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.claude/projects') {
					return ['project-a'];
				}
				if (dir === '/home/testuser/.claude/projects/project-a') {
					return ['session.jsonl'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				if (fp.endsWith('project-a')) return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				if (fp.endsWith('session.jsonl'))
					return { isDirectory: () => false, size: 100, mtimeMs: 1001 };
				throw new Error('ENOENT');
			});

			mockReadFile.mockResolvedValue('{"type":"user","content":"hello"}\n');

			const handler = handlers.get('agentSessions:getGlobalStats');

			// First call - should hit filesystem
			await handler!({} as any);
			const firstCallReaddirCount = mockReaddir.mock.calls.length;

			// Reset readdir mock call count to track second call
			mockReaddir.mockClear();

			// Second call - should use cache (within 30s TTL)
			await handler!({} as any);

			// readdir should NOT have been called again for the Claude projects directory
			// (the discovery function returns cached results)
			const secondCallReaddirCalls = mockReaddir.mock.calls
				.map((call) => String(call[0]))
				.filter((p) => p.includes('.claude/projects'));
			expect(secondCallReaddirCalls.length).toBe(0);
		});

		it('should re-scan after cache invalidation', async () => {
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.claude/projects') {
					return ['project-a'];
				}
				if (dir === '/home/testuser/.claude/projects/project-a') {
					return ['session.jsonl'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				if (fp.endsWith('project-a')) return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				if (fp.endsWith('session.jsonl'))
					return { isDirectory: () => false, size: 100, mtimeMs: 1001 };
				throw new Error('ENOENT');
			});

			mockReadFile.mockResolvedValue('{"type":"user","content":"hello"}\n');

			const handler = handlers.get('agentSessions:getGlobalStats');

			// First call
			await handler!({} as any);
			mockReaddir.mockClear();

			// Invalidate cache
			invalidateDiscoveryCache();

			// Second call after invalidation - should rescan
			await handler!({} as any);

			const secondCallClaudeCalls = mockReaddir.mock.calls
				.map((call) => String(call[0]))
				.filter((p) => p.includes('.claude/projects'));
			expect(secondCallClaudeCalls.length).toBeGreaterThan(0);
		});

		it('should re-scan after TTL expires', async () => {
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.claude/projects') {
					return ['project-a'];
				}
				if (dir === '/home/testuser/.claude/projects/project-a') {
					return ['session.jsonl'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				if (fp.endsWith('project-a')) return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				if (fp.endsWith('session.jsonl'))
					return { isDirectory: () => false, size: 100, mtimeMs: 1001 };
				throw new Error('ENOENT');
			});

			mockReadFile.mockResolvedValue('{"type":"user","content":"hello"}\n');

			const handler = handlers.get('agentSessions:getGlobalStats');

			// First call
			await handler!({} as any);
			mockReaddir.mockClear();

			// Advance time past TTL (30 seconds)
			const originalDateNow = Date.now;
			const baseTime = Date.now();
			Date.now = vi.fn().mockReturnValue(baseTime + 31_000);

			try {
				// Second call after TTL expiry - should rescan
				await handler!({} as any);

				const secondCallClaudeCalls = mockReaddir.mock.calls
					.map((call) => String(call[0]))
					.filter((p) => p.includes('.claude/projects'));
				expect(secondCallClaudeCalls.length).toBeGreaterThan(0);
			} finally {
				Date.now = originalDateNow;
			}
		});
	});

	describe('Batched processing', () => {
		it('should handle more than 10 project directories with batching', async () => {
			// Create 25 project directories to test batching (batch size = 10)
			const projectDirs = Array.from({ length: 25 }, (_, i) => `project-${i}`);

			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});
			mockReaddir.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir === '/home/testuser/.claude/projects') {
					return projectDirs;
				}
				// Each project has one session
				if (dir.includes('/home/testuser/.claude/projects/project-')) {
					return ['session.jsonl'];
				}
				return [];
			});

			mockStat.mockImplementation(async (filePath: string) => {
				const fp = String(filePath);
				if (fp.match(/project-\d+$/) && !fp.endsWith('.jsonl'))
					return { isDirectory: () => true, size: 0, mtimeMs: 1000 };
				if (fp.endsWith('session.jsonl'))
					return { isDirectory: () => false, size: 100, mtimeMs: 1001 };
				throw new Error('ENOENT');
			});

			mockReadFile.mockResolvedValue('{"type":"user","content":"hello"}\n');

			const handler = handlers.get('agentSessions:getGlobalStats');
			const result = await handler!({} as any);

			// All 25 projects should have been discovered
			expect(result.byProvider['claude-code'].sessions).toBe(25);
		});
	});

	describe('Empty/missing directories', () => {
		it('should handle missing Claude projects directory', async () => {
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.claude')) throw new Error('ENOENT');
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});

			const handler = handlers.get('agentSessions:getGlobalStats');
			const result = await handler!({} as any);

			// Should return empty stats without errors
			expect(result.totalSessions).toBe(0);
		});

		it('should handle missing Codex sessions directory', async () => {
			mockAccess.mockImplementation(async (dirPath: string) => {
				const dir = String(dirPath);
				if (dir.includes('.claude')) throw new Error('ENOENT');
				if (dir.includes('.codex')) throw new Error('ENOENT');
				return undefined;
			});

			const handler = handlers.get('agentSessions:getGlobalStats');
			const result = await handler!({} as any);

			expect(result.totalSessions).toBe(0);
		});
	});
});
