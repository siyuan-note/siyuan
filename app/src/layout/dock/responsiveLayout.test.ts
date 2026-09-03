import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getCenterMinimumSize,
    IDockResponsiveLayoutInput,
    IDockResponsiveSideInput,
    resolveDockResponsiveLayout,
    resolveDockResponsiveWidth,
} from "./responsiveLayout";

const createSide = (overrides: Partial<IDockResponsiveSideInput> = {}): IDockResponsiveSideInput => ({
    preferredSize: 240,
    minimumSize: 180,
    participating: true,
    autoFloating: false,
    manualOverride: false,
    ...overrides,
});

const createInput = (overrides: Partial<IDockResponsiveLayoutInput> = {}): IDockResponsiveLayoutInput => ({
    availableSize: 1016,
    centerMinimumSize: 500,
    gapSize: 8,
    hysteresis: 24,
    left: createSide(),
    right: createSide({preferredSize: 260}),
    ...overrides,
});

describe("responsive dock layout", () => {
    it("keeps preferred sizes when the center and both docks fit", () => {
        assert.deepEqual(resolveDockResponsiveLayout(createInput()), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: false, fixedSize: 260},
        });
    });

    it("compresses the right dock before changing the left dock", () => {
        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 950})), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: false, fixedSize: 194},
        });
    });

    it("does not grow a preferred size that is below the nominal minimum", () => {
        assert.deepEqual(resolveDockResponsiveLayout(createInput({
            availableSize: 1016,
            right: createSide({preferredSize: 160, minimumSize: 180}),
        })), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: false, fixedSize: 160},
        });
    });

    it("floats the right dock before compressing the left dock", () => {
        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 750})), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: true, fixedSize: 0},
        });
        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 700})), {
            left: {autoFloating: false, fixedSize: 192},
            right: {autoFloating: true, fixedSize: 0},
        });
    });

    it("floats both docks when the window is extremely narrow", () => {
        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 300})), {
            left: {autoFloating: true, fixedSize: 0},
            right: {autoFloating: true, fixedSize: 0},
        });
    });

    it("restores the left dock before the right dock", () => {
        const floatingSides = {
            left: createSide({autoFloating: true}),
            right: createSide({preferredSize: 260, autoFloating: true}),
        };

        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 900, ...floatingSides})), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: true, fixedSize: 0},
        });
        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 960, ...floatingSides})), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: false, fixedSize: 204},
        });
    });

    it("uses hysteresis when restoring a previously floating dock", () => {
        const right = createSide({preferredSize: 260, autoFloating: true});

        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 959, right})), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: true, fixedSize: 0},
        });
        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 960, right})), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: false, fixedSize: 204},
        });
        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 936})), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: false, fixedSize: 180},
        });
        assert.deepEqual(resolveDockResponsiveLayout(createInput({availableSize: 935})), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: true, fixedSize: 0},
        });
    });

    it("clears automatic floating for docks that do not participate", () => {
        assert.deepEqual(resolveDockResponsiveLayout(createInput({
            availableSize: 700,
            left: createSide({participating: false, autoFloating: true}),
            right: createSide({preferredSize: 260, participating: false, autoFloating: true}),
        })), {
            left: {autoFloating: false, fixedSize: 0},
            right: {autoFloating: false, fixedSize: 0},
        });
    });

    it("does not compress or float a manually overridden dock", () => {
        assert.deepEqual(resolveDockResponsiveLayout(createInput({
            availableSize: 900,
            right: createSide({preferredSize: 260, manualOverride: true}),
        })), {
            left: {autoFloating: true, fixedSize: 0},
            right: {autoFloating: false, fixedSize: 260},
        });
        assert.deepEqual(resolveDockResponsiveLayout(createInput({
            availableSize: 300,
            left: createSide({manualOverride: true}),
            right: createSide({preferredSize: 260, manualOverride: true}),
        })), {
            left: {autoFloating: false, fixedSize: 240},
            right: {autoFloating: false, fixedSize: 260},
        });
    });
});

describe("responsive dock width", () => {
    it("clears stale constraints and keeps an inactive dock collapsed", () => {
        assert.deepEqual(resolveDockResponsiveWidth({
            active: false,
            preferredSize: 580,
            fixedSize: 0,
            floating: false,
            constrained: true,
        }), {
            clearConstraint: true,
            width: 0,
        });
    });

    it("restores the preferred width for a collapsed panel that still has active tools", () => {
        assert.deepEqual(resolveDockResponsiveWidth({
            active: true,
            preferredSize: 580,
            fixedSize: 0,
            floating: false,
            constrained: true,
        }), {
            clearConstraint: true,
            width: 580,
        });
    });

    it("applies the allocated maximum width to an active fixed dock", () => {
        assert.deepEqual(resolveDockResponsiveWidth({
            active: true,
            preferredSize: 580,
            fixedSize: 420,
            floating: false,
            constrained: false,
        }), {
            clearConstraint: false,
            maximumWidth: 420,
        });
    });

    it("leaves an unconstrained active dock unchanged", () => {
        assert.deepEqual(resolveDockResponsiveWidth({
            active: true,
            preferredSize: 580,
            fixedSize: 580,
            floating: false,
            constrained: false,
        }), {clearConstraint: false});
    });
});

describe("center minimum size", () => {
    const pane = () => ({});

    it("uses the pane minimum for a leaf", () => {
        assert.equal(getCenterMinimumSize(pane(), 480, 8), 480);
    });

    it("adds active horizontal panes and their dividers", () => {
        assert.equal(getCenterMinimumSize({
            direction: "lr",
            children: [pane(), {inactive: true}, pane()],
        }, 480, 8), 968);
    });

    it("uses the largest vertical branch", () => {
        assert.equal(getCenterMinimumSize({
            direction: "tb",
            children: [
                pane(),
                {
                    direction: "lr",
                    children: [pane(), pane()],
                },
            ],
        }, 480, 8), 968);
    });

    it("ignores inactive nested branches", () => {
        assert.equal(getCenterMinimumSize({
            direction: "lr",
            children: [
                pane(),
                {
                    inactive: true,
                    direction: "lr",
                    children: [pane(), pane()],
                },
                pane(),
            ],
        }, 480, 8), 968);
        assert.equal(getCenterMinimumSize({
            direction: "tb",
            children: [{inactive: true}, {inactive: true}],
        }, 480, 8), 0);
    });
});
