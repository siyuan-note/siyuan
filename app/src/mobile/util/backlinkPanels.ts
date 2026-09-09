import type {BacklinkContent} from "../../layout/dock/BacklinkContent";

const panels = new Set<BacklinkContent>();
const sheets = new Map<BacklinkContent, () => Promise<void>>();

export const registerMobileBacklinkPanel = (panel: BacklinkContent, close?: () => Promise<void>) => {
    panels.add(panel);
    if (close) {
        sheets.set(panel, close);
    }
    return () => {
        sheets.delete(panel);
        panels.delete(panel);
    };
};

export const getMobileBacklinkPanels = () => Array.from(panels);

export const closeMobileBacklinkSheets = () => {
    if (sheets.size) {
        return Promise.all(Array.from(sheets.values(), close => close())).then(() => undefined);
    }
};

export const removeMobileBacklinkContent = (options: {notebookId?: string, rootIDs?: string[]}) => {
    panels.forEach(panel => {
        if ((options.notebookId && panel.notebookId === options.notebookId) ||
            options.rootIDs?.includes(panel.rootId) || Array.from(panel.element.querySelectorAll("[data-notebook-id]"))
                .some(element => element.getAttribute("data-notebook-id") === options.notebookId) || panel.editors.some(editor =>
                (options.notebookId && editor.protyle.notebookId === options.notebookId) ||
                options.rootIDs?.includes(editor.protyle.block.rootID))) {
            panel.switchBlock("", "", "");
        }
    });
};
