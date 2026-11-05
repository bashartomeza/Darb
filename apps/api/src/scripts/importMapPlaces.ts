import { prisma } from "../lib/prisma.js";
import { importPlaces, loadPlacesFile, OSM_PLACES_FILE } from "../services/mapPlaces.js";

// npm run places:import -w @darb/api -- [--dry-run] [--deactivate-missing] [--file <path>]
//
// Loads the committed OpenStreetMap extract (apps/api/data/osm-places.json) into map_places.
// Safe to repeat: rows are keyed by OSM id and rows an admin edited are never overwritten.
const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
const file = fileIndex >= 0 ? args[fileIndex + 1] : OSM_PLACES_FILE;
if (!file) throw new Error("--file needs a path");
const dryRun = args.includes("--dry-run");

const places = loadPlacesFile(file);
const result = await importPlaces(prisma, places, { deactivateMissing: args.includes("--deactivate-missing"), dryRun });
console.log(`${dryRun ? "Dry run: " : ""}${places.length} places in ${file}`);
console.log(JSON.stringify(result));
await prisma.$disconnect();
