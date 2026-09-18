# Depth

A live BTC / ETH order book built with Next.js, React, and TypeScript. Dark slate, mint bids, rose asks; fixed row geometry and restrained animation.

## Run

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No keys, backend, or environment variables are needed. All displayed market data comes directly from Hyperliquid mainnet.

## Design and behavior

- **Two real feeds:** `fast: true` provides five levels per side; `fast: false` provides twenty. Both use the selected BTC/ETH market and `nSigFigs` (2–5, or omitted for full precision).
- **Independent connections:** Hyperliquid's book messages do not identify their `fast` or `nSigFigs` subscription. Separate sockets avoid ambiguously combining snapshots. The two panels are independently timed snapshots, not one merged atomic book.
- **Stable geometry:** rows, columns, loading placeholders, and panels reserve their space. Symbol changes, thin books, disconnects, and precision changes do not resize them. At phone widths the slow book omits the total text column; depth bars still represent cumulative size. The fast book retains all columns.
- **Meaningful feedback:** new prices flash once; first snapshots and reconnect snapshots do not. Existing rows retain their identity by price. Size increases briefly tint mint and decreases rose. Depth bars animate with transforms. Reduced-motion preferences disable animation.
- **Comparable depth:** cumulative base-asset size starts at the best price. Both sides use the same scale within each panel. The liquidity balance covers only the twenty displayed levels, not the entire exchange. Prices are USD; sizes are BTC or ETH. Large displayed sizes use compact notation; row tooltips expose cumulative size and resting order count.
- **Transparent metrics:** midpoint is the average of best bid and ask, not last traded price. Spread is also shown in basis points. Top-five notional sums price × size on both sides. Grouped precision may widen the displayed spread.
- **Resilience:** validate and replace complete snapshots, ignore older timestamps, send heartbeats, mark silent feeds stale after ten seconds, and reconnect after twenty seconds with capped exponential backoff. Symbol/precision changes dispose both connections and clear the old data atomically.
- **Rendering:** fast and slow panels own separate state. Bursts coalesce to the latest snapshot per animation frame. Memoized rows receive primitive props, so unchanged rows skip work. No animation library or global state dependency.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Unit tests cover book validation, cumulative depth, entry detection, and spread math. Browser tests use controlled WebSocket snapshots to verify both subscriptions, switching, fixed bounds at desktop/mobile sizes, flashes, retained DOM identity, stale/reconnect states, and reduced motion. Live exchange checks are separate from deterministic tests.

## Deployment

`npm run build` generates a static site in `out/`, deployable to any static host. The included GitHub Pages workflow builds and deploys on pushes to `main`. Enable **GitHub Actions** as the Pages source. `NEXT_PUBLIC_BASE_PATH` is set to the repository name by that workflow; leave it unset for root-domain hosting such as Vercel.

## Reference

[Hyperliquid WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) · [Precision parameters](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book-snapshot) · [Heartbeats](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats)

AI-assisted implementation. Application runtime dependencies are limited to Next.js, React, and React DOM.
