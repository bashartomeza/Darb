import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scanner = fileURLToPath(new URL("../scan-production-artifacts.mjs", import.meta.url));

test("compiled APK manifests enforce location policy and retain artifact rules", { skip: process.env.DARB_TEST_ANDROID_TOOLS !== "true" }, () => {
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  assert.ok(sdk, "Android SDK is required for compiled-manifest tests");
  const latest = (directory, file) => readdirSync(directory)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((entry) => join(directory, entry, file)).find(existsSync);
  const aapt = process.env.AAPT || latest(join(sdk, "build-tools"), process.platform === "win32" ? "aapt.exe" : "aapt");
  const androidJar = latest(join(sdk, "platforms"), "android.jar");
  assert.ok(aapt && androidJar, "Installed Android build-tools and platform are required");
  const directory = mkdtempSync(join(tmpdir(), "darb apk fixture "));
  try {
    mkdirSync(join(directory, "assets"));
    for (const [name, permission, component, payload, expected, element = "uses-permission"] of [
      ["foreground", "ACCESS_COARSE_LOCATION", '<service android:name="com.baseflow.geolocator.GeolocatorLocationService" android:exported="false" android:foregroundServiceType="location"/>', "geolocator android.permission.ACCESS_BACKGROUND_LOCATION", 0],
      ["fine", "ACCESS_FINE_LOCATION", "", "geolocator", 0],
      ["background", "ACCESS_BACKGROUND_LOCATION", "", "", 1],
      ["foreground-service", "FOREGROUND_SERVICE_LOCATION", "", "", 1],
      ["background-sdk-m", "ACCESS_BACKGROUND_LOCATION", "", "", 1, "uses-permission-sdk-m"],
      ["foreground-service-sdk-m", "FOREGROUND_SERVICE_LOCATION", "", "", 1, "uses-permission-sdk-m"],
      ["exported", "ACCESS_FINE_LOCATION", '<service android:name="ps.darb.Worker" android:exported="true" android:foregroundServiceType="location"/>', "", 1],
      ["implicit-export", "ACCESS_FINE_LOCATION", '<service android:name="ps.darb.LocationService"><intent-filter><action android:name="ps.darb.LOCATION"/></intent-filter></service>', "", 1],
      ["secret", "ACCESS_FINE_LOCATION", "", "ROUTE_PROVIDER_SECRET", 1],
      ["demo", "ACCESS_FINE_LOCATION", "", "/api/v1/demo/reset", 1],
      ["tracking", "ACCESS_FINE_LOCATION", "", "flutter_background_geolocation", 1]
    ]) {
      writeFileSync(join(directory, "AndroidManifest.xml"), `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="ps.darb.fixture"><uses-sdk android:minSdkVersion="24"/><${element} android:name="android.permission.${permission}"/><application>${component}</application></manifest>`);
      writeFileSync(join(directory, "assets", "fixture.bin"), payload);
      const apk = join(directory, `${name}.apk`);
      const build = spawnSync(aapt, ["package", "-f", "-M", join(directory, "AndroidManifest.xml"), "-I", androidJar, "-A", join(directory, "assets"), "-F", apk], { encoding: "utf8" });
      assert.equal(build.status, 0, `${name}: ${build.stderr}`);
      const scan = spawnSync(process.execPath, [scanner, "--apk", apk], { encoding: "utf8", env: { ...process.env, AAPT: aapt } });
      assert.equal(scan.status, expected, `${name}: ${scan.stderr}`);
      assert.match(scan.stdout + scan.stderr, expected ? /ARTIFACT/ : /Production artifact scan passed/);
    }
    const broken = join(directory, "broken.apk");
    writeFileSync(broken, "not an APK");
    assert.notEqual(spawnSync(process.execPath, [scanner, "--apk", broken], { env: { ...process.env, AAPT: aapt } }).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("artifact scanner checks large binary payloads without unbounded decoding", () => {
  const directory = mkdtempSync(join(tmpdir(), "darb artifact fixture "));
  try {
    const payload = Buffer.alloc(1024 * 1024 + 512, 0x41);
    payload.write("ROUTE_PROVIDER_SECRET", 1024 * 1024 - 8, "utf8");
    writeFileSync(join(directory, "native.so"), payload);
    const scan = spawnSync(process.execPath, [scanner, "--admin-dir", directory], { encoding: "utf8" });
    assert.equal(scan.status, 1);
    assert.match(scan.stderr, /route provider server secret/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
