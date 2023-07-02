import {hasClosestBlock} from "../../util/hasClosest";

export const getColIconByType = (type: TAVCol) => {
    switch (type) {
        case "text":
            return "iconAlignLeft";
        case "block":
            return "iconParagraph";
        case "number":
            return "iconNumber";
        case "select":
            return "iconListItem";
        case "mSelect":
            return "iconList";
        case "date":
            return "iconCalendar";
    }
};

export const updateHeader = (rowElement: HTMLElement) => {
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return;
    }
    const selectCount = rowElement.parentElement.querySelectorAll(".av__row--select:not(.av__row--header)").length;
    const diffCount = rowElement.parentElement.childElementCount - 3 - selectCount;
    const headElement = rowElement.parentElement.firstElementChild;
    const headUseElement = headElement.querySelector("use");
    const counterElement = blockElement.querySelector(".av__counter");
    const avHeadElement = blockElement.querySelector(".av__header") as HTMLElement;
    if (diffCount === 0) {
        headElement.classList.add("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconCheck");
    } else if (diffCount === rowElement.parentElement.childElementCount - 3) {
        headElement.classList.remove("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconUncheck");
        counterElement.classList.add("fn__none");
        avHeadElement.style.position = "";
        return;
    } else if (diffCount > 0) {
        headElement.classList.add("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconIndeterminateCheck");
    }
    counterElement.classList.remove("fn__none");
    counterElement.innerHTML = `${selectCount} selected`;
    avHeadElement.style.position = "sticky";
};
