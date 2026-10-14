import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const getFrontend = (mobile: boolean, native: boolean, toolbar: boolean, settings: boolean,
                     userAgent = native ? "SiYuan/3.8.7 Electron" : "Mozilla/5.0") => {
    const source = createSourceFile("functions.ts", parse(readFileSync("src/util/functions.ts", "utf8"),
        {MOBILE: mobile, BROWSER: !native}, false, true), ScriptTarget.ES2021, true);
    const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => ["getFrontend", "isWindow"].includes(item.name.getText(source))));
    const exports = {} as {getFrontend: () => string};
    runInNewContext(transpileModule(declarations.map(item => item.getText(source)).join("\n"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {
        exports, window: {navigator: {userAgent}},
        document: {getElementById: () => toolbar ? {} : null, body: {classList: {contains: () => settings}}},
    });
    return exports.getFrontend();
};

test("native settings use desktop package compatibility rather than document-window compatibility", () => {
    assert.equal(getFrontend(false, true, false, true), "desktop");
    assert.equal(getFrontend(false, true, false, true, "Mozilla/5.0 Electron"), "desktop");
});

test("main windows, detached documents, browsers and mobile retain their frontend identities", () => {
    assert.equal(getFrontend(false, true, true, false), "desktop");
    assert.equal(getFrontend(false, true, false, false), "desktop-window");
    assert.equal(getFrontend(false, false, true, false), "browser-desktop");
    assert.equal(getFrontend(false, false, false, true), "browser-desktop");
    assert.equal(getFrontend(true, true, false, false), "mobile");
    assert.equal(getFrontend(true, false, false, false), "browser-mobile");
});
