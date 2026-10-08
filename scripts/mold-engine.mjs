#!/usr/bin/env node
// Dev runner for the mold engine sidecar (vendored MOLD-FORAGE under mold-engine/).
// Mirrors the forge's setup.bat: ensures the moldforge clone + .venv exist,
// resolves a Blender binary, then starts the FastAPI server.
//
//   node scripts/mold-engine.mjs
//
// Env:
//   MOLD_ENGINE_PORT   port for the sidecar            (default 8000)
//   MOLD_ENGINE_HOST   bind host                       (default 127.0.0.1)
//   MOLDFORGE_BLENDER  explicit path to blender.exe    (highest priority)
//   MOLD_FORAGE_SOURCE original MOLD-FORAGE checkout used only as a Blender
//                      fallback when mold-engine/engine/ is absent
//                      (default D:\code\3d\MOLD\MOLD-FORAGE on the dev machine)

import { existsSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(repo, "mold-engine");
const venvPython = path.join(engineDir, ".venv", "Scripts", "python.exe");
const port = process.env.MOLD_ENGINE_PORT || "8000";
const host = process.env.MOLD_ENGINE_HOST || "127.0.0.1";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: engineDir, shell: true });
  if (r.status !== 0) {
    console.error(`[mold-engine] step failed: ${cmd} ${args.join(" ")}`);
    process.exit(1);
  }
}

// 1) moldforge add-on clone (GPL, algorithms untouched — never edited)
if (!existsSync(path.join(engineDir, "moldforge", "core", "pipeline.py"))) {
  console.log("[mold-engine] cloning moldforge add-on...");
  run("git", ["clone", "https://github.com/Plesuro/MoldForge.git", "moldforge"]);
}

// 2) python venv + server deps
if (!existsSync(venvPython)) {
  console.log("[mold-engine] creating .venv...");
  run("python", ["-m", "venv", ".venv"]);
}
run(venvPython, ["-m", "pip", "install", "-q", "-r", "requirements.txt"]);

// 3) Blender binary — same preference order as webui/server.py::find_blender,
//    plus a dev-machine fallback to the original checkout's engine/.
function findBlender() {
  if (process.env.MOLDFORGE_BLENDER) return process.env.MOLDFORGE_BLENDER;
  const engineRoot = path.join(engineDir, "engine");
  if (existsSync(engineRoot)) {
    const preferred = readdirSync(engineRoot)
      .filter((d) => /^blender-5\.1\./.test(d))
      .map((d) => path.join(engineRoot, d, "blender.exe"))
      .filter(existsSync);
    if (preferred.length) return preferred.sort().at(-1);
    const any = readdirSync(engineRoot)
      .map((d) => path.join(engineRoot, d, "blender.exe"))
      .filter(existsSync);
    if (any.length) return any.sort().at(-1);
    const direct = path.join(engineRoot, "blender.exe");
    if (existsSync(direct)) return direct;
  }
  const source =
    process.env.MOLD_FORAGE_SOURCE || "D:\\code\\3d\\MOLD\\MOLD-FORAGE";
  const fallback = path.join(source, "engine", "blender-5.1.2-windows-x64", "blender.exe");
  if (existsSync(fallback)) return fallback;
  return null;
}

const blender = findBlender();
if (!blender) {
  console.error(
    "[mold-engine] no Blender found. Either copy the portable build into " +
      "mold-engine/engine/ (run mold-engine/setup.bat there), or set " +
      "MOLDFORGE_BLENDER to a blender.exe path."
  );
  process.exit(1);
}
console.log(`[mold-engine] blender: ${blender}`);

// 4) start the sidecar (single-worker queue by design — one Blender at a time)
console.log(`[mold-engine] starting FastAPI on http://${host}:${port}`);
const server = spawn(
  venvPython,
  ["-m", "uvicorn", "webui.server:app", "--host", host, "--port", port],
  { cwd: engineDir, stdio: "inherit", env: { ...process.env, MOLDFORGE_BLENDER: blender } }
);
server.on("exit", (code) => process.exit(code ?? 0));

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://${host}:${port}/api/health`);
    if (res.ok) {
      console.log(`[mold-engine] ready → http://${host}:${port}/api/health`);
      break;
    }
  } catch {
    /* still booting */
  }
}
