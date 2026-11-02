import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("menu.ts", readFileSync("src/search/menu.ts", "utf8"), ScriptTarget.Latest, true);
const declarations = ["removeCriterionData", "saveCriterionData"].map(name => source.statements.find(statement =>
    isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(source) === name)).getText(source));
const code = transpileModule(declarations.join("\n"), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("mobile criterion replacement preserves old data and chips on save or old-name removal failure", async () => {
    for (const failure of ["save", "remove", "none"]) {
        let removed = false;
        let inserted = false;
        let task: Promise<boolean>;
        const criteria = [{name: "old"}];
        const chip = {textContent: "old", remove: () => { removed = true; }};
        const list = {children: [chip], classList: {remove() {}}, querySelector: (): HTMLElement => null,
            insertAdjacentHTML: () => { inserted = true; }};
        const requests: string[] = [];
        const dependencies = {isMobile: () => true, window: {siyuan: {storage: {}}}, Constants: {LOCAL_SEARCHDATA: "search"},
            setStorageVal() {}, escapeHtml: String,
            fetchSyncPost: async (url: string) => {
                requests.push(url);
                assert.equal(removed, false);
                assert.equal(criteria[0].name, "old");
                return {code: url.endsWith(failure === "save" ? "setCriterion" : failure === "remove" ? "removeCriterion" : "never") ? 1 : 0};
            },
            removeSearchCriterionSync: async () => {
                requests.push("removeCriterion");
                assert.equal(removed, false);
                assert.equal(criteria[0].name, "old");
                return {code: failure === "remove" ? 1 : 0};
            },
        };
        const save = new Function(...Object.keys(dependencies), code + "\nreturn saveCriterionData;")(...Object.values(dependencies));
        save({}, criteria, {querySelector: () => ({firstElementChild: list})}, "new", {
            runPending: (callback: () => Promise<boolean>) => { task = callback(); },
        }, ["old"]);
        assert.equal(await task, failure === "none");
        assert.equal(removed, failure === "none");
        assert.equal(inserted, failure === "none");
        assert.equal(criteria[0].name, failure === "none" ? "new" : "old");
        assert.equal(requests.length, failure === "save" ? 1 : 2);
    }
});
