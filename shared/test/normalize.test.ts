import { describe, expect, it } from "vitest";
import {
  buildAssetKey,
  buildMeasureArgs,
  buildNormalizeArgs,
  buildTrimFilter,
  assetObjectKey,
  NORMALIZE,
} from "../src/normalize.js";
import { SPEC_VERSION } from "../src/types.js";

describe("asset cache keys", () => {
  it("is deterministic for identical inputs", () => {
    const a = buildAssetKey({ sourceKey: "vid1", startSec: 10, endSec: 250 });
    const b = buildAssetKey({ sourceKey: "vid1", startSec: 10, endSec: 250 });
    expect(a).toBe(b);
  });

  it("changes when the source changes", () => {
    const a = buildAssetKey({ sourceKey: "vid1" });
    const b = buildAssetKey({ sourceKey: "vid2" });
    expect(a).not.toBe(b);
  });

  it("changes when cut boundaries change", () => {
    const a = buildAssetKey({ sourceKey: "vid1", startSec: 10 });
    const b = buildAssetKey({ sourceKey: "vid1", startSec: 11 });
    const c = buildAssetKey({ sourceKey: "vid1", startSec: 10, endSec: 100 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("embeds the normalize spec version (bump => new keys => re-processing)", () => {
    // SPEC_VERSION is baked into the key; assert the key reflects the
    // current constants so an intentional bump is a conscious test update.
    const key = buildAssetKey({ sourceKey: "vid1" });
    expect(SPEC_VERSION).toBe(1);
    expect(key).toMatch(/^[a-f0-9]{24}$/);
  });

  it("maps to a stable R2 object key", () => {
    expect(assetObjectKey("abc123")).toBe("assets/abc123.mp3");
  });
});

describe("normalize spec", () => {
  it("trims edges only — never mid-segment", () => {
    const filter = buildTrimFilter();
    // Leading trim + areverse-sandwich trailing trim; no stop_periods>0
    // mid-stream removal.
    expect(filter).toContain("silenceremove=start_periods=1");
    expect(filter).toContain("areverse");
    expect(filter).toContain(`${NORMALIZE.silenceThresholdDb}dB`);
  });

  it("pass 1 measures with loudnorm print_format=json", () => {
    const args = buildMeasureArgs().join(" ");
    expect(args).toContain("loudnorm");
    expect(args).toContain("print_format=json");
  });

  it("pass 2 applies measurements linearly and pins uniform output format", () => {
    const args = buildNormalizeArgs({
      inputI: "-20.0",
      inputTp: "-2.0",
      inputLra: "7.0",
      inputThresh: "-30.0",
    }).join(" ");
    expect(args).toContain("measure_I=-20.0");
    expect(args).toContain("linear=true");
    expect(args).toContain("-ar 44100");
    expect(args).toContain("-ac 2");
    expect(args).toContain("libmp3lame");
    expect(args).toContain("192k");
  });
});
