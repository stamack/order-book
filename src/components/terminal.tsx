"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  compact,
  displaySize,
  metrics,
  price,
  size,
  type Coin,
  type DepthLevel,
  type Precision,
} from "@/lib/book";
import { useBook, type FeedState } from "@/lib/use-book";

const DOCS =
  "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions";

function Mark() {
  return (
    <svg
      width="27"
      height="25"
      viewBox="0 0 27 25"
      fill="none"
      aria-hidden="true"
    >
      <path d="M2 4h8v17H2zM13 9h5v12h-5zM21 14h4v7h-4z" fill="currentColor" />
    </svg>
  );
}

export function Terminal() {
  const [coin, setCoin] = useState<Coin>("BTC");
  const [precision, setPrecision] = useState<Precision>(5);
  return (
    <>
      <header className="site-header">
        <a className="brand" href="./" aria-label="Depth home">
          <Mark />
          depth<span className="brand-dot">.</span>
        </a>
        <div className="header-divider" />
        <span className="header-caption">A clearer view of the market</span>
        <a
          className="source-link"
          href={`https://app.hyperliquid.xyz/trade/${coin}`}
          target="_blank"
          rel="noreferrer"
        >
          Built on <strong>Hyperliquid</strong>
          <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main>
        <div className="page-intro">
          <div>
            <div className="eyebrow">
              <span className="intro-dot" /> MARKET INTELLIGENCE
            </div>
            <h1>Every level. In real time.</h1>
            <p>Watch liquidity form, shift, and find its price.</p>
          </div>
          <span className="network">
            <span className="network-icon">◈</span> Hyperliquid mainnet
          </span>
        </div>
        <section className="workspace" aria-label="Live order books">
          <div className="toolbar">
            <div className="market-picker">
              <span
                className={`coin-icon ${coin.toLowerCase()}`}
                aria-hidden="true"
              >
                {coin === "BTC" ? "₿" : "Ξ"}
              </span>
              <div>
                <label className="sr-only" htmlFor="market">
                  Market
                </label>
                <select
                  id="market"
                  value={coin}
                  onChange={(event) => setCoin(event.target.value as Coin)}
                >
                  <option value="BTC">BTC / USD</option>
                  <option value="ETH">ETH / USD</option>
                </select>
                <span className="market-subtitle">
                  {coin === "BTC" ? "Bitcoin" : "Ethereum"} perpetual
                </span>
              </div>
              <span className="tag">PERP</span>
            </div>
            <div className="toolbar-controls">
              <label htmlFor="precision">Price precision</label>
              <select
                id="precision"
                value={precision ?? "full"}
                onChange={(event) =>
                  setPrecision(
                    event.target.value === "full"
                      ? null
                      : (Number(event.target.value) as Precision),
                  )
                }
              >
                <option value="full">Full precision</option>
                {[5, 4, 3, 2].map((n) => (
                  <option key={n} value={n}>
                    {n} significant figures
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* Remount atomically: never display an old symbol under a new label. */}
          <Books
            key={`${coin}:${precision}`}
            coin={coin}
            precision={precision}
          />
        </section>
        <footer className="page-footer">
          <span>
            <span className="footer-dot" /> Direct from the exchange. No
            simulated data.
          </span>
          <a href={DOCS} target="_blank" rel="noreferrer">
            Explore the feed documentation <span aria-hidden="true">↗</span>
          </a>
        </footer>
      </main>
    </>
  );
}

function Books({ coin, precision }: { coin: Coin; precision: Precision }) {
  // Feed ownership is isolated: fast ticks never rerender the slow book.
  return (
    <div className="books-layout">
      <SlowBook coin={coin} precision={precision} />
      <FastBook coin={coin} precision={precision} />
    </div>
  );
}

function Status({ status }: { status: FeedState["status"] }) {
  return (
    <span className={`feed-status ${status}`} role="status">
      <i />
      {status === "live"
        ? "Live"
        : status === "connecting"
          ? "Connecting"
          : status === "stale"
            ? "Stale feed"
            : "Reconnecting"}
    </span>
  );
}

function FeedFooter({ feed, fast }: { feed: FeedState; fast: boolean }) {
  return (
    <div className="feed-footer">
      <span>
        {fast ? "Fast" : "Slow"} L2 feed <span className="separator">/</span>{" "}
        {fast ? "5" : "20"} levels per side
      </span>
      <span className="update-count" title="Snapshots received this session">
        {feed.updates.toLocaleString("en-US")} updates
      </span>
    </div>
  );
}

const Row = memo(function Row({
  px,
  sz,
  orders,
  total,
  width,
  entered,
  side,
  compactRow = false,
}: {
  px: string;
  sz: string;
  orders: number;
  total: number;
  width: number;
  entered: boolean;
  side: "bid" | "ask";
  compactRow?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousSize = useRef(sz);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (entered)
      ref.current?.animate(
        [
          { backgroundColor: side === "bid" ? "#43d9b055" : "#f2788b55" },
          { backgroundColor: "transparent" },
        ],
        { duration: 650, easing: "ease-out" },
      );
  }, [entered, side]);
  useEffect(() => {
    if (
      previousSize.current !== sz &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      ref.current
        ?.querySelector(".level-size")
        ?.animate(
          [
            { color: +sz > +previousSize.current ? "#75e5c4" : "#f294a1" },
            { color: "#d5dddd" },
          ],
          { duration: 450 },
        );
    }
    previousSize.current = sz;
  }, [sz]);
  return (
    <div
      ref={ref}
      role="row"
      className={`book-row ${side} ${compactRow ? "compact-row" : ""}`}
      data-price={px}
      title={`${orders} resting orders · ${size(total)} cumulative size`}
    >
      <span
        className="depth-bar"
        style={{ transform: `scaleX(${width})` }}
        aria-hidden="true"
      />
      <span role="cell" className="level-price">
        {price(+px)}
      </span>
      <span role="cell" className="level-size">
        {displaySize(+sz)}
      </span>
      <span role="cell" className="level-total">
        {displaySize(total)}
      </span>
    </div>
  );
});

function Side({
  levels,
  side,
  count,
  scale,
  coin,
  reverse = false,
  compactRow = false,
}: {
  levels: DepthLevel[];
  side: "bid" | "ask";
  count: number;
  scale: number;
  coin: Coin;
  reverse?: boolean;
  compactRow?: boolean;
}) {
  const rows = Array.from({ length: count }, (_, i) => levels[i] ?? null);
  if (reverse) rows.reverse();
  return (
    <div
      className={`book-side ${side}`}
      role="table"
      aria-label={`${side === "bid" ? "Bids" : "Asks"}, ${coin}`}
    >
      {!compactRow && (
        <>
          <div className="side-label" aria-hidden="true">
            <span>{side === "bid" ? "Buy orders" : "Sell orders"}</span>
            <span>{side === "bid" ? "BID" : "ASK"}</span>
          </div>
          <div className="column-head" role="row">
            <span role="columnheader">
              Price <small>USD</small>
            </span>
            <span role="columnheader">
              Size <small>{coin}</small>
            </span>
            <span role="columnheader">
              Total <small>{coin}</small>
            </span>
          </div>
        </>
      )}
      {compactRow && (
        <div className="sr-only" role="row">
          <span role="columnheader">Price USD</span>
          <span role="columnheader">Size {coin}</span>
          <span role="columnheader">Total {coin}</span>
        </div>
      )}
      <div className="side-rows" role="rowgroup">
        {rows.map((level, i) =>
          level ? (
            <Row
              key={+level.px}
              px={level.px}
              sz={level.sz}
              orders={level.n}
              total={level.total}
              entered={level.entered}
              width={scale ? level.total / scale : 0}
              side={side}
              compactRow={compactRow}
            />
          ) : (
            <div key={`empty-${i}`} className="book-row empty-row" role="row">
              <span role="cell">—</span>
              <span role="cell">—</span>
              <span role="cell">—</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function SlowBook({ coin, precision }: { coin: Coin; precision: Precision }) {
  const feed = useBook(coin, precision, false);
  const [bids, asks] = feed.depth;
  const bidTotal = bids.at(-1)?.total ?? 0;
  const askTotal = asks.at(-1)?.total ?? 0;
  const scale = Math.max(bidTotal, askTotal);
  const imbalance =
    bidTotal + askTotal ? (bidTotal / (bidTotal + askTotal)) * 100 : 50;
  return (
    <section
      className={`depth-panel ${feed.status !== "live" ? "not-live" : ""}`}
      aria-labelledby="depth-title"
    >
      <div className="panel-heading">
        <div>
          <h2 id="depth-title">Market depth</h2>
          <span className="panel-description">The wider picture</span>
        </div>
        <Status status={feed.status} />
      </div>
      <div className="two-sided">
        <Side levels={bids} side="bid" count={20} scale={scale} coin={coin} />
        <Side levels={asks} side="ask" count={20} scale={scale} coin={coin} />
      </div>
      <div className="imbalance">
        <div className="imbalance-labels">
          <span className="bid-text">
            Buy <strong>{feed.book ? `${imbalance.toFixed(1)}%` : "—"}</strong>
          </span>
          <span className="imbalance-title">Visible liquidity</span>
          <span className="ask-text">
            <strong>
              {feed.book ? `${(100 - imbalance).toFixed(1)}%` : "—"}
            </strong>{" "}
            Sell
          </span>
        </div>
        <div className="imbalance-track">
          <div style={{ width: `${imbalance}%` }} />
        </div>
        <div className="imbalance-totals">
          <span>
            {feed.book ? size(bidTotal) : "—"} {coin}
          </span>
          <span>
            {feed.book ? size(askTotal) : "—"} {coin}
          </span>
        </div>
      </div>
      <FeedFooter feed={feed} fast={false} />
    </section>
  );
}

function FastBook({ coin, precision }: { coin: Coin; precision: Precision }) {
  const feed = useBook(coin, precision, true);
  const values = metrics(feed.book);
  const [bids, asks] = feed.depth;
  const scale = Math.max(bids.at(-1)?.total ?? 0, asks.at(-1)?.total ?? 0);
  return (
    <aside className="sidebar">
      <section
        className={`fast-panel ${feed.status !== "live" ? "not-live" : ""}`}
        aria-labelledby="fast-title"
      >
        <div className="panel-heading">
          <div>
            <h2 id="fast-title">
              <span className="bolt" aria-hidden="true">
                ϟ
              </span>{" "}
              Top of book
            </h2>
            <span className="panel-description">The pulse of the market</span>
          </div>
          <Status status={feed.status} />
        </div>
        <div className="mid-price">
          <span className="eyebrow">
            MID PRICE <span>USD</span>
          </span>
          <div>
            {price(values?.mid)}
            <span className="mid-symbol">{coin}</span>
          </div>
          <span className="mid-caption">Between the best bid and ask</span>
        </div>
        <div className="fast-columns column-head" aria-hidden="true">
          <span>
            Price <small>USD</small>
          </span>
          <span>
            Size <small>{coin}</small>
          </span>
          <span>
            Total <small>{coin}</small>
          </span>
        </div>
        <Side
          levels={asks.slice(0, 5)}
          side="ask"
          count={5}
          scale={scale}
          coin={coin}
          reverse
          compactRow
        />
        <div className="spread">
          <span>Spread</span>
          <strong>
            {price(values?.spread)} <small>USD</small>
          </strong>
          <span>{values ? values.bps.toFixed(2) : "—"} bps</span>
        </div>
        <Side
          levels={bids.slice(0, 5)}
          side="bid"
          count={5}
          scale={scale}
          coin={coin}
          compactRow
        />
        <FeedFooter feed={feed} fast />
      </section>
      <section className="reading-card">
        <div className="reading-heading">
          <span className="reading-icon" aria-hidden="true">
            ≋
          </span>
          <h2>Read between the levels.</h2>
        </div>
        <p>
          Depth bars show cumulative liquidity. A brief flash marks a new price
          level entering the book.
        </p>
        <div className="legend">
          <span>
            <i className="legend-bid" />
            Bids
          </span>
          <span>
            <i className="legend-ask" />
            Asks
          </span>
          <span>
            <i className="legend-flash" />
            New level
          </span>
        </div>
        <div className="notional">
          <span>Top 5 resting liquidity</span>
          <strong>
            {feed.book
              ? `$${compact([...bids.slice(0, 5), ...asks.slice(0, 5)].reduce((sum, level) => sum + +level.px * +level.sz, 0))}`
              : "—"}
          </strong>
        </div>
      </section>
    </aside>
  );
}
