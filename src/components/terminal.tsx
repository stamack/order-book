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

import { Trades } from "./trades";

const VISIBLE_LEVELS = 12;
export function Terminal() {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const [coin, setCoin] = useState<Coin>("BTC");
  const [precision, setPrecision] = useState<Precision>(5);
  return (
    <main>
      <section className="workspace" aria-label="Live order book">
        <div
          className="widget-heading"
          role="tablist"
          aria-label="Market data"
          onKeyDown={(event) => {
            const next =
              event.key === "Home"
                ? "book"
                : event.key === "End"
                  ? "trades"
                  : event.key === "ArrowLeft" || event.key === "ArrowRight"
                    ? tab === "book"
                      ? "trades"
                      : "book"
                    : null;
            if (next) {
              event.preventDefault();
              setTab(next);
              document.getElementById(`${next}-tab`)?.focus();
            }
          }}
        >
          {(["book", "trades"] as const).map((value) => (
            <button
              key={value}
              id={`${value}-tab`}
              role="tab"
              aria-selected={tab === value}
              aria-controls="market-panel"
              tabIndex={tab === value ? 0 : -1}
              onClick={() => setTab(value)}
            >
              {value === "book" ? "Order book" : "Trades"}
            </button>
          ))}
        </div>
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
            hidden={tab !== "book"}
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
        <div
          id="market-panel"
          role="tabpanel"
          aria-labelledby={`${tab}-tab`}
          className="data-panel"
        >
          {tab === "book" ? (
            <OrderBook
              key={`${coin}:${precision}`}
              coin={coin}
              precision={precision}
            />
          ) : (
            <Trades key={coin} coin={coin} />
          )}
        </div>
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
      title={`${feed.book ? `Last updated at ${new Date(feed.book.time).toISOString()}. ` : "Waiting for first update. "}Fast feed: ${feed.connections.fast}. Full depth: ${feed.connections.slow}.`}
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
  const flashRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (
      entered &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const flash = flashRef.current;
      flash?.getAnimations().forEach((animation) => animation.cancel());
      flash?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 650,
        easing: "ease-out",
      });
    }
  }, [entered, side]);
  return (
    <div
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
      <span ref={flashRef} className="row-flash" aria-hidden="true" />
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
          <div role="cell" className="mid-price" title="Mid price (USD)">
            <span className="mid-value">{price(values?.mid)}</span>
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
      <div
        className="imbalance"
        title="Balance of the five confirmed levels on each side"
      >
        <div className="imbalance-labels">
          <span className="bid-text">
            B <strong>{feed.book ? `${balance.toFixed(1)}%` : "—"}</strong>
          </span>
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
      </footer>
    </div>
  );
}
