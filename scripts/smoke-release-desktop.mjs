import {execFileSync, spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {once} from "node:events";
import {createReadStream, createWriteStream} from "node:fs";
import {access, copyFile, mkdir, mkdtemp, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {homedir} from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {pathToFileURL} from "node:url";

const targets = {
    windows: {platform: "win32", arch: "x64", suffix: "-win.exe"},
    macos: {platform: "darwin", arch: "arm64", suffix: "-mac-arm64.dmg"},
    linux: {platform: "linux", arch: "x64", suffix: "-linux.deb"},
};

const run = (file, args, options = {}) => execFileSync(file, args, {
    timeout: 240000, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...options,
});

async function install(target, asset, scratch) {
    const installDir = path.join(scratch, "installed");
    await mkdir(installDir);
    if (target === "windows") {
        // NSIS 的 /D 参数必须位于末尾，且路径两侧不能加引号。
        run("pwsh", ["-NoProfile", "-Command",
            "$process = Start-Process -FilePath $env:SMOKE_INSTALLER -ArgumentList @('/S', ('/D=' + $env:SMOKE_INSTALL_DIR)) -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode"],
        {env: {...process.env, SMOKE_INSTALLER: asset, SMOKE_INSTALL_DIR: installDir}});
        return path.join(installDir, "SiYuan.exe");
    }
    if (target === "macos") {
        const mount = path.join(scratch, "disk");
        await mkdir(mount);
        run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, asset]);
        try {
            const appDir = path.join(installDir, "SiYuan.app");
            run("ditto", [path.join(mount, "SiYuan.app"), appDir]);
            return path.join(appDir, "Contents", "MacOS", "SiYuan");
        } finally {
            run("hdiutil", ["detach", mount]);
        }
    }
    run("sudo", ["apt-get", "install", "-y", asset]);
    const name = run("dpkg-deb", ["--field", asset, "Package"]).trim();
    const executable = run("dpkg-query", ["-L", name]).split("\n")
        .find(file => /^\/opt\/.+\/siyuan$/.test(file));
    if (!executable) throw new Error("Executable missing from the installed package");
    return executable;
}

async function findPort() {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const {port} = server.address();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}

function devToolsRequest(endpoint, method, params) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(endpoint);
        const timer = setTimeout(() => finish(new Error("DevTools response timed out")), 2500);
        function finish(error, value) {
            clearTimeout(timer);
            socket.close();
            if (error) reject(error);
            else resolve(value);
        }
        socket.addEventListener("open", () => socket.send(JSON.stringify({
            id: 1,
            method,
            params,
        })), {once: true});
        socket.addEventListener("message", event => {
            const response = JSON.parse(event.data);
            if (response.id === 1) finish(response.error && new Error(response.error.message), response.result);
        });
        socket.addEventListener("error", () => finish(new Error("DevTools connection failed")), {once: true});
        socket.addEventListener("close", () => finish(new Error("DevTools connection closed")), {once: true});
    });
}

async function inspectStartup(endpoint) {
    const result = await devToolsRequest(endpoint, "Runtime.evaluate", {returnByValue: true, expression: `({
        state: document.documentElement?.dataset.startupState,
        visible: document.visibilityState === "visible",
        detail: document.querySelector(".startup-error__details")?.textContent
    })`});
    return result?.result?.value;
}

export async function waitForStartup({port, failure, timeout = 120000, interval = 500, inspect = inspectStartup}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const error = failure();
        if (error) throw error;
        const pages = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)})
            .then(response => response.json()).catch(() => []);
        for (const page of pages) {
            if (page.type !== "page" || !/^https?:\/\/127\.0\.0\.1:\d+\/stage\/build\/app(?:\/|$)/.test(page.url)) {
                continue;
            }
            if (!page.webSocketDebuggerUrl?.startsWith(`ws://127.0.0.1:${port}/devtools/page/`)) continue;
            const startup = await inspect(page.webSocketDebuggerUrl).catch(() => undefined);
            if (startup?.state === "failed") throw new Error(startup.detail || "Frontend reported a startup failure");
            if (startup?.state === "ready" && startup.visible) return;
        }
        await delay(interval);
    }
    throw new Error("The installed application did not reach a visible, ready main window");
}

async function digest(file) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
}

async function main() {
    const [target, source, version, resultsPath] = process.argv.slice(2);
    const config = targets[target];
    if (!config || !source || !resultsPath || !/^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/.test(version)) {
        throw new Error("Usage: node scripts/smoke-release-desktop.mjs windows|macos|linux ARTIFACT_DIR VERSION RESULTS_DIR");
    }
    if (process.env.RUNNER_ENVIRONMENT !== "github-hosted" || !process.env.RUNNER_TEMP ||
        process.platform !== config.platform || process.arch !== config.arch) {
        throw new Error("The requested installer requires a disposable GitHub-hosted runner of the matching architecture");
    }
    const filename = `siyuan-${version}${config.suffix}`;
    const asset = path.resolve(source, filename);
    const sha256 = await digest(asset);
    const results = path.resolve(resultsPath);
    await mkdir(results, {recursive: true});
    const scratch = await mkdtemp(path.join(process.env.RUNNER_TEMP, "siyuan-release-smoke-"));
    const workspace = path.join(scratch, "workspace");
    const confDir = path.join(homedir(), ".config", "siyuan");
    await mkdir(workspace);
    await mkdir(confDir, {recursive: true});
    // 安装包从指定的空工作空间启动，跳过需要操作系统目录对话框的欢迎页。
    await writeFile(path.join(confDir, "workspace.json"), JSON.stringify([workspace]), {flag: "wx"});
    console.log(`Installing ${filename} (${sha256})`);
    const executable = await install(target, asset, scratch);
    await access(executable);
    const port = await findPort();
    const log = createWriteStream(path.join(results, "application.log"));
    const args = [`--workspace=${workspace}`, `--remote-debugging-port=${port}`];
    const app = target === "linux" ? spawn("xvfb-run", ["-a", executable, ...args], {detached: true})
        : spawn(executable, args, {windowsHide: true, detached: process.platform !== "win32"});
    let launchError;
    app.on("error", error => { launchError = error; });
    app.stdout.pipe(log, {end: false});
    app.stderr.pipe(log, {end: false});
    const failure = () => launchError || ((app.exitCode !== null || app.signalCode !== null)
        ? new Error(`Application exited before startup: ${app.exitCode ?? app.signalCode}`) : undefined);
    let mainPage;
    try {
        await waitForStartup({port, failure, inspect: endpoint => {
            mainPage = endpoint;
            return inspectStartup(endpoint);
        }});
        if (await digest(asset) !== sha256) throw new Error("Installer changed during startup verification");
        await writeFile(path.join(results, `${target}.json`), JSON.stringify({filename, sha256, status: "PASS"}) + "\n", {flag: "wx"});
        console.log(`Main window ready for ${filename}`);
    } catch (error) {
        if (mainPage) {
            try {
                const screenshot = await devToolsRequest(mainPage, "Page.captureScreenshot", {format: "png"});
                await writeFile(path.join(results, "startup-failure.png"), Buffer.from(screenshot.data, "base64"));
            } catch {
                // 页面或进程已经退出时，保留原始启动错误和日志。
            }
        }
        throw error;
    } finally {
        if (app.pid && app.exitCode === null && app.signalCode === null) {
            try {
                if (target === "windows") run("taskkill", ["/PID", String(app.pid), "/T", "/F"], {timeout: 10000});
                else process.kill(-app.pid, "SIGTERM");
            } catch (error) {
                console.error("Application cleanup:", error.message);
            }
        }
        log.end();
        for (const [file, name] of [
            [path.join(confDir, "app.log"), "main-process.log"],
            [path.join(workspace, "temp", "siyuan.log"), "kernel.log"],
        ]) {
            await copyFile(file, path.join(results, name)).catch(() => {});
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
