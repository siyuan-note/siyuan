import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {escapeHtml, escapeHtmlTextAndAttr} from "../../util/escape";
import {canPurgeRepo} from "../../history/repoPurge";
import {registerSettingGroup} from "../setting/group";
import {registerSettingItem} from "../setting/item";
import {scanSettingTabSearch} from "../search/scan";

const source = readFileSync("src/config/tabs/syncUi.ts", "utf8");
const code = transpileModule(source + "\nexports.open = openSyncProviderConfigDialog;", {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;
const syncGuideCode = transpileModule(readFileSync("src/sync/syncGuide.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const setup = (provider = 2, mobile = false, manualRules = false) => {
    const s3 = {endpoint: "storage.example.com", accessKey: "key", secretKey: "secret", bucket: "notes", region: "auto",
        timeout: 30, pathStyle: true, skipTlsVerify: false, concurrentReqs: 4};
    const webdav = {endpoint: "dav.example.com", username: "user", password: "password", timeout: 30, skipTlsVerify: false, concurrentReqs: 4};
    const local = {endpoint: "/cloud", timeout: 30, concurrentReqs: 4};
    const sync = {provider, enabled: true, s3, webdav, local, cloudName: "main"};
    const config = {sync, readonly: false, system: {container: "std"}};
    const template = provider === 2 ? s3 : provider === 3 ? webdav : local;
    const events: Record<string, (event: unknown) => void> = {};
    const inputs = Object.fromEntries(Object.entries(template).map(([key, value]) => [key, {
        value: "", type: typeof value === "number" ? "number" : "text", disabled: false,
        attributes: {} as Record<string, string>, focused: false, validationMessage: "Invalid number",
        focus() { if (!this.disabled) this.focused = true; },
        setAttribute(name: string, value: string) { this.attributes[name] = value; },
        getAttribute(name: string) { return this.attributes[name]; },
        checkValidity() { return this.value.trim() !== "" && Number.isInteger(Number(this.value)) && Number(this.value) > 0; },
    }]));
    const errors = Object.fromEntries(Object.keys(template).map(key => [`sync-${key}-error`, {
        lastElementChild: {textContent: ""}, classList: {toggle() {}},
    }]));
    const status = {textContent: "", classList: {toggle() {} }};
    let warningHidden = true;
    const warning = {classList: {toggle: (_name: string, hidden: boolean) => { warningHidden = hidden; }}};
    const buttons = Object.fromEntries(["save", "cancel", "clear", "test"].map(action => [action, {
        disabled: false, callback: () => {}, addEventListener(_event: string, callback: () => void) {this.callback = callback;},
        getAttribute(name: string) { return name === "data-action" ? action : null; },
        querySelector: (selector: string) => selector === "span" ? {textContent: ""} : null,
    }]));
    const element = {
        querySelector(selector: string) {
            if (selector === ".b3-dialog__container") { return {focus() {}}; }
            if (selector === '[data-type="sync-config-error"]') { return status; }
            if (selector === "#sync-endpoint-warning") { return provider === 2 ? warning : null; }
            if (selector === '[aria-invalid="true"]') { return Object.values(inputs).find(input => input.attributes["aria-invalid"] === "true"); }
            if (selector.startsWith('[data-action="')) { return buttons[selector.slice(14, -2)] || null; }
            return inputs[selector.slice(1)] || errors[selector.slice(1)] || null;
        },
        querySelectorAll: () => [...Object.values(inputs), ...Object.values(buttons)],
        addEventListener(name: string, callback: (event: unknown) => void) {events[name] = callback;},
        setAttribute() {},
    };
    const cloudList = {innerHTML: "", classList: {toggle() {}}};
    const cloudBlock = {querySelector: () => ({classList: {toggle() {}}}), closest: (): null => null};
    const cloudElement = (selector: string) => selector === "#syncCloudList" ? cloudList :
        selector === "#syncCloudDirBlock" ? cloudBlock : null;
    const root = {isConnected: true, querySelector: cloudElement};
    const enabled = {checked: true};
    const replacement = {querySelector: (selector: string) => selector === '[id="sync.enabled"]' ? enabled : cloudElement(selector)};
    const requests: {url: string, data: any, resolve: (response: any) => void, reject: () => void}[] = [];
    const ruleRequests: typeof requests = [];
    const rules = {requiredFields: provider === 2 ? ["endpoint", "accessKey", "secretKey", "bucket", "region"] : ["endpoint"], endpointBucketWarning: false};
    let rulesTimer: (() => void) | undefined;
    const confirmations: {confirm: () => void, cancel: () => void}[] = [];
    let closed = 0;
    let dialog: {destroy: () => void};
    let dialogOptions: {width: string, content: string, destroyCallback: () => void};
    const window = {siyuan: {config, languages: {syncConfigNotSaved: "Required fields missing", syncConfigSaveFailed: "Not confirmed",
        loadingError: "Loading failed", testConnection: "Test connection", testConnectionTesting: "Testing...",
        testConnectionSuccess: "Connection successful", testConnectionFail: "Connection failed",
        testConnectionFailMsg: "Connection failed: ${msg}", cloudConfigTip: "Configure storage", _kernel: {142: "Input cannot be empty"}}}};
    const syncGuide = {} as Pick<typeof import("../../sync/syncGuide"), "refreshSyncCloudDirBlock">;
    runInNewContext(syncGuideCode, {
        exports: syncGuide, window,
        require: () => ({escapeHtml}),
    });
    syncGuide.refreshSyncCloudDirBlock(root as unknown as Element);
    const exports = {} as {open: (root: unknown) => void};
    runInNewContext(code, {
        URL, CSS: {escape: (value: string) => value}, exports,
        setTimeout: (callback: () => void) => {rulesTimer = callback; return 1;},
        clearTimeout: () => {rulesTimer = undefined;},
        window,
        document: {querySelector: () => ({closest: (selector: string) =>
            selector.split(", ").includes(mobile ? ".config" : ".config__tab-container") ? replacement : null})},
        require(name: string) {
            if (name === "../../dialog") {
                return {Dialog: class {
                    element = element;
                    constructor(options: any) {dialog = {destroy: () => this.destroy()}; dialogOptions = options;}
                    destroy() {closed++; dialogOptions.destroyCallback();}
                }};
            }
            if (name === "../../dialog/confirmDialog") {
                return {confirmDialog: (_title: string, _text: string, confirm: () => void, cancel: () => void) => confirmations.push({confirm, cancel})};
            }
            if (name === "../util/configApi") {
                return {config: {set: (path: string, value: unknown, applied: () => void) => {
                    const key = path.split(".")[1];
                    return new Promise((resolve, reject) => requests.push({url: "/api/setting/patch", data: {sync: {[key]: value}}, resolve, reject}))
                        .then((response: any) => {
                            if (response.code === 0) {
                                Object.assign(sync, response.data);
                                applied();
                            } else {
                                throw new Error(response.msg);
                            }
                        });
                }}};
            }
            if (name === "../../util/fetch") {
                return {fetchSyncPost: (url: string, data: any) => new Promise((resolve, reject) => {
                    if (url === "/api/sync/getSyncProviderConfigRules") {
                        ruleRequests.push({url, data, resolve, reject});
                        if (!manualRules) resolve({code: 0, data: {...rules}});
                    } else {
                        requests.push({url, data, resolve, reject});
                    }
                })};
            }
            if (name === "../../util/functions") { return {isMobile: () => mobile}; }
            if (name === "../../util/needSubscribe") { return {isPaidUser: () => true, needSubscribe: () => false}; }
            if (name === "../../sync/syncGuide") { return syncGuide; }
            return {};
        },
    });
    exports.open(root);
    return {inputs, sync, config, requests, ruleRequests, rules, refreshRules: () => rulesTimer?.(), confirmations, buttons, status, root, events, enabled, cloudList,
        options: () => dialogOptions, close: () => dialog.destroy(), closed: () => closed,
        click: (action: string) => buttons[action].callback(), input: () => events.input({}),
        warningHidden: () => warningHidden};
};

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

for (const mobile of [false, true]) {
    for (const replaced of [false, true]) {
        test(`S3 bucket display follows saved and cleared configuration (mobile=${mobile}, replaced=${replaced})`, async () => {
            const ui = setup(2, mobile);
            ui.root.isConnected = !replaced;
            assert.match(ui.cloudList.innerHTML, />notes</);
            ui.inputs.bucket.value = "new-bucket";
            ui.click("save");
            await settle();
            ui.requests[0].resolve({code: 0, data: {s3: ui.requests[0].data.sync.s3}});
            await settle();
            assert.equal(ui.closed(), 1);
            assert.match(ui.cloudList.innerHTML, />new-bucket</);
            assert.doesNotMatch(ui.cloudList.innerHTML, />notes</);
            const clearing = setup(2, mobile);
            clearing.root.isConnected = !replaced;
            assert.match(clearing.cloudList.innerHTML, />notes</);
            clearing.click("clear");
            clearing.confirmations[0].confirm();
            clearing.requests[0].resolve({code: 0, data: {enabled: false, s3: {...clearing.sync.s3, bucket: ""}}});
            await settle();
            assert.equal(clearing.closed(), 1);
            assert.match(clearing.cloudList.innerHTML, /Configure storage/);
            assert.doesNotMatch(clearing.cloudList.innerHTML, />notes</);
        });
    }
}

for (const provider of [2, 3, 4]) {
    test(`provider ${provider} submits the complete draft only after Save`, async () => {
        const ui = setup(provider);
        ui.inputs.endpoint.value = "new.example.com";
        ui.input();
        assert.equal(ui.events.change, undefined);
        assert.equal(ui.requests.length, 0);
        const key = provider === 2 ? "s3" : provider === 3 ? "webdav" : "local";
        ui.click("save");
        ui.click("save");
        await settle();
        assert.equal(ui.requests.length, 1);
        assert.equal(ui.requests[0].data.sync[key].endpoint, "new.example.com");
        assert.equal(ui.buttons.save.disabled, true);
        ui.close();
        assert.equal(ui.closed(), 0);
        ui.requests[0].resolve({code: 0, data: {[key]: {...ui.requests[0].data.sync[key], endpoint: "https://new.example.com"}}});
        await settle();
        assert.equal(ui.sync[key].endpoint, "https://new.example.com");
        assert.equal(ui.closed(), 1);
    });
}

test("required and numeric validation keeps empty or invalid draft values without saving", async () => {
    for (const key of ["endpoint", "secretKey", "timeout", "concurrentReqs"]) {
        const ui = setup();
        ui.inputs[key].value = "";
        ui.click("save");
        await settle();
        assert.equal(ui.requests.length, 0, key);
        assert.equal(ui.inputs[key].value, "");
        assert.equal(ui.inputs[key].attributes["aria-invalid"], "true");
        assert.equal(ui.inputs[key].focused, true);
        assert.equal(ui.status.textContent, "Required fields missing");
    }
    const ui = setup();
    ui.inputs.timeout.value = "1.5";
    ui.click("save");
    await settle();
    assert.equal(ui.requests.length, 0);
});

test("cancel or close confirms dirty drafts and never saves them", () => {
    const pristine = setup();
    pristine.click("cancel");
    assert.equal(pristine.closed(), 1);
    assert.equal(pristine.confirmations.length, 0);
    const ui = setup();
    ui.inputs.secretKey.value = "draft secret";
    ui.click("cancel");
    ui.close();
    assert.equal(ui.confirmations.length, 1);
    assert.equal(ui.closed(), 0);
    ui.confirmations[0].cancel();
    assert.equal(ui.inputs.secretKey.value, "draft secret");
    ui.close();
    ui.confirmations[1].confirm();
    assert.equal(ui.closed(), 1);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.sync.s3.secretKey, "secret");
});

test("failed saves keep drafts after panel replacement and allow retry", async () => {
    const ui = setup();
    ui.inputs.endpoint.value = "new.example.com";
    ui.root.isConnected = false;
    ui.click("save");
    await settle();
    ui.requests[0].resolve({code: -1, msg: "Download resources first"});
    await settle();
    assert.equal(ui.status.textContent, "Download resources first");
    assert.equal(ui.inputs.endpoint.value, "new.example.com");
    assert.equal(ui.sync.s3.endpoint, "storage.example.com");
    assert.equal(ui.closed(), 0);
    ui.click("save");
    await settle();
    ui.requests[1].reject();
    await settle();
    assert.equal(ui.status.textContent, "Not confirmed");
    assert.equal(ui.buttons.save.disabled, false);
    ui.click("save");
    await settle();
    ui.requests[2].resolve({code: 0, data: {s3: ui.requests[2].data.sync.s3}});
    await settle();
    assert.equal(ui.closed(), 1);
});

test("clear requires confirmation and preserves the source when the kernel refuses", async () => {
    const ui = setup();
    ui.root.isConnected = false;
    ui.click("clear");
    assert.equal(ui.requests.length, 0);
    ui.confirmations[0].cancel();
    assert.equal(ui.requests.length, 0);
    ui.click("clear");
    ui.confirmations[1].confirm();
    assert.equal(ui.requests[0].url, "/api/sync/clearSyncProviderConfig");
    assert.equal(ui.requests[0].data.provider, 2);
    ui.requests[0].resolve({code: -1, msg: "Incomplete history"});
    await settle();
    assert.equal(ui.sync.s3.secretKey, "secret");
    assert.equal(ui.sync.enabled, true);
    assert.equal(ui.closed(), 0);
    assert.equal(ui.status.textContent, "Incomplete history");
    ui.click("clear");
    ui.confirmations[2].confirm();
    ui.requests[1].resolve({code: 0, data: {enabled: false, s3: {...ui.sync.s3, endpoint: "", secretKey: ""}}});
    await settle();
    assert.equal(ui.sync.enabled, false);
    assert.equal(ui.enabled.checked, false);
    assert.equal(ui.sync.s3.secretKey, "");
    assert.equal(ui.closed(), 1);
});

test("read-only transitions do not re-enable writes after a pending save", async () => {
    const ui = setup();
    ui.click("save");
    await settle();
    ui.config.readonly = true;
    ui.requests[0].resolve({code: -1, msg: "Read only"});
    await settle();
    assert.equal(ui.buttons.save.disabled, true);
    assert.equal(ui.buttons.clear.disabled, true);
    assert.equal(ui.buttons.cancel.disabled, false);
    ui.click("save");
    ui.click("clear");
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.confirmations.length, 0);
});

test("test connection probes the draft without saving the configuration", async () => {
    const ui = setup();
    ui.inputs.endpoint.value = "https://s3.example.com/notes/";
    ui.click("test");
    await settle();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].url, "/api/sync/testSyncProviderS3");
    assert.equal(ui.requests[0].data.s3.endpoint, "https://s3.example.com/notes/");
    assert.equal(ui.requests[0].data.s3.bucket, "notes");
    ui.requests[0].resolve({code: 0, data: {kind: "config", msg: "probe object was not listed"}});
    await settle();
    assert.equal(ui.status.textContent, "Connection failed: probe object was not listed");
    assert.equal(ui.inputs.endpoint.disabled, false);
    assert.equal(ui.buttons.test.disabled, false);
    assert.equal(ui.closed(), 0);
});

test("test connection reports success and clears the result when the draft changes", async () => {
    const ui = setup();
    ui.click("test");
    await settle();
    ui.requests[0].resolve({code: 0, data: {kind: "ok", msg: ""}});
    await settle();
    assert.equal(ui.status.textContent, "Connection successful");
    ui.input();
    assert.equal(ui.status.textContent, "");
});

for (const mobile of [false,true]) {
    for (const provider of [3,4]) {
        test(`WebDAV and local probes use their draft without saving (provider=${provider}, mobile=${mobile})`, async () => {
            const ui = setup(provider,mobile);
            const configKey = provider === 3 ? "webdav" : "local";
            const endpoint = ui.sync[configKey].endpoint;
            assert.match(ui.options().content,/data-action="test"/);
            ui.inputs.endpoint.value = "draft-endpoint";
            ui.sync.provider = 2;
            ui.sync.cloudName = "changed";
            ui.click("test");
            await settle();
            assert.equal(ui.requests.length,1);
            assert.equal(ui.requests[0].url, provider === 3 ? "/api/sync/testSyncProviderWebDAV" : "/api/sync/testSyncProviderLocal");
            assert.equal(ui.requests[0].data[configKey].endpoint,"draft-endpoint");
            if (provider === 3) assert.equal(ui.requests[0].data.cloudName,"main");
            assert.equal(ui.sync[configKey].endpoint,endpoint);
            assert.equal(ui.buttons.save.disabled,true);
            ui.requests[0].resolve({code:0,data:{kind:"ok",msg:""}});
            await settle();
            assert.equal(ui.status.textContent,"Connection successful");
            assert.equal(ui.buttons.save.disabled,false);
            assert.equal(ui.closed(),0);
        });
    }
}

test("test connection waits for kernel rules before validating the draft", async () => {
    const ui = setup(2, false, true);
    ui.inputs.endpoint.value = "";
    ui.click("test");
    await settle();
    // 打开对话框时的规则请求被暂停，点击测试会另起一次并等它返回
    assert.equal(ui.ruleRequests.length, 2);
    assert.equal(ui.requests.length, 0);
    ui.ruleRequests[1].resolve({code: 0, data: ui.rules});
    await settle();
    // 规则返回后空字段才由内核必填清单拦住，不会把空值交给探测接口
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.inputs.endpoint.attributes["aria-invalid"], "true");
    assert.equal(ui.status.textContent, "Required fields missing");
    assert.equal(ui.buttons.test.disabled, false);
});

test("test connection reports a rule loading failure without probing", async () => {
    const ui = setup(2, false, true);
    ui.click("test");
    await settle();
    ui.ruleRequests[1].reject();
    await settle();
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.status.textContent, "Loading failed");
    assert.equal(ui.buttons.test.disabled, false);
});

test("draft stays bound to the opened provider even if another window changes the provider", async () => {
    const ui = setup();
    ui.sync.provider = 3;
    ui.inputs.endpoint.value = "changed.example.com";
    ui.click("save");
    await settle();
    assert.equal(ui.requests[0].url, "/api/setting/patch");
    assert.equal(ui.requests[0].data.sync.s3.endpoint, "changed.example.com");
});

test("mobile uses kernel bucket warnings without submitting the draft", async () => {
    const ui = setup(2, true);
    assert.equal(ui.options().width, "92vw");
    ui.inputs.endpoint.value = "https://notes.s3.example.com";
    ui.rules.endpointBucketWarning = true;
    ui.input();
    ui.refreshRules();
    await settle();
    assert.equal(ui.warningHidden(), false);
    ui.inputs.endpoint.value = "https://s3.example.com";
    ui.rules.endpointBucketWarning = false;
    ui.input();
    ui.refreshRules();
    await settle();
    assert.equal(ui.warningHidden(), true);
    assert.equal(ui.requests.length, 0);
});

test("kernel required fields control the form and warnings do not block Save", async () => {
    const ui = setup(3);
    ui.rules.requiredFields = ["username"];
    ui.inputs.username.value = "";
    ui.click("save");
    await settle();
    assert.equal(ui.inputs.username.attributes["aria-invalid"], "true");
    assert.equal(ui.requests.length, 0);
    const s3 = setup();
    s3.rules.endpointBucketWarning = true;
    s3.click("save");
    await settle();
    assert.equal(s3.warningHidden(), false);
    assert.equal(s3.requests.length, 1);
    for (const request of s3.ruleRequests) {
        assert.deepEqual(Object.keys(request.data).sort(), ["bucket", "endpoint", "provider"]);
    }
});

test("rule loading failures preserve drafts and Save retries before persisting", async () => {
    const ui = setup(2, false, true);
    ui.ruleRequests[0].reject();
    await settle();
    assert.equal(ui.status.textContent, "Loading failed");
    ui.inputs.secretKey.value = "new secret";
    ui.click("save");
    ui.ruleRequests[1].reject();
    await settle();
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.inputs.secretKey.value, "new secret");
    assert.equal(ui.buttons.save.disabled, false);
    ui.click("save");
    ui.ruleRequests[2].resolve({code: 0, data: ui.rules});
    await settle();
    assert.equal(ui.requests[0].data.sync.s3.secretKey, "new secret");
});

test("new input and closing invalidate old rule results and failures", async () => {
    const ui = setup(2, false, true);
    ui.inputs.endpoint.value = "new.example.com";
    ui.input();
    ui.refreshRules();
    ui.ruleRequests[1].resolve({code: 0, data: {...ui.rules, endpointBucketWarning: true}});
    await settle();
    ui.ruleRequests[0].reject();
    await settle();
    assert.equal(ui.warningHidden(), false);
    assert.equal(ui.status.textContent, "");
    ui.input();
    ui.refreshRules();
    ui.inputs.endpoint.value = ui.sync.s3.endpoint;
    ui.close();
    ui.ruleRequests[2].resolve({code: 0, data: {...ui.rules, endpointBucketWarning: true}});
    await settle();
    assert.equal(ui.closed(), 1);
    assert.equal(ui.warningHidden(), true);
    assert.equal(ui.status.textContent, "");
});

test("a read-only transition during rule loading prevents saving", async () => {
    const ui = setup(2, false, true);
    ui.click("save");
    ui.config.readonly = true;
    ui.ruleRequests[1].resolve({code: 0, data: ui.rules});
    await settle();
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.buttons.save.disabled, true);
    assert.equal(ui.buttons.cancel.disabled, false);
});

const setupPanels = (mobile: boolean) => {
    const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
    const sync = {provider: 3, enabled: true, s3: {endpoint: "https://s3.example.com", bucket: "notes"},
        webdav: {endpoint: "https://dav.example.com", username: "user"}, local: {endpoint: "/cloud"}};
    const createElement = () => {
        const classes = new Set<string>();
        return {innerHTML: "", querySelector: (): null => null, classList: {
            contains: (name: string) => classes.has(name),
            toggle(name: string, force: boolean) {
                if (force) classes.add(name); else classes.delete(name);
                return force;
            },
        }};
    };
    const intro = createElement();
    const row = createElement();
    const purge = createElement();
    const elements = {"#syncProviderConfig": intro, "#syncProviderConfigRow": row, "#cloudRepoPurgeBlock": purge};
    const root = {querySelector: (selector: string) => elements[selector as keyof typeof elements] || null};
    const exports = {} as {refreshSyncTabPanels: (root: unknown) => void;
        getSyncProviderConfigRowKeywords: () => string[]; getSyncProviderConfigKeywords: () => string[]};
    runInNewContext(code, {
        exports, CSS: {escape: (value: string) => value},
        window: {siyuan: {config: {sync, readonly: false, system: {container: mobile ? "android" : "std"}}, languages}},
        require: () => ({escapeHtmlTextAndAttr, canPurgeRepo, isPaidUser: () => true, needSubscribe: () => false,
            getCloudURL: () => "https://example.com", getHostCapabilities: () => ({importExport: !mobile})}),
    });
    return {sync, intro, row, purge, root, exports, languages};
};

for (const mobile of [false, true]) {
    test(`configuration summaries keep quotes and markup inside text and title (mobile=${mobile})`, () => {
        const ui = setupPanels(mobile);
        ui.sync.webdav.username = 'user" onmouseover="alert(1)" data-test="<&';
        ui.exports.refreshSyncTabPanels(ui.root);
        const summary = ui.row.innerHTML.match(/title="([^"]*)">([^<]*)<\/div>/);
        const expected = "user&quot; onmouseover=&quot;alert(1)&quot; data-test=&quot;&lt;&amp; · https://dav.example.com";
        assert.ok(summary);
        assert.equal(summary[1], expected);
        assert.equal(summary[2], expected);
        assert.doesNotMatch(ui.row.innerHTML, / onmouseover="/);
    });

    test(`cloud cleanup visibility follows provider changes in the mounted panel (mobile=${mobile})`, () => {
        const ui = setupPanels(mobile);
        for (const provider of [0, 2, 3, 4, 0]) {
            ui.sync.provider = provider;
            ui.exports.refreshSyncTabPanels(ui.root);
            assert.equal(ui.purge.classList.contains("fn__none"), provider === 0, String(provider));
        }
    });

    test(`field and action searches retain the configuration row (mobile=${mobile})`, () => {
        const ui = setupPanels(mobile);
        ui.exports.refreshSyncTabPanels(ui.root);
        const tabId = `sync-row-search-${mobile}`;
        registerSettingGroup(tabId, "sync", "Sync");
        for (const [key, keywords] of [
            ["intro", ui.exports.getSyncProviderConfigKeywords()],
            ["row", ui.exports.getSyncProviderConfigRowKeywords()],
        ] as const) {
            registerSettingItem({id: `${tabId}.${key}`, tabId, groupId: "sync", kind: "render", html: () => "",
                searchTexts: () => keywords.filter(keyword => !keyword.includes("<"))});
        }
        for (const keyword of ["Endpoint", "Secret Key", "Bucket", "Username", "Password", "Path-style", ui.languages.clearSyncConfig]) {
            const result = scanSettingTabSearch(tabId, "Account & Sync", keyword.toLowerCase());
            assert.ok(result.visibleItemIds.has(`${tabId}.row`), keyword);
        }
        assert.equal(ui.row.classList.contains("fn__none"), false);
        assert.match(ui.row.innerHTML, /data-action="configureSync"/);
    });
}
