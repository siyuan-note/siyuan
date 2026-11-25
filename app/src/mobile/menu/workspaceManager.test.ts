import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../testSupport/loadModule";
import {escapeHtmlTextAndAttr} from "../../util/escape";

test("the workspace management sheet mounts the list and preserves removal semantics", async () => {
    let click: (event: unknown) => void;
    let confirmation: {confirm: () => Promise<boolean>, cancel: () => void};
    let complete: (response: {code: number}) => void;
    let reads = 0;
    const requests: Array<{url: string; path: string}> = [];
    const current = "/temporary/current";
    const target = "/temporary/disposable";
    const list = {innerHTML: ""};
    const root = {querySelector: () => list, addEventListener: (_: string, listener: typeof click) => { click = listener; }};
    let sheet: {title: string; content: string; destroyCallback: () => void};
    let closed = false;
    const manager = loadModule<typeof import("./workspaceManager")>("src/mobile/menu/workspaceManager.ts", {
        window: {siyuan: {config: {system: {workspaceDir: current}},
            languages: {workspaceList: "Workspaces", openBy: "Open", new: "New", removeWorkspacePhysically: "Delete ${x}"}}},
        require: (name: string) => {
            if (name === "../../dialog/adaptiveDialog") return {AdaptiveDialog: class {
                element = root;
                constructor(options: typeof sheet) { sheet = options; }
            }};
            if (name === "../../protyle/util/compatibility") return {isInMobileApp: () => true};
            if (name === "../../util/hostCapabilities") return {getHostCapabilities: () => ({workspaces: true})};
            if (name === "../../util/escape") return {escapeHtmlTextAndAttr};
            if (name === "../../dialog/confirmDialog") return {
                confirmDialog: (options: typeof confirmation) => { confirmation = options; },
            };
            if (name === "../../util/fetch") return {
                fetchPost: (url: string, data: {path: string}, callback?: (response: unknown) => void) => {
                    if (url.endsWith("getWorkspaces")) { reads++; callback?.({data: []}); }
                    else { requests.push({url, path: data.path}); callback?.({code: 0}); }
                },
                fetchSyncPost: (url: string, data: {path: string}) => {
                    requests.push({url, path: data.path});
                    return new Promise(resolve => { complete = resolve; });
                },
            };
            return {};
        },
    });
    manager.openMobileWorkspaceManager(() => { closed = true; });
    assert.equal(sheet.title, "Workspaces");
    assert.match(sheet.content, /data-type="open-workspace"/);
    assert.match(sheet.content, /data-type="create-workspace"/);
    assert.equal(reads, 1);
    const remove = (path: string) => click({target: {id: "", getAttribute: () => "remove",
        parentElement: {getAttribute: () => path}}, preventDefault() {}, stopPropagation() {}});
    remove(target);
    const confirm = confirmation.confirm;
    const cancel = confirmation.cancel;
    const failed = confirm();
    assert.equal(reads, 1);
    complete({code: -1});
    assert.equal(await failed, false);
    assert.equal(reads, 1);
    const retry = confirm();
    complete({code: 0});
    assert.equal(await retry, true);
    assert.equal(reads, 2);
    cancel();
    assert.equal(requests.at(-1).url, "/api/system/removeWorkspaceDir");
    assert.equal(requests.at(-1).path, target);
    assert.equal(requests.filter(item => item.url.endsWith("removeWorkspaceDirPhysically")).length, 2);
    remove(current);
    assert.equal(requests.at(-1).url, "/api/system/removeWorkspaceDir");
    assert.equal(requests.at(-1).path, current);
    assert.equal(closed, false);
    sheet.destroyCallback();
    assert.equal(closed, true);
});
