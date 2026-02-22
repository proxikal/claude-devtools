/**
 * Model pricing and cost estimation for Claude API usage.
 *
 * Prices are in USD per million tokens (MTok).
 * Source: Anthropic pricing page — updated Feb 2026.
 *
 * IMPORTANT: These are estimates. Actual billing may differ based on
 * promotional pricing, enterprise agreements, or pricing changes.
 */

// =============================================================================
// Pricing Table
// =============================================================================

interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICING: Record<string, ModelPricing> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku_new: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  haiku_old: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
};

// =============================================================================
// Model Resolution
// =============================================================================

/**
 * Returns a human-readable display label for a model string.
 * e.g. "claude-sonnet-4-6" → "Sonnet 4.6"
 */
export function getModelLabel(model: string): string {
  const m = model.toLowerCase();

  // Extract family
  let family = 'Sonnet';
  if (m.includes('opus')) family = 'Opus';
  else if (m.includes('haiku')) family = 'Haiku';

  // Extract version from patterns like "4-6", "4-5", "3-5"
  const versionMatch = /(\d+)-(\d+)/.exec(m);
  if (versionMatch) {
    return `${family} ${versionMatch[1]}.${versionMatch[2]}`;
  }

  // Fallback: strip "claude-" prefix
  const stripped = model.replace(/^claude-/i, '');
  return stripped || model;
}

/**
 * Resolves a model string to its pricing tier.
 */
function resolvePricing(model: string): ModelPricing {
  const m = model.toLowerCase();

  if (m.includes('opus')) return PRICING.opus;

  if (m.includes('haiku')) {
    // Original claude-3-haiku (not claude-3-5-haiku or claude-haiku-4-5)
    const isOldHaiku = /claude-3-haiku(?!-)/i.test(model);
    return isOldHaiku ? PRICING.haiku_old : PRICING.haiku_new;
  }

  // Sonnet or unknown → Sonnet pricing (most common Claude Code model)
  return PRICING.sonnet;
}

// =============================================================================
// Cost Calculation
// =============================================================================

/**
 * Estimates cost in USD for a set of token counts and a model.
 * All token counts are integers (raw API values).
 */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  model = ''
): number {
  const p = resolvePricing(model);
  const M = 1_000_000;
  return (
    (inputTokens / M) * p.input +
    (outputTokens / M) * p.output +
    (cacheReadTokens / M) * p.cacheRead +
    (cacheCreationTokens / M) * p.cacheWrite
  );
}

/**
 * Format a USD cost value for display.
 * < $0.01  → "<$0.01"
 * < $1     → "$0.42"
 * < $100   → "$12.40"
 * >= $100  → "$1,240"
 */
export function formatCostUsd(costUsd: number): string {
  if (costUsd === 0) return '$0.00';
  if (costUsd < 0.01) return '<$0.01';
  if (costUsd < 1) return `$${costUsd.toFixed(2)}`;
  if (costUsd < 100) return `$${costUsd.toFixed(2)}`;
  return `$${Math.round(costUsd).toLocaleString()}`;
}
