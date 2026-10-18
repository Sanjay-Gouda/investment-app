/**
 * The four fixed model portfolios. Each is a set of symbol weights plus a 10%
 * cash buffer that is never invested (see DECISIONS.md). Weights (incl. the
 * buffer) sum to 1.0.
 */
export type PortfolioType = 'CONSERVATIVE' | 'MODERATE' | 'GROWTH' | 'AGGRESSIVE';

export const CASH_BUFFER_PCT = 0.1; // 10% always stays as cash

export interface ModelPortfolio {
  name: string;
  type: PortfolioType;
  description: string;
  riskLevel: 'Low' | 'Medium' | 'Medium-High' | 'High';
  expectedReturn: string;
  /** Symbol -> target weight of the TOTAL account (buffer excluded here). */
  weights: Record<string, number>;
  cashBufferPct: number;
}

export const MODEL_PORTFOLIOS: Record<PortfolioType, ModelPortfolio> = {
  CONSERVATIVE: {
    name: 'Conservative',
    type: 'CONSERVATIVE',
    description: 'Bond-heavy, capital preservation focus.',
    riskLevel: 'Low',
    expectedReturn: '4-6%/yr',
    weights: { BND: 0.6, VTI: 0.3 },
    cashBufferPct: CASH_BUFFER_PCT,
  },
  MODERATE: {
    name: 'Moderate',
    type: 'MODERATE',
    description: 'Balanced mix of stocks and bonds.',
    riskLevel: 'Medium',
    expectedReturn: '6-8%/yr',
    weights: { VTI: 0.5, BND: 0.4 },
    cashBufferPct: CASH_BUFFER_PCT,
  },
  GROWTH: {
    name: 'Growth',
    type: 'GROWTH',
    description: 'Stock-tilted for long-term growth.',
    riskLevel: 'Medium-High',
    expectedReturn: '7-9%/yr',
    weights: { VTI: 0.6, BND: 0.3 },
    cashBufferPct: CASH_BUFFER_PCT,
  },
  AGGRESSIVE: {
    name: 'Aggressive',
    type: 'AGGRESSIVE',
    description: 'Maximum equity exposure.',
    riskLevel: 'High',
    expectedReturn: '8-11%/yr',
    weights: { VTI: 0.8, BND: 0.1 },
    cashBufferPct: CASH_BUFFER_PCT,
  },
};

export function isPortfolioType(x: unknown): x is PortfolioType {
  return typeof x === 'string' && x in MODEL_PORTFOLIOS;
}
