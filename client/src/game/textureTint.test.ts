import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { identityTint, softTint } from "./textureTint";

describe("softTint", () => {
  it("returns the original color unblended at blend=0", () => {
    const result = softTint(0xff0000, 0);
    expect(result.getHex()).toBe(new THREE.Color(0xff0000).getHex());
  });

  it("returns pure white at blend=1", () => {
    const result = softTint(0xff0000, 1);
    expect(result.getHex()).toBe(0xffffff);
  });

  it("lerps partway to white at an intermediate blend, using the default decorative blend of 0.7", () => {
    const result = softTint(0x000000);
    const expected = new THREE.Color(0x000000).lerp(new THREE.Color(0xffffff), 0.7);
    expect(result.getHex()).toBe(expected.getHex());
  });

  it("accepts a CSS hex string the same as a numeric color", () => {
    const fromString = softTint("#ff0000", 0.5);
    const fromNumber = softTint(0xff0000, 0.5);
    expect(fromString.getHex()).toBe(fromNumber.getHex());
  });
});

describe("identityTint", () => {
  it("blends less toward white than softTint's own default (players/NPCs stay more recognizable)", () => {
    const identity = identityTint(0x0000ff);
    const decorative = softTint(0x0000ff);
    // Pure blue's own blue channel is already 1.0, same as white's, so it's invariant under any
    // blend - the red channel (0 in pure blue, 1 in white) is what actually tracks the blend
    // factor: less blend toward white means it stays closer to 0 than the more-blended version.
    expect(identity.r).toBeLessThan(decorative.r);
  });

  it("matches softTint at the identity blend factor of 0.3", () => {
    const result = identityTint(0x00ff00);
    const expected = softTint(0x00ff00, 0.3);
    expect(result.getHex()).toBe(expected.getHex());
  });
});
