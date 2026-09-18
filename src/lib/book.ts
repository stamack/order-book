export type Coin = "BTC" | "ETH";
export type Precision = 2 | 3 | 4 | 5 | null;
export type Level = { px: string; sz: string; n: number };
export type Book = { coin: Coin; time: number; levels: [Level[], Level[]] };

/** Reject malformed/crossed snapshots before replacing the last good book. */
export function parseBook(message: unknown, coin: Coin): Book | null {
  if (
    !message ||
    typeof message !== "object" ||
    !("channel" in message) ||
    message.channel !== "l2Book" ||
    !("data" in message)
  )
    return null;
  const book = message.data as Book | undefined;
  if (
    !book ||
    book.coin !== coin ||
    !Number.isSafeInteger(book.time) ||
    book.time < 0 ||
    book.time > 8_640_000_000_000_000 ||
    !Array.isArray(book.levels) ||
    book.levels.length !== 2
  )
    return null;
  for (let side = 0; side < 2; side++) {
    const levels = book.levels[side];
    if (!Array.isArray(levels) || levels.length > 20) return null;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      if (
        !level ||
        typeof level.px !== "string" ||
        typeof level.sz !== "string" ||
        !Number.isFinite(+level.px) ||
        +level.px <= 0 ||
        !Number.isFinite(+level.sz) ||
        +level.sz <= 0 ||
        !Number.isInteger(level.n) ||
        level.n < 1
      )
        return null;
      if (
        i &&
        (side === 0
          ? +levels[i - 1].px <= +level.px
          : +levels[i - 1].px >= +level.px)
      )
        return null;
    }
  }
  const [bid, ask] = book.levels.map((levels) => levels[0]);
  if (bid && ask && +bid.px >= +ask.px) return null;
  return book;
}

export function metrics(book: Book | null) {
  const bid = book?.levels[0][0];
  const ask = book?.levels[1][0];
  if (!bid || !ask) return null;
  const mid = (+bid.px + +ask.px) / 2;
  const spread = +ask.px - +bid.px;
  return {
    bid: +bid.px,
    ask: +ask.px,
    mid,
    spread,
    bps: (spread / mid) * 10_000,
  };
}

const priceFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const sizeFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 5,
});
export const price = (value: number | undefined) =>
  value === undefined ? "—" : priceFormat.format(value);
export const size = (value: number) => sizeFormat.format(value);
export const displaySize = size;
