// Passenger startup file for cPanel "Setup Node.js App". Passenger loads it with require(), which cannot
// load a module that uses top-level await, so this CommonJS file only hands over to app-main.mjs.
import("./app-main.mjs").catch((error) => {
  console.error("Darb failed to start:", error && error.message ? error.message : error);
  process.exit(1);
});
