import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getTopBarHeight} from "./getTopBarHeight";

for (const {name, sidebar, toolbar, settings, tabs, expected} of [
    {name: "mobile sidebar", sidebar: true, toolbar: 32, settings: 32, tabs: 42, expected: 0},
    {name: "main toolbar", toolbar: 32, tabs: 42, expected: 32},
    {name: "merged tab bar", toolbar: 0, tabs: 42, expected: 42},
    {name: "settings toolbar", settings: 32, expected: 32},
    {name: "settings toolbar priority", settings: 40, toolbar: 32, tabs: 42, expected: 40},
    {name: "missing toolbars", expected: 0},
    {name: "hidden toolbars", toolbar: 0, settings: 0, tabs: 0, expected: 0},
]) {
    test(`top bar height supports ${name}`, () => {
        const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
        const element = (height: number | undefined) => height === undefined ? null : {clientHeight: height};
        Object.defineProperty(globalThis, "document", {configurable: true, value: {
            getElementById: (id: string) => id === "sidebar" ? (sidebar ? {} : null) : element(toolbar),
            querySelector: (selector: string) => element(selector === ".toolbar--settings" ? settings : tabs),
        }});
        try {
            assert.equal(getTopBarHeight(), expected);
        } finally {
            if (saved) Object.defineProperty(globalThis, "document", saved);
            else Reflect.deleteProperty(globalThis, "document");
        }
    });
}
