/**
 * Cline Output Parser
 *
 * Parses JSONL output from Cline's say/ask message format.
 *
 * Cline outputs JSONL where each line is a JSON object with a type field:
 *
 * 1. Task started:
 *    {"type":"task_started","taskId":"..."}
 *
 * 2. Say events (agent output):
 *    {"type":"say","say":"text","text":"...","partial":true/false}
 *    {"type":"say","say":"reasoning","text":"..."}
 *    {"type":"say","say":"tool","text":"...","partial":true/false}
 *    {"type":"say","say":"completion_result","text":"..."}
 *    {"type":"say","say":"error","text":"..."}
 *    {"type":"say","say":"error_retry","text":"..."}
 *    {"type":"say","say":"api_req_retried","text":"..."}
 *    {"type":"say","say":"task","text":"..."}
 *    {"type":"say","say":"api_req_started","text":"..."}
 *
 * 3. Ask events (waiting for user input):
 *    {"type":"ask","ask":"followup","text":"..."}
 *    {"type":"ask","ask":"plan_mode_respond","text":"..."}
 *    {"type":"ask","ask":"api_req_failed","text":"..."}
 *    {"type":"ask","ask":"tool","text":"..."}
 *
 * 4. Error events:
 *    {"type":"error","message":"..."}
 */

import type { ToolType, AgentError } from '../../shared/types';
import type { AgentOutputParser, ParsedEvent } from './agent-output-parser';
import { getErrorPatterns, matchErrorPattern } from './error-patterns';

/**
 * Raw message structure from Cline JSONL output
 */
interface ClineStreamMessage {
	type: 'task_started' | 'say' | 'ask' | 'error';
	// task_started fields
	taskId?: string;
	// say/ask fields
	say?: string;
	ask?: string;
	text?: string;
	partial?: boolean;
	reasoning?: string;
	// error fields
	message?: string;
}

/**
 * Type guard to validate parsed JSON has a recognizable Cline message structure
 */
function isClineStreamMessage(data: unknown): data is ClineStreamMessage {
	if (typeof data !== 'object' || data === null) {
		return false;
	}
	const obj = data as Record<string, unknown>;
	return typeof obj.type === 'string' && ['task_started', 'say', 'ask', 'error'].includes(obj.type);
}

/**
 * Extract a tool name from Cline tool text using heuristic mapping
 */
function extractToolName(text: string | undefined): string {
	if (!text) return 'tool';

	const lower = text.toLowerCase();

	if (/writ(ing|e)\s+file/i.test(lower) || /write_to_file/i.test(lower)) return 'write_file';
	if (/read(ing)?\s+file/i.test(lower) || /read_file/i.test(lower)) return 'read_file';
	if (/edit(ing)?\s+file/i.test(lower) || /apply_diff/i.test(lower)) return 'edit_file';
	if (/list(ing)?\s+files/i.test(lower) || /list_files/i.test(lower)) return 'list_files';
	if (
		/execut(ing|e)\s+command/i.test(lower) ||
		/running\s+command/i.test(lower) ||
		/bash/i.test(lower) ||
		/shell/i.test(lower) ||
		/execute_command/i.test(lower)
	)
		return 'execute_command';
	if (/browser/i.test(lower) || /screenshot/i.test(lower) || /browser_action/i.test(lower))
		return 'browser_action';

	return 'tool';
}

/**
 * Try to parse nested JSON error message from api_req_failed text
 */
function parseApiReqFailedText(text: string | undefined): string {
	if (!text) return 'API request failed';

	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		if (typeof parsed.message === 'string') return parsed.message;
		if (typeof parsed.error === 'string') return parsed.error;
		if (typeof parsed.error === 'object' && parsed.error !== null) {
			const errObj = parsed.error as Record<string, unknown>;
			if (typeof errObj.message === 'string') return errObj.message;
		}
	} catch {
		// Not nested JSON, return as-is
	}

	return text || 'API request failed';
}

/**
 * Cline Output Parser Implementation
 *
 * Transforms Cline's JSONL say/ask format into normalized ParsedEvents.
 */
export class ClineOutputParser implements AgentOutputParser {
	readonly agentId: ToolType = 'cline';

	/**
	 * Parse a single JSON line from Cline output
	 */
	parseJsonLine(line: string): ParsedEvent | null {
		if (!line.trim()) {
			return null;
		}

		try {
			const parsed: unknown = JSON.parse(line);

			if (!isClineStreamMessage(parsed)) {
				// Valid JSON but not a Cline message - return as raw text
				return {
					type: 'text',
					text: line,
					isPartial: true,
					raw: parsed,
				};
			}

			const data = parsed;

			switch (data.type) {
				case 'task_started':
					return this.parseTaskStarted(data);

				case 'say':
					return this.parseSayEvent(data);

				case 'ask':
					return this.parseAskEvent(data);

				case 'error':
					return {
						type: 'error',
						text: data.message || 'Unknown error',
						raw: data,
					};

				default:
					// Unknown type - graceful fallback
					return {
						type: 'text',
						text: line,
						raw: data,
					};
			}
		} catch {
			// Not valid JSON - return as raw text
			if (line.trim()) {
				return {
					type: 'text',
					text: line,
					isPartial: true,
					raw: line,
				};
			}
			return null;
		}
	}

	/**
	 * Parse task_started event
	 */
	private parseTaskStarted(data: ClineStreamMessage): ParsedEvent {
		return {
			type: 'init',
			sessionId: data.taskId,
			text: 'Task started',
			raw: data,
		};
	}

	/**
	 * Parse say events (agent output)
	 */
	private parseSayEvent(data: ClineStreamMessage): ParsedEvent {
		const text = data.text || '[Empty message]';

		switch (data.say) {
			case 'text':
				return {
					type: 'text',
					text,
					isPartial: data.partial === true,
					raw: data,
				};

			case 'reasoning':
				return {
					type: 'text',
					text,
					isPartial: true,
					raw: data,
				};

			case 'task':
			case 'api_req_started':
				return {
					type: 'text',
					text,
					raw: data,
				};

			case 'completion_result':
				return {
					type: 'result',
					text,
					raw: data,
				};

			case 'tool':
				return {
					type: 'tool_use',
					toolName: extractToolName(text),
					toolState: data.partial ? 'running' : 'completed',
					text,
					raw: data,
				};

			case 'error_retry':
			case 'api_req_retried':
				return {
					type: 'text',
					text: `[Retry] ${text}`,
					raw: data,
				};

			case 'error':
				return {
					type: 'error',
					text,
					raw: data,
				};

			default:
				// Unknown say type - graceful fallback
				return {
					type: 'text',
					text,
					raw: data,
				};
		}
	}

	/**
	 * Parse ask events (waiting for user input)
	 */
	private parseAskEvent(data: ClineStreamMessage): ParsedEvent {
		const text = data.text || '[Empty message]';

		switch (data.ask) {
			case 'followup':
			case 'plan_mode_respond':
				return {
					type: 'result',
					text,
					raw: data,
				};

			case 'api_req_failed':
				return {
					type: 'error',
					text: parseApiReqFailedText(data.text),
					raw: data,
				};

			case 'tool':
				return {
					type: 'tool_use',
					toolName: extractToolName(text),
					toolState: 'pending_approval',
					text,
					raw: data,
				};

			default:
				// Unknown ask type - graceful fallback
				return {
					type: 'text',
					text,
					raw: data,
				};
		}
	}

	/**
	 * Check if an event is a final result message
	 */
	isResultMessage(event: ParsedEvent): boolean {
		return event.type === 'result' && !!event.text;
	}

	/**
	 * Extract session ID from an event
	 */
	extractSessionId(event: ParsedEvent): string | null {
		if (event.type === 'init' && event.sessionId) {
			return event.sessionId;
		}
		return null;
	}

	/**
	 * Extract usage statistics from an event
	 * NOTE: Cline doesn't emit usage in JSON stream
	 */
	extractUsage(_event: ParsedEvent): ParsedEvent['usage'] | null {
		return null;
	}

	/**
	 * Extract slash commands from an event
	 * NOTE: Cline doesn't use slash commands
	 */
	extractSlashCommands(_event: ParsedEvent): string[] | null {
		return null;
	}

	/**
	 * Detect an error from a line of agent output
	 */
	detectErrorFromLine(line: string): AgentError | null {
		if (!line.trim()) {
			return null;
		}

		let errorText: string | null = null;
		let parsedJson: unknown = null;

		try {
			const parsed = JSON.parse(line) as ClineStreamMessage;

			// Cline error formats
			if (parsed.type === 'error' && parsed.message) {
				parsedJson = parsed;
				errorText = parsed.message;
			} else if (parsed.type === 'say' && parsed.say === 'error' && parsed.text) {
				parsedJson = parsed;
				errorText = parsed.text;
			} else if (parsed.type === 'ask' && parsed.ask === 'api_req_failed' && parsed.text) {
				parsedJson = parsed;
				errorText = parseApiReqFailedText(parsed.text);
			}
		} catch {
			// Not JSON - skip
		}

		if (!errorText) {
			return null;
		}

		// Match against error patterns
		const patterns = getErrorPatterns(this.agentId);
		const match = matchErrorPattern(patterns, errorText);

		if (match) {
			return {
				type: match.type,
				message: match.message,
				recoverable: match.recoverable,
				agentId: this.agentId,
				timestamp: Date.now(),
				raw: { errorLine: line },
				parsedJson,
			};
		}

		// Return generic error if no pattern matched
		return {
			type: 'unknown',
			message: errorText,
			recoverable: true,
			agentId: this.agentId,
			timestamp: Date.now(),
			raw: { errorLine: line },
			parsedJson,
		};
	}

	/**
	 * Detect an error from process exit information
	 */
	detectErrorFromExit(exitCode: number, stderr: string, stdout: string): AgentError | null {
		// Exit code 0 is success
		if (exitCode === 0) {
			return null;
		}

		// Check stderr and stdout for error patterns
		const combined = `${stderr}\n${stdout}`;
		const patterns = getErrorPatterns(this.agentId);
		const match = matchErrorPattern(patterns, combined);

		if (match) {
			return {
				type: match.type,
				message: match.message,
				recoverable: match.recoverable,
				agentId: this.agentId,
				timestamp: Date.now(),
				raw: { exitCode, stderr, stdout },
			};
		}

		// Non-zero exit with no recognized pattern
		const stderrPreview = stderr?.trim()
			? `: ${stderr.trim().split('\n')[0].substring(0, 200)}`
			: '';
		return {
			type: 'agent_crashed',
			message: `Cline exited with code ${exitCode}${stderrPreview}`,
			recoverable: true,
			agentId: this.agentId,
			timestamp: Date.now(),
			raw: { exitCode, stderr, stdout },
		};
	}
}
