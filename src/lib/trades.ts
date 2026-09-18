import type { Coin } from "./book";

export type Trade = {
  coin: Coin;
  side: "B" | "A";
  px: string;
  sz: string;
  time: number;
  tid: number;
  hash: string;
};
export const TRADE_LIMIT = 27;
export const tradeKey = (trade: Trade) =>
  `${trade.coin}:${trade.time}:${trade.tid}`;

export function parseTrades(message: unknown, coin: Coin): Trade[] | null {
  if (
    !message ||
    typeof message !== "object" ||
    !("channel" in message) ||
    message.channel !== "trades" ||
    !("data" in message) ||
    !Array.isArray(message.data)
  )
    return null;
  return message.data.filter(
    (trade): trade is Trade =>
      trade &&
      trade.coin === coin &&
      (trade.side === "B" || trade.side === "A") &&
      typeof trade.px === "string" &&
      Number.isFinite(+trade.px) &&
      +trade.px > 0 &&
      typeof trade.sz === "string" &&
      Number.isFinite(+trade.sz) &&
      +trade.sz > 0 &&
      Number.isSafeInteger(trade.time) &&
      trade.time >= 0 &&
      trade.time <= 8_640_000_000_000_000 &&
      typeof trade.hash === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(trade.hash) &&
      Number.isSafeInteger(trade.tid) &&
      trade.tid >= 0,
  );
}

/** Retain distinct executions, including multiple fills with the same price/time. */
export function mergeTrades(previous: Trade[], incoming: Trade[]): Trade[] {
  const unique = new Map(previous.map((trade) => [tradeKey(trade), trade]));
  for (const trade of incoming)
    if (!unique.has(tradeKey(trade))) unique.set(tradeKey(trade), trade);
  const next = [...unique.values()]
    .sort((a, b) => b.time - a.time || b.tid - a.tid)
    .slice(0, TRADE_LIMIT);
  return next.length === previous.length &&
    next.every((trade, i) => trade === previous[i])
    ? previous
    : next;
}
