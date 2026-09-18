import { describe, expect, it } from "vitest";
import { mergeTrades, parseTrades, type Trade } from "../src/lib/trades";
const trade: Trade = {
  coin: "BTC",
  side: "B",
  px: "80000",
  sz: "0.01",
  time: 100,
  tid: 1,
  hash: "0x" + "a".repeat(64),
};
describe("trade feed", () => {
  it("filters malformed and other-market executions", () => {
    expect(
      parseTrades(
        {
          channel: "trades",
          data: [
            trade,
            { ...trade, coin: "ETH" },
            { ...trade, sz: "NaN" },
            { ...trade, side: "X" },
          ],
        },
        "BTC",
      ),
    ).toEqual([trade]);
  });
  it("keeps separate same-time fills, deduplicates replay, and orders late packets", () => {
    const next = mergeTrades(
      [trade],
      [{ ...trade }, { ...trade, tid: 2 }, { ...trade, tid: 3, time: 99 }],
    );
    expect(next.map((t) => t.tid)).toEqual([2, 1, 3]);
    expect(mergeTrades(next, [trade])).toBe(next);
  });
  it("caps retained history", () => {
    const next = mergeTrades(
      [],
      Array.from({ length: 100 }, (_, tid) => ({ ...trade, tid, time: tid })),
    );
    expect(next).toHaveLength(27);
    expect(next[0].time).toBe(99);
  });
});
