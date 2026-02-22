/**
 * Configuration for model variants (reasoning and beta/self-moderated).
 * - Reasoning variants: Models that can produce extended reasoning before generating output
 * - Beta variants: Anthropic models with OpenRouter moderation bypassed (faster responses)
 */

// ============================================================================
// REASONING VARIANTS
// ============================================================================

/**
 * Patterns for model IDs that support reasoning mode.
 * Uses partial matching - if a model ID contains any of these patterns, it supports reasoning.
 */
export const REASONING_CAPABLE_PATTERNS: string[] = [
  // xAI Grok models (use effort-based reasoning)
  'x-ai/grok-4',
  'x-ai/grok-3',
  // DeepSeek thinking models (use max_tokens reasoning)
  'deepseek/deepseek-r1',
  'deepseek/deepseek-v3',
  // Google Gemini thinking models (use max_tokens reasoning)
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  // Anthropic Claude models (use max_tokens reasoning)
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3-5-sonnet',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-opus-4',
  // OpenAI reasoning models (use effort-based reasoning)
  'openai/o1',
  'openai/o3',
  'openai/gpt-5',
  // Alibaba Qwen thinking models (use max_tokens reasoning)
  'qwen/qwen3',
];

/**
 * Patterns for models that use effort-based reasoning configuration.
 * These models accept { effort: 'high' | 'medium' | 'low' } instead of max_tokens.
 * All other reasoning models use max_tokens configuration.
 */
export const EFFORT_BASED_PATTERNS: string[] = [
  'openai/',  // All OpenAI models use effort-based
  'x-ai/grok',  // All Grok models use effort-based
];

/**
 * Suffix used to identify reasoning variant model IDs.
 */
export const REASONING_SUFFIX = ':reasoning';

/**
 * Check if a model ID supports reasoning mode.
 */
export function supportsReasoning(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();
  return REASONING_CAPABLE_PATTERNS.some(pattern =>
    lowerModelId.includes(pattern.toLowerCase())
  );
}

/**
 * Check if a model ID is a reasoning variant (has :reasoning suffix).
 */
export function isReasoningVariant(modelId: string): boolean {
  return modelId.endsWith(REASONING_SUFFIX);
}

/**
 * Get the base model ID by stripping variant suffixes.
 * For combined variants like :beta:reasoning, strips :reasoning first to get :beta,
 * which is what we want to send to OpenRouter (the :beta suffix is a real API suffix).
 *
 * @param modelId - The model ID potentially with suffixes
 * @param stripAll - If true, strips ALL suffixes to get the original base model ID
 */
export function getBaseModelId(modelId: string, stripAll = false): string {
  let baseId = modelId;

  // Always strip :reasoning first (it's our internal marker)
  if (baseId.endsWith(REASONING_SUFFIX)) {
    baseId = baseId.slice(0, -REASONING_SUFFIX.length);
  }

  // Only strip :beta if stripAll is requested (for getting true base model)
  // Otherwise preserve :beta as it's a real API suffix
  if (stripAll && baseId.endsWith(BETA_SUFFIX)) {
    baseId = baseId.slice(0, -BETA_SUFFIX.length);
  }

  return baseId;
}

/**
 * Check if a model uses effort-based reasoning (vs max_tokens).
 * Effort-based: OpenAI o-series, GPT-5 series, Grok models
 * Max tokens-based: Anthropic, Gemini, DeepSeek, Qwen
 */
export function usesEffortReasoning(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();
  return EFFORT_BASED_PATTERNS.some(pattern =>
    lowerModelId.includes(pattern.toLowerCase())
  );
}

/**
 * Constraints for dynamic reasoning budget calculation.
 */
export const REASONING_CONSTRAINTS = {
  MIN_TOKENS: 1024,      // OpenRouter/Anthropic minimum
  MAX_TOKENS: 32000,     // Cap for performance/cost
  RATIO: 1.0,            // 1:1 ratio (reasoning = output tokens)
};

/**
 * Default reasoning configuration values.
 */
export const REASONING_DEFAULTS = {
  effort: 'high' as const,
};

/**
 * Calculate dynamic reasoning budget based on output tokens.
 * Uses 1:1 ratio with min/max constraints to ensure responses aren't truncated.
 *
 * @param outputTokens - The max_tokens allocated for model output
 * @returns Reasoning budget in tokens (between MIN_TOKENS and MAX_TOKENS)
 */
export function calculateReasoningBudget(outputTokens: number): number {
  // Scale reasoning at 1:1 ratio with output tokens
  const scaledBudget = Math.ceil(outputTokens * REASONING_CONSTRAINTS.RATIO);

  // Enforce OpenRouter/Anthropic constraints
  return Math.max(
    REASONING_CONSTRAINTS.MIN_TOKENS,
    Math.min(scaledBudget, REASONING_CONSTRAINTS.MAX_TOKENS)
  );
}

// ============================================================================
// BETA (SELF-MODERATED) VARIANTS
// ============================================================================

/**
 * Suffix used to identify beta (self-moderated) variant model IDs.
 * Beta variants bypass OpenRouter's moderation, resulting in faster responses.
 * The model may still self-moderate based on its training.
 */
export const BETA_SUFFIX = ':beta';

/**
 * Check if a model ID is a beta variant (contains :beta).
 * Uses includes() to also detect combined variants like :beta:reasoning.
 */
export function isBetaVariant(modelId: string): boolean {
  return modelId.includes(BETA_SUFFIX);
}

/**
 * Tokenizer value that indicates an Anthropic model in OpenRouter API response.
 */
export const ANTHROPIC_TOKENIZER = 'Claude';
