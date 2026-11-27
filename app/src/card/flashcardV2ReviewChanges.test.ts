import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {FlashcardV2ManagementView} from "./flashcardV2ManagementView";
import {notifyFlashcardV2ReviewChange, onFlashcardV2ReviewChange} from "./flashcardV2ReviewChanges";

test("only completed review mutations and session endings notify management", () => {
    const controller = new AbortController();
    let calls = 0;
    onFlashcardV2ReviewChange(() => calls++, controller.signal);
    try {
        for (const type of ["flashcard-review-session-started", "flashcard-review-card-shown",
            "flashcard-review-answer-revealed", "flashcard-review-rating-submitted", "failed"]) {
            notifyFlashcardV2ReviewChange(type);
        }
        assert.equal(calls, 0);
        for (const type of ["flashcard-review-rating-completed", "flashcard-review-undone",
            "flashcard-review-session-ended"]) {
            notifyFlashcardV2ReviewChange(type);
        }
        assert.equal(calls, 3);
    } finally {
        controller.abort();
    }
    notifyFlashcardV2ReviewChange("flashcard-review-session-ended");
    assert.equal(calls, 3);
});

test("management refresh follows latest filters once per change and stops on close", () => {
    const view = new FlashcardV2ManagementView();
    const calls: string[] = [];
    view.request(() => calls.push("initial"));
    view.bind();
    view.bind();
    view.bind();
    view.selected.add("card-a");
    try {
        view.request(() => calls.push("latest-filter"));
        notifyFlashcardV2ReviewChange("flashcard-review-rating-completed");
        notifyFlashcardV2ReviewChange("flashcard-review-undone");
        view.setRefresh(() => calls.push("latest-page"));
        notifyFlashcardV2ReviewChange("flashcard-review-session-ended");
        assert.deepEqual(calls, ["latest-filter", "latest-filter", "latest-page"]);
        assert.deepEqual([...view.selected], ["card-a"]);
    } finally {
        view.close();
    }
    notifyFlashcardV2ReviewChange("flashcard-review-rating-completed");
    assert.equal(calls.length, 3);
});

test("real session lifecycle notifies management even with no plugins installed", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const snippet = source.slice(source.indexOf("const emitFlashcardV2Lifecycle ="),
        source.indexOf("interface IFlashcardV2SessionTag"));
    const view = new FlashcardV2ManagementView();
    let calls = 0;
    view.setRefresh(() => calls++);
    view.bind();
    try {
        runInNewContext(transpileModule(`${snippet}\n` +
            'emitFlashcardV2Lifecycle({plugins: []}, "flashcard-review-rating-completed", {});\n' +
            'emitFlashcardV2Lifecycle({plugins: []}, "flashcard-review-undone", {});\n' +
            'emitFlashcardV2Lifecycle({plugins: []}, "flashcard-review-session-ended", {});', {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText, {notifyFlashcardV2ReviewChange});
        assert.equal(calls, 3);
    } finally {
        view.close();
    }
});

test("successful late rating and undo refresh live management without reviving closed views", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const live = new FlashcardV2ManagementView();
    const closed = new FlashcardV2ManagementView();
    let calls = 0;
    let closedCalls = 0;
    live.setRefresh(() => calls++);
    closed.setRefresh(() => closedCalls++);
    live.bind();
    closed.bind();
    closed.close();
    try {
        for (const marker of ["reviewed = true;", "undone = true;"]) {
            const start = source.indexOf(marker);
            const end = source.indexOf("\n                        }", start) +
                "\n                        }".length;
            assert.ok(start >= 0 && end > start);
            const snippet = source.slice(start, end);
            const context = {sessionFinished: true, reviewed: false, undone: false,
                notifyFlashcardV2ReviewChange, continued: false};
            runInNewContext(`(() => { ${snippet}\ncontinued = true; })();`, context);
            assert.equal(context.continued, false);
        }
        assert.equal(calls, 2);
        assert.equal(closedCalls, 0);
    } finally {
        live.close();
    }
});
