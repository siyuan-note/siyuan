import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {syncRootAttributes} from "./syncRootAttributes";

class TestElement {
    attributes = new Map<string, string>();

    removeAttribute(name: string) {
        this.attributes.delete(name);
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }
}

describe("syncRootAttributes", () => {
    it("syncs the document ID and custom attributes only", () => {
        const element = new TestElement();
        const managedCustomAttributes = new Set<string>();

        syncRootAttributes(element, managedCustomAttributes, {
            id: "20260826120000-abcdefg",
            title: "Document",
            style: "color: red",
            "custom-layout": "book",
            "custom-content": "<strong>value</strong>",
        });

        assert.deepEqual(Object.fromEntries(element.attributes), {
            "custom-layout": "book",
            "custom-content": "<strong>value</strong>",
            "data-node-id": "20260826120000-abcdefg",
        });
        assert.deepEqual([...managedCustomAttributes], ["custom-layout", "custom-content"]);
    });

    it("clears stale document attributes without removing runtime attributes", () => {
        const element = new TestElement();
        element.attributes.set("data-notebook-id", "notebook");
        element.attributes.set("custom-runtime-state", "keep");
        const managedCustomAttributes = new Set<string>();

        syncRootAttributes(element, managedCustomAttributes, {
            id: "20260826120000-aaaaaaa",
            "custom-layout": "person",
        });
        syncRootAttributes(element, managedCustomAttributes, {
            id: "20260826120001-bbbbbbb",
            "custom-theme": "book",
            "custom-empty": "",
        });

        assert.deepEqual(Object.fromEntries(element.attributes), {
            "data-notebook-id": "notebook",
            "custom-runtime-state": "keep",
            "data-node-id": "20260826120001-bbbbbbb",
            "custom-theme": "book",
        });
        assert.deepEqual([...managedCustomAttributes], ["custom-theme"]);
    });

    it("uses the current Protyle root ID when the IAL has no ID", () => {
        const element = new TestElement();

        syncRootAttributes(element, new Set<string>(), {}, "20260826120000-abcdefg");

        assert.equal(element.attributes.get("data-node-id"), "20260826120000-abcdefg");
    });
});
