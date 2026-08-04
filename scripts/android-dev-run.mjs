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
  console.log("用法: node scripts/android-dev-run.mjs [选项]");
  console.log("选项:");
  console.log("  --flavor=<flavor>      渠道: cn / googleplay / huawei / official（默认 official）");
  console.log("  --android-dir=<路径>    siyuan-android 项目路径（默认与 siyuan 同级的 siyuan-android）");
  console.log("  --device=<serial>      指定 adb 设备（多设备连接时必填）");
  console.log("  --skip-ui              跳过 pnpm build:mobile，使用现有的 stage/build/mobile 产物");
  console.log("  --skip-kernel          跳过 gomobile 构建，使用现有的 kernel/kernel.aar");
  console.log("  --skip-gradle          跳过 gradle 构建，重新安装最近一次构建的 APK");
  console.log("  -h, --help             显示帮助");
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
    console.error(`未知参数: ${arg}`);
    usage();
  }
}
if (!["cn", "googleplay", "huawei", "official"].includes(flavor)) {
  console.error(`无效的渠道: ${flavor}，可选: cn / googleplay / huawei / official`);
  process.exit(1);
}
const flavorUpper = flavor.charAt(0).toUpperCase() + flavor.slice(1);

function fail(message) {
  console.error(`错误: ${message}`);
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
    fail(`${command} 执行失败（退出码 ${result.status}），请检查上方日志`);
  }
  return result;
}

function capture(command, cmdArgs) {
  const result = spawnSync(command, cmdArgs, {encoding: "utf8"});
  if (result.status !== 0) {
    fail(`${command} 执行失败（退出码 ${result.status}）`);
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
  fail("未找到 Android SDK：请在 siyuan-android/local.properties 中配置 sdk.dir 或设置环境变量 ANDROID_HOME");
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
  fail("未找到 adb：请安装 platform-tools 或将其加入 PATH");
}

function findNdk(sdkDir) {
  const ndkRoot = path.join(sdkDir, "ndk");
  if (!existsSync(ndkRoot)) {
    fail(`未找到 NDK：${ndkRoot}，请通过 sdkmanager 安装（如 28.2.13676358）`);
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
    fail(`NDK 目录为空: ${ndkRoot}`);
  }
  return path.join(ndkRoot, versions[0]);
}

function findTool(name) {
  const paths = capture("where", [name]).trim().split(/\r?\n/);
  if (paths[0]) {
    return paths[0];
  }
  fail(`未找到 ${name}，请安装后重试`);
}

function deviceSerial(adb) {
  const lines = capture(adb, ["devices"]).split(/\r?\n/);
  const devices = [];
  for (const line of lines) {
    const parts = line.split(/\t/);
    if (parts.length === 2 && parts[1] === "device") {
      devices.push(parts[0]);
    }
  }
  if (device) {
    if (devices.includes(device)) {
      return device;
    }
    fail(`未找到设备 ${device}，当前已连接: ${devices.join(", ") || "无"}`);
  }
  if (devices.length === 1) {
    return devices[0];
  }
  if (devices.length === 0) {
    fail("未检测到已连接的设备。无线调试连接方式: 手机开启「无线调试」后执行 adb pair <ip>:<端口> <配对码>，再执行 adb connect <ip>:<端口>");
  }
  fail(`检测到多个设备: ${devices.join(", ")}，请通过 --device=<serial> 指定一个`);
}

const sdkDir = findSdkDir();
const adb = findAdb(sdkDir);
const ndkDir = findNdk(sdkDir);
const serial = deviceSerial(adb);

const startedAt = Date.now();
console.log(`[1/6] 环境检查完成: sdk=${sdkDir} ndk=${ndkDir} 设备=${serial} 渠道=${flavor}`);

if (!skipUi) {
  console.log("[2/6] 构建 mobile 前端（pnpm run build:mobile）...");
  run("pnpm", ["run", "build:mobile"], {cwd: appDir, shell: true});
} else {
  console.log("[2/6] 跳过前端构建，使用现有 stage/build/mobile 产物");
}
const mobileIndex = path.join(appDir, "stage", "build", "mobile", "index.html");
if (!existsSync(mobileIndex)) {
  fail(`前端产物缺失: ${mobileIndex}，请先构建（不要使用 --skip-ui）`);
}

console.log("[3/6] 打包 app.zip ...");
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
    console.log(`警告: ${file} 不存在，已跳过`);
  }
}
run("tar", tarArgs);
const androidAssets = path.join(androidDir, "app", "src", "main", "assets");
if (!existsSync(androidAssets)) {
  fail(`siyuan-android 目录结构异常: ${androidAssets} 不存在，请通过 --android-dir 指定正确的项目路径`);
}
copyFileSync(zipPath, path.join(androidAssets, "app.zip"));
console.log(`app.zip 已复制到 ${path.join(androidAssets, "app.zip")}`);

if (!skipKernel) {
  console.log("[4/6] 构建 Android 内核（gomobile bind）...");
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
  console.log("[4/6] 跳过内核构建，使用现有 kernel/kernel.aar");
}
const kernelAar = path.join(kernelDir, "kernel.aar");
if (!existsSync(kernelAar)) {
  fail(`内核产物缺失: ${kernelAar}，请先构建（不要使用 --skip-kernel）`);
}
const androidLibs = path.join(androidDir, "app", "libs");
if (!existsSync(androidLibs)) {
  fail(`siyuan-android 目录结构异常: ${androidLibs} 不存在`);
}
copyFileSync(kernelAar, path.join(androidLibs, "kernel.aar"));
console.log("kernel.aar 已复制到 " + path.join(androidLibs, "kernel.aar"));

const apkDir = path.join(androidDir, "app", "build", "outputs", "apk", flavor, "debug");
if (!skipGradle) {
  console.log("[5/6] Gradle 构建 assemble" + flavorUpper + "Debug（首次构建需下载依赖，耗时较长）...");
  run("gradlew.bat", [`assemble${flavorUpper}Debug`], {cwd: androidDir, shell: true});
}
if (!existsSync(apkDir)) {
  fail(`未找到 APK 输出目录: ${apkDir}，请先执行 gradle 构建（不要使用 --skip-gradle）`);
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
  fail(`未找到 APK 文件: ${apkDir}（需要 siyuan-*-${flavor}-debug-*.apk）`);
}
console.log("APK: " + apk);

console.log("[6/6] 安装并启动应用...");
run(adb, ["-s", serial, "install", "-r", "-d", apk]);
// debug 变体仅修改 applicationId（org.b3log.siyuan.debug），Activity 类仍位于 org.b3log.siyuan 包
run(adb, ["-s", serial, "shell", "am", "start", "-n", "org.b3log.siyuan.debug/org.b3log.siyuan.BootActivity"]);

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`完成，耗时 ${elapsed}s`);
