#!/usr/bin/env node
// Deterministic MySQL 8 -> MariaDB 11.4 translator for the Prisma migration folder.
//
// The MySQL 8 migrations are immutable (sha256-pinned). This script reads them and
// writes a copy for MariaDB, changing only what MariaDB needs. Anything it does not
// recognise as safe makes it exit non-zero, naming the file and statement.
// See docs/deployment/MARIADB.md.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MARKER_FILE = ".mariadb-translated";

function replaceSqlCode(sql, pattern, replacement) {
  let output = "";
  let code = "";
  const flush = () => { output += code.replace(pattern, replacement); code = ""; };
  for (let i = 0; i < sql.length;) {
    const c = sql[i];
    const next = sql[i + 1];
    if ((c === "-" && next === "-" && (sql[i + 2] === undefined || /\s/.test(sql[i + 2]))) || c === "#") {
      flush();
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      output += sql.slice(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      flush();
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      output += sql.slice(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === "`") {
      flush();
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\\" && c !== "`") { j += 2; continue; }
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      output += sql.slice(i, j);
      i = j;
    } else {
      code += c;
      i++;
    }
  }
  flush();
  return output;
}

// Rewrite rules applied to every statement, in order. Each must be idempotent: its
// output must not match its own pattern again.
export const RULES = [
  {
    id: "drop-check",
    note: "MySQL `DROP CHECK name` is `DROP CONSTRAINT name` in MariaDB.",
    apply: (statement) => replaceSqlCode(statement, /\bDROP\s+CHECK\b/gi, "DROP CONSTRAINT")
  },
  {
    id: "sha2-ascii-comparison",
    note:
      "Comparing an ascii_bin column with SHA2(...) is an illegal collation mix in MariaDB. " +
      "Convert the (hex, therefore ascii-safe) digest explicitly.",
    apply: (statement) => !/\bCHECK\s*\(/i.test(statement) ? statement :
      rewriteCalls(statement, /=\s*SHA2\s*\(/gi, "= CONVERT(SHA2(", " USING ascii) COLLATE ascii_bin")
  }
];

/**
 * Wrap the balanced function calls matched by `opener` (a regex ending at the opening
 * parenthesis) as: prefix + original arguments + ")" + suffix.
 */
export function rewriteCalls(sql, opener, prefix, suffix) {
  let result = "";
  let cursor = 0;
  opener.lastIndex = 0;
  let match;
  while ((match = opener.exec(sql)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let j = start;
    while (j < sql.length && depth > 0) {
      const ch = sql[j];
      if (ch === "'" || ch === "`" || ch === '"') {
        const close = sql.indexOf(ch, j + 1);
        j = close === -1 ? sql.length : close + 1;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      j++;
    }
    if (depth !== 0) throw new Error(`Unbalanced parentheses after ${match[0]}`);
    result += sql.slice(cursor, match.index) + prefix + sql.slice(start, j - 1) + ")" + suffix;
    cursor = j;
    opener.lastIndex = j;
  }
  return result + sql.slice(cursor);
}

// Statements are accepted only when they start with one of these.
const ALLOWED_STARTS = [
  /^CREATE\s+(TEMPORARY\s+)?TABLE\b/i,
  /^CREATE\s+(UNIQUE\s+|FULLTEXT\s+)?INDEX\b/i,
  /^ALTER\s+TABLE\b/i,
  /^DROP\s+INDEX\b/i,
  /^DROP\s+(TEMPORARY\s+)?TABLE\b/i,
  /^RENAME\s+TABLE\b/i,
  /^CREATE\s+TRIGGER\b/i,
  /^DROP\s+TRIGGER\b/i,
  /^INSERT\b/i,
  /^UPDATE\b/i,
  /^DELETE\b/i,
  /^SET\b/i
];

// Constructs that exist only in MySQL 8 (or behave differently) and that no rule
// handles. Seeing one in the output is an error, never a silent pass-through.
export const FORBIDDEN = [
  { id: "collation-0900", pattern: /utf8mb4_0900_/i },
  { id: "skip-locked", pattern: /\bSKIP\s+LOCKED\b|\bNOWAIT\b/i },
  { id: "drop-check-left", pattern: /\bDROP\s+CHECK\b/i },
  { id: "alter-check", pattern: /\bALTER\s+CHECK\b/i },
  { id: "invisible-index", pattern: /\b(INVISIBLE|VISIBLE)\b/i },
  { id: "functional-index", pattern: /\bINDEX\b[^;(]*\(\s*\(/i },
  { id: "default-expression", pattern: /\bDEFAULT\s+\(/i },
  { id: "window-function", pattern: /\bOVER\s*\(/i },
  { id: "cte", pattern: /^\s*WITH\b/i },
  { id: "insert-alias", pattern: /\bVALUES\s*\([^)]*\)\s+AS\b/i },
  { id: "begin-block", pattern: /\bBEGIN\b/i },
  { id: "delimiter", pattern: /^\s*DELIMITER\b/im },
  { id: "json-table", pattern: /\bJSON_TABLE\b/i }
];

/** Split SQL into statements, honouring quotes, backticks and comments. */
export function splitStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  const lineEnd = (from) => {
    const end = sql.indexOf("\n", from);
    return end === -1 ? n : end;
  };
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-" && (sql[i + 2] === undefined || /\s/.test(sql[i + 2]))) {
      const stop = lineEnd(i);
      cur += sql.slice(i, stop);
      i = stop;
    } else if (c === "#") {
      const stop = lineEnd(i);
      cur += sql.slice(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      cur += sql.slice(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "\\" && c !== "`") {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === ";") {
      out.push(cur);
      cur = "";
      i++;
    } else {
      cur += c;
      i++;
    }
  }
  out.push(cur);
  return out;
}

/** Remove comments, for classification only. */
function stripComments(statement) {
  return statement
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\n)[ \t]*--[^\n]*/g, "$1")
    .trim();
}

/** Blank out string literals so keywords inside text are ignored by FORBIDDEN. */
function maskLiterals(sql) {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

export class TranslationError extends Error {
  constructor(file, statement, reason) {
    super(`${file}: ${reason}\n--- statement ---\n${statement.trim().slice(0, 600)}`);
    this.file = file;
  }
}

export function translateSql(sql, file = "<sql>") {
  const applied = new Set();
  const parts = splitStatements(sql);
  const translated = parts.map((statement) => {
    const body = stripComments(statement);
    if (body === "") return statement;
    if (!ALLOWED_STARTS.some((re) => re.test(body))) {
      throw new TranslationError(file, statement, "unrecognised statement type");
    }
    let next = statement;
    for (const rule of RULES) {
      const replaced = rule.apply(next);
      if (replaced !== next) applied.add(rule.id);
      next = replaced;
    }
    const masked = maskLiterals(stripComments(next));
    for (const bad of FORBIDDEN) {
      if (bad.pattern.test(masked)) {
        throw new TranslationError(file, statement, `MySQL-only construct not handled (${bad.id})`);
      }
    }
    return next;
  });
  return { sql: translated.join(";"), applied: [...applied] };
}

export function translateMigrationsFolder(sourceDir, outDir) {
  const source = resolve(sourceDir);
  const out = resolve(outDir);
  if (!existsSync(source)) throw new Error(`Migrations folder not found: ${source}`);
  if (out === source) throw new Error("Output directory must differ from the source directory.");
  if (existsSync(out)) throw new Error(`Output directory already exists: ${out}`);
  mkdirSync(out, { recursive: true });
  const report = [];
  const entries = readdirSync(source, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const file = join(source, entry.name, "migration.sql");
      if (!existsSync(file)) throw new Error(`${entry.name} has no migration.sql`);
      const original = readFileSync(file, "utf8");
      const { sql, applied } = translateSql(original, `${entry.name}/migration.sql`);
      mkdirSync(join(out, entry.name), { recursive: true });
      // Statements are split on `;` and rejoined, so an unchanged file is byte-identical.
      writeFileSync(join(out, entry.name, "migration.sql"), sql);
      report.push({ migration: entry.name, applied });
    } else if (entry.name === "migration_lock.toml") {
      cpSync(join(source, entry.name), join(out, entry.name));
    } else if (entry.name !== MARKER_FILE) {
      throw new Error(`Unexpected file in migrations folder: ${entry.name}`);
    }
  }
  return report;
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const args = argv.slice(2);
  const get = (flag, fallback) => {
    const at = args.indexOf(flag);
    return at === -1 ? fallback : args[at + 1];
  };
  const source = get("--source", join(root, "apps/api/prisma/migrations"));
  const out = get("--out");
  if (!out) {
    console.error("Usage: translate-migrations.mjs --out <dir> [--source <migrations dir>]");
    process.exit(2);
  }
  try {
    const report = translateMigrationsFolder(source, out);
    const changed = report.filter((r) => r.applied.length > 0);
    for (const r of changed) console.log(`${r.migration}: ${r.applied.join(", ")}`);
    console.log(`Translated ${report.length} migrations (${changed.length} changed) into ${resolve(out)}`);
  } catch (error) {
    console.error(`MariaDB translation refused.\n${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
