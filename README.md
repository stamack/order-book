# Depth

One live order book for BTC and ETH, built with Next.js, React, and TypeScript. Asks sit above the midpoint; bids sit below. Fixed rows, mint/rose depth bars, and brief flashes for newly entering prices.

[Live demo](https://stamack.github.io/order-book/) · [Source](https://github.com/stamack/order-book)

## Run

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No keys, backend, or environment variables are needed.

## Blending the two feeds correctly

Hyperliquid provides complete snapshots: `fast: true` has up to five levels per side; `fast: false` has up to twenty. Both use the chosen symbol and `nSigFigs`. Separate sockets identify the feed because the response doesn't include those subscription parameters.

These feeds **cannot reconstruct an exact, current twenty-level book between full snapshots**. The app explicitly distinguishes confirmed liquidity from historical outer levels:

1. Order data by the exchange timestamp, not arrival time. Newer full snapshots replace older fast data. Old packets cannot roll the best prices backward.
2. Each fast snapshot replaces its entire covered price range, including deletion of prices absent from that range. An exhausted side (fewer than five levels) clears all older depth on that side.
3. When a delayed full snapshot arrives, replay every retained fast snapshot newer than it. Applying only the latest fast snapshot could resurrect levels that an intermediate update removed.
4. Equal-time snapshots can share full depth only if their first five levels agree on price, size, and order count. Conflicts fall back to the fast core.
5. Older outer levels are dimmed and marked **≈ last confirmed**. Their sizes may have changed. They expire within two seconds of receipt, or when exchange-time distance exceeds two seconds. Their cumulative totals and depth bars are withheld. They are never silently treated as current orders.
6. Replay history is capped at 128 snapshots. If a baseline predates retained history, fall back to the fast core until trustworthy full depth arrives.

Only confirmed rows enter cumulative totals, depth-bar scaling, midpoint, spread, or the top-five balance. Both book sides use one shared bar scale. Twelve levels per side are displayed; placeholders reserve unused rows. The midpoint is explicitly labeled and is not a last-trade price.

The merge engine is in `src/lib/merge-book.ts`; transport and coalesced publication are in `src/lib/use-book.ts`.

## Interaction and performance

- BTC / ETH selector; significant-figure options 2–5 and full precision.
- One vertical table, with asks descending toward the spread and bids descending away from it, following the layouts of Hyperliquid and Binance.
- Fixed panel, row, and column geometry at desktop and mobile sizes. Precision changes, sparse books, and reconnections do not resize the widget.
- Price-keyed rows preserve DOM identity. New confirmed levels flash; size changes and midpoint movement receive restrained color feedback. Reduced-motion preferences disable animation.
- Every message updates the reconciler, but React publishes at most once per animation frame. No intermediate fast snapshot is lost before reconciliation. Memoized rows receive primitive props.
- Heartbeats, stale indicators, capped exponential reconnection backoff, and independent socket recovery. Switching symbol/precision disposes both subscriptions and atomically clears the old book.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Unit tests cover validation, timestamp ordering, delayed snapshots, deletion replay, conflicting equal-time snapshots, thin books, cache expiry, bounded history, and rapid reversals. Browser tests verify the single vertical book, historical-row labeling, cumulative-total withholding, layout stability, symbol/precision switches, flashes, stale recovery, and reduced motion.

## Deploy

`npm run build` generates a static site in `out/`. The GitHub Pages workflow verifies and deploys pushes to `main`. `NEXT_PUBLIC_BASE_PATH` is set to the repository name there; leave it unset for root-domain hosting.

## References

[Hyperliquid subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) · [Precision](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book-snapshot) · [Heartbeats](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats)

AI-assisted implementation. Application runtime dependencies are limited to Next.js, React, and React DOM.
