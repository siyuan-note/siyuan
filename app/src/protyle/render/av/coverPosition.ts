import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {escapeAriaLabel, escapeHtml} from "../../../util/escape";
import {calculateCardCoverPosition, isCardCoverPointerMoveActive} from "./cover";

interface ICardCoverPositionState {
    protyle: IProtyle;
    coverElement: HTMLElement;
    imageElement: HTMLImageElement;
    itemElement: HTMLElement;
    originalX: number;
    originalY: number;
    originalCustom: boolean;
    reset: boolean;
    dirty: boolean;
    draggable: string | null;
    pointerID: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    pointerDown: (event: PointerEvent) => void;
    pointerMove: (event: PointerEvent) => void;
    pointerUp: (event: PointerEvent) => void;
    keyDown: (event: KeyboardEvent) => void;
    actionElement?: HTMLElement;
    actionPointerDown: (event: PointerEvent) => void;
    actionClick: (event: MouseEvent) => void;
}

const states = new WeakMap<HTMLElement, ICardCoverPositionState>();
let activeCoverElement: HTMLElement | undefined;

const parsePosition = (value: string | undefined, fallback: number) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getCoverElement = (target: HTMLElement) => {
    const closestCover = hasClosestByClassName(target, "av__gallery-cover") as HTMLElement;
    if (closestCover) {
        return closestCover;
    }
    const itemElement = hasClosestByClassName(target, "av__gallery-item") as HTMLElement;
    return itemElement?.querySelector<HTMLElement>(".av__gallery-cover");
};

const getPosition = (imageElement: HTMLImageElement) => {
    const values = imageElement.style.objectPosition.split(" ");
    return {
        x: parsePosition(values[0], 50),
        y: parsePosition(values[1], 50),
    };
};

const setPosition = (imageElement: HTMLImageElement, x: number, y: number) => {
    imageElement.style.objectPosition = `${x.toFixed(2)}% ${y.toFixed(2)}%`;
};

const cleanCardCoverPosition = (state: ICardCoverPositionState, restore: boolean) => {
    if (restore) {
        setPosition(state.imageElement, state.originalX, state.originalY);
    }
    if (state.pointerID !== -1 && state.coverElement.hasPointerCapture(state.pointerID)) {
        state.coverElement.releasePointerCapture(state.pointerID);
    }
    state.pointerID = -1;
    state.coverElement.classList.remove("av__gallery-cover--positioning");
    state.coverElement.querySelector(".av__gallery-cover-position-tip")?.remove();
    state.coverElement.querySelector(".av__gallery-cover-position-actions")?.remove();
    state.coverElement.removeEventListener("pointerdown", state.pointerDown);
    state.coverElement.removeEventListener("lostpointercapture", state.pointerUp);
    state.actionElement?.removeEventListener("pointerdown", state.actionPointerDown);
    state.actionElement?.removeEventListener("click", state.actionClick);
    window.removeEventListener("pointermove", state.pointerMove);
    window.removeEventListener("pointerup", state.pointerUp);
    window.removeEventListener("pointercancel", state.pointerUp);
    window.removeEventListener("keydown", state.keyDown);
    if (state.draggable === null) {
        state.itemElement.removeAttribute("draggable");
    } else {
        state.itemElement.setAttribute("draggable", state.draggable);
    }
    states.delete(state.coverElement);
    if (activeCoverElement === state.coverElement) {
        activeCoverElement = undefined;
    }
};

export const finishCardCoverPosition = (protyle: IProtyle, target: HTMLElement, confirm: boolean) => {
    const coverElement = getCoverElement(target);
    const state = coverElement && states.get(coverElement);
    if (!state) {
        return;
    }
    if (!confirm) {
        cleanCardCoverPosition(state, true);
        return;
    }

    const current = getPosition(state.imageElement);
    const changed = state.reset ? state.originalCustom :
        state.dirty && (current.x !== state.originalX || current.y !== state.originalY);
    const blockElement = hasClosestBlock(coverElement) as HTMLElement;
    const source = coverElement.dataset.coverSource;
    const image = coverElement.dataset.coverUrl;
    cleanCardCoverPosition(state, false);
    if (!changed || !blockElement || !source || !image) {
        return;
    }

    transaction(protyle, [{
        action: "setAttrViewCardCoverPosition",
        avID: blockElement.dataset.avId,
        blockID: blockElement.dataset.nodeId,
        rowID: state.itemElement.dataset.id,
        data: {
            source,
            position: state.reset ? null : {
                image,
                x: current.x,
                y: current.y,
            },
        },
    }], [{
        action: "setAttrViewCardCoverPosition",
        avID: blockElement.dataset.avId,
        blockID: blockElement.dataset.nodeId,
        rowID: state.itemElement.dataset.id,
        data: {
            source,
            position: state.originalCustom ? {
                image,
                x: state.originalX,
                y: state.originalY,
            } : null,
        },
    }]);
};

export const resetCardCoverPosition = (target: HTMLElement) => {
    const coverElement = getCoverElement(target);
    const state = coverElement && states.get(coverElement);
    if (!state) {
        return;
    }
    state.reset = true;
    state.dirty = true;
    setPosition(state.imageElement, 50, 50);
};

export const startCardCoverPosition = (protyle: IProtyle, target: HTMLElement) => {
    const itemElement = hasClosestByClassName(target, "av__gallery-item") as HTMLElement;
    const coverElement = itemElement?.querySelector<HTMLElement>(".av__gallery-cover");
    const imageElement = coverElement?.querySelector<HTMLImageElement>(".av__gallery-img:not(.av__gallery-img--fit)");
    if (!coverElement || !imageElement || !itemElement || !coverElement.dataset.coverSource ||
        !coverElement.dataset.coverUrl) {
        return;
    }
    if (activeCoverElement && activeCoverElement !== coverElement) {
        const activeState = states.get(activeCoverElement);
        if (activeState) {
            cleanCardCoverPosition(activeState, true);
        }
    }
    if (states.has(coverElement)) {
        return;
    }

    const originalX = parsePosition(coverElement.dataset.coverPositionX, 50);
    const originalY = parsePosition(coverElement.dataset.coverPositionY, 50);
    const state = {} as ICardCoverPositionState;
    state.protyle = protyle;
    state.coverElement = coverElement;
    state.imageElement = imageElement;
    state.itemElement = itemElement;
    state.originalX = originalX;
    state.originalY = originalY;
    state.originalCustom = coverElement.dataset.coverPositionCustom === "true";
    state.reset = false;
    state.dirty = false;
    state.draggable = itemElement.getAttribute("draggable");
    state.pointerID = -1;
    state.startClientX = 0;
    state.startClientY = 0;
    state.startX = originalX;
    state.startY = originalY;
    state.pointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest(".av__gallery-cover-position-actions")) {
            return;
        }
        const imageWidth = imageElement.naturalWidth;
        const imageHeight = imageElement.naturalHeight;
        if (!imageWidth || !imageHeight) {
            return;
        }
        const scale = Math.max(imageElement.clientWidth / imageWidth, imageElement.clientHeight / imageHeight);
        state.pointerID = event.pointerId;
        state.startClientX = event.clientX;
        state.startClientY = event.clientY;
        const position = getPosition(imageElement);
        state.startX = position.x;
        state.startY = position.y;
        coverElement.dataset.coverOverflowX = Math.max(0, imageWidth * scale - imageElement.clientWidth).toString();
        coverElement.dataset.coverOverflowY = Math.max(0, imageHeight * scale - imageElement.clientHeight).toString();
        coverElement.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
    };
    state.pointerMove = (event: PointerEvent) => {
        if (event.pointerId !== state.pointerID) {
            return;
        }
        if (!isCardCoverPointerMoveActive(state.pointerID, event.pointerId, event.pointerType, event.buttons)) {
            if (coverElement.hasPointerCapture(event.pointerId)) {
                coverElement.releasePointerCapture(event.pointerId);
            }
            state.pointerID = -1;
            return;
        }
        const position = calculateCardCoverPosition(state.startX, state.startY,
            event.clientX - state.startClientX, event.clientY - state.startClientY,
            parseFloat(coverElement.dataset.coverOverflowX), parseFloat(coverElement.dataset.coverOverflowY));
        state.reset = false;
        state.dirty = true;
        setPosition(imageElement, position.x, position.y);
        event.preventDefault();
    };
    state.pointerUp = (event: PointerEvent) => {
        if (event.pointerId !== state.pointerID) {
            return;
        }
        state.pointerID = -1;
        if (coverElement.hasPointerCapture(event.pointerId)) {
            coverElement.releasePointerCapture(event.pointerId);
        }
        event.preventDefault();
    };
    state.keyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            finishCardCoverPosition(state.protyle, coverElement, false);
        } else if (event.key === "Enter") {
            finishCardCoverPosition(state.protyle, coverElement, true);
        }
    };
    state.actionPointerDown = (event: PointerEvent) => {
        event.stopPropagation();
    };
    state.actionClick = (event: MouseEvent) => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-type]");
        if (!actionElement) {
            return;
        }
        const type = actionElement.dataset.type;
        if (type === "av-cover-position-reset") {
            resetCardCoverPosition(coverElement);
        } else if (type === "av-cover-position-cancel") {
            finishCardCoverPosition(state.protyle, coverElement, false);
        } else if (type === "av-cover-position-confirm") {
            finishCardCoverPosition(state.protyle, coverElement, true);
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    coverElement.classList.add("av__gallery-cover--positioning");
    coverElement.insertAdjacentHTML("beforeend", `<div class="av__gallery-cover-position-tip">${escapeHtml(window.siyuan.languages.dragPosition)}</div>
<div class="av__gallery-cover-position-actions">
    <span class="protyle-icon protyle-icon--first ariaLabel" data-position="4north" aria-label="${escapeAriaLabel(window.siyuan.languages.reset)}" data-type="av-cover-position-reset"><svg><use xlink:href="#iconRefresh"></use></svg></span>
    <span class="protyle-icon ariaLabel" data-position="4north" aria-label="${escapeAriaLabel(window.siyuan.languages.cancel)}" data-type="av-cover-position-cancel"><svg><use xlink:href="#iconClose"></use></svg></span>
    <span class="protyle-icon protyle-icon--last ariaLabel" data-position="4north" aria-label="${escapeAriaLabel(window.siyuan.languages.confirm)}" data-type="av-cover-position-confirm"><svg><use xlink:href="#iconSelect"></use></svg></span>
</div>`);
    state.actionElement = coverElement.querySelector<HTMLElement>(".av__gallery-cover-position-actions");
    state.actionElement?.addEventListener("pointerdown", state.actionPointerDown);
    state.actionElement?.addEventListener("click", state.actionClick);
    itemElement.setAttribute("draggable", "false");
    setPosition(imageElement, originalX, originalY);
    coverElement.addEventListener("pointerdown", state.pointerDown);
    coverElement.addEventListener("lostpointercapture", state.pointerUp);
    window.addEventListener("pointermove", state.pointerMove, {passive: false});
    window.addEventListener("pointerup", state.pointerUp, {passive: false});
    window.addEventListener("pointercancel", state.pointerUp, {passive: false});
    window.addEventListener("keydown", state.keyDown);
    states.set(coverElement, state);
    activeCoverElement = coverElement;
};

export const isCardCoverPositioning = (target: HTMLElement) => {
    return Boolean(hasClosestByClassName(target, "av__gallery-cover--positioning"));
};
