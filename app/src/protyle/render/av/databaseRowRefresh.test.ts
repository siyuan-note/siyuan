import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    queueDatabaseRowRefresh,
    queueDatabaseRowRefreshForOperations,
    registerDatabaseRowRefresh,
} from "./databaseRowRefresh";

const waitForRefresh = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("database row refresh", () => {
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
