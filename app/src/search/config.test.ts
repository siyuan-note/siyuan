import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    cloneSearchConfig,
    getSearchPathID,
    getGlobalSearchPath,
    hasExplicitSearchScope,
    hasSearchConfigTemporaryPath,
    isSameSearchPath,
    isCurrentSearchPath,
    isSearchPathRequestVersionCurrent,
    isSearchPathAffectedByNotebookRename,
    isSearchPathAffectedByRename,
    nextSearchPathRequestVersion,
    refreshSearchConfigHPath,
    replaceSearchConfigPath,
    resolvePersistedSearchConfig,
    resolveSearchHPath,
    resolveSearchNotebookHPath,
    resolveSearchConfig,
    setSearchConfigTemporaryPath,
    syncSearchConfig,
    syncSearchConfigHPath,
} from "./config";

describe("search configuration scope", () => {
    const criterionA: Config.IUILayoutTabSearchConfig = {
        removed: false,
        name: "criterion A",
        hPath: "Notebook/Document A",
        idPath: ["notebook/document-a"],
        k: "keyword",
        method: 0,
    };
    const documentB: Config.IUILayoutTabSearchConfig = {
        removed: false,
        hPath: "Notebook/Document B",
        idPath: ["notebook/document-b"],
        k: "keyword",
        method: 0,
    };

    it("keeps the current document effective without changing the saved criterion", () => {
        const result = resolveSearchConfig(criterionA, documentB, true);

        assert.equal(result.effectiveConfig.hPath, documentB.hPath);
        assert.deepEqual(result.effectiveConfig.idPath, documentB.idPath);
        assert.equal(result.persistedConfig.hPath, criterionA.hPath);
        assert.deepEqual(result.persistedConfig.idPath, criterionA.idPath);
        assert.equal(criterionA.hPath, "Notebook/Document A");
        assert.deepEqual(criterionA.idPath, ["notebook/document-a"]);

        result.effectiveConfig.idPath.push("notebook/document-b-child");
        assert.deepEqual(documentB.idPath, ["notebook/document-b"]);
        assert.deepEqual(result.persistedConfig.idPath, ["notebook/document-a"]);
    });

    it("restores the saved criterion path for global search", () => {
        const {persistedConfig} = resolveSearchConfig(criterionA, documentB, true);
        const globalPath = getGlobalSearchPath(persistedConfig);

        assert.equal(globalPath.hPath, criterionA.hPath);
        assert.deepEqual(globalPath.idPath, criterionA.idPath);
        assert.notEqual(globalPath.idPath, persistedConfig.idPath);
    });

    it("clears the global path after the criterion is removed", () => {
        const globalPath = getGlobalSearchPath({
            removed: true,
            hPath: documentB.hPath,
            idPath: [...documentB.idPath],
        });

        assert.deepEqual(globalPath, {
            hPath: "",
            idPath: [],
        });
    });

    it("keeps the persisted path when a shortcut changes the effective scope", () => {
        const effectiveDocumentSearch = replaceSearchConfigPath(criterionA, documentB);
        const persistedDocumentSearch = replaceSearchConfigPath(effectiveDocumentSearch, criterionA);
        const globalPath = getGlobalSearchPath(persistedDocumentSearch);

        assert.equal(effectiveDocumentSearch.hPath, documentB.hPath);
        assert.deepEqual(effectiveDocumentSearch.idPath, documentB.idPath);
        assert.equal(persistedDocumentSearch.hPath, criterionA.hPath);
        assert.deepEqual(globalPath.idPath, criterionA.idPath);
    });

    it("does not persist temporary document paths after changing other options", () => {
        const activeCriterionConfig = resolvePersistedSearchConfig(documentB, criterionA, true);
        const removedCriterionConfig = resolvePersistedSearchConfig({
            ...documentB,
            removed: true,
        }, criterionA, true);

        assert.equal(activeCriterionConfig.hPath, criterionA.hPath);
        assert.deepEqual(activeCriterionConfig.idPath, criterionA.idPath);
        assert.equal(removedCriterionConfig.hPath, "");
        assert.deepEqual(removedCriterionConfig.idPath, []);
    });

    it("treats explicitly scoped replace paths as temporary", () => {
        assert.equal(hasExplicitSearchScope({}), false);
        assert.equal(hasExplicitSearchScope({notebookIds: []}), false);
        assert.equal(hasExplicitSearchScope({notebookId: "notebook"}), true);
        assert.equal(hasExplicitSearchScope({notebookIds: ["notebook-a", "notebook-b"]}), true);

        const scopedReplace = {
            ...documentB,
            hasReplace: true,
        };
        const replaceCriterion = {
            ...criterionA,
            hasReplace: true,
            replaceTypes: {text: true},
        };
        setSearchConfigTemporaryPath(scopedReplace, hasExplicitSearchScope({notebookId: "notebook"}));

        const appliedCriterion = resolveSearchConfig(
            replaceCriterion,
            scopedReplace,
            hasSearchConfigTemporaryPath(scopedReplace),
        );
        syncSearchConfig(scopedReplace, appliedCriterion.effectiveConfig);
        scopedReplace.method = 3;
        scopedReplace.replaceTypes = {text: false};
        const pinnedSearchConfig = cloneSearchConfig(scopedReplace);
        const persistedConfig = resolvePersistedSearchConfig(
            scopedReplace,
            appliedCriterion.persistedConfig,
            hasSearchConfigTemporaryPath(scopedReplace),
        );

        assert.equal(scopedReplace.hPath, documentB.hPath);
        assert.deepEqual(scopedReplace.idPath, documentB.idPath);
        assert.equal(persistedConfig.hPath, criterionA.hPath);
        assert.deepEqual(persistedConfig.idPath, criterionA.idPath);
        assert.equal(persistedConfig.method, 3);
        assert.deepEqual(persistedConfig.replaceTypes, {text: false});
        assert.equal(hasSearchConfigTemporaryPath(pinnedSearchConfig), false);
    });

    it("detects renamed documents that affect the current search path", () => {
        assert.equal(isSearchPathAffectedByRename(
            ["notebook/parent/document"], "notebook", "/parent/document.sy", "document"), true);
        assert.equal(isSearchPathAffectedByRename(
            ["notebook/parent/document.sy"], "notebook", "/parent.sy", "parent"), true);
        assert.equal(isSearchPathAffectedByRename(
            ["document"], "notebook", "/parent/document.sy", "document"), true);
        assert.equal(isSearchPathAffectedByRename(
            ["notebook/other"], "notebook", "/parent/document.sy", "document"), false);
        assert.equal(isSearchPathAffectedByRename(
            ["notebook/parent"], "notebook", "/parent/child.sy", "child"), false);
        assert.equal(isSearchPathAffectedByRename(
            ["notebook/parent2"], "notebook", "/parent.sy", "parent"), false);
        assert.equal(isSearchPathAffectedByRename(
            ["notebook/parent/document"], "notebook", "/parent/document.sy", undefined), true);
        assert.equal(isSearchPathAffectedByRename(
            ["document"], "notebook", "/parent/document.sy", undefined), true);
    });

    it("detects notebook renames for notebook and document scopes", () => {
        assert.equal(isSearchPathAffectedByNotebookRename(["notebook"], "notebook"), true);
        assert.equal(isSearchPathAffectedByNotebookRename(["notebook/parent/document"], "notebook"), true);
        assert.equal(isSearchPathAffectedByNotebookRename(["notebook2/document"], "notebook"), false);
    });

    it("resolves notebook scopes without requiring a document block", () => {
        const notebooks = [{id: "notebook", name: "Old Notebook"}];

        assert.equal(resolveSearchNotebookHPath("notebook", notebooks), "Old Notebook");
        assert.equal(resolveSearchNotebookHPath("notebook", notebooks, {notebook: "Renamed Notebook"}),
            "Renamed Notebook");
        assert.equal(resolveSearchNotebookHPath("document", notebooks), undefined);
    });

    it("validates that a stored search path has not moved", () => {
        assert.equal(getSearchPathID("notebook/parent/document.sy"), "document");
        assert.equal(isCurrentSearchPath(
            "notebook/parent/document", "notebook", "/parent/document.sy"), true);
        assert.equal(isCurrentSearchPath(
            "notebook/parent/document.sy", "notebook", "/parent/document.sy"), true);
        assert.equal(isCurrentSearchPath(
            "notebook/parent/document", "notebook", "/moved/document.sy"), false);
        assert.equal(isCurrentSearchPath(
            "notebook/parent/document", "other-notebook", "/parent/document.sy"), false);
        assert.equal(isCurrentSearchPath("notebook", "notebook", "/notebook.sy"), true);
        assert.equal(isCurrentSearchPath("document", "notebook", "/parent/document.sy"), true);
    });

    it("updates only a persisted human-readable path for the same stable scope", () => {
        const persistedCriterion = cloneSearchConfig(criterionA);
        const renamedCriterion = {
            ...cloneSearchConfig(criterionA),
            hPath: "Notebook/Renamed Document A",
        };
        assert.equal(syncSearchConfigHPath(persistedCriterion, renamedCriterion), true);
        assert.equal(persistedCriterion.hPath, renamedCriterion.hPath);

        const persistedOtherScope = cloneSearchConfig(criterionA);
        assert.equal(syncSearchConfigHPath(persistedOtherScope, documentB), false);
        assert.equal(persistedOtherScope.hPath, criterionA.hPath);
    });

    it("invalidates older asynchronous search path requests", () => {
        const searchElement = {};
        const firstVersion = nextSearchPathRequestVersion(searchElement);
        assert.equal(isSearchPathRequestVersionCurrent(searchElement, firstVersion), true);

        const secondVersion = nextSearchPathRequestVersion(searchElement);
        assert.equal(isSearchPathRequestVersionCurrent(searchElement, firstVersion), false);
        assert.equal(isSearchPathRequestVersionCurrent(searchElement, secondVersion), true);
    });

    it("resolves current human-readable paths without changing their stable paths", async () => {
        const idPath = ["notebook/parent/document", "notebook/second"];
        const requestedPaths: string[] = [];
        const hPath = await resolveSearchHPath(idPath, async (path) => {
            requestedPaths.push(path);
            return path.endsWith("document") ? "Notebook/New <Title>" : "Notebook/Second";
        });

        assert.equal(hPath, "Notebook/New <Title> Notebook/Second");
        assert.deepEqual(requestedPaths, idPath);
        assert.deepEqual(idPath, ["notebook/parent/document", "notebook/second"]);
        assert.equal(await resolveSearchHPath([], async () => "unused"), undefined);
        assert.equal(await resolveSearchHPath(idPath, async () => undefined), undefined);
        assert.equal(await resolveSearchHPath(idPath, async () => {
            throw new Error("unavailable");
        }), undefined);
    });

    it("keeps the configured order when path requests finish out of order", async () => {
        const idPath = ["notebook/first", "notebook/second"];
        const resolvers = new Map<string, (value: string) => void>();
        const hPathPromise = resolveSearchHPath(idPath, (path) => new Promise((resolve) => {
            resolvers.set(path, resolve);
        }));

        resolvers.get(idPath[1])("Notebook/Second");
        resolvers.get(idPath[0])("Notebook/First");

        assert.equal(await hPathPromise, "Notebook/First Notebook/Second");
    });

    it("refreshes the original search configuration after resolving its current path", async () => {
        const config: Config.IUILayoutTabSearchConfig = {
            ...documentB,
            hPath: "Notebook/Old Document B",
            idPath: [...documentB.idPath],
        };
        const reference = config;
        let resolvedPath: string[];
        let renderedPath = "";

        const refreshed = await refreshSearchConfigHPath({
            config,
            resolveHPath: async (idPath) => {
                resolvedPath = idPath;
                return "Notebook/Renamed Document B";
            },
            render: (hPath) => {
                renderedPath = hPath;
            },
        });

        assert.equal(refreshed, true);
        assert.equal(config, reference);
        assert.equal(config.hPath, "Notebook/Renamed Document B");
        assert.deepEqual(config.idPath, documentB.idPath);
        assert.deepEqual(resolvedPath, documentB.idPath);
        assert.notEqual(resolvedPath, config.idPath);
        assert.equal(renderedPath, config.hPath);
    });

    it("discards a resolved path after the stable scope changes", async () => {
        const config: Config.IUILayoutTabSearchConfig = {
            ...documentB,
            hPath: "Notebook/Old Document B",
            idPath: [...documentB.idPath],
        };
        let resolveHPath: (value: string) => void;
        let rendered = false;
        const refreshed = refreshSearchConfigHPath({
            config,
            resolveHPath: () => new Promise((resolve) => {
                resolveHPath = resolve;
            }),
            render: () => {
                rendered = true;
            },
        });

        config.idPath = ["notebook/other"];
        resolveHPath("Notebook/Renamed Document B");

        assert.equal(await refreshed, false);
        assert.equal(config.hPath, "Notebook/Old Document B");
        assert.equal(rendered, false);
    });

    it("does not refresh when the request is stale or fails", async () => {
        const staleConfig = cloneSearchConfig(documentB);
        assert.equal(await refreshSearchConfigHPath({
            config: staleConfig,
            resolveHPath: async () => "Notebook/Renamed Document B",
            isCurrent: () => false,
        }), false);
        assert.equal(staleConfig.hPath, documentB.hPath);

        const failedConfig = cloneSearchConfig(documentB);
        assert.equal(await refreshSearchConfigHPath({
            config: failedConfig,
            resolveHPath: async () => {
                throw new Error("unavailable");
            },
        }), false);
        assert.equal(failedConfig.hPath, documentB.hPath);
        assert.equal(isSameSearchPath(documentB.idPath, failedConfig.idPath), true);
    });

    it("updates shared configuration references in place", () => {
        const target: Config.IUILayoutTabSearchConfig = {
            hPath: documentB.hPath,
            idPath: [...documentB.idPath],
            query: "stale query",
        };
        const reference = target;

        const result = syncSearchConfig(target, criterionA);

        assert.equal(result, reference);
        assert.equal(reference.hPath, criterionA.hPath);
        assert.deepEqual(reference.idPath, criterionA.idPath);
        assert.equal(reference.query, undefined);
        assert.notEqual(reference.idPath, criterionA.idPath);
    });
});
