import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    DOCK_TRANSITION_DISABLED_CLASS,
    runWithoutDockTransitions,
} from "./responsiveTransition";

const createElement = (...initialClasses: string[]) => {
    const classes = new Set(initialClasses);
    return {
        element: {
            classList: {
                add: (...tokens: string[]) => tokens.forEach((token) => classes.add(token)),
                contains: (token: string) => classes.has(token),
                remove: (...tokens: string[]) => tokens.forEach((token) => classes.delete(token)),
            },
        } as unknown as HTMLElement,
        hasClass: (className: string) => classes.has(className),
    };
};

describe("responsive dock transition", () => {
    it("keeps both docks transition-free until the final layout is flushed", () => {
        const left = createElement();
        const right = createElement();
        const events: string[] = [];

        runWithoutDockTransitions([left.element, right.element], () => {
            assert.equal(left.hasClass(DOCK_TRANSITION_DISABLED_CLASS), true);
            assert.equal(right.hasClass(DOCK_TRANSITION_DISABLED_CLASS), true);
            events.push("apply");
        }, () => {
            assert.equal(left.hasClass(DOCK_TRANSITION_DISABLED_CLASS), true);
            assert.equal(right.hasClass(DOCK_TRANSITION_DISABLED_CLASS), true);
            events.push("flush");
        });

        assert.deepEqual(events, ["apply", "flush"]);
        assert.equal(left.hasClass(DOCK_TRANSITION_DISABLED_CLASS), false);
        assert.equal(right.hasClass(DOCK_TRANSITION_DISABLED_CLASS), false);
    });

    it("preserves a transition suppression class owned by another operation", () => {
        const element = createElement(DOCK_TRANSITION_DISABLED_CLASS);

        runWithoutDockTransitions([element.element], () => undefined, () => undefined);

        assert.equal(element.hasClass(DOCK_TRANSITION_DISABLED_CLASS), true);
    });

    it("restores transition classes when applying the layout fails", () => {
        const element = createElement();
        let flushed = false;

        assert.throws(() => runWithoutDockTransitions([element.element], () => {
            throw new Error("layout failed");
        }, () => {
            flushed = true;
            assert.equal(element.hasClass(DOCK_TRANSITION_DISABLED_CLASS), true);
        }), /layout failed/);
        assert.equal(flushed, true);
        assert.equal(element.hasClass(DOCK_TRANSITION_DISABLED_CLASS), false);
    });
});
