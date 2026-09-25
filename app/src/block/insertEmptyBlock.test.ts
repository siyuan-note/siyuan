import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {
    BLOCK_SELECTION_CLASS,
    BLOCK_SELECTION_MODE_CLASS,
    clearBlockSelectionMode,
    getBlockSelectionModeElement,
} from "../protyle/wysiwyg/blockSelection";

const extract = (path: string, name: string, next: string) => {
    const source = readFileSync(path, "utf8");
    return source.slice(source.indexOf(`export const ${name} =`), source.indexOf(`export const ${next} =`));
};
const compiled = transpileModule(
    extract("src/protyle/ui/hideElements.ts", "hideElements", "hideAllElements") +
    extract("src/block/util.ts", "insertEmptyBlock", "insertEmptySuperBlockColumn"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;

class TestElement {
    parentElement: TestElement;
    children: TestElement[] = [];
    attributes = new Map<string, string>();
    classes = new Set<string>();
    classList = {
        contains: (name: string) => this.classes.has(name),
        remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
    };

    constructor(id: string, type = "NodeParagraph") {
        this.attributes.set("data-node-id", id);
        this.attributes.set("data-type", type);
    }

    get outerHTML() {
        return `<div data-node-id="${this.getAttribute("data-node-id")}" class="${[...this.classes].join(" ")}"></div>`;
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    removeAttribute(name: string) {
        this.attributes.delete(name);
    }

    append(...children: TestElement[]) {
        children.forEach(child => child.parentElement = this);
        this.children.push(...children);
    }

    querySelectorAll(selector: string): TestElement[] {
        return this.children.flatMap(child => {
            const matches = selector.startsWith(".") ? child.classes.has(selector.slice(1)) :
                selector === `[data-node-id="${child.getAttribute("data-node-id")}"]`;
            return [...(matches ? [child] : []), ...child.querySelectorAll(selector)];
        });
    }

    querySelector(selector: string) {
        return this.querySelectorAll(selector)[0] || null;
    }

    insertAdjacentElement(position: string, element: TestElement) {
        const siblings = this.parentElement.children;
        element.parentElement = this.parentElement;
        siblings.splice(siblings.indexOf(this) + (position === "afterend" ? 1 : 0), 0, element);
    }
}

for (const position of ["beforebegin", "afterend"]) {
    for (const targetKind of ["cursor", "element", "id", "multiple", "editing"]) {
        for (const type of ["NodeParagraph", "NodeHeading", "NodeCodeBlock"]) {
            test(`${position} from ${targetKind} at ${type} clears the old input target`, async () => {
                const editor = new TestElement("editor");
                editor.classes.add("protyle-wysiwyg");
                const first = new TestElement("first", type);
                const last = new TestElement("last");
                editor.append(first, last);
                if (targetKind !== "editing") {
                    first.classes.add(BLOCK_SELECTION_MODE_CLASS);
                }
                if (targetKind === "multiple") {
                    first.classes.add(BLOCK_SELECTION_CLASS);
                    last.classes.add(BLOCK_SELECTION_CLASS);
                    first.attributes.set("select-start", "true");
                    last.attributes.set("select-end", "true");
                }
                const inserted = new TestElement("inserted");
                const range = {startContainer: first};
                const context = {undoFocusId: "first"};
                const protyle = {wysiwyg: {element: editor}};
                const exports: {insertEmptyBlock?: (...args: unknown[]) => Promise<void>} = {};
                let operations: Array<{id: string; previousID?: string; nextID?: string}>;
                let inverse: Array<{action: string; id: string; context: object}>;
                let focusedRange: typeof range;
                let keyboardRequests = 0;
                runInNewContext(compiled, {
                    exports,
                    clearBlockSelectionMode,
                    getEditorRange: () => range,
                    hasClosestBlock: (element: TestElement) => element,
                    getTopAloneElement: (element: TestElement) => element,
                    getUndoFocusContext: () => context,
                    getPreviousBlockSibling: (): Element | undefined => undefined,
                    genEmptyElement: () => inserted,
                    transaction: (_protyle: unknown, forward: typeof operations, backward: typeof inverse) => {
                        operations = forward;
                        inverse = backward;
                    },
                    focusByWbr: () => {
                        range.startContainer = inserted;
                        return range;
                    },
                    scrollCenter: () => {},
                    isMobile: () => true,
                    restoreEditorFocusRange: (element: TestElement, restoredRange: typeof range) => {
                        assert.equal(element, editor);
                        focusedRange = restoredRange;
                        return true;
                    },
                    callMobileAppShowKeyboard: () => keyboardRequests++,
                });

                await exports.insertEmptyBlock(protyle, position,
                    targetKind === "element" ? first : targetKind === "id" ? "first" : undefined);

                assert.equal(getBlockSelectionModeElement(editor as unknown as Element), undefined);
                assert.equal(editor.querySelectorAll(`.${BLOCK_SELECTION_CLASS}`).length, 0);
                assert.equal(first.getAttribute("select-start"), null);
                assert.equal(last.getAttribute("select-end"), null);
                assert.equal(range.startContainer, inserted);
                assert.equal(focusedRange, range);
                assert.equal(keyboardRequests, 1);
                const anchor = targetKind === "multiple" && position === "afterend" ? last : first;
                assert.equal(editor.children.indexOf(inserted), editor.children.indexOf(anchor) +
                    (position === "afterend" ? 1 : -1));
                assert.equal(operations[0].id, "inserted");
                assert.equal(operations[0][position === "afterend" ? "previousID" : "nextID"],
                    anchor.getAttribute("data-node-id"));
                assert.equal(inverse[0].action, "delete");
                assert.equal(inverse[0].id, "inserted");
                assert.equal(inverse[0].context, context);
            });
        }
    }
}
