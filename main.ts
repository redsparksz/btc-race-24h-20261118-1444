// Dip-scalp bot for cbBTC (CBBTC/USDC), 1-minute bars, long only.
//
// The dev window for this race falls 2.8% over 24h in choppy legs, so holding
// through it loses money and chasing breakouts pays the top of every spike.
// This bot instead scalps the pullbacks inside the chop, at most twice:
//
//   1. Entry: the close has dropped at least 0.6% from the highest close of
//      the last 90 bars, while the 240-bar return is still above -2.5% (the
//      leg is a pullback, not a collapse). Buy with all available cash.
//   2. Exit, whichever comes first: +1.0% profit target above the entry
//      close, -1.2% hard stop below it, or a 0.6% trailing stop below the
//      peak since entry (armed once the peak is +0.6% above entry).
//   3. After an exit, wait 30 bars before the next entry, and never enter a
//      third time: two good scalps beat a third gamble on a tired window.
//
// A round trip costs ~12 bps in fees and slippage, so a 1.0% target leaves
// roughly 0.88% net per winning scalp. All comparisons are exact integer
// (bigint) arithmetic on the raw close prices, so two runs on the same bars
// produce the same orders. No clock, no randomness, no network, no files:
// the only inputs are the hello and the batches the harness sends.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const BPS = 10_000n;

// --- entry rules -----------------------------------------------------------
const DIP_LOOKBACK = 90; // bars (including the current one) for the recent high
const DIP_BPS = 60n; // a dip is a close at least 0.6% below that high
const TREND_LOOKBACK = 240; // bars back for the slow-trend guard
const TREND_MIN_BPS = -250n; // entry needs the 240-bar return above -2.5%
const MAX_ENTRIES = 2; // at most two scalps per window
const COOLDOWN_BARS = 30; // bars to wait after an exit before the next entry

// --- exit rules -------------------------------------------------------------
const TARGET_BPS = 100n; // take profit: +1.0% above the entry close
const STOP_BPS = 120n; // hard stop: -1.2% below the entry close
const TRAIL_BPS = 60n; // trailing stop: 0.6% below the peak since entry
const ARM_BPS = 60n; // the trail arms once the peak is +0.6% above entry

const MAX_SLIPPAGE_BPS = 150; // 1.5%: wide enough for 1-minute moves + impact

// --- state ------------------------------------------------------------------
const closes: bigint[] = []; // every close seen, in bar order
let entries = 0; // buys that actually filled
let buySent = false; // a buy was sent and its fill is unconfirmed
let sellSent = false; // a sell was sent and its fill is unconfirmed
let holding = false; // a position is actually held (from the account)
let entryClose = 0n; // close of the bar the entry was decided on
let peakClose = 0n; // highest close seen since the entry
let lastExitBar = -1_000_000; // bar index of the last confirmed exit

/** The highest close of the last `n` bars, including the current one. */
function recentHigh(n: number): bigint {
  let high = closes[closes.length - n];
  for (let i = closes.length - n + 1; i < closes.length; i++) {
    if (closes[i]! > high) high = closes[i]!;
  }
  return high;
}

/** True when `now` is at least `bps` above `ref` (bps may be negative). */
function upBy(now: bigint, ref: bigint, bps: bigint): boolean {
  return now * BPS > ref * (BPS + bps);
}

/** True when `now` is at least `bps` below `ref`. */
function downBy(now: bigint, ref: bigint, bps: bigint): boolean {
  return now * BPS < ref * (BPS - bps);
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const symbol = state.hello.symbols[0]!.symbol;
    if (state.warmingUp) return [];

    const close = state.close(symbol);
    if (close === null) return [];
    closes.push(close);
    const bar = closes.length - 1;

    // Reconcile with what actually filled on the previous batch.
    const position = state.positions.get(symbol);
    if (buySent) {
      buySent = false;
      if (position !== undefined) {
        holding = true;
        entries += 1;
        peakClose = entryClose;
      }
      // A rejected buy counts for nothing: entries stay as they were.
    }
    if (sellSent) {
      sellSent = false;
      if (position === undefined) {
        holding = false;
        lastExitBar = bar;
      }
    }
    if (position === undefined) holding = false;

    if (holding) {
      if (close > peakClose) peakClose = close;
      const targetHit = upBy(close, entryClose, TARGET_BPS);
      const stopHit = downBy(close, entryClose, STOP_BPS);
      const trailHit = upBy(peakClose, entryClose, ARM_BPS) && downBy(close, peakClose, TRAIL_BPS);
      if (targetHit || stopHit || trailHit) {
        sellSent = true;
        return [{ side: 'sell', symbol, qty: position!.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // At most two scalps, with a breather after each exit.
    if (entries >= MAX_ENTRIES) return [];
    if (bar - lastExitBar < COOLDOWN_BARS) return [];
    if (closes.length <= TREND_LOOKBACK) return [];

    // Dip entry: pulled back from the recent high, slow trend not collapsing.
    const high = recentHigh(DIP_LOOKBACK + 1);
    const oldTrend = closes[closes.length - 1 - TREND_LOOKBACK]!;
    if (downBy(close, high, DIP_BPS) && upBy(close, oldTrend, TREND_MIN_BPS)) {
      const room = state.weightRoom(symbol);
      const spend = state.cash < room ? state.cash : room;
      if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      buySent = true;
      entryClose = close;
      peakClose = close;
      return [{ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    return [];
  },
});
