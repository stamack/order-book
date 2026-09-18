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

test("both feeds, atomic switches, fixed geometry, and no stale subscription data", async ({
  page,
}) => {
  const connections = await mockFeeds(page, false);
  await page.goto("/");
  await expect.poll(() => connections.length).toBe(2);
  const bounds = await page.locator(".workspace").boundingBox();
  for (const c of connections) c.ws.send(snapshot(c.sub));
  await expect(page.locator(".feed-status.live")).toHaveCount(2);
  await expect(page.locator("[data-price]")).toHaveCount(50);
  expect(await page.locator(".workspace").boundingBox()).toEqual(bounds);
  expect(connections.map((c) => c.sub.fast).sort()).toEqual([false, true]);
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
  await expect(page.locator("[data-price]")).toHaveCount(8);
  expect(await page.locator(".workspace").boundingBox()).toEqual(bounds);
  await page.getByLabel("Price precision").selectOption("full");
  await expect.poll(() => connections.length).toBe(8);
  expect(connections.slice(6).every((c) => c.sub.nSigFigs === undefined)).toBe(
    true,
  );
});

test("new prices flash, retained prices keep their DOM nodes, older snapshots are ignored", async ({
  page,
}) => {
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(2);
  expect(
    await page
      .locator(".book-row")
      .evaluateAll((rows) =>
        rows.reduce((n, row) => n + row.getAnimations().length, 0),
      ),
  ).toBe(0);
  const retained = page.locator('.depth-panel [data-price="79999"]');
  await retained.evaluate((el) => el.setAttribute("data-retained", "yes"));
  const slow = connections.find((c) => !c.sub.fast)!;
  slow.ws.send(snapshot(slow.sub, 101, 1));
  await expect(page.locator('.depth-panel [data-price="80000"]')).toHaveCount(
    1,
  );
  expect(
    await page
      .locator('.depth-panel [data-price="80000"]')
      .evaluate((el) => el.getAnimations().length),
  ).toBeGreaterThan(0);
  await expect(retained).toHaveAttribute("data-retained", "yes");
  slow.ws.send(snapshot(slow.sub, 99, -20));
  await expect(page.locator('.depth-panel [data-price="80000"]')).toHaveCount(
    1,
  );
});

test("stale data is labeled and silent sockets reconnect", async ({ page }) => {
  await page.clock.install();
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(2);
  await page.clock.fastForward(11000);
  await expect(page.getByText("Stale feed", { exact: true })).toHaveCount(2);
  await page.clock.fastForward(10000);
  await expect(page.getByText("Reconnecting", { exact: true })).toHaveCount(2);
  await page.clock.fastForward(1500);
  await expect.poll(() => connections.length).toBe(4);
  await expect(page.locator(".feed-status.live")).toHaveCount(2);
});

for (const width of [320, 390, 768, 1024]) {
  test(`stable, unclipped layout at ${width}px`, async ({ page }) => {
    const connections = await mockFeeds(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".feed-status.live")).toHaveCount(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const before = await page.locator(".workspace").boundingBox();
    for (const c of connections) c.ws.send(snapshot(c.sub, 101, 1, 1));
    await expect(page.locator("[data-price]")).toHaveCount(4);
    expect(await page.locator(".workspace").boundingBox()).toEqual(before);
  });
}

test("reduced motion disables level flashes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const connections = await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".feed-status.live")).toHaveCount(2);
  for (const c of connections) c.ws.send(snapshot(c.sub, 101, 1));
  await expect(page.locator('.depth-panel [data-price="80000"]')).toHaveCount(
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
