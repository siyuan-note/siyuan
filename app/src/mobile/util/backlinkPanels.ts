import type {BacklinkContent} from "../../layout/dock/BacklinkContent";

const panels = new Set<BacklinkContent>();
export const registerMobileBacklinkPanel = (panel: BacklinkContent) => {
    panels.add(panel);
    return () => {
        panels.delete(panel);
    };
};

export const getMobileBacklinkPanels = () => Array.from(panels);

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
