import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLabServer } from "../apps/server/src/server";
const directory = await mkdtemp(join(tmpdir(), "eidos-tv-browser-"));
const lab = createLabServer({ directory, staticDir: resolve("apps/lab/dist") });
await new Promise<void>((r) => lab.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(lab.server.address() as { port: number }).port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.EIDOS_TV_CHROME
    ? { executablePath: process.env.EIDOS_TV_CHROME }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks: string[] = [];
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  await mkdir("qa-artifacts", { recursive: true });
  await page.goto(`${base}/#operator=${lab.operatorToken}`);
  await expect(
    page.getByRole("heading", { name: "Virtual remote", exact: true }),
  ).toBeVisible();
  for (const name of ["Select", "Right", "Right", "Select"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".eval-panel")).toContainText("PASS");
  await expect(page.locator(".tv-screen")).toContainText("Episode 3");
  pass("Rendered remote selects episode 3 and starts playback");
  await page.screenshot({
    path: "qa-artifacts/lab-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Reset session", exact: true })
    .click();
  await expect(page.locator(".tv-status")).toContainText("home");
  await page.getByRole("button", { name: "Hold to talk", exact: true }).click();
  await expect(page.locator(".eval-panel")).toContainText("PASS");
  pass("Pointer PTT fixture operates the same TV");
  await page
    .getByRole("button", { name: "Reset session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start test run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start test run", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".eval-panel")).toContainText("PASS");
  pass("Scripted remote agent completes the scenario");
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
  pass("Semantic agent completes through semantic tools");
  for (const scenario of [
    "low-confidence",
    "app-crash",
    "network",
    "profile",
    "signed-out",
    "parental-pin",
    "purchase",
  ]) {
    await page
      .getByLabel("Agent access", { exact: true })
      .selectOption("remote-only");
    await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
    await page
      .getByRole("button", { name: "Start test run", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start test run", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".eval-panel")).toContainText("PASS");
    pass(`Browser benchmark: ${scenario}`);
  }
  await page.getByLabel("Scenario", { exact: true }).selectOption("play-bluey");
  // Cancel while the runner's first reset is delayed, then verify no late grant or action survives.
  await page.route("**/api/sessions/*/reset", async (route) => {
    await new Promise((r) => setTimeout(r, 100));
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Start test run", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start test run", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/api/sessions/*/reset");
  await expect
    .poll(() => [...lab.broker.sessions.values()][0].actions.length)
    .toBe(0);
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await expect(page.locator(".tv-status")).toContainText("The Wild Robot");
  pass("Reset cancels an in-flight runner and releases control");
  const snap = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Take snapshot", exact: true })
    .click();
  const snapshot = await snap;
  await snapshot.saveAs("qa-artifacts/tv-frame.png");
  const png = await readFile("qa-artifacts/tv-frame.png");
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.length).toBeGreaterThan(5000);
  pass("Snapshot exports a nonempty PNG");
  await page.getByRole("button", { name: "Record video", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator(".tv-status")).toContainText("details");
  const vid = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await (await vid).saveAs("qa-artifacts/tv-recording.webm");
  expect(
    (await readFile("qa-artifacts/tv-recording.webm")).length,
  ).toBeGreaterThan(1000);
  pass("Video capture exports a real WebM");
  const traceDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export trace", exact: true }).click();
  await (await traceDownload).saveAs("qa-artifacts/run.json");
  await page
    .getByLabel("Import trace", { exact: true })
    .setInputFiles("qa-artifacts/run.json");
  await expect(page.locator(".tv-status")).toContainText("REPLAY");
  await page.getByLabel("Replay timeline", { exact: true }).fill("0");
  await expect(page.locator(".tv-status")).toContainText("home");
  pass("Export/import and replay timeline reconstruct the TV");
  await page
    .getByRole("button", { name: "Return to live TV", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Issue agent grant", exact: true })
    .click();
  const popupPromise = context.waitForEvent("page");
  await page
    .getByRole("button", { name: "Open agent view", exact: true })
    .click();
  const agentPage = await popupPromise;
  await expect(
    agentPage.getByRole("heading", { name: "Your task", exact: true }),
  ).toBeVisible();
  await expect(
    agentPage.getByRole("heading", {
      name: "Evaluator · operator only",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(agentPage.getByLabel("Scenario", { exact: true })).toHaveCount(
    0,
  );
  pass("Agent view omits evaluator and configuration");
  await agentPage.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".tv-status")).toContainText("home");
  await agentPage.getByRole("button", { name: "Right", exact: true }).click();
  await expect(page.locator(".tv-status")).toContainText("The Wild Robot");
  pass("Second browser controls the same session");
  await page
    .getByRole("button", { name: "Take control / revoke agent", exact: true })
    .click();
  await agentPage.getByRole("button", { name: "Right", exact: true }).click();
  await expect(agentPage.getByRole("alert")).toContainText("UNAUTHORIZED");
  pass("Revoked browser grant is rejected");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "qa-artifacts/lab-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  pass("Mobile layout has no horizontal overflow");
  expect(errors).toEqual([]);
  pass("No uncaught browser errors");
  await writeFile(
    "qa-artifacts/browser-results.json",
    JSON.stringify(
      { checks, errors, version: await browser.version() },
      null,
      2,
    ),
  );
  console.log(`Browser checks: ${checks.length} passed`);
} finally {
  await browser.close();
  lab.server.closeAllConnections();
  await new Promise<void>((r) => lab.server.close(() => r()));
  await rm(directory, { recursive: true, force: true });
}
