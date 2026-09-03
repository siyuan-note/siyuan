export interface IDockResponsiveSideInput {
    preferredSize: number;
    minimumSize: number;
    participating: boolean;
    autoFloating: boolean;
    manualOverride: boolean;
}

export interface IDockResponsiveLayoutInput {
    availableSize: number;
    centerMinimumSize: number;
    gapSize: number;
    hysteresis: number;
    left: IDockResponsiveSideInput;
    right: IDockResponsiveSideInput;
}

export interface IDockResponsiveSideResult {
    autoFloating: boolean;
    fixedSize: number;
}

export interface IDockResponsiveLayoutResult {
    left: IDockResponsiveSideResult;
    right: IDockResponsiveSideResult;
}

export interface IDockResponsiveWidthInput {
    active: boolean;
    preferredSize: number;
    fixedSize: number;
    floating: boolean;
    constrained: boolean;
}

export interface IDockResponsiveWidthResult {
    clearConstraint: boolean;
    width?: number;
    maximumWidth?: number;
}

export interface ICenterMinimumLayoutNode {
    inactive?: boolean;
    direction?: "lr" | "tb";
    children?: ICenterMinimumLayoutNode[];
}

interface INormalizedSide extends IDockResponsiveSideInput {
    fixedSize: number;
}

type SideName = "left" | "right";

const normalizeSize = (size: number) => Number.isFinite(size) ? Math.max(0, size) : 0;

export const resolveDockResponsiveWidth = (input: IDockResponsiveWidthInput): IDockResponsiveWidthResult => {
    if (!input.active) {
        return {
            clearConstraint: true,
            width: 0,
        };
    }

    const preferredSize = normalizeSize(input.preferredSize);
    const fixedSize = normalizeSize(input.fixedSize);
    if (!input.floating && fixedSize > 0 && fixedSize < preferredSize) {
        return {
            clearConstraint: false,
            maximumWidth: fixedSize,
        };
    }
    if (input.constrained) {
        return {
            clearConstraint: true,
            width: preferredSize,
        };
    }
    return {clearConstraint: false};
};

const normalizeSide = (side: IDockResponsiveSideInput): INormalizedSide => {
    const preferredSize = normalizeSize(side.preferredSize);
    const minimumSize = Math.min(normalizeSize(side.minimumSize), preferredSize);
    return {
        ...side,
        preferredSize,
        minimumSize,
        autoFloating: side.participating && side.autoFloating,
        fixedSize: 0,
    };
};

const copySide = (side: INormalizedSide): INormalizedSide => ({...side});

const isFixed = (side: INormalizedSide) => side.participating && !side.autoFloating;

const allocateFixedSizes = (
    leftInput: INormalizedSide,
    rightInput: INormalizedSide,
    availableSize: number,
    centerMinimumSize: number,
    gapSize: number,
) => {
    const left = copySide(leftInput);
    const right = copySide(rightInput);
    const sides = {left, right};
    let fixedCount = 0;
    let occupiedSize = centerMinimumSize;

    for (const side of [left, right]) {
        if (isFixed(side)) {
            side.fixedSize = side.preferredSize;
            fixedCount++;
            occupiedSize += side.fixedSize;
        } else {
            side.fixedSize = 0;
        }
    }
    occupiedSize += fixedCount * gapSize;

    let deficit = Math.max(0, occupiedSize - availableSize);
    const shrinkOrFloat = (name: SideName) => {
        const side = sides[name];
        if (deficit === 0 || !isFixed(side) || side.manualOverride) {
            return;
        }

        const shrinkSize = Math.min(deficit, side.fixedSize - side.minimumSize);
        side.fixedSize -= shrinkSize;
        deficit -= shrinkSize;
        if (deficit > 0) {
            side.autoFloating = true;
            deficit = Math.max(0, deficit - side.fixedSize - gapSize);
            side.fixedSize = 0;
        }
    };

    shrinkOrFloat("right");
    shrinkOrFloat("left");
    return sides;
};

export const resolveDockResponsiveLayout = (input: IDockResponsiveLayoutInput): IDockResponsiveLayoutResult => {
    const availableSize = normalizeSize(input.availableSize);
    const centerMinimumSize = normalizeSize(input.centerMinimumSize);
    const gapSize = normalizeSize(input.gapSize);
    const hysteresis = normalizeSize(input.hysteresis);
    const sides = {
        left: normalizeSide(input.left),
        right: normalizeSide(input.right),
    };

    for (const name of ["left", "right"] as const) {
        const side = sides[name];
        if (!side.participating || !side.autoFloating || side.manualOverride) {
            continue;
        }

        const previouslyFixed = (["left", "right"] as const).filter((sideName) => isFixed(sides[sideName]));
        const candidate = {
            left: copySide(sides.left),
            right: copySide(sides.right),
        };
        candidate[name].autoFloating = false;
        const trial = allocateFixedSizes(
            candidate.left,
            candidate.right,
            Math.max(0, availableSize - hysteresis),
            centerMinimumSize,
            gapSize,
        );
        if (!trial[name].autoFloating && previouslyFixed.every((sideName) => !trial[sideName].autoFloating)) {
            sides[name].autoFloating = false;
        }
    }

    const result = allocateFixedSizes(sides.left, sides.right, availableSize, centerMinimumSize, gapSize);
    return {
        left: {
            autoFloating: result.left.autoFloating,
            fixedSize: result.left.fixedSize,
        },
        right: {
            autoFloating: result.right.autoFloating,
            fixedSize: result.right.fixedSize,
        },
    };
};

const getNodeMinimumSize = (
    node: ICenterMinimumLayoutNode,
    paneMinimumSize: number,
    dividerSize: number,
): number | undefined => {
    if (node.inactive) {
        return;
    }
    if (!node.children?.length) {
        return paneMinimumSize;
    }

    const childSizes = node.children
        .map((child) => getNodeMinimumSize(child, paneMinimumSize, dividerSize))
        .filter((size): size is number => typeof size === "number");
    if (childSizes.length === 0) {
        return;
    }
    if (node.direction === "lr") {
        return childSizes.reduce((total, size) => total + size, 0) + dividerSize * (childSizes.length - 1);
    }
    return Math.max(...childSizes);
};

export const getCenterMinimumSize = (
    node: ICenterMinimumLayoutNode,
    paneMinimumSize: number,
    dividerSize: number,
) => getNodeMinimumSize(node, normalizeSize(paneMinimumSize), normalizeSize(dividerSize)) ?? 0;
