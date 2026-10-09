import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule} from "typescript";
import {createMobileBarsState, reduceMobileBarsState} from "../../mobile/util/mobileBarsState";

const source = readFileSync(`${__dirname}/onGet.ts`, "utf8");
const code = transpileModule(source.slice(source.indexOf("export const disabledProtyle = "),
    source.indexOf("const focusElementById = ")).replace(/export /g, ""), {}).outputText;

for (const enable of [false, true]) {
    test(`${enable ? "unlocking" : "locking"} pauses mobile bars before readonly layout changes`, () => {
        for (const current of [false, true]) {
            let state = {...createMobileBarsState(300), readingBarsOffset: 12};
            let pauses = 0;
            let layoutChanges = 0;
            const changeLayout = () => {
                layoutChanges++;
                state = reduceMobileBarsState(state, {type: "scroll", scrollTop: state.scrollTop + 6});
            };
            const protyle = {
                disabled: enable,
                element: {getAttribute: (): null => null},
                databaseAttributePanel: {updateReadonly: changeLayout},
                wysiwyg: {element: {setAttribute() {}, style: {}, querySelectorAll: (): HTMLElement[] => []}},
            };
            const exports: {enable?: () => void, disable?: () => void} = {};
            runInNewContext(code + "\nexports.enable = () => enableProtyle(protyle);" +
                "\nexports.disable = () => disabledProtyle(protyle);", {
                exports, protyle,
                window: {siyuan: {mobile: {editor: {protyle: current ? protyle : {}}}, menus: {menu: {remove() {}}}}},
                pauseMobileBarsScroll: () => {
                    pauses++;
                    state = reduceMobileBarsState(state, {type: "set-programmatic-scrolling", active: true});
                },
                hideElements() {}, updateMobileTitleReadonly() {}, disabledWYSIWYG() {},
                refreshCalendarReadonly() {}, refreshMapReadonly() {}, hideTooltip() {}, isMobile: () => true,
                isIPhone: () => false, isAndroid: () => true,
            });
            (enable ? exports.enable : exports.disable)();
            assert.equal(layoutChanges, 1);
            assert.equal(pauses, current ? 1 : 0);
            assert.equal(state.readingBarsOffset, current ? 12 : 18);
            (enable ? exports.enable : exports.disable)();
            assert.equal(pauses, current ? 1 : 0, "unchanged readonly state does not restart the pause");
            if (current) {
                state = reduceMobileBarsState(state, {type: "set-programmatic-scrolling", active: false});
                state = reduceMobileBarsState(state, {type: "scroll", scrollTop: state.scrollTop + 10});
                assert.equal(state.readingBarsOffset, 22, "ordinary scrolling resumes after the layout settles");
            }
        }
    });
}
