import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLabServer } from "../apps/server/src/server";
const directory = await mkdtemp(join(tmpdir(), "lab-app-browser-"));
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
  await page.goto(`${base}/#operator=${lab.operatorToken}`);
  await page
    .getByLabel("Application under test", { exact: true })
    .selectOption("life-center");
  await expect(page.locator(".tv-screen")).toContainText(
    "APPLICATION UNDER TEST",
  );
  await expect(
    page.getByLabel("Scenario", { exact: true }).locator("option"),
  ).toHaveCount(4);
  await expect(page.getByText("Purchase gate", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator(".tv-screen")).toContainText(
    "Prepare my next trip",
  );
  for (let i = 0; i < 3; i++)
    await page
      .getByRole("button", { name: "Advance 2 seconds", exact: true })
      .click();
  await expect(page.locator(".eval-panel")).toContainText("PASS");
  await expect(page.locator(".tv-screen")).toContainText(
    "No bookings were made",
  );
  console.log(
    "PASS application selection, shared remote, logical clock and evaluation",
  );
  for (const scenario of [
    "life-request",
    "life-voice",
    "life-cancel",
    "life-offline",
  ]) {
    await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
    await page
      .getByRole("button", { name: "Start test run", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start test run", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".eval-panel")).toContainText("PASS");
    console.log("PASS lab runner: " + scenario);
  }
  await page
    .getByLabel("Scenario", { exact: true })
    .selectOption("life-request");
  await page
    .getByLabel("Agent access", { exact: true })
    .selectOption("semantic");
  await page
    .getByRole("button", { name: "Start test run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start test run", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".eval-panel")).toContainText("PASS");
  console.log("PASS semantic runner uses application tools");
  await mkdir("qa-artifacts", { recursive: true });
  await page.screenshot({
    path: "qa-artifacts/lab-applications.png",
    fullPage: true,
  });
  await page
    .getByLabel("Application under test", { exact: true })
    .selectOption("media");
  await expect(
    page.getByLabel("Scenario", { exact: true }).locator("option"),
  ).toHaveCount(13);
  await expect(page.locator(".tv-screen")).not.toContainText(
    "APPLICATION UNDER TEST",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Application under test", { exact: true })
    .selectOption("life-center");
  await expect(page.locator(".tv-screen")).toContainText(
    "APPLICATION UNDER TEST",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  console.log("PASS switching back to media, mobile layout, no browser errors");
} finally {
  await browser.close();
  lab.server.closeAllConnections();
  await new Promise<void>((r) => lab.server.close(() => r()));
  await rm(directory, { recursive: true, force: true });
}
