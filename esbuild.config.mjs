import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";

const dev = process.argv.includes("--dev");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: ["content.js", "background.js", "popup.js"],
  bundle: false,
  outdir: "dist",
  banner: { js: `var DEV = ${dev};` },
  minify: !dev,
  sourcemap: dev ? "inline" : false,
});

// Copy static files
cpSync("popup.html", "dist/popup.html");
cpSync("content.css", "dist/content.css");
cpSync("popup.css", "dist/popup.css");
cpSync("icons", "dist/icons", { recursive: true });

// Generate browser-specific manifests
const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));

// Chrome manifest (source is already Chrome-compatible)
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));

// Firefox manifest: swap service_worker → scripts, add gecko settings
const firefoxManifest = { ...manifest };
firefoxManifest.background = { scripts: [manifest.background.service_worker] };
firefoxManifest.browser_specific_settings = {
  gecko: {
    id: "sms-grades@kmiguel.com",
    strict_min_version: "140.0",
    data_collection_permissions: { required: ["none"] },
  },
};
writeFileSync("dist/manifest.firefox.json", JSON.stringify(firefoxManifest, null, 2));

console.log(`Built in ${dev ? "development" : "production"} mode → dist/`);
