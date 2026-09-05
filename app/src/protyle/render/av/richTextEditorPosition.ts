import {setPosition} from "../../../util/setPosition";

export const AV_RICH_TEXT_EDITOR_MARGIN = 8;

export const positionAVRichTextEditor = (panelElement: HTMLElement, anchorElement: HTMLElement) => {
    const anchorRect = anchorElement.getBoundingClientRect();
    const width = Math.min(Math.max(anchorRect.width, 420), window.innerWidth - AV_RICH_TEXT_EDITOR_MARGIN * 2);
    const maxHeight = Math.max(240, Math.min(480, window.innerHeight - AV_RICH_TEXT_EDITOR_MARGIN * 2));
    const left = Math.min(Math.max(anchorRect.left, AV_RICH_TEXT_EDITOR_MARGIN),
        window.innerWidth - width - AV_RICH_TEXT_EDITOR_MARGIN);
    panelElement.style.width = `${width}px`;
    panelElement.style.maxHeight = `${maxHeight}px`;
    setPosition(panelElement, left, anchorRect.bottom, anchorRect.height, AV_RICH_TEXT_EDITOR_MARGIN);
};
