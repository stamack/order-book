import { describe, expect, it } from "vitest";
import { type Book, type Level } from "../src/lib/book";
import { BookMerger, CACHE_TTL } from "../src/lib/merge-book";

const level = (px: number, sz = 1): Level => ({
  px: String(px),
  sz: String(sz),
  n: 1,
});
function snapshot(time: number, count = 20, shift = 0): Book {
  return {
    coin: "BTC",
    time,
    levels: [
      Array.from({ length: count }, (_, i) => level(100 - i + shift)),
      Array.from({ length: count }, (_, i) => level(110 + i + shift)),
    ],
  };
}
function setup() {
  const merger = new BookMerger("BTC");
  merger.ingest("slow", snapshot(100), 0);
  return merger;
}

describe("fast + slow reconciliation", () => {
  it("uses slow depth with a newer authoritative fast core, never mixed cumulative totals", () => {
    const merger = setup();
    merger.ingest("fast", snapshot(110, 5), 10);
    const book = merger.read(10)!;
    expect(book.levels[0]).toHaveLength(20);
    expect(book.levels[0].slice(0, 5).map((row) => row.total)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(
      book.levels[0]
        .slice(5)
        .every(
          (row) => !row.confirmed && row.total === null && row.time === 100,
        ),
    ).toBe(true);
  });
  it("replays the entire fast history over a late slow snapshot without resurrecting removed levels", () => {
    const merger = new BookMerger("BTC");
    const first = snapshot(110, 5);
    first.levels[0] = [100, 99, 97, 96, 95].map((px) => level(px)); // proves 98 absent
    const second = snapshot(120, 5);
    second.levels[0] = [105, 104, 103, 102, 101].map((px) => level(px));
    merger.ingest("fast", first, 10);
    merger.ingest("fast", second, 20);
    merger.ingest("slow", snapshot(100), 30); // arrives last, belongs first
    const book = merger.read(30)!;
    expect(book.time).toBe(120);
    expect(book.levels[0].slice(0, 5).map((row) => +row.px)).toEqual([
      105, 104, 103, 102, 101,
    ]);
    expect(book.levels[0].some((row) => +row.px === 98)).toBe(false);
  });
  it("removes all cached depth on an exhausted or empty fast side", () => {
    const merger = setup();
    const fast = snapshot(110, 2);
    fast.levels[1] = [];
    merger.ingest("fast", fast, 10);
    expect(merger.read(10)!.levels.map((side) => side.length)).toEqual([2, 0]);
  });
  it("lets newer full snapshots replace fast data, ignoring older and duplicate messages", () => {
    const merger = setup();
    merger.ingest("fast", snapshot(110, 5), 10);
    merger.ingest("slow", snapshot(120, 20, 2), 20);
    expect(merger.ingest("fast", snapshot(115, 5, -20), 30)).toBe(false);
    expect(merger.ingest("slow", snapshot(120, 20, -20), 30)).toBe(false);
    const book = merger.read(30)!;
    expect(book.time).toBe(120);
    expect(book.levels.flat().every((row) => row.confirmed)).toBe(true);
    expect(+book.levels[0][0].px).toBe(102);
  });
  it("keeps full depth at equal timestamps only when both snapshots agree", () => {
    for (const fastFirst of [true, false]) {
      const merger = new BookMerger("BTC");
      if (fastFirst) merger.ingest("fast", snapshot(100, 5), 0);
      merger.ingest("slow", snapshot(100), 0);
      if (!fastFirst) merger.ingest("fast", snapshot(100, 5), 0);
      expect(merger.read(0)!.levels[0]).toHaveLength(20);
    }
    const merger = setup();
    const conflict = snapshot(100, 5);
    conflict.levels[0][0].sz = "9";
    merger.ingest("fast", conflict, 0);
    expect(merger.read(0)!.levels[0]).toHaveLength(5);
    expect(merger.read(0)!.levels[0][0].sz).toBe("9");
  });
  it("expires cached rows by both receipt age and exchange-time distance", () => {
    const merger = setup();
    merger.ingest("fast", snapshot(110, 5), 10);
    expect(merger.read(CACHE_TTL + 1)!.levels[0]).toHaveLength(5);
    const other = setup();
    other.ingest("fast", snapshot(100 + CACHE_TTL + 1, 5), 10);
    expect(other.read(10)!.levels[0]).toHaveLength(5);
  });
  it("fails closed when the fast replay history is incomplete, then recovers on a new full snapshot", () => {
    const merger = new BookMerger("BTC");
    for (let time = 101; time <= 240; time++)
      merger.ingest("fast", snapshot(time, 5), time);
    merger.ingest("slow", snapshot(100), 241);
    expect(merger.read(241)!.levels[0]).toHaveLength(5);
    merger.ingest("slow", snapshot(241), 242);
    expect(merger.read(242)!.levels[0]).toHaveLength(20);
  });
  it("rejects cross-market and oversized fast snapshots", () => {
    const merger = setup();
    expect(merger.ingest("fast", snapshot(110), 10)).toBe(false);
    expect(merger.ingest("slow", { ...snapshot(110), coin: "ETH" }, 10)).toBe(
      false,
    );
    expect(merger.read(10)!.time).toBe(100);
  });
  it("flags new confirmed prices, not cached tails or initial snapshots", () => {
    const merger = setup();
    const initial = merger.read(0)!;
    expect(initial.levels.flat().some((row) => row.entered)).toBe(false);
    merger.published(initial);
    merger.ingest("fast", snapshot(110, 5, 1), 10);
    const next = merger.read(10)!;
    expect(next.levels[0][0].entered).toBe(true);
    expect(next.levels[0][1].entered).toBe(false);
    expect(
      next.levels
        .flat()
        .filter((row) => !row.confirmed)
        .some((row) => row.entered),
    ).toBe(false);
  });
  it("keeps prices sorted, unique, uncrossed, and faithful to the newest core through rapid reversals", () => {
    const merger = setup();
    for (let i = 1; i <= 150; i++) {
      const fast = snapshot(100 + i, 5, Math.round(Math.sin(i * 2) * 20));
      merger.ingest("fast", fast, i);
      if (i % 7 === 0) merger.ingest("slow", snapshot(99 + i), i + 1);
      const book = merger.read(i + 1)!;
      for (let side = 0; side < 2; side++) {
        const prices = book.levels[side].map((row) => +row.px);
        expect(new Set(prices).size).toBe(prices.length);
        expect(prices).toEqual(
          [...prices].sort((a, b) => (side === 0 ? b - a : a - b)),
        );
        expect(prices.slice(0, 5)).toEqual(
          fast.levels[side].map((row) => +row.px),
        );
        expect(
          book.levels[side].slice(5).every((row) => row.total === null),
        ).toBe(true);
      }
      expect(+book.levels[0][0].px).toBeLessThan(+book.levels[1][0].px);
    }
  });
});
