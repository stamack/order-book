"use client";

import { useEffect, useState } from "react";
import { type Coin, type Precision, parseBook } from "./book";
import { BookMerger, type MergedBook, type Source } from "./merge-book";

export type Connection = "connecting" | "live" | "stale" | "reconnecting";
export type FeedState = {
  book: MergedBook | null;
  status: Connection | "degraded";
  connections: Record<Source, Connection>;
};
const initial: FeedState = {
  book: null,
  status: "connecting",
  connections: { fast: "connecting", slow: "connecting" },
};

export function useOrderBook(coin: Coin, precision: Precision): FeedState {
  const [state, setState] = useState<FeedState>(initial);
  useEffect(() => {
    const merger = new BookMerger(coin);
    let disposed = false;
    let frame = 0;
    let newestTime = -1;
    let currentReceivedAt = Date.now();
    let lastCacheCount = 0;
    let currentStale = false;
    const connections: Record<Source, Connection> = {
      fast: "connecting",
      slow: "connecting",
    };
    const sockets = {} as Record<Source, WebSocket>;
    const retries: Partial<Record<Source, ReturnType<typeof setTimeout>>> = {};
    const attempts = { fast: 0, slow: 0 };
    const receivedAt = { fast: Date.now(), slow: Date.now() };
    const pingedAt = { fast: 0, slow: 0 };

    function publish() {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposed) return;
        const now = Date.now();
        const book = merger.read(now);
        const healthy = Object.values(connections).every(
          (value) => value === "live",
        );
        const reconnecting = Object.values(connections).every(
          (value) => value === "reconnecting",
        );
        const status = !book
          ? reconnecting
            ? "reconnecting"
            : "connecting"
          : now - currentReceivedAt > 10_000
            ? "stale"
            : healthy
              ? "live"
              : "degraded";
        lastCacheCount =
          book?.levels.flat().filter((level) => !level.confirmed).length ?? 0;
        setState({ book, status, connections: { ...connections } });
        if (book) merger.published(book);
      });
    }

    function connect(source: Source) {
      if (disposed) return;
      receivedAt[source] = Date.now();
      // WsBook doesn't identify fast/slow subscriptions; sockets do.
      const socket = (sockets[source] = new WebSocket(
        "wss://api.hyperliquid.xyz/ws",
      ));
      socket.onopen = () => {
        if (disposed) return;
        socket.send(
          JSON.stringify({
            method: "subscribe",
            subscription: {
              type: "l2Book",
              coin,
              fast: source === "fast",
              ...(precision === null ? {} : { nSigFigs: precision }),
            },
          }),
        );
      };
      socket.onmessage = (event) => {
        if (disposed || sockets[source] !== socket) return;
        try {
          const book = parseBook(JSON.parse(event.data), coin);
          if (
            !book ||
            (source === "fast" && book.levels.some((side) => side.length > 5))
          )
            return;
          const now = Date.now();
          const changed = merger.ingest(source, book, now);
          receivedAt[source] = now;
          attempts[source] = 0;
          const recovered = connections[source] !== "live";
          connections[source] = "live";
          if (book.time >= newestTime) {
            newestTime = book.time;
            currentReceivedAt = now;
          }
          if (changed || recovered) publish();
        } catch {
          /* Malformed messages never replace valid data. */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        connections[source] = "reconnecting";
        publish();
        retries[source] = setTimeout(
          () => connect(source),
          Math.min(1000 * 2 ** attempts[source]++, 15_000),
        );
      };
    }
    connect("fast");
    connect("slow");
    const heartbeat = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const source of ["fast", "slow"] as const) {
        const socket = sockets[source];
        if (
          socket.readyState === WebSocket.OPEN &&
          now - pingedAt[source] >= 25_000
        ) {
          socket.send(JSON.stringify({ method: "ping" }));
          pingedAt[source] = now;
        }
        if (
          now - receivedAt[source] > 10_000 &&
          connections[source] === "live"
        ) {
          connections[source] = "stale";
          changed = true;
        }
        if (
          now - receivedAt[source] > 20_000 &&
          socket.readyState < WebSocket.CLOSING
        )
          socket.close();
      }
      // Expire historical tails even when both feeds go quiet.
      const cached = lastCacheCount
        ? (merger
            .read(now)
            ?.levels.flat()
            .filter((level) => !level.confirmed).length ?? 0)
        : 0;
      const stale = newestTime >= 0 && now - currentReceivedAt > 10_000;
      if (changed || stale !== currentStale || cached !== lastCacheCount)
        publish();
      currentStale = stale;
    }, 250);
    return () => {
      disposed = true;
      clearInterval(heartbeat);
      cancelAnimationFrame(frame);
      for (const source of ["fast", "slow"] as const) {
        clearTimeout(retries[source]);
        sockets[source].onclose = null;
        sockets[source].close();
      }
    };
  }, [coin, precision]);
  return state;
}
