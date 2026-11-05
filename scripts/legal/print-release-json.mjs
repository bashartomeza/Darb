#!/usr/bin/env node
// Prints the JSON body for POST /api/v1/admin/consent-releases from docs/legal/release-v1.
// It only reads local files and writes to stdout. It never calls a server and holds no credentials.
//
//   node scripts/legal/print-release-json.mjs --version 1.0.0 --effective 2026-11-10T09:00:00+02:00 > release.json
//   node scripts/legal/print-release-json.mjs --version 1.0.0 --effective ... --strict   # fail while placeholders remain
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const defaultDirectory = resolve(here, "../../docs/legal/release-v1");

export const releaseFiles = [
  { type: "terms", locale: "ar", file: "terms.ar.md" },
  { type: "terms", locale: "en", file: "terms.en.md" },
  { type: "privacy", locale: "ar", file: "privacy.ar.md" },
  { type: "privacy", locale: "en", file: "privacy.en.md" },
  { type: "adult_self_attestation", locale: "ar", file: "adult.ar.md" },
  { type: "adult_self_attestation", locale: "en", file: "adult.en.md" }
];

// The draft banner is a first line that starts with "> ". It is for reviewers and is never published.
export function stripDraftBanner(text) {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.startsWith("> ")) {
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function findPlaceholders(text) {
  // Every owner placeholder is written in square brackets; the texts use square brackets for nothing else.
  return [...new Set(text.match(/\[[^\]\n]+\]/g) ?? [])];
}

export function buildReleaseJson({ version, effective, directory = defaultDirectory }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/.test(version ?? "")) {
    throw new Error("--version must be 1-50 characters: letters, digits, '.', '_' or '-', starting with a letter or digit");
  }
  const instant = new Date(effective ?? "");
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(effective ?? "") || Number.isNaN(instant.getTime())) {
    throw new Error("--effective must be an ISO-8601 time with an offset, for example 2026-11-10T09:00:00+02:00");
  }
  const placeholders = [];
  const documents = releaseFiles.map(({ type, locale, file }) => {
    const content = stripDraftBanner(readFileSync(join(directory, file), "utf8"));
    for (const placeholder of findPlaceholders(content)) placeholders.push(`${file}: ${placeholder}`);
    return { type, locale, content };
  });
  return { body: { version, intended_effective_at: effective, documents }, placeholders };
}

function parseArguments(argv) {
  const options = { strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--strict") options.strict = true;
    else if (argument === "--version") options.version = argv[++index];
    else if (argument === "--effective") options.effective = argv[++index];
    else if (argument === "--dir") options.directory = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const { body, placeholders } = buildReleaseJson(options);
    if (placeholders.length > 0) {
      process.stderr.write(`Warning: ${placeholders.length} placeholder(s) still need to be completed by the owner:\n`);
      for (const placeholder of placeholders) process.stderr.write(`  - ${placeholder}\n`);
      if (options.strict) {
        process.stderr.write("Refusing to print because --strict was given.\n");
        process.exit(2);
      }
    }
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
