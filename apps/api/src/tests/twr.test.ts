import { Prisma } from '@prisma/client';
import { calculateSubPeriodReturn } from '../services/twr.service';

/**
 * Pure-math TWR tests (no DB). These prove the core property the debrief will
 * probe: deposits are excluded, and sub-period returns chain correctly.
 */

function chain(...returns: Prisma.Decimal[]): Prisma.Decimal {
  return returns.reduce((acc, r) => acc.times(r.plus(1)), new Prisma.Decimal(1)).minus(1);
}

test('sub-period return excludes a same-period deposit (0% when no market move)', () => {
  // $20,000 start, +$5,000 deposit, ends exactly $25,000 (no market move).
  const r = calculateSubPeriodReturn(2_000_000n, 2_500_000n, 500_000n);
  expect(r.toString()).toBe('0');
});

test('denominator <= 0 returns 0 (no capital at start)', () => {
  expect(calculateSubPeriodReturn(0n, 100_00n, 0n).toString()).toBe('0');
  expect(calculateSubPeriodReturn(100n, 50n, -200n).toString()).toBe('0'); // start+cf < 0
});

test('TWR chains sub-periods and a mid-period deposit does NOT inflate it (7.625%)', () => {
  // Day1: deposit $10,000, invested -> $10,000
  // Day2: +5% -> $10,500                      (sub-period A, no flow)
  // Day3: deposit $10,000 -> base $20,500
  // Day4: +2.5% -> $21,012.50                 (sub-period B, flow $10,000)
  const rA = calculateSubPeriodReturn(1_000_000n, 1_050_000n, 0n); // 5%
  const rB = calculateSubPeriodReturn(1_050_000n, 2_101_250n, 1_000_000n); // 2.5%

  expect(rA.toDecimalPlaces(6).toString()).toBe('0.05');
  expect(rB.toDecimalPlaces(6).toString()).toBe('0.025');

  const twr = chain(rA, rB);
  // (1.05 * 1.025) - 1 = 0.07625  => 7.625%  (within 0.01%)
  expect(twr.minus('0.07625').abs().lt(new Prisma.Decimal('0.0001'))).toBe(true);
});

test('a pure-deposit sub-period leaves TWR unchanged when appended', () => {
  const rA = calculateSubPeriodReturn(1_000_000n, 1_050_000n, 0n); // 5%
  const before = chain(rA);
  // append a $50,000 deposit with no market move -> R = 0
  const rDep = calculateSubPeriodReturn(1_050_000n, 6_050_000n, 5_000_000n);
  const after = chain(rA, rDep);
  expect(rDep.toString()).toBe('0');
  expect(after.toString()).toBe(before.toString());
});
