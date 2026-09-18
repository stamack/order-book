import { type Book, type Coin, type Level } from "./book";

export type Source = "fast" | "slow";
export type MergedLevel = Level & {
  time: number;
  receivedAt: number;
  confirmed: boolean;
  total: number | null;
  entered: boolean;
};
export type MergedBook = {
  coin: Coin;
  time: number;
  levels: [MergedLevel[], MergedLevel[]];
  cached: boolean;
};
type Snapshot = { book: Book; receivedAt: number };
type ObservedLevel = Level & { time: number; receivedAt: number };

export const CACHE_TTL = 2000;
const MAX_FAST_HISTORY = 128;

function agrees(slow: Book, fast: Book) {
  return fast.levels.every((levels, side) => {
    const prefix = slow.levels[side].slice(0, 5);
    return (
      prefix.length === levels.length &&
      levels.every((level, i) => {
        const other = prefix[i];
        return (
          +level.px === +other.px &&
          +level.sz === +other.sz &&
          level.n === other.n
        );
      })
    );
  });
}

/**
 * Snapshot reconciliation, not a delta reconstruction. Only the newest snapshot's
 * covered range is confirmed. Historical outer levels always retain provenance.
 */
export class BookMerger {
  private slow: Snapshot | null = null;
  private fast: Snapshot[] = [];
  private lastTime = { fast: -1, slow: -1 };
  private historyFloor = -1;
  private previous: MergedBook | null = null;

  constructor(private coin: Coin) {}

  ingest(source: Source, book: Book, receivedAt: number): boolean {
    if (book.coin !== this.coin || book.time <= this.lastTime[source])
      return false;
    if (source === "fast" && book.levels.some((side) => side.length > 5))
      return false;
    this.lastTime[source] = book.time;
    const snapshot = { book, receivedAt };
    if (source === "slow") {
      this.slow = snapshot;
      // Keep the equal-time fast snapshot to validate agreement.
      this.fast = this.fast.filter((item) => item.book.time >= book.time);
    } else {
      if (this.slow && book.time < this.slow.book.time) return false;
      this.fast.push(snapshot);
      if (this.fast.length > MAX_FAST_HISTORY) {
        this.historyFloor = this.fast.shift()!.book.time;
      }
    }
    return true;
  }

  read(now: number): MergedBook | null {
    const newestFast = this.fast.at(-1);
    if (!this.slow && !newestFast) return null;
    // Never replay an incomplete history over an older baseline. A fresh full
    // snapshot restores depth; until then the authoritative fast core is enough.
    let baseline =
      this.slow && this.slow.book.time >= this.historyFloor ? this.slow : null;
    const equal =
      baseline &&
      this.fast.find((item) => item.book.time === baseline!.book.time);
    if (baseline && equal && !agrees(baseline.book, equal.book))
      baseline = null;
    let time = baseline?.book.time ?? newestFast!.book.time;
    const observe = (snapshot: Snapshot, side: number): ObservedLevel[] =>
      snapshot.book.levels[side].map((level) => ({
        ...level,
        time: snapshot.book.time,
        receivedAt: snapshot.receivedAt,
      }));
    let levels: [ObservedLevel[], ObservedLevel[]] = baseline
      ? [observe(baseline, 0), observe(baseline, 1)]
      : [[], []];
    // With no trusted baseline, start from the latest fast snapshot alone.
    const replay = baseline
      ? this.fast.filter((item) => item.book.time > baseline!.book.time)
      : newestFast
        ? [newestFast]
        : [];
    for (const snapshot of replay) {
      time = snapshot.book.time;
      levels = levels.map((old, side) => {
        const fresh = observe(snapshot, side);
        // Fewer than five levels means the fast snapshot exhausted this side.
        if (fresh.length < 5) return fresh;
        const boundary = +fresh.at(-1)!.px;
        // A snapshot replaces its entire covered range, including absent prices.
        // Replaying EVERY update prevents a later boundary retreat resurrecting
        // a level that an earlier fast snapshot already proved was absent.
        const outer = old.filter((level) =>
          side === 0 ? +level.px < boundary : +level.px > boundary,
        );
        return [...fresh, ...outer].slice(0, 20);
      }) as [ObservedLevel[], ObservedLevel[]];
    }
    const result = levels.map((side, index) => {
      let total = 0;
      const oldPrices = new Set(
        this.previous?.levels[index].map((level) => +level.px),
      );
      return side
        .filter(
          (level) =>
            level.time === time ||
            (time - level.time <= CACHE_TTL &&
              now - level.receivedAt <= CACHE_TTL),
        )
        .map((level) => {
          const confirmed = level.time === time;
          total += confirmed ? +level.sz : 0;
          return {
            ...level,
            confirmed,
            total: confirmed ? total : null,
            entered:
              confirmed && this.previous !== null && !oldPrices.has(+level.px),
          };
        });
    }) as [MergedLevel[], MergedLevel[]];
    return {
      coin: this.coin,
      time,
      levels: result,
      cached: result.some((side) => side.some((level) => !level.confirmed)),
    };
  }

  published(book: MergedBook) {
    this.previous = book;
  }
}
