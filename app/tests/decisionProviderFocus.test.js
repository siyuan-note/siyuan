const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sourceModules = [
    "config/tabs/ai/aiDecisionUi", "config/tabs/ai/aiProviderUi", "config/render/fragments", "util/escape",
    "config/tabs/ai/aiModelOrder", "config/tabs/ai/aiProviderHeaders", "config/tabs/ai/aiModelTestResult",
    "config/tabs/ai/aiProviderPresets",
];

const runCases = async (sources, languages, reproduceUnsafeFocus = false) => {
    const assert = require("node:assert/strict");
    const errors = [];
    const onError = event => {
        errors.push(event.error?.stack || event.message || String(event.reason));
        event.preventDefault();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const unexpected = () => { throw new Error("Opening and closing decision profiles must not call an external service"); };
    const mocks = {
        "config/tabs/ai/aiRuntime": {AI_CONFIG_CHANGED_EVENT: "siyuan-ai-config-changed", aiConfigApi: {
            patch: unexpected, waitForSave: async () => true,
        }},
        "dialog/confirmDialog": {confirmDialog: unexpected},
        "dialog/message": {showMessage: unexpected},
        "util/fetch": {fetchPost: unexpected},
        "plugin/Menu": {Menu: unexpected},
        "util/upDownHint": {upDownHint: unexpected},
        "config/tabs/ai/chatGPTAccount": {genChatGPTAccountHTML: unexpected, mountChatGPTAccount: unexpected},
    };
    const loaded = {};
    const load = id => {
        if (id in mocks) { return mocks[id]; }
        if (id in loaded) { return loaded[id]; }
        assert.ok(id in sources, `Missing real UI source: ${id}`);
        const exports = {};
        loaded[id] = exports;
        new Function("require", "exports", sources[id])(relative => {
            const parts = id.split("/").slice(0, -1);
            for (const part of relative.split("/")) {
                if (part === "..") { parts.pop(); }
                else if (part !== ".") { parts.push(part); }
            }
            return load(parts.join("/"));
        }, exports);
        return exports;
    };
    window.siyuan = {languages, config: {ai: {decision: {
        enabled: false, provider: "typesafe", profiles: {
            typesafe: {endpoint: "https://typesafe.example/v1/systemone", apiKey: "", name: "jev-latest", timeout: 30},
            openai: {endpoint: "https://openai.example/v1/decisions", apiKey: "", name: "gpt-6-luna", timeout: 30},
        },
    }}}};
    const ui = load("config/tabs/ai/aiDecisionUi");
    // 复用桌面设置外壳，绝对定位参照是面板而非滚动页，保留真实溢出与动画规则。
    document.body.insertAdjacentHTML("beforeend", `<div class="b3-dialog b3-dialog--open">
    <div class="b3-dialog__container" style="width: max(70vw, min(90vw, 900px)); height: 90vh; max-width: 1280px">
        <div class="fn__flex-1 fn__flex config__panel" style="overflow: hidden; position: relative">
            <div class="config__side b3-list b3-list--background">
                <div class="config__tab-head"><div class="config__tab-title">${languages.config}</div></div>
                <ul class="config__tab-scroll"><li class="b3-list-item"><span class="b3-list-item__text">AI</span></li></ul>
            </div>
            <div class="config__tab-wrap"><div class="config__tab-container" data-name="ai"></div></div>
        </div>
    </div>
</div>`);
    const dialog = document.querySelector(".b3-dialog");
    const panel = dialog.querySelector(".config__panel");
    const root = dialog.querySelector(".config__tab-container");
    const switchHTML = load("config/render/fragments").genSwitchRow("ai.decision.enabled",
        languages.decisionModel, languages.decisionModelTip, false);
    root.innerHTML = `<div class="config-group config-group--first config-group--last">
        <div class="config-title">${languages.decisionModel}</div><div class="config-items">${switchHTML}${ui.genDecisionCardsHtml()}</div>
    </div>`;
    ui.mountDecisionCards(root);
    const decision = window.siyuan.config.ai.decision;
    const preservedConfig = JSON.stringify({provider: decision.provider, profiles: decision.profiles});
    const enabledInput = root.querySelector('[id="ai.decision.enabled"]');
    const enabledRow = enabledInput.closest(".config-item");
    const providerBlock = root.querySelector("#aiDecisionCardsBlock");
    const refreshConfig = enabled => {
        decision.enabled = enabled;
        window.dispatchEvent(new CustomEvent("siyuan-ai-config-changed"));
    };
    assert.equal(getComputedStyle(providerBlock).display, "none", "The entire provider configuration starts hidden while disabled");
    assert.equal(getComputedStyle(enabledRow).borderBottomWidth, "0px", "Disabled lone switch has no trailing separator");
    root.querySelector("[data-decision-provider='typesafe']").click();
    assert.equal(root.querySelector("[data-decision-profile-view]"), null, "Disabled cards cannot open a detail");
    enabledInput.checked = true;
    enabledInput.dispatchEvent(new Event("change", {bubbles: true}));
    assert.notEqual(getComputedStyle(providerBlock).display, "none", "Reuse immediate switch-controlled visibility");
    assert.equal(getComputedStyle(enabledRow).borderBottomWidth, "1px", "Enabling restores the separator above provider settings");
    root.querySelector("[data-decision-provider='typesafe']").click();
    assert.equal(root.querySelector("[data-decision-profile-view]"), null, "Pending enable must not bypass saved configuration");
    refreshConfig(true);
    await wait(0);
    const initialConfig = JSON.stringify(window.siyuan.config);
    assert.equal(getComputedStyle(root).position, "static", "Do not hide the bug with a positioned tab fixture");
    assert.equal(getComputedStyle(panel).overflowX, "hidden");
    const ancestors = element => {
        const result = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) { result.push(parent); }
        return result;
    };
    const describe = element => `${element.tagName}.${element.className}`;
    const visible = (element, label) => {
        assert.ok(element?.isConnected, `${label} is attached`);
        const rect = element.getBoundingClientRect();
        assert.ok(rect.width > 0 && rect.height > 0, `${label} has nonzero size`);
        assert.ok(rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
            `${label} is inside the viewport: ${JSON.stringify(rect.toJSON())}`);
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        assert.ok(hit && (hit === element || element.contains(hit)), `${label} is actually painted and not clipped or covered`);
        for (const ancestor of [element, ...ancestors(element)]) {
            const style = getComputedStyle(ancestor);
            assert.notEqual(style.visibility, "hidden", `${label} is not hidden by ${describe(ancestor)}`);
            assert.ok(Number(style.opacity) > 0, `${label} is not transparent in ${describe(ancestor)}`);
        }
    };
    const nativeFocus = HTMLElement.prototype.focus;
    if (reproduceUnsafeFocus) {
        // 负对照验证真实布局能够检出原有问题，只有该轮移除防滚动参数，正常用例不替换 DOM 聚焦。
        HTMLElement.prototype.focus = function (options) {
            return nativeFocus.call(this, this.matches("[data-decision-field='endpoint']") ? undefined : options);
        };
    }
    try {
        for (const provider of reproduceUnsafeFocus ? ["typesafe"] : ["typesafe", "openai"]) {
            for (let cycle = 0; cycle < (reproduceUnsafeFocus ? 1 : 2); cycle++) {
                const context = `${innerWidth}px ${provider} ${cycle ? "reopen" : "open"}`;
                const card = root.querySelector(`[data-decision-provider='${provider}']`);
                card.scrollIntoView({block: "nearest", inline: "nearest"});
                await wait(30);
                visible(card, `${context} card`);
                const before = new Map(ancestors(card).map(element => [element, element.scrollLeft]));
                const checkScroll = (input, stage) => {
                    for (const element of ancestors(input)) {
                        assert.equal(element.scrollLeft, before.get(element) || 0,
                            `${context} ${stage}: ${describe(element)} must not scroll horizontally`);
                    }
                };
                if (cycle) {
                    card.focus({preventScroll: true});
                    card.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
                } else {
                    card.click();
                }
                assert.deepEqual(errors, [], `${context} opening must not throw`);
                const view = root.querySelector(`[data-decision-profile-view='${provider}']`);
                assert.ok(view, `${context} must create a real detail view`);
                assert.equal(view.offsetParent, panel, "The real desktop panel is the overlay's containing block");
                const input = view.querySelector("[data-decision-field='endpoint']");
                assert.ok(input instanceof HTMLInputElement, "Exercise the actual input, not a missing optional selector");
                assert.equal(document.activeElement, input, `${context} must focus the endpoint`);
                assert.equal(view.querySelectorAll("[data-decision-field]").length, 4);
                assert.equal(view.querySelector(".block__logo span").textContent, languages.apiProvider);
                const content = view.querySelector(".b3-dialog__body > .b3-dialog__content");
                const groups = [...content.children];
                assert.equal(groups.length, 2, "Provider and model settings are separate groups");
                for (const group of groups) {
                    assert.ok(group.classList.contains("config-group"));
                    assert.equal(getComputedStyle(group).marginLeft, "24px");
                    assert.equal(getComputedStyle(group).marginRight, "24px");
                    assert.ok(group.querySelector(":scope > .config-items"), "Reuse the provider detail's grouped surface");
                }
                assert.equal(groups[0].querySelector(":scope > .config-title").textContent, languages.aiProviderSettings);
                assert.equal(groups[1].querySelector(":scope > .config-title").textContent, languages.aiModelSettings);
                assert.deepEqual([...groups[0].querySelectorAll("[data-decision-field]")].map(element => element.dataset.decisionField),
                    ["endpoint", "timeout", "apiKey"]);
                for (const row of groups[0].querySelectorAll(".config-item")) {
                    assert.equal(row.querySelector(".b3-label__text"), null, "Provider rows keep the original compact layout");
                }
                assert.ok(groups[0].textContent.includes(provider === "typesafe" ? "TypeSafe System One" : "OpenAI Decisions API (Beta)"));
                assert.ok(groups[0].textContent.includes(provider === "typesafe" ? languages.decisionEndpointTip : languages.decisionOpenAIEndpointTip));
                const modelRow = groups[1].querySelector(".config-items > .config-ai-provider__model");
                const modelInput = modelRow.querySelector("[data-decision-field='name']");
                const testButton = modelRow.querySelector("[data-action='test']");
                assert.ok(modelInput.classList.contains("fn__flex-1"));
                assert.equal(testButton.querySelector("use").getAttribute("xlink:href"), "#iconPlugZap");
                assert.ok(groups[1].textContent.includes(languages.decisionTestDraftTip));
                assert.ok(groups[1].querySelector("[data-type='testResult'][role='status'][aria-live='polite']"));
                for (const action of ["save", "use"]) {
                    const button = view.querySelector(`.b3-dialog__body > .b3-dialog__action > [data-action='${action}']`);
                    assert.ok(button.classList.contains("b3-button--text"), "Reuse the provider footer button style");
                    assert.equal(button.classList.contains("b3-button--outline"), false);
                }
                assert.ok(getComputedStyle(view).transitionDuration.split(",").some(value => parseFloat(value) > 0),
                    "The regression requires the production entry animation");
                if (reproduceUnsafeFocus) {
                    assert.ok(ancestors(input).some(element => element.scrollLeft !== (before.get(element) || 0)),
                        "Negative control must detect horizontal scrolling when preventScroll is removed");
                    return;
                }
                checkScroll(input, "immediately after click");
                await wait(360);
                checkScroll(input, "after the entry animation");
                const back = view.querySelector("[data-action='back']");
                visible(view, `${context} detail`);
                visible(input, `${context} endpoint`);
                visible(back, `${context} back button`);
                visible(modelInput, `${context} model input`);
                visible(testButton, `${context} inline test button`);
                const modelRect = modelInput.getBoundingClientRect();
                const testRect = testButton.getBoundingClientRect();
                if (matchMedia("(max-width: 750px)").matches) {
                    assert.ok(testRect.top >= modelRect.bottom, "Reuse provider controls' narrow-layout wrapping");
                    assert.ok(Math.abs(testRect.width - modelRect.width) < 1, "Wrapped provider controls fill the same row width");
                } else {
                    assert.ok(testRect.left >= modelRect.right, "Test action sits to the right of the model input");
                    assert.ok(Math.abs(testRect.top + testRect.height / 2 - modelRect.top - modelRect.height / 2) < 1,
                        "Model input and test action remain vertically aligned");
                }
                assert.equal(getComputedStyle(view).opacity, "1");
                assert.deepEqual(errors, [], `${context} animation must not throw`);
                const close = cycle ? back : view.querySelector("[data-action='cancel']");
                close.click();
                await wait(360);
                assert.equal(root.querySelector("[data-decision-profile-view]"), null, `${context} must remove the closed view`);
                assert.equal(document.activeElement, card, `${context} must restore card focus`);
                for (const element of ancestors(card)) {
                    assert.equal(element.scrollLeft, before.get(element), `${context} closing preserves ${describe(element)} scroll`);
                }
                visible(card, `${context} restored card`);
                assert.equal(JSON.stringify(window.siyuan.config), initialConfig, "Opening and cancelling never changes configuration");
            }
        }
        const card = root.querySelector("[data-decision-provider='openai']");
        card.click();
        await wait(360);
        const view = root.querySelector("[data-decision-profile-view='openai']");
        const draftInput = view.querySelector("[data-decision-field='endpoint']");
        const originalEndpoint = draftInput.value;
        draftInput.value = "https://unsaved.example/v1/decisions";
        draftInput.dispatchEvent(new Event("input", {bubbles: true}));
        enabledInput.checked = false;
        enabledInput.dispatchEvent(new Event("change", {bubbles: true}));
        assert.equal(getComputedStyle(providerBlock).display, "none", "Disabling immediately hides all provider content");
        assert.equal(getComputedStyle(view).display, "none", "Disabling also hides an already open detail");
        refreshConfig(false);
        assert.equal(enabledInput.checked, false);
        assert.equal(view.isConnected, true, "An unsaved draft stays mounted while disabled");
        for (const action of ["save", "use", "test"]) {
            const button = view.querySelector(`[data-action='${action}']`);
            assert.equal(button.disabled, true);
            button.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
        await wait(0);
        assert.equal(JSON.stringify({provider: decision.provider, profiles: decision.profiles}), preservedConfig,
            "Disabling never clears saved profiles, credentials, or the active provider");
        const providerViews = load("config/tabs/ai/aiProviderUi");
        const ordinaryView = providerViews.createProviderView(root, languages.apiProvider);
        ordinaryView.querySelector(".b3-dialog__body").textContent = "Ordinary provider settings";
        await wait(360);
        assert.equal(view.isConnected, true, "Opening another provider must not destroy the paused decision draft");
        refreshConfig(true);
        assert.equal(getComputedStyle(view).display, "none", "Resuming enablement must not cover another provider detail");
        providerViews.removeProviderView(root, ordinaryView);
        await wait(360);
        root.querySelector("[data-decision-provider='openai']").click();
        await wait(360);
        assert.equal(root.querySelector("[data-decision-profile-view='openai']"), view, "Enabling resumes the same draft");
        assert.equal(draftInput.value, "https://unsaved.example/v1/decisions");
        assert.notEqual(getComputedStyle(view).display, "none");
        visible(draftInput, "resumed unsaved draft");
        draftInput.value = originalEndpoint;
        draftInput.dispatchEvent(new Event("input", {bubbles: true}));
        view.querySelector("[data-action='cancel']").click();
        await wait(360);
        refreshConfig(false);
        assert.equal(getComputedStyle(providerBlock).display, "none");
        assert.equal(root.querySelector("[data-decision-profile-view]"), null);
        refreshConfig(true);
        assert.equal(JSON.stringify(window.siyuan.config), initialConfig);
        // 原生输入会在目标与祖先监听器间执行微任务，不能只用 dispatchEvent 验证保存顺序。
        const savedSwitches = [];
        let pendingSave = Promise.resolve(true);
        mocks["config/tabs/ai/aiRuntime"].aiConfigApi.waitForSave = () => pendingSave;
        root.addEventListener("change", event => {
            if (event.target !== enabledInput) { return; }
            assert.equal(event.isTrusted, true);
            const enabled = enabledInput.checked;
            savedSwitches.push(enabled);
            pendingSave = wait(20).then(() => { refreshConfig(enabled); return true; });
        });
        for (const enabled of [false, true]) {
            enabledInput.focus({preventScroll: true});
            await require("electron").ipcRenderer.invoke("decision-test-toggle");
            await wait(60);
            assert.equal(enabledInput.checked, enabled, "Native switch input survives delegated save ordering");
            assert.equal(decision.enabled, enabled);
            assert.equal(getComputedStyle(providerBlock).display === "none", !enabled);
            assert.equal(getComputedStyle(enabledRow).borderBottomWidth, enabled ? "1px" : "0px",
                "Native toggles keep the separator consistent with visible rows");
        }
        assert.deepEqual(savedSwitches, [false, true]);
        assert.equal(JSON.stringify(window.siyuan.config), initialConfig);
    } finally {
        HTMLElement.prototype.focus = nativeFocus;
        dialog.remove();
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onError);
        assert.deepEqual(errors, [], "The full open/close flow must not cause JavaScript errors");
    }
};

const runElectron = async () => {
    const {app, BrowserWindow, ipcMain} = require("electron");
    const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");
    const appRoot = path.join(__dirname, "..");
    const sources = Object.fromEntries(sourceModules.map(id => [id, transpileModule(
        fs.readFileSync(path.join(appRoot, "src", `${id}.ts`), "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText]));
    const languages = JSON.parse(fs.readFileSync(path.join(appRoot, "appearance/langs/zh-CN.json"), "utf8"));
    const baseCSS = require("sass").compile(path.join(appRoot, "src/assets/scss/base.scss"), {
        logger: {warn() {}, debug() {}},
    }).css;
    const icons = fs.readFileSync(path.join(appRoot, "appearance/icons/litheness/icon.js"), "utf8");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true,
    }});
    const requests = [];
    ipcMain.handle("decision-test-toggle", event => {
        assert.equal(event.sender, win.webContents);
        win.webContents.sendInputEvent({type: "keyDown", keyCode: "Space"});
        win.webContents.sendInputEvent({type: "keyUp", keyCode: "Space"});
    });
    win.webContents.session.webRequest.onBeforeRequest({urls: ["http://*/*", "https://*/*"]}, (details, callback) => {
        requests.push(details.url);
        callback({cancel: true});
    });
    try {
        for (const [width, height] of [[1100, 844], [390, 844]]) {
            for (const theme of ["daylight", "midnight"]) {
                win.setContentSize(width, height);
                await win.loadURL(`data:text/html,<html data-theme-mode="${theme === "daylight" ? "light" : "dark"}"><body></body></html>`);
                await win.webContents.insertCSS(baseCSS + fs.readFileSync(path.join(appRoot, `appearance/themes/${theme}/theme.css`), "utf8"));
                await win.webContents.executeJavaScript(icons);
                await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(languages)})`);
                console.log(`Decision provider focus passed: ${width}px ${theme}`);
            }
        }
        // 保留原有聚焦行为作为负对照，避免禁用动画或改变容器结构后测试失去检错能力。
        win.setContentSize(1100, 844);
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(baseCSS + fs.readFileSync(path.join(appRoot, "appearance/themes/daylight/theme.css"), "utf8"));
        await win.webContents.executeJavaScript(icons);
        await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(languages)}, true)`);
        assert.deepEqual(requests, [], "No external network requests are permitted");
        console.log("Unsafe focus negative control detected horizontal scrolling");
    } finally {
        ipcMain.removeHandler("decision-test-toggle");
        win.destroy();
    }
    app.exit(0);
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("decision provider focus preserves animated settings overlays on desktop and narrow layouts", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
            ? "Real Electron DOM verification requires DISPLAY or WAYLAND_DISPLAY" : false,
        timeout: 60000,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-decision-provider-focus-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 55000,
            });
            for (const width of [1100, 390]) {
                for (const theme of ["daylight", "midnight"]) {
                    assert.ok(stdout.includes(`Decision provider focus passed: ${width}px ${theme}`), stdout);
                }
            }
            assert.match(stdout, /Unsafe focus negative control detected horizontal scrolling/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
