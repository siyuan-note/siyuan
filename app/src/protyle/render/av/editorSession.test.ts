import * as assert from "node:assert/strict";
import {test} from "node:test";
import {beginAVEditorSession, hasAVEditorSession} from "./editorSession";

test("floating editors defer only their owning panel and notify once when closed", () => {
    const events: Event[] = [];
    const owner = {dispatchEvent: (event: Event) => events.push(event)} as unknown as HTMLElement;
    const panel = {contains: (element: HTMLElement) => element === owner} as HTMLElement;
    const otherPanel = {contains: () => false} as unknown as HTMLElement;
    const endFirst = beginAVEditorSession(owner);
    const endSecond = beginAVEditorSession(owner);
    try {
        assert.equal(hasAVEditorSession(panel), true);
        assert.equal(hasAVEditorSession(otherPanel), false);
        endFirst();
        endFirst();
        assert.equal(hasAVEditorSession(panel), true);
        assert.equal(events.length, 1);
        endSecond();
        assert.equal(hasAVEditorSession(panel), false);
        assert.equal(events.length, 2);
        assert.equal(events[0].type, "av-editor-close");
        assert.equal(events[0].bubbles, true);
    } finally {
        endFirst();
        endSecond();
    }
});
