import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
const {createMockRequire} = require("../../../tests/fixtures/mockModules.cjs");

test("reading mode opens PlantUML only on double click and keeps ordinary image clicks", () => {
    const compiled = transpileModule(readFileSync("src/protyle/preview/index.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const elements: Array<{listeners: Record<string, (event: unknown) => void>}> = [];
    let diagramPreviews = 0;
    const imagePreviews: unknown[][] = [];
    const diagram = {getAttribute: () => "plantuml"};
    const exports = {} as {Preview: new (protyle: unknown) => unknown};
    runInNewContext(compiled, {
        exports,
        require: createMockRequire({
            ...Object.fromEntries(["../util/compatibility", "../util/selectionOffsets", "../../editor/openLink",
                "../../dialog/message", "../../util/needSubscribe", "../util/richClipboard", "../../layout/getAll",
                "../../util/fetch", "../util/processCode", "../render/tabsRender", "../render/highlightRender",
                "../render/speechRender", "../render/av/render", "../ui/initUI", "./platformCopy", "./wechatMath",
                "../../util/hostCapabilities", "../render/autoDirection"].map(name => [name, {}])),
            "./diagram": {
                getDiagramBlock: (element: unknown) => element,
                previewDiagram: (element: unknown) => { assert.equal(element, diagram); diagramPreviews++; },
            },
            "./image": {previewDocImage: (...args: unknown[]) => { imagePreviews.push(args); }},
            "../util/hasClosest": {hasTopClosestByAttribute: (): false => false},
            "../../constants": {Constants: {CUSTOM_SY_LIVE_PHOTO: "custom-sy-live-photo",
                CUSTOM_SY_LIVE_PHOTO_VIDEO: "custom-sy-live-photo-video"}},
        }),
        document: {
            addEventListener: () => {},
            createElement: () => {
                const element = {
                    listeners: {} as Record<string, (event: unknown) => void>,
                    appendChild: () => {},
                    addEventListener: (type: string, listener: (event: unknown) => void) => { element.listeners[type] = listener; },
                };
                elements.push(element);
                return element;
            },
        },
    });
    new exports.Preview({options: {classes: {}, preview: {actions: []}}, block: {rootID: "doc"}});
    const event = {
        target: {tagName: "IMG", closest: () => diagram, isEqualNode: () => false,
            getAttribute: (name: string) => name === "src" ? "diagram.svg" : null},
        preventDefault: () => {},
        stopPropagation: () => {},
    };
    elements[0].listeners.click(event);
    elements[0].listeners.click(event);
    assert.equal(diagramPreviews, 0);
    assert.equal(imagePreviews.length, 0);
    elements[0].listeners.dblclick(event);
    assert.equal(diagramPreviews, 1);
    const ordinaryImage = {...event, target: {...event.target, closest: (): null => null}};
    elements[0].listeners.click(ordinaryImage);
    assert.deepEqual(imagePreviews, [["diagram.svg", "doc", ""]]);
    elements[0].listeners.dblclick(ordinaryImage);
    assert.equal(diagramPreviews, 1);
    const livePhoto = {...ordinaryImage, target: {...ordinaryImage.target, getAttribute: (name: string) => ({
        src: "photo.heic", "custom-sy-live-photo": "1", "custom-sy-live-photo-video": "photo.mov",
    })[name] || null}};
    elements[0].listeners.click(livePhoto);
    assert.deepEqual(imagePreviews.at(-1), ["photo.heic", "doc", "photo.mov"]);
});
