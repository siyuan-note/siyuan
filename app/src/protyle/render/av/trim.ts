import {avRender} from "./render";
import {Constants} from "../../../constants";

const dataStore = new Map<string, {
    protyle: IProtyle;
    data: IAV;
}>();

const trimPending = new WeakSet<HTMLElement>();

const doTrim = (blockElement: HTMLElement, elementRect: DOMRect, protyle: IProtyle): void => {
    const bodies = blockElement.querySelectorAll(".av__body:not(.fn__none)") as NodeListOf<HTMLElement>;

    bodies.forEach((bodyEl: HTMLElement) => {
        const dataRows = Array.from(bodyEl.querySelectorAll(
            ".av__row:not(.av__row--header):not(.av__row--footer):not(.av__row--util)"
        )) as HTMLElement[];

        const viewportHeight = elementRect.height;
        const buffer = viewportHeight * 3;
        const topLimit = elementRect.top - buffer;
        const bottomLimit = elementRect.bottom + buffer;

        const toRemoveAbove: HTMLElement[] = [];
        const toRemoveBelow: HTMLElement[] = [];
        let firstVisibleIndex = -1;
        let lastVisibleIndex = -1;

        for (let i = 0; i < dataRows.length; i++) {
            const rect = dataRows[i].getBoundingClientRect();
            if (rect.bottom < topLimit) {
                toRemoveAbove.push(dataRows[i]);
            } else if (rect.top > bottomLimit) {
                toRemoveBelow.push(dataRows[i]);
            } else {
                if (firstVisibleIndex === -1) {
                    firstVisibleIndex = i;
                }
                lastVisibleIndex = i;
            }
        }

        if (toRemoveAbove.length === 0 && toRemoveBelow.length === 0) {
            return;
        }

        const existingTopSpacer = bodyEl.querySelector(".av__trim-spacer--top") as HTMLElement;
        const existingBottomSpacer = bodyEl.querySelector(".av__trim-spacer--bottom") as HTMLElement;

        if (existingTopSpacer) {
            const spacerRect = existingTopSpacer.getBoundingClientRect();
            if (spacerRect.bottom > elementRect.top + viewportHeight) {
                blockElement.removeAttribute("data-render");
                avRender(blockElement, protyle);
                return;
            }
        }
        if (existingBottomSpacer) {
            const spacerRect = existingBottomSpacer.getBoundingClientRect();
            if (spacerRect.top < elementRect.bottom - viewportHeight) {
                blockElement.removeAttribute("data-render");
                avRender(blockElement, protyle);
                return;
            }
        }

        const header = bodyEl.querySelector(".av__row--header") as HTMLElement;
        const headerBottom = header ? header.offsetTop + header.offsetHeight : 0;

        if (toRemoveAbove.length > 0 && firstVisibleIndex >= 0) {
            const firstVisibleRow = dataRows[firstVisibleIndex];
            if (firstVisibleRow) {
                const totalGap = firstVisibleRow.offsetTop - headerBottom;

                if (existingTopSpacer) {
                    existingTopSpacer.style.height = totalGap + "px";
                } else if (totalGap > 0) {
                    const topSpacer = document.createElement("div");
                    topSpacer.className = "av__trim-spacer av__trim-spacer--top";
                    topSpacer.style.height = totalGap + "px";
                    topSpacer.style.width = "100%";
                    topSpacer.style.flexShrink = "0";
                    if (header) {
                        header.after(topSpacer);
                    } else {
                        bodyEl.prepend(topSpacer);
                    }
                }
            }
        }

        if (toRemoveBelow.length > 0 && lastVisibleIndex >= 0) {
            const lastVisibleRow = dataRows[lastVisibleIndex];
            const footer = bodyEl.querySelector(".av__row--footer") as HTMLElement;
            const util = bodyEl.querySelector(".av__row--util") as HTMLElement;
            const endRef = footer || util;

            if (lastVisibleRow && endRef) {
                const totalGap = endRef.offsetTop - lastVisibleRow.offsetTop - lastVisibleRow.offsetHeight;

                if (existingBottomSpacer) {
                    existingBottomSpacer.style.height = totalGap + "px";
                } else if (totalGap > 0) {
                    const bottomSpacer = document.createElement("div");
                    bottomSpacer.className = "av__trim-spacer av__trim-spacer--bottom";
                    bottomSpacer.style.height = totalGap + "px";
                    bottomSpacer.style.width = "100%";
                    bottomSpacer.style.flexShrink = "0";
                    endRef.before(bottomSpacer);
                }
            }
        }

        toRemoveAbove.forEach(row => row.remove());
        toRemoveBelow.forEach(row => row.remove());
    });
};

export const trimAVRows = (blockElement: HTMLElement, elementRect: DOMRect, protyle: IProtyle, isUp:boolean): void => {
  if (blockElement.getAttribute(Constants.ATTRIBUTE_V_SCROLL) !== "true") {
      return;
  }
    if (trimPending.has(blockElement)) {
        return;
    }
    trimPending.add(blockElement);
    requestAnimationFrame(() => {
        trimPending.delete(blockElement);
        doTrim(blockElement, elementRect, protyle);
    });
};

export const bindAutoLoadScroll = (options: {
    protyle: IProtyle,
    blockElement: HTMLElement,
    data: IAV,
}): void => {
    dataStore.set(options.blockElement.getAttribute("data-av-id") +
        options.blockElement.getAttribute("custom-sy-av-view"), {
        protyle: options.protyle,
        data: options.data,
    });
};
