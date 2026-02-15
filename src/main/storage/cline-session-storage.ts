/**
 * Cline Session Storage Implementation
 *
 * This module implements the AgentSessionStorage interface for Cline.
 * Cline stores sessions at ~/.cline/data/tasks/<taskId>/
 *
 * Directory structure:
 * - ~/.cline/data/tasks/<taskId>/cline_messages.json - Full conversation (JSON array of say/ask messages)
 * - ~/.cline/data/tasks/<taskId>/task_metadata.json - Session metadata (taskId, task, ts, optional cost/tokens)
 * - ~/.cline/data/tasks/<taskId>/api_conversation_history.json - API conversation log
 * - ~/.cline/data/tasks/<taskId>/context_history.json - Context history
 * - ~/.cline/data/tasks/<taskId>/checkpoints/ - Checkpoint data
 *
 * cline_messages.json format (JSON array):
 * [
 *   { "ts": 1234567890, "type": "say", "say": "task", "text": "user prompt" },
 *   { "ts": 1234567891, "type": "say", "say": "text", "text": "assistant response" },
 *   { "ts": 1234567892, "type": "say", "say": "tool", "text": "tool usage info" },
 *   { "ts": 1234567893, "type": "ask", "ask": "followup", "text": "question for user" }
 * ]
 *
 * task_metadata.json format:
 * {
 *   "taskId": "uuid",
 *   "task": "user prompt text",
 *   "ts": 1234567890,
 *   "cwd": "/path/to/project",
 *   "totalCost": 0.05,
 *   "tokensIn": 1000,
 *   "tokensOut": 500
 * }
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import { captureException } from '../utils/sentry';
import { readDirRemote, readFileRemote } from '../utils/remote-fs';
import type {
	AgentSessionStorage,
	AgentSessionInfo,
	PaginatedSessionsResult,
	SessionMessagesResult,
	SessionSearchResult,
	SessionSearchMode,
	SessionListOptions,
	SessionReadOptions,
	SessionMessage,
} from '../agents';
import type { ToolType, SshRemoteConfig } from '../../shared/types';

const LOG_CONTEXT = '[ClineSessionStorage]';

/**
 * Get Cline storage base directory
 * - All platforms: ~/.cline/data/tasks
 */
function getClineTasksDir(): string {
	return path.join(os.homedir(), '.cline', 'data', 'tasks');
}

/**
 * Get remote Cline storage base directory for SSH
 */
function getRemoteClineTasksDir(): string {
	return '~/.cline/data/tasks';
}

/**
 * Cline task_metadata.json structure
 */
interface ClineTaskMetadata {
	taskId?: string;
	task?: string;
	ts?: number;
	cwd?: string;
	totalCost?: number;
	tokensIn?: number;
	tokensOut?: number;
}

/**
 * Cline message entry from cline_messages.json
 */
interface ClineMessage {
	ts?: number;
	type?: 'say' | 'ask';
	say?: string;
	ask?: string;
	text?: string;
	images?: string[];
	partial?: boolean;
}

/**
 * Read a JSON file safely
 */
async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const content = await fs.readFile(filePath, 'utf-8');
		return JSON.parse(content) as T;
	} catch (error) {
		logger.debug(`Failed to read JSON file: ${filePath}`, LOG_CONTEXT, { error });
		return null;
	}
}

/**
 * Normalize a project path for comparison
 */
function normalizeProjectPath(projectPath: string): string {
	return path.resolve(projectPath);
}

/**
 * Check if a session's cwd matches or is under the given project path
 */
function isSessionForProject(sessionCwd: string, projectPath: string): boolean {
	const normalizedSession = normalizeProjectPath(sessionCwd);
	const normalizedProject = normalizeProjectPath(projectPath);
	if (normalizedSession === normalizedProject) {
		return true;
	}
	const prefix = normalizedProject.endsWith(path.sep)
		? normalizedProject
		: `${normalizedProject}${path.sep}`;
	return normalizedSession.startsWith(prefix);
}

/**
 * Extract preview text from the first meaningful message in cline_messages.json
 */
function extractPreviewText(messages: ClineMessage[]): string {
	for (const msg of messages) {
		if (msg.type === 'say' && msg.say === 'task' && msg.text?.trim()) {
			return msg.text.trim().slice(0, 200);
		}
	}
	// Fallback: use first message with text
	for (const msg of messages) {
		if (msg.text?.trim()) {
			return msg.text.trim().slice(0, 200);
		}
	}
	return '';
}

/**
 * Cline Session Storage Implementation
 *
 * Provides access to Cline's local session storage at ~/.cline/data/tasks/
 */
export class ClineSessionStorage implements AgentSessionStorage {
	readonly agentId: ToolType = 'cline';

	/**
	 * Read JSON file from remote host via SSH
	 */
	private async readJsonFileRemote<T>(
		filePath: string,
		sshConfig: SshRemoteConfig
	): Promise<T | null> {
		try {
			const result = await readFileRemote(filePath, sshConfig);
			if (!result.success || !result.data) {
				logger.debug(`Failed to read remote JSON file: ${filePath}`, LOG_CONTEXT);
				return null;
			}
			return JSON.parse(result.data) as T;
		} catch (error) {
			logger.debug(`Failed to parse remote JSON file: ${filePath}`, LOG_CONTEXT, { error });
			return null;
		}
	}

	/**
	 * List sessions from remote host via SSH
	 */
	private async listSessionsRemote(
		projectPath: string,
		sshConfig: SshRemoteConfig
	): Promise<AgentSessionInfo[]> {
		const tasksDir = getRemoteClineTasksDir();

		const dirResult = await readDirRemote(tasksDir, sshConfig);
		if (!dirResult.success || !dirResult.data) {
			logger.info(`No Cline sessions directory found on remote`, LOG_CONTEXT);
			return [];
		}

		// Each subdirectory is a taskId
		const taskDirs = dirResult.data.filter((entry) => entry.isDirectory);
		const sessions: AgentSessionInfo[] = [];

		for (const entry of taskDirs) {
			const taskId = entry.name;
			const metadataPath = `${tasksDir}/${taskId}/task_metadata.json`;
			const messagesPath = `${tasksDir}/${taskId}/cline_messages.json`;

			try {
				const metadata = await this.readJsonFileRemote<ClineTaskMetadata>(metadataPath, sshConfig);
				if (!metadata) {
					logger.warn(`Missing task_metadata.json for Cline task ${taskId}, skipping`, LOG_CONTEXT);
					continue;
				}

				// Filter by projectPath if metadata has cwd
				if (metadata.cwd && projectPath) {
					if (!isSessionForProject(metadata.cwd, projectPath)) {
						continue;
					}
				}

				// Load messages for preview and count
				const messages = await this.readJsonFileRemote<ClineMessage[]>(messagesPath, sshConfig);
				const messageArray = Array.isArray(messages) ? messages : [];

				const previewText = metadata.task?.slice(0, 200) || extractPreviewText(messageArray);

				// Count meaningful messages (say text/tool entries)
				const messageCount = messageArray.filter(
					(m) => m.type === 'say' && (m.say === 'text' || m.say === 'tool' || m.say === 'task')
				).length;

				// Timestamps
				const createdTs = metadata.ts
					? new Date(metadata.ts).toISOString()
					: new Date().toISOString();
				const lastTs =
					messageArray.length > 0 && messageArray[messageArray.length - 1].ts
						? new Date(messageArray[messageArray.length - 1].ts!).toISOString()
						: createdTs;

				// Duration
				let durationSeconds = 0;
				if (messageArray.length >= 2) {
					const firstTime = messageArray[0].ts || 0;
					const lastTime = messageArray[messageArray.length - 1].ts || 0;
					durationSeconds = Math.max(0, Math.floor((lastTime - firstTime) / 1000));
				}

				sessions.push({
					sessionId: taskId,
					projectPath: metadata.cwd || projectPath,
					timestamp: createdTs,
					modifiedAt: lastTs,
					firstMessage: previewText || 'Cline session',
					messageCount,
					sizeBytes: 0, // Size not available without stat on remote messages file
					costUsd: metadata.totalCost,
					inputTokens: metadata.tokensIn || 0,
					outputTokens: metadata.tokensOut || 0,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					durationSeconds,
				});
			} catch (e) {
				logger.warn(`Error reading remote Cline session ${taskId}`, LOG_CONTEXT, { error: e });
			}
		}

		// Sort by timestamp descending (newest first)
		sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

		logger.info(
			`Found ${sessions.length} Cline sessions for project: ${projectPath} (remote via SSH)`,
			LOG_CONTEXT
		);
		return sessions;
	}

	async listSessions(
		projectPath: string,
		sshConfig?: SshRemoteConfig
	): Promise<AgentSessionInfo[]> {
		// Use SSH remote access if config provided
		if (sshConfig) {
			return this.listSessionsRemote(projectPath, sshConfig);
		}

		const tasksDir = getClineTasksDir();

		try {
			await fs.access(tasksDir);
		} catch {
			logger.info(`No Cline sessions directory found`, LOG_CONTEXT);
			return [];
		}

		const entries = await fs.readdir(tasksDir, { withFileTypes: true });
		const sessions: AgentSessionInfo[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const taskId = entry.name;
			const taskDir = path.join(tasksDir, taskId);
			const metadataPath = path.join(taskDir, 'task_metadata.json');
			const messagesPath = path.join(taskDir, 'cline_messages.json');

			try {
				const metadata = await readJsonFile<ClineTaskMetadata>(metadataPath);
				if (!metadata) {
					logger.warn(`Missing task_metadata.json for Cline task ${taskId}, skipping`, LOG_CONTEXT);
					continue;
				}

				// Filter by projectPath if metadata has cwd
				if (metadata.cwd && projectPath) {
					if (!isSessionForProject(metadata.cwd, projectPath)) {
						continue;
					}
				}

				// Load messages for preview and count
				const messages = await readJsonFile<ClineMessage[]>(messagesPath);
				const messageArray = Array.isArray(messages) ? messages : [];

				const previewText = metadata.task?.slice(0, 200) || extractPreviewText(messageArray);

				// Count meaningful messages (say text/tool entries and task prompts)
				const messageCount = messageArray.filter(
					(m) => m.type === 'say' && (m.say === 'text' || m.say === 'tool' || m.say === 'task')
				).length;

				// Get file stat for size
				let sizeBytes = 0;
				try {
					const stat = await fs.stat(messagesPath);
					sizeBytes = stat.size;
				} catch {
					// Messages file may not exist
				}

				// Timestamps
				const createdTs = metadata.ts
					? new Date(metadata.ts).toISOString()
					: new Date().toISOString();
				const lastTs =
					messageArray.length > 0 && messageArray[messageArray.length - 1].ts
						? new Date(messageArray[messageArray.length - 1].ts!).toISOString()
						: createdTs;

				// Duration
				let durationSeconds = 0;
				if (messageArray.length >= 2) {
					const firstTime = messageArray[0].ts || 0;
					const lastTime = messageArray[messageArray.length - 1].ts || 0;
					durationSeconds = Math.max(0, Math.floor((lastTime - firstTime) / 1000));
				}

				sessions.push({
					sessionId: taskId,
					projectPath: metadata.cwd || projectPath,
					timestamp: createdTs,
					modifiedAt: lastTs,
					firstMessage: previewText || 'Cline session',
					messageCount,
					sizeBytes,
					costUsd: metadata.totalCost,
					inputTokens: metadata.tokensIn || 0,
					outputTokens: metadata.tokensOut || 0,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					durationSeconds,
				});
			} catch (e) {
				logger.warn(`Error reading Cline session ${taskId}`, LOG_CONTEXT, { error: e });
			}
		}

		// Sort by timestamp descending (newest first)
		sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

		logger.info(`Found ${sessions.length} Cline sessions for project: ${projectPath}`, LOG_CONTEXT);
		return sessions;
	}

	async listSessionsPaginated(
		projectPath: string,
		options?: SessionListOptions,
		sshConfig?: SshRemoteConfig
	): Promise<PaginatedSessionsResult> {
		const allSessions = await this.listSessions(projectPath, sshConfig);
		const { cursor, limit = 100 } = options || {};

		let startIndex = 0;
		if (cursor) {
			const cursorIndex = allSessions.findIndex((s) => s.sessionId === cursor);
			startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
		}

		const pageSessions = allSessions.slice(startIndex, startIndex + limit);
		const hasMore = startIndex + limit < allSessions.length;
		const nextCursor = hasMore ? pageSessions[pageSessions.length - 1]?.sessionId : null;

		return {
			sessions: pageSessions,
			hasMore,
			totalCount: allSessions.length,
			nextCursor,
		};
	}

	async readSessionMessages(
		_projectPath: string,
		sessionId: string,
		options?: SessionReadOptions,
		sshConfig?: SshRemoteConfig
	): Promise<SessionMessagesResult> {
		let clineMessages: ClineMessage[];

		if (sshConfig) {
			const messagesPath = `${getRemoteClineTasksDir()}/${sessionId}/cline_messages.json`;
			const messages = await this.readJsonFileRemote<ClineMessage[]>(messagesPath, sshConfig);
			clineMessages = Array.isArray(messages) ? messages : [];
		} else {
			const messagesPath = path.join(getClineTasksDir(), sessionId, 'cline_messages.json');
			const messages = await readJsonFile<ClineMessage[]>(messagesPath);
			clineMessages = Array.isArray(messages) ? messages : [];
		}

		if (clineMessages.length === 0) {
			return { messages: [], total: 0, hasMore: false };
		}

		const sessionMessages: SessionMessage[] = [];

		for (let i = 0; i < clineMessages.length; i++) {
			const msg = clineMessages[i];
			if (!msg.text?.trim() && !msg.images?.length) continue;

			const timestamp = msg.ts ? new Date(msg.ts).toISOString() : '';
			const uuid = `cline-msg-${i}`;

			if (msg.type === 'say') {
				if (msg.say === 'task') {
					// Initial task prompt -> user message
					sessionMessages.push({
						type: 'user',
						role: 'user',
						content: msg.text || '',
						timestamp,
						uuid,
					});
				} else if (msg.say === 'text') {
					// Text response -> assistant message
					sessionMessages.push({
						type: 'assistant',
						role: 'assistant',
						content: msg.text || '',
						timestamp,
						uuid,
					});
				} else if (msg.say === 'tool') {
					// Tool use -> assistant message with toolUse
					sessionMessages.push({
						type: 'assistant',
						role: 'assistant',
						content: msg.text || '',
						timestamp,
						uuid,
						toolUse: [{ type: 'tool', text: msg.text }],
					});
				} else if (msg.say === 'user_feedback') {
					// User feedback -> user message
					sessionMessages.push({
						type: 'user',
						role: 'user',
						content: msg.text || '',
						timestamp,
						uuid,
					});
				} else if (msg.say === 'error') {
					// Error -> assistant message
					sessionMessages.push({
						type: 'assistant',
						role: 'assistant',
						content: msg.text || '',
						timestamp,
						uuid,
					});
				} else if (msg.say === 'completion_result') {
					// Completion result -> assistant message
					sessionMessages.push({
						type: 'assistant',
						role: 'assistant',
						content: msg.text || '',
						timestamp,
						uuid,
					});
				}
			} else if (msg.type === 'ask') {
				if (msg.ask === 'followup') {
					// Follow-up question -> assistant message
					sessionMessages.push({
						type: 'assistant',
						role: 'assistant',
						content: msg.text || '',
						timestamp,
						uuid,
					});
				} else if (msg.ask === 'tool') {
					// Tool approval request -> assistant message
					sessionMessages.push({
						type: 'assistant',
						role: 'assistant',
						content: msg.text || '',
						timestamp,
						uuid,
						toolUse: [{ type: 'tool_request', text: msg.text }],
					});
				} else if (msg.ask === 'command') {
					// Command approval request -> assistant message
					sessionMessages.push({
						type: 'assistant',
						role: 'assistant',
						content: msg.text || '',
						timestamp,
						uuid,
						toolUse: [{ type: 'command', text: msg.text }],
					});
				}
			}
		}

		// Apply offset and limit for lazy loading
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? 20;

		const startIndex = Math.max(0, sessionMessages.length - offset - limit);
		const endIndex = sessionMessages.length - offset;
		const slice = sessionMessages.slice(startIndex, endIndex);

		return {
			messages: slice,
			total: sessionMessages.length,
			hasMore: startIndex > 0,
		};
	}

	async searchSessions(
		projectPath: string,
		query: string,
		searchMode: SessionSearchMode,
		sshConfig?: SshRemoteConfig
	): Promise<SessionSearchResult[]> {
		if (!query.trim()) {
			return [];
		}

		const sessions = await this.listSessions(projectPath, sshConfig);
		const searchLower = query.toLowerCase();
		const results: SessionSearchResult[] = [];

		for (const session of sessions) {
			let clineMessages: ClineMessage[];

			if (sshConfig) {
				const messagesPath = `${getRemoteClineTasksDir()}/${session.sessionId}/cline_messages.json`;
				const messages = await this.readJsonFileRemote<ClineMessage[]>(messagesPath, sshConfig);
				clineMessages = Array.isArray(messages) ? messages : [];
			} else {
				const messagesPath = path.join(
					getClineTasksDir(),
					session.sessionId,
					'cline_messages.json'
				);
				const messages = await readJsonFile<ClineMessage[]>(messagesPath);
				clineMessages = Array.isArray(messages) ? messages : [];
			}

			let titleMatch = false;
			let userMatches = 0;
			let assistantMatches = 0;
			let matchPreview = '';

			for (const msg of clineMessages) {
				const textContent = msg.text || '';
				const textLower = textContent.toLowerCase();

				if (!textLower.includes(searchLower)) continue;

				// Determine if this is a user or assistant message
				const isUserMessage =
					(msg.type === 'say' && msg.say === 'task') ||
					(msg.type === 'say' && msg.say === 'user_feedback');
				const isAssistantMessage =
					(msg.type === 'say' &&
						(msg.say === 'text' || msg.say === 'tool' || msg.say === 'completion_result')) ||
					msg.type === 'ask';

				if (isUserMessage) {
					if (!titleMatch) {
						titleMatch = true;
						if (!matchPreview) {
							const idx = textLower.indexOf(searchLower);
							const start = Math.max(0, idx - 60);
							const end = Math.min(textContent.length, idx + query.length + 60);
							matchPreview =
								(start > 0 ? '...' : '') +
								textContent.slice(start, end) +
								(end < textContent.length ? '...' : '');
						}
					}
					userMatches++;
				}

				if (isAssistantMessage) {
					assistantMatches++;
					if (!matchPreview && (searchMode === 'assistant' || searchMode === 'all')) {
						const idx = textLower.indexOf(searchLower);
						const start = Math.max(0, idx - 60);
						const end = Math.min(textContent.length, idx + query.length + 60);
						matchPreview =
							(start > 0 ? '...' : '') +
							textContent.slice(start, end) +
							(end < textContent.length ? '...' : '');
					}
				}
			}

			let matches = false;
			let matchType: 'title' | 'user' | 'assistant' = 'title';
			let matchCount = 0;

			switch (searchMode) {
				case 'title':
					matches = titleMatch;
					matchType = 'title';
					matchCount = titleMatch ? 1 : 0;
					break;
				case 'user':
					matches = userMatches > 0;
					matchType = 'user';
					matchCount = userMatches;
					break;
				case 'assistant':
					matches = assistantMatches > 0;
					matchType = 'assistant';
					matchCount = assistantMatches;
					break;
				case 'all':
					matches = titleMatch || userMatches > 0 || assistantMatches > 0;
					matchType = titleMatch ? 'title' : userMatches > 0 ? 'user' : 'assistant';
					matchCount = userMatches + assistantMatches;
					break;
			}

			if (matches) {
				results.push({
					sessionId: session.sessionId,
					matchType,
					matchPreview,
					matchCount,
				});
			}
		}

		return results;
	}

	getSessionPath(
		_projectPath: string,
		sessionId: string,
		sshConfig?: SshRemoteConfig
	): string | null {
		if (sshConfig) {
			return `${getRemoteClineTasksDir()}/${sessionId}`;
		}
		return path.join(getClineTasksDir(), sessionId);
	}

	async deleteMessagePair(
		_projectPath: string,
		sessionId: string,
		userMessageUuid: string,
		fallbackContent?: string,
		sshConfig?: SshRemoteConfig
	): Promise<{ success: boolean; error?: string; linesRemoved?: number }> {
		// Delete operations on remote sessions are not supported
		if (sshConfig) {
			logger.warn('Delete message pair not supported for SSH remote sessions', LOG_CONTEXT);
			return { success: false, error: 'Delete not supported for remote sessions' };
		}

		try {
			const messagesPath = path.join(getClineTasksDir(), sessionId, 'cline_messages.json');
			const messages = await readJsonFile<ClineMessage[]>(messagesPath);

			if (!Array.isArray(messages) || messages.length === 0) {
				return { success: false, error: 'Session messages not found or empty' };
			}

			// Find the target user message by UUID (format: cline-msg-N)
			let targetIndex = -1;
			const uuidMatch = userMessageUuid.match(/^cline-msg-(\d+)$/);
			if (uuidMatch) {
				const index = parseInt(uuidMatch[1], 10);
				if (index >= 0 && index < messages.length) {
					const msg = messages[index];
					const isUser =
						(msg.type === 'say' && msg.say === 'task') ||
						(msg.type === 'say' && msg.say === 'user_feedback');
					if (isUser) {
						targetIndex = index;
					}
				}
			}

			// Fallback: match by content
			if (targetIndex === -1 && fallbackContent) {
				const normalizedFallback = fallbackContent.trim().toLowerCase();
				for (let i = messages.length - 1; i >= 0; i--) {
					const msg = messages[i];
					const isUser =
						(msg.type === 'say' && msg.say === 'task') ||
						(msg.type === 'say' && msg.say === 'user_feedback');
					if (isUser && msg.text?.trim().toLowerCase() === normalizedFallback) {
						targetIndex = i;
						break;
					}
				}
			}

			if (targetIndex === -1) {
				return { success: false, error: 'User message not found' };
			}

			// Find end of assistant response (next user message)
			let endIndex = messages.length;
			for (let i = targetIndex + 1; i < messages.length; i++) {
				const msg = messages[i];
				const isUser =
					(msg.type === 'say' && msg.say === 'task') ||
					(msg.type === 'say' && msg.say === 'user_feedback');
				if (isUser) {
					endIndex = i;
					break;
				}
			}

			const linesRemoved = endIndex - targetIndex;
			const newMessages = [...messages.slice(0, targetIndex), ...messages.slice(endIndex)];

			await fs.writeFile(messagesPath, JSON.stringify(newMessages, null, 2), 'utf-8');

			logger.info('Deleted message pair from Cline session', LOG_CONTEXT, {
				sessionId,
				userMessageUuid,
				linesRemoved,
			});

			return { success: true, linesRemoved };
		} catch (error) {
			logger.error('Error deleting message pair from Cline session', LOG_CONTEXT, {
				sessionId,
				error,
			});
			captureException(error, { operation: 'clineStorage:deleteMessagePair', sessionId });
			return { success: false, error: String(error) };
		}
	}
}
