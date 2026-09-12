import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLabServer } from "../apps/server/src/server";
const directory = await mkdtemp(join(tmpdir(), "life-browser-"));
const lab = createLabServer({ directory, staticDir: resolve("apps/lab/dist") });
await new Promise<void>((r) => lab.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(lab.server.address() as { port: number }).port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.EIDOS_TV_CHROME
    ? { executablePath: process.env.EIDOS_TV_CHROME }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`${base}/home#operator=${lab.operatorToken}`);
  await expect(
    page.getByRole("heading", { name: /A little space/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator(".life-result")).toContainText(
    "Prepare my next trip",
  );
  await expect(page.locator(".life-result")).toContainText(
    "No bookings were made",
    { timeout: 10000 },
  );
  console.log(
    "PASS remote navigates, delegates and presents a simulated result",
  );
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByLabel("Your instruction", { exact: true })
    .fill("Help me plan tomorrow");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Power", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Screen asleep" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Screen asleep" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Power", exact: true }).click();
  await expect(page.locator(".life-result")).toContainText(
    "No calendar entries",
    { timeout: 10000 },
  );
  console.log("PASS jobs persist through sleep and browser reload");
  const other = await browser.newPage();
  await other.goto(`${base}/home#operator=${lab.operatorToken}`);
  await expect(other.locator(".life-result")).toContainText(
    "Help me plan tomorrow",
  );
  await other.close();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByLabel("Your instruction", { exact: true })
    .fill("Cancel this example");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Close result", exact: true }).click();
  await page.getByRole("button", { name: "Cancel job", exact: true }).click();
  await expect(page.locator(".life-jobs")).toContainText("cancelled");
  console.log(
    "PASS second client shares state and pending jobs can be cancelled",
  );
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "Right", exact: true }).click();
  await expect(page.locator(".life-jobs article").last()).toHaveClass(
    "life-focused",
  );
  await expect
    .poll(() => page.locator(".life-jobs").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  console.log("PASS remote focus scrolls the job list");
  await mkdir("qa-artifacts", { recursive: true });
  await page.screenshot({
    path: "qa-artifacts/life-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Send request", exact: true }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: "qa-artifacts/life-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log("PASS mobile layout and no uncaught browser errors");
} finally {
  await browser.close();
  lab.server.closeAllConnections();
  await new Promise<void>((r) => lab.server.close(() => r()));
  await rm(directory, { recursive: true, force: true });
}
