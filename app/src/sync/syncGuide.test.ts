import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {escapeHtml} from "../util/escape";

const {parse} = require("ifdef-loader/preprocessor");
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

type ListResponse = {
    code: number;
    msg?: string;
    data?: {
        syncDirs: {cloudName: string, hSize: string, updated: string}[];
        checkedSyncDir: string;
    };
};

const loadSyncGuide = (mobile: boolean, provider: number, activeCheckout = false) => {
    const source = readFileSync(resolve(process.cwd(), "src/sync/syncGuide.ts"), "utf8");
    const processed = parse(source, {MOBILE: mobile, BROWSER: true}, false, true);
    const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const sync = {
        provider, cloudName: "work",
        s3: {endpoint: "https://s3.example.com", accessKey: "test-key", secretKey: "test-secret",
            bucket: "notes.backup", region: "us-east-1"},
    };
    const requests: {url: string, data: {name?: string; sync?: {cloudName: unknown}}, reply: (response: ListResponse) => void,
        reject?: (error: Error) => void}[] = [];
    const messages: string[] = [];
    let confirmCreate: (value: string) => Promise<boolean>;
    const confirmations: (() => Promise<boolean>)[] = [];
    const moduleExports = {} as {
        renderSyncCloudList: (element: Element, reload: boolean, cb: (ready: boolean) => void) => void;
        bindSyncCloudListEvent: (element: Element, cb?: (ready: boolean) => void) => void;
        refreshSyncCloudDirBlock: (root: Element) => void;
        syncGuide: () => void;
        addCloudName: (element: Element, cb: (ready: boolean) => void) => void;
    };
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan: {config: {sync}, languages: {emptyContent: "Empty", cloudConfigTip: "Configure storage",
            loadingError: "Loading failed", retry: "Retry"}}},
        require: (name: string) => {
            if (name === "../dialog/message") return {showMessage: (message: string) => messages.push(message)};
            if (name === "../constants") return {Constants: {DIALOG_SYNCADDCLOUDDIR: "add-cloud"}};
            if (name === "../dialog/mobileInputDialog") return {mobileInputDialog: (options: {onConfirm: typeof confirmCreate}) => {
                confirmCreate = options.onConfirm;
                return {element: {setAttribute() {}}};
            }};
            if (name === "../dialog/mobileConfirmDialog") return {mobileConfirmDialog: (_title: string, _text: string,
                confirm: () => Promise<boolean>) => {confirmations.push(confirm);}};
            if (name === "./checkoutProgress") return {openSyncCheckoutProgress: () => activeCheckout};
            if (name === "../config/util/configApi") {
                return {config: {set: (_path: string, value: unknown, applied?: () => void) => new Promise<void>((resolve, reject) => {
                    requests.push({url: "/api/setting/patch", data: {sync: {cloudName: value}}, reject, reply: (response: ListResponse) => {
                        if (response.code === 0) { sync.cloudName = String(value); applied?.(); resolve(); }
                        else reject(new Error(response.msg));
                    }});
                })}};
            }
            if (name === "../util/fetch") {
                return {fetchSyncPost: (url: string, data: {name?: string}) => new Promise((reply, reject) => {
                    requests.push({url, data, reply, reject});
                })};
            }
            if (name === "../util/hostCapabilities") {
                return {sanitizeKernelHTML: (html: string) => html};
            }
            if (name === "../util/escape") {
                return {escapeHtml};
            }
            return {};
        },
    });
    let click: (event: Event) => void;
    const createClassList = (classes: Set<string>) => ({
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        toggle: (name: string, force?: boolean) => {
            const enabled = force ?? !classes.has(name);
            if (enabled) {
                classes.add(name);
            } else {
                classes.delete(name);
            }
            return enabled;
        },
    });
    const listClasses = new Set(["fn__none"]);
    const configButtonClasses = new Set<string>();
    const configButton = {classList: createClassList(configButtonClasses)};
    const block = {querySelector: (selector: string) => selector === '[data-action="config"]' ? configButton : null};
    const elementList = {
        isConnected: true,
        attributes: new Map<string, string>(),
        hasAttribute: (name: string) => elementList.attributes.has(name),
        setAttribute: (name: string, value: string) => elementList.attributes.set(name, value),
        removeAttribute: (name: string) => elementList.attributes.delete(name),
        innerHTML: "",
        querySelector: (selector: string) => selector === "ul" && /<ul\b/.test(elementList.innerHTML) ? {} : null,
        classList: createClassList(listClasses),
        addEventListener: (_name: string, cb: (event: Event) => void) => {
            click = cb;
        },
    };
    const list = elementList as unknown as Element;
    const root = {
        querySelector: (selector: string) => selector === "#syncCloudDirBlock" ? block :
            selector === "#syncCloudList" ? list : null,
    } as unknown as Element;
    const readiness: boolean[] = [];
    const dispatch = (type: string) => {
        moduleExports.bindSyncCloudListEvent(list, ready => readiness.push(ready));
        click({target: {
            isEqualNode: () => false,
            getAttribute: (name: string) => name === "data-type" ? type : "chosen",
            parentElement: {getAttribute: () => "chosen"},
        }, preventDefault() {}, stopPropagation() {}} as unknown as Event);
    };
    return {
        ...moduleExports, list, elementList, listClasses, configButtonClasses, requests, sync, readiness, messages,
        dispatch, confirmCreate: (value: string) => confirmCreate(value), confirmations,
        render: () => moduleExports.renderSyncCloudList(list, true, (ready) => readiness.push(ready)),
        refreshCloudDir: () => moduleExports.refreshSyncCloudDirBlock(root),
        select: () => {
            moduleExports.bindSyncCloudListEvent(list);
            click({
                target: {
                    isEqualNode: () => false,
                    getAttribute: (name: string) => name === "data-type" ? "selectCloud" : "chosen",
                },
                preventDefault: () => {},
                stopPropagation: () => {},
            } as unknown as Event);
        },
    };
};

const listResponse = (cloudName: string, checkedSyncDir: string): ListResponse => ({
    code: 0,
    data: {syncDirs: [{cloudName, hSize: "-", updated: "2026-01-01"}], checkedSyncDir},
});

for (const mobile of [false, true]) {
    for (const failure of ["response", "configuration", "network"]) {
        test(`failed directory reads offer retry without leaving a spinner (${failure}, mobile=${mobile})`, async () => {
            const guide = loadSyncGuide(mobile, 0);
            guide.render();
            if (failure === "response") guide.requests[0].reply({code: -1, msg: "Read failed"});
            else if (failure === "configuration") guide.requests[0].reply({code: 1, msg: "Read failed"});
            else guide.requests[0].reject(new Error("Read failed"));
            await tick();
            assert.doesNotMatch(guide.list.innerHTML, /b3-loading/);
            assert.match(guide.list.innerHTML, /Read failed/);
            assert.match(guide.list.innerHTML, /data-type="retryCloud"/);
            if (failure === "configuration") assert.match(guide.list.innerHTML, /Configure storage/);
            guide.dispatch("retryCloud");
            guide.requests[1].reply(listResponse("work", "work"));
            await tick();
            assert.match(guide.list.innerHTML, /type="radio" name="cloudName" checked/);
        });
    }

    test(`failed directory changes keep the list and serialize retries (mobile=${mobile})`, async () => {
        const guide = loadSyncGuide(mobile, 0);
        guide.render();
        guide.requests[0].reply(listResponse("work", "work"));
        await tick();
        const previous = guide.list.innerHTML;
        guide.dispatch("selectCloud");
        guide.dispatch("selectCloud");
        assert.equal(guide.readiness.at(-1), false, "enabling waits for the target change to finish");
        assert.equal(guide.requests.length, 2);
        assert.equal(guide.list.innerHTML, previous);
        assert.equal(guide.elementList.attributes.get("aria-busy"), "true");
        guide.requests[1].reply({code: -1, msg: "Selection failed"});
        await tick();
        assert.equal(guide.sync.cloudName, "work");
        assert.equal(guide.list.innerHTML, previous);
        assert.equal(guide.elementList.attributes.has("inert"), false);
        assert.deepEqual(guide.messages, ["Selection failed"]);
        assert.equal(guide.readiness.at(-1), true, "failure restores readiness for the confirmed target");
        guide.dispatch("selectCloud");
        guide.requests[2].reply({code: 0});
        await tick();
        assert.equal(guide.sync.cloudName, "chosen");
        assert.equal(guide.requests[3].url, "/api/sync/listCloudSyncDir");
    });

    test(`failed directory creation and deletion keep the parent list (mobile=${mobile})`, async () => {
        const guide = loadSyncGuide(mobile, 0);
        guide.render();
        guide.requests[0].reply(listResponse("work", "work"));
        await tick();
        const previous = guide.list.innerHTML;
        guide.addCloudName(guide.list, ready => guide.readiness.push(ready));
        const first = guide.confirmCreate("chosen");
        assert.equal(await guide.confirmCreate("chosen"), false);
        assert.equal(guide.requests.length, 2);
        assert.equal(guide.list.innerHTML, previous);
        guide.requests[1].reply({code: -1});
        assert.equal(await first, false);
        assert.equal(guide.list.innerHTML, previous);
        guide.dispatch("removeCloud");
        const removal = guide.confirmations[0]();
        guide.requests[2].reply({code: -1});
        assert.equal(await removal, false);
        assert.equal(guide.list.innerHTML, previous);
        assert.equal(guide.sync.cloudName, "work");
    });

    test(`older or detached directory responses do not overwrite current contents (mobile=${mobile})`, async () => {
        const guide = loadSyncGuide(mobile, 0);
        guide.render();
        guide.render();
        guide.requests[1].reply(listResponse("new", "new"));
        await tick();
        const latest = guide.list.innerHTML;
        guide.requests[0].reply(listResponse("old", "old"));
        await tick();
        assert.equal(guide.list.innerHTML, latest);
        guide.render();
        guide.elementList.isConnected = false;
        const detached = guide.list.innerHTML;
        guide.requests[2].reply({code: -1, msg: "Late failure"});
        await tick();
        assert.equal(guide.list.innerHTML, detached);
    });

    test(`the sync control opens current checkout details without starting another sync (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 2, true);
        guide.syncGuide();
        assert.equal(guide.requests.length, 0);
    });
    test(`S3 shows the configured bucket without the config toggle (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 2);
        guide.refreshCloudDir();
        assert.equal(guide.requests.length, 0);
        assert.equal(guide.listClasses.has("fn__none"), false);
        assert.equal(guide.configButtonClasses.has("fn__none"), true);
        assert.match(guide.elementList.innerHTML, /notes\.backup/);
    });

    test(`other providers keep the config toggle and stay collapsed (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 0);
        guide.refreshCloudDir();
        assert.equal(guide.requests.length, 0);
        assert.equal(guide.listClasses.has("fn__none"), true);
        assert.equal(guide.configButtonClasses.has("fn__none"), false);
        assert.equal(guide.elementList.innerHTML, "");
    });

    test(`switching from S3 to another provider restores the config toggle (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 2);
        guide.refreshCloudDir();
        guide.sync.provider = 0;
        guide.refreshCloudDir();
        assert.equal(guide.listClasses.has("fn__none"), true);
        assert.equal(guide.configButtonClasses.has("fn__none"), false);
        assert.equal(guide.elementList.innerHTML, "");
        assert.equal(guide.requests.length, 0);
    });

    test(`S3 displays its configured bucket without requiring bucket listing (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 2);
        guide.render();
        assert.equal(guide.requests.length, 0);
        assert.match(guide.list.innerHTML, /notes\.backup/);
        assert.match(guide.list.innerHTML, /type="radio" name="cloudName" checked/);
        assert.doesNotMatch(guide.list.innerHTML, /data-type="(?:selectCloud|addCloud|removeCloud)"/);
        assert.deepEqual(guide.readiness, [true]);
        assert.equal(guide.sync.cloudName, "work");
        guide.select();
        assert.equal(guide.requests.length, 0);
        assert.doesNotMatch(guide.list.innerHTML, /test-key|test-secret/);
    });

    test(`S3 refreshes the configured bucket and escapes its name (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 2);
        guide.render();
        guide.sync.s3.bucket = "<img src=x onerror=alert(1)>&";
        guide.renderSyncCloudList(guide.list, false, ready => guide.readiness.push(ready));
        assert.match(guide.list.innerHTML, /&lt;img src=x onerror=alert\(1\)>&amp;/);
        assert.doesNotMatch(guide.list.innerHTML, /<img|notes\.backup/);
        assert.equal(guide.requests.length, 0);
        assert.deepEqual(guide.readiness, [true, true]);
    });

    for (const provider of [0, 3, 4]) {
        test(`directory selection remains available (provider=${provider}, mobile=${mobile})`, async () => {
            const guide = loadSyncGuide(mobile, provider);
            guide.render();
            guide.requests[0].reply(listResponse("work", "work"));
            await tick();
            assert.match(guide.list.innerHTML, /type="radio" name="cloudName" checked/);
            assert.match(guide.list.innerHTML, /data-type="selectCloud"/);
            assert.equal(guide.list.innerHTML.includes("data-type=\"removeCloud\""), provider !== 3);
            assert.equal(guide.list.innerHTML.includes("data-type=\"addCloud\""), provider !== 3);
            assert.deepEqual(guide.readiness, [false, true]);
            guide.select();
            assert.equal(guide.requests[1].url, "/api/setting/patch");
            assert.equal(guide.requests[1].data.sync.cloudName, "chosen");
            guide.requests[1].reply({code: 0});
            assert.equal(guide.sync.cloudName, "chosen");
            assert.equal(guide.requests[2].url, "/api/sync/listCloudSyncDir");
        });

        test(`the guide requires a selected directory (provider=${provider}, mobile=${mobile})`, async () => {
            const guide = loadSyncGuide(mobile, provider);
            guide.render();
            guide.requests[0].reply(listResponse("main", "work"));
            await tick();
            assert.deepEqual(guide.readiness, [false, false]);
        });
    }

    for (const field of ["endpoint", "accessKey", "secretKey", "bucket", "region"] as const) {
        test(`S3 requires ${field} before enabling the guide (mobile=${mobile})`, () => {
            const guide = loadSyncGuide(mobile, 2);
            guide.sync.s3[field] = "   ";
            guide.render();
            assert.deepEqual(guide.readiness, [false]);
            assert.match(guide.list.innerHTML, /Configure storage/);
            assert.doesNotMatch(guide.list.innerHTML, /type="radio"|data-type="selectCloud"/);
            assert.equal(guide.sync.cloudName, "work");
            assert.equal(guide.requests.length, 0);
        });
    }

    test(`a pending listing cannot overwrite the UI after switching provider (mobile=${mobile})`, async () => {
        const guide = loadSyncGuide(mobile, 0);
        guide.render();
        guide.sync.provider = 2;
        guide.render();
        const bucketHTML = guide.list.innerHTML;
        guide.requests[0].reply(listResponse("work", "work"));
        await tick();
        assert.equal(guide.list.innerHTML, bucketHTML);
        assert.match(guide.list.innerHTML, /notes\.backup/);
        assert.deepEqual(guide.readiness, [false, true]);
    });
}
