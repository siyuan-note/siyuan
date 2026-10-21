import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {escapeHtml} from "../util/escape";

const {parse} = require("ifdef-loader/preprocessor");

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
    const requests: {url: string, data: {name?: string; sync?: {cloudName: unknown}}, reply: (response: ListResponse) => void}[] = [];
    const moduleExports = {} as {
        renderSyncCloudList: (element: Element, reload: boolean, cb: (ready: boolean) => void) => void;
        bindSyncCloudListEvent: (element: Element, cb?: (ready: boolean) => void) => void;
        refreshSyncCloudDirBlock: (root: Element) => void;
        syncGuide: () => void;
    };
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan: {config: {sync}, languages: {emptyContent: "Empty", cloudConfigTip: "Configure storage"}}},
        require: (name: string) => {
            if (name === "./checkoutProgress") return {openSyncCheckoutProgress: () => activeCheckout};
            if (name === "../config/util/configApi") {
                return {config: {set: (_path: string, value: unknown, applied?: () => void) => {
                    requests.push({url: "/api/setting/patch", data: {sync: {cloudName: value}}, reply: (response: ListResponse) => {
                        if (response.code === 0) { sync.cloudName = String(value); applied?.(); }
                    }});
                    return Promise.resolve();
                }}};
            }
            if (name === "../util/fetch") {
                return {fetchPost: (url: string, data: {name?: string}, reply: (response: ListResponse) => void) => {
                    requests.push({url, data, reply});
                }};
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
        innerHTML: "",
        firstElementChild: null as Element | null,
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
    return {
        ...moduleExports, list, elementList, listClasses, configButtonClasses, requests, sync, readiness,
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
        Object.defineProperty(guide.list, "firstElementChild", {value: {tagName: "DIV"}});
        guide.sync.s3.bucket = "<img src=x onerror=alert(1)>&";
        guide.renderSyncCloudList(guide.list, false, ready => guide.readiness.push(ready));
        assert.match(guide.list.innerHTML, /&lt;img src=x onerror=alert\(1\)>&amp;/);
        assert.doesNotMatch(guide.list.innerHTML, /<img|notes\.backup/);
        assert.equal(guide.requests.length, 0);
        assert.deepEqual(guide.readiness, [true, true]);
    });

    for (const provider of [0, 3, 4]) {
        test(`directory selection remains available (provider=${provider}, mobile=${mobile})`, () => {
            const guide = loadSyncGuide(mobile, provider);
            guide.render();
            guide.requests[0].reply(listResponse("work", "work"));
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

        test(`the guide requires a selected directory (provider=${provider}, mobile=${mobile})`, () => {
            const guide = loadSyncGuide(mobile, provider);
            guide.render();
            guide.requests[0].reply(listResponse("main", "work"));
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

    test(`a pending listing cannot overwrite the UI after switching provider (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 0);
        guide.render();
        guide.sync.provider = 2;
        guide.render();
        const bucketHTML = guide.list.innerHTML;
        guide.requests[0].reply(listResponse("work", "work"));
        assert.equal(guide.list.innerHTML, bucketHTML);
        assert.match(guide.list.innerHTML, /notes\.backup/);
        assert.deepEqual(guide.readiness, [false, true]);
    });
}
