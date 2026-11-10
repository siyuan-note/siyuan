const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, protocol, ipcMain} = require("electron");
    app.setPath("userData", path.join(process.argv[2], "profile"));
    protocol.registerSchemesAsPrivileged([{scheme: "siyuan-preview", privileges: {standard: true, secure: true, supportFetchAPI: true}}]);
    app.whenReady().then(async () => {
        let win;
        let code = 0;
        try {
            const root = path.join(process.argv[2], "resources");
            const manifest = new Set(await require("../scripts/quicklook").prepareQuickLookResources(root));
            const requests = [];
            protocol.handle("siyuan-preview", request => {
                requests.push(request.url);
                const url = new URL(request.url);
                let file = url.pathname.slice(1);
                if (file === "vditor/dist/js/lute/lute.min.js") file = "lute.min.js";
                if (url.hostname !== "bundle" || !manifest.has(file)) return new Response("", {status: 403});
                const mime = {html: "text/html", js: "text/javascript", css: "text/css", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf"};
                return new Response(fs.readFileSync(path.join(root, file)), {headers: {"Content-Type": mime[path.extname(file).slice(1)] || "application/octet-stream"}});
            });
            const preload = path.join(process.argv[2], "preload.cjs");
            fs.writeFileSync(preload, 'const {ipcRenderer}=require("electron"); window.webkit={messageHandlers:{preview:{postMessage: value=>ipcRenderer.send("quicklook",value)}}};');
            const messages = [];
            let ready;
            const started = new Promise(resolve => {ready = resolve;});
            ipcMain.on("quicklook", (_event, message) => {messages.push(message); if (message.type === "ready") ready();});
            win = new BrowserWindow({show: false, width: 390, height: 600,
                webPreferences: {preload, contextIsolation: false, sandbox: false, nodeIntegration: false, backgroundThrottling: false}});
            win.webContents.session.webRequest.onBeforeRequest({urls: ["http://*/*", "https://*/*", "file://*/*"]}, (details, callback) => {
                requests.push(details.url); callback({cancel: true});
            });
            await win.loadURL("siyuan-preview://bundle/index.html");
            await started;
            const images = message => win.webContents.executeJavaScript(`window.preview.images(${JSON.stringify(message.id)}, ${JSON.stringify(message.references.map(() => null))})`);
            const text = "# 中文 title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n$E=mc^2$\n\n- [ ] task\n\n![local](image.png)\n![remote](https://example.com/private.png)\n\n<a href=\"javascript:alert(1)\" onclick=\"window.bad=1\">Link</a>\n<script>window.bad=1</script>\n<iframe src=\"https://example.com\"></iframe>\n<img src=x onerror=\"window.bad=1\">\n<div contenteditable=true autofocus tabindex=0>readonly</div>";
            const id = "00000000-0000-0000-0000-000000000001";
            const options = {limit: "Preview limit", resource: "Resource unavailable"};
            const rendered = win.webContents.executeJavaScript(`window.preview.render(${JSON.stringify(id)}, ${JSON.stringify(text)}, ${JSON.stringify(options)})`);
            for (let attempt = 0; !messages.some(message => message.type === "images" && message.id === id); attempt++) {
                assert.ok(attempt < 100, "image discovery must finish");
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            const discovery = messages.find(message => message.type === "images" && message.id === id);
            assert.ok(discovery.references.includes("image.png"));
            assert.ok(!discovery.references.some(reference => reference.startsWith("https:")));
            await images(discovery);
            await rendered;
            assert.ok(messages.some(message => message.type === "rendered" && message.id === id));
            const result = await win.webContents.executeJavaScript(`({html: document.getElementById("content").innerHTML,
                title: document.querySelector("h1")?.textContent, table: !!document.querySelector("table"),
                math: !!document.querySelector(".katex"), code: !!document.querySelector(".hljs"), bad: window.bad,
                unsafe: !!document.querySelector("#content script, #content iframe, #content [onclick], #content [onerror], #content [contenteditable], #content a[href], #content img[src^='http']"),
                checked: document.querySelector("input[type=checkbox]")?.disabled,
                warning: document.getElementById("warning").textContent, width: document.body.scrollWidth, viewport: innerWidth})`);
            assert.equal(result.title, "中文 title");
            assert.equal(result.table, true);
            assert.equal(result.math, true);
            assert.equal(result.code, true);
            assert.equal(result.unsafe, false);
            assert.equal(result.bad, undefined);
            assert.equal(result.checked, true);
            assert.equal(result.warning, options.resource);
            assert.ok(result.width <= result.viewport + 1);
            assert.ok(!requests.some(url => /^(?:https?:|file:)/.test(url)), requests.join("\n"));
            const old = win.webContents.executeJavaScript(`window.preview.render("old", "old ![x](old.png)", ${JSON.stringify(options)})`);
            for (let attempt = 0; !messages.some(message => message.id === "old" && message.type === "images"); attempt++) {
                assert.ok(attempt < 100); await new Promise(resolve => setTimeout(resolve, 20));
            }
            await win.webContents.executeJavaScript("window.preview.cancel()");
            await old;
            await win.webContents.executeJavaScript('window.preview.images("old", [])');
            assert.ok(!messages.some(message => message.id === "old" && message.type === "rendered"));
            assert.equal(await win.webContents.executeJavaScript('document.getElementById("content").textContent'), "");
            await win.webContents.executeJavaScript(`window.preview.render("large", "x".repeat(262145), ${JSON.stringify(options)})`);
            assert.ok(messages.some(message => message.type === "failed" && message.id === "large"));
        } catch (error) { console.error(error); code = 1; }
        finally {win?.destroy(); app.exit(code);}
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("Quick Look renders offline read-only Markdown, rejects active content and ignores cancelled requests", {timeout: 60000}, async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-quicklook-dom-"));
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        try { await promisify(execFile)(require("electron"), [__filename, root], {env, windowsHide: true, timeout: 55000}); }
        finally {
            assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
            fs.rmSync(root, {recursive: true, force: true, maxRetries: 5});
        }
    });
}
