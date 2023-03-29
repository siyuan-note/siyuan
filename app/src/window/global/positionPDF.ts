import {getAllTabs} from "../../layout/getAll";
import {Asset} from "../../asset";

export const positionPDF = (pathStr: string, page: string | number) => {
    getAllTabs().forEach((tab) => {
        if (tab.model instanceof Asset && tab.model.pdfObject && tab.model.path === pathStr) {
            tab.parent.switchTab(tab.headElement);
            tab.model.goToPage(page);
        }
    })
}
