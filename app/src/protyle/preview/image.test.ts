import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("image preview initializes its toolbar when ready is dispatched on the source element", async () => {
    const actions = ["zoom-in", "zoom-out", "one-to-one", "reset", "prev", "play", "next",
        "rotate-left", "rotate-right", "flip-horizontal", "flip-vertical", "copy", "close"];
    const buttons = new Map(actions.map(action => {
        const attributes = new Map<string, string>();
        return [`.viewer-${action}`, {
            innerHTML: "",
            attributes,
            classList: new Set<string>(),
            setAttribute: (name: string, value: string) => attributes.set(name, value),
        }];
    }));
    const copied: string[] = [];
    const sourceElement = new EventTarget();
    class TestViewer {
        public viewed = true;
        public image = {src: "blob:first"};
        public toolbar = {
            querySelector: (selector: string) => {
                assert.ok(buttons.has(selector));
                return buttons.get(selector);
            },
        };

        constructor(element: EventTarget, public options: {
            ready: EventListener,
            toolbar: {copy: () => void},
        }) {
            element.addEventListener("ready", options.ready);
        }

        public show() {
            // Viewer.js 将生命周期事件派发给源元素，回调的 this 指向该元素。
            sourceElement.dispatchEvent(new Event("ready"));
        }
    }
    const source = readFileSync("src/protyle/preview/image.ts", "utf8");
    const compiled = transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports = {} as {previewImages: (sources: string[]) => void};
    const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
    const previewWindow = {siyuan: {languages, viewer: undefined as TestViewer}};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            Constants: {PROTYLE_CDN: ""},
            addScript: () => Promise.resolve(),
            copyPNGByLink: (src: string) => copied.push(src),
        }),
        document: {createElement: () => sourceElement},
        window: previewWindow,
        Viewer: TestViewer,
    });
    exports.previewImages(["blob:first", "blob:second"]);
    await Promise.resolve();
    const instance = previewWindow.siyuan.viewer;
    assert.match(buttons.get(".viewer-copy").innerHTML, /#iconCopy/);
    assert.equal(buttons.get(".viewer-copy").attributes.get("aria-label"), "Copy as PNG");
    buttons.forEach(button => {
        assert.ok(button.classList.has("ariaLabel"));
        assert.equal(button.attributes.has("title"), false);
        assert.ok(button.attributes.get("aria-label"));
        assert.equal(button.attributes.get("data-position"), "north");
    });
    instance.options.toolbar.copy();
    instance.image.src = "blob:second";
    instance.options.toolbar.copy();
    assert.deepEqual(copied, ["blob:first", "blob:second"]);
});
