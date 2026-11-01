import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { inspectManifest } from "../lib/apk-location-policy.mjs";

// aapt dump xmltree output: permissions and service attributes are typed
// manifest declarations, unlike harmless SDK capability strings in classes.dex.
const manifest = (body = "") => `N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=2)
    A: package="ps.darb.mobile" (Raw: "ps.darb.mobile")
${body}
    E: application (line=20)
`;
const permission = (name, element = "uses-permission") => `    E: ${element} (line=4)
      A: android:name(0x01010003)="android.permission.${name}" (Raw: "android.permission.${name}")`;
const service = (attributes, children = "") => `      E: service (line=21)
        A: android:name(0x01010003)="com.baseflow.geolocator.GeolocatorLocationService"
${attributes}
${children}`;

test("foreground coarse/fine location permissions are allowed", () => {
  assert.deepEqual(inspectManifest(manifest([permission("ACCESS_COARSE_LOCATION"), permission("ACCESS_FINE_LOCATION")].join("\n"))), []);
});

for (const name of ["ACCESS_BACKGROUND_LOCATION", "FOREGROUND_SERVICE_LOCATION"]) {
  for (const element of ["uses-permission", "uses-permission-sdk-23", "uses-permission-sdk-m"]) {
    test(`${element} ${name} is blocked`, () => {
      assert.ok(inspectManifest(manifest(permission(name, element))).some((rule) => rule.includes(name)));
    });
  }
}

test("dormant non-exported geolocator service is allowed", () => {
  assert.deepEqual(inspectManifest(manifest() + service("        A: android:exported(0x01010010)=(type 0x12)0x0\n        A: android:foregroundServiceType(0x01010599)=(type 0x11)0x8")), []);
});
test("explicitly exported location service is blocked", () => {
  assert.ok(inspectManifest(manifest() + service("        A: android:exported(0x01010010)=(type 0x12)0xffffffff")).includes("exported location service"));
});
test("location foreground-service bit identifies a service with an unrelated name", () => {
  const input = (manifest() + service("        A: android:exported(0x01010010)=(type 0x12)0xffffffff\n        A: android:foregroundServiceType(0x01010599)=(type 0x11)0x18")).replace("com.baseflow.geolocator.GeolocatorLocationService", "ps.darb.Worker");
  assert.ok(inspectManifest(input).includes("exported location service"));
});
test("implicit export through an intent-filter is blocked", () => {
  assert.ok(inspectManifest(manifest() + service("", "        E: intent-filter (line=25)\n          E: action (line=26)\n            A: android:name(0x01010003)=\"ps.darb.LOCATION\"")).includes("exported location service"));
});
test("unresolved export resource fails closed", () => {
  assert.ok(inspectManifest(manifest() + service("        A: android:exported(0x01010010)=@0x7f010001")).length);
});
test("Android namespace aliases cannot bypass permission checks", () => {
  const text = manifest(permission("ACCESS_BACKGROUND_LOCATION")).replaceAll("android:", "a:").replace("N: android=", "N: a=");
  assert.ok(inspectManifest(text).some((rule) => rule.includes("ACCESS_BACKGROUND_LOCATION")));
});
test("unresolved service name fails closed", () => {
  assert.throws(() => inspectManifest((manifest() + service("        A: android:exported(0x01010010)=(type 0x12)0xffffffff")).replace('"com.baseflow.geolocator.GeolocatorLocationService"', "@0x7f010001")), /manifest/i);
});
test("exported activity does not make the adjacent non-exported location service exported", () => {
  assert.deepEqual(inspectManifest(manifest() + "      E: activity (line=21)\n        A: android:exported(0x01010010)=(type 0x12)0xffffffff\n" + service("        A: android:exported(0x01010010)=(type 0x12)0x0")), []);
});
test("missing or malformed decoded manifest fails closed", () => {
  for (const text of ["", "aapt error", "E: manifest", "  E: manifest (line=2)\n    A: package=\"test\""]) {
    assert.throws(() => inspectManifest(text), /manifest/i);
  }
});

const scanner = fileURLToPath(new URL("../scan-production-artifacts.mjs", import.meta.url));
function scan(content, encoding = "utf8") {
  const directory = mkdtempSync(join(tmpdir(), "masari-artifact-policy-"));
  try {
    writeFileSync(join(directory, "artifact.bin"), content, encoding);
    return spawnSync(process.execPath, [scanner, "--admin-dir", directory], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
test("geolocator binary capability strings alone are allowed", () => {
  assert.equal(scan("\0geolocator\0android.permission.ACCESS_FINE_LOCATION\0").status, 0);
});
for (const marker of ["/api/v1/demo/reset", "x-demo-reset-key", "Full Demo Sequence", "/simulate/step", "/simulate/reset", "DEMO_ADMIN_PASSWORD", "ROUTE_PROVIDER_SECRET", "MAPBOX_ACCESS_TOKEN", "GOOGLE_MAPS_API_KEY", "HERE_API_KEY", "STADIA_API_KEY", "background_locator", "flutter_background_geolocation"]) {
  test(`existing artifact rule still blocks ${marker}`, () => {
    const result = scan(marker);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ARTIFACT/);
  });
}
test("UTF-16 embedded secrets are blocked too", () => {
  assert.equal(scan("ROUTE_PROVIDER_SECRET", "utf16le").status, 1);
});

for (const offset of [0, 1]) {
  test(`UTF-16BE embedded secrets at byte offset ${offset} are blocked`, () => {
    const marker = Buffer.from("ROUTE_PROVIDER_SECRET", "utf16le").swap16();
    assert.equal(scan(Buffer.concat([Buffer.alloc(offset), marker])).status, 1);
  });
}
