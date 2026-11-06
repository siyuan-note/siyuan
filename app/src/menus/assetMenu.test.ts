import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("protyle.ts", readFileSync(join(__dirname, "protyle.ts"), "utf8"), ScriptTarget.Latest);
const declarations = ["renderAssetPreview", "renderAssetList"].map(name => {
    const declaration = source.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(source) === name));
    assert.ok(declaration);
    return declaration.getText(source);
}).join("\n");

const fixture = (mobile: boolean) => {
    const code = declarations.replace(
        /\/\/\/ #if MOBILE\s*([\s\S]*?)\/\/\/ #else\s*([\s\S]*?)\/\/\/ #endif/g,
        (_match, mobileCode, desktopCode) => mobile ? mobileCode : desktopCode,
    );
    const calls: string[] = [];
    const previews: string[] = [];
    let current = true;
    const responses: Array<(response: {data: Array<{path: string, hName: string}>}) => void> = [];
    const input = {select: () => calls.push("select")};
    const list = {innerHTML: ""};
    const preview = {innerHTML: "", dataset: {} as Record<string, string>};
    const element = {querySelector: (selector: string) => selector === "input" ? input :
        selector === ".b3-list" ? list : preview};
    const render = runInNewContext(transpileModule(code + "\nrenderAssetList;", {
        compilerOptions: {target: ScriptTarget.ES2020},
    }).outputText, {
        isMobile: () => mobile,
        fetchPost: (_url: string, _data: unknown, callback: typeof responses[number]) => responses.push(callback),
        renderAssetsPreview: (path: string) => { previews.push(path); return path; },
        window: {siyuan: {languages: {emptyContent: "Empty"}, menus: {menu: {
            fullscreen: () => calls.push("fullscreen"), popup: () => calls.push("popup"),
        }}}},
    });
    const session = {isCurrent: () => current, show: (show: () => void) => show()};
    const search = (query: string, initial = false) => render(element, query, {}, [], session, initial);
    const respond = (items = [{path: "assets/example.png", hName: "example.png"}]) => responses.shift()({data: items});
    return {calls, previews, input, list, preview, search, respond, close: () => { current = false; }};
};

test("mobile asset searches update results without reopening the sheet or stealing input focus", () => {
    const f = fixture(true);
    f.search("", true);
    f.respond();
    assert.deepEqual(f.calls, ["fullscreen"]);
    for (const query of ["example", ""]) {
        f.search(query);
        f.respond([]);
        assert.equal(f.list.innerHTML, '<li class="b3-list--empty">Empty</li>');
        assert.equal(f.preview.innerHTML, "Empty");
        assert.deepEqual(f.calls, ["fullscreen"]);
    }
    f.search("late result");
    f.close();
    f.respond();
    assert.equal(f.preview.innerHTML, "Empty");
    assert.deepEqual(f.calls, ["fullscreen"]);
});

test("desktop asset searches keep popup positioning and empty-query selection", () => {
    const f = fixture(false);
    f.search("", true);
    f.respond();
    f.search("example");
    f.respond();
    f.search("");
    f.respond();
    assert.deepEqual(f.calls, ["popup", "select", "popup", "popup", "select"]);
    assert.equal(f.preview.innerHTML, "assets/example.png");
});

for (const mobile of [false, true]) {
    test(`asset previews reuse the same resource and reset after empty results (mobile=${mobile})`, () => {
        const f = fixture(mobile);
        f.search("", true);
        f.respond();
        f.search("example");
        f.respond();
        assert.deepEqual(f.previews, ["assets/example.png"]);
        f.search("empty");
        f.respond([]);
        assert.equal(f.preview.innerHTML, "Empty");
        f.search("example");
        f.respond();
        assert.deepEqual(f.previews, ["assets/example.png", "assets/example.png"]);
    });
}
