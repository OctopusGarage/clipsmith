import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto("https://x.com/artinmemes/status/1966359849220161581", {
  waitUntil: "domcontentloaded",
  timeout: 15000,
});

// Wait for the tweet to appear (dynamic content)
try {
  await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
  console.log("Tweet appeared!");
} catch {
  console.log("Tweet did NOT appear within 15s");
}

const debug = await page.evaluate(() => {
  const tweet = document.querySelector('article[data-testid="tweet"]');
  const textEl = tweet?.querySelector('[data-testid="tweetText"]');
  return {
    tweetFound: !!tweet,
    textElFound: !!textEl,
    text: textEl?.textContent?.trim()?.substring(0, 80) ?? "none",
  };
});
console.log("DEBUG:", JSON.stringify(debug, null, 2));

await browser.close();
