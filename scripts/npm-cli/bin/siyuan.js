#!/usr/bin/env node
/**
 * Thin wrapper that locates the SiYuan kernel CLI bundled with the desktop
 * client and forwards all arguments to it.
 *
 * We exec the binary in place instead of copying it: the kernel resolves its
 * working directory by walking up from the executable path to find
 * `appearance/langs`, so a detached copy would fail with
 * "appearance files not found".
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

function candidates() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const list = [];

  // 1) Environment variable override (works everywhere).
  if (process.env.SIYUAN_CLI_BIN) list.push(process.env.SIYUAN_CLI_BIN);

  // 2) Installed desktop client, per platform.
  if (process.platform === "win32") {
    // Prefer siyuan.exe: it prints "siyuan version x.y.z", which is what the
    // Doubao connector's statusMatchRegex expects. SiYuan-Kernel.exe prints
    // "SiYuan-Kernel version x.y.z" instead.
    list.push(
      path.join(programFiles, "SiYuan", "resources", "kernel", "siyuan.exe"),
      path.join(programFiles, "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
      path.join(localAppData, "Programs", "SiYuan", "resources", "kernel", "siyuan.exe"),
      path.join(localAppData, "Programs", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
    );
  } else if (process.platform === "darwin") {
    list.push(
      "/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel",
      path.join(home, "Applications", "SiYuan.app", "Contents", "Resources", "kernel", "SiYuan-Kernel"),
    );
  } else {
    list.push(
      "/opt/siyuan/kernel/SiYuan-Kernel",
      "/usr/local/bin/siyuan",
      "/usr/bin/siyuan",
      path.join(home, "SiYuan", "kernel", "SiYuan-Kernel"),
    );
  }

  // 3) Already on PATH (Windows installer adds the kernel directory).
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    if (process.platform === "win32") {
      list.push(path.join(dir, "siyuan.exe"), path.join(dir, "SiYuan-Kernel.exe"));
    } else {
      list.push(path.join(dir, "siyuan"), path.join(dir, "SiYuan-Kernel"));
    }
  }
  return list;
}

function findBinary() {
  for (const candidate of candidates()) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not present, try next
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "SiYuan CLI wrapper\n\n" +
        "Usage: siyuan <command> [flags]\n\n" +
        "Forwards arguments to the SiYuan kernel CLI bundled with the desktop client.\n" +
        "Set SIYUAN_CLI_BIN to override the detected binary path.\n",
    );
    return 0;
  }

  const binary = findBinary();
  if (!binary) {
    process.stderr.write(
      "siyuan: kernel CLI not found. Install SiYuan 3.8+ desktop client, or set SIYUAN_CLI_BIN to the SiYuan-Kernel executable.\n",
    );
    return 1;
  }

  const result = spawnSync(binary, args, { stdio: "inherit", windowsHide: true });
  if (result.error) {
    process.stderr.write(`siyuan: failed to launch ${binary}: ${result.error.message}\n`);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

process.exitCode = main();
