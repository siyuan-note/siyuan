const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const {pathToFileURL} = require("node:url");
const {createManager} = require("../../../electron/mapUnplaced/manager");
const createTemporaryProfile = () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-unplaced-manual-"));
    return {profile, cleanup() {
        // 只清理本次入口自己生成的临时目录，不删除调用者传入的 profile。
        if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) ||
            !path.basename(profile).startsWith("siyuan-unplaced-manual-")) return;
        try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 100}); }
        catch (_error) { /* 系统文件锁尚未释放时，在退出事件中再次清理。 */ }
    }};
};
const createHarness = async ({profile, automate = false} = {}) => {
    if (typeof profile !== "string" || !path.isAbsolute(profile)) throw new Error("An explicit isolated fixture profile is required");
    const {app, BrowserWindow, WebContentsView, ipcMain, session} = require("electron");
    const {hasUnsafeMapSwitches} = require("../../../electron/mapHostPolicy");
    if (hasUnsafeMapSwitches(app.commandLine)) throw new Error("Unsafe process switches are not supported by this fixture");
    app.setPath("userData", profile);
    await app.whenReady();
    // 样式只编译已有本地共享控件；该入口不生成或修改生产构建文件。
    const sass = require("sass");
    const component = path.resolve(__dirname, "../../../src/assets/scss/component");
    const controls = sass.compileString('@use "../util/reset"; @use "menu"; @use "text-field";', {loadPaths: [component], logger: sass.Logger.silent}).css;
    const ownerURL = pathToFileURL(path.join(__dirname, "owner.html")).href;
    const win = new BrowserWindow({width: 980, height: 760, useContentSize: true, show: true,
        webPreferences: {preload: path.join(__dirname, "owner-preload.cjs"), nodeIntegration: false,
            contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false}});
    const owner = win.webContents;
    const map = new WebContentsView({webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, webviewTag: false, partition: "unplaced-fixture-synthetic-map"}});
    const mapVisible = [];
    const setVisible = map.setVisible.bind(map);
    map.setVisible = value => { mapVisible.push(value); setVisible(value); };
    win.contentView.addChildView(map);
    map.setBounds({x: 30, y: 380, width: 860, height: 250});
    map.setVisible(true);
    await map.webContents.loadURL("data:text/html," + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><body style="background:#cbd7df;font:24px system-ui;padding:30px">Synthetic map placeholder. No OFM or private data.</body>'));
    let allowed = true;
    const events = [];
    const reply = value => { events.push(value); if (!owner.isDestroyed()) owner.send("unplaced-fixture-owner-event", value); };
    const manager = createManager({ipcMain, session, WebContentsView, owner, win, ownerURL,
        outsideContents: [map.webContents], assets: {controls}, mayUse: () => allowed,
        onAction: reply, onClose: value => reply({type: "closed", ...value})});
    const prefix = "unplaced-fixture-owner-";
    const handlers = [];
    ipcMain.handle(prefix + "open", (event, value) => manager.open(event, value));
    for (const [name, fn] of [["update", manager.update], ["anchor", manager.setAnchor], ["theme", manager.setTheme], ["close", manager.close]]) {
        ipcMain.on(prefix + name, fn); handlers.push([prefix + name, fn]);
    }
    const trusted = event => event.sender === owner && event.senderFrame === owner.mainFrame && owner.mainFrame.url === ownerURL;
    const zoom = event => { if (trusted(event)) owner.setZoomFactor(owner.getZoomFactor() === 1 ? 1.25 : 1); };
    const permission = event => { if (trusted(event)) { allowed = !allowed; if (!allowed) manager.revoke(); } };
    ipcMain.on(prefix + "zoom", zoom); handlers.push([prefix + "zoom", zoom]);
    ipcMain.on(prefix + "permission", permission); handlers.push([prefix + "permission", permission]);
    let cleaned = false;
    const destroy = () => {
        if (cleaned) return;
        cleaned = true;
        manager.destroy();
        ipcMain.removeHandler(prefix + "open");
        handlers.forEach(([channel, fn]) => ipcMain.removeListener(channel, fn));
        if (!map.webContents.isDestroyed()) map.webContents.close({waitForBeforeUnload: false});
        if (!win.isDestroyed()) win.destroy();
    };
    win.on("closed", () => { destroy(); if (!automate) app.quit(); });
    await win.loadURL(ownerURL);
    return {win, owner, manager, map, mapVisible, events, destroy};
};
module.exports = {createHarness, createTemporaryProfile};
