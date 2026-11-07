import assert from "node:assert/strict";
import { test } from "node:test";

import { checkForRiskSignals } from "../scripts/core";

function pageWith(bodyText: string, url = "https://www.xiaohongshu.com/explore/example") {
  return {
    url: () => url,
    evaluate: async () => ({ bodyText, postTexts: [] }),
  };
}

function pageWithPost(
  bodyText: string,
  postTexts: string[],
  url = "https://www.xiaohongshu.com/explore/example"
) {
  return {
    url: () => url,
    evaluate: async () => ({ bodyText, postTexts }),
  };
}

test("checkForRiskSignals ignores a dismissed login popup's verification-code copy", async () => {
  await assert.doesNotReject(
    checkForRiskSignals(pageWith("登录后推荐更懂你的笔记\n+86\n获取验证码\n登录") as never)
  );
});

test("checkForRiskSignals ignores verification terms inside the post body", async () => {
  await assert.doesNotReject(
    checkForRiskSignals(
      pageWithPost(
        "Cloudflare services\nTurnstile — 免费验证码/防机器人",
        ["Cloudflare services\nTurnstile — 免费验证码/防机器人"]
      ) as never
    )
  );
});

test("checkForRiskSignals still stops on an actual security verification prompt", async () => {
  await assert.rejects(
    checkForRiskSignals(pageWith("访问前请先完成安全验证") as never),
    /HARD SIGNAL/
  );
});
