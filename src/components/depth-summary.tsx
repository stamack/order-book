"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { price, size, type Coin } from "@/lib/book";
import { summarizeDepth, type MergedLevel } from "@/lib/merge-book";

export type DepthSelection = {
  side: "bid" | "ask";
  index: number;
  mode: "pointer" | "focus" | "touch";
  left: number;
  top: number;
};

export function useDepthHover() {
  const [selection, setSelection] = useState<DepthSelection | null>(null);
  const clear = useCallback(() => setSelection(null), []);
  const select = useCallback(
    (target: EventTarget | null, mode: DepthSelection["mode"]) => {
      const row =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-depth-index]")
          : null;
      if (!row) {
        setSelection(null);
        return;
      }
      const index = Number(row.dataset.depthIndex);
      const side = row.dataset.side as DepthSelection["side"];
      const rect = row.getBoundingClientRect();
      const width = Math.min(268, window.innerWidth - 24);
      const height = 225;
      const left =
        rect.left >= width + 20
          ? rect.left - width - 12
          : rect.right + width + 20 <= window.innerWidth
            ? rect.right + 12
            : Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
      const beside = left + width <= rect.left || left >= rect.right;
      const top = Math.max(
        12,
        Math.min(
          window.innerHeight - height - 12,
          beside
            ? rect.top - height / 2 + rect.height / 2
            : rect.bottom + height + 12 <= window.innerHeight
              ? rect.bottom + 8
              : rect.top - height - 8,
        ),
      );
      setSelection((current) =>
        current?.side === side &&
        current.index === index &&
        current.mode === mode &&
        current.left === left &&
        current.top === top
          ? current
          : { side, index, mode, left, top },
      );
    },
    [],
  );
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-depth-index]")
      )
        clear();
    };
    const reposition = () => {
      if (!selection) return;
      const row = document.querySelector(
        `[data-side="${selection.side}"][data-depth-index="${selection.index}"]`,
      );
      if (row) select(row, selection.mode);
      else clear();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", outside);
    };
  }, [clear, select, selection]);
  return { selection, select, clear };
}

export function DepthSummary({
  selection,
  levels,
  coin,
  mid,
  stale,
}: {
  selection: DepthSelection;
  levels: MergedLevel[];
  coin: Coin;
  mid: number | undefined;
  stale: boolean;
}) {
  const summary = summarizeDepth(levels, selection.index);
  if (!summary) return null;
  const prefix = summary.estimated ? "≈ " : "";
  return createPortal(
    <div
      id="depth-summary"
      role="tooltip"
      className={`depth-summary ${selection.side}`}
      style={{ left: selection.left, top: selection.top }}
    >
      <div className="summary-heading">
        <strong>
          {selection.side === "ask" ? "Buy through asks" : "Sell into bids"}
        </strong>
        <span>{summary.levels} levels</span>
      </div>
      <div
        className={`summary-kind ${summary.estimated || stale ? "approximate" : ""}`}
      >
        {stale
          ? "Stale data"
          : summary.estimated
            ? "≈ Includes estimated depth"
            : "Confirmed depth"}
      </div>
      <dl>
        <div>
          <dt>Distance from mid</dt>
          <dd>
            {prefix}
            {mid === undefined
              ? "—"
              : `${((Math.abs(summary.price - mid) / mid) * 100).toFixed(4)}%`}
          </dd>
        </div>
        <div>
          <dt>Average price</dt>
          <dd data-summary="average">
            {prefix}
            {price(summary.average)} <small>USD</small>
          </dd>
        </div>
        <div>
          <dt>Total ({coin})</dt>
          <dd data-summary="size">
            {prefix}
            {size(summary.size)}
          </dd>
        </div>
        <div>
          <dt>Total (USD)</dt>
          <dd data-summary="notional">
            {prefix}
            {price(summary.notional)}
          </dd>
        </div>
      </dl>
      <div className="summary-note">
        {summary.estimated
          ? "Projection from the last full-depth snapshot."
          : "Cumulative from the best price to this level."}
      </div>
    </div>,
    document.body,
  );
}
