"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  displaySize,
  metrics,
  price,
  type Coin,
  type Precision,
} from "@/lib/book";
import { type MergedLevel } from "@/lib/merge-book";
import { useOrderBook, type FeedState } from "@/lib/use-book";
import {
  DepthSummary,
  useDepthHover,
  type DepthSelection,
} from "./depth-summary";

const VISIBLE_LEVELS = 12;
export function Terminal() {
  const [coin, setCoin] = useState<Coin>("BTC");
  const [precision, setPrecision] = useState<Precision>(5);
  return (
    <main>
      <section className="workspace" aria-label="Live order book">
        <header className="widget-heading">
          <h1>Order book</h1>
        </header>
        <div className="book-toolbar">
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
          <label className="sr-only" htmlFor="precision">
            Price precision
          </label>
          <select
            id="precision"
            value={precision ?? "full"}
            onChange={(event) =>
              setPrecision(
                event.target.value === "full"
                  ? null
                  : (+event.target.value as Precision),
              )
            }
          >
            <option value="full">Full precision</option>
            {[5, 4, 3, 2].map((n) => (
              <option key={n} value={n}>
                {n} sig. figs
              </option>
            ))}
          </select>
        </div>
        <OrderBook
          key={`${coin}:${precision}`}
          coin={coin}
          precision={precision}
        />
      </section>
    </main>
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
  index,
  highlighted,
  selected,
  total,
  confirmed,
  entered,
  width,
  side,
}: {
  px: string;
  sz: string;
  index: number;
  highlighted: boolean;
  selected: boolean;
  total: number;
  confirmed: boolean;
  entered: boolean;
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
      className={`book-row ${side} ${confirmed ? "confirmed" : "estimated"} ${highlighted ? "in-sweep" : ""} ${selected ? "selected-level" : ""}`}
      data-price={px}
      data-confirmed={confirmed}
      data-depth-index={index}
      data-side={side}
      tabIndex={0}
      aria-label={`${side === "ask" ? "Ask" : "Bid"} level ${index + 1}${confirmed ? "" : ", estimated"}: ${price(+px)} USD`}
      aria-describedby={selected ? "depth-summary" : undefined}
    >
      <span
        className="depth-bar"
        style={{ transform: `scaleX(${width})` }}
        aria-hidden="true"
      />
      <span role="cell" className="level-price">
        <span className="estimate-mark" aria-hidden="true">
          {confirmed ? "" : "≈"}
        </span>
        {price(+px)}
      </span>
      <span role="cell" className="level-size">
        <span className="estimate-mark" aria-hidden="true">
          {confirmed ? "" : "≈"}
        </span>
        {displaySize(+sz)}
      </span>
      <span role="cell" className="level-total">
        <span className="estimate-mark" aria-hidden="true">
          {confirmed ? "" : "≈"}
        </span>
        {displaySize(total)}
      </span>
    </div>
  );
});

function Side({
  levels,
  side,
  scale,
  selection,
}: {
  selection: DepthSelection | null;
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
            key={
              level.confirmed
                ? +level.px
                : `estimate-${side === "ask" ? VISIBLE_LEVELS - 1 - i : i}`
            }
            px={level.px}
            sz={level.sz}
            index={side === "ask" ? VISIBLE_LEVELS - 1 - i : i}
            highlighted={
              selection?.side === side &&
              (side === "ask" ? VISIBLE_LEVELS - 1 - i : i) <= selection.index
            }
            selected={
              selection?.side === side &&
              (side === "ask" ? VISIBLE_LEVELS - 1 - i : i) === selection.index
            }
            total={level.total}
            confirmed={level.confirmed}
            entered={level.entered}
            width={!scale ? 0 : Math.min(1, level.total / scale)}
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
  const { selection, select, clear } = useDepthHover();
  const values = metrics(feed.book);
  const [bids, asks] = feed.book?.levels ?? [[], []];
  const selectedLevels = selection?.side === "ask" ? asks : bids;
  const activeSelection =
    selection && selectedLevels[selection.index] ? selection : null;
  const visible = [
    ...bids.slice(0, VISIBLE_LEVELS),
    ...asks.slice(0, VISIBLE_LEVELS),
  ];
  const scale = Math.max(0, ...visible.map((level) => level.total));
  // Only the latest snapshot's top five contribute. Estimated tails do not affect this balance.
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
      <div
        className="book-table"
        role="table"
        aria-label={`${coin} order book`}
        aria-colcount={3}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch") select(event.target, "pointer");
        }}
        onPointerLeave={() => {
          if (selection?.mode === "pointer") clear();
        }}
        onFocus={(event) => select(event.target, "focus")}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) clear();
        }}
        onClick={(event) => select(event.target, "touch")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            clear();
            event.stopPropagation();
          }
        }}
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
        <Side
          levels={asks}
          side="ask"
          scale={scale}
          selection={activeSelection}
        />
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
        <Side
          levels={bids}
          side="bid"
          scale={scale}
          selection={activeSelection}
        />
      </div>
      {activeSelection && (
        <DepthSummary
          selection={activeSelection}
          levels={selectedLevels}
          coin={coin}
          mid={values?.mid}
          stale={feed.status === "stale"}
        />
      )}
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
      <footer className="feed-footer">
        <Status feed={feed} />
        <span title="Outer levels are projected from the last full snapshot. Approximate prices, sizes and totals are marked ≈.">
          ≈ Estimated depth
        </span>
      </footer>
    </div>
  );
}
