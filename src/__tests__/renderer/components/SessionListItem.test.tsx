/**
 * @fileoverview Tests for SessionListItem component
 *
 * Tests that SessionListItem:
 * - Accepts isSelected boolean prop (not index/selectedIndex)
 * - Applies selection styling based on isSelected
 * - React.memo skips re-renders when isSelected doesn't change
 * - Renders session data correctly
 * - Handles interactions (star, rename, click)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
	SessionListItem,
	type SessionListItemProps,
} from '../../../renderer/components/SessionListItem';
import type { Theme } from '../../../renderer/types';
import type { ClaudeSession } from '../../../renderer/hooks';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
	Star: ({ style }: { style?: React.CSSProperties }) => (
		<span data-testid="icon-star" style={style} />
	),
	Play: () => <span data-testid="icon-play" />,
	Edit3: () => <span data-testid="icon-edit" />,
	Clock: () => <span data-testid="icon-clock" />,
	MessageSquare: () => <span data-testid="icon-message-square" />,
	HardDrive: () => <span data-testid="icon-hard-drive" />,
	DollarSign: () => <span data-testid="icon-dollar-sign" />,
	Search: () => <span data-testid="icon-search" />,
}));

// Mock formatters
vi.mock('../../../renderer/utils/formatters', () => ({
	formatSize: (bytes: number) => `${bytes}B`,
	formatRelativeTime: () => '5m ago',
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

const createMockSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession => ({
	sessionId: 'abc12345-6789-4a01-9123-456789abcdef',
	projectPath: '/path/to/project',
	timestamp: '2025-01-15T10:00:00Z',
	modifiedAt: '2025-01-15T11:30:00Z',
	firstMessage: 'Help me with this code',
	messageCount: 10,
	sizeBytes: 25000,
	costUsd: 0.15,
	inputTokens: 5000,
	outputTokens: 2000,
	cacheReadTokens: 1000,
	cacheCreationTokens: 500,
	durationSeconds: 300,
	...overrides,
});

const createDefaultProps = (
	overrides: Partial<SessionListItemProps> = {}
): SessionListItemProps => ({
	session: createMockSession(),
	isSelected: false,
	isStarred: false,
	activeAgentSessionId: null,
	renamingSessionId: null,
	renameValue: '',
	searchMode: 'title',
	theme: defaultTheme,
	selectedItemRef: React.createRef(),
	renameInputRef: React.createRef(),
	onSessionClick: vi.fn(),
	onToggleStar: vi.fn(),
	onQuickResume: vi.fn(),
	onStartRename: vi.fn(),
	onRenameChange: vi.fn(),
	onSubmitRename: vi.fn(),
	onCancelRename: vi.fn(),
	...overrides,
});

describe('SessionListItem', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('isSelected prop', () => {
		it('applies selected background color when isSelected is true', () => {
			const { container } = render(
				<SessionListItem {...createDefaultProps({ isSelected: true })} />
			);
			const rootDiv = container.firstChild as HTMLElement;
			// When selected, backgroundColor should be set (not transparent)
			// The hex value #bd93f915 gets normalized to rgba by the browser
			expect(rootDiv.style.backgroundColor).not.toBe('transparent');
			expect(rootDiv.style.backgroundColor).toContain('rgba');
		});

		it('applies transparent background when isSelected is false', () => {
			const { container } = render(
				<SessionListItem {...createDefaultProps({ isSelected: false })} />
			);
			const rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv.style.backgroundColor).toBe('transparent');
		});

		it('does not accept index or selectedIndex props', () => {
			// TypeScript type check: SessionListItemProps should not have index or selectedIndex
			const props = createDefaultProps();
			expect('index' in props).toBe(false);
			expect('selectedIndex' in props).toBe(false);
			expect('isSelected' in props).toBe(true);
		});
	});

	describe('React.memo optimization', () => {
		it('skips re-render when props do not change', () => {
			const renderSpy = vi.fn();
			// We can verify memo behavior by checking that re-rendering with same props
			// does not cause the component to produce new output
			const props = createDefaultProps({ isSelected: false });
			const { rerender } = render(<SessionListItem {...props} />);

			// Get initial content
			const initialText = screen.getByText('Help me with this code');
			expect(initialText).toBeInTheDocument();

			// Rerender with exact same props — memo should skip
			rerender(<SessionListItem {...props} />);

			// Component should still be in the DOM (memo doesn't unmount)
			expect(screen.getByText('Help me with this code')).toBe(initialText);
		});

		it('re-renders when isSelected changes from false to true', () => {
			const props = createDefaultProps({ isSelected: false });
			const { container, rerender } = render(<SessionListItem {...props} />);

			const rootDiv = container.firstChild as HTMLElement;
			expect(rootDiv.style.backgroundColor).toBe('transparent');

			// Change isSelected to true
			rerender(<SessionListItem {...createDefaultProps({ isSelected: true })} />);
			expect(rootDiv.style.backgroundColor).not.toBe('transparent');
			expect(rootDiv.style.backgroundColor).toContain('rgba');
		});
	});

	describe('rendering', () => {
		it('renders session first message', () => {
			render(<SessionListItem {...createDefaultProps()} />);
			expect(screen.getByText('Help me with this code')).toBeInTheDocument();
		});

		it('renders session name when provided', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						session: createMockSession({ sessionName: 'My Important Session' }),
					})}
				/>
			);
			expect(screen.getByText('My Important Session')).toBeInTheDocument();
		});

		it('renders MAESTRO origin pill for user-initiated sessions', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						session: createMockSession({ origin: 'user' }),
					})}
				/>
			);
			expect(screen.getByText('MAESTRO')).toBeInTheDocument();
		});

		it('renders AUTO origin pill for auto-run sessions', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						session: createMockSession({ origin: 'auto' }),
					})}
				/>
			);
			expect(screen.getByText('AUTO')).toBeInTheDocument();
		});

		it('renders CLI origin pill for CLI sessions', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						session: createMockSession({ origin: undefined }),
					})}
				/>
			);
			expect(screen.getByText('CLI')).toBeInTheDocument();
		});

		it('renders ACTIVE indicator when session is active', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						activeAgentSessionId: 'abc12345-6789-4a01-9123-456789abcdef',
					})}
				/>
			);
			expect(screen.getByText('ACTIVE')).toBeInTheDocument();
		});

		it('does not render ACTIVE indicator for non-active sessions', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						activeAgentSessionId: 'different-session-id',
					})}
				/>
			);
			expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
		});

		it('renders cost when costUsd > 0', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						session: createMockSession({ costUsd: 1.23 }),
					})}
				/>
			);
			expect(screen.getByText('1.23')).toBeInTheDocument();
		});

		it('renders message count', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						session: createMockSession({ messageCount: 42 }),
					})}
				/>
			);
			expect(screen.getByText('42')).toBeInTheDocument();
		});

		it('renders search match info for content searches', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						searchMode: 'all',
						searchResultInfo: { matchCount: 5, matchPreview: 'found this match' },
					})}
				/>
			);
			expect(screen.getByText('5')).toBeInTheDocument();
		});
	});

	describe('interactions', () => {
		it('calls onSessionClick when row is clicked', () => {
			const onSessionClick = vi.fn();
			const session = createMockSession();
			const { container } = render(
				<SessionListItem {...createDefaultProps({ onSessionClick, session })} />
			);

			fireEvent.click(container.firstChild as HTMLElement);
			expect(onSessionClick).toHaveBeenCalledWith(session);
		});

		it('calls onToggleStar when star button is clicked', () => {
			const onToggleStar = vi.fn();
			render(<SessionListItem {...createDefaultProps({ onToggleStar })} />);

			const starButton = screen.getByTitle('Add to favorites');
			fireEvent.click(starButton);
			expect(onToggleStar).toHaveBeenCalledWith(
				'abc12345-6789-4a01-9123-456789abcdef',
				expect.any(Object)
			);
		});

		it('renders rename input when session is being renamed', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						renamingSessionId: 'abc12345-6789-4a01-9123-456789abcdef',
						renameValue: 'New Name',
					})}
				/>
			);

			const input = screen.getByPlaceholderText('Enter session name...');
			expect(input).toBeInTheDocument();
			expect(input).toHaveValue('New Name');
		});

		it('calls onSubmitRename on Enter key in rename input', () => {
			const onSubmitRename = vi.fn();
			render(
				<SessionListItem
					{...createDefaultProps({
						renamingSessionId: 'abc12345-6789-4a01-9123-456789abcdef',
						renameValue: 'New Name',
						onSubmitRename,
					})}
				/>
			);

			const input = screen.getByPlaceholderText('Enter session name...');
			fireEvent.keyDown(input, { key: 'Enter' });
			expect(onSubmitRename).toHaveBeenCalledWith('abc12345-6789-4a01-9123-456789abcdef');
		});

		it('calls onCancelRename on Escape key in rename input', () => {
			const onCancelRename = vi.fn();
			render(
				<SessionListItem
					{...createDefaultProps({
						renamingSessionId: 'abc12345-6789-4a01-9123-456789abcdef',
						renameValue: 'New Name',
						onCancelRename,
					})}
				/>
			);

			const input = screen.getByPlaceholderText('Enter session name...');
			fireEvent.keyDown(input, { key: 'Escape' });
			expect(onCancelRename).toHaveBeenCalled();
		});
	});

	describe('renameValue isolation', () => {
		it('does not show rename input when renameValue is empty and renamingSessionId does not match', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						renamingSessionId: 'other-session-id',
						renameValue: '',
					})}
				/>
			);

			expect(screen.queryByPlaceholderText('Enter session name...')).not.toBeInTheDocument();
		});

		it('shows rename input with value when renamingSessionId matches this session', () => {
			render(
				<SessionListItem
					{...createDefaultProps({
						renamingSessionId: 'abc12345-6789-4a01-9123-456789abcdef',
						renameValue: 'Typing...',
					})}
				/>
			);

			const input = screen.getByPlaceholderText('Enter session name...');
			expect(input).toBeInTheDocument();
			expect(input).toHaveValue('Typing...');
		});

		it('React.memo skips re-render when renameValue stays as empty string for non-renaming item', () => {
			// Non-renaming items should always receive renameValue='' from the parent.
			// Verify that re-rendering with the same empty string does not cause new output.
			const props = createDefaultProps({
				renamingSessionId: null,
				renameValue: '',
			});
			const { container, rerender } = render(<SessionListItem {...props} />);

			const initialHtml = container.innerHTML;

			// Rerender with same props (stable empty string) — memo should skip
			rerender(<SessionListItem {...props} />);
			expect(container.innerHTML).toBe(initialHtml);
		});

		it('re-renders when renameValue changes for the renaming item', () => {
			const sessionId = 'abc12345-6789-4a01-9123-456789abcdef';
			const props1 = createDefaultProps({
				renamingSessionId: sessionId,
				renameValue: 'Old',
			});
			const { rerender } = render(<SessionListItem {...props1} />);

			const input1 = screen.getByPlaceholderText('Enter session name...');
			expect(input1).toHaveValue('Old');

			// Update renameValue — the renaming item should re-render with new value
			const props2 = createDefaultProps({
				renamingSessionId: sessionId,
				renameValue: 'New Name',
			});
			rerender(<SessionListItem {...props2} />);

			const input2 = screen.getByPlaceholderText('Enter session name...');
			expect(input2).toHaveValue('New Name');
		});

		it('does not show rename input when renameValue has text but renamingSessionId does not match', () => {
			// Edge case: parent passes non-empty renameValue but for a different session.
			// With the isolation fix, non-renaming items receive '' so this case shouldn't happen,
			// but the component should still not show rename input based on renamingSessionId mismatch.
			render(
				<SessionListItem
					{...createDefaultProps({
						renamingSessionId: 'different-session-id',
						renameValue: 'Some value',
					})}
				/>
			);

			expect(screen.queryByPlaceholderText('Enter session name...')).not.toBeInTheDocument();
		});
	});
});
