import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    MOBILE_FILTER_TRIGGER_DEACTIVATE_CLASS,
    showMobileFilterInput,
} from "./mobileFilterInput";

const createClassTarget = (initialClasses: string[] = []) => {
    const classes = new Set(initialClasses);
    return {
        classes,
        target: {
            classList: {
                add(className: string) {
                    classes.add(className);
                },
                remove(className: string) {
                    classes.delete(className);
                },
            },
        },
    };
};

describe("mobile filter input", () => {
    it("suppresses the trigger press style until the next frame", () => {
        const input = createClassTarget(["fn__none"]);
        const trigger = createClassTarget();
        let selected = false;
        let scheduledCallback: () => void;

        showMobileFilterInput({
            ...input.target,
            select() {
                selected = true;
            },
        }, trigger.target, callback => {
            scheduledCallback = callback;
        });

        assert.equal(input.classes.has("fn__none"), false);
        assert.equal(selected, true);
        assert.equal(trigger.classes.has(MOBILE_FILTER_TRIGGER_DEACTIVATE_CLASS), true);

        scheduledCallback();
        assert.equal(trigger.classes.has(MOBILE_FILTER_TRIGGER_DEACTIVATE_CLASS), false);
    });
});
