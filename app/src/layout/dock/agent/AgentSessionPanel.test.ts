import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/layout/dock/agent/AgentSessionPanel.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const scenario of [
    {name: "desktop", mobile: false, phablet: false, focus: 1, closes: 1, positions: 1},
    {name: "tablet desktop layout", mobile: false, phablet: true, focus: 0, closes: 0, positions: 2},
    {name: "phone", mobile: true, phablet: true, focus: 0, closes: 0, positions: 0},
]) {
    test(`session search survives keyboard resizing on ${scenario.name}`, async () => {
        let focused = 0;
        let closes = 0;
        let positions = 0;
        let mouseScrollBindings = 0;
        const listeners = new Map<string, () => void>();
        const input = {addEventListener() {}, focus() { focused++; }};
        const list = {addEventListener() {}};
        const popup = {
            style: {},
            querySelector: (selector: string) => selector === ".b3-list" ? list : input,
            addEventListener() {},
            animate() {},
        };
        const exports = {AgentSessionPanel: undefined as unknown as new (...args: unknown[]) => {
            render: () => Promise<void>;
            renderItems: () => void;
            close: () => void;
        }};
        runInNewContext(compiled, {
            exports,
            require: (id: string) => {
                if (id === "./SessionStore") {
                    return {SessionStore: {list: async () => ({sessions: [] as unknown[], total: 0})}};
                }
                if (id.endsWith("/compatibility")) return {isPhablet: () => scenario.phablet};
                if (id.endsWith("/setPosition")) return {setPosition: () => { positions++; }};
                if (id.endsWith("/menuMouseScroll")) return {bindMenuMouseScroll: (element: unknown, _enabled: unknown, items: unknown) => {
                    assert.equal(element, popup);
                    assert.equal(items, list);
                    mouseScrollBindings++;
                }};
                return {};
            },
            window: {
                siyuan: {languages: {}, zIndex: 10},
                addEventListener: (type: string, handler: () => void) => listeners.set(type, handler),
            },
            document: {createElement: () => popup, body: {appendChild() {}}},
            setTimeout: () => 1,
        });
        const panel = new exports.AgentSessionPanel(
            {getBoundingClientRect: () => ({right: 400, bottom: 50, height: 30, width: 30})},
            {appendChild() {}}, () => "", () => "", {}, scenario.mobile,
        );
        panel.renderItems = () => {};
        panel.close = () => { closes++; };
        await panel.render();
        closes = 0;
        listeners.get("resize")?.();
        assert.equal(focused, scenario.focus);
        assert.equal(closes, scenario.closes);
        assert.equal(positions, scenario.positions);
        assert.equal(mouseScrollBindings, scenario.mobile ? 0 : 1);
    });
}
