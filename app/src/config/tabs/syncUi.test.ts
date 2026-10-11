import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const source = readFileSync("src/config/tabs/syncUi.ts", "utf8");
const code = transpileModule(source + "\nexports.open = openSyncProviderConfigDialog;", {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const setup = (provider = 2, mobile = false) => {
    const s3 = {endpoint: "storage.example.com", accessKey: "key", secretKey: "secret", bucket: "notes", region: "auto",
        timeout: 30, pathStyle: true, skipTlsVerify: false, concurrentReqs: 4};
    const webdav = {endpoint: "dav.example.com", username: "user", password: "password", timeout: 30, skipTlsVerify: false, concurrentReqs: 4};
    const local = {endpoint: "/cloud", timeout: 30, concurrentReqs: 4};
    const sync = {provider, enabled: true, s3, webdav, local};
    const config = {sync, readonly: false, system: {container: "std"}};
    const template = provider === 2 ? s3 : provider === 3 ? webdav : local;
    const events: Record<string, (event: unknown) => void> = {};
    const inputs = Object.fromEntries(Object.entries(template).map(([key, value]) => [key, {
        value: "", type: typeof value === "number" ? "number" : "text", disabled: false,
        attributes: {} as Record<string, string>, focused: false, validationMessage: "Invalid number",
        focus() { this.focused = true; },
        setAttribute(name: string, value: string) { this.attributes[name] = value; },
        getAttribute(name: string) { return this.attributes[name]; },
        checkValidity() { return this.value.trim() !== "" && Number.isInteger(Number(this.value)) && Number(this.value) > 0; },
    }]));
    const errors = Object.fromEntries(Object.keys(template).map(key => [`sync-${key}-error`, {
        textContent: "", classList: {toggle() {}},
    }]));
    const status = {textContent: "", classList: {toggle() {} }};
    let warningHidden = true;
    const warning = {classList: {toggle: (_name: string, hidden: boolean) => { warningHidden = hidden; }}};
    const buttons = Object.fromEntries(["save", "cancel", "clear"].map(action => [action, {
        disabled: false, callback: () => {}, addEventListener(_event: string, callback: () => void) {this.callback = callback;},
        getAttribute(name: string) { return name === "data-action" ? action : null; },
    }]));
    const element = {
        querySelector(selector: string) {
            if (selector === ".b3-dialog__container") { return {focus() {}}; }
            if (selector === '[data-type="sync-config-error"]') { return status; }
            if (selector === '[data-type="s3-endpoint-warning"]') { return provider === 2 ? warning : null; }
            if (selector === '[aria-invalid="true"]') { return Object.values(inputs).find(input => input.attributes["aria-invalid"] === "true"); }
            if (selector.startsWith('[data-action="')) { return buttons[selector.slice(14, -2)] || null; }
            return inputs[selector.slice(1)] || errors[selector.slice(1)] || null;
        },
        querySelectorAll: () => [...Object.values(inputs), ...Object.values(buttons)],
        addEventListener(name: string, callback: (event: unknown) => void) {events[name] = callback;},
        setAttribute() {},
    };
    const root = {isConnected: true, querySelector: (): null => null};
    const enabled = {checked: true};
    const replacement = {querySelector: (selector: string) => selector === '[id="sync.enabled"]' ? enabled : null};
    const requests: {url: string, data: any, resolve: (response: any) => void, reject: () => void}[] = [];
    const confirmations: {confirm: () => void, cancel: () => void}[] = [];
    let closed = 0;
    let dialog: {destroy: () => void};
    let dialogOptions: {width: string, content: string};
    const exports = {} as {open: (root: unknown) => void};
    runInNewContext(code, {
        URL, CSS: {escape: (value: string) => value}, exports,
        document: {querySelector: () => ({closest: () => replacement})},
        window: {siyuan: {config, languages: {syncConfigNotSaved: "Required fields missing", syncConfigSaveFailed: "Not confirmed",
            _kernel: {142: "Input cannot be empty"}}}},
        require(name: string) {
            if (name === "../../dialog") {
                return {Dialog: class {
                    element = element;
                    constructor(options: any) {dialog = {destroy: () => this.destroy()}; dialogOptions = options;}
                    destroy() {closed++;}
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
                return {fetchSyncPost: (url: string, data: any) => new Promise((resolve, reject) => requests.push({url, data, resolve, reject}))};
            }
            if (name === "../../util/functions") { return {isMobile: () => mobile}; }
            if (name === "../../util/needSubscribe") { return {isPaidUser: () => true, needSubscribe: () => false}; }
            return {};
        },
    });
    exports.open(root);
    return {inputs, sync, config, requests, confirmations, buttons, status, root, events, enabled,
        options: () => dialogOptions, close: () => dialog.destroy(), closed: () => closed,
        click: (action: string) => buttons[action].callback(), input: () => events.input({}),
        warningHidden: () => warningHidden};
};

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

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

test("required and numeric validation keeps empty or invalid draft values without saving", () => {
    for (const key of ["endpoint", "secretKey", "timeout", "concurrentReqs"]) {
        const ui = setup();
        ui.inputs[key].value = "";
        ui.click("save");
        assert.equal(ui.requests.length, 0, key);
        assert.equal(ui.inputs[key].value, "");
        assert.equal(ui.inputs[key].attributes["aria-invalid"], "true");
        assert.equal(ui.status.textContent, "Required fields missing");
    }
    const ui = setup();
    ui.inputs.timeout.value = "1.5";
    ui.click("save");
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
    ui.requests[0].resolve({code: -1, msg: "Download resources first"});
    await settle();
    assert.equal(ui.status.textContent, "Download resources first");
    assert.equal(ui.inputs.endpoint.value, "new.example.com");
    assert.equal(ui.sync.s3.endpoint, "storage.example.com");
    assert.equal(ui.closed(), 0);
    ui.click("save");
    ui.requests[1].reject();
    await settle();
    assert.equal(ui.status.textContent, "Not confirmed");
    assert.equal(ui.buttons.save.disabled, false);
    ui.click("save");
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

test("draft stays bound to the opened provider even if another window changes the provider", () => {
    const ui = setup();
    ui.sync.provider = 3;
    ui.inputs.endpoint.value = "changed.example.com";
    ui.click("save");
    assert.equal(ui.requests[0].url, "/api/setting/patch");
    assert.equal(ui.requests[0].data.sync.s3.endpoint, "changed.example.com");
});

test("mobile uses the shared dialog and bucket warnings never submit the draft", () => {
    const ui = setup(2, true);
    assert.equal(ui.options().width, "92vw");
    ui.inputs.endpoint.value = "https://notes.s3.example.com";
    ui.input();
    assert.equal(ui.warningHidden(), false);
    ui.inputs.endpoint.value = "https://s3.example.com";
    ui.input();
    assert.equal(ui.warningHidden(), true);
    assert.equal(ui.requests.length, 0);
});
