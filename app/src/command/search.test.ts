import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {normalizeCommandSearchText, searchCommands} from "./search";
import type {ICommandDefinition} from "./types";

const createCommand = (options: {
    id: string,
    label: string,
    english?: string,
    keywords?: string[],
}): ICommandDefinition => ({
    id: options.id,
    category: "core",
    label: () => options.label,
    englishLabel: () => options.english,
    keywords: () => options.keywords || [],
    execute: () => undefined,
});

const commands = [
    createCommand({
        id: "core.general.globalSearch",
        label: "全局搜索",
        english: "Global Search",
        keywords: ["find workspace"],
    }),
    createCommand({
        id: "core.editor.general.switchReadonly",
        label: "切换只读模式",
        english: "Switch read-only mode",
    }),
];

describe("command search", () => {
    it("normalizes width, case, camelCase, and separators", () => {
        assert.equal(normalizeCommandSearchText("ＧｌｏｂａｌSearch/core-command"), "global search core command");
        assert.equal(normalizeCommandSearchText("COMMAND_ID"), "command id");
    });

    it("searches the current label and English label", () => {
        assert.deepEqual(searchCommands(commands, "全局").map(item => item.id), ["core.general.globalSearch"]);
        assert.deepEqual(searchCommands(commands, "global search").map(item => item.id), ["core.general.globalSearch"]);
        assert.deepEqual(searchCommands(commands, "read only").map(item => item.id), [
            "core.editor.general.switchReadonly",
        ]);
    });

    it("searches stable IDs and keywords with multiple tokens", () => {
        assert.deepEqual(searchCommands(commands, "general global").map(item => item.id), [
            "core.general.globalSearch",
        ]);
        assert.deepEqual(searchCommands(commands, "workspace find").map(item => item.id), [
            "core.general.globalSearch",
        ]);
        assert.deepEqual(searchCommands(commands, "globalsearch").map(item => item.id), [
            "core.general.globalSearch",
        ]);
        assert.deepEqual(searchCommands(commands, "GLOBALSEARCH").map(item => item.id), [
            "core.general.globalSearch",
        ]);
    });

    it("ranks exact and prefix matches without disturbing ties", () => {
        const ranked = [
            createCommand({id: "sample.contains", label: "Open global search"}),
            createCommand({id: "sample.exact", label: "Search"}),
            createCommand({id: "sample.prefix", label: "Search documents"}),
        ];

        assert.deepEqual(searchCommands(ranked, "search").map(item => item.id), [
            "sample.exact",
            "sample.prefix",
            "sample.contains",
        ]);
        assert.deepEqual(searchCommands(ranked, "").map(item => item.id), ranked.map(item => item.id));
    });
});
