# Depth

One live order book for BTC and ETH, built with Next.js, React, and TypeScript. Asks sit above the midpoint; bids sit below. A compact 360 × 629 px desktop widget with 18 px rows, mint/rose depth bars, and brief flashes for newly entering prices.

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

These feeds **cannot reconstruct an exact, current twenty-level book between full snapshots**. The widget keeps an exact inside market and uses an explicitly labeled model for the outer depth:

1. Order data by exchange timestamp. The newest full snapshot supplies confirmed depth; a newer fast snapshot replaces the inside five levels unchanged. Old messages cannot roll the best prices backward. Equal-time snapshots share full depth only when their first five levels agree.
2. Preserve the slow snapshot’s shape by **distance from its best price**, carrying sizes at the corresponding depth rank. Translate that price-distance profile around the newest fast best price on each side.
3. If the fast five-level range has widened, shift the projected tail farther outward so it cannot overlap the real five levels. Preserve the gaps within the slow profile. Prices remain positive, sorted, unique, and outside the confirmed spread.
4. Projected prices, sizes, and cumulative totals are marked **≈**, with subdued striped depth bars. These are estimates, not exchange orders. The model assumes outer sizes and price spacing remain similar until the next full snapshot; it does not extrapolate a volume multiplier from the fast feed.
5. A newer full snapshot replaces projections with actual levels. An exhausted fast side (fewer than five levels) never receives a fabricated tail. A missing or more-than-ten-second-old slow profile cannot support projections, so unused slots remain placeholders in those cases.

For example, if the slow sixth bid is $5 below its best bid, an unchanged-width fast core moving up $3 moves the projected sixth bid up $3 too. Its size comes from the slow sixth level. It remains outside the fifth fast bid and is labeled estimated until confirmed.

Midpoint, spread, and top-five balance use only confirmed data. Cumulative totals and bars can include projections and are marked accordingly. Both sides share one bar scale. Twelve levels per side are displayed, with fixed placeholders for unavailable rows.

## Hover summaries

Hover or focus a level to highlight the inclusive range from the best quote through that depth rank. The floating panel shows distance from midpoint, size-weighted average price, cumulative BTC/ETH size, and cumulative USD value. Any range containing projections is labeled estimated, including its totals. Numbers update while the pointer stays still. Touch can pin the summary; Escape or tapping elsewhere dismisses it. The panel is positioned outside layout and kept within the viewport.

The merge engine is in `src/lib/merge-book.ts`; transport and coalesced publication are in `src/lib/use-book.ts`.

## Interaction and performance

- BTC / ETH selector; significant-figure options 2–5 and full precision.
- One vertical table, with asks descending toward the spread and bids descending away from it, following the layouts of Hyperliquid and Binance.
- Fixed panel, row, and column geometry at desktop and mobile sizes. Precision changes, sparse books, and reconnections do not resize the widget.
- Confirmed rows are keyed by price; projected rows are keyed by depth rank. New confirmed levels flash; size changes and midpoint movement receive restrained color feedback. Reduced-motion preferences disable animation.
- Every message updates the snapshot model, but React publishes at most once per animation frame. Memoized rows receive primitive props.
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

Unit tests cover validation, timestamp ordering, distance-profile projection, spread widening, equal-time conflicts, thin books, expiry, rapid reversals, and weighted hover calculations. Browser tests verify estimate labels and totals, hover selection, live summary updates, keyboard/touch interaction, viewport positioning, layout stability, symbol/precision switches, flashes, stale recovery, and reduced motion.

## Deploy

`npm run build` generates a static site in `out/`. The GitHub Pages workflow verifies and deploys pushes to `main`. `NEXT_PUBLIC_BASE_PATH` is set to the repository name there; leave it unset for root-domain hosting.

## References

[Hyperliquid subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) · [Precision](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book-snapshot) · [Heartbeats](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats)

AI-assisted implementation. Application runtime dependencies are limited to Next.js, React, and React DOM.
