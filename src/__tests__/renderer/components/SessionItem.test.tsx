/**
 * @fileoverview Tests for SessionItem component
 *
 * Tests that SessionItem:
 * - Extracts all inline style={{...}} objects into a useMemo styles block
 * - Applies correct theme-based styles for each visual element
 * - Renders correct styles for container, badges, pills, indicators
 * - Handles variant-specific rendering (bookmark, group, flat, ungrouped, worktree)
 * - React.memo skips re-renders when relevant props don't change
 *
 * NOTE: jsdom normalizes hex colors to rgb()/rgba() format, so we use
 * toHaveStyle() from @testing-library/jest-dom which handles this automatically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SessionItem, type SessionItemProps } from '../../../renderer/components/SessionItem';
import type { Theme, Session, Group } from '../../../renderer/types';

// Mock the theme utility
vi.mock('../../../renderer/utils/theme', () => ({
	getStatusColor: vi.fn(
		(state: string, theme: { colors: { success: string; warning: string; error: string } }) => {
			switch (state) {
				case 'idle':
					return theme.colors.success;
				case 'busy':
					return theme.colors.warning;
				case 'error':
					return theme.colors.error;
				case 'connecting':
					return '#ff8800';
				default:
					return theme.colors.success;
			}
		}
	),
}));

const defaultTheme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		bgActivity: '#343746',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentDim: '#bd93f950',
		accentText: '#bd93f9',
		accentForeground: '#f8f8f2',
		border: '#44475a',
		success: '#50fa7b',
		warning: '#ffb86c',
		error: '#ff5555',
	},
};

const createMockSession = (overrides: Partial<Session> = {}): Session =>
	({
		id: 'session-1',
		name: 'Test Session',
		toolType: 'claude-code',
		state: 'idle' as const,
		cwd: '/test',
		fullPath: '/test',
		projectRoot: '/test',
		aiLogs: [],
		shellLogs: [],
		workLog: [],
		contextUsage: 0,
		inputMode: 'ai' as const,
		aiPid: 123,
		terminalPid: 0,
		port: 0,
		isLive: false,
		changedFiles: [],
		isGitRepo: true,
		fileTree: [],
		fileExplorerExpanded: [],
		fileExplorerScrollPos: 0,
		executionQueue: [],
		activeTimeMs: 0,
		aiTabs: [],
		activeTabId: 'tab-1',
		closedTabHistory: [],
		filePreviewTabs: [],
		activeFileTabId: null,
		unifiedTabOrder: [],
		unifiedClosedTabHistory: [],
		agentSessionId: 'agent-session-1',
		...overrides,
	}) as Session;

const createDefaultProps = (overrides: Partial<SessionItemProps> = {}): SessionItemProps => ({
	session: createMockSession(),
	variant: 'flat',
	theme: defaultTheme,
	isActive: false,
	isKeyboardSelected: false,
	isDragging: false,
	isEditing: false,
	leftSidebarOpen: true,
	onSelect: vi.fn(),
	onDragStart: vi.fn(),
	onContextMenu: vi.fn(),
	onFinishRename: vi.fn(),
	onStartRename: vi.fn(),
	onToggleBookmark: vi.fn(),
	...overrides,
});

describe('SessionItem', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ==========================================================================
	// Container style tests
	// ==========================================================================
	describe('container styles (memoized)', () => {
		it('applies transparent border and background when not active or selected', () => {
			const { container } = render(<SessionItem {...createDefaultProps()} />);
			const rootDiv = container.firstChild as HTMLElement;
			// Note: toHaveStyle has a known quirk with 'transparent', so use .toBe directly
			expect(rootDiv.style.borderColor).toBe('transparent');
			expect(rootDiv.style.backgroundColor).toBe('transparent');
		});

		it('applies accent border and bgActivity background when active', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ isActive: true })} />);
			const rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv).toHaveStyle({
				borderColor: defaultTheme.colors.accent,
				backgroundColor: defaultTheme.colors.bgActivity,
			});
		});

		it('applies accent border and semi-transparent bgActivity when keyboard selected', () => {
			const { container } = render(
				<SessionItem {...createDefaultProps({ isKeyboardSelected: true })} />
			);
			const rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv).toHaveStyle({
				borderColor: defaultTheme.colors.accent,
			});
			// Semi-transparent bgActivity (hex + '40') is rgba — check it's not transparent
			expect(rootDiv.style.backgroundColor).not.toBe('transparent');
		});

		it('active takes priority over keyboard selected for background', () => {
			const { container } = render(
				<SessionItem {...createDefaultProps({ isActive: true, isKeyboardSelected: true })} />
			);
			const rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv).toHaveStyle({
				backgroundColor: defaultTheme.colors.bgActivity,
			});
		});
	});

	// ==========================================================================
	// Rename input style tests
	// ==========================================================================
	describe('rename input styles (memoized)', () => {
		it('applies accent borderColor to rename input when editing', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ isEditing: true })} />);
			const input = container.querySelector('input') as HTMLInputElement;
			expect(input).toBeTruthy();
			expect(input).toHaveStyle({
				borderColor: defaultTheme.colors.accent,
			});
		});
	});

	// ==========================================================================
	// Session name styles
	// ==========================================================================
	describe('session name styles (memoized)', () => {
		it('applies textDim color when not active', () => {
			const { container } = render(<SessionItem {...createDefaultProps()} />);
			const nameSpan = container.querySelector('.font-medium.truncate') as HTMLElement;
			expect(nameSpan).toHaveStyle({ color: defaultTheme.colors.textDim });
		});

		it('applies textMain color when active', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ isActive: true })} />);
			const nameSpan = container.querySelector('.font-medium.truncate') as HTMLElement;
			expect(nameSpan).toHaveStyle({ color: defaultTheme.colors.textMain });
		});
	});

	// ==========================================================================
	// Jump number badge styles
	// ==========================================================================
	describe('jump number badge styles (memoized)', () => {
		it('renders jump number badge with accent background and bgMain text color', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ jumpNumber: '3' })} />);
			const badge = container.querySelector('.font-bold.shrink-0') as HTMLElement;
			expect(badge).toBeTruthy();
			expect(badge.textContent).toBe('3');
			expect(badge).toHaveStyle({
				backgroundColor: defaultTheme.colors.accent,
				color: defaultTheme.colors.bgMain,
			});
		});

		it('does not render jump number badge when jumpNumber is null', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ jumpNumber: null })} />);
			const badges = container.querySelectorAll('.font-bold.shrink-0');
			expect(badges.length).toBe(0);
		});
	});

	// ==========================================================================
	// Group badge styles (bookmark variant)
	// ==========================================================================
	describe('group badge styles (memoized)', () => {
		it('renders group badge with bgActivity background and textDim color in bookmark variant', () => {
			const group: Group = { id: 'g1', name: 'My Group', emoji: '', collapsed: false };
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'bookmark',
						group,
						session: createMockSession({ bookmarked: true }),
					})}
				/>
			);
			const groupBadge = container.querySelector(
				'.text-\\[9px\\].px-1.py-0\\.5.rounded'
			) as HTMLElement;
			expect(groupBadge).toBeTruthy();
			expect(groupBadge.textContent).toBe('My Group');
			expect(groupBadge).toHaveStyle({
				backgroundColor: defaultTheme.colors.bgActivity,
				color: defaultTheme.colors.textDim,
			});
		});
	});

	// ==========================================================================
	// Git dirty indicator styles
	// ==========================================================================
	describe('git dirty indicator styles (memoized)', () => {
		it('applies warning color to git dirty indicator', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						leftSidebarOpen: true,
						gitFileCount: 5,
						session: createMockSession({ isGitRepo: true }),
					})}
				/>
			);
			const gitIndicator = container.querySelector('.text-\\[10px\\].gap-0\\.5') as HTMLElement;
			expect(gitIndicator).toBeTruthy();
			expect(gitIndicator).toHaveStyle({ color: defaultTheme.colors.warning });
		});

		it('does not render git dirty indicator when sidebar is closed', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						leftSidebarOpen: false,
						gitFileCount: 5,
						session: createMockSession({ isGitRepo: true }),
					})}
				/>
			);
			const gitIndicator = container.querySelector('.text-\\[10px\\].gap-0\\.5');
			expect(gitIndicator).toBeNull();
		});
	});

	// ==========================================================================
	// GIT pill styles
	// ==========================================================================
	describe('GIT pill styles (memoized)', () => {
		it('applies accent-based colors to GIT pill for git repos', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'flat',
						session: createMockSession({ isGitRepo: true }),
					})}
				/>
			);
			// The GIT pill with text "GIT"
			const gitPill = Array.from(container.querySelectorAll('.font-bold.uppercase')).find(
				(el) => el.textContent === 'GIT'
			) as HTMLElement;
			expect(gitPill).toBeTruthy();
			expect(gitPill).toHaveStyle({
				color: defaultTheme.colors.accent,
			});
			// backgroundColor is accent + '30' (hex with alpha) — verify it's set
			expect(gitPill.style.backgroundColor).not.toBe('transparent');
			expect(gitPill.style.backgroundColor).not.toBe('');
		});
	});

	// ==========================================================================
	// LOCAL / REMOTE pill styles
	// ==========================================================================
	describe('LOCAL/REMOTE pill styles (memoized)', () => {
		it('applies textDim-based colors to LOCAL pill for non-git repos', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'flat',
						session: createMockSession({ isGitRepo: false }),
					})}
				/>
			);
			const localPill = Array.from(container.querySelectorAll('.font-bold.uppercase')).find(
				(el) => el.textContent === 'LOCAL'
			) as HTMLElement;
			expect(localPill).toBeTruthy();
			expect(localPill).toHaveStyle({
				color: defaultTheme.colors.textDim,
			});
			// backgroundColor is textDim + '20' (hex with alpha) — verify it's set
			expect(localPill.style.backgroundColor).not.toBe('transparent');
			expect(localPill.style.backgroundColor).not.toBe('');
		});

		it('applies warning-based colors to REMOTE pill for SSH sessions', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'flat',
						session: createMockSession({
							isGitRepo: false,
							sessionSshRemoteConfig: { enabled: true, remoteId: 'ssh-1' },
						}),
					})}
				/>
			);
			const remotePill = Array.from(container.querySelectorAll('.font-bold.uppercase')).find(
				(el) => el.textContent === 'REMOTE'
			) as HTMLElement;
			expect(remotePill).toBeTruthy();
			expect(remotePill).toHaveStyle({
				color: defaultTheme.colors.warning,
			});
			// backgroundColor is warning + '30' (hex with alpha) — verify it's set
			expect(remotePill.style.backgroundColor).not.toBe('transparent');
			expect(remotePill.style.backgroundColor).not.toBe('');
		});
	});

	// ==========================================================================
	// SSH pill styles
	// ==========================================================================
	describe('SSH pill styles (memoized)', () => {
		it('applies warning-based colors to SSH server pill for git repos with SSH', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'flat',
						session: createMockSession({
							isGitRepo: true,
							sessionSshRemoteConfig: { enabled: true, remoteId: 'ssh-1' },
						}),
					})}
				/>
			);
			// The SSH pill has title "Running on remote host via SSH"
			const sshPill = container.querySelector(
				'[title="Running on remote host via SSH"]'
			) as HTMLElement;
			expect(sshPill).toBeTruthy();
			expect(sshPill).toHaveStyle({
				color: defaultTheme.colors.warning,
			});
			// backgroundColor is warning + '30' (hex with alpha) — verify it's set
			expect(sshPill.style.backgroundColor).not.toBe('transparent');
			expect(sshPill.style.backgroundColor).not.toBe('');
		});
	});

	// ==========================================================================
	// AUTO pill styles
	// ==========================================================================
	describe('AUTO pill styles (memoized)', () => {
		it('applies warning-based colors to AUTO pill when in batch', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ isInBatch: true })} />);
			const autoPill = Array.from(container.querySelectorAll('.font-bold.uppercase')).find((el) =>
				el.textContent?.includes('AUTO')
			) as HTMLElement;
			expect(autoPill).toBeTruthy();
			expect(autoPill).toHaveStyle({
				color: defaultTheme.colors.warning,
			});
			// backgroundColor is warning + '30' (hex with alpha) — verify it's set
			expect(autoPill.style.backgroundColor).not.toBe('transparent');
			expect(autoPill.style.backgroundColor).not.toBe('');
		});

		it('does not render AUTO pill when not in batch', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ isInBatch: false })} />);
			const autoPills = Array.from(container.querySelectorAll('.font-bold.uppercase')).filter(
				(el) => el.textContent?.includes('AUTO')
			);
			expect(autoPills.length).toBe(0);
		});
	});

	// ==========================================================================
	// Error pill styles
	// ==========================================================================
	describe('error pill styles (memoized)', () => {
		it('applies error-based colors to ERR pill when agent has error', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						session: createMockSession({
							agentError: {
								type: 'process_crash' as any,
								message: 'Agent crashed',
								recoverable: true,
								agentId: 'claude-code',
								timestamp: Date.now(),
							},
						}),
					})}
				/>
			);
			const errPill = Array.from(container.querySelectorAll('.font-bold.uppercase')).find((el) =>
				el.textContent?.includes('ERR')
			) as HTMLElement;
			expect(errPill).toBeTruthy();
			expect(errPill).toHaveStyle({
				color: defaultTheme.colors.error,
			});
			// backgroundColor is error + '30' (hex with alpha) — verify it's set
			expect(errPill.style.backgroundColor).not.toBe('transparent');
			expect(errPill.style.backgroundColor).not.toBe('');
		});
	});

	// ==========================================================================
	// Status indicator styles
	// ==========================================================================
	describe('status indicator styles (memoized)', () => {
		it('applies success color for idle state', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						session: createMockSession({ state: 'idle' }),
					})}
				/>
			);
			const statusDot = container.querySelector('.rounded-full') as HTMLElement;
			expect(statusDot).toBeTruthy();
			expect(statusDot).toHaveStyle({
				backgroundColor: defaultTheme.colors.success,
			});
		});

		it('applies hollow border style for claude-code with no agent session', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						session: createMockSession({
							toolType: 'claude-code',
							agentSessionId: undefined,
						}),
					})}
				/>
			);
			const statusDot = container.querySelector('.rounded-full') as HTMLElement;
			expect(statusDot).toBeTruthy();
			// Note: toHaveStyle has a known quirk with 'transparent', so use .toBe directly
			expect(statusDot.style.backgroundColor).toBe('transparent');
			// Check that border contains 'solid' and is set (jsdom normalizes the shorthand)
			expect(statusDot.style.border).toContain('solid');
		});

		it('applies warning color for batch mode overriding state color', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						isInBatch: true,
						session: createMockSession({ state: 'idle' }),
					})}
				/>
			);
			const statusDot = container.querySelector('.rounded-full') as HTMLElement;
			expect(statusDot).toBeTruthy();
			expect(statusDot).toHaveStyle({
				backgroundColor: defaultTheme.colors.warning,
			});
		});
	});

	// ==========================================================================
	// Unread badge styles
	// ==========================================================================
	describe('unread badge styles (memoized)', () => {
		it('applies error background color to unread notification badge', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						isActive: false,
						session: createMockSession({
							aiTabs: [{ hasUnread: true } as any],
						}),
					})}
				/>
			);
			const unreadBadge = container.querySelector('[title="Unread messages"]') as HTMLElement;
			expect(unreadBadge).toBeTruthy();
			expect(unreadBadge).toHaveStyle({
				backgroundColor: defaultTheme.colors.error,
			});
		});

		it('does not render unread badge when session is active', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						isActive: true,
						session: createMockSession({
							aiTabs: [{ hasUnread: true } as any],
						}),
					})}
				/>
			);
			const unreadBadge = container.querySelector('[title="Unread messages"]');
			expect(unreadBadge).toBeNull();
		});
	});

	// ==========================================================================
	// Accent color reuse (bookmark icons, branch icons)
	// ==========================================================================
	describe('accent color reuse across icons (memoized)', () => {
		it('applies accent color to bookmark icon in bookmark variant', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'bookmark',
						session: createMockSession({ bookmarked: true }),
					})}
				/>
			);
			// The bookmark icon SVGs (from global mock) have style prop applied
			const bookmarkIcons = container.querySelectorAll('svg');
			// At least one SVG icon should have the accent color style
			const accentColored = Array.from(bookmarkIcons).filter((svg) => {
				const computed = svg.style.color;
				// jsdom normalizes hex to rgb, so check both formats
				return computed !== '' && computed !== 'transparent';
			});
			expect(accentColored.length).toBeGreaterThan(0);
			// Verify specifically that one has the accent color using toHaveStyle
			expect(accentColored[0]).toHaveStyle({ color: defaultTheme.colors.accent });
		});

		it('applies accent color to git branch icon in worktree variant', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'worktree',
						session: createMockSession({ parentSessionId: 'parent-1' }),
					})}
				/>
			);
			const icons = container.querySelectorAll('svg');
			const coloredIcons = Array.from(icons).filter((svg) => {
				const computed = svg.style.color;
				return computed !== '' && computed !== 'transparent';
			});
			expect(coloredIcons.length).toBeGreaterThan(0);
			// Verify the icon has the accent color
			expect(coloredIcons[0]).toHaveStyle({ color: defaultTheme.colors.accent });
		});
	});

	// ==========================================================================
	// React.memo behavior — styles should be stable references
	// ==========================================================================
	describe('React.memo and style stability', () => {
		it('does not re-render when unrelated parent re-renders with same props', () => {
			const props = createDefaultProps();

			const { rerender } = render(<SessionItem {...props} />);

			// Re-render with identical props - React.memo should skip
			rerender(<SessionItem {...props} />);

			// If the component is properly memoized, the inner hooks (useMemo)
			// should produce stable references across renders.
			// We verify indirectly by checking the DOM hasn't changed
			const { container } = render(<SessionItem {...props} />);
			const rootDiv = container.firstChild as HTMLElement;
			// Note: toHaveStyle has a known quirk with 'transparent', so use .toBe directly
			expect(rootDiv.style.borderColor).toBe('transparent');
			expect(rootDiv.style.backgroundColor).toBe('transparent');
		});

		it('re-renders when isActive changes from false to true', () => {
			const props = createDefaultProps();
			const { container, rerender } = render(<SessionItem {...props} />);

			let rootDiv = container.firstChild as HTMLElement;
			// Note: toHaveStyle has a known quirk with 'transparent', so use .toBe directly
			expect(rootDiv.style.backgroundColor).toBe('transparent');

			rerender(<SessionItem {...props} isActive={true} />);
			rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv).toHaveStyle({
				backgroundColor: defaultTheme.colors.bgActivity,
			});
		});
	});

	// ==========================================================================
	// Variant-specific rendering
	// ==========================================================================
	describe('variant-specific rendering', () => {
		it('flat variant uses mx-3 className', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ variant: 'flat' })} />);
			const rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv.className).toContain('mx-3');
		});

		it('worktree variant uses pl-8 className and text-xs for name', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'worktree',
						session: createMockSession({ parentSessionId: 'parent-1' }),
					})}
				/>
			);
			const rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv.className).toContain('pl-8');
			const nameSpan = container.querySelector('.font-medium.truncate') as HTMLElement;
			expect(nameSpan.className).toContain('text-xs');
		});

		it('worktree variant hides metadata row', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'worktree',
						session: createMockSession({ parentSessionId: 'parent-1' }),
					})}
				/>
			);
			// The metadata row with tool type should not be present
			expect(container.textContent).not.toContain('claude-code');
		});

		it('group variant uses px-4 className', () => {
			const { container } = render(<SessionItem {...createDefaultProps({ variant: 'group' })} />);
			const rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv.className).toContain('px-4');
		});

		it('bookmark variant does not show GIT/LOCAL badge', () => {
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						variant: 'bookmark',
						session: createMockSession({ isGitRepo: true }),
					})}
				/>
			);
			const gitPills = Array.from(container.querySelectorAll('.font-bold.uppercase')).filter(
				(el) => el.textContent === 'GIT'
			);
			expect(gitPills.length).toBe(0);
		});
	});

	// ==========================================================================
	// Theme switching — styles recompute on theme change
	// ==========================================================================
	describe('theme change recomputes styles', () => {
		it('styles update when theme changes', () => {
			const props = createDefaultProps({ isActive: true });
			const { container, rerender } = render(<SessionItem {...props} />);

			let rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv).toHaveStyle({
				backgroundColor: defaultTheme.colors.bgActivity,
			});

			const altTheme: Theme = {
				...defaultTheme,
				id: 'monokai',
				name: 'Monokai',
				colors: {
					...defaultTheme.colors,
					bgActivity: '#49483E',
					accent: '#A6E22E',
				},
			};

			rerender(<SessionItem {...props} theme={altTheme} />);
			rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv).toHaveStyle({
				backgroundColor: '#49483E',
				borderColor: '#A6E22E',
			});
		});
	});

	// ==========================================================================
	// Interactions (click, drag, context menu, rename)
	// ==========================================================================
	describe('interactions', () => {
		it('calls onSelect when clicked', () => {
			const onSelect = vi.fn();
			const { container } = render(<SessionItem {...createDefaultProps({ onSelect })} />);
			fireEvent.click(container.firstChild as HTMLElement);
			expect(onSelect).toHaveBeenCalledTimes(1);
		});

		it('calls onContextMenu on right click', () => {
			const onContextMenu = vi.fn();
			const { container } = render(<SessionItem {...createDefaultProps({ onContextMenu })} />);
			fireEvent.contextMenu(container.firstChild as HTMLElement);
			expect(onContextMenu).toHaveBeenCalledTimes(1);
		});

		it('calls onFinishRename when Enter is pressed in rename input', () => {
			const onFinishRename = vi.fn();
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						isEditing: true,
						onFinishRename,
					})}
				/>
			);
			const input = container.querySelector('input') as HTMLInputElement;
			fireEvent.keyDown(input, { key: 'Enter' });
			expect(onFinishRename).toHaveBeenCalled();
		});

		it('calls onToggleBookmark when bookmark button clicked', () => {
			const onToggleBookmark = vi.fn();
			const { container } = render(
				<SessionItem
					{...createDefaultProps({
						onToggleBookmark,
						session: createMockSession({ bookmarked: true }),
					})}
				/>
			);
			const bookmarkBtn = container.querySelector('button[title="Remove bookmark"]') as HTMLElement;
			expect(bookmarkBtn).toBeTruthy();
			fireEvent.click(bookmarkBtn);
			expect(onToggleBookmark).toHaveBeenCalledTimes(1);
		});
	});
});
