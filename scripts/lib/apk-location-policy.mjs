import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./process.mjs";

// Decode the compiled manifest with the Android SDK, never infer permissions
// from strings in DEX/native libraries (plugins contain unused capability names).
export function readApkManifest(apk, environment = process.env) {
  const executable = process.platform === "win32" ? "aapt.exe" : "aapt";
  let aapt = environment.AAPT;
  if (!aapt) {
    for (const sdk of [environment.ANDROID_SDK_ROOT, environment.ANDROID_HOME].filter(Boolean)) {
      const directory = join(sdk, "build-tools");
      if (!existsSync(directory)) continue;
      const versions = readdirSync(directory).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      aapt = versions.map((version) => join(directory, version, executable)).find(existsSync);
      if (aapt) break;
    }
  }
  const result = run(aapt ?? executable, ["dump", "xmltree", apk, "AndroidManifest.xml"], {
    encoding: "utf8", stdio: "pipe", env: environment
  });
  return result.stdout;
}

export function inspectManifest(text) {
  const nodes = [];
  const stack = [];
  for (const line of text.split(/\r?\n/)) {
    const element = /^(\s*)E: ([\w-]+) \(line=\d+\)\s*$/.exec(line);
    if (element) {
      const indent = element[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const node = { name: element[2], indent, attributes: {}, children: [] };
      stack.at(-1)?.children.push(node);
      nodes.push(node);
      stack.push(node);
    } else if (/^\s*A:/.test(line)) {
      const attribute = /^\s*A: ([\w:]+)(?:\((0x[\da-f]+)\))?=(.*)$/i.exec(line);
      if (!attribute || !stack.length) throw new Error("Malformed decoded Android manifest attribute");
      // Framework resource IDs are stable even if the XML namespace uses an alias.
      const names = { "0x01010003": "android:name", "0x01010010": "android:exported", "0x01010599": "android:foregroundServiceType" };
      stack.at(-1).attributes[names[attribute[2]?.toLowerCase()] ?? attribute[1]] = attribute[3];
    }
  }
  if (nodes[0]?.name !== "manifest" || !nodes[0].attributes.package || !nodes[0].children.some((node) => node.name === "application")) {
    throw new Error("Missing or malformed decoded Android manifest");
  }
  const string = (raw = "") => /^"([^"]*)"/.exec(raw)?.[1];
  const integer = (raw = "") => {
    const match = /^\(type 0x1[012]\)0x([\da-f]+)$/i.exec(raw);
    return match ? Number.parseInt(match[1], 16) : undefined;
  };
  const findings = [];
  for (const node of nodes) {
    if (/^uses-permission(?:-sdk-(?:\d+|m))?$/.test(node.name)) {
      const name = string(node.attributes["android:name"]);
      if (!name) throw new Error("Unresolved Android manifest permission name");
      if (["android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.FOREGROUND_SERVICE_LOCATION"].includes(name)) findings.push(name);
    }
    if (node.name !== "service") continue;
    if (!string(node.attributes["android:name"])) throw new Error("Unresolved Android manifest service name");
    const type = node.attributes["android:foregroundServiceType"];
    const typeValue = integer(type);
    if (type && typeValue === undefined && string(type) === undefined) throw new Error("Unresolved Android manifest service type");
    const descendantValues = (item) => [...Object.values(item.attributes), ...item.children.flatMap(descendantValues)];
    const location = descendantValues(node).some((value) => /location|geolocator/i.test(value)) || ((typeValue ?? 0) & 8) !== 0;
    if (!location) continue;
    const exported = node.attributes["android:exported"];
    // Resource references cannot prove non-exported. Absent exported defaults
    // to true for a service with an intent filter, false otherwise.
    const isExported = exported === undefined
      ? node.children.some((child) => child.name === "intent-filter")
      : integer(exported) !== 0 && string(exported) !== "false";
    if (isExported) findings.push("exported location service");
  }
  return findings;
}
