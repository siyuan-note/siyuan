const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 500, height: 400,
            webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
        try {
            win.webContents.on("console-message", event => { if (event.level === "error") console.error(event.message); });
            await win.loadURL("about:blank");
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Page.enable");
            for (const page of ["electron/boot.html", "appearance/boot/index.html"]) {
                for (const [index, name] of ["original", "left", "inward", "right"].entries()) {
                    const script = `let calls = 0; Math.random = () => calls++ === 0 ? ${index / 4 + 0.01} : 0.5;
                        window.fetch = () => new Promise(() => {});
                        window.sources = [];
                        window.EventSource = class { constructor() { window.sources.push(this); } close() {} };`;
                    const injection = await win.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {source: script});
                    win.webContents.setUserAgent(page.startsWith("appearance/") ? "Mozilla/5.0 Chrome/130.0" : "Mozilla/5.0 Electron/44.0");
                    await win.loadFile(path.join(__dirname, "..", page), {query: {v: "test", lang: "en"}});
                    await new Promise(resolve => setTimeout(resolve, 160));
                    const result = await win.webContents.executeJavaScript(`(() => {
                        const svg = document.querySelector("#bg svg");
                        const lines = [...svg.querySelectorAll(".streak")];
                        const samples = lines.map(line => ({x: +line.getAttribute("x2"),
                            delay: parseFloat(line.style.getPropertyValue("--fall-delay")),
                            angle: parseFloat(line.style.getPropertyValue("--fall-end"))})).sort((a, b) => a.x - b.x);
                        const animations = svg.getAnimations({subtree: true});
                        const maskCount = svg.querySelectorAll(".boot-reveal").length;
                        const started = svg.classList.contains("started");
                        if (window.sources.length) window.sources[window.sources.length - 1].onmessage({data: JSON.stringify({progress:100,details:"ready"})});
                        const accelerated = animations.length > 0 && animations.every(a => a.playbackRate > 1);
                        animations.forEach(a => a.finish());
                        return {variant: svg.dataset.bootVariant, count: lines.length, maskCount, started, accelerated,
                            finalOpacity: getComputedStyle(svg.querySelector(".logo path")).opacity,
                            finalMask: svg.querySelector(".boot-reveal-base") && getComputedStyle(svg.querySelector(".boot-reveal-base")).opacity,
                            samples: [samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]]};
                    })()`);
                    assert.equal(result.variant, name, page);
                    assert.equal(result.count, 128, `${page}/${name}`);
                    assert.equal(result.started, true, `${page}/${name}`);
                    assert.equal(result.finalOpacity, "1", `${page}/${name}`);
                    assert.equal(result.accelerated, true, `${page}/${name}: fast completion`);
                    if (name !== "original") {
                        assert.equal(result.maskCount, 128, `${page}/${name}`);
                        assert.equal(result.finalMask, "1", `${page}/${name}`);
                        const [left, middle, right] = result.samples;
                        if (name === "left") assert.ok(left.delay < right.delay && left.angle === 90 && right.angle === 90);
                        if (name === "right") assert.ok(left.delay > right.delay && left.angle === -90 && right.angle === -90);
                        if (name === "inward") assert.ok(left.delay < middle.delay && right.delay < middle.delay && left.angle === 90 && right.angle === -90);
                    }
                    await win.webContents.debugger.sendCommand("Page.removeScriptToEvaluateOnNewDocument", {identifier: injection.identifier});
                }
            }
            console.log("Boot animation variants and fast completion passed");
            win.destroy(); app.exit(0);
        } catch (error) {
            console.error(error); win.destroy(); app.exit(1);
        }
    }).catch(error => { console.error(error); app.exit(1); });
} else {
    require("node:test").test("boot pages select all four animations and finish them when startup completes", {timeout: 60000}, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-boot-variants-"));
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Boot animation variants and fast completion passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
