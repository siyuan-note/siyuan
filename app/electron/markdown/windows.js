const fs = require("node:fs/promises");
const {watch} = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {MarkdownDesktopHost} = require("./host");
const {MarkdownResources, inside} = require("./resources");
const {createMarkdownPreferences, defaults} = require("./preferences");
const {importMarkdownImage, imageExtensions} = require("./imageImport");
const {parseMarkdownLaunch} = require("./launch");
const {MarkdownTree, treeFailure} = require("./tree");
const {createMarkdownTreeView} = require("./treeView");

const scheme = "siyuan-markdown";
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "font-src 'self' data:; connect-src 'self'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const staticTypes = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json"};
const hostMethods = new Set(["read", "write", "reconcileWrite", "reserveSaveAs", "prepareSaveAs", "commitSaveAs",
    "releaseSaveAs", "putDraft", "clearDraft", "releaseSession"]);
const statuses = new Set(["view", "draft", "dirty", "saving", "saved", "conflict", "blocked", "closed"]);

const registerMarkdownSchemes = protocol => protocol.registerSchemesAsPrivileged([
    {scheme, privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true}},
]);
const trustedEvent = (event, record) => {
    if (!record || record.window.isDestroyed() || event.sender !== record.window.webContents ||
        !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    try {
        const url = new URL(event.senderFrame.url);
        return url.protocol === scheme + ":" && url.hostname === record.containerId && url.pathname === "/index.html";
    } catch {
        return false;
    }
};

const createMarkdownWindows = ({app, BrowserWindow, ipcMain, dialog, shell, rootDirectory, configDirectory,
    lang, platform = process.platform, nativeTheme, onEmpty, host: injectedHost}) => {
    const directory = path.join(rootDirectory, "stage", "build", "markdown");
    const host = injectedHost || new MarkdownDesktopHost({directory: path.join(configDirectory, "recovery")});
    const preferences = createMarkdownPreferences(configDirectory);
    const treeView = createMarkdownTreeView(configDirectory);
    const records = new Map();
    const byContents = new Map();
    const recoverTasks = new Map();
    const pendingOpens = new Set();
    let quitting = false;
    let languages;
    let language;
    const owner = sessionId => [...records.values()].find(record => record.sessionId === sessionId || record.candidate?.initial.sessionId === sessionId);
    const loadLanguages = async () => {
        if (languages) return;
        const selected = (typeof lang === "function" ? lang() : lang) || app.getLocale();
        const available = new Set((await fs.readdir(path.join(rootDirectory, "appearance", "langs"))).filter(name => name.endsWith(".json")).map(name => name.slice(0, -5)));
        language = available.has(selected) ? selected : available.has(selected.split("-")[0]) ? selected.split("-")[0] : "en";
        languages = JSON.parse(await fs.readFile(path.join(rootDirectory, "appearance", "langs", language + ".json"), "utf8"));
    };
    const text = key => languages?.[key] || key;
    const focus = record => {
        if (!record || record.window.isDestroyed()) return;
        if (record.window.isMinimized()) record.window.restore();
        record.window.show();
        record.window.focus();
    };
    const notify = (record, type, extra = {}) => {
        if (!record.window.isDestroyed() && !record.crashed) record.window.webContents.send("siyuan-markdown:command", {id: randomUUID(), type, ...extra});
    };
    const closeCrashed = async record => {
        if (record.crashApproved) return true;
        await host.recovery.list();
        const decision = await dialog.showMessageBox(record.window, {type: "warning", title: text("markdownEditor"),
            message: text("markdownLoadError"), detail: text("markdownPrivacy"),
            buttons: [text("markdownKeepDraft"), text("cancel")], defaultId: 1, cancelId: 1, noLink: true});
        if (decision.response !== 0) return false;
        const session = host.sessions.get(record.sessionId);
        if (session) {
            await Promise.allSettled([...session.operations.values()].map(value => value.promise).filter(Boolean)
                .concat([...session.draftTasks], [...session.readTasks], [...session.commits.values()].map(value => value.promise)));
            try { await host.releaseSession({sessionId: record.sessionId, targetGeneration: session.generation}); } catch { /* 未决句柄保留至进程退出，正文和意图留在恢复存储。 */ }
        }
        record.crashApproved = true;
        return true;
    };
    const command = async (record, type) => {
        if (record.imageTask) await record.imageTask.catch(() => undefined);
        if (record.treeTask) await record.treeTask.catch(() => undefined);
        return new Promise(resolve => {
        if (record.window.isDestroyed()) return resolve(true);
        if (record.crashed) {
            closeCrashed(record).then(resolve, () => resolve(false));
            return;
        }
        const id = randomUUID();
        const timeout = setTimeout(() => { record.pending.delete(id); resolve(false); }, 30000);
        record.pending.set(id, value => { clearTimeout(timeout); resolve(value); });
        record.window.webContents.send("siyuan-markdown:command", {id, type});
        });
    };
    const failure = async (record, error) => {
        await loadLanguages();
        const key = {permission: "markdownPermissionDenied", readonly: "markdownReadOnly", offline: "markdownFileOffline",
            unavailable: "markdownFileUnavailable", deleted: "markdownFileDeleted", "identity-changed": "markdownFileReplaced",
            encoding: "agentSkillEncodingTip", size: "markdownTooLarge", space: "markdownNoSpace"}[error?.code] || "markdownError";
        await dialog.showMessageBox(record?.window, {type: "error", title: text("markdownEditor"),
            message: text(key), buttons: [text("confirm")], noLink: true});
    };
    const closeApproved = record => new Promise(resolve => {
        if (record.window.isDestroyed()) return resolve(true);
        const closed = () => { clearTimeout(timeout); Promise.resolve(record.cleanup).then(() => resolve(true)); };
        const timeout = setTimeout(() => {
            record.window.removeListener("closed", closed);
            record.approved = false;
            resolve(false);
        }, 30000);
        record.window.once("closed", closed);
        record.approved = true;
        record.window.close();
    });
    const currentTarget = record => {
        const session = host.sessions.get(record.sessionId);
        if (!session?.target) return undefined;
        return host.disk.registry.get(record.sessionId, session.target.handle);
    };
    const bootstrap = async initial => {
        let values;
        try { values = await preferences.read(); } catch { values = {...defaults}; }
        return {...initial, preferences: values, languages, lang: language, platform,
            dark: nativeTheme?.shouldUseDarkColors ?? false};
    };
    const cancelCandidate = async (record, ticket) => {
        if (record.treeTask) await record.treeTask.catch(() => undefined);
        const candidate = record.candidate;
        if (!candidate || (ticket && candidate.ticket !== ticket)) return;
        if (!candidate.cancelling) {
            candidate.cancelling = host.releaseSession({sessionId: candidate.initial.sessionId, targetGeneration: 0});
        }
        try {
            await candidate.cancelling;
            if (record.candidate === candidate) record.candidate = undefined;
            if (record.followTreePending && !record.window.isDestroyed()) {
                record.followTreePending = false;
                await followTreeTarget(record);
            }
        } catch (error) { candidate.cancelling = undefined; throw error; }
    };
    const followTreeTarget = async record => {
        const entry = currentTarget(record);
        if (!entry || (record.tree.root && inside(record.tree.root.path, entry.descriptor.path))) return;
        // 关闭旧文档期间的另存为不得把已准备的树内切换带离其根目录。
        if (record.candidate) { record.followTreePending = true; return; }
        try {
            await record.tree.setRoot(path.dirname(entry.descriptor.selection));
            record.treeError = undefined;
        } catch (error) { record.treeError = treeFailure(error); }
        notify(record, "tree-change");
    };
    const updateWatch = record => {
        record.watcher?.close();
        record.watcher = undefined;
        clearTimeout(record.watchTimer);
        const entry = currentTarget(record);
        const currentDocument = record.current;
        if (!entry) return;
        try {
            record.watcher = watch(path.dirname(entry.descriptor.selection), (_event, filename) => {
                if (filename && String(filename).toLowerCase() !== path.basename(entry.descriptor.selection).toLowerCase()) return;
                clearTimeout(record.watchTimer);
                record.watchTimer = setTimeout(async () => {
                    if (!records.has(record.containerId) || record.current !== currentDocument) return;
                    try {
                        const current = await host.disk.snapshot(entry.descriptor);
                        if (current.baseline === entry.descriptor.baseline) return;
                    } catch { /* 删除、权限或身份变化也需要通知前端停止写回。 */ }
                    if (record.current === currentDocument) notify(record, "external-change");
                }, 150);
            });
            record.watcher.on("error", () => { if (record.current === currentDocument) notify(record, "external-change"); });
        } catch {
            // 无法观察的文件仍在每次聚焦和写入前核验版本。
        }
    };
    const readProtocol = async (record, request) => {
        const headers = {"Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"};
        try {
            const url = new URL(request.url);
            if (request.method !== "GET" || url.protocol !== scheme + ":" || url.hostname !== record.containerId) return new Response(null, {status: 403});
            if (url.pathname.startsWith("/resource/")) {
                const current = record.current;
                const resource = await current.resources.read(url.pathname.slice("/resource/".length));
                if (record.current !== current) return new Response(null, {status: 404});
                return resource ? new Response(resource.bytes, {headers: {...headers, "Content-Type": resource.type}}) : new Response(null, {status: 404});
            }
            const root = await fs.realpath(directory);
            const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
            if (!inside(root, file)) return new Response(null, {status: 403});
            const canonical = await fs.realpath(file);
            if (!inside(root, canonical) || !(await fs.stat(canonical)).isFile()) return new Response(null, {status: 403});
            return new Response(await fs.readFile(canonical), {headers: {...headers, "Content-Type": staticTypes[path.extname(canonical)] || "application/octet-stream"}});
        } catch {
            return new Response(null, {status: 404});
        }
    };
    const openDocument = async (filePath, restored) => {
        if (quitting) {
            if (restored) await host.releaseSession({sessionId: restored.sessionId, targetGeneration: restored.recovered?.targetGeneration ?? 0});
            return;
        }
        await loadLanguages();
        try {
            await fs.access(path.join(directory, "index.html"));
        } catch {
            await dialog.showMessageBox({type: "error", title: text("markdownEditor"), message: text("markdownLoadError"), buttons: [text("confirm")]});
            return;
        }
        if (quitting) return;
        let initial = restored;
        if (!initial) {
            const sessionId = host.createSession();
            initial = {sessionId, content: ""};
            if (filePath) {
                const result = await host.authorizeOpen(sessionId, filePath);
                if (result.kind !== "opened") {
                    await host.releaseSession({sessionId, targetGeneration: 0});
                    if (result.kind === "occupied" && owner(result.sessionId)) focus(owner(result.sessionId));
                    else await failure(undefined, result.error);
                    return;
                }
                initial = {sessionId, content: result.content, target: result.target};
            }
        }
        const sessionId = initial.sessionId;
        if (quitting) {
            await host.releaseSession({sessionId, targetGeneration: initial.recovered?.targetGeneration ?? 0});
            return;
        }
        const window = new BrowserWindow({width: 1000, height: 760, minWidth: 380, minHeight: 300,
            title: text("markdownEditor"), show: false, autoHideMenuBar: true,
            backgroundColor: nativeTheme?.shouldUseDarkColors ? "#1e1e1e" : "#fff",
            webPreferences: {preload: path.join(__dirname, "preload.js"), partition: "siyuan-markdown-" + sessionId,
                sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
                allowRunningInsecureContent: false, webviewTag: false, spellcheck: true}});
        window.webContents.__siyuanMarkdown = true;
        window.setMenu?.(null);
        const record = {window, containerId: sessionId,
            current: {sessionId, initial, resources: new MarkdownResources(sessionId), epoch: 0}, pending: new Map(), approved: false};
        Object.defineProperties(record, {
            sessionId: {get: () => record.current.sessionId}, initial: {get: () => record.current.initial},
            resources: {get: () => record.current.resources},
        });
        record.tree = new MarkdownTree({view: treeView, notify: () => notify(record, "tree-change")});
        const contentsId = window.webContents.id;
        records.set(sessionId, record);
        byContents.set(window.webContents.id, record);
        const browsing = window.webContents.session;
        browsing.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        browsing.setPermissionCheckHandler(() => false);
        browsing.webRequest.onBeforeRequest((details, callback) => {
            try {
                const url = new URL(details.url);
                callback({cancel: !(url.protocol === scheme + ":" && url.hostname === sessionId) && url.protocol !== "devtools:"});
            } catch {
                callback({cancel: true});
            }
        });
        browsing.protocol.handle(scheme, request => readProtocol(record, request));
        window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
        window.webContents.on("will-navigate", event => event.preventDefault());
        window.webContents.on("will-attach-webview", event => event.preventDefault());
        window.webContents.on("will-frame-navigate", event => event.preventDefault());
        window.on("close", event => {
            if (record.approved) return;
            event.preventDefault();
            if (record.closing) return;
            record.closing = true;
            command(record, "close").then(accepted => {
                record.closing = false;
                if (accepted && (!host.sessions.has(record.sessionId) || record.crashed) && !window.isDestroyed()) {
                    cancelCandidate(record).then(() => { record.approved = true; window.close(); }, () => notify(record, "cancel-quit"));
                }
                else if (!accepted) notify(record, "cancel-quit");
            });
        });
        window.on("closed", () => {
            record.watcher?.close();
            clearTimeout(record.watchTimer);
            for (const finish of record.pending.values()) finish(false);
            record.pending.clear();
            record.resources.clear();
            record.tree.close();
            const orphan = host.sessions.get(record.sessionId);
            if (orphan) orphan.crashed = true;
            const cleanup = (async () => {
                await cancelCandidate(record);
                if (!orphan) return;
                await Promise.allSettled([...orphan.operations.values()].map(value => value.promise).filter(Boolean)
                    .concat([...orphan.draftTasks], [...orphan.readTasks], [...orphan.commits.values()].map(value => value.promise)));
                // 原生窗口销毁后只释放已结算句柄；未决写入继续保留占用和恢复记录。
                await host.releaseSession({sessionId: record.sessionId, targetGeneration: orphan.generation});
            })().catch(() => undefined);
            record.cleanup = cleanup;
            pendingOpens.add(cleanup);
            cleanup.finally(() => { pendingOpens.delete(cleanup); if (!records.size) onEmpty?.(); });
            records.delete(record.containerId);
            byContents.delete(contentsId);
            browsing.protocol.unhandle(scheme);
        });
        window.on("focus", () => { notify(record, "external-change"); notify(record, "tree-change"); });
        const rendererUnavailable = () => {
            // 正文持续写入私有草稿；崩溃后不释放可能仍在写入的句柄，也不影响其他窗口。
            record.crashed = true;
            const session = host.sessions.get(record.sessionId);
            if (session) session.crashed = true;
            record.pending.forEach(finish => finish(false));
            record.pending.clear();
        };
        window.webContents.on("render-process-gone", () => {
            rendererUnavailable();
            failure(record).catch(() => undefined);
        });
        window.once("ready-to-show", () => window.show());
        updateWatch(record);
        await followTreeTarget(record);
        try {
            await window.loadURL(`${scheme}://${sessionId}/index.html`);
        } catch {
            // A failed page cannot acknowledge close commands. Retain its recovery state and
            // use the same native close protection as a terminated renderer.
            rendererUnavailable();
            focus(record);
            await dialog.showMessageBox(window, {type: "error", title: text("markdownEditor"),
                message: text("markdownLoadError"), buttons: [text("confirm")], noLink: true});
        }
        return window;
    };
    const open = (...args) => {
        const task = openDocument(...args);
        pendingOpens.add(task);
        task.then(() => pendingOpens.delete(task), () => pendingOpens.delete(task));
        return task;
    };
    const recover = (id, parent) => {
        if (recoverTasks.has(id)) return recoverTasks.get(id);
        const task = host.restoreRecovery(id).then(initial => open(undefined, initial)).catch(() => failure(parent))
            .finally(() => recoverTasks.delete(id));
        recoverTasks.set(id, task);
        return task;
    };
    const messageBox = async (record, message, buttons) => (await dialog.showMessageBox(record.window,
        {type: "question", title: text("markdownEditor"), message, buttons, cancelId: buttons.length - 1, defaultId: buttons.length - 1, noLink: true})).response;
    const prepareTreeOpen = (record, location) => {
        if (quitting || record.closing || record.crashed || record.treeTask || record.imageTask || record.candidate) {
            return {kind: "blocked", error: {code: "unavailable", recoverable: true}};
        }
        const current = record.current;
        let candidateSession;
        const task = (async () => {
            try {
                const node = await record.tree.file(location);
                if (currentTarget(record)?.descriptor.path === node.path) return {kind: "current"};
                if (quitting || record.closing || record.current !== current || record.window.isDestroyed()) throw new Error("Markdown switch cancelled");
                candidateSession = host.createSession();
                const opened = await host.authorizeOpen(candidateSession, node.selection);
                if (opened.kind === "occupied") {
                    if (opened.sessionId === current.sessionId) return {kind: "current"};
                    focus(owner(opened.sessionId));
                    return {kind: "occupied"};
                }
                if (opened.kind !== "opened") return opened;
                await record.tree.file(location);
                const initial = {sessionId: candidateSession, content: opened.content, target: opened.target};
                const value = await bootstrap(initial);
                if (quitting || record.closing || record.crashed || record.current !== current || record.window.isDestroyed()) throw new Error("Markdown switch cancelled");
                const ticket = randomUUID();
                record.candidate = {ticket, initial, bootstrap: value, current};
                candidateSession = undefined;
                return {kind: "ready", ticket, sessionId: initial.sessionId};
            } catch (error) { return {kind: "blocked", error: treeFailure(error)}; }
            finally {
                if (candidateSession) await host.releaseSession({sessionId: candidateSession, targetGeneration: 0});
            }
        })();
        record.treeTask = task;
        task.finally(() => { if (record.treeTask === task) record.treeTask = undefined; }).catch(() => undefined);
        return task;
    };
    const commitTreeOpen = (record, ticket) => {
        if (typeof ticket !== "string") throw new Error("Invalid Markdown switch ticket");
        if (record.committedSwitch?.ticket === ticket) return record.committedSwitch.bootstrap;
        const candidate = record.candidate;
        if (!candidate || candidate.cancelling || candidate.ticket !== ticket || candidate.current !== record.current ||
            host.sessions.has(record.sessionId) || !host.sessions.has(candidate.initial.sessionId) || record.crashed) {
            throw new Error("Markdown previous session is not released");
        }
        record.resources.clear();
        record.current = {sessionId: candidate.initial.sessionId, initial: candidate.initial,
            resources: new MarkdownResources(record.containerId), epoch: record.current.epoch + 1};
        record.candidate = undefined;
        record.followTreePending = false;
        record.committedSwitch = {ticket, bootstrap: candidate.bootstrap};
        record.state = undefined;
        record.crashApproved = false;
        updateWatch(record);
        notify(record, "tree-change");
        return candidate.bootstrap;
    };
    ipcMain.handle("siyuan-markdown:request", async (event, action, payload) => {
        const record = byContents.get(event.sender.id);
        if (!trustedEvent(event, record) || typeof action !== "string") throw new Error("Markdown request rejected");
        const current = record.current;
        const stillCurrent = () => record.current === current && !record.window.isDestroyed() && !record.crashed;
        if (action.startsWith("host:")) {
            const method = action.slice(5);
            if (!hostMethods.has(method) || !payload || typeof payload !== "object") throw new Error("Markdown request rejected");
            const request = {...payload};
            if (request.operation) request.operation = {...request.operation};
            const operation = request.operation || request;
            if (operation.sessionId !== record.sessionId) throw new Error("Markdown request rejected");
            const result = await host[method](request);
            if (method === "commitSaveAs" && result.kind === "committed" && stillCurrent()) {
                record.resources.clear();
                updateWatch(record);
                await followTreeTarget(record);
            }
            return result;
        }
        switch (action) {
            case "bootstrap": {
                return bootstrap(record.initial);
            }
            case "tree-state": {
                if (record.treeError) return {kind: "blocked", generation: record.tree.generation, expanded: [],
                    width: record.tree.width, visible: record.tree.visible, error: record.treeError};
                return record.tree.state(currentTarget(record)?.descriptor.path);
            }
            case "tree-list": return record.tree.list(payload);
            case "tree-save-view": return record.tree.saveView(payload);
            case "tree-prepare-open": return prepareTreeOpen(record, payload);
            case "tree-commit-open": return commitTreeOpen(record, payload);
            case "tree-cancel-open": {
                if (typeof payload !== "string") throw new Error("Invalid Markdown switch ticket");
                await cancelCandidate(record, payload);
                return;
            }
            case "tree-choose-root": {
                if (quitting || record.treeTask || record.candidate || record.closing) return {kind: "blocked",
                    generation: record.tree.generation, expanded: [], width: record.tree.width, visible: record.tree.visible,
                    error: {code: "unavailable", recoverable: true}};
                const task = (async () => {
                    const chosen = await dialog.showOpenDialog(record.window, {title: text("markdownOpenFolder"), properties: ["openDirectory"]});
                    if (chosen.canceled || !chosen.filePaths[0]) return {kind: "cancelled"};
                    if (!stillCurrent() || quitting || record.closing) return {kind: "cancelled"};
                    try {
                        await record.tree.setRoot(chosen.filePaths[0]);
                        record.treeError = undefined;
                    } catch (error) { record.treeError = treeFailure(error); }
                    notify(record, "tree-change");
                    if (record.treeError) return {kind: "blocked", generation: record.tree.generation, expanded: [],
                        width: record.tree.width, visible: record.tree.visible, error: record.treeError};
                    return record.tree.state(currentTarget(record)?.descriptor.path);
                })();
                record.treeTask = task;
                try { return await task; } finally { if (record.treeTask === task) record.treeTask = undefined; }
            }
            case "new": await open(); return;
            case "open": {
                const chosen = await dialog.showOpenDialog(record.window, {properties: ["openFile", "multiSelections"],
                    filters: [{name: "Markdown", extensions: ["md", "markdown"]}]});
                if (!chosen.canceled) for (const file of chosen.filePaths) await open(file);
                return;
            }
            case "drop": {
                if (!Array.isArray(payload) || payload.length > 32 || payload.some(file => typeof file !== "string" || !path.isAbsolute(file))) throw new Error("Invalid Markdown drop");
                for (const file of payload) await open(file);
                return;
            }
            case "save-as": {
                const entry = currentTarget(record);
                const chosen = await dialog.showSaveDialog(record.window, {defaultPath: entry?.descriptor.selection || text("untitled") + ".md",
                    filters: [{name: "Markdown", extensions: ["md", "markdown"]}]});
                if (chosen.canceled || !chosen.filePath) return {kind: "cancelled"};
                if (!stillCurrent()) return {kind: "cancelled"};
                const result = await host.authorizeSaveAs(current.sessionId, chosen.filePath, payload);
                if (result.kind === "occupied") { focus(owner(result.sessionId)); return {kind: "occupied"}; }
                if (result.kind === "blocked") await failure(record, result.error);
                return result.kind === "reserved" ? {kind: "selected", target: result.target} : {kind: "blocked"};
            }
            case "cancel-save-as": host.cancelAuthorizedSaveAs(record.sessionId, payload); return;
            case "authorize-resources": {
                const chosen = await dialog.showOpenDialog(record.window, {title: text("markdownResources"), properties: ["openDirectory"]});
                if (chosen.canceled || !chosen.filePaths[0]) return false;
                if (!stillCurrent()) return false;
                await current.resources.authorizeDirectory(chosen.filePaths[0]);
                return stillCurrent();
            }
            case "insert-image": {
                if (quitting || record.imageTask || !currentTarget(record)) return {kind: "blocked"};
                const entry = currentTarget(record);
                const generation = host.session(record.sessionId).generation;
                const valid = () => stillCurrent() &&
                    host.sessions.get(record.sessionId)?.generation === generation && currentTarget(record) === entry;
                const task = (async () => {
                    const chosen = await dialog.showOpenDialog(record.window, {title: text("insertImage"), properties: ["openFile"],
                        filters: [{name: text("image"), extensions: [...imageExtensions].map(extension => extension.slice(1))}]});
                    if (chosen.canceled || !chosen.filePaths[0]) return {kind: "cancelled"};
                    if (!valid()) return {kind: "blocked"};
                    const source = chosen.filePaths[0];
                    const extension = path.extname(source);
                    const destination = await dialog.showSaveDialog(record.window, {title: text("saveAs"),
                        defaultPath: path.join(path.dirname(entry.descriptor.path), path.basename(source, extension) + "-copy" + extension),
                        filters: [{name: text("image"), extensions: [extension.slice(1)]}]});
                    if (destination.canceled || !destination.filePath) return {kind: "cancelled"};
                    if (!valid()) return {kind: "blocked"};
                    const result = await importMarkdownImage({source, destination: destination.filePath, targetPath: entry.descriptor.path});
                    if (result.kind !== "imported" || !valid()) return {kind: "blocked"};
                    await record.resources.authorizeFile(destination.filePath);
                    return {kind: "inserted", reference: result.reference};
                })();
                record.imageTask = task;
                try { return await task; } finally { record.imageTask = undefined; }
            }
            case "resource": {
                const resolved = await current.resources.resolve(payload, currentTarget(record)?.descriptor.path);
                return stillCurrent() ? resolved : undefined;
            }
            case "link": {
                if (typeof payload !== "string" || payload.length > 8192) throw new Error("Invalid Markdown link");
                const url = new URL(payload);
                if (!["https:", "http:", "mailto:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid Markdown link");
                await shell.openExternal(url.href);
                return;
            }
            case "preferences": {
                if (!payload || Object.keys(payload).some(key => !["mode", "theme", "fontSize"].includes(key))) throw new Error("Invalid Markdown preferences");
                return preferences.update(payload);
            }
            case "confirm": {
                const key = {reload: "markdownReloadConfirm", overwrite: "markdownOverwriteConfirm", "save-as": "markdownRelativeLinks"}[payload];
                if (!key) return false;
                return await messageBox(record, text(key), [text("confirm"), text("cancel")]) === 0;
            }
            case "confirm-close": {
                const choice = await messageBox(record, text("markdownCloseDraft"), [text("markdownKeepDraft"), text("saveAs"), text("cancel")]);
                return ["keep", "save-as", "cancel"][choice] || "cancel";
            }
            case "recoveries": {
                const result = await host.listRecoveries();
                if (result.errors.length) await dialog.showMessageBox(record.window, {type: "warning", title: text("markdownRecovery"),
                    message: text("markdownCorruptRecovery"), buttons: [text("confirm")], noLink: true});
                return result.records.map(item => ({id: item.watermark.sessionId, updatedAt: item.updatedAt,
                    displayName: item.draft?.target?.displayName || item.intent?.operation.target.displayName || text("untitled")}));
            }
            case "recover": await recover(payload, record); return;
            case "discard-recovery": {
                if (await messageBox(record, text("discardUnsavedChanges"), [text("confirmDelete"), text("cancel")]) === 0) await host.discardRecovery(payload);
                return;
            }
            case "state": {
                if (!payload || payload.sessionId !== record.sessionId || !statuses.has(payload.status) || !Number.isSafeInteger(payload.revision)) return;
                record.state = payload;
                const name = currentTarget(record)?.descriptor.selection;
                const dirty = payload.revision > payload.savedRevision;
                record.window.setTitle((dirty ? "* " : "") + (name ? path.basename(name) : text("untitled")) + " - " + text("markdownEditor"));
                record.window.setDocumentEdited?.(dirty);
                return;
            }
            case "response": {
                if (typeof payload?.id !== "string" || typeof payload.accepted !== "boolean") return;
                const finish = record.pending.get(payload.id);
                if (finish) { record.pending.delete(payload.id); finish(payload.accepted); }
                return;
            }
            default: throw new Error("Markdown request rejected");
        }
    });
    nativeTheme?.on("updated", () => records.forEach(record => notify(record, "theme", {dark: nativeTheme.shouldUseDarkColors})));
    return {
        open,
        hasWindows: () => records.size > 0,
        hasPendingWork: () => records.size > 0 || pendingOpens.size > 0 || recoverTasks.size > 0,
        owns: contents => byContents.has(contents.id),
        focus: () => focus([...records.values()][0]),
        async handleLaunch(argv, cwd) {
            const launch = parseMarkdownLaunch(argv, cwd);
            if (!launch.requested) return false;
            for (const file of launch.files) await open(file);
            if (launch.newDocument) await open();
            return true;
        },
        async prepareQuit() {
            quitting = true;
            await Promise.allSettled([...pendingOpens, ...recoverTasks.values()]);
            for (const record of records.values()) {
                if (!await command(record, "prepare-quit")) {
                    quitting = false;
                    records.forEach(item => notify(item, "cancel-quit"));
                    return false;
                }
            }
            return true;
        },
        cancelQuit() {
            quitting = false;
            records.forEach(record => { record.crashApproved = false; notify(record, "cancel-quit"); });
        },
        async closeAll() {
            quitting = true;
            await Promise.allSettled([...pendingOpens, ...recoverTasks.values()]);
            for (const record of [...records.values()]) {
                if (!await command(record, "close") || (!record.crashed && host.sessions.has(record.sessionId))) {
                    quitting = false;
                    records.forEach(item => notify(item, "cancel-quit"));
                    return false;
                }
                await cancelCandidate(record);
                if (!await closeApproved(record)) {
                    quitting = false;
                    records.forEach(item => notify(item, "cancel-quit"));
                    return false;
                }
            }
            return true;
        },
    };
};

module.exports = {createMarkdownWindows, registerMarkdownSchemes, trustedEvent};
