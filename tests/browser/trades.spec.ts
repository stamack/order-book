import { test, expect, type WebSocketRoute } from "@playwright/test";
test("streams colored trades, full sizes, timestamps, and keeps panel dimensions stable", async ({
  page,
}) => {
  const connections: { ws: WebSocketRoute; coin: string }[] = [];
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === "subscribe" && msg.subscription.type === "trades")
        connections.push({ ws, coin: msg.subscription.coin });
    });
  });
  await page.goto("/");
  const before = await page.locator(".workspace").boundingBox();
  await page.getByRole("tab", { name: "Trades", exact: true }).click();
  await expect.poll(() => connections.length).toBe(1);
  const trade = {
    coin: "BTC",
    side: "B",
    px: "80000",
    sz: "1250",
    time: 1700000000000,
    tid: 1,
    hash: "0x" + "a".repeat(64),
  };
  connections[0].ws.send(
    JSON.stringify({
      channel: "trades",
      data: [trade, { ...trade, side: "A", tid: 2 }],
    }),
  );
  await expect(page.locator(".trade-row[data-trade-id]")).toHaveCount(2);
  await expect(page.locator(".trade-row.bid")).toContainText("1,250.0000");
  const buy = await page
    .locator(".trade-row.bid .level-price")
    .evaluate((el) => getComputedStyle(el).color);
  const sell = await page
    .locator(".trade-row.ask .level-price")
    .evaluate((el) => getComputedStyle(el).color);
  expect(buy).not.toBe(sell);
  await expect(page.locator(".trade-row.bid a")).toHaveAttribute(
    "href",
    `https://app.hyperliquid.xyz/explorer/tx/${trade.hash}`,
  );
  await expect(page.locator(".trade-row.bid a")).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(page.getByRole("status")).toHaveAttribute(
    "title",
    /Last updated at .*Z/,
  );
  await expect(page.locator(".feed-footer")).not.toContainText("Buy");
  expect((await page.locator(".workspace").boundingBox())!.height).toBe(
    before!.height,
  );
  connections[0].ws.send(JSON.stringify({ channel: "trades", data: [trade] }));
  await expect(page.locator(".trade-row[data-trade-id]")).toHaveCount(2);
  await page.locator("#market").selectOption("ETH");
  await expect(page.locator(".trade-row[data-trade-id]")).toHaveCount(0);
  await expect.poll(() => connections.length).toBe(2);
  expect(connections[1].coin).toBe("ETH");
});
