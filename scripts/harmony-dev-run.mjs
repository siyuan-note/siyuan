#!/usr/bin/env node
// 构建 ARM64 鸿蒙调试版并安装启动；签名和 SDK 配置沿用原生工程。
import {spawnSync} from "node:child_process";
import {copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {androidStageFiles} from "./android-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(args, env = process.env) {
    const options = {
        harmonyDir: env.SIYUAN_HARMONY_DIR || path.resolve(repoRoot, "..", "siyuan-harmony"),
        deveco: env.DEVECO_STUDIO_HOME || "D:/Program Files/Huawei/DevEco Studio",
        hdc: env.HDC || "",
        device: "",
        wslDistro: "",
        wslUser: "",
        skipUi: false,
        skipKernel: false,
        skipHvigor: false,
    };
    const values = {"harmony-dir": "harmonyDir", deveco: "deveco", hdc: "hdc", device: "device",
        "wsl-distro": "wslDistro", "wsl-user": "wslUser"};
    const flags = {"--skip-ui": "skipUi", "--skip-kernel": "skipKernel", "--skip-hvigor": "skipHvigor"};
    for (const arg of args) {
        if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else if (flags[arg]) {
            options[flags[arg]] = true;
        } else {
            const match = /^--([^=]+)=(.+)$/.exec(arg);
            if (!match || !values[match[1]]) throw new Error(`Unknown or empty argument: ${arg}`);
            options[values[match[1]]] = match[2];
        }
    }
    options.harmonyDir = path.resolve(options.harmonyDir);
    options.deveco = path.resolve(options.deveco);
    return options;
}

export function selectDevice(output, requested = "") {
    const devices = [...new Set(output.split(/\r?\n/).map(line => line.trim())
        .filter(line => line && line !== "[Empty]"))];
    if (requested && devices.includes(requested)) return requested;
    if (!requested && devices.length === 1) return devices[0];
    throw new Error(requested ? `Device ${requested} not found: ${devices.join(", ") || "none"}` :
        `Expected one HDC device, found ${devices.join(", ") || "none"}. Connect a device or use --device=<connect-key>`);
}

function requireFile(file) {
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
        throw new Error(`Missing or empty file: ${file}`);
    }
    return file;
}

function removeTemp(directory) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())) {
        throw new Error(`Unexpected temporary path: ${directory}`);
    }
    rmSync(directory, {recursive: true, force: true});
}

export function checkKernel(file) {
    const header = readFileSync(requireFile(file));
    if (header.length < 20 || header.toString("hex", 0, 6) !== "7f454c460201" || header.readUInt16LE(18) !== 183) {
        throw new Error(`Expected an ARM64 ELF kernel: ${file}`);
    }
}

export function translateWorkspace(workspace, directory, translate) {
    const localPath = value => translate(path.resolve(directory, value));
    const lines = [`go ${workspace.Go}`];
    if (workspace.Toolchain) lines.push(`toolchain ${workspace.Toolchain}`);
    for (const item of workspace.Godebug || []) lines.push(`godebug ${item.Key}=${item.Value}`);
    for (const item of workspace.Use || []) lines.push(`use ${JSON.stringify(localPath(item.DiskPath))}`);
    for (const item of workspace.Replace || []) {
        const before = item.Old.Path + (item.Old.Version ? ` ${item.Old.Version}` : "");
        const after = item.New.Version ? `${item.New.Path} ${item.New.Version}` : JSON.stringify(localPath(item.New.Path));
        lines.push(`replace ${before} => ${after}`);
    }
    return lines.join("\n") + "\n";
}

export function createBuildEnvironment(deveco, node, inherited = process.env, platform = process.platform) {
    const paths = platform === "win32" ? path.win32 : path.posix;
    const env = {...inherited, DEVECO_SDK_HOME: paths.join(deveco, "sdk"), JAVA_HOME: paths.join(deveco, "jbr")};
    // Windows 环境键不区分大小写，普通对象须合并 Path 和 PATH，避免丢失系统命令搜索路径。
    const keys = Object.keys(env).filter(key => platform === "win32" ? key.toLowerCase() === "path" : key === "PATH");
    const directories = [paths.dirname(node), ...new Set(keys.map(key => env[key]).filter(Boolean))];
    for (const key of keys) delete env[key];
    env.PATH = directories.join(paths.delimiter);
    return env;
}

export function main(args = process.argv.slice(2), execute = spawnSync, root = repoRoot) {
    const options = parseArgs(args);
    if (options.help) {
        console.log(`Usage: node scripts/harmony-dev-run.mjs [options]
  --harmony-dir=<path>  Native project (default: ../siyuan-harmony; SIYUAN_HARMONY_DIR)
  --deveco=<path>       DevEco Studio directory (DEVECO_STUDIO_HOME)
  --hdc=<path>          HDC executable (HDC, bundled SDK, or PATH)
  --device=<key>        HDC connect key; required when multiple devices are connected
  --wsl-distro=<name>   WSL distribution for kernel compilation on Windows
  --wsl-user=<name>     WSL user (default: distribution default user)
  --skip-ui            Reuse existing stage/build/{mobile,desktop,export}
  --skip-kernel        Copy existing kernel/harmony/libkernel.so and libkernel.h
  --skip-hvigor        Only reinstall and launch the existing signed debug HAP
  -h, --help           Show help

Builds product=debug, buildMode=debug for ARM64 devices. Configure the debug
signing profile in DevEco Studio for your device first. Uses build.sh and its
Linux SDK / Python 3.10+ (see .github/CONTRIBUTING.md); Windows uses WSL
against this checkout. Existing OCR native libraries and models are required.
Windows go.work paths are translated in a temporary workspace, preserving local modules.
The selected Go toolchain is copied and patched in the Linux user cache for Harmony.
No uninstall is attempted if installation fails.`);
        return;
    }
    const app = path.join(root, "app");
    const native = options.harmonyDir;
    requireFile(path.join(native, "AppScope/app.json5"));
    const run = (command, argv, settings = {}) => {
        console.log(`> ${command} ${argv.join(" ")}`);
        const result = execute(command, argv, {cwd: root, env: process.env, encoding: "utf8",
            stdio: ["inherit", "pipe", "pipe"], windowsHide: true, ...settings});
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.error || result.status !== 0) {
            throw new Error(`${command} failed: ${result.error?.message || result.signal || result.status}`);
        }
        return result.stdout || "";
    };
    const sdkHdc = path.join(options.deveco, "sdk/default/openharmony/toolchains", process.platform === "win32" ? "hdc.exe" : "hdc");
    const hdc = options.hdc || (existsSync(sdkHdc) ? sdkHdc : "hdc");
    // 先确认设备，避免构建结束后才发现目标未连接或存在歧义。
    const serial = selectDevice(run(hdc, ["list", "targets"]), options.device);
    const hap = path.join(native, "entry/build/debug/outputs/default/entry-default-signed.hap");
    if (!options.skipHvigor) {
        const node = requireFile(path.join(options.deveco, "tools/node", process.platform === "win32" ? "node.exe" : "bin/node"));
        const hvigor = requireFile(path.join(options.deveco, "tools/hvigor/bin/hvigorw.js"));
        const ohpm = requireFile(path.join(options.deveco, "tools/ohpm/bin/pm-cli.js"));
        const env = createBuildEnvironment(options.deveco, node);
        if (!options.skipUi) {
            // 使用现有开发资源目录，不运行会清空整个 stage 的总构建命令。
            if (process.platform === "win32") {
                run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pnpm run build:mobile"], {cwd: app, stdio: "inherit"});
            } else {
                run("pnpm", ["run", "build:mobile"], {cwd: app, stdio: "inherit"});
            }
        }
        const stageFiles = androidStageFiles(path.join(app, "stage"))
            .filter(name => !name.startsWith("stage/ocr/runtime/"));
        for (const kind of ["det", "rec"]) {
            requireFile(path.join(app, `stage/ocr/models/tiny/${kind}/inference.onnx`));
        }
        const temp = mkdtempSync(path.join(os.tmpdir(), "siyuan-harmony-assets-"));
        try {
            const list = path.join(temp, "files.txt");
            writeFileSync(list, stageFiles.join("\n") + "\n", "utf8");
            const zip = path.join(temp, "app.zip");
            // 与 Android 开发脚本一致，使用支持 ZIP 的 bsdtar，文件列表避免命令行超长。
            run("tar", ["-a", "-cf", zip, "-C", app, "-T", list, "appearance", "guide", "changelogs",
                "-C", root, "LICENSE", "THIRD_PARTY_NOTICES.md"], {stdio: "inherit"});
            copyFileSync(requireFile(zip), path.join(native, "entry/src/main/resources/rawfile/app.zip"));
        } finally {
            removeTemp(temp);
        }
        const kernel = path.join(root, "kernel/harmony");
        if (!options.skipKernel) {
            if (process.platform === "win32") {
                const wsl = [];
                if (options.wslDistro) wsl.push("--distribution", options.wslDistro);
                if (options.wslUser) wsl.push("--user", options.wslUser);
                // WSL 的 Windows 侧诊断使用不同于 Linux 输出的编码，直接交给终端显示。
                const translate = value => run("wsl.exe", [...wsl, "--exec", "wslpath", "-a", "-u", value], {
                    stdio: ["inherit", "pipe", "inherit"],
                }).trim();
                const linuxPath = translate(kernel);
                const workspace = run("go", ["env", "GOWORK"], {cwd: kernel}).trim();
                const workTemp = mkdtempSync(path.join(os.tmpdir(), "siyuan-harmony-work-"));
                try {
                    let gowork = "off";
                    if (workspace && workspace !== "off") {
                        const config = JSON.parse(run("go", ["work", "edit", "-json", workspace], {cwd: kernel}));
                        const workFile = path.join(workTemp, "go.work");
                        writeFileSync(workFile, translateWorkspace(config, path.dirname(workspace), translate), "utf8");
                        if (existsSync(workspace + ".sum")) copyFileSync(workspace + ".sum", workFile + ".sum");
                        gowork = translate(workFile);
                    }
                    // 去掉检出脚本的 CRLF，使用临时工作区保留本地依赖，不更改原始工作区文件。
                    run("wsl.exe", [...wsl, "--cd", linuxPath, "--exec", "env", `GOWORK=${gowork}`,
                        "bash", "-e", "-o", "pipefail", "-c", "sed 's/\\r$//' ../../scripts/harmony-kernel-build.sh | bash -e -s -- ../../scripts/harmony-kernel-build.sh"], {stdio: "inherit"});
                } finally {
                    removeTemp(workTemp);
                }
            } else {
                run("bash", ["-e", path.join(root, "scripts/harmony-kernel-build.sh")], {cwd: kernel, stdio: "inherit"});
            }
        }
        checkKernel(path.join(kernel, "libkernel.so"));
        copyFileSync(path.join(kernel, "libkernel.so"), path.join(native, "entry/libs/arm64-v8a/libkernel.so"));
        copyFileSync(requireFile(path.join(kernel, "libkernel.h")), path.join(native, "entry/src/main/cpp/include/libkernel.h"));
        requireFile(path.join(native, "entry/libs/arm64-v8a/libonnxruntime.so"));
        const hvigorArgs = ["--mode", "module", "-p", "product=debug", "-p", "buildMode=debug",
            "-p", "module=entry@default", "--no-daemon"];
        run(node, [ohpm, "install", "--all"], {cwd: native, env, stdio: "inherit"});
        // 清理原生中间库和旧签名包，避免复用上次的内核或安装过期 HAP。
        run(node, [hvigor, ...hvigorArgs, "clean"], {cwd: native, env, stdio: "inherit"});
        rmSync(hap, {force: true});
        run(node, [hvigor, ...hvigorArgs, "assembleHap"], {cwd: native, env, stdio: "inherit"});
    }
    requireFile(hap);
    // HDC 部分版本在设备操作失败时仍返回零状态，必须同时核对成功回执。
    const installed = run(hdc, ["-t", serial, "install", "-r", hap]);
    if (!/install bundle successfully/i.test(installed)) {
        throw new Error("HDC did not confirm installation. Check the signing profile and device authorization above");
    }
    const launched = run(hdc, ["-t", serial, "shell", "aa", "start", "-b", "org.b3log.siyuan.ho.debug",
        "-a", "EntryAbility", "-m", "entry"]);
    if (!/start ability successfully/i.test(launched)) throw new Error("HDC did not confirm ability startup");
    console.log("Harmony debug app installed and started");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        main();
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exitCode = 1;
    }
}
