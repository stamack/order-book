import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

type Subscription = { coin: "BTC" | "ETH"; fast: boolean; nSigFigs?: number };
function snapshot(
  sub: Subscription,
  time = 100,
  shift = 0,
  count = sub.fast ? 5 : 20,
) {
  const mid = sub.coin === "BTC" ? 80000 : 3000;
  return JSON.stringify({
    channel: "l2Book",
    data: {
      coin: sub.coin,
      time,
      levels: [
        Array.from({ length: count }, (_, i) => ({
          px: String(mid - 1 - i + shift),
          sz: String(2 + i),
          n: 3,
        })),
        Array.from({ length: count }, (_, i) => ({
          px: String(mid + 1 + i + shift),
          sz: String(3 + i),
          n: 2,
        })),
      ],
    },
  });
}
async function mockFeeds(page: Page, autoSend = true) {
  const connections: { ws: WebSocketRoute; sub: Subscription }[] = [];
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === "subscribe") {
        connections.push({ ws, sub: message.subscription });
        if (autoSend) ws.send(snapshot(message.subscription));
      }
    });
  });
  return connections;
}

test("one vertical book: asks above the spread, bids below; switches clear both feeds atomically", async ({
  page,
}) => {
  const connections = await mockFeeds(page, false);
  await page.goto("/");
  await expect.poll(() => connections.length).toBe(2);
  const bounds = await page.locator(".workspace").boundingBox();
  for (const c of connections) c.ws.send(snapshot(c.sub));
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.locator("[data-price]")).toHaveCount(24);
  expect(await page.locator(".workspace").boundingBox()).toEqual(bounds);
  expect(connections.map((c) => c.sub.fast).sort()).toEqual([false, true]);
  const asks = await page.locator(".side-rows.ask").boundingBox();
  const spread = await page.locator(".spread").boundingBox();
  const bids = await page.locator(".side-rows.bid").boundingBox();
  expect(asks!.y + asks!.height).toBeLessThanOrEqual(spread!.y);
  expect(bids!.y).toBeGreaterThanOrEqual(spread!.y + spread!.height);
  for (const side of ["ask", "bid"]) {
    const prices = await page
      .locator(`.side-rows.${side} [data-price]`)
      .evaluateAll((rows) =>
        rows.map((row) => +row.getAttribute("data-price")!),
      );
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  }
  await page.getByLabel("Market", { exact: true }).selectOption("ETH");
  await expect.poll(() => connections.length).toBe(4);
  await expect(page.locator("[data-price]")).toHaveCount(0);
  expect(await page.locator(".workspace").boundingBox()).toEqual(bounds);
  for (const c of connections.slice(2)) c.ws.send(snapshot(c.sub));
  await expect(page.locator(".mid-price")).toContainText("3,000.00");
  await page.getByLabel("Price precision").selectOption("2");
  await expect.poll(() => connections.length).toBe(6);
  expect(
    connections
      .slice(4)
      .every((c) => c.sub.nSigFigs === 2 && c.sub.coin === "ETH"),
  ).toBe(true);
  for (const c of connections.slice(4)) c.ws.send(snapshot(c.sub, 200, 0, 2));
  await expect(page.locator("[data-price]")).toHaveCount(4);
  expect(await page.locator(".workspace").boundingBox()).toEqual(bounds);
  await page.getByLabel("Price precision").selectOption("full");
  await expect.poll(() => connections.length).toBe(8);
  expect(connections.slice(6).every((c) => c.sub.nSigFigs === undefined)).toBe(
    true,
  );
});

test("fast core wins; delayed slow depth supplies labeled estimates and cumulative totals", async ({
  page,
}) => {
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  const fast = connections.find((c) => c.sub.fast)!;
  const slow = connections.find((c) => !c.sub.fast)!;
  fast.ws.send(snapshot(fast.sub, 120, 1));
  await expect(page.locator(".mid-value")).toHaveText("80,001.00");
  slow.ws.send(snapshot(slow.sub, 110, 0));
  await expect(page.locator(".estimated")).toHaveCount(14);
  await expect(page.locator(".mid-value")).toHaveText("80,001.00");
  expect(
    await page.locator(".estimated .level-total").allTextContents(),
  ).toEqual([
    "≈102.0000",
    "≈88.0000",
    "≈75.0000",
    "≈63.0000",
    "≈52.0000",
    "≈42.0000",
    "≈33.0000",
    "≈27.0000",
    "≈35.0000",
    "≈44.0000",
    "≈54.0000",
    "≈65.0000",
    "≈77.0000",
    "≈90.0000",
  ]);
  expect(
    (await page.locator(".estimated .level-size").allTextContents()).every(
      (text) => text.includes("≈"),
    ),
  ).toBe(true);
  slow.ws.send(snapshot(slow.sub, 130, 2));
  await expect(page.locator(".mid-value")).toHaveText("80,002.00");
  await expect(page.locator(".estimated")).toHaveCount(0);
  fast.ws.send(snapshot(fast.sub, 125, -20));
  await expect(page.locator(".mid-value")).toHaveText("80,002.00");
});

test("estimated tails survive normal gaps then expire without new messages or layout changes", async ({
  page,
}) => {
  await page.clock.install();
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  const bounds = await page.locator(".workspace").boundingBox();
  const fast = connections.find((c) => c.sub.fast)!;
  fast.ws.send(snapshot(fast.sub, 110));
  await expect(page.locator(".estimated")).toHaveCount(14);
  await page.clock.fastForward(2300);
  await expect(page.locator(".estimated")).toHaveCount(14);
  await page.clock.fastForward(8000);
  await expect(page.locator(".estimated")).toHaveCount(0);
  await expect(page.locator("[data-price]")).toHaveCount(10);
  expect(await page.locator(".workspace").boundingBox()).toEqual(bounds);
});

test("new prices flash; retained prices keep their DOM nodes; stale packets cannot roll back", async ({
  page,
}) => {
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  expect(
    await page
      .locator(".book-row")
      .evaluateAll((rows) =>
        rows.reduce((n, row) => n + row.getAnimations().length, 0),
      ),
  ).toBe(0);
  const retained = page.locator('.side-rows.bid [data-price="79999"]');
  await retained.evaluate((el) => el.setAttribute("data-retained", "yes"));
  const fast = connections.find((c) => c.sub.fast)!;
  fast.ws.send(snapshot(fast.sub, 110, 1));
  const entered = page.locator('.side-rows.bid [data-price="80000"]');
  await expect(entered).toHaveCount(1);
  expect(
    await entered.evaluate((el) => el.getAnimations().length),
  ).toBeGreaterThan(0);
  await expect(retained).toHaveAttribute("data-retained", "yes");
  fast.ws.send(snapshot(fast.sub, 105, -20));
  await expect(entered).toHaveCount(1);
});

test("silent feeds become stale and reconnect; one socket can continue independently", async ({
  page,
}) => {
  await page.clock.install();
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  await page.clock.fastForward(11000);
  await expect(page.getByText("Stale data", { exact: true })).toHaveCount(1);
  await page.clock.fastForward(10000);
  await page.clock.fastForward(1500);
  await expect.poll(() => connections.length).toBe(4);
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  const fast = connections.slice(2).find((c) => c.sub.fast)!;
  fast.ws.close();
  await expect(page.getByText("Partial feed", { exact: true })).toBeVisible();
  const slow = connections.slice(2).find((c) => !c.sub.fast)!;
  slow.ws.send(snapshot(slow.sub, 200, 3));
  await expect(page.locator(".mid-value")).toHaveText("80,003.00");
});

for (const width of [320, 390, 768, 1440]) {
  test(`no overflow or geometry changes at ${width}px`, async ({ page }) => {
    const connections = await mockFeeds(page);
    await page.setViewportSize({ width, height: 1200 });
    await page.goto("/");
    await expect(page.locator(".feed-status.live")).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const before = await page.locator(".workspace").boundingBox();
    for (const c of connections) c.ws.send(snapshot(c.sub, 101, 1, 1));
    await expect(page.locator("[data-price]")).toHaveCount(2);
    expect(await page.locator(".workspace").boundingBox()).toEqual(before);
  });
}

test("reduced motion disables level flashes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  for (const c of connections) c.ws.send(snapshot(c.sub, 101, 1));
  await expect(page.locator('.side-rows.bid [data-price="80000"]')).toHaveCount(
    1,
  );
  expect(
    await page
      .locator(".book-row")
      .evaluateAll((rows) =>
        rows.reduce((n, row) => n + row.getAnimations().length, 0),
      ),
  ).toBe(0);
});

test("hover summarizes the inclusive sweep on both sides without resizing the book", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  const bounds = await page.locator(".workspace").boundingBox();
  for (const [side, total, notional, average] of [
    ["bid", "9.0000", "719,980.00", "79,997.78"],
    ["ask", "12.0000", "960,026.00", "80,002.17"],
  ]) {
    await page.locator(`[data-side="${side}"][data-depth-index="2"]`).hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('[data-summary="size"]')).toHaveText(total);
    await expect(tooltip.locator('[data-summary="notional"]')).toHaveText(
      notional,
    );
    await expect(tooltip.locator('[data-summary="average"]')).toContainText(
      average,
    );
    await expect(page.locator(`.side-rows.${side} .in-sweep`)).toHaveCount(3);
    expect(await page.locator(".workspace").boundingBox()).toEqual(bounds);
  }
  await page.locator("h1").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("hover remains at the chosen depth rank and updates estimates with new fast prices", async ({
  page,
}) => {
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  const fast = connections.find((c) => c.sub.fast)!;
  fast.ws.send(snapshot(fast.sub, 110, 2));
  const row = page.locator('[data-side="bid"][data-depth-index="7"]');
  await row.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Includes estimated depth");
  await expect(tooltip.locator('[data-summary="size"]')).toHaveText(
    "≈ 44.0000",
  );
  const before = await tooltip.locator('[data-summary="notional"]').innerText();
  fast.ws.send(snapshot(fast.sub, 120, 7));
  await expect(tooltip.locator('[data-summary="notional"]')).not.toHaveText(
    before,
  );
  await expect(page.locator(".selected-level")).toHaveAttribute(
    "data-depth-index",
    "7",
  );
  await page.getByLabel("Market", { exact: true }).selectOption("ETH");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("keyboard focus and Escape support depth summaries", async ({ page }) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  const row = page.locator('[data-side="ask"][data-depth-index="2"]');
  await row.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(row).toHaveAttribute("aria-describedby", "depth-summary");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 650 });
  await page.locator('[data-side="bid"][data-depth-index="11"]').focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  const rect = await page.getByRole("tooltip").boundingBox();
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(650);
});

test.use({ hasTouch: true });

test("summary fits a narrow viewport and does not shift the table", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  const before = await page
    .locator(".workspace")
    .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  await page.locator('[data-side="ask"][data-depth-index="6"]').tap();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const rect = await tooltip.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(800);
  expect(
    await page
      .locator(".workspace")
      .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight })),
  ).toEqual(before);
});
