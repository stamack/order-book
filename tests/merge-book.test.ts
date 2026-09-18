import { describe, expect, it } from "vitest";
import { type Book, type Level } from "../src/lib/book";
import {
  BookMerger,
  ESTIMATE_TTL,
  summarizeDepth,
} from "../src/lib/merge-book";
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
      Array.from({ length: count }, (_, i) => level(100 - i + shift, i + 1)),
      Array.from({ length: count }, (_, i) => level(110 + i + shift, i + 2)),
    ],
  };
}
function setup() {
  const merger = new BookMerger("BTC");
  merger.ingest("slow", snapshot(100), 0);
  return merger;
}

describe("distance-based depth projection", () => {
  it("translates the slow price-distance profile, carrying sizes by depth rank, with an exact fast core", () => {
    const merger = setup();
    const fast = snapshot(110, 5, 8);
    fast.levels[0][0].sz = "99";
    merger.ingest("fast", fast, 10);
    const book = merger.read(10)!;
    for (let side = 0; side < 2; side++) {
      expect(book.levels[side]).toHaveLength(20);
      expect(
        book.levels[side].slice(0, 5).map(({ px, sz, n }) => ({ px, sz, n })),
      ).toEqual(fast.levels[side]);
      expect(book.levels[side][5].px).toBe(String(side === 0 ? 103 : 123));
      expect(book.levels[side][5].sz).toBe(String(side === 0 ? 6 : 7));
      expect(book.levels[side].slice(5).every((row) => !row.confirmed)).toBe(
        true,
      );
    }
    expect(book.levels[0][5].total).toBe(119);
    expect(book.estimated).toBe(true);
  });
  it("moves the projected tail beyond a widened fast range without overlaps or duplicate prices", () => {
    const merger = setup();
    const fast = snapshot(110, 5);
    fast.levels[0] = [100, 98, 96, 94, 92].map((px) => level(px));
    fast.levels[1] = [110, 113, 116, 119, 122].map((px) => level(px));
    merger.ingest("fast", fast, 10);
    const book = merger.read(10)!;
    expect(+book.levels[0][5].px).toBe(91);
    expect(+book.levels[1][5].px).toBe(123);
  });
  it("keeps original distance offsets when the fast core compresses", () => {
    const merger = setup();
    const fast = snapshot(110, 5);
    fast.levels[0] = [100, 99.9, 99.8, 99.7, 99.6].map((px) => level(px));
    merger.ingest("fast", fast, 10);
    expect(+merger.read(10)!.levels[0][5].px).toBe(95);
  });
  it("uses a delayed slow snapshot as the shape without rolling the fast core backward", () => {
    const merger = new BookMerger("BTC");
    merger.ingest("fast", snapshot(120, 5, 10), 0);
    merger.ingest("slow", snapshot(100), 10);
    expect(merger.read(10)!.time).toBe(120);
    expect(merger.read(10)!.levels[0][0].px).toBe("110");
    expect(merger.read(10)!.levels[0][5].px).toBe("105");
  });
  it("does not invent liquidity on exhausted sides, without a profile, or beyond a short slow profile", () => {
    const merger = setup();
    const fast = snapshot(110, 2);
    fast.levels[1] = [];
    merger.ingest("fast", fast, 10);
    expect(merger.read(10)!.levels.map((side) => side.length)).toEqual([2, 0]);
    const noProfile = new BookMerger("BTC");
    noProfile.ingest("fast", snapshot(110, 5), 10);
    expect(noProfile.read(10)!.levels[0]).toHaveLength(5);
    const short = new BookMerger("BTC");
    short.ingest("slow", snapshot(100, 8), 0);
    short.ingest("fast", snapshot(110, 5), 10);
    expect(short.read(10)!.levels[0]).toHaveLength(8);
  });
  it("replaces estimates with newer full depth and ignores older/duplicate packets", () => {
    const merger = setup();
    merger.ingest("fast", snapshot(110, 5), 10);
    merger.ingest("slow", snapshot(120, 20, 2), 20);
    expect(merger.ingest("fast", snapshot(115, 5, -20), 30)).toBe(false);
    expect(merger.ingest("slow", snapshot(120, 20, -20), 30)).toBe(false);
    const book = merger.read(30)!;
    expect(book.time).toBe(120);
    expect(book.estimated).toBe(false);
    expect(book.levels[0][0].px).toBe("102");
  });
  it("keeps full depth at equal timestamps only if both snapshots agree", () => {
    for (const fastFirst of [true, false]) {
      const merger = new BookMerger("BTC");
      if (fastFirst) merger.ingest("fast", snapshot(100, 5), 0);
      merger.ingest("slow", snapshot(100), 0);
      if (!fastFirst) merger.ingest("fast", snapshot(100, 5), 0);
      expect(merger.read(0)!.levels[0]).toHaveLength(20);
      expect(merger.read(0)!.estimated).toBe(false);
    }
    const merger = setup();
    const conflict = snapshot(100, 5);
    conflict.levels[0][0].sz = "9";
    merger.ingest("fast", conflict, 0);
    expect(merger.read(0)!.levels[0]).toHaveLength(5);
  });
  it("survives ordinary snapshot gaps but expires projections from stale profiles", () => {
    const merger = setup();
    merger.ingest("fast", snapshot(110, 5), 10);
    expect(merger.read(2500)!.levels[0]).toHaveLength(20);
    expect(merger.read(ESTIMATE_TTL + 1)!.levels[0]).toHaveLength(5);
    const other = setup();
    other.ingest("fast", snapshot(100 + ESTIMATE_TTL + 1, 5), 10);
    expect(other.read(10)!.levels[0]).toHaveLength(5);
  });
  it("rejects wrong markets, oversized fast snapshots, and nonpositive projections", () => {
    const merger = setup();
    expect(merger.ingest("fast", snapshot(110), 10)).toBe(false);
    expect(merger.ingest("slow", { ...snapshot(110), coin: "ETH" }, 10)).toBe(
      false,
    );
    const fast = snapshot(110, 5, -94);
    merger.ingest("fast", fast, 10);
    expect(merger.read(10)!.levels[0].every((row) => +row.px > 0)).toBe(true);
  });
  it("never flashes projected movements as new real orders", () => {
    const merger = setup();
    merger.published(merger.read(0)!);
    merger.ingest("fast", snapshot(110, 5, 1), 10);
    const book = merger.read(10)!;
    expect(book.levels[0][0].entered).toBe(true);
    expect(book.levels[0][1].entered).toBe(false);
    expect(
      book.levels
        .flat()
        .filter((row) => !row.confirmed)
        .some((row) => row.entered),
    ).toBe(false);
  });
  it("does not reflash projected prices when a full snapshot confirms them", () => {
    const merger = setup();
    merger.ingest("fast", snapshot(110, 5, 2), 10);
    merger.published(merger.read(10)!);
    merger.ingest("slow", snapshot(120, 20, 2), 20);
    expect(
      merger
        .read(20)!
        .levels.flat()
        .some((row) => row.entered),
    ).toBe(false);
  });
  it("preserves sorted, uncrossed, unique prices through repeated reversals", () => {
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
      }
      expect(+book.levels[0][0].px).toBeLessThan(+book.levels[1][0].px);
    }
  });
});

describe("cumulative hover summary", () => {
  it("includes every size through the chosen rank and computes size-weighted average, not an arithmetic average", () => {
    const merger = setup();
    const book = merger.read(0)!;
    expect(summarizeDepth(book.levels[0], 2)).toEqual({
      levels: 3,
      price: 98,
      size: 6,
      notional: 592,
      average: 592 / 6,
      estimated: false,
    });
    expect(summarizeDepth(book.levels[1], 1)).toEqual({
      levels: 2,
      price: 111,
      size: 5,
      notional: 553,
      average: 553 / 5,
      estimated: false,
    });
    expect(summarizeDepth(book.levels[0], -1)).toBeNull();
    expect(summarizeDepth(book.levels[0], 20)).toBeNull();
  });
  it("flags cumulative estimates only when the selected range includes projected levels", () => {
    const merger = setup();
    merger.ingest("fast", snapshot(110, 5, 2), 10);
    const book = merger.read(10)!;
    expect(summarizeDepth(book.levels[0], 4)!.estimated).toBe(false);
    const summary = summarizeDepth(book.levels[0], 5)!;
    expect(summary.estimated).toBe(true);
    expect(summary.size).toBe(21);
    expect(summary.notional).toBe(
      book.levels[0]
        .slice(0, 6)
        .reduce((total, row) => total + +row.px * +row.sz, 0),
    );
  });
});
