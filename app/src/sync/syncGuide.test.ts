import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

type ListResponse = {
    code: number;
    msg?: string;
    data?: {
        syncDirs: {cloudName: string, hSize: string, updated: string}[];
        checkedSyncDir: string;
    };
};

const loadSyncGuide = (mobile: boolean, provider: number) => {
    const source = readFileSync(resolve(process.cwd(), "src/sync/syncGuide.ts"), "utf8");
    const processed = parse(source, {MOBILE: mobile, BROWSER: true}, false, true);
    const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const sync = {provider, cloudName: "work"};
    const requests: {url: string, data: {name?: string}, reply: (response: ListResponse) => void}[] = [];
    const moduleExports = {} as {
        renderSyncCloudList: (element: Element, reload: boolean, cb: (ready: boolean) => void) => void;
        bindSyncCloudListEvent: (element: Element, cb?: (ready: boolean) => void) => void;
    };
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan: {config: {sync}, languages: {emptyContent: "Empty", cloudConfigTip: "Configure storage"}}},
        require: (name: string) => {
            if (name === "../util/fetch") {
                return {fetchPost: (url: string, data: {name?: string}, reply: (response: ListResponse) => void) => {
                    requests.push({url, data, reply});
                }};
            }
            if (name === "../util/hostCapabilities") {
                return {sanitizeKernelHTML: (html: string) => html};
            }
            return {};
        },
    });
    let click: (event: Event) => void;
    const list = {
        innerHTML: "",
        firstElementChild: null,
        addEventListener: (_name: string, cb: (event: Event) => void) => {
            click = cb;
        },
    } as unknown as Element;
    const readiness: boolean[] = [];
    return {
        ...moduleExports, list, requests, sync, readiness,
        render: () => moduleExports.renderSyncCloudList(list, true, (ready) => readiness.push(ready)),
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
    test(`S3 displays the bucket read-only and allows the guide to continue (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 2);
        guide.render();
        assert.deepEqual(guide.readiness, [false]);
        guide.requests[0].reply(listResponse("notes.backup", ""));
        assert.match(guide.list.innerHTML, /notes\.backup/);
        assert.doesNotMatch(guide.list.innerHTML, /type="radio"|data-type="(?:selectCloud|addCloud|removeCloud)"/);
        assert.deepEqual(guide.readiness, [false, true]);
        assert.equal(guide.sync.cloudName, "work");
        guide.select();
        assert.equal(guide.requests.length, 1);
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
            assert.equal(guide.requests[1].url, "/api/sync/setCloudSyncDir");
            assert.equal(guide.requests[1].data.name, "chosen");
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

    for (const failure of ["empty", "error"]) {
        test(`S3 ${failure} listings do not enable the guide (mobile=${mobile})`, () => {
            const guide = loadSyncGuide(mobile, 2);
            guide.render();
            guide.requests[0].reply(failure === "empty" ? {
                code: 0, data: {syncDirs: [], checkedSyncDir: "work"},
            } : {code: 1, msg: "Denied"});
            assert.deepEqual(guide.readiness, [false, false]);
            assert.match(guide.list.innerHTML, failure === "empty" ? /Empty/ : /Denied/);
            assert.doesNotMatch(guide.list.innerHTML, /type="radio"|data-type="selectCloud"/);
            assert.equal(guide.sync.cloudName, "work");
        });
    }

    test(`a pending listing cannot overwrite the UI after switching provider (mobile=${mobile})`, () => {
        const guide = loadSyncGuide(mobile, 2);
        guide.render();
        guide.sync.provider = 0;
        guide.list.innerHTML = "new provider";
        guide.requests[0].reply(listResponse("notes.backup", ""));
        assert.equal(guide.list.innerHTML, "new provider");
        assert.deepEqual(guide.readiness, [false]);
    });
}
