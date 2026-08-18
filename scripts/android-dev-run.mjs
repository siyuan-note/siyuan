#!/usr/bin/env node
// 一键构建并部署 Android 测试版（替代手动打包 + Android Studio debug 按钮）
// 用法:
//   node scripts/android-dev-run.mjs [--flavor=official] [--android-dir=<路径>] [--device=<serial>] [--skip-ui] [--skip-kernel] [--skip-gradle]
// 流程: 构建 mobile 前端 -> 打包 app.zip -> gomobile 构建 kernel.aar -> gradle assemble -> adb 安装 -> 启动应用
import {spawnSync} from "node:child_process";
import {copyFileSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(repoRoot, "app");
const kernelDir = path.join(repoRoot, "kernel");

function usage() {
  console.log("Usage: node scripts/android-dev-run.mjs [options]");
  console.log("Options:");
  console.log("  --flavor=<flavor>      Flavor: cn / googleplay / huawei / official (default: official)");
  console.log("  --android-dir=<path>   Path to the siyuan-android project (default: next to the siyuan project)");
  console.log("  --device=<serial>      Specify an adb device (required when multiple devices are connected)");
  console.log("  --skip-ui              Skip pnpm build:mobile and use the existing stage/build/mobile output");
  console.log("  --skip-kernel          Skip the gomobile build and use the existing kernel/kernel.aar");
  console.log("  --skip-gradle          Skip the Gradle build and reinstall the most recently built APK");
  console.log("  -h, --help             Show help");
  process.exit(0);
}

const args = process.argv.slice(2);
let flavor = "official";
let androidDir = process.env.SIYUAN_ANDROID_DIR || path.resolve(repoRoot, "..", "siyuan-android");
let device = null;
let skipUi = false;
let skipKernel = false;
let skipGradle = false;
for (const arg of args) {
  if (arg === "-h" || arg === "--help") {
    usage();
  } else if (arg.startsWith("--flavor=")) {
    flavor = arg.slice("--flavor=".length);
  } else if (arg.startsWith("--android-dir=")) {
    androidDir = arg.slice("--android-dir=".length);
  } else if (arg.startsWith("--device=")) {
    device = arg.slice("--device=".length);
  } else if (arg === "--skip-ui") {
    skipUi = true;
  } else if (arg === "--skip-kernel") {
    skipKernel = true;
  } else if (arg === "--skip-gradle") {
    skipGradle = true;
  } else {
    console.error(`Unknown argument: ${arg}`);
    usage();
  }
}
if (!["cn", "googleplay", "huawei", "official"].includes(flavor)) {
  console.error(`Invalid flavor: ${flavor}. Available flavors: cn / googleplay / huawei / official`);
  process.exit(1);
}
const flavorUpper = flavor.charAt(0).toUpperCase() + flavor.slice(1);

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function run(command, cmdArgs, options = {}) {
  const result = spawnSync(command, cmdArgs, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: "inherit",
    shell: options.shell || false,
  });
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status}. Check the log above for details`);
  }
  return result;
}

function capture(command, cmdArgs) {
  const result = spawnSync(command, cmdArgs, {encoding: "utf8"});
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function findSdkDir() {
  const localProperties = path.join(androidDir, "local.properties");
  if (existsSync(localProperties)) {
    for (const line of readFileSync(localProperties, "utf8").split(/\r?\n/)) {
      if (line.startsWith("sdk.dir=")) {
        const value = line.slice("sdk.dir=".length);
        return value.replaceAll("\\:", ":").replaceAll("\\\\", "\\");
      }
    }
  }
  if (process.env.ANDROID_HOME) {
    return process.env.ANDROID_HOME;
  }
  fail("Android SDK not found. Configure sdk.dir in siyuan-android/local.properties or set the ANDROID_HOME environment variable");
}

function findAdb(sdkDir) {
  const sdkAdb = path.join(sdkDir, "platform-tools", "adb.exe");
  if (existsSync(sdkAdb)) {
    return sdkAdb;
  }
  const pathAdb = capture("where", ["adb"]).trim().split(/\r?\n/)[0];
  if (pathAdb) {
    return pathAdb;
  }
  fail("adb not found. Install platform-tools or add it to PATH");
}

function findNdk(sdkDir) {
  const ndkRoot = path.join(sdkDir, "ndk");
  if (!existsSync(ndkRoot)) {
    fail(`NDK not found: ${ndkRoot}. Install it using sdkmanager (for example, 28.2.13676358)`);
  }
  const versions = readdirSync(ndkRoot).filter((name) => statSync(path.join(ndkRoot, name)).isDirectory());
  versions.sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pb[i] || 0) - (pa[i] || 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  });
  if (versions.length === 0) {
    fail(`NDK directory is empty: ${ndkRoot}`);
  }
  return path.join(ndkRoot, versions[0]);
}

function findTool(name) {
  const paths = capture("where", [name]).trim().split(/\r?\n/);
  if (paths[0]) {
    return paths[0];
  }
  fail(`${name} not found. Install it and try again`);
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function deviceSerial(adb) {
  const maxAttempts = 11;
  let devices = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const lines = capture(adb, ["devices"]).split(/\r?\n/);
    devices = [];
    for (const line of lines) {
      const parts = line.split(/\t/);
      if (parts.length === 2 && parts[1] === "device") {
        devices.push(parts[0]);
      }
    }
    if (device ? devices.includes(device) : devices.length > 0) {
      break;
    }
    if (attempt === 1) {
      console.log("Waiting up to 10 seconds for an adb device...");
    }
    if (attempt < maxAttempts) {
      wait(1000);
    }
  }
  if (device) {
    if (devices.includes(device)) {
      return device;
    }
    fail(`Device ${device} not found. Connected devices: ${devices.join(", ") || "none"}`);
  }
  if (devices.length === 1) {
    return devices[0];
  }
  if (devices.length === 0) {
    fail("No connected devices detected. To connect using wireless debugging, enable Wireless debugging on the device, run adb pair <ip>:<port> <pairing-code>, and then run adb connect <ip>:<port>");
  }
  fail(`Multiple devices detected: ${devices.join(", ")}. Specify one using --device=<serial>`);
}

const sdkDir = findSdkDir();
const adb = findAdb(sdkDir);
const ndkDir = findNdk(sdkDir);
const serial = deviceSerial(adb);

const startedAt = Date.now();
console.log(`[1/6] Environment check complete: sdk=${sdkDir} ndk=${ndkDir} device=${serial} flavor=${flavor}`);

if (!skipUi) {
  console.log("[2/6] Building the mobile frontend (pnpm run build:mobile)...");
  run("pnpm", ["run", "build:mobile"], {cwd: appDir, shell: true});
} else {
  console.log("[2/6] Skipping the frontend build and using the existing stage/build/mobile output");
}
const mobileIndex = path.join(appDir, "stage", "build", "mobile", "index.html");
if (!existsSync(mobileIndex)) {
  fail(`Frontend build output is missing: ${mobileIndex}. Build it first without using --skip-ui`);
}

console.log("[3/6] Creating app.zip...");
const zipPath = path.join(os.tmpdir(), "siyuan-android-app.zip");
if (existsSync(zipPath)) {
  unlinkSync(zipPath);
}
const tarArgs = ["-a", "-cf", zipPath, "-C", appDir, "appearance", "guide", "stage"];
const changelogsDir = path.join(appDir, "changelogs");
if (existsSync(changelogsDir)) {
  tarArgs.push("changelogs");
}
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  if (existsSync(path.join(repoRoot, file))) {
    tarArgs.push("-C", repoRoot, file);
  } else {
    console.log(`Warning: ${file} does not exist and will be skipped`);
  }
}
run("tar", tarArgs);
const androidAssets = path.join(androidDir, "app", "src", "main", "assets");
if (!existsSync(androidAssets)) {
  fail(`Unexpected siyuan-android directory structure: ${androidAssets} does not exist. Specify the correct project path using --android-dir`);
}
copyFileSync(zipPath, path.join(androidAssets, "app.zip"));
console.log(`app.zip copied to ${path.join(androidAssets, "app.zip")}`);

if (!skipKernel) {
  console.log("[4/6] Building the Android kernel (gomobile bind)...");
  const env = {
    ...process.env,
    ANDROID_HOME: sdkDir,
    ANDROID_NDK_HOME: ndkDir,
    CGO_ENABLED: "1",
    JAVA_TOOL_OPTIONS: "-Dfile.encoding=UTF-8",
  };
  run("gomobile", ["bind", "-tags", "fts5 sqlcipher", "-ldflags=-s -w", "-v", "-o", "kernel.aar", "-target", "android/arm64", "-androidapi", "26", "./mobile/"], {
    cwd: kernelDir,
    env,
  });
} else {
  console.log("[4/6] Skipping the kernel build and using the existing kernel/kernel.aar");
}
const kernelAar = path.join(kernelDir, "kernel.aar");
if (!existsSync(kernelAar)) {
  fail(`Kernel build output is missing: ${kernelAar}. Build it first without using --skip-kernel`);
}
const androidLibs = path.join(androidDir, "app", "libs");
if (!existsSync(androidLibs)) {
  fail(`Unexpected siyuan-android directory structure: ${androidLibs} does not exist`);
}
copyFileSync(kernelAar, path.join(androidLibs, "kernel.aar"));
console.log("kernel.aar copied to " + path.join(androidLibs, "kernel.aar"));

const apkDir = path.join(androidDir, "app", "build", "outputs", "apk", flavor, "debug");
if (!skipGradle) {
  console.log("[5/6] Running Gradle assemble" + flavorUpper + "Debug (the first build may take a while to download dependencies)...");
  run("gradlew.bat", [`assemble${flavorUpper}Debug`], {cwd: androidDir, shell: true});
}
if (!existsSync(apkDir)) {
  fail(`APK output directory not found: ${apkDir}. Run the Gradle build first without using --skip-gradle`);
}
let apk = null;
for (const name of readdirSync(apkDir)) {
  if (/^siyuan-.+-official-debug-.*\.apk$/.test(name)) {
    const candidate = path.join(apkDir, name);
    if (!apk || statSync(candidate).mtimeMs > statSync(apk).mtimeMs) {
      apk = candidate;
    }
  }
}
if (!apk) {
  fail(`APK file not found in ${apkDir}. Expected siyuan-*-${flavor}-debug-*.apk`);
}
console.log("APK: " + apk);

console.log("[6/6] Installing and launching the app...");
run(adb, ["-s", serial, "install", "-r", "-d", apk]);
// debug 变体仅修改 applicationId（org.b3log.siyuan.debug），Activity 类仍位于 org.b3log.siyuan 包
run(adb, ["-s", serial, "shell", "am", "start", "-n", "org.b3log.siyuan.debug/org.b3log.siyuan.BootActivity"]);

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s`);
