import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = () => transpileModule(readFileSync("src/config/map.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const tick = () => new Promise(setImmediate);
const language = new Proxy({}, {get: (_target, key) => String(key)});
const service = (id = "one", provider = "amap") => ({id, name: id, provider,
    hasAPIKey: provider !== "openfreemap", hasSecurityCode: provider === "amap", configured: true});
type Service = ReturnType<typeof service>;
type Write = Pick<Service, "id" | "name" | "provider"> & {apiKey?: string; securityCode?: string};
type Backend = {services: Service[]; version: number};

const createPanel = async (initial: Service[] = [service()], missingID?: string, deferInitial = false,
                           backend: Backend = {services: initial, version: 0}) => {
    let deferRead = deferInitial;
    let reads = 0;
    const requests: string[] = [];
    const readRequests: Array<(response: unknown) => void> = [];
    const writes: Array<{services: Write[]; expectedRevision: string;
        resolve: (response: unknown) => void; reject: (error: Error) => void}> = [];
    const messages: string[] = [];
    const confirmations: Array<() => void> = [];
    const listeners = new Map<string, (event: unknown) => Promise<void> | void>();
    const notifications = new Map<string, () => void>();
    const fields = ["mapServiceName", "mapAPIKey", "mapSecurityCode", "mapClearAPIKey", "mapClearSecurityCode"];
    const buttons = ["mapServiceAdd", "mapServiceSave", "mapServiceCancel", "mapServiceDelete", "mapServiceRetry"];
    const selects = ["mapServiceSelect", "mapServiceProvider"];
    const controls = Object.fromEntries([...fields, ...buttons, ...selects,
        "mapServiceEditor", "mapAPIKeyRow", "mapSecurityCodeRow", "mapServiceStatus"].map(id => {
        const classes = new Set<string>();
        return [id, {id, value: "", checked: false, disabled: true, readOnly: false, placeholder: "", innerHTML: "",
            textContent: "", validationMessage: "", focus() {},
            setCustomValidity(message: string) { this.validationMessage = message; },
            reportValidity() { return !this.validationMessage; },
            closest() { return this; },
            classList: {toggle: (name: string, force: boolean) => force ? classes.add(name) : classes.delete(name),
                add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
                contains: (name: string) => classes.has(name)},
        }];
    }));
    const root = {
        dataset: missingID ? {mapServiceID: missingID} : {} as {mapServiceID?: string},
        querySelector: (selector: string) => controls[selector.slice(1)],
        querySelectorAll: () => [...fields, ...buttons, ...selects].map(id => controls[id]),
        addEventListener: (name: string, callback: (event: unknown) => Promise<void>, options: {signal: AbortSignal}) => {
            listeners.set(name, callback);
            options.signal.addEventListener("abort", () => listeners.delete(name));
        },
        dispatchEvent: (event: {type: string}) => listeners.get(event.type)?.(event),
    };
    const config = {readonly: false};
    const exports = {} as {mountMapSettings: (root: unknown) => () => void;
        requestMapServiceConfiguration: (root: unknown, id: string) => void};
    runInNewContext(compile(), {exports, AbortController, CustomEvent: class {constructor(public type: string) {}},
        window: {siyuan: {languages: language, config},
            addEventListener: (name: string, callback: () => void, options: {signal: AbortSignal}) => {
                notifications.set(name, callback);
                options.signal.addEventListener("abort", () => notifications.delete(name));
            }},
        require: () => ({
            escapeAttr: (value: string) => value.replace(/"/g, "&quot;"), escapeHtml: (value: string) => value.replace(/</g, "&lt;"),
            genUUID: () => "new-stable-id", trackSettingSave: (task: Promise<unknown>) => task,
            MAP_CONFIG_CHANGED_EVENT: "map-change", notifyMapConfigChanged: () => notifications.get("map-change")?.(),
            showMessage: (message: string) => messages.push(message),
            confirmDialog: (_title: string, _text: string, confirm: () => void) => confirmations.push(confirm),
            fetchSyncPost: (url: string, data: {services: Write[]; expectedRevision: string}) => {
                requests.push(url);
                if (url === "/api/map/getConf") {
                    reads++;
                    if (deferRead) {
                        deferRead = false;
                        return new Promise(resolve => readRequests.push(resolve));
                    }
                    return Promise.resolve({code: 0, data: {services: backend.services.map(item => ({...item})), revision: `revision-${backend.version}`}});
                }
                assert.equal(url, "/api/map/setConf");
                return new Promise((resolve, reject) => writes.push({services: data.services, expectedRevision: data.expectedRevision, resolve, reject}));
            },
        }),
    });
    const close = exports.mountMapSettings(root);
    await tick();
    const event = (id: string) => ({target: controls[id], stopPropagation() {}});
    return {
        controls, writes, readRequests, requests, messages, confirmations, close, config,
        reads: () => reads, notify: () => notifications.get("map-change")?.(),
        deferRead: () => { deferRead = true; },
        updateServer: (services: Service[]) => { backend.services = services; backend.version++; },
        request: (id: string) => exports.requestMapServiceConfiguration(root, id),
        input: (id: string, value: string) => { controls[id].value = value; return listeners.get("input")?.(event(id)); },
        change: (id: string, value: string | boolean) => {
            if (typeof value === "boolean") controls[id].checked = value;
            else controls[id].value = value;
            return listeners.get("change")?.(event(id));
        },
        click: (id: string) => listeners.get("click")?.(event(id)),
        finishWrite: async (index = 0) => {
            if (writes[index].expectedRevision !== `revision-${backend.version}`) {
                writes[index].resolve({code: -1, msg: "mapSettingsConflict"});
            } else {
                backend.services = writes[index].services.map(item => ({...service(item.id, item.provider), name: item.name}));
                backend.version++;
                writes[index].resolve({code: 0, data: {services: backend.services, revision: `revision-${backend.version}`}});
            }
            await tick();
        },
    };
};

test("Map settings share desktop/mobile order, existing icon, searchable controls, and teardown", () => {
    const rows: Array<{key: string; keywords: string[]; html: () => string}> = [];
    const tab = {group: () => tab, slot: (row: typeof rows[number]) => { rows.push(row); return tab; }};
    const exports = {} as {registerMapTab: (tab: unknown) => void};
    runInNewContext(compile(), {exports, window: {siyuan: {languages: language}}, require: () => ({
        escapeHtml: (value: string) => value, escapeAttr: (value: string) => value,
        genConfigItemMainHtml: (title: string, desc: string) => `${title} ${desc}`,
    })});
    exports.registerMapTab(tab);
    assert.equal(rows[0].keywords.includes("mapServiceIDTip"), false);
    assert.equal(rows[0].keywords.includes("mapServiceID"), false);
    assert.ok(rows[0].keywords.includes("mapProductionTip"));
    const html = rows[0].html();
    assert.doesNotMatch(html, /mapServiceID/);
    assert.equal((html.match(/class="b3-label b3-label--inner config-item"/g) || []).length, 4);
    assert.match(html, /<div class="fn__flex">\s*<span class="fn__flex-1"><\/span>\s*<button id="mapServiceDelete"[^>]*>[^<]*<\/button><span class="fn__space"><\/span>\s*<button id="mapServiceCancel"[^>]*>[^<]*<\/button><span class="fn__space"><\/span>\s*<button id="mapServiceSave"/);
    assert.equal((html.match(/type="password" autocomplete="off"/g) || []).length, 2);
    assert.doesNotMatch(html, /value=".*apiKey/i);
    const tabs = readFileSync("src/config/setting/tabs.ts", "utf8");
    assert.match(tabs, /ocr: setting\.tab\([\s\S]*?map: setting\.tab\([\s\S]*?icon: "iconGlobe"[\s\S]*?registerMapTab\),\s*export:/);
    assert.match(readFileSync("src/mobile/menu/settingPanel.ts", "utf8"), /tabId === "map"[\s\S]*?unmountMapTab\(root\)/);
    assert.match(readFileSync("src/config/index.ts", "utf8"), /if \(mapRoot\) unmountMapTab\(mapRoot\)/);
});

test("redacted credentials stay empty, edits need explicit save, and sibling credentials are omitted", async () => {
    const p = await createPanel([service(), service("two", "tencent")]);
    assert.equal(p.controls.mapAPIKey.value, "");
    assert.equal(p.controls.mapAPIKey.placeholder, "mapCredentialSaved");
    p.input("mapServiceName", "Renamed");
    assert.equal(p.writes.length, 0);
    const saving = p.click("mapServiceSave");
    await tick();
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].expectedRevision, "revision-0");
    assert.equal(JSON.stringify(p.writes[0].services), JSON.stringify([
        {id: "one", name: "Renamed", provider: "amap"}, {id: "two", name: "two", provider: "tencent"},
    ]));
    await p.finishWrite();
    await saving;
    assert.equal(p.controls.mapAPIKey.value, "");
    p.close();
});

test("explicit clearing sends empty credentials; changing provider never reuses credentials", async () => {
    const p = await createPanel();
    p.change("mapClearAPIKey", true);
    const saving = p.click("mapServiceSave");
    await tick();
    assert.equal(p.writes[0].services[0].apiKey, "");
    assert.equal(p.writes[0].services[0].securityCode, undefined);
    await p.finishWrite(); await saving;
    p.input("mapAPIKey", "typed-key");
    p.input("mapSecurityCode", "typed-code");
    p.change("mapServiceProvider", "tencent");
    assert.equal(p.controls.mapAPIKey.value, "");
    assert.equal(p.controls.mapSecurityCode.value, "");
    const changed = p.click("mapServiceSave");
    await tick();
    assert.equal(p.writes[1].services[0].apiKey, "");
    assert.equal(p.writes[1].services[0].securityCode, undefined);
    await p.finishWrite(1); await changed;
    p.close();
});

test("changing providers away and back clears both old AMap credentials", async () => {
    const p = await createPanel();
    p.change("mapServiceProvider", "tencent");
    p.change("mapServiceProvider", "amap");
    const saving = p.click("mapServiceSave"); await tick();
    assert.equal(p.writes[0].services[0].apiKey, "");
    assert.equal(p.writes[0].services[0].securityCode, "");
    await p.finishWrite(); await saving; p.close();
});

test("preconfigured OpenFreeMap is ready without a settings write or runtime request", async () => {
    const p = await createPanel([{...service("builtin-openfreemap", "openfreemap"), name: "OpenFreeMap"}]);
    assert.equal(p.controls.mapServiceSelect.value, "builtin-openfreemap");
    assert.equal(p.controls.mapServiceName.value, "OpenFreeMap");
    assert.equal(p.controls.mapServiceProvider.value, "openfreemap");
    assert.equal(p.controls.mapAPIKeyRow.classList.contains("fn__none"), true);
    assert.equal(p.controls.mapSecurityCodeRow.classList.contains("fn__none"), true);
    assert.deepEqual(p.requests, ["/api/map/getConf"]);
    assert.equal(p.writes.length, 0);
    p.close();
});

test("OpenFreeMap writes no credentials and missing IDs are explicitly preserved", async () => {
    const p = await createPanel([service()], "other-device-id");
    assert.equal(p.controls.mapServiceID, undefined);
    assert.equal(p.controls.mapServiceProvider.value, "openfreemap");
    assert.equal(p.controls.mapServiceStatus.textContent, "mapMissingServiceTip");
    assert.equal(p.writes.length, 0);
    p.input("mapServiceName", "Other device service");
    const saving = p.click("mapServiceSave"); await tick();
    assert.equal(JSON.stringify(p.writes[0].services[1]), JSON.stringify({id: "other-device-id", name: "Other device service", provider: "openfreemap"}));
    await p.finishWrite(); await saving; p.close();
});

test("new services receive an internal ID and cancelled drafts leave existing IDs unchanged", async () => {
    const p = await createPanel();
    await p.click("mapServiceAdd");
    assert.equal(p.controls.mapServiceID, undefined);
    p.input("mapServiceName", "Cancelled");
    await p.click("mapServiceCancel");
    assert.equal(p.writes.length, 0);
    assert.equal(p.controls.mapServiceName.value, "one");
    await p.click("mapServiceAdd");
    await p.click("mapServiceSave");
    assert.equal(p.controls.mapServiceName.validationMessage, "mapServiceNameRequired");
    assert.equal(p.writes.length, 0);
    p.input("mapServiceName", "New");
    const saving = p.click("mapServiceSave"); await tick();
    assert.deepEqual(Array.from(p.writes[0].services, item => item.id), ["one", "new-stable-id"]);
    await p.finishWrite(); await saving;
    assert.equal(p.controls.mapServiceSelect.value, "new-stable-id");
    p.close();
});

test("internal service ID validation rejects collisions and unsafe requested IDs", async () => {
    for (const id of ["bad id", "-bad", "<unsafe>", "a".repeat(129)]) {
        const p = await createPanel([service()], id);
        p.input("mapServiceName", "New"); await p.click("mapServiceSave");
        assert.equal(p.controls.mapServiceStatus.textContent, "mapServiceIDInvalid");
        assert.equal(p.writes.length, 0);
        p.close();
    }
    const p = await createPanel([service("new-stable-id")]);
    await p.click("mapServiceAdd"); p.input("mapServiceName", "New"); await p.click("mapServiceSave");
    assert.equal(p.controls.mapServiceStatus.textContent, "mapServiceIDInvalid");
    assert.equal(p.writes.length, 0);
    p.close();
});

test("Cancel and close clear typed secrets without sending writes", async () => {
    const p = await createPanel();
    p.input("mapAPIKey", "draft-secret"); p.input("mapServiceName", "Draft");
    assert.equal(p.controls.mapServiceSelect.disabled, true);
    await p.click("mapServiceCancel");
    assert.equal(p.controls.mapAPIKey.value, "");
    assert.equal(p.controls.mapServiceName.value, "one");
    p.input("mapAPIKey", "another-secret"); p.close();
    assert.equal(p.controls.mapAPIKey.value, ""); assert.equal(p.writes.length, 0);
});

test("notifications preserve dirty drafts and conflicts prevent stale list replacement", async () => {
    const p = await createPanel();
    p.input("mapServiceName", "Draft");
    p.updateServer([service(), service("remote", "openfreemap")]);
    p.notify(); await tick();
    assert.equal(p.reads(), 1); assert.equal(p.controls.mapServiceName.value, "Draft");
    await p.click("mapServiceSave");
    assert.equal(p.writes.length, 0);
    assert.equal(p.controls.mapServiceStatus.textContent, "mapSettingsConflict");
    await p.click("mapServiceCancel");
    assert.match(p.controls.mapServiceSelect.innerHTML, /remote/);
    assert.equal(p.controls.mapServiceName.value, "one"); p.close();
});

test("two concurrent saves retain the original revision and preserve the rejected draft", async () => {
    const backend: Backend = {services: [service()], version: 0};
    const first = await createPanel(backend.services, undefined, false, backend);
    const second = await createPanel(backend.services, undefined, false, backend);
    await first.click("mapServiceAdd");
    first.input("mapServiceName", "Added in another window");
    second.input("mapServiceName", "Unsaved rename");
    second.input("mapAPIKey", "unsaved-replacement-key");
    const firstSave = first.click("mapServiceSave");
    const secondSave = second.click("mapServiceSave");
    await tick();
    assert.equal(first.writes[0].expectedRevision, "revision-0");
    assert.equal(second.writes[0].expectedRevision, "revision-0");
    await first.finishWrite(); await firstSave;
    await second.finishWrite(); await secondSave;
    assert.equal(backend.services.length, 2, "a stale replacement must not delete the newly added service");
    assert.equal(backend.services[0].name, "one");
    assert.equal(second.controls.mapServiceName.value, "Unsaved rename");
    assert.equal(second.controls.mapAPIKey.value, "unsaved-replacement-key");
    assert.equal(second.controls.mapServiceStatus.textContent, "mapSettingsConflict");
    assert.equal(second.controls.mapServiceSave.disabled, false);
    await second.click("mapServiceCancel");
    assert.equal(second.controls.mapAPIKey.value, "");
    assert.match(second.controls.mapServiceSelect.innerHTML, /Added in another window/);
    second.input("mapServiceName", "Rebased rename");
    const rebasedSave = second.click("mapServiceSave"); await tick();
    assert.equal(second.writes[1].expectedRevision, "revision-1");
    await second.finishWrite(1); await rebasedSave;
    assert.equal(backend.services.length, 2);
    assert.equal(backend.services[0].name, "Rebased rename");
    first.close(); second.close();
});

test("preflight detects credential-only revision changes without rebasing a dirty draft", async () => {
    const p = await createPanel();
    p.input("mapAPIKey", "draft-key");
    p.updateServer([service()]);
    await p.click("mapServiceSave");
    assert.equal(p.writes.length, 0);
    assert.equal(p.controls.mapAPIKey.value, "draft-key");
    assert.equal(p.controls.mapServiceStatus.textContent, "mapSettingsConflict");
    p.close();
});

test("deletion uses the draft revision and preserves a concurrent addition", async () => {
    const backend: Backend = {services: [service()], version: 0};
    const p = await createPanel(backend.services, undefined, false, backend);
    await p.click("mapServiceDelete"); p.confirmations[0](); await tick();
    assert.equal(p.writes[0].expectedRevision, "revision-0");
    p.updateServer([service(), service("new-service", "openfreemap")]);
    await p.finishWrite();
    assert.equal(backend.services.length, 2);
    assert.equal(p.controls.mapServiceStatus.textContent, "mapSettingsConflict");
    await p.click("mapServiceCancel");
    assert.match(p.controls.mapServiceSelect.innerHTML, /new-service/);
    p.close();
});

test("repeated Save is ignored and failed saves retain the draft for retry", async () => {
    const p = await createPanel();
    p.input("mapServiceName", "Draft");
    const saving = p.click("mapServiceSave"); await tick();
    await p.click("mapServiceSave"); assert.equal(p.writes.length, 1);
    p.writes[0].resolve({code: -1, msg: "private server error"}); await saving;
    assert.equal(p.controls.mapServiceName.value, "Draft");
    assert.equal(p.controls.mapServiceSave.disabled, false);
    assert.equal(p.controls.mapServiceStatus.textContent, "mapSettingsError"); p.close();
});

test("closing during preflight prevents a write, and late reads do not resurrect the panel", async () => {
    const p = await createPanel();
    p.input("mapServiceName", "Draft"); p.deferRead();
    const saving = p.click("mapServiceSave"); await tick(); p.close();
    p.readRequests[0]({code: 0, data: {services: [service()]}}); await saving;
    assert.equal(p.writes.length, 0);
    const initial = await createPanel([service()], "wanted", true);
    initial.close(); initial.readRequests[0]({code: 0, data: {services: [service()]}}); await tick();
    assert.equal(initial.controls.mapServiceName.value, "");
});

test("closing during submitted save clears secrets and ignores the late UI result", async () => {
    const p = await createPanel(); p.input("mapAPIKey", "new-secret");
    const saving = p.click("mapServiceSave"); await tick(); p.close();
    const status = p.controls.mapServiceStatus.textContent;
    await p.finishWrite(); await saving;
    assert.equal(p.controls.mapAPIKey.value, ""); assert.equal(p.controls.mapServiceStatus.textContent, status);
});

test("newer missing-service requests survive loading and never overwrite a dirty draft", async () => {
    const p = await createPanel([service()], "old-id", true);
    p.request("latest-id"); p.readRequests[0]({code: 0, data: {services: [service()], revision: "revision-0"}}); await tick();
    p.input("mapServiceName", "Draft"); p.request("third-id");
    assert.equal(p.controls.mapServiceName.value, "Draft");
    assert.deepEqual(p.messages, ["mapSaveOrCancel"]);
    const saving = p.click("mapServiceSave"); await tick();
    assert.equal(p.writes[0].services[1].id, "latest-id");
    await p.finishWrite(); await saving;
    assert.equal(p.controls.mapServiceName.value, "");
    p.input("mapServiceName", "Newer request");
    const nextSave = p.click("mapServiceSave"); await tick();
    assert.equal(p.writes[1].services[2].id, "third-id");
    await p.finishWrite(1); await nextSave; p.close();
});

test("delete confirmation is invalidated by closing or newer edits", async () => {
    const p = await createPanel(); await p.click("mapServiceDelete");
    p.input("mapServiceName", "Draft"); p.confirmations[0](); await tick();
    assert.equal(p.writes.length, 0);
    await p.click("mapServiceCancel"); await p.click("mapServiceDelete"); p.close();
    p.confirmations[1](); await tick(); assert.equal(p.writes.length, 0);
});

test("read-only settings cannot send a write", async () => {
    const p = await createPanel(); p.input("mapServiceName", "Draft"); p.config.readonly = true;
    await p.click("mapServiceSave"); assert.equal(p.writes.length, 0); p.close();
});
