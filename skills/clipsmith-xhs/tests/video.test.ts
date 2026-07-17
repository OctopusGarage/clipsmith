import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  downloadVideos,
  extractPostSnapshot,
  formatVideoCandidateDiagnostic,
  formatVideoProbeDiagnostic,
  parseVideoProbe,
  selectPreferredPostVideoCandidate,
  selectPreferredPostVideoUrls,
  simulateVideoPlay,
} from "../scripts/core";
import { shouldPrimeVideoBeforeSnapshot } from "../scripts/executor";

test("extractPostSnapshot includes loaded XHS video resources when the DOM video src is a blob", async () => {
  const videoUrl =
    "https://sns-video-v4-m.xhscdn.com/stream/1/110/386/example_386.mp4?sign=abc&t=123";
  let evaluateCalls = 0;
  const page = {
    evaluate: async (fn: () => unknown) => {
      evaluateCalls += 1;
      if (evaluateCalls === 1) {
        return {
          title: "粤语版全场回放",
          text: "#世界杯",
          publishedAt: "",
          imageUrls: [
            "https://sns-webpic-qc.xhscdn.com/spectrum/example!nd_dft_wlteh_webp_3",
          ],
          videoUrls: ["blob:https://www.xiaohongshu.com/opaque-video"],
        };
      }
      const previousPerformance = globalThis.performance;
      Object.defineProperty(globalThis, "performance", {
        configurable: true,
        value: {
          getEntriesByType: () => [
            { name: videoUrl },
            { name: "https://sns-avatar-qc.xhscdn.com/avatar/example.jpg" },
            { name: "https://fe-video-qc.xhscdn.com/fe-platform/favicon.ico" },
          ],
        },
      });
      try {
        return fn();
      } finally {
        Object.defineProperty(globalThis, "performance", {
          configurable: true,
          value: previousPerformance,
        });
      }
    },
  };

  const snapshot = await extractPostSnapshot(page as never, "6a580adc00000000060311c5");

  assert.deepEqual(snapshot.videoUrls, [videoUrl]);
});

test("extractPostSnapshot selects the highest state candidate metadata", async () => {
  let evaluateCalls = 0;
  const low = "https://sns-video-v4-m.xhscdn.com/stream/a.mp4?sign=low";
  const high = "https://sns-video-v4-m.xhscdn.com/stream/b.mp4?sign=high";
  const page = {
    evaluate: async () => {
      evaluateCalls += 1;
      if (evaluateCalls === 1) {
        return {
          title: "全场回放",
          text: "#世界杯",
          publishedAt: "",
          imageUrls: [
            "https://sns-webpic-qc.xhscdn.com/spectrum/example!nd_dft_wlteh_webp_3",
          ],
          videoUrls: [low, high],
          videoCandidates: [
            { url: low, source: "state", width: 1920, height: 1080, bitrate: 8_000_000 },
            { url: high, source: "state", width: 3840, height: 2160, bitrate: 6_000_000 },
          ],
        };
      }
      return [];
    },
  };

  const snapshot = await extractPostSnapshot(page as never, "example");

  assert.deepEqual(snapshot.videoUrls, [high]);
  assert.equal(snapshot.selectedVideoCandidate?.width, 3840);
  assert.equal(snapshot.selectedVideoCandidate?.selectionBasis, "metadata");
});

test("simulateVideoPlay does not click an already-playing video", async () => {
  let clickCount = 0;
  let bringToFrontCount = 0;
  const videoElement = {
    paused: false,
    readyState: 4,
    focus: () => undefined,
    click: () => {
      clickCount += 1;
    },
    play: async () => undefined,
  };
  const page = {
    bringToFront: async () => {
      bringToFrontCount += 1;
    },
    waitForTimeout: async () => undefined,
    evaluate: async (fn: () => unknown) => {
      const previousDocument = (globalThis as { document?: unknown }).document;
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          querySelector: (selector: string) => (selector === "video" ? videoElement : null),
        },
      });
      try {
        return await fn();
      } finally {
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: previousDocument,
        });
      }
    },
  };

  await simulateVideoPlay(page as never);

  assert.equal(clickCount, 0);
  assert.equal(bringToFrontCount, 0);
});

test("shouldPrimeVideoBeforeSnapshot primes video detail pages and pages with video elements", () => {
  assert.equal(
    shouldPrimeVideoBeforeSnapshot(
      "https://www.xiaohongshu.com/explore/6a580adc00000000060311c5?type=video",
      false
    ),
    true
  );
  assert.equal(
    shouldPrimeVideoBeforeSnapshot("https://www.xiaohongshu.com/explore/6a580adc00000000060311c5", true),
    true
  );
  assert.equal(
    shouldPrimeVideoBeforeSnapshot("https://www.xiaohongshu.com/explore/6a580adc00000000060311c5", false),
    false
  );
});

test("downloadVideos streams video with browser cookies and referer", async (t) => {
  const tmp = await mkdir(join(process.cwd(), ".tmp-video-test"), {
    recursive: true,
  }).then(() => join(process.cwd(), ".tmp-video-test"));
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  t.after(() => rm(tmp, { recursive: true, force: true }));

  const originalFetch = globalThis.fetch;
  let requestHeaders = new Headers();
  globalThis.fetch = (async (_url, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(new Uint8Array([0, 1, 2, 3]), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const videoUrl =
    "https://sns-video-v4-m.xhscdn.com/stream/1/110/386/example_386.mp4?sign=abc&t=123";
  const page = {
    url: () => "https://www.xiaohongshu.com/explore/example",
    context: () => ({
      cookies: async () => [
        { name: "web_session", value: "abc" },
        { name: "a1", value: "def" },
      ],
    }),
  };

  const result = await downloadVideos(page as never, [videoUrl], tmp, false, async () => ({
    duration: 1,
    size: 4,
    bitrate: 32,
    width: 1920,
    height: 1080,
    frameRate: 50,
    videoCodec: "h265",
    audioCodec: "aac",
    hasAudio: true,
  }));

  assert.equal(result.failed.length, 0);
  assert.equal(result.saved.length, 1);
  assert.deepEqual([...await readFile(result.saved[0].path)], [0, 1, 2, 3]);
  assert.equal(requestHeaders.get("referer"), "https://www.xiaohongshu.com/explore/example");
  assert.equal(requestHeaders.get("cookie"), "web_session=abc; a1=def");
});

test("selectPreferredPostVideoUrls prefers the player-loaded direct video over alternate streams", () => {
  const low =
    "https://sns-video-v4-m.xhscdn.com/stream/1/110/386/low_386.mp4?sign=low";
  const high =
    "https://sns-video-v4-m.xhscdn.com/stream/1/110/386/high_4k.mp4?sign=high";

  assert.deepEqual(selectPreferredPostVideoUrls([low, high], [high]), [high]);
});

test("candidate selection chooses resolution then bitrate", () => {
  const selected = selectPreferredPostVideoCandidate([
    {
      url: "https://sns-video.xhscdn.com/1080.mp4",
      source: "state",
      width: 1920,
      height: 1080,
      bitrate: 12_000_000,
    },
    {
      url: "https://sns-video.xhscdn.com/4k.mp4",
      source: "state",
      width: 3840,
      height: 2160,
      bitrate: 6_000_000,
    },
    {
      url: "https://sns-video.xhscdn.com/4k-high.mp4",
      source: "state",
      width: 3840,
      height: 2160,
      bitrate: 9_000_000,
    },
  ]);

  assert.equal(selected?.url, "https://sns-video.xhscdn.com/4k-high.mp4");
  assert.equal(selected?.selectionBasis, "metadata");
});

test("candidate selection qualifies metadata-free player fallback", () => {
  const selected = selectPreferredPostVideoCandidate([
    { url: "https://sns-video.xhscdn.com/a.mp4", source: "state" },
    { url: "https://sns-video.xhscdn.com/player.mp4", source: "player" },
  ]);

  assert.equal(selected?.url, "https://sns-video.xhscdn.com/player.mp4");
  assert.equal(selected?.selectionBasis, "player-fallback");
});

test("candidate selection chooses the highest declared HLS rendition", () => {
  const selected = selectPreferredPostVideoCandidate([
    {
      url: "https://sns-video.xhscdn.com/720.m3u8",
      source: "state",
      width: 1280,
      height: 720,
      bitrate: 3_000_000,
    },
    {
      url: "https://sns-video.xhscdn.com/2160.m3u8",
      source: "state",
      width: 3840,
      height: 2160,
      bitrate: 8_000_000,
    },
  ]);

  assert.equal(selected?.url, "https://sns-video.xhscdn.com/2160.m3u8");
  assert.equal(selected?.selectionBasis, "metadata");
});

test("video candidate diagnostics omit signed query parameters", () => {
  const diagnostic = formatVideoCandidateDiagnostic({
    url: "https://sns-video.xhscdn.com/stream/4k.mp4?sign=secret&t=123",
    source: "state",
    codec: "h265",
    width: 3840,
    height: 2160,
    bitrate: 9_000_000,
  });

  assert.match(diagnostic, /sns-video\.xhscdn\.com\/stream\/4k\.mp4/);
  assert.match(diagnostic, /3840x2160/);
  assert.match(diagnostic, /bitrate=9000000/);
  assert.doesNotMatch(diagnostic, /secret|sign=|\?t=/);
});

test("parseVideoProbe accepts a complete video and audio result", () => {
  const probe = parseVideoProbe(
    JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "hevc",
          width: 3840,
          height: 2160,
          avg_frame_rate: "50/1",
          bit_rate: "6487781",
        },
        { codec_type: "audio", codec_name: "aac", bit_rate: "127992" },
      ],
      format: { duration: "11207.568", size: "9281146845", bit_rate: "6624914" },
    })
  );

  assert.equal(probe.width, 3840);
  assert.equal(probe.height, 2160);
  assert.equal(probe.frameRate, 50);
  assert.equal(probe.hasAudio, true);
  assert.equal(probe.videoCodec, "hevc");
  assert.equal(probe.duration, 11207.568);
});

test("parseVideoProbe rejects missing video and zero duration", () => {
  assert.throws(
    () => parseVideoProbe('{"streams":[],"format":{"duration":"10"}}'),
    /video stream/
  );
  assert.throws(
    () =>
      parseVideoProbe(
        '{"streams":[{"codec_type":"video"}],"format":{"duration":"0"}}'
      ),
    /positive duration/
  );
});

test("video probe diagnostics report measured output without native-quality claims", () => {
  const diagnostic = formatVideoProbeDiagnostic({
    duration: 11207.568,
    size: 9281146845,
    bitrate: 6624914,
    width: 3840,
    height: 2160,
    frameRate: 50,
    videoCodec: "hevc",
    audioCodec: "aac",
    hasAudio: true,
  });

  assert.match(diagnostic, /measured=3840x2160/);
  assert.match(diagnostic, /fps=50/);
  assert.match(diagnostic, /bitrate=6624914/);
  assert.doesNotMatch(diagnostic, /native|highest/i);
});
