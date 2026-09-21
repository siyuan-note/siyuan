import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const exportSource = readFileSync(resolve(process.cwd(), "src/protyle/export/index.ts"), "utf8");

test("mind map export labels preserve localized text without closing the generated script", () => {
    const source = createSourceFile("export.ts", exportSource, ScriptTarget.Latest, true);
    const declaration = source.statements.filter(isVariableStatement)
        .flatMap(statement => Array.from(statement.declarationList.declarations))
        .find(item => item.name.getText(source) === "getExportLanguages");
    assert.ok(declaration?.initializer);
    const languages = {
        copy: "Copy \"text\"\n</script><script>alert(1)</script>",
        listMindmapRoot: "Current\u2028list\u2029root",
        connect: "Connect",
        text: "Text",
        fullscreen: "Fullscreen",
        exitFullscreen: "Exit fullscreen",
        task: "Task",
        taskStatusTodo: "To do",
        taskStatusInProgress: "In progress",
        taskStatusDone: "Done",
        taskStatusCanceled: "Canceled",
        customTaskStatus: "Custom status",
        unrelated: "Not exported",
    };
    const compiled = transpileModule(`(${declaration.initializer.getText(source)})()`, {
        compilerOptions: {target: ScriptTarget.ES2020},
    }).outputText;
    const serialized = runInNewContext(compiled, {window: {siyuan: {languages}}});
    assert.ok(!serialized.includes("</script>"));
    assert.ok(!serialized.includes("\u2028"));
    assert.ok(!serialized.includes("\u2029"));
    const expected: Record<string, string> = {...languages};
    delete expected.unrelated;
    assert.deepEqual(JSON.parse(serialized), expected);
    assert.equal(exportSource.match(/languages: \$\{getExportLanguages\(\)\}/g)?.length, 2);
});

test("the public mind map renderer also renders documents containing only list mind maps", () => {
    const source = readFileSync(resolve(process.cwd(), "src/protyle/render/mindmapRender.ts"), "utf8");
    const calls: string[] = [];
    const exported: {mindmapRender?: (element: unknown) => void} = {};
    const compiled = transpileModule(source, {
        compilerOptions: {target: ScriptTarget.ES2020, module: ModuleKind.CommonJS},
    }).outputText;
    const dependencies: Record<string, unknown> = {
        "../../constants": {Constants: {PROTYLE_CDN: "stage/protyle"}},
        "./listMindmap/render": {listMindmapRender: () => calls.push("list")},
        "./listMindmap/legacy": {normalizeLegacyMindmapCodes: () => calls.push("legacy")},
    };
    runInNewContext(compiled, {
        exports: exported,
        require: (name: string) => dependencies[name] || {},
    });
    assert.ok(exported.mindmapRender);
    exported.mindmapRender({
        getAttribute: (): string | null => null,
        querySelectorAll: (): Element[] => [],
    });
    assert.deepEqual(calls, ["list", "legacy"]);
});
