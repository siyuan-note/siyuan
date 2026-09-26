import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("renderer methods wait for circular dependencies and preserve arguments and return values", () => {
    const source = readFileSync("src/plugin/ProtyleMethod.ts", "utf8");
    const compiled = transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    let initialized = false;
    const calls: {name: string, args: unknown[]}[] = [];
    const result = Promise.resolve("rendered");
    const exports: {ProtyleMethod?: Record<string, (...args: unknown[]) => unknown>} = {};
    runInNewContext(compiled, {
        exports,
        require: () => new Proxy({}, {
            get: (_target, name: string) => {
                assert.equal(initialized, true, `read ${name} before its module finished initializing`);
                return (...args: unknown[]) => {
                    calls.push({name, args});
                    return result;
                };
            },
        }),
    });
    initialized = true;
    const methods = exports.ProtyleMethod!;
    const expected = ["tabsRender", "graphvizRender", "highlightRender", "mathRender", "mermaidRender",
        "flowchartRender", "chartRender", "abcRender", "mindmapRender", "plantumlRender", "avRender", "htmlRender"];
    assert.deepEqual(Object.keys(methods).sort(), expected.sort());
    for (const name of expected) {
        const element = {};
        assert.equal(methods[name](element, undefined, false), result);
        assert.deepEqual(calls.at(-1), {name, args: [element, undefined, false]});
    }
});
