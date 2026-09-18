"use client";

import { memo } from "react";
import { displaySize, price, type Coin } from "@/lib/book";
import { TRADE_LIMIT, tradeKey, type Trade } from "@/lib/trades";
import { useTrades } from "@/lib/use-trades";

const TradeRow = memo(function TradeRow({ trade }: { trade: Trade }) {
  const time = new Date(trade.time).toISOString();
  return (
    <div
      role="row"
      className={`trade-row ${trade.side === "B" ? "bid" : "ask"}`}
      data-trade-id={tradeKey(trade)}
      title={`${trade.side === "B" ? "Buy" : "Sell"} execution · ${time}`}
    >
      <span role="cell" className="level-price">
        <a
          className="trade-link"
          href={`https://app.hyperliquid.xyz/explorer/tx/${trade.hash}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${trade.side === "B" ? "buy" : "sell"} trade at ${price(+trade.px)} USD on Hyperliquid explorer (opens in new tab)`}
        >
          {price(+trade.px)}
        </a>
      </span>
      <span role="cell">{displaySize(+trade.sz)}</span>
      <span role="cell" className="trade-time">
        {time.slice(11, 19)}
      </span>
    </div>
  );
});

export function Trades({ coin }: { coin: Coin }) {
  const { trades, status, updatedAt } = useTrades(coin);
  const labels = {
    connecting: "Connecting",
    live: "Live",
    stale: "Stale feed",
    reconnecting: "Reconnecting",
  };
  return (
    <div className={`trades-panel ${status === "live" ? "" : "not-live"}`}>
      <div role="table" aria-label={`${coin} recent trades`}>
        <div className="column-head" role="row">
          <span role="columnheader">
            Price <small>USD</small>
          </span>
          <span role="columnheader">
            Size <small>{coin}</small>
          </span>
          <span role="columnheader">
            Time <small>UTC</small>
          </span>
        </div>
        <div className="trade-rows" role="rowgroup">
          {Array.from({ length: TRADE_LIMIT }, (_, i) =>
            trades[i] ? (
              <TradeRow key={tradeKey(trades[i])} trade={trades[i]} />
            ) : (
              <div
                key={`empty-${i}`}
                role="row"
                className="trade-row empty-row"
              >
                <span role="cell">—</span>
                <span role="cell">—</span>
                <span role="cell">—</span>
              </div>
            ),
          )}
        </div>
      </div>
      <footer className="feed-footer">
        <span
          className={`feed-status ${status}`}
          role="status"
          title={
            updatedAt
              ? `Last updated at ${new Date(updatedAt).toISOString()}`
              : "Waiting for first trade update"
          }
        >
          <i />
          {labels[status]}
        </span>
      </footer>
    </div>
  );
}
