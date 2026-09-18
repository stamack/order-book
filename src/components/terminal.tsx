"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  displaySize,
  metrics,
  price,
  size,
  type Coin,
  type Precision,
} from "@/lib/book";
import { type MergedLevel } from "@/lib/merge-book";
import { useOrderBook, type FeedState } from "@/lib/use-book";

const VISIBLE_LEVELS = 12;
const DOCS =
  "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions";

function Mark() {
  return (
    <svg
      width="25"
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
          depth<span>.</span>
        </a>
        <span className="header-caption">THE MARKET, IN FOCUS.</span>
        <a
          className="source-link"
          href={`https://app.hyperliquid.xyz/trade/${coin}`}
          target="_blank"
          rel="noreferrer"
        >
          <i />
          Hyperliquid <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main>
        <div className="page-intro">
          <span className="eyebrow">LESS NOISE. MORE SIGNAL.</span>
          <h1>Liquidity, at a glance.</h1>
          <p>One book. Every move.</p>
        </div>
        <section className="workspace" aria-label="Live order book">
          <div className="market-toolbar">
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
            </div>
            <span className="perp-tag">PERPETUAL</span>
          </div>
          <div className="book-toolbar">
            <h2>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                aria-hidden="true"
              >
                <path
                  d="M1 1h12v2H1zm3 4h9v2H4zm3 4h6v2H7z"
                  fill="currentColor"
                />
              </svg>
              Order book
            </h2>
            <div className="precision-control">
              <label htmlFor="precision">Precision</label>
              <select
                id="precision"
                aria-label="Price precision"
                value={precision ?? "full"}
                onChange={(event) =>
                  setPrecision(
                    event.target.value === "full"
                      ? null
                      : (+event.target.value as Precision),
                  )
                }
              >
                <option value="full">Full</option>
                {[5, 4, 3, 2].map((n) => (
                  <option key={n} value={n}>
                    {n} sig. figs
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* An atomic reset prevents a previous market or grouping leaking through. */}
          <OrderBook
            key={`${coin}:${precision}`}
            coin={coin}
            precision={precision}
          />
        </section>
        <footer className="page-footer">
          <span>Built for the moments between trades.</span>
          <a href={DOCS} target="_blank" rel="noreferrer">
            Powered by Hyperliquid <span aria-hidden="true">↗</span>
          </a>
        </footer>
      </main>
    </>
  );
}

function Status({ feed }: { feed: FeedState }) {
  const labels = {
    live: "Live",
    connecting: "Connecting",
    stale: "Stale data",
    reconnecting: "Reconnecting",
    degraded: "Partial feed",
  };
  return (
    <span
      className={`feed-status ${feed.status}`}
      role="status"
      title={`Fast feed: ${feed.connections.fast}. Full depth: ${feed.connections.slow}.`}
    >
      <i />
      {labels[feed.status]}
    </span>
  );
}

const Row = memo(function Row({
  px,
  sz,
  n,
  total,
  confirmed,
  entered,
  time,
  width,
  side,
}: {
  px: string;
  sz: string;
  n: number;
  total: number | null;
  confirmed: boolean;
  entered: boolean;
  time: number;
  width: number;
  side: "bid" | "ask";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousSize = useRef(sz);
  useEffect(() => {
    if (
      entered &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      ref.current?.animate(
        [
          { backgroundColor: side === "bid" ? "#56edbe50" : "#ff829950" },
          { backgroundColor: "transparent" },
        ],
        { duration: 650, easing: "ease-out" },
      );
    }
  }, [entered, side]);
  useEffect(() => {
    if (
      confirmed &&
      previousSize.current !== sz &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      ref.current
        ?.querySelector(".level-size")
        ?.animate(
          [
            { color: +sz > +previousSize.current ? "#7becce" : "#ff9baa" },
            { color: "#cfdddf" },
          ],
          { duration: 400 },
        );
    }
    previousSize.current = sz;
  }, [sz, confirmed]);
  return (
    <div
      ref={ref}
      role="row"
      className={`book-row ${side} ${confirmed ? "confirmed" : "cached"}`}
      data-price={px}
      data-confirmed={confirmed}
      title={`${confirmed ? "Confirmed" : "Last confirmed; may have changed"} at ${new Date(time).toISOString().slice(11, 23)} UTC · ${n} orders · size ${size(+sz)}${total === null ? " · cumulative total unavailable" : ` · cumulative ${size(total)}`}`}
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
        <span className="cached-mark" aria-label="last confirmed">
          {confirmed ? "" : "≈"}
        </span>
        {displaySize(+sz)}
      </span>
      <span role="cell" className="level-total">
        {total === null ? "—" : displaySize(total)}
      </span>
    </div>
  );
});

function Side({
  levels,
  side,
  scale,
}: {
  levels: MergedLevel[];
  side: "bid" | "ask";
  scale: number;
}) {
  const rows = Array.from(
    { length: VISIBLE_LEVELS },
    (_, i) => levels[i] ?? null,
  );
  if (side === "ask") rows.reverse();
  return (
    <div
      className={`side-rows ${side}`}
      role="rowgroup"
      aria-label={
        side === "ask"
          ? "Asks, highest to lowest price"
          : "Bids, highest to lowest price"
      }
    >
      {rows.map((level, i) =>
        level ? (
          <Row
            key={+level.px}
            px={level.px}
            sz={level.sz}
            n={level.n}
            time={level.time}
            total={level.total}
            confirmed={level.confirmed}
            entered={level.entered}
            width={
              level.total === null || !scale
                ? 0
                : Math.min(1, level.total / scale)
            }
            side={side}
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
  );
}

function MidPrice({ value }: { value: number | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useEffect(() => {
    if (
      value !== undefined &&
      previous.current !== undefined &&
      value !== previous.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      ref.current?.animate(
        [
          { color: value > previous.current ? "#78dfc0" : "#f294a4" },
          { color: "#edf4f3" },
        ],
        { duration: 650 },
      );
    }
    previous.current = value;
  }, [value]);
  return (
    <span ref={ref} className="mid-value">
      {price(value)}
    </span>
  );
}

function OrderBook({ coin, precision }: { coin: Coin; precision: Precision }) {
  const feed = useOrderBook(coin, precision);
  const values = metrics(feed.book);
  const [bids, asks] = feed.book?.levels ?? [[], []];
  const visible = [
    ...bids.slice(0, VISIBLE_LEVELS),
    ...asks.slice(0, VISIBLE_LEVELS),
  ];
  const scale = Math.max(0, ...visible.map((level) => level.total ?? 0));
  // Only the latest snapshot's top five contribute. Cached tails are never summed.
  const bidSize = bids
    .slice(0, 5)
    .filter((level) => level.confirmed)
    .reduce((sum, level) => sum + +level.sz, 0);
  const askSize = asks
    .slice(0, 5)
    .filter((level) => level.confirmed)
    .reduce((sum, level) => sum + +level.sz, 0);
  const balance =
    bidSize + askSize ? (bidSize / (bidSize + askSize)) * 100 : 50;
  return (
    <div className={`order-book ${feed.status === "stale" ? "is-stale" : ""}`}>
      <div className="book-info">
        <span className="level-count">{VISIBLE_LEVELS} levels per side</span>
        <Status feed={feed} />
      </div>
      <div
        className="book-table"
        role="table"
        aria-label={`${coin} order book`}
        aria-colcount={3}
      >
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
        <div className="side-label ask-text" aria-hidden="true">
          <span>
            <i /> ASKS
          </span>
          <span>Sell orders</span>
        </div>
        <Side levels={asks} side="ask" scale={scale} />
        <div className="spread" role="row">
          <div role="cell" className="mid-price">
            <MidPrice value={values?.mid} />
            <span>
              Mid price <small>USD</small>
            </span>
          </div>
          <div role="cell" className="spread-value">
            <span>
              Spread <strong>{price(values?.spread)}</strong>
            </span>
            <span>
              {values ? values.bps.toFixed(2) : "—"} <small>bps</small>
            </span>
          </div>
          <span role="cell" className="sr-only">
            Midpoint and spread use the newest confirmed snapshot.
          </span>
        </div>
        <div className="side-label bid-text" aria-hidden="true">
          <span>
            <i /> BIDS
          </span>
          <span>Buy orders</span>
        </div>
        <Side levels={bids} side="bid" scale={scale} />
      </div>
      <div className="imbalance">
        <div className="imbalance-labels">
          <span className="bid-text">
            B <strong>{feed.book ? `${balance.toFixed(1)}%` : "—"}</strong>
          </span>
          <span>Top 5 balance</span>
          <span className="ask-text">
            <strong>
              {feed.book ? `${(100 - balance).toFixed(1)}%` : "—"}
            </strong>{" "}
            S
          </span>
        </div>
        <div className="imbalance-track">
          <div style={{ width: `${balance}%` }} />
        </div>
      </div>
      <div className="book-legend">
        <span>
          <i className="flash-key" />
          New level
        </span>
        <span title="Older outer levels are marked ≈ for up to two seconds. They may have changed. Their cumulative totals are withheld.">
          ≈ Last confirmed · ≤2s
        </span>
      </div>
      <div className="feed-footer">
        <span>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m9 1-6 8h4l-1 6 7-9H9z" fill="currentColor" />
          </svg>
          Fast updates. Full depth.
        </span>
        <span
          className="snapshot-time"
          title="Exchange time of the newest snapshot"
        >
          {feed.book
            ? `${new Date(feed.book.time).toISOString().slice(11, 19)} UTC`
            : "Waiting for feed"}
        </span>
      </div>
    </div>
  );
}
