import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {getColIconByType} from "./col";
import {setPosition} from "../../../util/setPosition";
import {genCellValue} from "./cell";
import * as dayjs from "dayjs";
import {unicode2Emoji} from "../../../emoji";
import {fetchPost, fetchSyncPost} from "../../../util/fetch";
import {getFieldsByData} from "./view";
import {Constants} from "../../../constants";

export const getDefaultOperatorByType = (type: TAVCol) => {
    if (["select", "number", "date", "created", "updated"].includes(type)) {
        return "=";
    }
    if (["checkbox"].includes(type)) {
        return "=";
    }
    if (["rollup", "relation", "mAsset", "text", "mSelect", "url", "block", "email", "phone", "template"].includes(type)) {
        return "Contains";
    }
};

// getEditableFilters 返回可直接增删改的叶子/分组数组。
// spec 5 后顶层为单个根组，编辑对象是其 filters；兼容旧扁平数据时直接返回顶层数组。
export const getEditableFilters = (data: IAV): IAVFilter[] => {
    if (data.view.filters.length === 1 && (data.view.filters[0].filters || data.view.filters[0].combination)) {
        if (!data.view.filters[0].filters) {
            data.view.filters[0].filters = [];
        }
        return data.view.filters[0].filters;
    }
    return data.view.filters;
};

// getRootFilters 返回用于递归渲染/遍历的根节点数组（与 getEditableFilters 同源）。
const getRootFilters = (data: IAV): IAVFilter[] => getEditableFilters(data);

// getFilterByPath 按索引路径（如 "0,1,2"）在节点树中定位节点。返回 undefined 表示未找到。
export const getFilterByPath = (nodes: IAVFilter[], path: string): IAVFilter => {
    if (!path || "" === path) {
        // path 为空/缺省表示根组本身；但 nodes 是根组子节点数组，根组节点不在其中。
        // 调用方若需操作根组节点，应直接访问 data.view.filters[0]。
        return undefined;
    }
    const indices = path.split(",").map(i => parseInt(i, 10));
    let current: IAVFilter;
    let list = nodes;
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (!list || isNaN(idx) || idx < 0 || idx >= list.length) {
            return undefined;
        }
        current = list[idx];
        list = current.filters;
    }
    return current;
};

// getParentByPath 返回路径末层级的父节点数组，及最后一层级的下标。
// 用于在指定父分组内插入/删除子节点。路径 "" 视为根。
export const getParentByPath = (nodes: IAVFilter[], path: string): { parent: IAVFilter[], index: number } => {
    if (!path || "" === path) {
        return {parent: nodes, index: -1};
    }
    const indices = path.split(",").map(i => parseInt(i, 10));
    const lastIndex = indices.pop();
    if (isNaN(lastIndex) || lastIndex < 0) {
        return {parent: null, index: -1};
    }
    let list = nodes;
    for (const idx of indices) {
        if (!list || isNaN(idx) || idx < 0 || idx >= list.length) {
            return {parent: null, index: -1};
        }
        list = list[idx].filters || (list[idx].filters = []);
    }
    return {parent: list, index: lastIndex};
};

// removeFilterByPath 按路径移除节点。返回是否成功。空分组在 UI 层不自动裁剪（保留用户结构）。
export const removeFilterByPath = (nodes: IAVFilter[], path: string): boolean => {
    const {parent, index} = getParentByPath(nodes, path);
    if (!parent || index < 0 || index >= parent.length) {
        return false;
    }
    parent.splice(index, 1);
    if (parent.length === 0 && path.includes(",")) {
        const groupPath = path.substring(0, path.lastIndexOf(","));
        removeFilterByPath(nodes, groupPath);
    }
    return true;
};

// removeFiltersByColumn 递归移除引用指定列的叶子，并裁剪变空的分组。返回处理后的新数组。
export const removeFiltersByColumn = (filters: IAVFilter[], column: string): IAVFilter[] => {
    const ret: IAVFilter[] = [];
    filters.forEach(f => {
        if (f.filters) {
            const children = removeFiltersByColumn(f.filters, column);
            if (children.length > 0) {
                ret.push({...f, filters: children});
            }
        } else if (f.column !== column) {
            ret.push(f);
        }
    });
    return ret;
};

// hasFilterForColumn 递归判断过滤树中是否存在引用指定列的叶子。
export const hasFilterForColumn = (filters: IAVFilter[], column: string): boolean => {
    for (const f of filters) {
        if (f.filters) {
            if (hasFilterForColumn(f.filters, column)) {
                return true;
            }
        } else if (f.column === column) {
            return true;
        }
    }
    return false;
};

// addFilterGroup 在指定路径的分组下追加一个空 AND 分组。
export const addFilterGroup = (data: IAV, path: string) => {
    let target: IAVFilter[];
    if ("" === path) {
        target = getEditableFilters(data);
    } else {
        const node = getFilterByPath(getRootFilters(data), path);
        if (!node) {
            target = getEditableFilters(data);
        } else {
            target = node.filters || (node.filters = []);
        }
    }
    target.push({combination: "and", filters: []});
};

export const addFilter = (options: {
    data: IAV,
    rect: DOMRect,
    menuElement: HTMLElement,
    tabRect: DOMRect,
    avId: string,
    protyle: IProtyle
    blockElement: Element,
    parentPath?: string
}) => {
    const menu = new Menu(Constants.MENU_AV_ADD_FILTER);
    // 定位目标分组：支持向指定分组内追加，同分组允许同列多条件（如 状态=完成 OR 状态=进行中）
    let targetGroupFilters: IAVFilter[];
    if (options.parentPath && options.parentPath !== "") {
        const node = getFilterByPath(getRootFilters(options.data), options.parentPath);
        targetGroupFilters = node && node.filters ? node.filters : getEditableFilters(options.data);
    } else {
        targetGroupFilters = getEditableFilters(options.data);
    }
    getFieldsByData(options.data).forEach((column) => {
        // 行号类型列不可筛选
        if (column.type !== "lineNumber") {
            menu.addItem({
                label: column.name,
                iconHTML: column.icon ? unicode2Emoji(column.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`,
                click: () => {
                    const {operator, value} = genEmptyFilterValue(column);
                    const filter: IAVFilter = {
                        column: column.id,
                        operator,
                        value,
                    };
                    // 插入到目标分组（复用查重时已定位的 targetGroupFilters，它持有该分组子数组的稳定引用）
                    const oldFilters = JSON.parse(JSON.stringify(options.data.view.filters));
                    targetGroupFilters.push(filter);
                    const blockID = options.blockElement.getAttribute("data-node-id");
                    // 保存新增的占位条件，inline 控件立即可编辑（无需弹层）
                    transaction(options.protyle, [{
                        action: "setAttrViewFilters",
                        avID: options.avId,
                        data: JSON.parse(JSON.stringify(options.data.view.filters)),
                        blockID
                    }], [{
                        action: "setAttrViewFilters",
                        avID: options.avId,
                        data: oldFilters,
                        blockID
                    }]);
                    options.menuElement.innerHTML = getFiltersHTML(options.data);
                    setPosition(options.menuElement, options.tabRect.right - options.menuElement.clientWidth, options.tabRect.bottom, options.tabRect.height, 0, true);
                }
            });
        }
    });
    menu.open({
        x: options.rect.left,
        y: options.rect.bottom,
        h: options.rect.height,
    });
};

export const getFiltersHTML = (data: IAV) => {
    let html = "";
    const fields = getFieldsByData(data);
    const measureEl = document.createElement("span");
    measureEl.style.cssText = "position:absolute;visibility:hidden;font-size:14px;white-space:nowrap;";
    document.body.appendChild(measureEl);
    let andOrTextWidth = 0;
    [window.siyuan.languages.filterWhen, window.siyuan.languages.filterCombinationAnd, window.siyuan.languages.filterCombinationOr].forEach(t => {
        measureEl.textContent = t;
        andOrTextWidth = Math.max(andOrTextWidth, measureEl.offsetWidth);
    });
    document.body.removeChild(measureEl);
    // 宽度需容纳文字 + b3-select 的左右 padding（8 + 26）+ 余量
    const andOrControlWidth = andOrTextWidth + 36;
    const genAndOrSelect = (groupPath: string, combination: string) =>
        `<select class="b3-select" data-type="toggleCombination" data-path="${groupPath}" style="width:${andOrControlWidth}px;"><option value="and" ${combination === "and" ? "selected" : ""}>${window.siyuan.languages.filterCombinationAnd}</option><option value="or" ${combination === "or" ? "selected" : ""}>${window.siyuan.languages.filterCombinationOr}</option></select>`;

    const genWhenLabel = () =>
        `<span class="av__filter-label ft__on-surface" style="width:${andOrControlWidth}px;">${window.siyuan.languages.filterWhen}</span>`;

    const genAndOrLabel = (combination: string) =>
        `<span class="av__filter-label ft__on-surface" style="width:${andOrControlWidth}px;">${combination === "or" ? window.siyuan.languages.filterCombinationOr : window.siyuan.languages.filterCombinationAnd}</span>`;

    const genNodeHTML = (node: IAVFilter, path: string, depth: number, groupPath: string, groupCombination: string, index: number = 0): string => {
        if (!node) {
            return "";
        }
        if (node.filters) {
            const isRoot = 0 === depth;
            const combination = node.combination === "or" ? "or" : "and";
            let childrenHTML = "";
            node.filters.forEach((child, index) => {
                const childPath = path ? `${path},${index}` : `${index}`;
                childrenHTML += genNodeHTML(child, childPath, depth + 1, path, combination, index);
            });

            if (isRoot) {
                return childrenHTML;
            }

            const depthClass = `av__filter-group-children--depth${Math.min(depth, 3)}`;
            const addConditionBtn = depth >= 3
                ? `<span class="block__icon block__icon--text ariaLabel" data-position="4north" data-type="addFilter" data-path="${path}" aria-label="${window.siyuan.languages.addFilterCondition}"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addFilterCondition}</span>`
                : `<span class="block__icon block__icon--text ariaLabel" data-position="4north" data-type="addFilterCondition" data-path="${path}" data-depth="${depth}" aria-label="${window.siyuan.languages.addFilterCondition}"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addFilterCondition}<svg><use xlink:href="#iconDown"></use></svg></span>`;

            const andOrHTML = 0 === index ? genWhenLabel() : 1 === index ? genAndOrSelect(groupPath, groupCombination) : genAndOrLabel(groupCombination);
            return `<div class="av__filter-group-item" data-path="${path}">
    <span class="av__filter-group-left">
        ${andOrHTML}
    </span>
    <div class="av__filter-group-children ${depthClass}" data-children="${path}">
        ${childrenHTML}
        <div class="av__filter-group-actions">${addConditionBtn}</div>
    </div>
    <svg class="b3-menu__action ariaLabel" data-position="4west" data-type="moreFilter" data-path="${path}" aria-label="${window.siyuan.languages.more}"><use xlink:href="#iconMore"></use></svg>
</div>`;
        }

        let colData: IAVColumn;
        fields.find((column: IAVColumn) => {
            if (column.id === node.column) {
                colData = column;
                return true;
            }
        });
        if (!colData) {
            return "";
        }
        const iconHTML = colData.icon
            ? unicode2Emoji(colData.icon, "b3-menu__icon", true)
            : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(colData.type)}"></use></svg>`;
        const fieldOptions = fields.filter((f: IAVColumn) => f.type !== "lineNumber").map((f: IAVColumn) =>
            `<option value="${f.id}" ${f.id === node.column ? "selected" : ""}>${escapeHtml(f.name)}</option>`
        ).join("");
        const fieldSelect = `<select class="b3-select fn__flex-1 av__filter-field" data-type="fieldSelect" data-path="${path}">${fieldOptions}</select>`;
        const fieldWrapper = `<span class="av__field-wrapper ariaLabel" data-position="4west" aria-label="${escapeAttr(colData.name)}">${iconHTML}${fieldSelect}</span>`;
        const inlineHTML = genInlineFilterHTML(node, colData, path);
        const leafAndOrHTML = 0 === index ? genWhenLabel() : 1 === index ? genAndOrSelect(groupPath, groupCombination) : genAndOrLabel(groupCombination);
        return `<div class="b3-menu__item av__filter-row" data-path="${path}" data-column="${node.column}">${leafAndOrHTML}<div class="fn__flex-1 av__filter-rowinner">${fieldWrapper}${inlineHTML}</div><svg class="b3-menu__action ariaLabel" data-position="4west" data-type="moreFilter" data-path="${path}" aria-label="${window.siyuan.languages.more}"><use xlink:href="#iconMore"></use></svg></div>`;
    };

    const isRootGroup = data.view.filters.length === 1 && (data.view.filters[0].filters || data.view.filters[0].combination);
    const root = isRootGroup ? data.view.filters[0] : {filters: data.view.filters} as IAVFilter;
    const rootCombination = isRootGroup
        ? (data.view.filters[0].combination === "or" ? "or" : "and")
        : "and";
    html = genNodeHTML(root, "", 0, "", rootCombination);

    const countLeaves = (nodes: IAVFilter[]): number => nodes.reduce((sum, n) => sum + (n.filters ? countLeaves(n.filters) : 1), 0);
    const leafCount = countLeaves(root.filters || []);

    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.filter}</span>
</button>
<button class="b3-menu__separator"></button>
${html}
<button class="b3-menu__item" data-type="addFilterCondition" data-path="" data-depth="0">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label av__filter-add-label">${window.siyuan.languages.addFilterCondition}</span>
    <svg class="av__filter-arrow"><use xlink:href="#iconDown"></use></svg>
</button>
<button class="b3-menu__item b3-menu__item--warning${leafCount > 0 ? "" : " fn__none"}" data-type="removeFilters">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.removeFilters}</span>
</button>
</div>`;
};

export const duplicateFilterByPath = (nodes: IAVFilter[], path: string): boolean => {
    const {parent, index} = getParentByPath(nodes, path);
    if (!parent || index < 0 || index >= parent.length) {
        return false;
    }
    const clone = JSON.parse(JSON.stringify(parent[index]));
    parent.splice(index + 1, 0, clone);
    return true;
};

export const convertFilterToGroup = (nodes: IAVFilter[], path: string): boolean => {
    const {parent, index} = getParentByPath(nodes, path);
    if (!parent || index < 0 || index >= parent.length) {
        return false;
    }
    const node = parent[index];
    if (node.filters) {
        return false;
    }
    const group: IAVFilter = {
        combination: "and",
        filters: [node],
    };
    parent.splice(index, 1, group);
    return true;
};

export const convertGroupToFilter = (nodes: IAVFilter[], path: string): boolean => {
    const {parent, index} = getParentByPath(nodes, path);
    if (!parent || index < 0 || index >= parent.length) {
        return false;
    }
    const node = parent[index];
    if (!node.filters || 1 !== node.filters.length) {
        return false;
    }
    parent.splice(index, 1, node.filters[0]);
    return true;
};

// ============ 内联化筛选编辑（替代 setFilter 弹层） ============

// getOperatorSelectByType 按值类型生成操作符 <select> 的 option HTML，标记当前 operator 为 selected。
const getOperatorSelectByType = (type: TAVCol, currentOperator: string): string => {
    const opt = (value: string, label: string) => `<option ${value === currentOperator ? "selected" : ""} value="${value}">${label}</option>`;
    switch (type) {
        case "checkbox":
            return opt("=", window.siyuan.languages.filterOperatorIs) + opt("!=", window.siyuan.languages.filterOperatorIsNot);
        case "block":
        case "mAsset":
        case "text":
        case "url":
        case "phone":
        case "email":
            return opt("=", window.siyuan.languages.filterOperatorIs) + opt("!=", window.siyuan.languages.filterOperatorIsNot) +
                opt("Contains", window.siyuan.languages.filterOperatorContains) + opt("Does not contains", window.siyuan.languages.filterOperatorDoesNotContain) +
                opt("Starts with", window.siyuan.languages.filterOperatorStartsWith) + opt("Ends with", window.siyuan.languages.filterOperatorEndsWith) +
                opt("Is empty", window.siyuan.languages.filterOperatorIsEmpty) + opt("Is not empty", window.siyuan.languages.filterOperatorIsNotEmpty);
        case "template":
            return opt("=", window.siyuan.languages.filterOperatorIs) + opt("!=", window.siyuan.languages.filterOperatorIsNot) +
                opt("Contains", window.siyuan.languages.filterOperatorContains) + opt("Does not contains", window.siyuan.languages.filterOperatorDoesNotContain) +
                opt("Starts with", window.siyuan.languages.filterOperatorStartsWith) + opt("Ends with", window.siyuan.languages.filterOperatorEndsWith) +
                opt("Is empty", window.siyuan.languages.filterOperatorIsEmpty) + opt("Is not empty", window.siyuan.languages.filterOperatorIsNotEmpty) +
                opt(">", "&gt;") + opt("<", "&lt;") + opt(">=", "&GreaterEqual;") + opt("<=", "&le;");
        case "date":
        case "created":
        case "updated":
            return opt("=", window.siyuan.languages.filterOperatorIs) + opt(">", window.siyuan.languages.filterOperatorIsAfter) +
                opt("<", window.siyuan.languages.filterOperatorIsBefore) + opt(">=", window.siyuan.languages.filterOperatorIsOnOrAfter) +
                opt("<=", window.siyuan.languages.filterOperatorIsOnOrBefore) + opt("Is between", window.siyuan.languages.filterOperatorIsBetween) +
                opt("Is empty", window.siyuan.languages.filterOperatorIsEmpty) + opt("Is not empty", window.siyuan.languages.filterOperatorIsNotEmpty);
        case "number":
            return opt("=", "=") + opt("!=", "!=") + opt(">", "&gt;") + opt("<", "&lt;") +
                opt(">=", "&GreaterEqual;") + opt("<=", "&le;") +
                opt("Is empty", window.siyuan.languages.filterOperatorIsEmpty) + opt("Is not empty", window.siyuan.languages.filterOperatorIsNotEmpty);
        case "mSelect":
        case "relation":
            return opt("Contains", window.siyuan.languages.filterOperatorContains) + opt("Does not contains", window.siyuan.languages.filterOperatorDoesNotContain) +
                opt("Is empty", window.siyuan.languages.filterOperatorIsEmpty) + opt("Is not empty", window.siyuan.languages.filterOperatorIsNotEmpty);
        case "select":
            return opt("=", window.siyuan.languages.filterOperatorIs) + opt("!=", window.siyuan.languages.filterOperatorIsNot) +
                opt("Is empty", window.siyuan.languages.filterOperatorIsEmpty) + opt("Is not empty", window.siyuan.languages.filterOperatorIsNotEmpty);
        default:
            return "";
    }
};

const rollupTargetColumns = new WeakMap<IAVColumn, IAVColumn>();

// prepareFilterColumns 加载汇总字段指向的原始字段，使筛选控件可以按原始类型展示。
export const prepareFilterColumns = async (data: IAV) => {
    const fields = getFieldsByData(data);
    const avRequests = new Map<string, Promise<IAVColumn[]>>();
    const tasks = fields.filter((column) => column.type === "rollup" && column.rollup?.relationKeyID && column.rollup?.keyID).map(async (column) => {
        const relationColumn = fields.find((item) => item.id === column.rollup.relationKeyID);
        const targetAVID = relationColumn?.relation?.avID;
        if (!targetAVID) {
            return;
        }
        let request = avRequests.get(targetAVID);
        if (!request) {
            request = fetchSyncPost("/api/av/getAttributeView", {id: targetAVID}).then((response) => {
                return (response.data?.av?.keyValues || []).map((item: { key: IAVColumn }) => item.key);
            }).catch(() => []);
            avRequests.set(targetAVID, request);
        }
        const targetColumns = await request;
        const targetColumn = targetColumns.find((item) => item.id === column.rollup.keyID);
        if (targetColumn) {
            rollupTargetColumns.set(column, targetColumn);
        }
    });
    await Promise.all(tasks);
};

// resolveFilterValueType 解析 filter 实际的值类型。
// 汇总类型优先使用计算结果类型，否则使用汇总指向的原始字段类型。
const resolveFilterValueType = (filter: IAVFilter, colData: IAVColumn): { type: TAVCol, colData: IAVColumn, isRollup: boolean } => {
    const valueType = filter.value?.type as TAVCol;
    if (valueType !== "rollup") {
        return {type: valueType, colData, isRollup: false};
    }
    const targetColumn = rollupTargetColumns.get(colData);
    const rollup = filter.value?.rollup;
    const contentType = rollup?.contents?.[0]?.type as TAVCol;
    const calcOperator = colData.rollup?.calc?.operator;
    const numberOperators = [
        "Count all", "Count values", "Count unique values", "Count empty", "Count not empty",
        "Percent empty", "Percent not empty", "Percent unique values", "Sum", "Average", "Median", "Min", "Max",
        "Checked", "Unchecked", "Percent checked", "Percent unchecked",
    ];
    const resolvedType = numberOperators.includes(calcOperator)
        ? "number"
        : targetColumn?.type || contentType || "text";
    return {type: resolvedType, colData: targetColumn || colData, isRollup: true};
};

const getFilterCellValue = (filter: IAVFilter) => filter.value?.type === "rollup"
    ? filter.value.rollup?.contents?.[0]
    : filter.value;

const escapeFilterValue = (value: string) => escapeAttr(escapeHtml(value));

const genEmptyCellValue = (type: TAVCol): IAVCellValue => type === "checkbox"
    ? genCellValue(type, {checked: undefined})
    : {type} as IAVCellValue;

const genEmptyFilterValue = (column: IAVColumn): { operator: TAVFilterOperator, value: IAVCellValue } => {
    if (column.type !== "rollup") {
        return {
            operator: getDefaultOperatorByType(column.type),
            value: genEmptyCellValue(column.type),
        };
    }
    const emptyRollup = {type: "rollup", rollup: {contents: []}} as IAVCellValue;
    const {type} = resolveFilterValueType({value: emptyRollup} as IAVFilter, column);
    return {
        operator: getDefaultOperatorByType(type),
        value: {
            type: "rollup",
            rollup: {contents: [genEmptyCellValue(type)]},
        } as IAVCellValue,
    };
};

// genInlineFilterHTML 生成单个叶子过滤条件的内联可编辑 HTML（operator select + 值控件）。
// 替代原 genFilterItem 的只读 chip。colData 为该列配置（含 options/relation/rollup 等）。
const genInlineFilterHTML = (filter: IAVFilter, colData: IAVColumn, path: string): string => {
    const {type: valueType, colData: valueColumn, isRollup} = resolveFilterValueType(filter, colData);
    const operator = filter.operator;
    const isEmptyOp = operator === "Is empty" || operator === "Is not empty";
    const valueHidden = isEmptyOp ? " fn__none" : "";

    // 操作符 select
    const operatorSelect = `<select class="b3-select" data-type="operation" data-path="${path}">${getOperatorSelectByType(valueType, operator)}</select>`;

    // 量化器 select（rollup/mAsset 才有）
    const quantifierSelect = (isRollup || valueType === "mAsset")
        ? `<select class="b3-select" data-type="quantifier" data-path="${path}">
<option ${(!filter.quantifier || filter.quantifier === "Any") ? "selected" : ""} value="Any">${window.siyuan.languages.filterQuantifierAny}</option>
<option ${filter.quantifier === "All" ? "selected" : ""} value="All">${window.siyuan.languages.filterQuantifierAll}</option>
<option ${filter.quantifier === "None" ? "selected" : ""} value="None">${window.siyuan.languages.filterQuantifierNone}</option>
</select>`
        : "";

    // 值控件（按类型）
    let valueHTML = "";
    let extraHTML = ""; // 放在 valueContainer 外的附加 HTML（如 select 下拉面板，避免影响行宽）
    const filterValue = getFilterCellValue(filter);
    if (["text", "url", "block", "email", "phone", "template"].includes(valueType)) {
        const content = filterValue?.[valueType as "text"]?.content || "";
        valueHTML = `<input class="b3-text-field b3-text-field--text fn__flex-1" value="${escapeFilterValue(content)}" data-type="filterValue" data-path="${path}">`;
    } else if (valueType === "mAsset") {
        const content = filterValue?.mAsset?.[0]?.content || "";
        valueHTML = `<input class="b3-text-field b3-text-field--text fn__flex-1" value="${escapeFilterValue(content)}" data-type="filterValue" data-path="${path}">`;
    } else if (valueType === "number") {
        const content = filterValue?.number?.isNotEmpty ? filterValue.number.content : "";
        valueHTML = `<input class="b3-text-field b3-text-field--text av__filter-num" value="${content}" data-type="filterValue" data-path="${path}">`;
    } else if (valueType === "checkbox") {
        const isChecked = filterValue?.checkbox?.checked;
        valueHTML = `<select class="b3-select" data-type="filterValue" data-path="${path}"><option value="true" ${isChecked ? "selected" : ""}>${window.siyuan.languages.checked}</option><option value="false" ${!isChecked ? "selected" : ""}>${window.siyuan.languages.unchecked}</option></select>`;
    } else if (["date", "created", "updated"].includes(valueType)) {
        valueHTML = genInlineDateHTML(filter, valueType, path);
    } else if (valueType === "select" || valueType === "mSelect") {
        const {trigger, dropdown} = genInlineSelectHTML(filter, valueColumn, path, valueType);
        valueHTML = trigger;
        extraHTML = dropdown; // 下拉面板放 valueContainer 外，fixed 定位不影响行宽
    } else if (valueType === "relation") {
        const content = filterValue?.relation?.blockIDs?.[0] || "";
        valueHTML = `<input class="b3-text-field b3-text-field--text fn__flex-1" value="${escapeFilterValue(content)}" data-type="filterValue" data-type-rel="relation" data-path="${path}">`;
    }

    return `${quantifierSelect}${operatorSelect}<span class="av__filter-value${valueHidden}" data-type="valueContainer" data-path="${path}">${valueHTML}</span>${extraHTML}`;
};

// genInlineDateHTML 生成日期类型的内联控件（绝对/相对切换 + Is between 结束日期）。
const genInlineDateHTML = (filter: IAVFilter, valueType: TAVCol, path: string): string => {
    const dateValue = getFilterCellValue(filter)?.[valueType as "date"];
    const showToday1 = !filter.relativeDate?.direction;
    const showToday2 = !filter.relativeDate2?.direction;
    const isBetween = filter.operator === "Is between";

    // formatAbsDate 把时间戳格式化为 yyyy-MM-dd；空值/非法值返回 ""，避免 <input type="date"> 报 "Invalid Date"。
    // 0 也视作空值：created/updated 类型的 content 经后端 int64 往返后 null 会变成 0，
    // 否则 dayjs(0) 会渲染成 1970-01-01（与 date 类型 isNotEmpty:false 时的空白表现对齐）。
    const formatAbsDate = (timestamp: any): string => {
        if (!timestamp) {
            return "";
        }
        const dayObj = dayjs(timestamp);
        return dayObj.isValid() ? dayObj.format("YYYY-MM-DD") : "";
    };

    const dateBlock = (suffix: "" | "2", relativeDate: IAVRelativeDate, dateVal: any, showToday: boolean): string => {
        const dateTypeSel = `<select class="b3-select" data-type="dateType${suffix}" data-path="${path}">
<option value="time"${!relativeDate ? " selected" : ""}>${window.siyuan.languages.includeTime}</option>
<option value="custom"${relativeDate ? " selected" : ""}>${window.siyuan.languages.relativeToToday}</option>
</select>`;
        const absDate = `<input value="${(dateVal && (dateVal.isNotEmpty || (suffix === "2" ? dateVal.isNotEmpty2 : valueType !== "date"))) ? formatAbsDate(suffix === "2" ? dateVal.content2 : dateVal.content) : ""}" type="date" max="9999-12-31" class="b3-text-field b3-text-field--text" data-type="absDate${suffix}" data-path="${path}" style="${relativeDate ? "display:none;" : ""}">`;
        const relDir = `<select class="b3-select" data-type="dataDirection${suffix}" data-path="${path}" style="${!relativeDate ? "display:none;" : ""}">
<option value="-1"${relativeDate?.direction === -1 ? " selected" : ""}>${window.siyuan.languages.pastDate}</option>
<option value="1"${relativeDate?.direction === 1 ? " selected" : ""}>${window.siyuan.languages.nextDate}</option>
<option value="0"${showToday ? " selected" : ""}>${window.siyuan.languages.current}</option>
</select>`;
        // “当前”方向下数量 count 无意义（后端按单位取今天/本周/本月/今年），故仅隐藏 relCount；
        // 但单位 relUnit 必须保留，以便用户选择天/周/月/年
        const relCount = `<input type="number" min="1" step="1" value="${relativeDate?.count || 1}" class="b3-text-field b3-text-field--text av__filter-num" data-type="relCount${suffix}" data-path="${path}" style="${(!relativeDate || showToday) ? "display:none;" : ""}">`;
        const relUnit = `<select class="b3-select" data-type="relUnit${suffix}" data-path="${path}" style="${!relativeDate ? "display:none;" : ""}">
<option value="0"${relativeDate?.unit === 0 ? " selected" : ""}>${window.siyuan.languages.day}</option>
<option value="1"${(!relativeDate || relativeDate?.unit === 1) ? " selected" : ""}>${window.siyuan.languages.week}</option>
<option value="2"${relativeDate?.unit === 2 ? " selected" : ""}>${window.siyuan.languages.month}</option>
<option value="3"${relativeDate?.unit === 3 ? " selected" : ""}>${window.siyuan.languages.year}</option>
</select>`;
        return `<span class="av__filter-date-row">${dateTypeSel}${absDate}${relDir}${relCount}${relUnit}</span>`;
    };

    const filter1 = dateBlock("", filter.relativeDate, dateValue, showToday1);
    const filter2 = dateBlock("2", filter.relativeDate2, dateValue, showToday2);
    return `<span class="av__filter-date-col">${filter1}<span data-type="filter2Wrap" data-path="${path}" style="${isBetween ? "" : "display:none;"}">${filter2}</span></span>`;
};

// genInlineSelectHTML 生成 select/mSelect 的内联多选 chip 列表 + 搜索。
const genInlineSelectHTML = (filter: IAVFilter, colData: IAVColumn, path: string, valueType: TAVCol): { trigger: string, dropdown: string } => {
    const isSingle = valueType === "select";
    const options = colData.options || [];
    const selectedValues = (getFilterCellValue(filter)?.mSelect || []).filter((s: IAVCellSelectValue) => s.content);
    const placeholder = isSingle ? window.siyuan.languages.select : window.siyuan.languages.multiSelect;

    // 触发器：显示已选值的 chip（与表格单元格样式一致），无选中时显示 placeholder + 下拉箭头
    const selectedChips = selectedValues.map((item: IAVCellSelectValue) => {
        return `<span class="b3-chip b3-chip--middle av__select-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${escapeHtml(item.content)}</span>`;
    }).join("");
    const triggerContent = selectedChips || `<span class="ft__on-surface fn__ellipsis">${placeholder}</span>`;
    const trigger = `<span class="av__select-trigger" data-type="selectTrigger" data-path="${path}">${triggerContent}<svg class="av__select-trigger-arrow"><use xlink:href="#iconDown"></use></svg></span>`;

    // 下拉面板
    const searchInput = options.length > 5
        ? `<input class="b3-text-field" placeholder="${window.siyuan.languages.search}" data-type="filterSearch" data-path="${path}">`
        : "";
    const chips = options.map((option: { name: string; color: string; desc?: string }) => {
        const selected = selectedValues.some((s: IAVCellSelectValue) => s.content === option.name);
        return `<span class="b3-chip b3-chip--middle${selected ? " b3-chip--primary" : ""} av__select-option" data-name="${escapeAttr(option.name)}" data-color="${option.color}" data-type="selectOption" data-path="${path}" style="background-color:var(--b3-font-background${option.color});color:var(--b3-font-color${option.color})">
<svg class="icon"><use xlink:href="#${selected ? "iconCheck" : "iconUncheck"}"></use></svg>
<span class="fn__ellipsis">${escapeHtml(option.name)}</span>
</span>`;
    }).join("");
    const dropdown = `<div class="av__select-dropdown" data-type="selectDropdown" data-path="${path}" data-single="${isSingle ? "true" : "false"}" style="display:none;">
${searchInput}<div class="av__select-options" data-type="selectOptions" data-path="${path}">${chips}</div>
</div>`;
    return {trigger, dropdown};
};

// readInlineValue 从叶子行内 DOM 读取值，按类型返回 { value, relativeDate, relativeDate2 }。
// 修正点①：date 用 data-type 精确定位，废弃全局 textElements 索引。
const readInlineValue = (rowElement: HTMLElement, valueType: TAVCol, operator: string, filter: IAVFilter): { newValue: IAVCellValue, relativeDate: IAVRelativeDate, relativeDate2: IAVRelativeDate } => {
    let newValue: IAVCellValue = filter.value;
    let relativeDate: IAVRelativeDate = filter.relativeDate;
    let relativeDate2: IAVRelativeDate = filter.relativeDate2;

    if (operator === "Is empty" || operator === "Is not empty") {
        // 空操作符：值保留类型壳，无实际内容
        newValue = genEmptyCellValue(valueType);
        relativeDate = undefined;
        relativeDate2 = undefined;
    } else if (valueType === "checkbox") {
        const select = rowElement.querySelector('[data-type="filterValue"]') as HTMLSelectElement;
        const isChecked = select?.value !== "false";
        newValue = genCellValue("checkbox", {checked: isChecked});
    } else if (valueType === "relation") {
        const input = rowElement.querySelector('[data-type="filterValue"]') as HTMLInputElement;
        newValue = input?.value ? genCellValue("relation", input.value) : genEmptyCellValue("relation");
    } else if (["text", "url", "block", "email", "phone", "template", "mAsset", "number"].includes(valueType)) {
        const input = rowElement.querySelector('[data-type="filterValue"]') as HTMLInputElement;
        const val = input?.value || "";
        newValue = val ? genCellValue(valueType, val) : genEmptyCellValue(valueType);
    } else if (["date", "created", "updated"].includes(valueType)) {
        // 修正点①：用 data-type 精确定位绝对日期 input
        const dateTypeSel = rowElement.querySelector('[data-type="dateType"]') as HTMLSelectElement;
        const isRelative = dateTypeSel?.value === "custom";
        if (isRelative) {
            relativeDate = readRelativeDate(rowElement, "");
            if (operator === "Is between") {
                relativeDate2 = readRelativeDate(rowElement, "2");
            } else {
                relativeDate2 = undefined;
            }
            newValue = {type: valueType} as IAVCellValue;
        } else {
            const absDate1 = rowElement.querySelector('[data-type="absDate"]') as HTMLInputElement;
            const dateStr1 = absDate1?.value || "";
            const content1 = dateStr1 ? new Date(dateStr1 + " 00:00").getTime() : 0;
            const isNotEmpty = !!dateStr1;
            let content2 = 0;
            let isNotEmpty2 = false;
            let dateStr2 = "";
            if (operator === "Is between") {
                const absDate2 = rowElement.querySelector('[data-type="absDate2"]') as HTMLInputElement;
                dateStr2 = absDate2?.value || "";
                content2 = dateStr2 ? new Date(dateStr2 + " 00:00").getTime() : 0;
                isNotEmpty2 = !!dateStr2;
            }
            newValue = {
                type: valueType,
                [valueType]: {
                    content: content1,
                    isNotEmpty,
                    content2,
                    isNotEmpty2,
                    hasEndDate: operator === "Is between" && isNotEmpty2,
                    isNotTime: true,
                },
            } as IAVCellValue;
            relativeDate = undefined;
            relativeDate2 = undefined;
        }
    } else if (valueType === "select" || valueType === "mSelect") {
        // 扫描下拉面板内选中的 chip（#iconCheck）。下拉在行外（fixed 定位），用 path 全局查找
        const path = rowElement.dataset.path;
        const mSelect: IAVCellSelectValue[] = [];
        const dropdown = document.querySelector(`[data-type="selectDropdown"][data-path="${path}"]`);
        const searchRoot = dropdown || rowElement; // 兜底：兼容旧结构
        searchRoot.querySelectorAll('[data-type="selectOption"]').forEach((chip: HTMLElement) => {
            const useEl = chip.querySelector("use");
            if (useEl && useEl.getAttribute("xlink:href") === "#iconCheck") {
                mSelect.push({content: chip.dataset.name, color: chip.dataset.color});
            }
        });
        newValue = mSelect.length > 0 ? genCellValue(valueType, mSelect) : genEmptyCellValue(valueType);
    }

    // rollup 包装
    if (filter.value?.type === "rollup") {
        newValue = {type: "rollup", rollup: {contents: [newValue]}} as IAVCellValue;
    }

    return {newValue, relativeDate, relativeDate2};
};

// readRelativeDate 从行内读取相对日期配置（suffix 为 "" 或 "2"）。
const readRelativeDate = (rowElement: HTMLElement, suffix: string): IAVRelativeDate => {
    const dirSel = rowElement.querySelector(`[data-type="dataDirection${suffix}"]`) as HTMLSelectElement;
    const countInput = rowElement.querySelector(`[data-type="relCount${suffix}"]`) as HTMLInputElement;
    const unitSel = rowElement.querySelector(`[data-type="relUnit${suffix}"]`) as HTMLSelectElement;
    const direction = parseInt(dirSel?.value || "0", 10);
    return {
        count: parseInt(countInput?.value || "1", 10),
        unit: parseInt(unitSel?.value || "0", 10) as 0 | 1 | 2 | 3,
        direction: direction as -1 | 0 | 1,
    };
};

// commitFilter 即时保存单个条件的修改。reRender=true 时重渲染整个面板（结构变化场景）。
export const commitFilter = (data: IAV, path: string, newFilter: IAVFilter, protyle: IProtyle, blockID: string, avID: string, menuElement: HTMLElement, reRender: boolean) => {
    const editable = getEditableFilters(data);
    const {parent, index} = getParentByPath(editable, path);
    if (!parent || index < 0 || index >= parent.length) {
        return;
    }
    const oldFilters = JSON.parse(JSON.stringify(data.view.filters));
    parent[index] = newFilter;

    transaction(protyle, [{
        action: "setAttrViewFilters",
        avID,
        data: JSON.parse(JSON.stringify(data.view.filters)),
        blockID
    }], [{
        action: "setAttrViewFilters",
        avID,
        data: oldFilters,
        blockID
    }]);

    if (reRender && menuElement) {
        menuElement.innerHTML = getFiltersHTML(data);
    }
};

// bindInlineFilterEvents 绑定内联筛选编辑的事件（事件委托到面板）。即时保存。
export const bindInlineFilterEvents = (panelElement: HTMLElement, data: IAV, protyle: IProtyle, blockID: string, avID: string) => {
    // 防重复绑定：事件委托绑在 panelElement 上，同一面板实例只需绑一次
    if (panelElement.dataset.filterEventsBound === "true") {
        return;
    }
    panelElement.dataset.filterEventsBound = "true";
    const menuElement = panelElement.querySelector(".b3-menu") as HTMLElement;
    const fields = getFieldsByData(data);

    // 通过 data-path 定位叶子行
    const getRow = (target: HTMLElement): HTMLElement => {
        const path = target.dataset.path;
        if (!path) return null;
        return menuElement.querySelector(`[data-path="${path}"]`) as HTMLElement;
    };

    // 查找列配置
    const findColData = (path: string): IAVColumn => {
        const filter = getFilterByPath(getEditableFilters(data), path);
        if (!filter) return null;
        let colData: IAVColumn;
        fields.find((column: IAVColumn) => {
            if (column.id === filter.column) {
                colData = column;
                return true;
            }
        });
        return colData;
    };

    // 保存当前行的值（从 DOM 读取后提交）
    const saveRow = (rowElement: HTMLElement, path: string, reRender: boolean) => {
        const filter = getFilterByPath(getEditableFilters(data), path);
        const colData = findColData(path);
        if (!filter || !colData) return;
        const {type: valueType} = resolveFilterValueType(filter, colData);
        const operatorSel = rowElement.querySelector('[data-type="operation"]') as HTMLSelectElement;
        const operator = (operatorSel?.value || filter.operator) as TAVFilterOperator;
        const {newValue, relativeDate, relativeDate2} = readInlineValue(rowElement, valueType, operator, filter);
        const quantifierSel = rowElement.querySelector('[data-type="quantifier"]') as HTMLSelectElement;
        const newFilter: IAVFilter = {
            column: filter.column,
            operator,
            value: newValue,
            relativeDate,
            relativeDate2,
        };
        if (quantifierSel) {
            newFilter.quantifier = quantifierSel.value;
        }
        commitFilter(data, path, newFilter, protyle, blockID, avID, menuElement, reRender);
    };

    // operator change：切换操作符，可能需要重渲染（结构变化如 Is between/Is empty）
    panelElement.addEventListener("change", (event: Event) => {
        const target = event.target as HTMLElement;
        const type = target.dataset.type;
        if (!type) return;
        const path = target.dataset.path;
        if (!path) return;
        const row = getRow(target);
        if (!row) return;

        if (type === "fieldSelect") {
            // 切换字段：用新字段的默认 operator + 空 value 替换，整体重渲染
            const newColId = (target as HTMLSelectElement).value;
            const newColData = fields.find((f: IAVColumn) => f.id === newColId);
            if (newColData) {
                const {operator, value} = genEmptyFilterValue(newColData);
                const newFilter: IAVFilter = {
                    column: newColId,
                    operator,
                    value,
                };
                commitFilter(data, path, newFilter, protyle, blockID, avID, menuElement, true);
            }
        } else if (type === "operation") {
            // 判断是否结构变化（需重渲染）：date 的 Is between 切换、空操作符切换
            const filter = getFilterByPath(getEditableFilters(data), path);
            const colData = findColData(path);
            const {type: valueType} = resolveFilterValueType(filter, colData);
            const newOp = (target as HTMLSelectElement).value;
            const oldOp = filter.operator;
            const structureChange = (["date", "created", "updated"].includes(valueType) &&
                ((newOp === "Is between") !== (oldOp === "Is between"))) ||
                ((newOp === "Is empty" || newOp === "Is not empty") !== (oldOp === "Is empty" || oldOp === "Is not empty"));
            saveRow(row, path, structureChange);
        } else if (type === "quantifier" || type?.startsWith("dataDirection") || type?.startsWith("dateType")) {
            // 量化器、日期方向、日期类型变化：保存。dateType 切换绝对/相对、dataDirection 切换“当前/前/后”
            // 都会改变 relCount/relUnit 的显示状态，需重渲染
            if (type === "dateType" || type === "dateType2" || type?.startsWith("dataDirection")) {
                saveRow(row, path, true);
            } else {
                saveRow(row, path, false);
            }
        } else if (type === "relUnit" || type === "relUnit2") {
            saveRow(row, path, false);
        } else if (type === "filterValue") {
            // select/change 触发（非键盘输入的 change，如浏览器自动填充）
            saveRow(row, path, false);
        }
    });

    // 值输入 blur / Enter 保存
    panelElement.addEventListener("blur", (event: Event) => {
        const target = event.target as HTMLElement;
        if (target.dataset.type === "filterValue" || target.dataset.type?.startsWith("absDate") || target.dataset.type?.startsWith("relCount")) {
            const path = target.dataset.path;
            const row = getRow(target);
            if (path && row) saveRow(row, path, false);
        }
    }, true); // capture 捕获 blur（blur 不冒泡）

    panelElement.addEventListener("keydown", (event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (event.key !== "Enter" || event.isComposing) return;
        if (target.dataset.type === "filterValue") {
            const path = target.dataset.path;
            const row = getRow(target);
            if (path && row) {
                saveRow(row, path, false);
                event.preventDefault();
            }
        }
    });

    // select 下拉触发：点击展开/收起选项面板
    panelElement.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        // 先处理 selectTrigger（展开/收起下拉）
        const trigger = target.closest('[data-type="selectTrigger"]') as HTMLElement;
        if (trigger) {
            const path = trigger.dataset.path;
            // 下拉面板已移到行外（fixed 定位），用 path 全局查找
            const dropdown = menuElement.querySelector(`[data-type="selectDropdown"][data-path="${path}"]`) as HTMLElement;
            if (dropdown) {
                // 收起其它已展开的下拉
                menuElement.querySelectorAll('[data-type="selectDropdown"]').forEach((el: HTMLElement) => {
                    if (el !== dropdown) el.style.display = "none";
                });
                if (dropdown.style.display === "none") {
                    // 展开时用 fixed 定位到 trigger 下方（避免被 overflow:auto 裁剪）
                    const rect = trigger.getBoundingClientRect();
                    dropdown.style.zIndex = (++window.siyuan.zIndex).toString();
                    dropdown.style.left = rect.left + "px";
                    dropdown.style.width = Math.max(rect.width, 120) + "px";
                    // 先临时显示以测量真实高度，再决定向上还是向下展开
                    dropdown.style.visibility = "hidden";
                    dropdown.style.display = "block";
                    const dropdownHeight = dropdown.offsetHeight;
                    dropdown.style.visibility = "";
                    const spaceBelow = window.innerHeight - rect.bottom;
                    if (spaceBelow < dropdownHeight + 8 && rect.top > dropdownHeight + 8) {
                        // 下方不够且上方够：向上展开，紧贴 trigger 上方
                        dropdown.style.top = (rect.top - dropdownHeight - 4) + "px";
                    } else {
                        // 向下展开
                        dropdown.style.top = (rect.bottom + 4) + "px";
                    }
                } else {
                    dropdown.style.display = "none";
                }
            }
            event.stopImmediatePropagation();
            return;
        }
        // 再处理 selectOption chip 点击（切换选中态）
        const chip = target.closest('[data-type="selectOption"]') as HTMLElement;
        if (!chip) return;
        const path = chip.dataset.path;
        const row = getRow(chip);
        if (!path || !row) return;
        const dropdown = menuElement.querySelector(`[data-type="selectDropdown"][data-path="${path}"]`) as HTMLElement;
        const isSingle = dropdown?.dataset.single === "true";
        const useEl = chip.querySelector("use");
        const isCheck = useEl.getAttribute("xlink:href") === "#iconCheck";
        if (isSingle && !isCheck) {
            // 单选：点击新选项时，先取消该下拉内所有其它已选项
            dropdown.querySelectorAll('[data-type="selectOption"]').forEach((c: HTMLElement) => {
                if (c !== chip) {
                    const u = c.querySelector("use");
                    if (u && u.getAttribute("xlink:href") === "#iconCheck") {
                        u.setAttribute("xlink:href", "#iconUncheck");
                        c.classList.remove("b3-chip--primary");
                    }
                }
            });
        }
        // toggle 当前项 iconCheck/iconUncheck + primary 类
        useEl.setAttribute("xlink:href", isCheck ? "#iconUncheck" : "#iconCheck");
        chip.classList.toggle("b3-chip--primary", !isCheck);
        // 更新触发器显示（重建 chip 列表，与表格单元格样式一致）
        const triggerEl = menuElement.querySelector(`[data-type="selectTrigger"][data-path="${path}"]`) as HTMLElement;
        if (triggerEl && dropdown) {
            const isSingleSel = dropdown.dataset.single === "true";
            const placeholderStr = isSingleSel ? window.siyuan.languages.select : window.siyuan.languages.multiSelect;
            const selectedChips: string[] = [];
            dropdown.querySelectorAll('[data-type="selectOption"]').forEach((c: HTMLElement) => {
                const u = c.querySelector("use");
                if (u && u.getAttribute("xlink:href") === "#iconCheck") {
                    const name = c.dataset.name;
                    const color = c.dataset.color;
                    selectedChips.push(`<span class="b3-chip b3-chip--middle av__select-chip" style="background-color:var(--b3-font-background${color});color:var(--b3-font-color${color})">${escapeHtml(name)}</span>`);
                }
            });
            const contentHTML = selectedChips.join("") || `<span class="ft__on-surface fn__ellipsis">${placeholderStr}</span>`;
            triggerEl.innerHTML = contentHTML;
        }
        saveRow(row, path, false);
        event.stopImmediatePropagation();
    });

    // 点击面板空白处收起所有 select 下拉
    panelElement.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest('[data-type="selectTrigger"]') && !target.closest('[data-type="selectDropdown"]')) {
            menuElement.querySelectorAll('[data-type="selectDropdown"]').forEach((el: HTMLElement) => {
                el.style.display = "none";
            });
        }
        if (!target.closest('[data-type-rel="relation"]') && !target.closest('[data-type="relList"]')) {
            menuElement.querySelectorAll('[data-type="relList"]').forEach((el: HTMLElement) => {
                el.style.display = "none";
            });
        }
    }, true);

    // select 搜索过滤
    panelElement.addEventListener("input", (event: InputEvent) => {
        const target = event.target as HTMLElement;
        if (target.dataset.type === "filterSearch") {
            const path = target.dataset.path;
            // 下拉面板在行外，用 path 查找 dropdown 内的选项
            const dropdown = menuElement.querySelector(`[data-type="selectDropdown"][data-path="${path}"]`);
            if (!dropdown) return;
            const key = (target as HTMLInputElement).value.toLowerCase();
            dropdown.querySelectorAll('[data-type="selectOption"]').forEach((chip: HTMLElement) => {
                const name = (chip.dataset.name || "").toLowerCase();
                chip.style.display = (!key || name.indexOf(key) > -1 || key.indexOf(name) > -1) ? "" : "none";
            });
        } else if (target.dataset.type === "filterValue" && target.dataset.typeRel === "relation") {
            // 关联筛选按主键显示文本匹配，输入内容同时作为候选搜索关键字和筛选值。
            const path = target.dataset.path;
            const filter = getFilterByPath(getEditableFilters(data), path);
            const sourceColumn = findColData(path);
            const colData = filter && sourceColumn ? resolveFilterValueType(filter, sourceColumn).colData : sourceColumn;
            if (!colData?.relation?.avID) return;
            const keyword = (target as HTMLInputElement).value;
            fetchPost("/api/av/getAttributeViewPrimaryKeyValues", {
                id: colData.relation.avID,
                keyword,
            }, response => {
                if ((target as HTMLInputElement).value !== keyword) {
                    return;
                }
                const row = getRow(target);
                if (!row) return;
                let listEl = menuElement.querySelector(`[data-type="relList"][data-path="${path}"]`) as HTMLElement;
                if (!listEl) {
                    listEl = document.createElement("div");
                    listEl.setAttribute("data-type", "relList");
                    listEl.setAttribute("data-path", path);
                    listEl.className = "av__select-dropdown b3-list b3-list--background";
                    menuElement.appendChild(listEl);
                }
                let html = "";
                (response.data.rows.values as IAVCellValue[] || []).forEach((item, index) => {
                    const content = item.block?.content || window.siyuan.languages.untitled;
                    html += `<div class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-path="${path}" data-name="${escapeAttr(content)}">${escapeHtml(content)}</div>`;
                });
                listEl.innerHTML = html;
                if (!html) {
                    listEl.style.display = "none";
                    return;
                }
                const rect = target.getBoundingClientRect();
                listEl.style.zIndex = (++window.siyuan.zIndex).toString();
                listEl.style.left = rect.left + "px";
                listEl.style.width = rect.width + "px";
                listEl.style.visibility = "hidden";
                listEl.style.display = "block";
                const listHeight = listEl.offsetHeight;
                listEl.style.visibility = "";
                listEl.style.top = window.innerHeight - rect.bottom < listHeight + 8 && rect.top > listHeight + 8
                    ? rect.top - listHeight - 4 + "px"
                    : rect.bottom + 4 + "px";
            });
        }
    });

    // relation 候选点击填值
    panelElement.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const item = target.closest('[data-type="relList"] .b3-list-item') as HTMLElement;
        if (!item) return;
        const listEl = item.closest('[data-type="relList"]') as HTMLElement;
        const path = listEl.dataset.path;
        const row = menuElement.querySelector(`.av__filter-row[data-path="${path}"]`) as HTMLElement;
        if (!path || !row) return;
        const input = row.querySelector('[data-type="filterValue"]') as HTMLInputElement;
        if (input) {
            input.value = item.dataset.name || "";
        }
        listEl.style.display = "none";
        saveRow(row, path, false);
    }, true); // capture，避免与 selectOption click 冲突
};
