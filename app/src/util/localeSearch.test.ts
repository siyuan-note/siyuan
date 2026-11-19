import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {test} from "node:test";
import {ModuleKind, transpileModule} from "typescript";

const turkishDefault = `const lower = String.prototype.toLocaleLowerCase;
String.prototype.toLocaleLowerCase = function(locale) { return lower.call(this, locale ?? "tr"); };`;

test("capability matching ignores the system Turkish case mapping", () => {
    const source = readFileSync("src/config/tabs/ai/aiCapabilityUi.ts", "utf8");
    const matcher = source.slice(source.indexOf("const capabilityMatches ="), source.indexOf("const getCapabilityViewHost ="));
    const normalize = source.match(/const normalizedQuery = ([^;]+);/)[1];
    const script = transpileModule(matcher, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const result = runInNewContext(`${turkishDefault}\n${script}\ncapabilityMatches(capability, ${normalize})`, {
        capability: {title: "INDEX", actions: [{name: "IMPORT"}]}, query: "import", getGroupLabel: () => "",
    });
    assert.equal(result, true);
});

test("plugin package and backlink matching normalize query and content consistently", () => {
    const snapshot = readFileSync("src/history/pluginSnapshotSelect.ts", "utf8");
    const queryExpression = snapshot.match(/const query = ([^;]+);/)[1];
    const filterExpression = snapshot.match(/packages.filter\(item => ([^;]+?)\)\.forEach/)[1];
    assert.equal(runInNewContext(`${turkishDefault}\nconst query = ${queryExpression}; ${filterExpression}`, {
        keyword: "INDEX", item: {label: "index plugin", name: "import"},
    }), true);
    const backlink = readFileSync("src/layout/dock/backlinkRefFilterMenu.ts", "utf8");
    const keywordExpression = backlink.match(/const keyword = ([^;]+);/)[1];
    const hiddenExpression = backlink.match(/const hidden = ([^;]+);/)[1];
    assert.equal(runInNewContext(`${turkishDefault}\nconst keyword = ${keywordExpression}; ${hiddenExpression}`, {
        input: {value: "index"}, item: {text: "INDEX", path: ""}, id: "block", checked: false,
    }), false);
});
