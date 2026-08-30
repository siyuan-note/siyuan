import {Constants} from "../../constants";
import {
    getCenterMinimumSize,
    type ICenterMinimumLayoutNode,
    resolveDockResponsiveLayout,
} from "./responsiveLayout";
import {runWithoutDockTransitions} from "./responsiveTransition";

const EDITOR_MINIMUM_WIDTH = 480;
const RESPONSIVE_HYSTERESIS = 32;

let frameId = 0;
let applying = false;

interface IRuntimeLayoutNode {
    direction?: Config.TUILayoutDirection,
    children?: unknown[],
    element?: HTMLElement,
}

const getLayoutNode = (item: IRuntimeLayoutNode): ICenterMinimumLayoutNode => {
    const isLayout = item.direction === "lr" || item.direction === "tb";
    return {
        inactive: item.element?.classList.contains("fn__none"),
        direction: isLayout ? item.direction : undefined,
        children: isLayout ? item.children?.map((child) => getLayoutNode(child as IRuntimeLayoutNode)) : undefined,
    };
};

const hasCenterMaximumWidth = (item: IRuntimeLayoutNode): boolean => {
    return item.children?.some((child) => {
        const childItem = child as IRuntimeLayoutNode;
        if (childItem.element?.style.maxWidth ||
            childItem.element?.hasAttribute(Constants.ATTRIBUTE_DOCK_WIDTH)) {
            return true;
        }
        return (childItem.direction === "lr" || childItem.direction === "tb") &&
            hasCenterMaximumWidth(childItem);
    }) ?? false;
};

const getLayoutGap = () => {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--b3-layout-space"));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
};

const updateResponsiveWidth = (
    dock: typeof window.siyuan.layout.leftDock,
    preferredSize: number,
    fixedSize: number,
) => {
    const element = dock.layout.element;
    const hasResponsiveWidth = Boolean(element.style.maxWidth ||
        element.hasAttribute(Constants.ATTRIBUTE_DOCK_WIDTH));
    const shouldConstrain = !dock.isResponsiveFloating() && fixedSize > 0 && fixedSize < preferredSize;
    if (!shouldConstrain) {
        if (!hasResponsiveWidth) {
            return;
        }
        element.style.maxWidth = "";
        element.removeAttribute(Constants.ATTRIBUTE_DOCK_WIDTH);
        const preferredWidth = preferredSize + "px";
        if (preferredSize > 0 && element.style.width !== preferredWidth) {
            element.style.width = preferredWidth;
        }
        return;
    }
    const preferredWidth = preferredSize.toString();
    const maximumWidth = fixedSize + "px";
    if (element.getAttribute(Constants.ATTRIBUTE_DOCK_WIDTH) !== preferredWidth) {
        element.setAttribute(Constants.ATTRIBUTE_DOCK_WIDTH, preferredWidth);
    }
    if (element.style.maxWidth !== maximumWidth) {
        element.style.maxWidth = maximumWidth;
    }
};

export const reconcileResponsiveDockLayout = () => {
    if (applying) {
        return;
    }
    const layout = window.siyuan?.layout;
    const leftDock = layout?.leftDock;
    const rightDock = layout?.rightDock;
    const centerLayout = layout?.centerLayout;
    const outerLayout = centerLayout?.parent;
    if (!leftDock || !rightDock || !outerLayout || outerLayout.direction !== "lr") {
        return;
    }

    const availableSize = outerLayout.element.clientWidth;
    if (availableSize <= 0) {
        return;
    }

    applying = true;
    try {
        const centerSizeBefore = centerLayout.element.clientWidth;
        const gapSize = getLayoutGap();
        const centerMinimumSize = Math.max(EDITOR_MINIMUM_WIDTH, getCenterMinimumSize(
            getLayoutNode(centerLayout),
            EDITOR_MINIMUM_WIDTH,
            gapSize,
        ));
        const leftPreferredSize = leftDock.getResponsivePreferredSize();
        const rightPreferredSize = rightDock.getResponsivePreferredSize();
        const leftParticipating = leftDock.pin && leftDock.isPanelVisible();
        const rightParticipating = rightDock.pin && rightDock.isPanelVisible();
        const preferredOccupiedSize = centerMinimumSize +
            (leftParticipating ? leftPreferredSize + gapSize : 0) +
            (rightParticipating ? rightPreferredSize + gapSize : 0);

        if (availableSize >= preferredOccupiedSize + RESPONSIVE_HYSTERESIS) {
            leftDock.clearResponsiveManualOverride();
            rightDock.clearResponsiveManualOverride();
        }

        const result = resolveDockResponsiveLayout({
            availableSize,
            centerMinimumSize,
            gapSize,
            hysteresis: RESPONSIVE_HYSTERESIS,
            left: {
                preferredSize: leftPreferredSize,
                minimumSize: leftDock.getResponsiveMinimumSize(),
                participating: leftParticipating,
                autoFloating: leftDock.isResponsiveFloating(),
                manualOverride: leftDock.hasResponsiveManualOverride(),
            },
            right: {
                preferredSize: rightPreferredSize,
                minimumSize: rightDock.getResponsiveMinimumSize(),
                participating: rightParticipating,
                autoFloating: rightDock.isResponsiveFloating(),
                manualOverride: rightDock.hasResponsiveManualOverride(),
            },
        });

        const floatingStateChanged = result.left.autoFloating !== leftDock.isResponsiveFloating() ||
            result.right.autoFloating !== rightDock.isResponsiveFloating();
        const applyResult = () => {
            // 拉宽时先恢复左侧，再恢复右侧。
            if (!result.left.autoFloating && leftDock.isResponsiveFloating()) {
                leftDock.setResponsiveFloating(false, leftPreferredSize);
            }
            if (!result.right.autoFloating && rightDock.isResponsiveFloating()) {
                rightDock.setResponsiveFloating(false, rightPreferredSize);
            }
            // 缩窄时先浮动右侧，再浮动左侧。
            if (result.right.autoFloating && !rightDock.isResponsiveFloating()) {
                rightDock.setResponsiveFloating(true, rightPreferredSize);
            }
            if (result.left.autoFloating && !leftDock.isResponsiveFloating()) {
                leftDock.setResponsiveFloating(true, leftPreferredSize);
            }

            updateResponsiveWidth(leftDock, leftPreferredSize, result.left.fixedSize);
            updateResponsiveWidth(rightDock, rightPreferredSize, result.right.fixedSize);
            if (centerLayout.element.clientWidth !== centerSizeBefore && hasCenterMaximumWidth(centerLayout)) {
                leftDock.adjustResponsiveCenterLayout();
            }
        };
        if (floatingStateChanged) {
            runWithoutDockTransitions([
                leftDock.layout.element,
                rightDock.layout.element,
            ], applyResult, () => {
                void outerLayout.element.offsetWidth;
            });
        } else {
            applyResult();
        }
    } finally {
        applying = false;
    }
};

export const requestResponsiveDockLayout = () => {
    if (applying || frameId) {
        return;
    }
    frameId = requestAnimationFrame(() => {
        frameId = 0;
        reconcileResponsiveDockLayout();
    });
};
