import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import * as ts from "typescript";

const loadModule = (file: string, dependencies: Record<string, object>) => {
    const exports: Record<string, any> = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, file), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        window: {siyuan: {config: {fileTree: {maxOpenTabCount: 10}}}},
        require: (name: string) => dependencies[name] || {},
    });
    return exports;
};

const resize = loadModule("../protyle/util/resize.ts", {});

describe("moving an editor tab preserves its reading position", () => {
    for (const anchor of [true, false]) {
        it(`restores before returning after DOM movement and focus, with anchor=${anchor}`, () => {
            let marked = anchor;
            let blockTop = 1700;
            const content = {
                scrollTop: 1726.5,
                getBoundingClientRect: () => ({top: 80}),
            };
            const block = {
                getBoundingClientRect: () => ({top: 80 + blockTop - content.scrollTop}),
                getAttribute: () => "26.5",
                removeAttribute: () => { marked = false; },
            };
            const protyle = {
                contentElement: content,
                wysiwyg: {element: {querySelector: () => marked ? block : null}},
                toolbar: {},
            };
            class Editor {
                editor = {protyle};
            }
            const {Wnd} = loadModule("Wnd.ts", {
                "../editor": {Editor},
                "../protyle/util/resize": resize,
                "../protyle/ui/hideElements": {hideAllElements: () => {}},
                "./tabUtil": {setTabPosition: () => {}, resizeTabs: () => {}},
            });
            const tab = {
                model: new Editor(),
                parent: {
                    children: [{}],
                    remove: () => { blockTop = 1300; },
                },
            };
            const target = Object.create(Wnd.prototype);
            target.element = {querySelector: () => ({append: () => { content.scrollTop = 0; }})};
            target.children = [];
            target.switchTab = () => { content.scrollTop = 0; };

            target.moveTab(tab);

            assert.equal(content.scrollTop, anchor ? 1326.5 : 1726.5);
            assert.equal(tab.parent, target);
            assert.equal(target.children[0], tab);
            assert.equal(marked, anchor);
            if (anchor) {
                // 尺寸动画改变块位置后，延迟校准仍使用同一锚点，且不会重复叠加偏移。
                blockTop = 1400;
                assert.equal(resize.restoreBeforeResizeTop(protyle), true);
                assert.equal(content.scrollTop, 1426.5);
                assert.equal(marked, false);
                assert.equal(resize.restoreBeforeResizeTop(protyle), false);
                assert.equal(content.scrollTop, 1426.5);
            }
        });
    }
});
