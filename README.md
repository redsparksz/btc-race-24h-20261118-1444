# Dip-scalp cbBTC bot — make.fun btc-race-24h-20261118-1444

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute bars
in the make.fun bars-replay harness. Long only, at most two scalps per
24-hour window.

## Strategy

1. **Entry** — buy with all available cash when the close has dropped at
   least 0.6% from the highest close of the last 90 bars, while the 240-bar
   return is still above -2.5% (a pullback, not a collapse).
2. **Exit** — whichever comes first: +1.0% profit target, -1.2% hard stop,
   or a 0.6% trailing stop below the peak since entry (armed at +0.6%).
3. **Discipline** — at most 2 entries per window, with a 30-bar cooldown
   after each exit. No re-entry after the second scalp.

All comparisons are exact integer (bigint) arithmetic on raw close prices;
the bot is deterministic: no clock, no randomness, no network, no files
outside the repository.

## Files

- `main.ts` — the bot (Node 22, standard library + vendored shim only)
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK shim, byte-for-byte
  copy of `sdk/makefun-bars.ts` from the competition kit

## Local grade

From inside the unpacked kit:

```
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

## License

MIT
