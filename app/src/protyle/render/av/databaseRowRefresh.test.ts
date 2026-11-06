import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isVariableDeclaration, ScriptTarget, transpileModule, type Node} from "typescript";
import {
    queueDatabaseRowRefresh,
    queueDatabaseRowRefreshForOperations,
    registerDatabaseRowRefresh,
} from "./databaseRowRefresh";

const waitForRefresh = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("database row refresh", () => {
    it("refreshes the initiating panel after the binding transaction is acknowledged", async () => {
        const source = createSourceFile("transaction.ts", readFileSync("src/protyle/wysiwyg/transaction.ts", "utf8"), ScriptTarget.ES2022, true);
        let code: string;
        const visit = (node: Node) => {
            if (isVariableDeclaration(node) && node.name.getText(source) === "applied") {
                code = node.initializer.getText(source);
            }
            forEachChild(node, visit);
        };
        visit(source);
        assert.ok(code);
        let acknowledged = 0;
        let refreshed = 0;
        const dispose = registerDatabaseRowRefresh("initiator", {getAVID: () => "database", refresh: () => {
            assert.equal(acknowledged, 1);
            refreshed++;
        }});
        try {
            const applied = runInNewContext(transpileModule("(" + code + ")", {compilerOptions: {target: ScriptTarget.ES2022}}).outputText, {
                items: [{callback: () => { acknowledged++; }}], protyle: {id: "initiator"},
                getEditorTransaction: (value: unknown) => value, queueDatabaseRowRefreshForOperations,
            });
            applied({data: []});
            await waitForRefresh();
            assert.equal(refreshed, 0);
            applied({data: [{doOperations: [{action: "replaceAttrViewBlock", avID: "database", previousID: "item", nextID: "document"}]}]});
            await waitForRefresh();
            assert.equal(refreshed, 1);
        } finally { dispose(); }
    });
    it("refreshes every open panel for a binding transaction and its undo", async () => {
        const counts = [0, 0, 0];
        const unregister = counts.map((_value, index) => registerDatabaseRowRefresh(`binding-${index}`, {
            getAVID: () => index === 2 ? "other" : "database",
            refresh: () => counts[index]++,
        }));
        for (const isDetached of [false, true]) {
            counts.forEach((_value, index) => queueDatabaseRowRefreshForOperations(`binding-${index}`, [{
                action: "replaceAttrViewBlock", avID: "database", previousID: "item",
                nextID: isDetached ? "" : "document", isDetached,
            }]));
            await waitForRefresh();
        }
        assert.deepEqual(counts, [2, 2, 0]);
        unregister.forEach(dispose => dispose());
    });

    it("refreshes only the matching database and coalesces requests", async () => {
        let avID = "av-a";
        let refreshCount = 0;
        const unregister = registerDatabaseRowRefresh("protyle-a", {
            getAVID: () => avID,
            refresh: () => refreshCount++,
        });

        queueDatabaseRowRefresh("protyle-a", "av-b");
        queueDatabaseRowRefresh("protyle-a", "av-a");
        queueDatabaseRowRefresh("protyle-a", "av-a");
        await waitForRefresh();
        assert.equal(refreshCount, 1);

        avID = "av-b";
        queueDatabaseRowRefresh("protyle-a", "av-a");
        queueDatabaseRowRefresh("protyle-a", "av-b");
        await waitForRefresh();
        assert.equal(refreshCount, 2);

        unregister();
        queueDatabaseRowRefresh("protyle-a", "av-b");
        await waitForRefresh();
        assert.equal(refreshCount, 2);
    });

    it("resolves database IDs from value and name operations", async () => {
        let avID = "av-template";
        let refreshCount = 0;
        const unregister = registerDatabaseRowRefresh("protyle-b", {
            getAVID: () => avID,
            refresh: () => refreshCount++,
        });

        queueDatabaseRowRefreshForOperations("protyle-b", [{
            action: "updateAttrViewColTemplate",
            avID: "av-template",
        }] as IOperation[]);
        await waitForRefresh();
        assert.equal(refreshCount, 1);

        avID = "av-name";
        queueDatabaseRowRefreshForOperations("protyle-b", [{
            action: "setAttrViewName",
            id: "av-name",
        }] as IOperation[]);
        await waitForRefresh();
        assert.equal(refreshCount, 2);
        unregister();
    });

    it("does not unregister a newer registration with stale cleanup", async () => {
        let refreshCount = 0;
        const unregisterOld = registerDatabaseRowRefresh("protyle-c", {
            getAVID: () => "av-old",
            refresh: () => refreshCount++,
        });
        const unregisterNew = registerDatabaseRowRefresh("protyle-c", {
            getAVID: () => "av-new",
            refresh: () => refreshCount++,
        });

        unregisterOld();
        queueDatabaseRowRefresh("protyle-c", "av-new");
        await waitForRefresh();
        assert.equal(refreshCount, 1);
        unregisterNew();
    });
});
