import {getTopBarHeight} from "../../../layout/getTopBarHeight";
import {setAVCellPanelPosition} from "./cellPanelPosition";

export const AV_RICH_TEXT_EDITOR_MARGIN = 8;

export const positionAVRichTextEditor = (panelElement: HTMLElement, anchorElement: HTMLElement) => {
    const anchorRect = anchorElement.getBoundingClientRect();
    const width = Math.min(Math.max(anchorRect.width, 420), window.innerWidth - AV_RICH_TEXT_EDITOR_MARGIN * 2);
    const maxHeight = Math.min(480, window.innerHeight - Math.max(getTopBarHeight(), AV_RICH_TEXT_EDITOR_MARGIN) - AV_RICH_TEXT_EDITOR_MARGIN);
    panelElement.style.width = `${width}px`;
    panelElement.style.maxHeight = `${maxHeight}px`;
    setAVCellPanelPosition(panelElement, anchorRect, AV_RICH_TEXT_EDITOR_MARGIN);
};
