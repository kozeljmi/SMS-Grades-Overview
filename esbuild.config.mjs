import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "fs";

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

// Write dev-flag.js for the content_scripts manifest entry
writeFileSync("dist/dev-flag.js", `var DEV = ${dev};\n`);

// Copy static files
cpSync("manifest.json", "dist/manifest.json");
cpSync("popup.html", "dist/popup.html");
cpSync("content.css", "dist/content.css");
cpSync("popup.css", "dist/popup.css");
cpSync("icons", "dist/icons", { recursive: true });

console.log(`Built in ${dev ? "development" : "production"} mode → dist/`);
