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

test("fast core wins; delayed slow depth is marked historical and excluded from totals", async ({
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
  await expect(page.locator(".cached")).toHaveCount(14);
  await expect(page.locator(".mid-value")).toHaveText("80,001.00");
  expect(await page.locator(".cached .level-total").allTextContents()).toEqual(
    Array(14).fill("—"),
  );
  expect(
    (await page.locator(".cached .level-size").allTextContents()).every(
      (text) => text.includes("≈"),
    ),
  ).toBe(true);
  slow.ws.send(snapshot(slow.sub, 130, 2));
  await expect(page.locator(".mid-value")).toHaveText("80,002.00");
  await expect(page.locator(".cached")).toHaveCount(0);
  fast.ws.send(snapshot(fast.sub, 125, -20));
  await expect(page.locator(".mid-value")).toHaveText("80,002.00");
});

test("cached tails expire without new messages or layout changes", async ({
  page,
}) => {
  await page.clock.install();
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(1);
  const bounds = await page.locator(".workspace").boundingBox();
  const fast = connections.find((c) => c.sub.fast)!;
  fast.ws.send(snapshot(fast.sub, 110));
  await expect(page.locator(".cached")).toHaveCount(14);
  await page.clock.fastForward(2300);
  await expect(page.locator(".cached")).toHaveCount(0);
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
