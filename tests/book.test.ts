import { describe, expect, it } from "vitest";
import { depthFrom, metrics, parseBook, type Book } from "../src/lib/book";

const book: Book = {
  coin: "BTC",
  time: 100,
  levels: [
    [
      { px: "100", sz: "2", n: 1 },
      { px: "99", sz: "3", n: 2 },
    ],
    [
      { px: "101", sz: "4", n: 1 },
      { px: "102", sz: "5", n: 1 },
    ],
  ],
};
const message = (data: unknown) => ({ channel: "l2Book", data });

describe("snapshot validation", () => {
  it("accepts ordered snapshots and empty sides", () => {
    expect(parseBook(message(book), "BTC")).toEqual(book);
    expect(
      parseBook(message({ ...book, levels: [[], []] }), "BTC"),
    ).not.toBeNull();
  });
  it("rejects wrong channels, symbols, invalid levels and crossed books", () => {
    expect(parseBook({ channel: "pong" }, "BTC")).toBeNull();
    expect(parseBook(message(book), "ETH")).toBeNull();
    for (const px of ["NaN", "Infinity", "0", "-1", 100]) {
      expect(
        parseBook(
          message({
            ...book,
            levels: [[{ px, sz: "2", n: 1 }], book.levels[1]],
          }),
          "BTC",
        ),
      ).toBeNull();
    }
    expect(
      parseBook(
        message({ ...book, levels: [book.levels[1], book.levels[0]] }),
        "BTC",
      ),
    ).toBeNull();
    expect(
      parseBook(
        message({
          ...book,
          levels: [[...book.levels[0]].reverse(), book.levels[1]],
        }),
        "BTC",
      ),
    ).toBeNull();
  });
});

describe("trader metrics", () => {
  it("sums cumulative base size from the inside out on both sides", () => {
    const depth = depthFrom(book, null);
    expect(depth[0].map((l) => l.total)).toEqual([2, 5]);
    expect(depth[1].map((l) => l.total)).toEqual([4, 9]);
    expect(depth.flat().some((l) => l.entered)).toBe(false);
  });
  it("flags only new prices, not moving rows, formatting changes or size changes", () => {
    const next: Book = {
      ...book,
      levels: [
        [
          { px: "100.5", sz: "1", n: 1 },
          { px: "100.0", sz: "8", n: 2 },
        ],
        book.levels[1],
      ],
    };
    expect(depthFrom(next, book)[0].map((l) => l.entered)).toEqual([
      true,
      false,
    ]);
    expect(depthFrom(book, next)[0].map((l) => l.entered)).toEqual([
      false,
      true,
    ]);
  });
  it("computes midpoint, spread and basis points; handles one-sided books", () => {
    expect(metrics(book)).toEqual({
      bid: 100,
      ask: 101,
      mid: 100.5,
      spread: 1,
      bps: (1 / 100.5) * 10000,
    });
    expect(metrics(null)).toBeNull();
    expect(metrics({ ...book, levels: [[], book.levels[1]] })).toBeNull();
  });
});
