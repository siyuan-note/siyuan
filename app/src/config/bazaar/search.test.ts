import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("marketplace searching submits nonempty keywords on Enter and resets when cleared", () => {
    const input = Object.assign(new EventTarget(), {value: "", closest: () => ({
        querySelector: () => ({getAttribute: () => "myPlugin"}),
    })});
    const root = {
        firstElementChild: new EventTarget(),
        querySelectorAll: (selector: string) => selector.endsWith(".b3-text-field") ? [input] : [],
    };
    const calls: string[] = [];
    let panel = "plugin";
    const mocks: Record<string, unknown> = {
        "./packageConfig": {
            BAZAAR_PACKAGE_CONFIG: {plugins: {api: {bazaar: "/api/bazaar/getBazaarPlugin"}}},
            getBazaarTypeByTab: (type: string) => type === "plugin" ? "plugins" : undefined,
            getBazaarTypeByMyType: (type: string) => type === "myPlugin" ? "plugins" : undefined,
        },
        "./filterMenu": {bindBazaarFilterMenu() {}},
        "../../protyle/util/hasClosest": {hasClosestByClassName: () => ({getAttribute: () => panel})},
        "../../util/fetch": {fetchPost: (_url: string, {keyword}: {keyword: string}) => calls.push(keyword)},
    };
    const api = {} as typeof import("./events");
    const source = transpileModule(readFileSync("src/config/bazaar/events.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    new Function("exports", "require", source)(api, (id: string) => mocks[id] || {});
    const mount = {element: root as unknown as HTMLElement, generation: 1};
    const controller = {element: root, _beginBazaarRequest: () => mount, _genMyHTML: () => calls.push("downloaded")};
    api.bindBazaarEvents(controller as unknown as Parameters<typeof api.bindBazaarEvents>[0], undefined, mount);
    const type = (value: string, isComposing = false) => {
        input.value = value;
        input.dispatchEvent(Object.assign(new Event("input"), {isComposing}));
    };
    type(" plugin ");
    assert.deepEqual(calls, []);
    input.dispatchEvent(Object.assign(new Event("keydown"), {key: "Enter", isComposing: false}));
    assert.deepEqual(calls, ["plugin"]);
    type("", true);
    assert.deepEqual(calls, ["plugin"]);
    input.dispatchEvent(new Event("compositionend"));
    type("");
    assert.deepEqual(calls, ["plugin", ""]);
    panel = "downloaded";
    type("theme");
    type("");
    assert.deepEqual(calls, ["plugin", "", "downloaded"]);
});
