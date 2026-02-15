import { describe, it, expect } from 'vitest';
import { ClineOutputParser } from '../../../main/parsers/cline-output-parser';

describe('ClineOutputParser', () => {
	const parser = new ClineOutputParser();

	describe('agentId', () => {
		it('should be cline', () => {
			expect(parser.agentId).toBe('cline');
		});
	});

	describe('parseJsonLine', () => {
		it('should return null for empty lines', () => {
			expect(parser.parseJsonLine('')).toBeNull();
			expect(parser.parseJsonLine('  ')).toBeNull();
			expect(parser.parseJsonLine('\n')).toBeNull();
		});

		describe('task_started events', () => {
			it('should parse task_started as init with taskId as sessionId', () => {
				const line = JSON.stringify({
					type: 'task_started',
					taskId: 'task-abc-123',
				});

				const event = parser.parseJsonLine(line);
				expect(event).not.toBeNull();
				expect(event?.type).toBe('init');
				expect(event?.sessionId).toBe('task-abc-123');
				expect(event?.text).toBe('Task started');
			});

			it('should handle task_started without taskId', () => {
				const line = JSON.stringify({ type: 'task_started' });

				const event = parser.parseJsonLine(line);
				expect(event).not.toBeNull();
				expect(event?.type).toBe('init');
				expect(event?.sessionId).toBeUndefined();
			});
		});

		describe('say events', () => {
			describe('say: text', () => {
				it('should parse say text as text event', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'text',
						text: 'Hello, I will help you with that.',
					});

					const event = parser.parseJsonLine(line);
					expect(event).not.toBeNull();
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('Hello, I will help you with that.');
					expect(event?.isPartial).toBeFalsy();
				});

				it('should parse partial say text with isPartial true', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'text',
						text: 'Working on it...',
						partial: true,
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('text');
					expect(event?.isPartial).toBe(true);
				});

				it('should handle say text with empty text', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'text',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('[Empty message]');
				});
			});

			describe('say: reasoning', () => {
				it('should parse say reasoning as text event', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'reasoning',
						text: 'I need to analyze the codebase first...',
					});

					const event = parser.parseJsonLine(line);
					expect(event).not.toBeNull();
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('I need to analyze the codebase first...');
					expect(event?.isPartial).toBe(true);
				});
			});

			describe('say: task', () => {
				it('should parse say task as text event', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'task',
						text: 'Implementing feature X',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('Implementing feature X');
				});
			});

			describe('say: api_req_started', () => {
				it('should parse say api_req_started as text event', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'api_req_started',
						text: 'Sending request to API...',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('Sending request to API...');
				});
			});

			describe('say: completion_result', () => {
				it('should parse say completion_result as result event', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'completion_result',
						text: 'Task completed successfully. I have updated the file.',
					});

					const event = parser.parseJsonLine(line);
					expect(event).not.toBeNull();
					expect(event?.type).toBe('result');
					expect(event?.text).toBe('Task completed successfully. I have updated the file.');
				});
			});

			describe('say: tool', () => {
				it('should parse say tool as tool_use event with running state when partial', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'tool',
						text: 'Writing file src/index.ts',
						partial: true,
					});

					const event = parser.parseJsonLine(line);
					expect(event).not.toBeNull();
					expect(event?.type).toBe('tool_use');
					expect(event?.toolName).toBe('write_file');
					expect(event?.toolState).toBe('running');
				});

				it('should parse say tool as tool_use event with completed state when not partial', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'tool',
						text: 'Reading file src/index.ts',
						partial: false,
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('tool_use');
					expect(event?.toolName).toBe('read_file');
					expect(event?.toolState).toBe('completed');
				});

				it('should extract write_file tool name', () => {
					const event = parser.parseJsonLine(
						JSON.stringify({ type: 'say', say: 'tool', text: 'write_to_file at path' })
					);
					expect(event?.toolName).toBe('write_file');
				});

				it('should extract edit_file tool name', () => {
					const event = parser.parseJsonLine(
						JSON.stringify({ type: 'say', say: 'tool', text: 'apply_diff to file' })
					);
					expect(event?.toolName).toBe('edit_file');
				});

				it('should extract list_files tool name', () => {
					const event = parser.parseJsonLine(
						JSON.stringify({ type: 'say', say: 'tool', text: 'list_files in directory' })
					);
					expect(event?.toolName).toBe('list_files');
				});

				it('should extract execute_command tool name', () => {
					const event = parser.parseJsonLine(
						JSON.stringify({ type: 'say', say: 'tool', text: 'execute_command: npm install' })
					);
					expect(event?.toolName).toBe('execute_command');
				});

				it('should extract execute_command from "running command"', () => {
					const event = parser.parseJsonLine(
						JSON.stringify({ type: 'say', say: 'tool', text: 'running command: ls -la' })
					);
					expect(event?.toolName).toBe('execute_command');
				});

				it('should extract browser_action tool name', () => {
					const event = parser.parseJsonLine(
						JSON.stringify({ type: 'say', say: 'tool', text: 'browser_action: screenshot' })
					);
					expect(event?.toolName).toBe('browser_action');
				});

				it('should fallback to generic tool name', () => {
					const event = parser.parseJsonLine(
						JSON.stringify({ type: 'say', say: 'tool', text: 'some unknown tool action' })
					);
					expect(event?.toolName).toBe('tool');
				});

				it('should handle tool with no text', () => {
					const event = parser.parseJsonLine(JSON.stringify({ type: 'say', say: 'tool' }));
					expect(event?.toolName).toBe('tool');
				});
			});

			describe('say: error_retry', () => {
				it('should parse say error_retry as text with [Retry] prefix', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'error_retry',
						text: 'Retrying after API error...',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('[Retry] Retrying after API error...');
				});
			});

			describe('say: api_req_retried', () => {
				it('should parse say api_req_retried as text with [Retry] prefix', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'api_req_retried',
						text: 'Request retried successfully',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('[Retry] Request retried successfully');
				});
			});

			describe('say: error', () => {
				it('should parse say error as error event', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'error',
						text: 'Something went wrong',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('error');
					expect(event?.text).toBe('Something went wrong');
				});
			});

			describe('unknown say type', () => {
				it('should gracefully fallback to text for unknown say types', () => {
					const line = JSON.stringify({
						type: 'say',
						say: 'unknown_say_type',
						text: 'Some content',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('Some content');
				});
			});
		});

		describe('ask events', () => {
			describe('ask: followup', () => {
				it('should parse ask followup as result event', () => {
					const line = JSON.stringify({
						type: 'ask',
						ask: 'followup',
						text: 'Would you like me to continue?',
					});

					const event = parser.parseJsonLine(line);
					expect(event).not.toBeNull();
					expect(event?.type).toBe('result');
					expect(event?.text).toBe('Would you like me to continue?');
				});
			});

			describe('ask: plan_mode_respond', () => {
				it('should parse ask plan_mode_respond as result event', () => {
					const line = JSON.stringify({
						type: 'ask',
						ask: 'plan_mode_respond',
						text: 'Here is my plan for this task...',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('result');
					expect(event?.text).toBe('Here is my plan for this task...');
				});
			});

			describe('ask: api_req_failed', () => {
				it('should parse ask api_req_failed as error event', () => {
					const line = JSON.stringify({
						type: 'ask',
						ask: 'api_req_failed',
						text: 'Connection timed out',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('error');
					expect(event?.text).toBe('Connection timed out');
				});

				it('should parse nested JSON error message from api_req_failed', () => {
					const nestedError = JSON.stringify({ message: 'Rate limit exceeded' });
					const line = JSON.stringify({
						type: 'ask',
						ask: 'api_req_failed',
						text: nestedError,
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('error');
					expect(event?.text).toBe('Rate limit exceeded');
				});

				it('should parse nested JSON with error field', () => {
					const nestedError = JSON.stringify({ error: 'Invalid API key' });
					const line = JSON.stringify({
						type: 'ask',
						ask: 'api_req_failed',
						text: nestedError,
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('error');
					expect(event?.text).toBe('Invalid API key');
				});

				it('should parse nested JSON with error.message', () => {
					const nestedError = JSON.stringify({ error: { message: 'Unauthorized' } });
					const line = JSON.stringify({
						type: 'ask',
						ask: 'api_req_failed',
						text: nestedError,
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('error');
					expect(event?.text).toBe('Unauthorized');
				});

				it('should handle api_req_failed with no text', () => {
					const line = JSON.stringify({
						type: 'ask',
						ask: 'api_req_failed',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('error');
					expect(event?.text).toBe('API request failed');
				});
			});

			describe('ask: tool', () => {
				it('should parse ask tool as tool_use with pending_approval state', () => {
					const line = JSON.stringify({
						type: 'ask',
						ask: 'tool',
						text: 'Writing file src/main.ts',
					});

					const event = parser.parseJsonLine(line);
					expect(event).not.toBeNull();
					expect(event?.type).toBe('tool_use');
					expect(event?.toolName).toBe('write_file');
					expect(event?.toolState).toBe('pending_approval');
				});
			});

			describe('unknown ask type', () => {
				it('should gracefully fallback to text for unknown ask types', () => {
					const line = JSON.stringify({
						type: 'ask',
						ask: 'unknown_ask_type',
						text: 'Some question',
					});

					const event = parser.parseJsonLine(line);
					expect(event?.type).toBe('text');
					expect(event?.text).toBe('Some question');
				});
			});
		});

		describe('error events', () => {
			it('should parse top-level error events', () => {
				const line = JSON.stringify({
					type: 'error',
					message: 'Process crashed unexpectedly',
				});

				const event = parser.parseJsonLine(line);
				expect(event).not.toBeNull();
				expect(event?.type).toBe('error');
				expect(event?.text).toBe('Process crashed unexpectedly');
			});

			it('should handle error with no message', () => {
				const line = JSON.stringify({ type: 'error' });

				const event = parser.parseJsonLine(line);
				expect(event?.type).toBe('error');
				expect(event?.text).toBe('Unknown error');
			});
		});

		describe('non-JSON lines', () => {
			it('should handle non-JSON as text', () => {
				const event = parser.parseJsonLine('not valid json');
				expect(event).not.toBeNull();
				expect(event?.type).toBe('text');
				expect(event?.text).toBe('not valid json');
				expect(event?.isPartial).toBe(true);
			});
		});

		describe('valid JSON but not Cline message', () => {
			it('should handle valid JSON without recognized type as text', () => {
				const line = JSON.stringify({ data: 'some unknown data' });

				const event = parser.parseJsonLine(line);
				expect(event?.type).toBe('text');
				expect(event?.text).toBe(line);
			});

			it('should handle JSON with unrecognized type field as text', () => {
				const line = JSON.stringify({ type: 'unknown_type', data: 'something' });

				const event = parser.parseJsonLine(line);
				expect(event?.type).toBe('text');
				expect(event?.text).toBe(line);
			});
		});

		it('should preserve raw message', () => {
			const original = {
				type: 'task_started',
				taskId: 'test-123',
			};
			const line = JSON.stringify(original);

			const event = parser.parseJsonLine(line);
			expect(event?.raw).toEqual(original);
		});
	});

	describe('isResultMessage', () => {
		it('should return true for completion_result events with text', () => {
			const event = parser.parseJsonLine(
				JSON.stringify({
					type: 'say',
					say: 'completion_result',
					text: 'Task completed.',
				})
			);
			expect(event).not.toBeNull();
			expect(parser.isResultMessage(event!)).toBe(true);
		});

		it('should return true for followup ask events with text', () => {
			const event = parser.parseJsonLine(
				JSON.stringify({
					type: 'ask',
					ask: 'followup',
					text: 'Would you like to continue?',
				})
			);
			expect(event).not.toBeNull();
			expect(parser.isResultMessage(event!)).toBe(true);
		});

		it('should return false for non-result events', () => {
			const initEvent = parser.parseJsonLine(
				JSON.stringify({ type: 'task_started', taskId: 'test-123' })
			);
			expect(parser.isResultMessage(initEvent!)).toBe(false);

			const textEvent = parser.parseJsonLine(
				JSON.stringify({ type: 'say', say: 'text', text: 'Hello' })
			);
			expect(parser.isResultMessage(textEvent!)).toBe(false);

			const toolEvent = parser.parseJsonLine(
				JSON.stringify({ type: 'say', say: 'tool', text: 'read_file something' })
			);
			expect(parser.isResultMessage(toolEvent!)).toBe(false);
		});

		it('should return false for result events without text', () => {
			// Manually construct a result event with no text
			expect(parser.isResultMessage({ type: 'result' })).toBe(false);
			expect(parser.isResultMessage({ type: 'result', text: '' })).toBe(false);
		});
	});

	describe('extractSessionId', () => {
		it('should extract session ID from task_started event', () => {
			const event = parser.parseJsonLine(
				JSON.stringify({ type: 'task_started', taskId: 'cline-session-xyz' })
			);
			expect(parser.extractSessionId(event!)).toBe('cline-session-xyz');
		});

		it('should return null for non-init events', () => {
			const event = parser.parseJsonLine(
				JSON.stringify({ type: 'say', say: 'text', text: 'Hello' })
			);
			expect(parser.extractSessionId(event!)).toBeNull();
		});

		it('should return null for init event without sessionId', () => {
			const event = parser.parseJsonLine(JSON.stringify({ type: 'task_started' }));
			expect(parser.extractSessionId(event!)).toBeNull();
		});
	});

	describe('extractUsage', () => {
		it('should return null - Cline does not emit usage in JSON stream', () => {
			const event = parser.parseJsonLine(
				JSON.stringify({ type: 'task_started', taskId: 'test-123' })
			);
			expect(parser.extractUsage(event!)).toBeNull();
		});

		it('should return null for all event types', () => {
			const textEvent = parser.parseJsonLine(
				JSON.stringify({ type: 'say', say: 'text', text: 'Hello' })
			);
			expect(parser.extractUsage(textEvent!)).toBeNull();

			const resultEvent = parser.parseJsonLine(
				JSON.stringify({ type: 'say', say: 'completion_result', text: 'Done' })
			);
			expect(parser.extractUsage(resultEvent!)).toBeNull();
		});
	});

	describe('extractSlashCommands', () => {
		it('should return null - Cline does not support slash commands', () => {
			const event = parser.parseJsonLine(
				JSON.stringify({ type: 'task_started', taskId: 'test-123' })
			);
			expect(parser.extractSlashCommands(event!)).toBeNull();
		});
	});

	describe('detectErrorFromLine', () => {
		it('should return null for empty lines', () => {
			expect(parser.detectErrorFromLine('')).toBeNull();
			expect(parser.detectErrorFromLine('   ')).toBeNull();
		});

		it('should detect auth errors from top-level error JSON', () => {
			const line = JSON.stringify({ type: 'error', message: 'invalid api key provided' });
			const error = parser.detectErrorFromLine(line);
			expect(error).not.toBeNull();
			expect(error?.type).toBe('auth_expired');
			expect(error?.agentId).toBe('cline');
		});

		it('should detect auth errors from say error JSON', () => {
			const line = JSON.stringify({ type: 'say', say: 'error', text: 'unauthorized access' });
			const error = parser.detectErrorFromLine(line);
			expect(error).not.toBeNull();
			expect(error?.type).toBe('auth_expired');
		});

		it('should detect rate limit errors from api_req_failed', () => {
			const nestedError = JSON.stringify({ message: 'rate limit exceeded' });
			const line = JSON.stringify({ type: 'ask', ask: 'api_req_failed', text: nestedError });
			const error = parser.detectErrorFromLine(line);
			expect(error).not.toBeNull();
			expect(error?.type).toBe('rate_limited');
		});

		it('should detect network errors', () => {
			const line = JSON.stringify({ type: 'error', message: 'ECONNREFUSED' });
			const error = parser.detectErrorFromLine(line);
			expect(error).not.toBeNull();
			expect(error?.type).toBe('network_error');
		});

		it('should detect token exhaustion errors', () => {
			const line = JSON.stringify({ type: 'say', say: 'error', text: 'context window exceeded' });
			const error = parser.detectErrorFromLine(line);
			expect(error).not.toBeNull();
			expect(error?.type).toBe('token_exhaustion');
		});

		it('should detect permission denied errors', () => {
			const line = JSON.stringify({ type: 'error', message: 'EACCES: permission denied' });
			const error = parser.detectErrorFromLine(line);
			expect(error).not.toBeNull();
			expect(error?.type).toBe('permission_denied');
		});

		it('should detect agent crashed errors', () => {
			const line = JSON.stringify({ type: 'error', message: 'fatal error in process' });
			const error = parser.detectErrorFromLine(line);
			expect(error).not.toBeNull();
			expect(error?.type).toBe('agent_crashed');
			expect(error?.recoverable).toBe(false);
		});

		it('should return generic unknown error for unrecognized error patterns', () => {
			const line = JSON.stringify({ type: 'error', message: 'something bizarre happened' });
			const error = parser.detectErrorFromLine(line);
			expect(error).not.toBeNull();
			expect(error?.type).toBe('unknown');
			expect(error?.message).toBe('something bizarre happened');
			expect(error?.recoverable).toBe(true);
		});

		it('should return null for non-error JSON lines', () => {
			const line = JSON.stringify({ type: 'say', say: 'text', text: 'Hello' });
			expect(parser.detectErrorFromLine(line)).toBeNull();
		});

		it('should return null for non-JSON lines', () => {
			expect(parser.detectErrorFromLine('just some normal output')).toBeNull();
		});

		it('should include raw error info and parsedJson', () => {
			const line = JSON.stringify({ type: 'error', message: 'unauthorized' });
			const error = parser.detectErrorFromLine(line);
			expect(error?.raw).toEqual({ errorLine: line });
			expect(error?.parsedJson).toEqual({ type: 'error', message: 'unauthorized' });
		});

		it('should include timestamp and agentId', () => {
			const line = JSON.stringify({ type: 'error', message: 'some error' });
			const before = Date.now();
			const error = parser.detectErrorFromLine(line);
			const after = Date.now();
			expect(error?.agentId).toBe('cline');
			expect(error?.timestamp).toBeGreaterThanOrEqual(before);
			expect(error?.timestamp).toBeLessThanOrEqual(after);
		});
	});

	describe('detectErrorFromExit', () => {
		it('should return null for exit code 0', () => {
			expect(parser.detectErrorFromExit(0, '', '')).toBeNull();
		});

		it('should detect errors from stderr', () => {
			const error = parser.detectErrorFromExit(1, 'invalid api key', '');
			expect(error).not.toBeNull();
			expect(error?.type).toBe('auth_expired');
		});

		it('should detect errors from stdout', () => {
			const error = parser.detectErrorFromExit(1, '', 'rate limit exceeded');
			expect(error).not.toBeNull();
			expect(error?.type).toBe('rate_limited');
		});

		it('should return agent_crashed for unknown non-zero exit', () => {
			const error = parser.detectErrorFromExit(137, '', '');
			expect(error).not.toBeNull();
			expect(error?.type).toBe('agent_crashed');
			expect(error?.message).toContain('137');
			expect(error?.message).toContain('Cline');
		});

		it('should include stderr preview in crash message', () => {
			const error = parser.detectErrorFromExit(1, 'some stderr output', '');
			expect(error).not.toBeNull();
			expect(error?.message).toContain('some stderr output');
		});

		it('should include raw exit info', () => {
			const error = parser.detectErrorFromExit(1, 'error stderr', 'output stdout');
			expect(error?.raw).toEqual({
				exitCode: 1,
				stderr: 'error stderr',
				stdout: 'output stdout',
			});
		});
	});

	describe('edge cases', () => {
		it('should handle deeply nested JSON structures gracefully', () => {
			const line = JSON.stringify({
				type: 'say',
				say: 'text',
				text: JSON.stringify({ nested: { deep: true } }),
			});

			const event = parser.parseJsonLine(line);
			expect(event?.type).toBe('text');
		});

		it('should handle very long text content', () => {
			const longText = 'a'.repeat(10000);
			const line = JSON.stringify({
				type: 'say',
				say: 'text',
				text: longText,
			});

			const event = parser.parseJsonLine(line);
			expect(event?.type).toBe('text');
			expect(event?.text).toBe(longText);
		});

		it('should handle special characters in text', () => {
			const line = JSON.stringify({
				type: 'say',
				say: 'text',
				text: 'Hello\nWorld\t"special" <chars> & more',
			});

			const event = parser.parseJsonLine(line);
			expect(event?.type).toBe('text');
			expect(event?.text).toContain('Hello\nWorld');
		});
	});
});
