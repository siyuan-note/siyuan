import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {resolveGlobalSearchScope, resolveSearchConfigUpdate} from "./config";

describe("search configuration", () => {
    it("uses the saved criterion path for global search", () => {
        const config: Config.IUILayoutTabSearchConfig = {
            removed: false,
            hPath: "Notebook/Document A",
            idPath: ["notebook/document-a"],
        };

        const scope = resolveGlobalSearchScope(config);

        assert.deepEqual(scope, {
            hPath: "Notebook/Document A",
            idPath: ["notebook/document-a"],
        });
        assert.notStrictEqual(scope.idPath, config.idPath);
    });

    it("uses an empty path for global search without a criterion", () => {
        const scope = resolveGlobalSearchScope({
            removed: true,
            hPath: "Notebook/Document B",
            idPath: ["notebook/document-b"],
        });

        assert.deepEqual(scope, {
            hPath: "",
            idPath: [],
        });
    });

    it("keeps the saved path while overriding the runtime path for document search", () => {
        const criterion: Config.IUILayoutTabSearchConfig = {
            removed: false,
            name: "Document A search",
            hPath: "Notebook/Document A",
            idPath: ["notebook/document-a"],
            replaceTypes: {
                aText: true,
            },
        };
        const currentConfig: Config.IUILayoutTabSearchConfig = {
            hPath: "Notebook/Document B",
            idPath: ["notebook/document-b"],
        };

        const result = resolveSearchConfigUpdate({
            selectedConfig: criterion,
            currentConfig,
            useCurrentPath: true,
            persistedConfig: criterion,
        });

        assert.equal(result.runtimeConfig.hPath, "Notebook/Document B");
        assert.deepEqual(result.runtimeConfig.idPath, ["notebook/document-b"]);
        assert.equal(result.persistedConfig.hPath, "Notebook/Document A");
        assert.deepEqual(result.persistedConfig.idPath, ["notebook/document-a"]);
        assert.notStrictEqual(result.runtimeConfig.idPath, currentConfig.idPath);
        assert.notStrictEqual(result.persistedConfig.idPath, criterion.idPath);
        assert.notStrictEqual(result.persistedConfig.replaceTypes, criterion.replaceTypes);
        assert.deepEqual(criterion.idPath, ["notebook/document-a"]);
    });

    it("uses the selected runtime path when no contextual override is requested", () => {
        const result = resolveSearchConfigUpdate({
            selectedConfig: {
                hPath: "Notebook/Document B",
                idPath: ["notebook/document-b"],
            },
            currentConfig: {
                hPath: "Notebook/Document A",
                idPath: ["notebook/document-a"],
            },
            useCurrentPath: false,
        });

        assert.equal(result.runtimeConfig.hPath, "Notebook/Document B");
        assert.deepEqual(result.runtimeConfig.idPath, ["notebook/document-b"]);
    });
});
