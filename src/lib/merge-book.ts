import { type Book, type Coin, type Level } from "./book";

export type Source = "fast" | "slow";
export type MergedLevel = Level & {
  time: number;
  receivedAt: number;
  confirmed: boolean;
  total: number;
  notional: number;
  entered: boolean;
};
export type MergedBook = {
  coin: Coin;
  time: number;
  levels: [MergedLevel[], MergedLevel[]];
  estimated: boolean;
};
type Snapshot = { book: Book; receivedAt: number };
type ObservedLevel = Level & {
  time: number;
  receivedAt: number;
  confirmed: boolean;
};
export const ESTIMATE_TTL = 10_000;

function agrees(slow: Book, fast: Book) {
  return fast.levels.every((levels, side) => {
    const prefix = slow.levels[side].slice(0, 5);
    return (
      prefix.length === levels.length &&
      levels.every(
        (level, i) =>
          +level.px === +prefix[i].px &&
          +level.sz === +prefix[i].sz &&
          level.n === prefix[i].n,
      )
    );
  });
}

/** Exact latest snapshot inside; explicitly estimated distance-profile outside. */
export class BookMerger {
  private slow: Snapshot | null = null;
  private fast: Snapshot | null = null;
  private previous: MergedBook | null = null;
  constructor(private coin: Coin) {}

  ingest(source: Source, book: Book, receivedAt: number): boolean {
    if (book.coin !== this.coin || book.time <= (this[source]?.book.time ?? -1))
      return false;
    if (
      source === "fast" &&
      (book.levels.some((side) => side.length > 5) ||
        book.time < (this.slow?.book.time ?? -1))
    )
      return false;
    this[source] = { book, receivedAt };
    return true;
  }

  read(now: number): MergedBook | null {
    const { slow, fast } = this;
    if (!slow && !fast) return null;
    const equal = slow && fast && slow.book.time === fast.book.time;
    const useFull =
      slow &&
      (!fast ||
        slow.book.time > fast.book.time ||
        (equal && agrees(slow.book, fast.book)));
    const latest = useFull ? slow! : fast!;
    const time = latest.book.time;
    const observe = (snapshot: Snapshot, side: number): ObservedLevel[] =>
      snapshot.book.levels[side].map((level) => ({
        ...level,
        time: snapshot.book.time,
        receivedAt: snapshot.receivedAt,
        confirmed: true,
      }));
    const canEstimate =
      !useFull &&
      slow &&
      !equal &&
      time - slow.book.time <= ESTIMATE_TTL &&
      now - slow.receivedAt <= ESTIMATE_TTL;
    const levels = [0, 1]
      .map((side) => {
        const fresh = observe(latest, side);
        const profile = slow?.book.levels[side];
        // A short fast side is exhausted: do not invent liquidity past its end.
        if (!canEstimate || fresh.length < 5 || !profile || profile.length <= 5)
          return fresh;
        const direction = side === 0 ? -1 : 1;
        const top = +fresh[0].px;
        const oldTop = +profile[0].px;
        const fastDistance = direction * (+fresh[4].px - top);
        const oldDistance = direction * (+profile[4].px - oldTop);
        // Preserve the slow profile's distances from its best price. If the fast
        // core widens, move the entire estimated tail outward so it cannot overlap.
        const outward = Math.max(0, fastDistance - oldDistance);
        let previousPrice = +fresh[4].px;
        for (const level of profile.slice(5, 20)) {
          const distance = direction * (+level.px - oldTop);
          // Round away floating-point arithmetic noise (BTC/ETH quote ticks <= 2dp).
          const px = Number(
            (top + direction * (distance + outward)).toFixed(8),
          );
          if (
            !Number.isFinite(px) ||
            px <= 0 ||
            direction * (px - previousPrice) <= 0
          )
            continue;
          fresh.push({
            ...level,
            px: String(px),
            confirmed: false,
            time: slow!.book.time,
            receivedAt: slow!.receivedAt,
          });
          previousPrice = px;
        }
        return fresh;
      })
      .map((side, index) => {
        let total = 0;
        let notional = 0;
        // Confirmation alone must not flash an already displayed price.
        const oldPrices = new Set(
          this.previous?.levels[index].map((level) => +level.px),
        );
        return side.map((level) => ({
          ...level,
          total: (total += +level.sz),
          notional: (notional += +level.px * +level.sz),
          entered:
            level.confirmed &&
            this.previous !== null &&
            !oldPrices.has(+level.px),
        }));
      }) as [MergedLevel[], MergedLevel[]];
    return {
      coin: this.coin,
      time,
      levels,
      estimated: levels.some((side) => side.some((level) => !level.confirmed)),
    };
  }

  published(book: MergedBook) {
    this.previous = book;
  }
}

/** Inclusive sweep from the best quote through a selected depth rank. */
export function summarizeDepth(levels: MergedLevel[], index: number) {
  const level = levels[index];
  if (!level || index < 0) return null;
  return {
    levels: index + 1,
    price: +level.px,
    size: level.total,
    notional: level.notional,
    average: level.notional / level.total,
    estimated: levels.slice(0, index + 1).some((row) => !row.confirmed),
  };
}
