"use client";

import { useEffect, useState } from "react";
import type { Coin } from "./book";
import { mergeTrades, parseTrades, type Trade } from "./trades";

type Status = "connecting" | "live" | "stale" | "reconnecting";
export function useTrades(coin: Coin) {
  const [state, setState] = useState<{
    trades: Trade[];
    status: Status;
    updatedAt: number | null;
  }>({
    trades: [],
    updatedAt: null,
    status: "connecting",
  });
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let frame = 0;
    let attempts = 0;
    let trades: Trade[] = [];
    let status: Status = "connecting";
    let updatedAt: number | null = null;
    let lastMessage = Date.now();
    let lastPing = 0;
    const publish = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!disposed) setState({ trades, status, updatedAt });
      });
    };
    function connect() {
      if (disposed) return;
      lastMessage = Date.now();
      socket = new WebSocket("wss://api.hyperliquid.xyz/ws");
      socket.onopen = () => {
        if (!disposed)
          socket.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { type: "trades", coin },
            }),
          );
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data);
          const incoming = parseTrades(message, coin);
          if (
            incoming === null &&
            message.channel !== "pong" &&
            !(
              message.channel === "subscriptionResponse" &&
              message.data?.subscription?.coin === coin
            )
          )
            return;
          lastMessage = Date.now();
          attempts = 0;
          const next = incoming ? mergeTrades(trades, incoming) : trades;
          const changed =
            next !== trades || status !== "live" || !!incoming?.length;
          if (incoming?.length) updatedAt = Date.now();
          trades = next;
          status = "live";
          if (changed) publish();
        } catch {
          /* Preserve the last valid executions. */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        status = "reconnecting";
        publish();
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 15_000));
      };
    }
    connect();
    const heartbeat = setInterval(() => {
      const now = Date.now();
      // Quiet trading is not a broken feed: pong responses establish liveness.
      if (socket.readyState === WebSocket.OPEN && now - lastPing >= 10_000) {
        socket.send(JSON.stringify({ method: "ping" }));
        lastPing = now;
      }
      if (now - lastMessage > 15_000 && status === "live") {
        status = "stale";
        publish();
      }
      if (now - lastMessage > 25_000 && socket.readyState < WebSocket.CLOSING)
        socket.close();
    }, 1000);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearInterval(heartbeat);
      clearTimeout(retry);
      socket.onclose = null;
      socket.close();
    };
  }, [coin]);
  return state;
}
