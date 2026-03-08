import fs from "node:fs/promises";

// This script can be run to export localStorage overrides to overrides.json
// For now, we'll create a simple way to manually sync overrides

const OVERRIDES_PATH = "./data/overrides.json";

console.log("📝 Override Export Tool");
console.log("To export your manual overrides from the browser:");
console.log("1. Open browser developer tools (F12)");
console.log("2. Go to Application/Storage tab");
console.log("3. Find 'finance_overrides' in localStorage");
console.log("4. Copy the JSON value");
console.log("5. Paste it into data/overrides.json");
console.log("");
console.log("Or run this command to create a template:");
console.log("node -e \"console.log(JSON.stringify({description:'Manual overrides',overrides:{},version:'1.0'},null,2))\" > data/overrides.json");
