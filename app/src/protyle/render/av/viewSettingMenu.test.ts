import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const open = (left: number, right: number, viewport: number, width: number, mobile = false) => {
    const exports = {};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "viewSettingMenu.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS},
    }).outputText, {exports, window: {innerWidth: viewport}, require: () => ({isMobile: () => mobile})});
    let position: IPosition;
    const element = {style: {left: ""}, getBoundingClientRect: () => ({width})};
    const menu = {element, open: (value: IPosition) => { position = value; }};
    const target = {getBoundingClientRect: () => ({left: left + 8, right: right - 8, top: 120, bottom: 148, height: 28}),
        closest: () => ({getBoundingClientRect: () => ({left, right})})};
    const methods = exports as typeof import("./viewSettingMenu");
    methods.openViewSettingMenu(menu as unknown as Parameters<typeof methods.openViewSettingMenu>[0], target as unknown as HTMLElement);
    return {position, element};
};

test("view setting submenus open beside the parent and align with the selected row", () => {
    const {position, element} = open(20, 310, 1000, 180);
    assert.equal(position.x, 298);
    assert.equal(position.y, 112);
    assert.equal(position.h, undefined);
    assert.equal(element.style.left, "298px");
});

test("view setting submenus flip left and stay close to the setting row", () => {
    const {position, element} = open(680, 970, 1000, 180);
    assert.equal(position.x, 512);
    assert.equal(position.x + 180, 680 + 8 + 4);
    assert.equal(element.style.left, "512px");
});

test("view setting submenus keep horizontal bounds when neither side fits", () => {
    const {position} = open(20, 310, 340, 180);
    assert.ok(position.x >= 0);
    assert.ok(position.x + 180 <= 340);
});

test("mobile view settings retain the standard bottom sheet opening path", () => {
    const {position, element} = open(20, 310, 340, 180, true);
    assert.equal(position.x, 28);
    assert.equal(position.y, 148);
    assert.equal(position.h, 28);
    assert.equal(element.style.left, "");
});
