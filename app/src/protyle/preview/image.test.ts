import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("image preview initializes its toolbar when ready is dispatched on the source element", async () => {
    const actions = ["zoom-in", "zoom-out", "one-to-one", "reset", "prev", "play", "next",
        "rotate-left", "rotate-right", "flip-horizontal", "flip-vertical", "copy", "copy-file", "close"];
    class Classes extends Set<string> {
        public toggle(name: string, force: boolean) {
            if (force) {
                this.add(name);
            } else {
                this.delete(name);
            }
        }
    }
    const buttons = new Map(actions.map(action => {
        const attributes = new Map<string, string>();
        return [`.viewer-${action}`, {
            innerHTML: "",
            attributes,
            classList: new Classes(),
            setAttribute: (name: string, value: string) => attributes.set(name, value),
        }];
    }));
    const copied: string[] = [];
    const copiedFiles: string[] = [];
    let supportsFiles = true;
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
            view: () => void,
            viewed: () => void,
            toolbar: {copy: () => void, copyFile: () => void},
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
    const previewWindow = {
        siyuan: {languages, viewer: undefined as TestViewer},
        location: {href: "http://localhost:6806/stage/build/app/", origin: "http://localhost:6806"},
    };
    runInNewContext(compiled, {
        exports,
        require: () => ({
            Constants: {PROTYLE_CDN: ""},
            addScript: () => Promise.resolve(),
            copyPNGByLink: (src: string) => copied.push(src),
            writeAssetToClipboard: (src: string) => ({ignore: !supportsFiles, click: () => copiedFiles.push(src)}),
            isEncryptedBox: (box: string) => box === "encrypted",
        }),
        document: {createElement: () => sourceElement},
        window: previewWindow,
        Viewer: TestViewer,
        URL,
    });
    exports.previewImages(["blob:first", "blob:second"]);
    await Promise.resolve();
    const instance = previewWindow.siyuan.viewer;
    assert.match(buttons.get(".viewer-copy").innerHTML, /#iconImage/);
    assert.match(buttons.get(".viewer-copy-file").innerHTML, /#iconFile/);
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
    const fileButton = buttons.get(".viewer-copy-file");
    for (const src of ["blob:test", "data:image/png;base64,test", "https://example.com/assets/test.png",
        "http://localhost:6806/assets/test.png?box=encrypted", "http://localhost:6806/emojis/test.png"]) {
        instance.image.src = src;
        instance.options.viewed();
        assert.ok(fileButton.classList.has("fn__none"));
        instance.options.toolbar.copyFile();
    }
    assert.deepEqual(copiedFiles, []);
    instance.image.src = "http://localhost:6806/assets/a%20b.gif?box=plain&style=thumb#image";
    instance.options.viewed();
    assert.equal(fileButton.classList.has("fn__none"), false);
    instance.options.toolbar.copyFile();
    assert.deepEqual(copiedFiles, ["assets/a b.gif?box=plain"]);
    instance.options.view();
    assert.ok(fileButton.classList.has("fn__none"));
    supportsFiles = false;
    instance.options.viewed();
    assert.ok(fileButton.classList.has("fn__none"));
    instance.options.toolbar.copyFile();
    assert.equal(copiedFiles.length, 1);
});
