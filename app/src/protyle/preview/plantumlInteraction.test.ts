import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("reading mode opens PlantUML only on double click and keeps ordinary image clicks", () => {
    const compiled = transpileModule(readFileSync("src/protyle/preview/index.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const elements: Array<{listeners: Record<string, (event: unknown) => void>}> = [];
    let diagramPreviews = 0;
    let imagePreviews = 0;
    const diagram = {getAttribute: () => "plantuml"};
    const exports = {} as {Preview: new (protyle: unknown) => unknown};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            getDiagramBlock: (element: unknown) => element,
            previewDiagram: (element: unknown) => { assert.equal(element, diagram); diagramPreviews++; },
            previewDocImage: () => { imagePreviews++; },
            hasTopClosestByAttribute: (): false => false,
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
        target: {tagName: "IMG", closest: () => diagram, isEqualNode: () => false, getAttribute: () => "diagram.svg"},
        preventDefault: () => {},
        stopPropagation: () => {},
    };
    elements[0].listeners.click(event);
    elements[0].listeners.click(event);
    assert.equal(diagramPreviews, 0);
    assert.equal(imagePreviews, 0);
    elements[0].listeners.dblclick(event);
    assert.equal(diagramPreviews, 1);
    const ordinaryImage = {...event, target: {...event.target, closest: (): null => null}};
    elements[0].listeners.click(ordinaryImage);
    assert.equal(imagePreviews, 1);
    elements[0].listeners.dblclick(ordinaryImage);
    assert.equal(diagramPreviews, 1);
});
