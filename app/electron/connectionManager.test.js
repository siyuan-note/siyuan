const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("connection manager UI, authentication, cancellation and session migration", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-connections-ui-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, timeout: 60000, windowsHide: true,
            });
            assert.match(stdout, /Connection manager passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
        }
    });
} else {
    const {app, BrowserWindow, ipcMain, session, net} = require("electron");
    const {EventEmitter} = require("node:events");
    const {createConnectionManager, getRemoteSession} = require("./connectionManager");
    const {readConnections} = require("./connectionStore");
    const profile = process.argv[2];
    app.setPath("userData", profile);
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
        const origin = "https://example.com";
        let authenticated = false;
        let serverVersion = "1.0.0";
        let slow = false;
        let lastSignal;
        const requests = [];
        const restarts = [];
        let handler;
        let dialogHost;
        const handle = ipcMain.handle.bind(ipcMain);
        ipcMain.handle = (name, callback) => {
            if (name === "siyuan-connections") {
                handler = callback;
            }
            handle(name, callback);
        };
        net.request = () => {
            const request = new EventEmitter();
            request.abort = () => {};
            request.end = () => setImmediate(() => {
                const response = new EventEmitter();
                response.statusCode = authenticated ? 200 : 401;
                request.emit("response", response);
            });
            return request;
        };
        const remoteSession = getRemoteSession({origin});
        remoteSession.fetch = async (url, options) => {
            requests.push({url, options});
            assert.equal(options.redirect, "manual");
            assert.equal(options.bypassCustomProtocolHandlers, true);
            lastSignal = options.signal;
            if (slow) {
                await new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("Canceled"))));
            }
            if (url.endsWith("/api/system/version")) {
                return Response.json({code: 0, data: serverVersion});
            }
            if (url.endsWith("/api/system/loginAuth")) {
                authenticated = JSON.parse(options.body).authCode === "valid";
                if (authenticated) {
                    await remoteSession.cookies.set({url: origin, name: "auth", value: "secret-session", secure: true});
                }
                return Response.json({code: authenticated ? 0 : 1, msg: authenticated ? "" : "Invalid code"});
            }
            return new Response(Buffer.from("image"));
        };
        try {
            await session.defaultSession.cookies.set({url: origin, name: "legacy", value: "retained", secure: true});
            const manager = createConnectionManager({confDir: profile, languageDir: path.join(__dirname, "../appearance/langs"),
                version: "1.0.0", currentTarget: () => ({origin}), log: () => {},
                isTrustedDialogSender: event => dialogHost && event.sender === dialogHost.webContents &&
                    event.senderFrame === dialogHost.webContents.mainFrame && event.senderFrame.url.startsWith("data:text/html,"),
                restart: target => restarts.push(target), showWindow: false});
            await manager.prepareSession({origin});
            assert.equal((await remoteSession.cookies.get({url: origin}))[0].value, "retained");
            await remoteSession.cookies.remove(origin, "legacy");
            await manager.prepareSession({origin});
            assert.equal((await remoteSession.cookies.get({url: origin})).length, 0);
            assert.notEqual(remoteSession, getRemoteSession({origin: "https://example.com:8443"}));
            assert.match((await handler({sender: {}}, {cmd: "init"})).error, /sender/);
            const id = manager.show({lang: "zh-CN"});
            const window = BrowserWindow.fromId(id);
            await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
            const evaluate = code => window.webContents.executeJavaScript(code);
            await evaluate(`new Promise(resolve => {
                const ready = () => document.getElementById("title").textContent ? resolve() : setTimeout(ready, 20);
                ready();
            })`);
            const invoke = data => evaluate(`require("electron").ipcRenderer.invoke("siyuan-connections", ${JSON.stringify(data)})`);
            assert.equal(await evaluate('document.querySelectorAll("#min, #close, .drag").length'), 3);
            assert.equal(await evaluate('document.querySelectorAll("#local, #localDefault").length'), 0);
            fs.writeFileSync(path.join(profile, "workspace.json"), JSON.stringify(["D:/local-workspace"]));
            assert.deepEqual((await invoke({cmd: "init"})).entries, []);
            assert.ok(await evaluate('document.getElementById("restartTip").textContent.length > 10'));
            fs.writeFileSync(path.join(os.tmpdir(), "siyuan-connections-preview.png"), (await window.webContents.capturePage()).toPNG());
            assert.match((await invoke({cmd: "open", origin})).error, /./);
            serverVersion = "2.0.0";
            assert.ok((await invoke({cmd: "check", origin})).error);
            serverVersion = "1.0.0";
            await evaluate('document.getElementById("connectionForm").requestSubmit()');
            await evaluate(`new Promise(resolve => {
                const ready = () => !document.getElementById("auth").hidden && !document.getElementById("connect").disabled
                    ? resolve() : setTimeout(ready, 20);
                ready();
            })`);
            assert.equal(await evaluate('document.getElementById("auth").hidden'), false);
            fs.writeFileSync(path.join(os.tmpdir(), "siyuan-connections-auth-preview.png"), (await window.webContents.capturePage()).toPNG());
            assert.equal((await invoke({cmd: "check", origin})).authenticated, false);
            assert.ok((await invoke({cmd: "open", origin})).error);
            assert.equal((await invoke({cmd: "login", origin, authCode: "bad"})).captcha, true);
            assert.equal((await invoke({cmd: "login", origin, authCode: "valid", rememberMe: true})).authenticated, true);
            assert.deepEqual(await invoke({cmd: "open", origin}), {});
            assert.equal(restarts[0].origin, origin);
            if (restarts[0].sessionHandoff) {
                const token = restarts[0].sessionHandoff;
                const handoff = path.join(profile, "connection-session-" + token + ".bin");
                assert.equal(fs.readFileSync(handoff).includes(Buffer.from("secret-session")), false);
                await assert.rejects(manager.restoreSession({origin: "https://other.example"}, token));
                assert.ok(fs.existsSync(handoff));
                await remoteSession.cookies.remove(origin, "auth");
                await manager.restoreSession({origin}, token);
                assert.equal((await remoteSession.cookies.get({url: origin}))[0].value, "secret-session");
                assert.equal(fs.existsSync(handoff), false);
            }
            assert.deepEqual(readConnections(path.join(profile, "connections.json")).origins, [origin]);
            assert.ok((await invoke({cmd: "remove", origin})).entries);
            assert.deepEqual(readConnections(path.join(profile, "connections.json")).origins, []);
            slow = true;
            const pending = invoke({cmd: "check", origin});
            await new Promise(resolve => setTimeout(resolve, 50));
            await invoke({cmd: "cancel"});
            assert.equal(lastSignal.aborted, true);
            assert.ok((await pending).error);
            assert.ok((await invoke({cmd: "open", origin})).error);
            assert.ok(requests.every(item => item.url.startsWith(origin + "/api/system/")));
            const otherWindow = new BrowserWindow({show: false});
            const closed = new Promise(resolve => window.once("closed", resolve));
            await handler({sender: window.webContents, senderFrame: window.webContents.mainFrame}, {cmd: "close"});
            await closed;
            assert.equal(window.isDestroyed(), true);
            assert.equal(otherWindow.isDestroyed(), false);
            slow = false;
            authenticated = false;
            dialogHost = new BrowserWindow({show: false, width: 900, height: 700,
                webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
            await dialogHost.loadURL("data:text/html,<html><body></body></html>");
            const runDialog = code => dialogHost.webContents.executeJavaScript(code);
            const ts = require("typescript");
            const compile = name => ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", name), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
            }).outputText;
            const strings = JSON.parse(fs.readFileSync(path.join(__dirname, "../appearance/langs/en.json"), "utf8"));
            await runDialog(`(() => {
                window.siyuan = {languages: ${JSON.stringify(strings)}, config: {lang: "en"}, dialogs: [], zIndex: 1,
                    menus: {menu: {element: document.createElement("div"), remove() {}}}};
                const modules = {
                    electron: require("electron"),
                    "../util/genID": {genUUID: () => "test-dialog"},
                    "./moveResize": {moveResize() {}},
                    "../util/functions": {isMobile: () => false},
                    "../protyle/util/compatibility": {isNotCtrl: event => !event.ctrlKey && !event.metaKey},
                    "../constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
                };
                const load = source => {
                    const exports = {};
                    new Function("require", "exports", source)(name => {
                        if (!(name in modules)) { throw new Error(name); }
                        return modules[name];
                    }, exports);
                    return exports;
                };
                modules["../util/escape"] = load(${JSON.stringify(compile("util/escape.ts"))});
                modules["./index"] = load(${JSON.stringify(compile("dialog/index.ts"))});
                window.openRemoteConnection = load(${JSON.stringify(compile("dialog/remoteConnection.ts"))}).openRemoteConnection;
                window.openRemoteConnection(${JSON.stringify(origin)});
            })()`);
            const waitDialog = condition => runDialog(`new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Dialog timeout")), 5000);
                const ready = () => {
                    if (${condition}) { clearTimeout(timer); resolve(); } else { setTimeout(ready, 20); }
                };
                ready();
            })`);
            await waitDialog('!document.querySelector("[data-field=connect]").disabled');
            assert.equal(await runDialog('document.querySelectorAll(".b3-dialog").length'), 1);
            assert.equal(await runDialog('document.querySelector("[data-field=historySection]").classList.contains("fn__none")'), true);
            if (process.env.SIYUAN_CONNECTION_PREVIEW) {
                const buildDir = path.join(__dirname, "../stage/build/app");
                const index = fs.readFileSync(path.join(buildDir, "index.html"), "utf8");
                const css = index.match(/href="(base\.[^"]+\.css)"/)[1];
                for (const stylesheet of [path.join(buildDir, css), path.join(__dirname, "../appearance/themes/daylight/theme.css")]) {
                    await runDialog(`(() => {
                        const style = document.createElement("style");
                        style.textContent = ${JSON.stringify(fs.readFileSync(stylesheet, "utf8"))};
                        document.head.append(style);
                    })()`);
                }
                assert.equal(await runDialog('getComputedStyle(document.querySelector("[data-field=auth]")).display'), "none");
                await waitDialog('document.querySelector(".b3-dialog--open")');
                await dialogHost.webContents.insertCSS(":root {--b3-font-size:14px;--b3-font-family:Arial,sans-serif} .b3-dialog__container, .b3-dialog__scrim {transition:none}");
                await new Promise(resolve => setTimeout(resolve, 300));
                fs.writeFileSync(path.join(os.tmpdir(), "siyuan-connection-dialog-preview.png"), (await dialogHost.webContents.capturePage()).toPNG());
            }
            const windowCount = BrowserWindow.getAllWindows().length;
            await runDialog('window.openRemoteConnection(); document.querySelector("[data-field=connect]").click()');
            await waitDialog('!document.querySelector("[data-field=auth]").classList.contains("fn__none")');
            assert.equal(BrowserWindow.getAllWindows().length, windowCount);
            assert.equal(await runDialog('document.querySelectorAll(".b3-dialog").length'), 1);
            await waitDialog('!document.querySelector("[data-field=connect]").disabled');
            await runDialog('document.querySelector("[data-field=authCode]").value = "valid"; document.querySelector("[data-field=connect]").click()');
            await waitDialog('!document.querySelector("[data-field=connect]").disabled');
            assert.equal(restarts.length, 2);
            assert.equal(restarts[1].origin, origin);
            assert.ok((await handler({sender: dialogHost.webContents, senderFrame: {}}, {cmd: "init", dialog: true})).error);
            await runDialog('document.querySelector("[data-field=cancel]").click()');
            await waitDialog('!document.querySelector(".b3-dialog")');
            assert.equal(dialogHost.isDestroyed(), false);
            assert.ok((await handler({sender: dialogHost.webContents, senderFrame: dialogHost.webContents.mainFrame}, {cmd: "open", origin})).error);
            dialogHost.destroy();
            otherWindow.destroy();
            console.log("Connection manager passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    }).catch(error => { console.error(error); app.exit(1); });
}
