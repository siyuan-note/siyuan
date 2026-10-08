import {getAVPanelDescriptor, dispatchAVPanelAction} from "./panels/registry";
import {bindAVPanelDrag} from "./panels/drag";
import {bindAVPanelInputs} from "./panels/inputs";
import type {IAVPanelContext, IOpenAVPanelOptions} from "./panels/types";
import {isTableLikeView} from "./viewType";
import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {setPosition} from "../../../util/setPosition";
import {setColOption} from "./select";
import {prepareFilterColumns} from "./filter";
import {Constants} from "../../../constants";
import {hideElements} from "../../ui/hideElements";
import {isMobile} from "../../../util/functions";
import {bindMobileAVPanel} from "./mobilePanel";
import {bindSwitcherEvent, getFieldsByData, getSwitcherHTML} from "./view";
import {focusBlock} from "../../util/selection";
import {getFieldIdByCellElement} from "./row";
import {escapeAttr} from "../../../util/escape";
import {getPageSize} from "./groups";
import {applyAVColorPalette, getAVCustomColors} from "./color";
import {setAVCellPanelTarget} from "./panelTarget";
import {setSelectMenuPosition} from "./selectPosition";

export const openMenuPanel = (options: IOpenAVPanelOptions) => {
    let avPanelElement = document.querySelector(".av__panel");
    if (avPanelElement) {
        avPanelElement.remove();
        options.destroyCallback?.();
        return;
    }
    const avID = options.blockElement.getAttribute("data-av-id");
    const avPageSize = getPageSize(options.blockElement);
    // config/properties/sorts/filters/contextFilter/switcher 菜单只需要字段/视图元数据，不需要行数据，
    // 跳过行渲染以提升大体量视图下的响应速度。
    const ignoreRows = ["config", "properties", "sorts", "filters", "contextFilter", "switcher"].includes(options.type);
    const fetchPayload = {
        id: avID,
        query: options.blockElement.querySelector('[data-type="av-search"]')?.textContent.trim() || "",
        pageSize: avPageSize.unGroupPageSize,
        groupPaging: avPageSize.groupPageSize,
        blockID: options.blockElement.getAttribute("data-node-id"),
        ignoreRows,
    };
    let relationDataRetryCount = 0;
    // 接收视图数据并构建面板 DOM、绑定事件。fetch 回调与 options.data 复用两条路径都走这里
    const renderData = async (responseData: IAV) => {
        const response = {data: responseData} as IWebSocketData;
        avPanelElement = document.querySelector(".av__panel");
        if (avPanelElement) {
            avPanelElement.remove();
            return;
        }
        if (!options.keepMenuOpen) {
            window.siyuan.menus.menu.remove();
        }
        const blockID = options.blockElement.getAttribute("data-node-id");
        const saveFilters = (newFilters: IAVFilter[], oldFilters: IAVFilter[]) => {
            const operation = (filters: IAVFilter[]): IOperation => ({
                action: options.filterOperation?.action || "setAttrViewFilters",
                avID,
                keyID: options.filterOperation?.keyID,
                data: filters,
                blockID,
            });
            transaction(options.protyle, [operation(newFilters)], [operation(oldFilters)]);
        };

        const isCustomAttr = !options.blockElement.classList.contains("av");
        let data = response.data as IAV;
        if (options.type === "filters") {
            await prepareFilterColumns(data);
        }
        let html: string | undefined;
        let panelCellRect: DOMRect;
        let fields = getFieldsByData(data);
        if (isCustomAttr && options.colId) {
            const field = fields.find(item => item.id === options.colId);
            const row = options.blockElement.querySelector<HTMLElement>(`.av__row[data-col-id="${options.colId}"]`);
            if (field && row) {
                field.attributePanelVisibility = row.dataset.panelVisibility as IAVColumn["attributePanelVisibility"];
            }
        }
        const panelDescriptor = getAVPanelDescriptor(options.type);
        const context: IAVPanelContext = {
            options,
            avID,
            blockID,
            isCustomAttr,
            fetchPayload,
            response,
            saveFilters,
            renderData,
            openPanel: openMenuPanel,
            rerenderSwitcher: () => rerenderSwitcher(),
            get cellRect() { return panelCellRect; },
            get avPanelElement() { return avPanelElement; },
            get menuElement() { return menuElement; },
            get tabRect() { return tabRect; },
            set tabRect(value) { tabRect = value; },
            get data() { return data; },
            set data(value) { data = value; },
            get fields() { return fields; },
            set fields(value) { fields = value; },
            get html() { return html; },
            set html(value) { html = value; },
            get closeCB() { return closeCB; },
            set closeCB(value) { closeCB = value; },
            get relationDataRetryCount() { return relationDataRetryCount; },
            set relationDataRetryCount(value) { relationDataRetryCount = value; },
            get suppressSelectClick() { return suppressSelectClick; },
            set suppressSelectClick(value) { suppressSelectClick = value; },
        };

        if (!panelDescriptor.render(context)) {
            return;
        }

        document.body.insertAdjacentHTML("beforeend", `<div class="av__panel" data-av-block-id="${escapeAttr(blockID)}" style="z-index: ${++window.siyuan.zIndex};">
    <div class="b3-dialog__scrim" data-type="close"></div>
    <div class="b3-menu${options.type === "filters" ? " av__filter-panel" : ""}${options.type === "relation" ? " av__relation-panel" : ""}" ${options.keepMenuOpen ? "data-menu=\"true\"" : ""} ${["select", "date", "asset", "relation", "rollup"].includes(options.type) ? `style="${["select", "asset", "relation"].includes(options.type) ? "max-height: calc(100vh - 32px);display: flex;flex-direction: column;" : ""}min-width: 200px;${options.type === "relation" ? `width: 760px;max-width: ${isMobile() ? "90vw" : "calc(100vw - 32px)"};` : isMobile() ? "max-width: 90vw;" : "max-width: 50vw;"}"` : ""}>${html}</div>
</div>`);
        avPanelElement = document.querySelector(".av__panel");
        if (options.cellElements?.length) {
            setAVCellPanelTarget(avPanelElement, options.blockElement);
        }
        applyAVColorPalette(avPanelElement as HTMLElement, getAVCustomColors());
        let closeCB: () => void;
        const menuElement = avPanelElement.lastElementChild as HTMLElement;
        if (isMobile()) {
            bindMobileAVPanel(avPanelElement as HTMLElement, menuElement);
        }
        const rerenderSwitcher = () => {
            const keyword = (menuElement.querySelector(".b3-text-field") as HTMLInputElement)?.value || "";
            menuElement.innerHTML = getSwitcherHTML(data.views, data.viewID, options.blockElement);
            bindSwitcherEvent({
                protyle: options.protyle,
                menuElement,
                blockElement: options.blockElement
            });
            if (keyword) {
                const inputElement = menuElement.querySelector(".b3-text-field") as HTMLInputElement;
                inputElement.value = keyword;
                inputElement.dispatchEvent(new Event("input"));
            }
        };
        let tabRect = options.blockElement.querySelector(`.av__views, .av__row[data-col-id="${options.colId}"] > .block__logo`)?.getBoundingClientRect();
        const resizeMenu = ignoreRows && !isMobile() ? () => {
            if (!menuElement.isConnected) {
                return;
            }
            tabRect = options.blockElement.querySelector(".av__views")?.getBoundingClientRect();
            if (!tabRect) {
                return;
            }
            // 窗口尺寸变化后重新计算锚点，避免沿用旧的粘滞位置
            delete menuElement.dataset.positionTop;
            delete menuElement.dataset.positionBottom;
            delete menuElement.dataset.positionX;
            setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height, 0, true);
        } : undefined;
        if (resizeMenu) {
            window.addEventListener("resize", resizeMenu);
        }
        if (options.destroyCallback || resizeMenu) {
            const renderedPanelElement = avPanelElement;
            const observer = new MutationObserver(() => {
                if (!renderedPanelElement.isConnected) {
                    observer.disconnect();
                    if (resizeMenu) {
                        window.removeEventListener("resize", resizeMenu);
                    }
                    options.destroyCallback?.();
                }
            });
            observer.observe(renderedPanelElement.parentElement, {childList: true});
        }
        if (["select", "date", "asset", "relation", "rollup"].includes(options.type)) {
            let lastElement = options.cellElements[options.cellElements.length - 1];
            if (!options.blockElement.contains(lastElement)) {
                // https://github.com/siyuan-note/siyuan/issues/15839
                const rowID = getFieldIdByCellElement(lastElement, data.viewType);
                if (isTableLikeView(data.viewType)) {
                    lastElement = options.blockElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${lastElement.dataset.colId}"]`);
                } else {
                    lastElement = options.blockElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${lastElement.dataset.fieldId}"]`);
                }
            }
            const cellRect = (lastElement || options.cellElements[options.cellElements.length - 1]).getBoundingClientRect();
            panelCellRect = cellRect;

            panelDescriptor.bind?.(context);
            if (["select", "date", "relation", "rollup"].includes(options.type)) {
                const inputElement = menuElement.querySelector("input");
                if (inputElement && (options.type !== "select" || !isMobile())) {
                    inputElement.select();
                    inputElement.focus();
                }
                if (options.type === "select") {
                    setSelectMenuPosition(menuElement, lastElement || options.cellElements[options.cellElements.length - 1]);
                } else {
                    setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height, 0, true);
                }
            }
        } else {
            setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height, 0, true);
            panelDescriptor.bind?.(context);
        }
        if (options.cb) {
            options.cb(avPanelElement);
        }
        bindAVPanelDrag(context);
        bindAVPanelInputs(context);
        let suppressSelectClick = false;

        avPanelElement.addEventListener("click", async (event: MouseEvent) => {
            let type: string;
            let target = event.target as HTMLElement;
            const isProgrammaticClose = typeof event.detail === "string";
            if (typeof event.detail === "string") {
                type = event.detail;
            } else if (typeof event.detail === "object") {
                type = (event.detail as { type: string }).type;
                target = (event.detail as { target: HTMLElement }).target;
            }
            const selectedElement = target?.closest(".b3-chip--middle") as HTMLElement;
            if (options.type === "select" && selectedElement?.parentElement.classList.contains("b3-chips") &&
                !target.closest('[data-type="removeCellOption"]')) {
                if (!suppressSelectClick) {
                    setColOption(options.protyle, data, selectedElement, options.blockElement, isCustomAttr,
                        options.cellElements, options.keepMenuOpen);
                }
                suppressSelectClick = false;
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            while (target && target !== avPanelElement || type) {
                type = target?.dataset.type || type;
                // toggleCombination 由 change 事件处理，click 直接跳过避免空跑
                if (type === "toggleCombination") {
                    break;
                }
                if (type === "close") {
                    if (!options.protyle.toolbar.subElement.classList.contains("fn__none")) {
                        // 优先关闭资源文件搜索
                        hideElements(["util"], options.protyle);
                    } else if (!options.keepMenuOpen &&
                        !window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                        // 过滤面板先关闭过滤条件
                    } else {
                        closeCB?.();
                        avPanelElement.remove();
                        setTimeout(() => {
                            focusBlock(options.blockElement);
                        }, Constants.TIMEOUT_TRANSITION);  // 单选使用 enter 修改选项后会滚动
                    }
                    if (!options.keepMenuOpen || !isProgrammaticClose) {
                        window.siyuan.menus.menu.remove();
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                const actionResult = dispatchAVPanelAction(context, {type, target, event});
                const result = typeof actionResult === "string" ? actionResult : await actionResult;
                if (result === "handled") {
                    break;
                }
                // 有错误日志，没找到重现步骤，需先判断一下
                if (!target || !target.parentElement) {
                    break;
                }
                target = target.parentElement;
            }
        });
    };
    // 复用调用方传入的数据时直接渲染，跳过 fetch，避免与刚提交的事务产生读写竞争（拿到旧数据）
    if (options.data) {
        renderData(options.data);
    } else {
        fetchPost("/api/av/renderAttributeView", fetchPayload, response => renderData(response.data as IAV));
    }
};
