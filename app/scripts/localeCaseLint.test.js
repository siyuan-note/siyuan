import assert from "node:assert/strict";
import {test} from "node:test";
import {ESLint} from "eslint";

test("case conversion lint covers frontend and Electron, including computed calls", async () => {
    const eslint = new ESLint();
    for (const filePath of ["src/localeCaseProbe.ts", "electron/localeCaseProbe.ts", "electron/window/windowRegistry.ts"]) {
        for (const expression of ["value.toLocaleLowerCase()", "value.toLocaleUpperCase()",
            "value[\"toLocaleLowerCase\"]()", "value[\"toLocaleUpperCase\"]()", "value?.toLocaleLowerCase()"]) {
            const results = await eslint.lintText(`const value = \"Inter\"; console.log(${expression});`, {filePath});
            assert.equal(results[0].messages.filter(item => item.ruleId === "no-restricted-syntax").length, 1,
                `${filePath}: ${expression}`);
        }
        for (const expression of ["value.toLocaleLowerCase(\"tr\")", "value[\"toLocaleUpperCase\"](\"tr\")",
            "value.toLowerCase()", "value.localeCompare(\"other\")"]) {
            const results = await eslint.lintText(`const value = \"Inter\"; console.log(${expression});`, {filePath});
            assert.equal(results[0].messages.filter(item => item.ruleId === "no-restricted-syntax").length, 0,
                `${filePath}: ${expression}`);
        }
    }
});
