import {getAllTabs} from "../../layout/getAll";
import {Asset} from "../../asset";
import {Editor} from "../../editor";

export const positionPDF = (pathStr: string, page: string | number) => {
    getAllTabs().forEach((tab) => {
        if (tab.model instanceof Asset && tab.model.pdfObject && tab.model.path === pathStr) {
            tab.parent.switchTab(tab.headElement);
            tab.model.goToPage(page);
        }
    });
};

export const switchTabById = (id: string) => {
    getAllTabs().find((tab) => {
        if (!tab.model) {
            const initTab = tab.headElement.getAttribute("data-initdata");
            if (initTab) {
                const initTabData = JSON.parse(initTab);
                if (initTabData.instance === "Editor" && initTabData.rootId === id) {
                    tab.parent.switchTab(tab.headElement);
                    return true;
                }
            }
        } else if (tab.model instanceof Editor) {
            if (tab.model.editor.protyle.block.rootID === id) {
                tab.parent.switchTab(tab.headElement);
                return true;
            }
        } else if (tab.model instanceof Asset) {
            if (tab.model.path === id) {
                tab.parent.switchTab(tab.headElement);
                return true;
            }
        }
    });
};
