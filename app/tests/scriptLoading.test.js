const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async sources => {
    const check = require("node:assert/strict");
    const load = (code, modules = {}) => {
        const exports = {};
        new Function("require", "exports", code)(name => modules[name], exports);
        return exports;
    };
    const loader = load(sources.loader);
    const {ensureLute} = load(sources.lute, {
        "./addScript": loader,
        "../../constants": {Constants: {PROTYLE_CDN: "/stage/protyle", SIYUAN_VERSION: "test"}},
    });
    check.equal(typeof window.Lute, "undefined");
    await loader.addScriptSync("/stage/protyle/js/protyle-html.js", "protyleWcHtmlScript");
    check.equal(typeof window.Lute, "undefined");
    check.ok(customElements.get("protyle-html"));
    check.equal(window.DOMPurify.sanitize('<img src="x" onerror="alert(1)"><script>alert(1)</script>'), '<img src="x">');
    const first = ensureLute();
    const second = ensureLute();
    check.equal(document.querySelectorAll("#protyleLuteScript").length, 1);
    await Promise.all([first, second]);
    const script = document.getElementById("protyleLuteScript");
    check.ok(script.src.endsWith("/stage/protyle/js/lute/lute.min.js?v=test"));
    check.equal(script.textContent, "");
    check.equal(window.Lute.EscapeHTMLStr('<input value="&">'), "&lt;input value=&quot;&amp;&quot;&gt;");
    check.match(window.Lute.New().Md2HTML("**preview**"), /<strong>preview<\/strong>/);
    check.equal(await loader.addScriptSync("/missing.js", "failedScript"), false);
    check.equal(document.getElementById("failedScript"), null);
    check.equal(await loader.addScriptSync("/retry.js", "failedScript"), true);
    check.equal(window.scriptRetried, true);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    const http = require("node:http");
    const ts = require("typescript");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const requests = new Map();
        const server = http.createServer((request, response) => {
            const pathname = new URL(request.url, "http://localhost").pathname;
            requests.set(pathname, (requests.get(pathname) || 0) + 1);
            if (pathname.startsWith("/stage/protyle/")) {
                response.setHeader("Content-Type", "text/javascript; charset=utf-8");
                const content = fs.readFileSync(path.join(__dirname, "..", pathname));
                setTimeout(() => response.end(content), 30);
            } else if (pathname === "/retry.js") {
                response.setHeader("Content-Type", "text/javascript; charset=utf-8");
                response.end("window.scriptRetried = true;");
            } else if (pathname === "/missing.js") {
                response.writeHead(404);
                response.end();
            } else {
                response.setHeader("Content-Type", "text/html; charset=utf-8");
                response.end("<html><head></head><body></body></html>");
            }
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let exitCode = 0;
        try {
            const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/protyle/util", file), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText;
            await win.loadURL("http://127.0.0.1:" + server.address().port);
            await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify({loader: compile("addScript.ts"), lute: compile("lute.ts")})})`);
            assert.equal(requests.get("/stage/protyle/js/lute/lute.min.js"), 1);
            assert.equal(requests.get("/stage/protyle/js/protyle-html.js"), 1);
        } catch (error) {
            console.error(error);
            exitCode = 1;
        } finally {
            win.destroy();
            server.close();
            app.exit(exitCode);
        }
    }).catch(error => {
        console.error(error);
        app.exit(1);
    });
} else {
    require("node:test").test("external scripts initialize the sanitizer and Lute in Electron and retry failed loads", {
        timeout: 45000,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-script-loading-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await require("node:util").promisify(require("node:child_process").execFile)(require("electron"),
                [__filename, profile], {env, windowsHide: true, timeout: 40000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
