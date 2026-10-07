import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import {setTimeout as delay} from "node:timers/promises";
import * as ts from "typescript";
import {ParentDocClick} from "./parentDocClick";

const loadClick = (mobile: boolean, context: Record<string, unknown>) => {
    const file = mobile ? "../../mobile/dock/MobileFiles.ts" : "Files.ts";
    const source = ts.createSourceFile(file, readFileSync(join(__dirname, file), "utf8"), ts.ScriptTarget.Latest, true);
    let handler: ts.ArrowFunction | ts.MethodDeclaration;
    const visit = (node: ts.Node) => {
        if (mobile && ts.isMethodDeclaration(node) && node.name.getText(source) === "handleParentDocClick") {
            handler = node;
        } else if (!mobile && ts.isCallExpression(node) &&
            node.expression.getText(source) === "this.element.addEventListener" &&
            ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "click") {
            handler = node.arguments[1] as ts.ArrowFunction;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(handler?.body);
    const compiled = ts.transpileModule(
        `exports.click = function(${handler.parameters.map(parameter => parameter.getText(source)).join(",")}) ${handler.body.getText(source)};`,
        {compilerOptions: {target: ts.ScriptTarget.ES2020}},
    ).outputText;
    const exports: {click?: (...args: unknown[]) => void} = {};
    runInNewContext(compiled, {exports, ...context});
    return exports.click;
};

const harness = (mobile: boolean, mode: 1 | 2 = 2, expanded = false) => {
    const calls: string[] = [];
    const config = {parentDocTitleClickMode: mode};
    const attributes: Record<string, string> = {
        "data-type": "navigation-file", "data-path": "/doc.sy", "data-node-id": "doc", "data-count": "4",
    };
    const row = {isConnected: true, getAttribute: (key: string) => attributes[key],
        querySelector: () => expanded ? {} : null};
    const text = {tagName: "SPAN", parentElement: row, closest: () => text,
        classList: {contains: (name: string) => name === "b3-list-item__text"}, isEqualNode: () => false};
    const event = {target: text, button: 0, preventDefault() {}, stopPropagation() {}};
    const response = {code: 0, data: {box: "box", path: "/doc.sy", files: [] as {id: string}[]}};
    let resolveRequest: (value: typeof response) => void;
    const pending = new Promise<typeof response>(resolve => { resolveRequest = resolve; });
    const parentDocClick = new ParentDocClick();
    const toggle = () => { parentDocClick.cancel(); calls.push("toggle"); };
    const panel = {
        element: {}, app: {}, parentDocClick,
        setCurrent() {}, toggleLeaf: toggle, toggleTreeItem: toggle,
        onLsHTML: () => calls.push("render"), getOpenPaths() {},
    };
    const click = loadClick(mobile, {
        window: {siyuan: {config: {fileTree: config}, menus: {menu: {remove() {}}}}},
        options: {app: {}}, Constants: {SIYUAN_APPID: "app"},
        isNotCtrl: () => true, isPhablet: () => false, setPanelFocus() {},
        hasTopClosestByTag: () => ({getAttribute: () => "box"}),
        fetchSyncPost: (path: string, request: {notebook: string, path: string}) => {
            assert.equal(path, "/api/filetree/listDocsByPath");
            assert.equal(request.notebook, "box");
            assert.equal(request.path, "/doc.sy");
            calls.push("request");
            return pending;
        },
        toggleFileTree: (_row: unknown, _collapse: unknown, expand: () => void) => expand(),
        openFileById: () => calls.push("open"), openMobileFileById: () => calls.push("open"),
    });
    return {calls, config, attributes, row,
        click: () => click.call(panel, ...(mobile ? [row, "box"] : [event])),
        resolve: (code = 0) => resolveRequest({...response, code})};
};

test("desktop and mobile titles toggle immediately in expand-only mode", () => {
    for (const mobile of [false, true]) {
        for (const expanded of [false, true]) {
            const h = harness(mobile, 1, expanded);
            h.click();
            assert.deepEqual(h.calls, ["toggle"]);
            h.click();
            assert.equal(h.calls.includes("open"), false);
            assert.equal(h.calls.includes("request"), false);
        }
    }
});

test("double-click mode prefetches immediately and double clicks discard child responses", async () => {
    for (const mobile of [false, true]) {
        const h = harness(mobile, 2);
        h.click();
        assert.deepEqual(h.calls, ["request"]);
        h.click();
        assert.deepEqual(h.calls, ["request", "open"]);
        h.resolve();
        await delay(0);
        assert.deepEqual(h.calls, ["request", "open"]);
    }
});

test("desktop and mobile single clicks wait for data without requesting children twice", async () => {
    const contexts = [false, true].map(mobile => harness(mobile, 2));
    contexts.forEach(h => h.click());
    await delay(330);
    contexts.forEach(h => {
        assert.deepEqual(h.calls, ["request"]);
        h.resolve();
    });
    await delay(0);
    contexts.forEach(h => assert.deepEqual(h.calls, ["request", "render"]));
});

test("prefetch results cannot apply after settings, paths, attachment or expansion state change", async () => {
    const contexts = [false, true].flatMap(mobile => [0, 1, 2, 3].map(change => {
        const h = harness(mobile, 2);
        h.click();
        if (change === 0) { h.config.parentDocTitleClickMode = 1; }
        if (change === 1) { h.attributes["data-path"] = "/moved.sy"; }
        if (change === 2) { h.row.isConnected = false; }
        if (change === 3) { h.row.querySelector = () => ({}); }
        h.resolve();
        return h;
    }));
    await delay(330);
    contexts.forEach(h => assert.deepEqual(h.calls, ["request"]));
});

test("failed child requests never render prefetched lists", async () => {
    const contexts = [false, true].map(mobile => harness(mobile, 2));
    contexts.forEach(h => { h.click(); h.resolve(-1); });
    await delay(330);
    contexts.forEach(h => assert.deepEqual(h.calls, ["request"]));
});
