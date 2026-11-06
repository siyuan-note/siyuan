import * as assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createPreviewHarness = async (language = "en", zIndex = 10) => {
    const actions = ["zoom-in", "zoom-out", "one-to-one", "reset", "prev", "play", "next",
        "rotate-left", "rotate-right", "flip-horizontal", "flip-vertical", "copy", "copy-file"];
    class Classes extends Set<string> {
        public remove(name: string) {
            this.delete(name);
        }
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
    const copiedURLs: string[] = [];
    const messages: Array<{message: string, type?: string}> = [];
    let writeResult = () => Promise.resolve({status: "plain"});
    const customButtons: Array<EventTarget & {className: string, attributes: Map<string, string>}> = [];
    const copiedFiles: string[] = [];
    let supportsFiles = true;
    const sourceElement = Object.assign(new EventTarget(), {childElementCount: 2});
    class TestViewer {
        public viewed = true;
        public viewer = {
            style: {zIndex: "2015"},
            querySelector: (selector: string) => buttons.get(selector.replace(".viewer-navigation > ", "")),
        };
        public image = {src: "blob:first"};
        public toolbar = {
            querySelector: (selector: string) => {
                if (selector === "ul") {
                    return {append: (button: typeof customButtons[number]) => customButtons.push(button)};
                }
                assert.ok(buttons.has(selector));
                return buttons.get(selector);
            },
        };

        constructor(element: EventTarget, public options: {
            title: [number, (image: {alt: string}, data: {naturalWidth: number, naturalHeight: number}) => string],
            ready: EventListener,
            view: (event?: {detail: {index: number}}) => void,
            viewed: () => void,
            toolbar: {copy: () => void, copyFile: () => void},
        }) {
            element.addEventListener("ready", options.ready);
        }

        public show() {
            // Viewer.js 将生命周期事件派发给源元素，回调的 this 指向该元素。
            sourceElement.dispatchEvent(new Event("ready"));
        }

        public destroy() {}
    }
    const source = readFileSync("src/protyle/preview/image.ts", "utf8");
    const compiled = transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports = {} as {previewImages: (sources: string[]) => void};
    const languages = JSON.parse(readFileSync(`appearance/langs/${language}.json`, "utf8"));
    const previewWindow = {
        siyuan: {languages, zIndex, viewer: undefined as TestViewer},
        location: {href: "http://localhost:6806/stage/build/app/", origin: "http://localhost:6806"},
    };
    runInNewContext(compiled, {
        exports,
        require: () => ({
            Constants: {PROTYLE_CDN: ""},
            addScript: () => Promise.resolve(),
            copyPNGByLink: (src: string) => copied.push(src),
            writeClipboardData: ({textPlain}: {textPlain: string}) => {
                copiedURLs.push(textPlain);
                return writeResult();
            },
            showMessage: (message: string, _timeout?: number, type?: string) => messages.push({message, type}),
            getZIndex: (element: {style: {zIndex: string}}) => Number(element.style.zIndex),
            writeAssetToClipboard: (src: string) => ({ignore: !supportsFiles, click: () => copiedFiles.push(src)}),
            isEncryptedBox: (box: string) => box === "encrypted",
        }),
        document: {createElement: (tag: string) => {
            if (tag === "ul") {
                return sourceElement;
            }
            const attributes = new Map<string, string>();
            return Object.assign(new EventTarget(), {attributes, setAttribute: (name: string, value: string) => attributes.set(name, value)});
        }},
        window: previewWindow,
        Viewer: TestViewer,
        URL,
    });
    exports.previewImages(["assets/first image.png?box=encrypted", "https://example.com/second.png?size=2#image"]);
    await Promise.resolve();
    const instance = previewWindow.siyuan.viewer;
    const copyURLButton = customButtons.find(button => button.className.includes("viewer-copy-url"));
    return {
        instance, copyURLButton, copied, copiedURLs, copiedFiles, messages, languages, buttons, sourceElement,
        setWriteResult: (callback: typeof writeResult) => {writeResult = callback;},
        setSupportsFiles: (value: boolean) => {supportsFiles = value;},
    };
};

test("image preview initializes its toolbar and reports successful address copies from clicks and keyboard", async () => {
    const {instance, copyURLButton, copied, copiedURLs, copiedFiles, messages, languages, buttons, sourceElement,
        setSupportsFiles} = await createPreviewHarness();
    assert.equal(copyURLButton.attributes.get("role"), "button");
    assert.equal(instance.viewer.style.zIndex, "2015");
    assert.equal(copyURLButton.attributes.get("aria-label"), languages.copyImageURL);
    copyURLButton.dispatchEvent(new Event("click"));
    instance.options.view({detail: {index: 1}});
    for (const key of ["Enter", " "]) {
        const event = Object.assign(new Event("keydown", {cancelable: true}), {key});
        copyURLButton.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
    }
    assert.deepEqual(copiedURLs, ["assets/first image.png?box=encrypted",
        "https://example.com/second.png?size=2#image", "https://example.com/second.png?size=2#image"]);
    await new Promise(setImmediate);
    assert.deepEqual(messages, Array.from({length: 3}, (): {message: string, type?: string} =>
        ({message: languages.copied, type: undefined})));
    instance.viewed = false;
    copyURLButton.dispatchEvent(new Event("click"));
    await new Promise(setImmediate);
    assert.equal(copiedURLs.length, 3);
    assert.equal(messages.length, 3);
    instance.viewed = true;
    instance.options.view({detail: {index: 0}});
    const title = () => instance.options.title[1]({alt: "photo.png"}, {naturalWidth: 640, naturalHeight: 480});
    assert.equal(title(), "1/2 photo [640 × 480]");
    instance.options.view({detail: {index: 1}});
    assert.equal(title(), "2/2 photo [640 × 480]");
    instance.options.view({detail: {index: 0}});
    sourceElement.childElementCount = 1;
    assert.equal(title(), "1/1 photo [640 × 480]");
    assert.match(buttons.get(".viewer-copy").innerHTML, /#iconImage/);
    assert.match(buttons.get(".viewer-copy-file").innerHTML, /#iconFile/);
    assert.equal(buttons.get(".viewer-copy").attributes.get("aria-label"), "Copy as PNG");
    buttons.forEach((button, selector) => {
        assert.ok(button.classList.has("ariaLabel"));
        assert.equal(button.attributes.has("title"), false);
        assert.ok(button.attributes.get("aria-label"));
        assert.equal(button.attributes.get("data-position"), selector === ".viewer-prev" ? "east" :
            selector === ".viewer-next" ? "west" : "north");
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
    setSupportsFiles(false);
    instance.options.viewed();
    assert.ok(fileButton.classList.has("fn__none"));
    instance.options.toolbar.copyFile();
    assert.equal(copiedFiles.length, 1);
});

test("image address copy waits for clipboard completion before reporting success", async () => {
    const {copyURLButton, messages, languages, setWriteResult} = await createPreviewHarness();
    let finish: (result: {status: string}) => void;
    setWriteResult(() => new Promise(resolve => {finish = resolve;}));
    copyURLButton.dispatchEvent(new Event("click"));
    await new Promise(setImmediate);
    assert.deepEqual(messages, []);
    finish({status: "plain"});
    await new Promise(setImmediate);
    assert.deepEqual(messages, [{message: languages.copied, type: undefined}]);
});

test("image preview stays above an existing high application layer", async () => {
    const {instance} = await createPreviewHarness("en", 3000);
    assert.equal(instance.viewer.style.zIndex, "3001");
});

for (const rejected of [false, true]) {
    test(`image address copy reports ${rejected ? "rejected" : "failed"} clipboard writes without a success message`, async () => {
        const {copyURLButton, messages, languages, setWriteResult} = await createPreviewHarness();
        setWriteResult(() => rejected ? Promise.reject(new Error("Clipboard unavailable")) : Promise.resolve({status: "failed"}));
        copyURLButton.dispatchEvent(new Event("click"));
        await new Promise(setImmediate);
        assert.deepEqual(messages, [{message: languages.copyImageURLFailed, type: "error"}]);
    });
}

test("image address copy uses a complete translated phrase in every supported language", async () => {
    const files = readdirSync("appearance/langs").filter(file => file.endsWith(".json"));
    assert.equal(files.length, 22);
    for (const file of files) {
        const {copyURLButton, languages} = await createPreviewHarness(file.slice(0, -5));
        assert.ok(languages.copyImageURL?.trim(), file);
        assert.ok(languages.copyImageURLFailed?.trim(), file);
        assert.equal(copyURLButton.attributes.get("aria-label"), languages.copyImageURL, file);
    }
    assert.equal((await createPreviewHarness("zh-CN")).copyURLButton.attributes.get("aria-label"), "复制图片地址");
    assert.equal((await createPreviewHarness("ja")).copyURLButton.attributes.get("aria-label"), "画像の URL をコピー");
});
