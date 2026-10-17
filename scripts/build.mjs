import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, "dist"), { recursive: true });
await mkdir(path.join(root, ".cache"), { recursive: true });
const css = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/@tailwindcss/cli/dist/index.mjs"),
    "-i",
    "src/styles.css",
    "-o",
    ".cache/app.css",
    "--minify",
  ],
  { cwd: root, stdio: "inherit" },
);
if (css.status !== 0) process.exit(css.status ?? 1);
const output = await build({
  entryPoints: [path.join(root, "src/main.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: ["chrome120", "firefox121", "safari17"],
  minify: false,
  legalComments: "none",
  loader: { ".png": "dataurl" },
  metafile: true,
});
assert(
  Object.keys(output.metafile.inputs).every(
    (input) =>
      !input.includes("network-sandbox") && !input.includes(".research"),
  ),
  "Reference material must not be bundled",
);
const template = await readFile(path.join(root, "src/shell.html"), "utf8");
const style = await readFile(path.join(root, ".cache/app.css"), "utf8");
const yamlLicense = await readFile(path.join(root, "node_modules/yaml/LICENSE"), "utf8");
const script = (`/* YAML parser (yaml):\n${yamlLicense}*/\n` + output.outputFiles[0].text).replace(/<\/script/gi, "<\\/script");
const html = template
  .replace("<!--APP_STYLE-->", () => `<style>${style}</style>`)
  .replace("<!--APP_SCRIPT-->", () => `<script>${script}</script>`);
// The browser consumes exactly this escaped inline program. Parse it as a classic
// script to catch packaging regressions independently of the source compilation.
new Script(script, { filename: "NetworkSim.html" });
assert.equal((html.match(/<script>/g) || []).length, 1);
assert.equal((html.match(/<\/script>/g) || []).length, 1);
assert(!/<script[^>]+src=/.test(html));
assert(!/<link[^>]+(?:href|rel)=/.test(template));
assert(template.includes("connect-src 'none'"));
await writeFile(path.join(root, "dist/index.html"), html);
await writeFile(path.join(root, "NetworkSim.html"), html);
await writeFile(
  path.join(root, ".cache/build-meta.json"),
  JSON.stringify(output.metafile, null, 2),
);
console.log(
  `Built NetworkSim.html and dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KiB). Open NetworkSim.html directly in your browser; no server is required.`,
);
