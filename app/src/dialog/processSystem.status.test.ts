import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("processSystem.ts", readFileSync("src/dialog/processSystem.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declaration = source.statements.filter(isVariableStatement)
    .flatMap(item => Array.from(item.declarationList.declarations))
    .find(item => item.name.getText(source) === "progressStatus");
const compiled = transpileModule(`let statusTimeout; const progressStatus = ${declaration.initializer.getText(source)}; progressStatus;`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

test("desktop status messages reach the exit dialog even without a status bar", () => {
    for (const visible of [false, true]) {
        const status = {innerHTML: ""};
        const messages: string[] = [];
        let timeout: () => void;
        const progressStatus = runInNewContext(compiled, {
            updateExitProgressStatus: (message: string) => messages.push(message),
            document: {querySelector: () => visible ? status : null},
            sanitizeKernelHTML: (message: string) => message,
            clearTimeout: () => {},
            window: {setTimeout: (callback: () => void) => { timeout = callback; }},
        });
        progressStatus({msg: "Uploading 1/10"});
        progressStatus({msg: "Uploading 2/10"});
        assert.deepEqual(messages, ["Uploading 1/10", "Uploading 2/10"]);
        if (visible) {
            assert.equal(status.innerHTML, "Uploading 2/10");
            timeout();
            assert.equal(status.innerHTML, "");
            assert.equal(messages.at(-1), "Uploading 2/10", "status bar expiry must not clear exit feedback");
        }
    }
});
