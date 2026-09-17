import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("layout adjustment waits for initialization and still accepts an explicit layout", () => {
    const source = readFileSync(resolve(process.cwd(), "src/layout/util.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const layout: {centerLayout?: {parent?: unknown}} = {};
    let adjustments = 0;
    const moduleExports = {} as {adjustLayout: (layout?: unknown) => void};
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan: {layout}},
        require: (name: string) => name === "./dock/responsive" ? {
            requestResponsiveDockLayout: () => { adjustments++; },
        } : {},
    });

    assert.doesNotThrow(() => moduleExports.adjustLayout());
    layout.centerLayout = {};
    assert.doesNotThrow(() => moduleExports.adjustLayout());
    assert.equal(adjustments, 0);

    const readyLayout = {direction: "tb", children: [] as unknown[], element: {closest: (): Element | null => null}};
    layout.centerLayout.parent = readyLayout;
    moduleExports.adjustLayout();
    assert.equal(adjustments, 1);

    delete layout.centerLayout;
    moduleExports.adjustLayout(readyLayout);
    assert.equal(adjustments, 2);
});
