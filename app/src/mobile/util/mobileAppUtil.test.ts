import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {canInput} from "./mobileAppUtil";

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
