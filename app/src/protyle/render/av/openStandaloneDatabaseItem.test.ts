import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (path: string) => transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;
const compiled = compile("src/protyle/render/av/openStandaloneDatabaseItem.ts");

const createContext = (options: {missing?: boolean, denied?: boolean, invalidBlock?: boolean, detached?: boolean} = {}) => {
    const requests: {url: string, data: Record<string, string>}[] = [];
    const opened: {data: Record<string, unknown>, options: Record<string, unknown>}[] = [];
    const messages: string[] = [];
    const exports = {} as typeof import("./openStandaloneDatabaseItem");
    runInNewContext(compiled, {
        exports,
        console,
        window: {siyuan: {languages: {databaseItemNotFound: "missing"}}},
        DOMParser: class {
            parseFromString() {
                return {body: {firstElementChild: {getAttribute: (name: string) => ({
                    "data-node-id": "database",
                    "data-type": options.invalidBlock ? "NodeParagraph" : "NodeAttributeView",
                    "data-av-id": "av",
                })[name]}}};
            }
        },
        require: (name: string) => {
            if (name.endsWith("/fetch")) {
                return {fetchSyncPost: async (url: string, data: Record<string, string>) => {
                    requests.push({url, data});
                    if (options.denied) {
                        return {code: -1, data: null};
                    }
                    if (url.endsWith("getBlockDOM")) {
                        return {code: 0, data: {dom: ""}};
                    }
                    if (url.endsWith("getBlockInfo")) {
                        return {code: 0, data: {box: "notebook"}};
                    }
                    return {code: 0, data: options.missing ? [] : [{avID: "av", keyValues: [{
                        key: {type: "block"},
                        values: [{id: "value", blockID: "item", isDetached: options.detached,
                            block: {content: "Title", id: "bound"}}],
                    }]}]};
                }};
            }
            if (name.endsWith("/message")) {
                return {showMessage: (message: string) => messages.push(message)};
            }
            return {openDatabaseRowByData: async (_context: unknown, data: Record<string, unknown>,
                                                 rowOptions: Record<string, unknown>) => {
                opened.push({data, options: rowOptions});
                return true;
            }};
        },
    });
    return {exports, requests, opened, messages};
};

describe("standalone database item links", () => {
    it("reads bound and detached items without requesting a view or locating a group", async () => {
        for (const detached of [false, true]) {
            const context = createContext({detached});
            assert.equal(await context.exports.openStandaloneDatabaseItem(null, "database", "item"), true);
            assert.equal(context.requests.length, 3);
            assert.equal(context.requests[2].url, "/api/av/getAttributeViewKeys");
            assert.equal(context.requests[2].data.itemID, "item");
            assert.equal(context.requests[2].data.viewID, undefined);
            assert.equal(context.opened[0].options.standalone, true);
            assert.equal(context.opened[0].data.valueID, "value");
            assert.equal(context.opened[0].data.notebookID, "notebook");
        }
    });

    it("does not open missing items, invalid carrier blocks or denied data", async () => {
        for (const options of [{missing: true}, {invalidBlock: true}, {denied: true}]) {
            const context = createContext(options);
            assert.equal(await context.exports.openStandaloneDatabaseItem(null, "database", "item"), false);
            assert.equal(context.opened.length, 0);
        }
    });

    it("leaves legacy links and standalone flags without an item to normal navigation", () => {
        const context = createContext();
        for (const info of [{avItemID: "item"}, {avItemID: "item", avStandalone: false}, {avStandalone: true}]) {
            assert.equal(context.exports.openStandaloneDatabaseItemByURI(null, {
                id: "database", focus: false, fullscreen: false, ...info,
            }), false);
        }
        assert.equal(context.requests.length, 0);
    });

    it("parses only an explicit 1 as standalone for both supported protocols", () => {
        const exports = {} as typeof import("../../../util/pathName");
        runInNewContext(compile("src/util/pathName.ts"), {exports, URL, require: () => ({})});
        for (const protocol of ["siyuan", "web+siyuan"]) {
            for (const value of ["", "0", "1", "true"]) {
                const info = exports.parseSiYuanUriInfo(`${protocol}://blocks/20240416133402-4ev0xph?avItemID=20250320010128-npql7i1&avStandalone=${value}`);
                assert.equal(info.avStandalone, value === "1");
            }
        }
    });
});
