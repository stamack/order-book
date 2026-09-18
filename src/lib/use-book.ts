"use client";

import { useEffect, useState } from "react";
import {
  type Book,
  type Coin,
  type Depth,
  type Precision,
  depthFrom,
  parseBook,
} from "./book";

export type FeedState = {
  book: Book | null;
  depth: Depth;
  status: "connecting" | "live" | "stale" | "reconnecting";
  updates: number;
};
const initial: FeedState = {
  book: null,
  depth: [[], []],
  status: "connecting",
  updates: 0,
};

/** Separate sockets: WsBook has no fast/nSigFigs field to identify subscriptions. */
export function useBook(
  coin: Coin,
  precision: Precision,
  fast: boolean,
): FeedState {
  const [state, setState] = useState<FeedState>(initial);
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let frame = 0;
    let attempts = 0;
    let lastReceived = Date.now();
    let lastPing = 0;
    let pending: Book | null = null;
    let published: Book | null = null;
    let newestTime = 0;
    let updates = 0;

    function connect() {
      if (disposed) return;
      lastReceived = Date.now();
      socket = new WebSocket("wss://api.hyperliquid.xyz/ws");
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            method: "subscribe",
            subscription: {
              type: "l2Book",
              coin,
              fast,
              ...(precision === null ? {} : { nSigFigs: precision }),
            },
          }),
        );
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        let book: Book | null;
        try {
          book = parseBook(JSON.parse(event.data), coin);
        } catch {
          return;
        }
        if (!book || book.time < newestTime) return;
        newestTime = book.time;
        lastReceived = Date.now();
        attempts = 0;
        updates++;
        pending = book;
        // Coalesce bursts to the latest complete snapshot at the next paint.
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (disposed || !pending) return;
            setState({
              book: pending,
              depth: depthFrom(pending, published),
              status: "live",
              updates,
            });
            published = pending;
            pending = null;
          });
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        cancelAnimationFrame(frame);
        frame = 0;
        pending = null;
        published = null; // Reconnect snapshots should not flash every level.
        setState((current) => ({ ...current, status: "reconnecting" }));
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 15_000));
      };
    }

    connect();
    const heartbeat = setInterval(() => {
      const now = Date.now();
      if (socket.readyState === WebSocket.OPEN && now - lastPing >= 25_000) {
        socket.send(JSON.stringify({ method: "ping" }));
        lastPing = now;
      }
      if (now - lastReceived > 10_000)
        setState((current) =>
          current.status === "live" ? { ...current, status: "stale" } : current,
        );
      if (now - lastReceived > 20_000 && socket.readyState < WebSocket.CLOSING)
        socket.close();
    }, 1000);
    return () => {
      disposed = true;
      clearInterval(heartbeat);
      clearTimeout(retry);
      cancelAnimationFrame(frame);
      socket.onclose = null;
      socket.close();
    };
  }, [coin, precision, fast]);
  return state;
}
