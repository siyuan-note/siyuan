import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {App} from "../../index";

const browserCases = async (sources: Record<string, string>, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const errors: string[] = [];
    window.addEventListener("error", event => errors.push(event.message));
    const taskModule = {exports: {}};
    new Function("exports", sources.installTask)(taskModule.exports);
    const tasks = taskModule.exports as typeof import("./installTask");
    const progressModule = {exports: {}};
    new Function("exports", "updateBazaarInstallProgress", "renderBazaarInstall", sources.progress)(
        progressModule.exports, tasks.updateBazaarInstallProgress, tasks.renderBazaarInstall);
    const progress = progressModule.exports as typeof import("../../dialog/processSystem");
    const mobileModule = {exports: {}};
    new Function("exports", "require", sources.mobile)(mobileModule.exports,
        (name: string) => name === "../../dialog/processSystem" ? progress : {});
    const mobileEvents = mobileModule.exports as typeof import("../../mobile/util/onMessage");
    const requests: {callback: (response: unknown) => void, fail: (response: unknown) => void,
        signal: AbortSignal, resolve: () => void, url: string, data: unknown}[] = [];
    let confirmations = 0;
    let refreshed = 0;
    let failures = 0;
    let mobileFrontend = false;
    const tooltipElement = document.createElement("div");
    tooltipElement.id = "tooltip";
    tooltipElement.className = "tooltip fn__none";
    document.body.append(tooltipElement);
    Object.assign(window, {DOMPurify: {sanitize: (value: string) => value}});
    const tooltipModule = {exports: {}};
    new Function("exports", "require", sources.tooltip)(tooltipModule.exports, (name: string) => {
        if (name === "../util/functions") return {isMobile: () => mobileFrontend};
        if (name === "../util/hoverInput") return {initHoverInput() {}, isTouchHoverInput: () => false};
        if (name === "../plugin/EventBusCore") return {emitToPlugins() {}, forEachPluginSubscriber() {}};
        throw new Error(`Unexpected tooltip dependency: ${name}`);
    });
    (tooltipModule.exports as typeof import("../../dialog/tooltip")).initTooltips();
    const checkTooltip = (element: HTMLElement, message = "") => {
        tooltipElement.className = "tooltip fn__none";
        tooltipElement.textContent = "";
        element.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        check.equal(tooltipElement.classList.contains("fn__none"), mobileFrontend || !message,
            "Progress controls suppress visual tooltips while idle warnings keep their existing behavior");
        if (!mobileFrontend && message) check.equal(tooltipElement.textContent, message);
    };
    Object.assign(window, {siyuan: {languages: {download: "Download", cancel: "Cancel", bazaarInstalling: "Installing...",
        update: "Update", updateAll: "Update all"},
        config: {bazaar: {petalDisabled: false}}}});
    const style = document.createElement("style");
    style.textContent = css + ":root {--b3-theme-primary:#3573f0;--b3-theme-on-primary:#fff;}";
    document.head.append(style);
    const externals = {
        "./installTask": tasks,
        "./packageConfig": {BAZAAR_PACKAGE_CONFIG: {plugins: {tabType: "plugin", api: {install: "/api/bazaar/installBazaarPlugin"}}},
            isBazaarPackageType: (value: string) => value === "plugins", getBazaarTypeByMyType: (): undefined => undefined},
        "./rating": {syncRatingUser: () => false},
        "../../protyle/util/hasClosest": {hasClosestByAttribute: (element: HTMLElement, attribute: string) => element.closest(`[${attribute}]`)},
        "../../util/functions": {getFrontend: () => "browser-mobile"},
        "../../dialog/confirmDialog": {confirmDialog: (title: string, _text: string, confirm: () => void) => {
            if (title.startsWith("⬆️")) {
                confirm();
            } else {
                confirmations++;
            }
        }},
        "../../dialog/message": {showMessage: () => failures++},
        "../../util/fetch": {fetchPost: (url: string, data: unknown, callback: (response: unknown) => void,
            _headers: unknown, fail: (response: unknown) => void, signal: AbortSignal) => new Promise<void>(resolve => {
            requests.push({callback, fail, signal, resolve, url, data});
            signal.addEventListener("abort", () => resolve(), {once: true});
        })},
    };
    const eventModule = {exports: {}};
    new Function("exports", "require", sources.events)(eventModule.exports, (name: string) => externals[name as keyof typeof externals] || {});
    const events = eventModule.exports as typeof import("./events");
    const item = {name: "sample", repoURL: "https://github.com/owner/repo", repoHash: "hash"};
    const updatedItem = {installed: item, available: {...item, repoURL: "https://github.com/new-owner/repo", outdated: true}};
    const otherUpdatedItem = {installed: {...item, name: "other"}, available: {...item, name: "other", repoURL: "https://github.com/owner/other"}};
    const root = document.createElement("div");
    document.body.append(root);
    const mount = {element: root, generation: 1};
    const controller = {
        element: root, _data: {plugins: [item]}, _getPackageDetail: (): undefined => undefined,
        _beginBazaarRequest: () => mount, _isMountCurrent: () => true,
        _onBazaar() {}, _genMyHTML() {}, _refreshReadmeDetail: () => refreshed++,
        _getUpdatedItem: () => updatedItem, _getUpdatedItems: () => [
            {type: "plugins", item: updatedItem}, {type: "plugins", item: otherUpdatedItem},
        ], _checkUpdate() {},
    };
    const render = (mobile: boolean, disabled = false, update = false, icon = false) => {
        root.innerHTML = `<div>
            <div class="config-bazaar__panel" data-type="plugin"><input class="b3-text-field"></div>
            <div id="configBazaarReadme"><div class="item__side" data-name="sample" data-package-type="plugins" data-repourl="${update ? updatedItem.available.repoURL : item.repoURL}"></div>
            <div class="item__actions${mobile ? " item__actions--mobile" : ""}" data-name="sample" data-package-type="plugins" data-from="${update ? "updated" : "bazaar"}">
            ${icon ? '<span data-type="install-t" class="block__icon ariaLabel" aria-label="Update"><svg></svg></span>' :
        `<button class="b3-button ariaLabel" data-type="${update ? "install-t" : "install"}" ${disabled ? 'disabled aria-label="Incompatible package"' : ""}>${update ? "Update" : "Download"}</button>`}
            </div></div><button class="b3-button" data-type="install-all">Update all</button></div>`;
        events.bindBazaarEvents(controller as unknown as Parameters<typeof events.bindBazaarEvents>[0], {} as App, mount);
        tasks.renderBazaarInstall(root);
        return root.querySelector<HTMLElement>(update ? '[data-type="install-t"]' : '[data-type="install"]') as HTMLButtonElement;
    };
    const settle = async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    for (const mobile of [false, true]) {
        mobileFrontend = mobile;
        document.documentElement.style.setProperty("--b3-theme-primary", mobile ? "#375278" : "#3573f0");
        const pushProgress = (percent: number) => {
            const data = {id: item.repoURL, percent};
            if (mobile) {
                mobileEvents.onMessage({} as App, {cmd: "downloadProgress", data} as IWebSocketData);
            } else {
                progress.downloadProgress(data);
            }
        };
        const initialRequests = requests.length;
        let button = render(mobile);
        button.click();
        check.equal(requests.length, initialRequests + 1);
        check.equal(button.textContent, "Cancel 0%", "The first click immediately shows cancellable progress");
        check.equal(button.getAttribute("aria-label"), "Cancel 0%", "Accessible progress labels are retained");
        checkTooltip(button);
        check.equal(button.disabled, false);
        check.equal(tasks.beginBazaarInstall("plugins", item.name, item.repoURL), undefined, "A pending package cannot start again");
        check.equal(tasks.updateBazaarInstallProgress({id: "another", percent: .8}), false);
        pushProgress(.42);
        check.equal(button.textContent, "Cancel 42%");
        check.equal(button.style.getPropertyValue("--b3-progress"), "42%");
        for (const width of [280, 1000]) {
            root.style.width = `${width}px`;
            button.style.fontSize = "24px";
            check.ok(button.getBoundingClientRect().width <= width, "Progress fits a narrow layout and large fonts");
            const progress = getComputedStyle(button, "::before");
            check.equal(progress.pointerEvents, "none");
            check.equal(progress.opacity, "0.2");
            check.equal(getComputedStyle(button).color, "rgb(255, 255, 255)");
        }
        button = render(mobile);
        check.equal(button.textContent, "Cancel 42%", "Remounting keeps the pending state");
        button.click();
        check.equal(requests.at(-1).signal.aborted, true);
        check.equal(button.disabled, true);
        await settle();
        check.equal(button.textContent, "Download");
        check.equal(button.disabled, false);
        check.equal(requests.length, initialRequests + 1, "Cancel does not start another installation");
        check.equal(confirmations, mobile ? 1 : 0);

        button.click();
        check.equal(requests.length, initialRequests + 2, "Cancel permits retry");
        pushProgress(Number.POSITIVE_INFINITY);
        check.equal(button.textContent, "Cancel 0%");
        pushProgress(1);
        check.equal(button.textContent, "Installing...");
        check.equal(button.getAttribute("aria-label"), "Installing...");
        checkTooltip(button);
        check.equal(button.disabled, true, "Installation after downloading is not presented as cancellable");
        tasks.cancelBazaarInstall("plugins", item.name);
        check.equal(requests.at(-1).signal.aborted, false);
        button.click();
        check.equal(requests.length, initialRequests + 2);
        requests.at(-1).callback({code: 0, data: {packages: []}});
        requests.at(-1).resolve();
        await settle();
        check.equal(confirmations, mobile ? 2 : 1, "Successful installation asks to enable the plugin once");
        check.equal(button.textContent, "Download");
        check.equal(button.classList.contains("ariaLabel"), true, "Success restores the original tooltip trigger");

        button.click();
        requests.at(-1).fail({msg: "network"});
        requests.at(-1).resolve();
        await settle();
        check.equal(button.disabled, false, "Network errors release the package lock");
        check.equal(button.textContent, "Download");
        check.equal(button.classList.contains("ariaLabel"), true, "Failure restores the original tooltip trigger");
        check.equal(tasks.getBazaarInstallTask("plugins", item.name), undefined);
    }
    check.equal(refreshed, 6);
    check.equal(failures, 2);
    for (const mobile of [false, true]) {
        mobileFrontend = mobile;
        for (const icon of [false, true]) {
            const initialRequests = requests.length;
            const original = render(mobile, false, true, icon);
            checkTooltip(original, icon ? "Update" : "");
            original.click();
            let button = root.querySelector<HTMLButtonElement>('[data-type="install-t"]');
            check.equal(requests.length, initialRequests + 1);
            check.equal(requests.at(-1).url, "/api/bazaar/updateBazaarPackage");
            check.equal(button.tagName, "BUTTON", "Card icons use a full progress button while updating");
            check.equal(button.textContent, "Cancel 0%");
            checkTooltip(button);
            const data = {id: updatedItem.available.repoURL, percent: .53};
            if (mobile) mobileEvents.onMessage({} as App, {cmd: "downloadProgress", data} as IWebSocketData);
            else progress.downloadProgress(data);
            check.equal(button.textContent, "Cancel 53%", "Updates track the available repository even after a repository move");
            check.equal(button.getAttribute("aria-label"), "Cancel 53%");
            render(mobile, false, true, icon);
            button = root.querySelector<HTMLButtonElement>('[data-type="install-t"]');
            check.equal(button.textContent, "Cancel 53%", "Pending updates survive rerendering");
            button.click();
            await settle();
            check.equal(requests.at(-1).signal.aborted, true);
            check.equal(requests.length, initialRequests + 1);
            const restored = root.querySelector<HTMLElement>('[data-type="install-t"]');
            check.equal(restored.tagName, icon ? "SPAN" : "BUTTON");
            check.equal(restored.hasAttribute("disabled"), false);
            checkTooltip(restored, icon ? "Update" : "");
            const idleHTML = restored.outerHTML;
            progress.downloadProgress({id: updatedItem.available.repoURL, percent: .9});
            check.equal(restored.outerHTML, idleHTML, "Late progress after cancellation cannot overwrite idle update controls");
            restored.click();
            button = root.querySelector<HTMLButtonElement>('[data-type="install-t"]');
            progress.downloadProgress({id: updatedItem.available.repoURL, percent: 1});
            check.equal(button.textContent, "Installing...");
            checkTooltip(button);
            check.equal(button.disabled, true);
            requests.at(-1).callback({code: 0, data: {packages: []}});
            requests.at(-1).resolve();
            await settle();
            check.equal(requests.length, initialRequests + 2);
            check.equal(confirmations, 2, "Updates do not ask to enable an already installed plugin");
        }
        render(mobile, false, true);
        let all = root.querySelector<HTMLButtonElement>('[data-type="install-all"]');
        all.click();
        check.equal(requests.at(-1).url, "/api/bazaar/batchUpdatePackage");
        check.equal(all.textContent, "Cancel 0%");
        checkTooltip(all);
        checkTooltip(root.querySelector('[data-type="install-t"]'));
        check.equal(root.querySelector<HTMLButtonElement>('[data-type="install-t"]').disabled, true);
        progress.downloadProgress({id: updatedItem.available.repoURL, percent: .7});
        check.equal(all.textContent, "Cancel 35%", "Batch progress includes packages still waiting to download");
        render(mobile, false, true);
        all = root.querySelector<HTMLButtonElement>('[data-type="install-all"]');
        check.equal(all.textContent, "Cancel 35%");
        const title = all.parentElement;
        title.classList.add("config-bazaar__title");
        const updateTab = document.createElement("button");
        updateTab.setAttribute("data-type", "myUpdate");
        updateTab.classList.add("b3-button--outline");
        title.append(updateTab);
        all.click();
        await settle();
        check.equal(requests.at(-1).signal.aborted, true);
        check.equal(all.textContent, "Update all");
        check.equal(all.classList.contains("fn__none"), true, "Finishing a batch does not leave Update all visible in another tab");
        check.equal(root.querySelector<HTMLButtonElement>('[data-type="install-t"]').disabled, false);
        all.click();
        requests.at(-1).resolve();
        await settle();
        check.equal(tasks.getBazaarBatchUpdate(), undefined, "A failed batch releases all package locks");
    }
    for (const mobile of [false, true]) {
        mobileFrontend = mobile;
        const pending = tasks.beginBazaarInstall("plugins", item.name, item.repoURL);
        const disabledButton = render(mobile, true);
        check.equal(disabledButton.disabled, false, "An unavailable package can still cancel its pending download");
        checkTooltip(disabledButton);
        tasks.finishBazaarInstall("plugins", item.name, pending);
        tasks.renderBazaarInstall(root);
        check.equal(disabledButton.disabled, true, "Settling an installation preserves the current package availability");
        check.equal(disabledButton.getAttribute("aria-label"), "Incompatible package");
        checkTooltip(disabledButton, "Incompatible package");
    }
    check.deepEqual(errors, []);
    return "Bazaar install interaction cases passed";
};

test("marketplace installation, single update and batch update progress and cancellation on desktop and mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const sources = Object.fromEntries(["installTask", "events"].map(name => [name,
        transpileModule(readFileSync(path.join(__dirname, name + ".ts"), "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText]));
    const systemSource = createSourceFile("processSystem.ts", readFileSync(path.join(__dirname, "../../dialog/processSystem.ts"), "utf8"), ScriptTarget.ES2021, true);
    const progress = systemSource.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(systemSource) === "downloadProgress"));
    sources.progress = transpileModule(progress.getText(systemSource), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    sources.mobile = transpileModule(readFileSync(path.join(__dirname, "../../mobile/util/onMessage.ts"), "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    sources.tooltip = transpileModule(readFileSync(path.join(__dirname, "../../dialog/tooltip.ts"), "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const css = compile(path.join(__dirname, "../../assets/scss/component/_button.scss"), {logger: Logger.silent}).css;
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-bazaar-install-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1000, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Bazaar install interaction cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-bazaar-install-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
