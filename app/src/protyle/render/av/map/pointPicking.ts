import * as dayjs from "dayjs";
import {Menu} from "../../../../plugin/Menu";
import {toggleMenu} from "../../../../menus/menuToggle";
import {escapeHtml} from "../../../../util/escape";
import {writeText} from "../../../util/compatibility";
import {waitForPendingTransactions} from "../../../util/transactionQueue";
import {transaction} from "../../../wysiwyg/transaction";
import {getAVFilteredTipContext, getAVViewID} from "../filteredTip";
import {createAVLocationReplacement, getAVLocationText, validateAVLocation} from "../locationValue";
import {openDatabaseRowByData} from "../openDatabaseRow";
import {avRender} from "../render";
import {AVMapCoordinate, parseAVMapCoordinate} from "./protocol";
import {canEditMapSettings} from "./settings";
import {getMapSettings} from "./state";

const isNotebookLocked = (protyle: IProtyle) => window.siyuan.notebooks?.some(notebook =>
    notebook.id === protyle.notebookId && notebook.encrypted && notebook.closed);
const editable = (protyle: IProtyle) => canEditMapSettings(protyle) && !window.siyuan.config?.readonly;

// 使用既有插入与单元格事务一次写入坐标，撤销时完整移除新建游离条目。
export const createMapRecordAtPoint = async (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    avID: string;
    viewID: string;
    locationKeyID: string;
    location: IAVCellLocationValue;
    current: () => boolean;
}) => {
    const {protyle, blockElement, avID, viewID, locationKeyID, current} = options;
    if (!current() || !blockElement.isConnected || blockElement.dataset.avId !== avID ||
        getAVViewID(blockElement) !== viewID || !editable(protyle) || isNotebookLocked(protyle) ||
        !parseAVMapCoordinate(options.location) ||
        !validateAVLocation(options.location)) return false;
    const location = createAVLocationReplacement(options.location);
    const itemID = Lute.NewNodeID();
    const valueID = Lute.NewNodeID();
    const blockID = blockElement.dataset.nodeId;
    const editorElement = blockElement.closest(".protyle-wysiwyg");
    const notebookID = protyle.notebookId;
    const updated = dayjs().format("YYYYMMDDHHmmss");
    let committed = false;
    transaction(protyle, [{
        action: "insertAttrViewBlock", avID, blockID, viewID, previousID: "",
        srcs: [{itemID, id: Lute.NewNodeID(), isDetached: true, content: ""}],
        context: getAVFilteredTipContext("target", protyle),
    }, {
        action: "updateAttrViewCell", avID, blockID, rowID: itemID, keyID: locationKeyID, id: valueID,
        data: {id: valueID, keyID: locationKeyID, blockID: itemID, type: "location", location},
    }, {action: "doUpdateUpdated", id: blockID, data: updated}], [
        {action: "removeAttrViewBlock", avID, blockID, srcIDs: [itemID]},
        {action: "doUpdateUpdated", id: blockID, data: blockElement.getAttribute("updated")},
    ], {callback: () => {
        committed = true;
        // 写入已成功时不依赖旧地图实例仍存在；导航到其他数据库或历史后不再打开条目。
        if (!blockElement.isConnected || blockElement.dataset.avId !== avID || blockElement.dataset.nodeId !== blockID ||
            blockElement.closest(".protyle-wysiwyg") !== editorElement || protyle.notebookId !== notebookID ||
            getAVViewID(blockElement) !== viewID || !editable(protyle) || isNotebookLocked(protyle)) return;
        blockElement.setAttribute("updated", updated);
        blockElement.removeAttribute("data-render");
        avRender(blockElement, protyle);
        void openDatabaseRowByData(protyle, {avID, databaseBlockID: blockID, notebookID,
            itemID, valueID: "", title: window.siyuan.languages.untitled, isDetached: true, focusPrimary: true});
    }});
    await waitForPendingTransactions(protyle);
    return committed;
};

export const bindMapPointPicking = (options: {
    canvas: HTMLElement;
    blockElement: HTMLElement;
    protyle: IProtyle;
    data: IAV;
    current: () => boolean;
}) => {
    const {canvas, blockElement, protyle, data, current} = options;
    const view = data.view as IAVTable;
    const locationKeyID = getMapSettings(view).locationKeyID;
    const avID = data.id, viewID = data.viewID, blockID = blockElement.dataset.nodeId;
    const editorElement = blockElement.closest(".protyle-wysiwyg");
    const notebookID = protyle.notebookId;
    let destroyed = false, pending = false;
    let menu: Menu;
    const available = () => !destroyed && current() && blockElement.isConnected &&
        blockElement.dataset.avId === avID && blockElement.dataset.nodeId === blockID &&
        blockElement.closest(".protyle-wysiwyg") === editorElement && protyle.notebookId === notebookID &&
        getAVViewID(blockElement) === viewID &&
        data.view === view && data.viewID === viewID && getMapSettings(view).locationKeyID === locationKeyID &&
        view.columns.some(column => column.id === locationKeyID && column.type === "location") &&
        !isNotebookLocked(protyle);
    return {
        show: (input: AVMapCoordinate) => {
            const point = parseAVMapCoordinate(input);
            if (!point || !available()) return;
            menu?.close();
            // 既有地点名称只在父页面查找，不读取或转发供应商返回的要素属性。
            const location = view.rows.map(row => row.cells.find(cell => cell.value?.keyID === locationKeyID)?.value?.location)
                .find(value => validateAVLocation(value) && value?.longitude === point.longitude &&
                    value.latitude === point.latitude && value.name?.trim());
            const selected = {...point, name: location?.name || ""};
            const text = getAVLocationText(selected);
            // 地图的每次选点替换坐标菜单，不将整个画布当作重复点击关闭按钮。
            toggleMenu({target: canvas, toggle: false, build: (_shared, session) => {
                menu = new Menu(undefined, () => { menu = undefined; });
                menu.addItem({type: "readonly", iconHTML: "", label: escapeHtml(window.siyuan.languages.mapPickedPoint)});
                menu.addItem({type: "readonly", iconHTML: "", label: escapeHtml(text)});
                menu.addItem({icon: "iconCopy", label: window.siyuan.languages.copy, click: () => {
                    if (session.isCurrent() && available()) writeText(text);
                }});
                if (editable(protyle) && !pending) {
                    menu.addItem({icon: "iconAdd", label: window.siyuan.languages.mapCreateAtPoint, click: () => {
                        if (!session.isCurrent() || !available() || !editable(protyle) || pending) return;
                        pending = true;
                        void createMapRecordAtPoint({protyle, blockElement, avID, viewID, locationKeyID,
                            location: selected, current: available}).catch(() => {
                            // 事务层负责失败提示，保留地图供用户重新选择或重试。
                        }).finally(() => { pending = false; });
                    }});
                }
            }, show: () => {
                const rect = canvas.getBoundingClientRect();
                menu.open({x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, target: canvas});
            }});
        },
        destroy: () => {
            destroyed = true;
            menu?.close();
        },
    };
};
