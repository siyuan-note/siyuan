import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

for (const path of ["src/search/util.ts", "src/mobile/menu/search.ts"]) {
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
        Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === "replace");
    const compiled = transpileModule(`const ${declaration.getText(source)}; globalThis.replace = replace;`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;

    for (const method of [2, 4]) {
        for (const isAll of [false, true]) {
            test(`${path}: method ${method} rejects ${isAll ? "all" : "single"} replacement before accessing results`, () => {
                const messages: string[] = [];
                const context: any = {
                    window: {siyuan: {isPublish: false, languages: {_kernel: {132: "unsupported"}}}},
                    showMessage: (message: string) => messages.push(message),
                    fetchPost: () => assert.fail("unsupported replacement must not send a write request"),
                };
                runInNewContext(compiled, context);
                const element = {querySelector: () => assert.fail("unsupported replacement must not access results")};
                if (path.includes("mobile")) {
                    context.replace(element, {method}, isAll);
                } else {
                    context.replace(element, {method}, undefined, isAll);
                }
                assert.deepEqual(messages, ["unsupported"]);
            });
        }
    }
}
