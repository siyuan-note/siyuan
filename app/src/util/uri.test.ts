import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {normalizeSiYuanUri} from "./normalizeSiYuanUri";

const preprocess: (source: string, options: {MOBILE: boolean, BROWSER: boolean}) => string =
    require("ifdef-loader/preprocessor").parse;
const compile = (file: string, mobile?: boolean) => {
    const source = readFileSync(file, "utf8");
    return transpileModule(mobile === undefined ? source : preprocess(source, {MOBILE: mobile, BROWSER: true}), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
};
const pathNameSource = compile("src/util/pathName.ts");
const blockID = "20261005102632-zgrg57v";
const itemID = "20250320010128-npql7i1";

// 复现 Chrome 114 报告中的自定义协议解析结果，标准协议仍使用原生 URL 行为。
class LegacyURL extends URL {
    get hostname() {
        return ["siyuan:", "web+siyuan:"].includes(this.protocol) ? "" : super.hostname;
    }

    get pathname() {
        return ["siyuan:", "web+siyuan:"].includes(this.protocol) ? "//" + super.host + super.pathname : super.pathname;
    }
}

const createParser = (URLClass: typeof URL) => {
    const exports = {} as typeof import("./pathName");
    runInNewContext(pathNameSource, {
        exports,
        URL: URLClass,
        require: () => ({normalizeSiYuanUri}),
    });
    return exports;
};

test("block URI parsing recovers legacy WebView hosts and preserves database and focus parameters", () => {
    for (const URLClass of [URL, LegacyURL]) {
        const parser = createParser(URLClass);
        for (const protocol of ["siyuan", "web+siyuan"]) {
            const uri = `${protocol}://blocks/${blockID}?focus=1&fullscreen=1&avItemID=${itemID}&avViewID=${itemID}&avGroupID=${itemID}&avStandalone=1#anchor`;
            const expected = {id: blockID, focus: true, fullscreen: true, avItemID: itemID,
                avViewID: itemID, avGroupID: itemID, avStandalone: true};
            assert.deepEqual({...parser.parseSiYuanUriInfo(uri)}, expected);
            assert.deepEqual({...parser.parseSiYuanUriInfo(new URLClass(uri))}, expected);
        }
        for (const value of ["", "0", "true"]) {
            const info = parser.parseSiYuanUriInfo(`siyuan://blocks/${blockID}?focus=${value}&avStandalone=${value}`);
            assert.equal(info.focus, false);
            assert.equal(info.avStandalone, false);
        }
    }
});

test("URI normalization preserves original protocol, event URL and encoded plugin paths", () => {
    for (const URLClass of [URL, LegacyURL]) {
        for (const protocol of ["siyuan", "web+siyuan"]) {
            const uri = new URLClass(`${protocol}://plugins/plugin-sample/a%2Fb?data=%7B%22value%22%3A%22a%26b%22%7D#anchor`);
            const normalized = normalizeSiYuanUri(uri);
            assert.equal(normalized.protocol, `${protocol}:`);
            assert.equal(normalized.hostname, "plugins");
            assert.equal(normalized.pathname, "/plugin-sample/a%2Fb");
            assert.equal(normalized.searchParams.get("data"), '{"value":"a&b"}');
            assert.equal(normalized.href, uri.href);
            if (URLClass === URL) {
                assert.equal(normalized, uri);
            }
        }
    }
});

test("block URI parsing continues to reject unrelated protocols, invalid IDs and database parameters", () => {
    for (const URLClass of [URL, LegacyURL]) {
        const parser = createParser(URLClass);
        for (const uri of [null, undefined, "invalid", `https://blocks/${blockID}`, `siyuan://other/${blockID}`,
            "siyuan://blocks/invalid", `siyuan://blocks/${blockID}?avItemID=invalid`,
            `siyuan://blocks/${blockID}?avViewID=invalid`, `siyuan://blocks/${blockID}?avGroupID=invalid`,
            `siyuan:////blocks/${blockID}`, `siyuan://blocks:65536/${blockID}`]) {
            assert.equal(parser.parseSiYuanUriInfo(uri), null, String(uri));
        }
    }
});

const constants = {CB_GET_FOCUS: "focus", CB_GET_HL: "highlight", CB_GET_ALL: "all",
    CB_GET_CONTEXT: "context", CB_GET_ROOTSCROLL: "rootScroll"};

const createDispatcher = (URLClass: typeof URL, mobile: boolean, exists = true) => {
    const parser = createParser(URLClass);
    const requests: {url: string, id: string}[] = [];
    const opens: {id: string, action: string[]}[] = [];
    const events: {type: string, url: string}[] = [];
    const bazaar: {type: string, name: string, from: string}[] = [];
    const exports = {} as typeof import("./uri");
    const dependencies = {
        ...parser,
        normalizeSiYuanUri,
        Constants: constants,
        fetchPost: (url: string, data: {id: string}, callback: (response: {data: boolean}) => void) => {
            requests.push({url, id: data.id});
            callback({data: exists});
        },
        checkFold: (_id: string, callback: (zoomIn: boolean) => void) => callback(false),
        openStandaloneDatabaseItemByURI: () => false,
        openFileById: (options: {id: string, action: string[]}) => opens.push(options),
        openMobileFileById: (_app: unknown, id: string, action: string[]) => opens.push({id, action}),
        forEachPluginSubscriber: (type: string, callback: (bus: {emit: (type: string, detail: {url: string}) => void}) => void) =>
            callback({emit: (_type, detail) => events.push({type, url: detail.url})}),
        isBazaarAvailable: () => true,
        isValidBazaarPackageName: (name: string) => /^[a-zA-Z0-9-]+$/.test(name),
        openBazaarReadme: (_app: unknown, type: string, name: string, from: string) => bazaar.push({type, name, from}),
    };
    runInNewContext(compile("src/util/uri.ts", mobile), {
        exports,
        URL: URLClass,
        window: {siyuan: {}},
        require: () => dependencies,
    });
    const app = {plugins: [{name: "plugin-sample", eventBus: {
        emit: (type: string, detail: {url: string}) => events.push({type, url: detail.url}),
    }}]} as unknown as Parameters<typeof exports.processSiYuanUri>[0];
    return {exports, app, requests, opens, events, bazaar};
};

test("reported agent block links reach document navigation in both desktop and mobile builds", () => {
    for (const URLClass of [URL, LegacyURL]) {
        for (const mobile of [false, true]) {
            for (const protocol of ["siyuan", "web+siyuan"]) {
                const context = createDispatcher(URLClass, mobile);
                const uri = `${protocol}://blocks/${blockID}`;
                assert.equal(context.exports.processSiYuanUri(context.app, uri), true);
                assert.deepEqual(context.requests, [{url: "/api/block/checkBlockExist", id: blockID}]);
                assert.equal(context.opens[0].id, blockID);
                assert.deepEqual(Array.from(context.opens[0].action), ["highlight", "context", "rootScroll"]);
                assert.deepEqual(context.events, [{type: "open-siyuan-url-block", url: uri}]);
            }
        }
    }
});

test("missing blocks retain the existence guard and invalid schemes make no requests", () => {
    for (const URLClass of [URL, LegacyURL]) {
        const context = createDispatcher(URLClass, true, false);
        assert.equal(context.exports.processSiYuanUri(context.app, `siyuan://blocks/${blockID}`), true);
        assert.equal(context.requests.length, 1);
        assert.equal(context.opens.length, 0);
        for (const uri of ["invalid", `https://blocks/${blockID}`, `siyuan://other/${blockID}`]) {
            assert.equal(context.exports.processSiYuanUri(context.app, uri), false);
        }
        assert.equal(context.requests.length, 1);
    }
});

test("legacy plugin and bazaar links preserve destinations and original event URLs", async () => {
    for (const URLClass of [URL, LegacyURL]) {
        for (const mobile of [false, true]) {
            for (const protocol of ["siyuan", "web+siyuan"]) {
                const context = createDispatcher(URLClass, mobile);
                const uri = `${protocol}://plugins/plugin-sample/a%2Fb?value=a%26b#anchor`;
                assert.equal(context.exports.processSiYuanUri(context.app, uri), true);
                assert.deepEqual(context.events, [{type: "open-siyuan-url-plugin", url: uri}]);
                for (const target of ["readme", "readme-installed"]) {
                    assert.equal(context.exports.processSiYuanUri(context.app,
                        `${protocol}://bazaar/plugins/plugin-sample/${target}`), true);
                }
                await new Promise(resolve => setImmediate(resolve));
                assert.deepEqual(context.bazaar, [
                    {type: "plugins", name: "plugin-sample", from: "bazaar"},
                    {type: "plugins", name: "plugin-sample", from: "downloaded"},
                ]);
                assert.equal(context.requests.length, 0);
            }
        }
    }
});
