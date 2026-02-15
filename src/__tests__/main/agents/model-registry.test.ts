import { describe, it, expect } from 'vitest';
import {
	type AvailableModel,
	COMMON_CLINE_MODELS,
	getContextWindowForModel,
} from '../../../main/agents';

describe('model-registry', () => {
	describe('COMMON_CLINE_MODELS', () => {
		it('should be a non-empty array', () => {
			expect(Array.isArray(COMMON_CLINE_MODELS)).toBe(true);
			expect(COMMON_CLINE_MODELS.length).toBeGreaterThan(0);
		});

		it('should have all required fields on each model', () => {
			for (const model of COMMON_CLINE_MODELS) {
				expect(typeof model.id).toBe('string');
				expect(model.id.length).toBeGreaterThan(0);
				expect(typeof model.displayName).toBe('string');
				expect(model.displayName.length).toBeGreaterThan(0);
				expect(typeof model.provider).toBe('string');
				expect(model.provider.length).toBeGreaterThan(0);
				expect(typeof model.contextWindow).toBe('number');
				expect(model.contextWindow).toBeGreaterThan(0);
			}
		});

		it('should have unique model IDs', () => {
			const ids = COMMON_CLINE_MODELS.map((m) => m.id);
			const uniqueIds = new Set(ids);
			expect(uniqueIds.size).toBe(ids.length);
		});

		it('should contain expected OpenAI models', () => {
			const openaiModels = COMMON_CLINE_MODELS.filter((m) => m.provider === 'OpenAI');
			expect(openaiModels.length).toBe(4);
			expect(openaiModels.map((m) => m.id)).toContain('openai/gpt-4o');
			expect(openaiModels.map((m) => m.id)).toContain('openai/gpt-4o-mini');
			expect(openaiModels.map((m) => m.id)).toContain('openai/o1');
			expect(openaiModels.map((m) => m.id)).toContain('openai/o1-mini');
		});

		it('should contain expected Anthropic models', () => {
			const anthropicModels = COMMON_CLINE_MODELS.filter((m) => m.provider === 'Anthropic');
			expect(anthropicModels.length).toBe(3);
			expect(anthropicModels.map((m) => m.id)).toContain('anthropic/claude-sonnet-4');
			expect(anthropicModels.map((m) => m.id)).toContain('anthropic/claude-opus-4.6');
			expect(anthropicModels.map((m) => m.id)).toContain('anthropic/claude-3-5-sonnet-latest');
		});

		it('should contain expected Google models', () => {
			const googleModels = COMMON_CLINE_MODELS.filter((m) => m.provider === 'Google');
			expect(googleModels.length).toBe(2);
			expect(googleModels.map((m) => m.id)).toContain('google/gemini-2.0-flash');
			expect(googleModels.map((m) => m.id)).toContain('google/gemini-2.0-pro');
		});

		it('should contain expected Ollama models', () => {
			const ollamaModels = COMMON_CLINE_MODELS.filter((m) => m.provider === 'Ollama');
			expect(ollamaModels.length).toBe(3);
			expect(ollamaModels.map((m) => m.id)).toContain('ollama/qwen3:8b');
			expect(ollamaModels.map((m) => m.id)).toContain('ollama/llama3.3');
			expect(ollamaModels.map((m) => m.id)).toContain('ollama/deepseek-r1');
		});

		it('should have correct context windows for known models', () => {
			const gpt4o = COMMON_CLINE_MODELS.find((m) => m.id === 'openai/gpt-4o');
			expect(gpt4o?.contextWindow).toBe(128000);

			const o1 = COMMON_CLINE_MODELS.find((m) => m.id === 'openai/o1');
			expect(o1?.contextWindow).toBe(200000);

			const claudeSonnet = COMMON_CLINE_MODELS.find((m) => m.id === 'anthropic/claude-sonnet-4');
			expect(claudeSonnet?.contextWindow).toBe(200000);

			const geminiFlash = COMMON_CLINE_MODELS.find((m) => m.id === 'google/gemini-2.0-flash');
			expect(geminiFlash?.contextWindow).toBe(1048576);

			const qwen = COMMON_CLINE_MODELS.find((m) => m.id === 'ollama/qwen3:8b');
			expect(qwen?.contextWindow).toBe(32768);

			const deepseek = COMMON_CLINE_MODELS.find((m) => m.id === 'ollama/deepseek-r1');
			expect(deepseek?.contextWindow).toBe(65536);
		});
	});

	describe('getContextWindowForModel', () => {
		it('should return correct context window for known models', () => {
			expect(getContextWindowForModel('openai/gpt-4o')).toBe(128000);
			expect(getContextWindowForModel('openai/o1')).toBe(200000);
			expect(getContextWindowForModel('anthropic/claude-sonnet-4')).toBe(200000);
			expect(getContextWindowForModel('google/gemini-2.0-flash')).toBe(1048576);
			expect(getContextWindowForModel('ollama/qwen3:8b')).toBe(32768);
			expect(getContextWindowForModel('ollama/deepseek-r1')).toBe(65536);
		});

		it('should return 128000 for unknown models', () => {
			expect(getContextWindowForModel('unknown/model')).toBe(128000);
			expect(getContextWindowForModel('')).toBe(128000);
			expect(getContextWindowForModel('some-random-id')).toBe(128000);
		});

		it('should be case-sensitive for model IDs', () => {
			// Model IDs are exact matches
			expect(getContextWindowForModel('OpenAI/GPT-4o')).toBe(128000); // Falls back to default
			expect(getContextWindowForModel('openai/gpt-4o')).toBe(128000); // Matches exactly
		});
	});

	describe('AvailableModel interface', () => {
		it('should accept valid model objects', () => {
			const model: AvailableModel = {
				id: 'test/model',
				displayName: 'Test Model',
				provider: 'Test',
				contextWindow: 64000,
			};

			expect(model.id).toBe('test/model');
			expect(model.displayName).toBe('Test Model');
			expect(model.provider).toBe('Test');
			expect(model.contextWindow).toBe(64000);
		});
	});
});
