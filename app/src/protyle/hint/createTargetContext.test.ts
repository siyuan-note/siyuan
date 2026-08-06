import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getCreateTargetContext, isSameCreateTargetContext} from "./createTargetContext";

describe("create target context", () => {
    it("treats missing lite editor context as empty context", () => {
        const context = getCreateTargetContext({} as IProtyle);

        assert.equal(isSameCreateTargetContext(context, {} as IProtyle), true);
    });

    it("detects document context changes", () => {
        const context = getCreateTargetContext({notebookId: "box", path: "/old.sy"} as IProtyle);

        assert.equal(isSameCreateTargetContext(context, {
            notebookId: "box",
            path: "/new.sy",
        } as IProtyle), false);
    });
});
