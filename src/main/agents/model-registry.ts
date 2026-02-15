/**
 * Model Registry for Cline Agent
 *
 * Provides a registry of common AI models available through Cline's
 * OpenRouter-compatible model selection. Includes context window lookup
 * for accurate token usage display.
 */

/**
 * Represents an AI model available for selection in Cline.
 */
export interface AvailableModel {
	/** Model identifier in provider/model format (e.g., "openai/gpt-4o") */
	id: string;
	/** Human-readable display name (e.g., "GPT-4o") */
	displayName: string;
	/** Provider name (e.g., "OpenAI") */
	provider: string;
	/** Maximum context window size in tokens */
	contextWindow: number;
}

/**
 * Default context window size for unknown models.
 * 128K is a safe default that matches most modern models.
 */
const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Common models available through Cline's OpenRouter-compatible interface.
 * Organized by provider for readability.
 */
export const COMMON_CLINE_MODELS: AvailableModel[] = [
	// OpenAI models
	{
		id: 'openai/gpt-4o',
		displayName: 'GPT-4o',
		provider: 'OpenAI',
		contextWindow: 128000,
	},
	{
		id: 'openai/gpt-4o-mini',
		displayName: 'GPT-4o Mini',
		provider: 'OpenAI',
		contextWindow: 128000,
	},
	{
		id: 'openai/o1',
		displayName: 'O1',
		provider: 'OpenAI',
		contextWindow: 200000,
	},
	{
		id: 'openai/o1-mini',
		displayName: 'O1 Mini',
		provider: 'OpenAI',
		contextWindow: 128000,
	},

	// Anthropic models
	{
		id: 'anthropic/claude-sonnet-4',
		displayName: 'Claude Sonnet 4',
		provider: 'Anthropic',
		contextWindow: 200000,
	},
	{
		id: 'anthropic/claude-opus-4.6',
		displayName: 'Claude Opus 4.6',
		provider: 'Anthropic',
		contextWindow: 200000,
	},
	{
		id: 'anthropic/claude-3-5-sonnet-latest',
		displayName: 'Claude 3.5 Sonnet',
		provider: 'Anthropic',
		contextWindow: 200000,
	},

	// Google models
	{
		id: 'google/gemini-2.0-flash',
		displayName: 'Gemini 2.0 Flash',
		provider: 'Google',
		contextWindow: 1048576,
	},
	{
		id: 'google/gemini-2.0-pro',
		displayName: 'Gemini 2.0 Pro',
		provider: 'Google',
		contextWindow: 1048576,
	},

	// Ollama (local) models
	{
		id: 'ollama/qwen3:8b',
		displayName: 'Qwen3 8B',
		provider: 'Ollama',
		contextWindow: 32768,
	},
	{
		id: 'ollama/llama3.3',
		displayName: 'Llama 3.3',
		provider: 'Ollama',
		contextWindow: 128000,
	},
	{
		id: 'ollama/deepseek-r1',
		displayName: 'DeepSeek R1',
		provider: 'Ollama',
		contextWindow: 65536,
	},
];

/**
 * Get the context window size for a given model ID.
 *
 * Looks up the model in the COMMON_CLINE_MODELS registry and returns
 * its context window size. Falls back to 128000 for unknown models.
 *
 * @param modelId - The model identifier (e.g., "openai/gpt-4o")
 * @returns The context window size in tokens
 */
export function getContextWindowForModel(modelId: string): number {
	const model = COMMON_CLINE_MODELS.find((m) => m.id === modelId);
	return model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}
