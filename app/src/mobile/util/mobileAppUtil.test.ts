import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {callMobileAppShowKeyboard, canInput} from "./mobileAppUtil";

const createElement = (options: {
    tagName?: string,
    classNames?: string[],
    attributes?: Record<string, string>,
    parentElement?: HTMLElement,
}) => {
    const attributes = options.attributes || {};
    return {
        nodeType: 1,
        tagName: options.tagName || "DIV",
        parentElement: options.parentElement || null,
        classList: {
            contains: (className: string) => options.classNames?.includes(className) || false,
        },
        getAttribute: (name: string) => attributes[name] ?? null,
        hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attributes, name),
    } as unknown as HTMLElement;
};

describe("mobile input detection", () => {
    const createEditableRoot = () => createElement({
        classNames: ["protyle-wysiwyg"],
        attributes: {contenteditable: "true", "data-readonly": "false"},
        parentElement: createElement({tagName: "BODY"}),
    });

    it("rejects non-editable render areas and their descendants", () => {
        const renderElement = createElement({
            attributes: {contenteditable: "false"},
            parentElement: createEditableRoot(),
        });
        const canvasElement = createElement({tagName: "CANVAS", parentElement: renderElement});

        assert.equal(canInput(renderElement), false);
        assert.equal(canInput(canvasElement), false);
    });

    it("accepts ordinary text inside the editable root", () => {
        const wysiwygElement = createEditableRoot();
        const textElement = createElement({tagName: "SPAN", parentElement: wysiwygElement});

        assert.equal(canInput(textElement), wysiwygElement);
    });

    it("accepts explicitly editable content inside a non-editable database", () => {
        const databaseElement = createElement({
            attributes: {contenteditable: "false"},
            parentElement: createEditableRoot(),
        });
        const editableElement = createElement({
            attributes: {contenteditable: "true"},
            parentElement: databaseElement,
        });
        const textElement = createElement({tagName: "SPAN", parentElement: editableElement});

        assert.equal(canInput(editableElement), editableElement);
        assert.equal(canInput(textElement), editableElement);
        for (const tagName of ["INPUT", "TEXTAREA"]) {
            const inputElement = createElement({tagName, parentElement: databaseElement});
            assert.equal(canInput(inputElement), inputElement);
        }
    });

    it("accepts the editable Protyle root as the active element", () => {
        const bodyElement = createElement({tagName: "BODY"});
        const wysiwygElement = createElement({
            classNames: ["protyle-wysiwyg"],
            attributes: {
                contenteditable: "true",
                "data-readonly": "false",
            },
            parentElement: bodyElement,
        });

        assert.equal(canInput(wysiwygElement), wysiwygElement);
    });

    it("rejects a readonly Protyle root", () => {
        const bodyElement = createElement({tagName: "BODY"});
        const wysiwygElement = createElement({
            classNames: ["protyle-wysiwyg"],
            attributes: {
                contenteditable: "false",
                "data-readonly": "true",
            },
            parentElement: bodyElement,
        });

        assert.equal(canInput(wysiwygElement), false);
    });
});

describe("mobile app keyboard", () => {
    it("notifies listeners before requesting the Android keyboard", () => {
        const originalWindow = globalThis.window;
        const calls: string[] = [];
        const testWindow = new EventTarget() as Window & typeof globalThis;
        Object.assign(testWindow, {
            JSAndroid: {
                showKeyboard() {
                    calls.push("keyboard");
                },
            },
        });
        testWindow.addEventListener("siyuan-mobile-keyboard-change", ((event: CustomEvent<boolean>) => {
            assert.equal(event.detail, true);
            calls.push("change");
        }) as EventListener);
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: testWindow,
        });

        try {
            callMobileAppShowKeyboard();
            assert.deepEqual(calls, ["change", "keyboard"]);
        } finally {
            Object.defineProperty(globalThis, "window", {
                configurable: true,
                value: originalWindow,
            });
        }
    });
});
