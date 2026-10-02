import type {AVAttributeViewData, AVAutomationActionInput, AVAutomationRuleInput, AVAutomationValueInput} from "../../../types/api";
import {Menu} from "../../../plugin/Menu";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchSyncPost} from "../../../util/fetch";
import {transaction} from "../../wysiwyg/transaction";
import {bindInlineFilterEvents, genEmptyFilterValue, getFiltersHTML} from "./filter";
import {genFieldValue, getRelationOptions, getSelectedOptionsHTML, getValueInputHTML, openFieldRelationMenu, openFieldSelectMenu, renderRelationFieldValue} from "./fieldValueEditor";
import {openSearchAV} from "./relation";

interface AutomationValue extends Omit<AVAutomationValueInput, "value"> {
    value?: IAVCellValue;
}

interface AutomationAction extends Omit<AVAutomationActionInput, "fields" | "filters"> {
    fields: Record<string, AutomationValue>;
    filters?: IAVFilter[];
}

interface AutomationRule extends Omit<AVAutomationRuleInput, "actions" | "conditions"> {
    conditions?: IAVFilter[];
    actions: AutomationAction[];
}

const editableTypes = ["block", "text", "number", "date", "select", "mSelect", "url", "email", "phone", "checkbox", "relation", "mAsset"];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fieldsOf = (database: AVAttributeViewData): IAVColumn[] => (database?.keyValues || [])
    .filter(item => item?.key && editableTypes.includes(item.key.type))
    .map(item => ({...item.key, renderTemplate: ""}));

const compatibleFields = (database: AVAttributeViewData, field: IAVColumn): IAVColumn[] => fieldsOf(database)
    .filter(source => source.type === field?.type || source.type === "block" && field?.type === "text")
    .filter(source => field?.type !== "relation" || source.relation?.avID === field.relation?.avID);

const optionHTML = (value: string, label: string, selected: string) =>
    `<option value="${escapeAttr(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;

const iconButton = (action: string, icon: string, label: string, warning = false) =>
    `<svg class="b3-menu__action b3-menu__action--show${warning ? " b3-menu__action--warning" : ""} ariaLabel" data-action="${action}" role="button" tabindex="0" aria-label="${escapeAttr(label)}"><use xlink:href="#${icon}"></use></svg>`;

export const openAutomationMenu = async (options: {
    protyle: IProtyle,
    blockElement: HTMLElement,
    avID: string,
    menuElement: HTMLElement,
    onResize: () => void,
}) => {
    const {protyle, blockElement, avID, menuElement, onResize} = options;
    if (protyle.disabled || window.siyuan.isPublish || window.siyuan.config.readonly ||
        protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    const lang = window.siyuan.languages;
    menuElement.classList.remove("av__filter-panel");
    menuElement.classList.add("av__automation-panel");
    menuElement.innerHTML = `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon block__icon--menu-back" data-type="go-config"><svg><use xlink:href="#iconLeft"></use></svg></span>
    <span class="b3-menu__label ft__center">${lang.databaseAutomations}</span>
</button>
<button class="b3-menu__separator"></button>
<div class="av__automation">
    <div class="av__automation-body" data-body></div>
</div></div>`;
    const panel = menuElement.querySelector<HTMLElement>(".av__automation");
    const body = panel.querySelector<HTMLElement>("[data-body]");
    // 先收起已打开的选项菜单，再由本次点击打开新菜单，避免冒泡被面板拦截后菜单滞留。
    const closeMenu = () => {
        if (!panel.isConnected) {
            menuElement.removeEventListener("click", closeMenu, true);
            return;
        }
        window.siyuan.menus.menu.remove();
    };
    menuElement.addEventListener("click", closeMenu, true);
    const goBack = () => {
        if (panel.isConnected) {
            menuElement.querySelector<HTMLElement>('[data-type="go-config"]').click();
        }
    };
    panel.addEventListener("click", event => event.stopPropagation());
    panel.addEventListener("change", event => event.stopPropagation());
    onResize();
    const response = await fetchSyncPost("/api/av/getAttributeView", {id: avID});
    // 返回上级或关闭菜单后，不再填充已经移除的设置页。
    if (!panel.isConnected) {
        return;
    }
    if (response.code !== 0) {
        goBack();
        return;
    }
    const database = response.data?.av;
    if (!database) {
        goBack();
        return;
    }
    let previous: {spec: 1, rules: AutomationRule[]} = clone(database.automations || {spec: 1, rules: []});
    const createRule = (): AutomationRule => ({
        id: Lute.NewNodeID(), name: lang.databaseAutomations, enabled: false, trigger: "changed",
        actions: [{type: "edit", target: "current", fields: {}}],
    });
    const rules: AutomationRule[] = clone(previous.rules || []);
    if (!rules.length) {
        rules.push(createRule());
    }
    const databases = new Map<string, AVAttributeViewData>([[avID, database]]);
    let index = 0;
    let renderVersion = 0;
    const loadDatabase = async (id: string) => {
        if (id && !databases.has(id)) {
            const result = await fetchSyncPost("/api/av/getAttributeView", {id});
            if (result.code === 0 && result.data?.av) {
                databases.set(id, result.data.av);
            }
        }
        return databases.get(id);
    };
    const targetID = (action: AutomationAction) => action.target === "current" ? avID : action.target === "related" ?
        fieldsOf(database).find(field => field.id === action.relationKeyID)?.relation?.avID : action.avID;
    const filtersAvailable = (source: AVAttributeViewData, filters: IAVFilter[] = []): boolean => filters.every(filter =>
        filter.filters ? filtersAvailable(source, filter.filters) : fieldsOf(source).some(field => field.id === filter.column));
    const incomplete = (rule: AutomationRule): string => {
        if (rule === rules[index] && Array.from(body.querySelectorAll<HTMLInputElement>("input")).some(input => !input.checkValidity())) {
            return lang.invalid;
        }
        if (!rule.name.trim()) {
            return lang.name;
        }
        if (rule.keyID && !fieldsOf(database).some(field => field.id === rule.keyID)) {
            return lang.automationTrigger;
        }
        if (!filtersAvailable(database, rule.conditions)) {
            return lang.filter;
        }
        if (!rule.actions.length || rule.actions.length > 20) {
            return lang.automationAction;
        }
        for (const action of rule.actions) {
            const target = databases.get(targetID(action));
            if (!target) {
                return action.target === "related" ? lang.relation : lang.database;
            }
            if (!filtersAvailable(target, action.filters)) {
                return lang.filter;
            }
            if (!Object.keys(action.fields).length) {
                return lang.fields;
            }
            for (const [keyID, value] of Object.entries(action.fields)) {
                const field = fieldsOf(target).find(field => field.id === keyID);
                if (!field || value.mode === "source" && !compatibleFields(database, field).some(source => source.id === value.keyID) ||
                    value.mode === "static" && value.value?.type !== field.type ||
                    value.mode === "currentTime" && field.type !== "date" ||
                    value.mode === "triggerItem" && (field.type !== "relation" || field.relation?.avID !== avID)) {
                    return field?.name || lang.fields;
                }
            }
        }
        return "";
    };
    const updateStatus = () => {
        const rule = rules[index];
        const issue = rule && incomplete(rule);
        const status = body.querySelector<HTMLElement>("[data-status]");
        if (status) {
            status.textContent = issue ? lang.automationIncomplete.replace("${1}", issue) : "";
            status.classList.toggle("fn__none", !issue);
        }
        const enabled = body.querySelector<HTMLInputElement>("[data-enabled]");
        if (enabled && rule) {
            enabled.checked = rule.enabled;
        }
    };
    const save = (rule = rules[index]) => {
        // 不完整规则保留配置并停用，补全后由用户显式启用，避免编辑中途开始执行。
        if (rule) {
            if (incomplete(rule)) {
                rule.enabled = false;
            }
            if (!rule.name.trim()) {
                rule.name = lang.databaseAutomations;
            }
        }
        updateStatus();
        onResize();
        const next = {spec: 1 as const, rules: clone(rules)};
        if (JSON.stringify(next) === JSON.stringify(previous)) {
            return;
        }
        const operation = {action: "setAttrViewAutomations" as const, avID, blockID: blockElement.dataset.nodeId};
        transaction(protyle, [{...operation, data: next}], [{...operation, data: clone(previous)}]);
        previous = clone(next);
    };
    const chooseField = (target: HTMLElement, fields: IAVColumn[], callback: (field: IAVColumn) => void) => {
        const menu = new Menu();
        fields.forEach(field => menu.addItem({label: escapeHtml(field.name), click: () => callback(field)}));
        if (!fields.length) {
            menu.addItem({type: "readonly", label: lang.emptyContent});
        }
        const rect = target.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom, h: rect.height});
    };
    const mountFilters = (host: HTMLElement, source: AVAttributeViewData, filters: IAVFilter[], save: (filters: IAVFilter[]) => void) => {
        host.innerHTML = `<div data-conditions></div><button class="b3-button b3-button--cancel" type="button" data-add-condition>${lang.addFilterCondition}</button>`;
        const render = () => {
            const list = host.querySelector<HTMLElement>("[data-conditions]");
            list.innerHTML = filters.map((_, i) => `<div class="av__automation-row" data-condition="${i}"><div class="av__automation-filter" data-filter></div>${iconButton("remove-condition", "iconTrashcan", lang.delete, true)}</div>`).join("");
            list.querySelectorAll<HTMLElement>("[data-condition]").forEach(element => {
                const i = Number(element.dataset.condition);
                const filterRoot = element.querySelector<HTMLElement>("[data-filter]");
                const data: IAV = {id: source.id, name: source.name, viewID: source.viewID, viewType: "table", views: [],
                    view: {columns: fieldsOf(source), rows: [], rowCount: 0, filters: [filters[i]]}};
                const renderFilter = () => getFiltersHTML(data, true);
                filterRoot.innerHTML = renderFilter();
                bindInlineFilterEvents(filterRoot, data, protyle, blockElement.dataset.nodeId, source.id, {
                    root: filterRoot, render: renderFilter, save: next => {
                        filters[i] = clone(next[0]);
                        save(filters);
                        onResize();
                    },
                });
                element.querySelector('[data-action="remove-condition"]').addEventListener("click", () => {
                    filters.splice(i, 1);
                    save(filters);
                    render();
                });
            });
            if (host.isConnected) {
                onResize();
            }
        };
        host.querySelector("[data-add-condition]").addEventListener("click", event => {
            chooseField(event.currentTarget as HTMLElement, fieldsOf(source), field => {
                const initial = genEmptyFilterValue(field);
                filters.push({column: field.id, operator: initial.operator, value: initial.value});
                save(filters);
                render();
            });
        });
        render();
    };
    const mountValue = (host: HTMLElement, field: IAVColumn, value: AutomationValue) => {
        const selected = value.value?.mSelect?.map(item => item.content) || [];
        host.innerHTML = ["select", "mSelect"].includes(field.type) ?
            `<button type="button" class="b3-button b3-button--cancel" data-role="field-value" data-value-type="${field.type}" data-selected="${escapeAttr(JSON.stringify(selected))}">${getSelectedOptionsHTML(field, selected) || lang.select}</button>` :
            getValueInputHTML(field, {mode: "static", value: value.value});
        const input = host.querySelector<HTMLElement>('[data-role="field-value"]');
        const update = () => {
            if (input instanceof HTMLInputElement && !input.checkValidity()) {
                input.reportValidity();
                return;
            }
            value.value = genFieldValue(field, input, value.value);
        };
        const commit = () => {
            update();
            save();
        };
        input.addEventListener("change", commit);
        input.addEventListener("blur", commit);
        if (field.type === "checkbox") {
            input.addEventListener("click", () => {
                const checked = input.getAttribute("aria-pressed") !== "true";
                input.setAttribute("aria-pressed", String(checked));
                input.querySelector("use").setAttribute("xlink:href", checked ? "#iconCheck" : "#iconUncheck");
                update();
                save();
            });
        } else if (field.type === "relation") {
            getRelationOptions(field, choices => renderRelationFieldValue(input, choices));
            input.addEventListener("click", () => openFieldRelationMenu(input, field));
        } else if (["select", "mSelect"].includes(field.type)) {
            input.addEventListener("click", () => openFieldSelectMenu(input, field));
        }
    };
    const render = async () => {
        const version = ++renderVersion;
        const rule = rules[index];
        if (rule) {
            for (const action of rule.actions) {
                await loadDatabase(targetID(action));
            }
        }
        if (!body.isConnected || rules[index] !== rule || version !== renderVersion) {
            return;
        }
        body.innerHTML = `<div class="ft__on-surface ft__smaller">${lang.automationTip}</div>
<div class="av__automation-row">${rule ? `<select class="b3-select fn__flex-1" data-rule aria-label="${lang.databaseAutomations}">${rules.map((item, i) => optionHTML(String(i), item.name, String(index))).join("")}</select>` : ""}${iconButton("add-rule", "iconAdd", lang.new)}${rule ? iconButton("remove-rule", "iconTrashcan", lang.delete, true) : ""}</div>
${rule ? `<div class="av__automation-row"><input class="b3-text-field fn__flex-1" data-name aria-label="${lang.name}" value="${escapeAttr(rule.name)}"><label class="fn__flex fn__flex-center"><input type="checkbox" class="b3-switch" data-enabled${rule.enabled ? " checked" : ""}><span class="fn__space"></span>${lang.enable}</label></div>
<div class="ft__error ft__smaller fn__none" role="status" data-status></div>
<div class="ft__b">${lang.automationTrigger}</div><div class="av__automation-row"><select class="b3-select" data-trigger>${optionHTML("added", lang.automationAdded, rule.trigger)}${optionHTML("changed", lang.automationChanged, rule.trigger)}</select>${rule.trigger === "changed" ? `<select class="b3-select fn__flex-1" data-trigger-field aria-label="${lang.fields}">${optionHTML("", lang.all, rule.keyID || "")}${fieldsOf(database).map(field => optionHTML(field.id, field.name, rule.keyID)).join("")}</select>` : ""}</div>
<div data-source-conditions></div><div class="ft__b">${lang.automationAction}</div><div data-actions></div><button type="button" class="b3-button b3-button--cancel" data-action="add-action"><svg><use xlink:href="#iconAdd"></use></svg>${lang.automationAction}</button>` : ""}`;
        if (!rule) {
            onResize();
            return;
        }
        mountFilters(body.querySelector("[data-source-conditions]"), database, rule.conditions || [], filters => {
            rule.conditions = filters;
            save();
        });
        const actionsHost = body.querySelector<HTMLElement>("[data-actions]");
        actionsHost.innerHTML = rule.actions.map((action, i) => {
            const target = databases.get(targetID(action));
            return `<div class="av__automation-action" data-index="${i}"><div class="av__automation-row">
<select class="b3-select" data-action-type aria-label="${lang.automationAction}">${optionHTML("edit", lang.editFields, action.type)}${optionHTML("add", lang.new, action.type)}</select>
<select class="b3-select fn__flex-1" data-target aria-label="${lang.conditionalColorTarget}">${optionHTML("current", action.type === "add" ? lang.thisDatabase : lang.automationCurrentItem, action.target)}${optionHTML("related", action.type === "add" ? lang.relation : lang.relatedItems, action.target)}${optionHTML("filtered", action.type === "add" ? lang.database : lang.automationMatchingItems, action.target)}</select>
${iconButton("remove-action", "iconTrashcan", lang.delete, true)}</div>
${action.target === "related" ? `<select class="b3-select fn__block" data-relation aria-label="${lang.relation}">${optionHTML("", lang.selectRelation, action.relationKeyID || "")}${fieldsOf(database).filter(field => field.type === "relation" && field.relation?.avID).map(field => optionHTML(field.id, field.name, action.relationKeyID)).join("")}</select>` : action.target === "filtered" ? `<button type="button" class="b3-button b3-button--outline fn__block" data-action="database">${escapeHtml(target?.name || lang.select)} (${lang.database})</button>` : ""}
${target ? `<div data-target-filters></div><div data-fields></div><button type="button" class="b3-button b3-button--cancel" data-action="add-field"><svg><use xlink:href="#iconAdd"></use></svg>${lang.fields}</button>` : ""}</div>`;
        }).join("");
        actionsHost.querySelectorAll<HTMLElement>("[data-index]").forEach(element => {
            const action = rule.actions[Number(element.dataset.index)];
            const target = databases.get(targetID(action));
            if (!target) {
                return;
            }
            if (action.type === "edit" && action.target !== "current") {
                mountFilters(element.querySelector("[data-target-filters]"), target, action.filters || [], filters => {
                    action.filters = filters;
                    save();
                });
            }
            const fieldsHost = element.querySelector<HTMLElement>("[data-fields]");
            Object.entries(action.fields).forEach(([keyID, value]) => {
                const field = fieldsOf(target).find(field => field.id === keyID);
                const row = document.createElement("div");
                row.className = "av__automation-field";
                row.dataset.fieldId = keyID;
                const compatible = compatibleFields(database, field);
                row.innerHTML = `<div class="av__automation-row"><span class="fn__flex-1">${escapeHtml(field?.name || `${lang.invalid}: ${keyID}`)}</span>${iconButton("remove-field", "iconClose", lang.delete, true)}</div>
${field ? `<div class="av__automation-row"><select class="b3-select" data-mode aria-label="${lang.automationStaticValue}">${optionHTML("static", lang.automationStaticValue, value.mode)}${compatible.length ? optionHTML("source", lang.automationSourceField, value.mode) : ""}${field.type === "date" ? optionHTML("currentTime", lang.automationTriggerTime, value.mode) : ""}${field.type === "relation" && field.relation?.avID === avID ? optionHTML("triggerItem", lang.automationTriggerItem, value.mode) : ""}</select><div class="av__automation-value" data-value></div></div>` : ""}`;
                fieldsHost.append(row);
                if (!field) {
                    return;
                }
                const host = row.querySelector<HTMLElement>("[data-value]");
                if (value.mode === "static") {
                    mountValue(host, field, value);
                } else if (value.mode === "source") {
                    host.innerHTML = `<select class="b3-select fn__block" data-source-field aria-label="${lang.automationSourceField}">${compatible.map(source => optionHTML(source.id, source.name, value.keyID)).join("")}</select>`;
                }
            });
        });
        updateStatus();
        onResize();
    };
    body.addEventListener("input", event => {
        if ((event.target as HTMLElement).matches("[data-name]")) {
            rules[index].name = (event.target as HTMLInputElement).value;
            body.querySelector<HTMLSelectElement>("[data-rule]").selectedOptions[0].textContent = rules[index].name;
        }
    });
    body.addEventListener("blur", event => {
        const target = event.target as HTMLInputElement;
        if (target.matches("[data-name]")) {
            rules[index].name = target.value.trim() || lang.databaseAutomations;
            target.value = rules[index].name;
            body.querySelector<HTMLSelectElement>("[data-rule]").selectedOptions[0].textContent = target.value;
            save();
        }
    }, true);
    body.addEventListener("change", event => {
        const target = event.target as HTMLInputElement;
        const rule = rules[index];
        const action = rule?.actions[Number(target.closest<HTMLElement>("[data-index]")?.dataset.index)];
        if (target.matches("[data-rule]")) {
            index = Number(target.value);
            void render();
            return;
        } else if (target.matches("[data-name]")) {
            rule.name = target.value.trim() || lang.databaseAutomations;
            target.value = rule.name;
            body.querySelector<HTMLSelectElement>("[data-rule]").selectedOptions[0].textContent = rule.name;
            save();
            return;
        } else if (target.matches("[data-enabled]")) {
            rule.enabled = target.checked;
            save();
            return;
        } else if (target.matches("[data-trigger]")) {
            rule.trigger = target.value === "added" ? "added" : "changed";
        } else if (target.matches("[data-trigger-field]")) {
            rule.keyID = target.value;
            save();
            return;
        } else if (target.matches("[data-action-type]")) {
            action.type = target.value === "add" ? "add" : "edit";
        } else if (target.matches("[data-target]")) {
            action.target = target.value === "related" ? "related" : target.value === "filtered" ? "filtered" : "current";
            action.fields = {};
            action.filters = [];
        } else if (target.matches("[data-relation]")) {
            action.relationKeyID = target.value;
            action.fields = {};
            action.filters = [];
        } else if (target.matches("[data-mode]")) {
            const keyID = target.closest<HTMLElement>("[data-field-id]").dataset.fieldId;
            const field = fieldsOf(databases.get(targetID(action))).find(item => item.id === keyID);
            const value = action.fields[keyID];
            value.mode = target.value === "source" ? "source" : target.value === "currentTime" ? "currentTime" : target.value === "triggerItem" ? "triggerItem" : "static";
            if (value.mode === "source") {
                value.keyID = compatibleFields(database, field)[0]?.id;
            } else if (value.mode === "static" && !value.value) {
                value.value = genEmptyFilterValue(field).value;
            }
        } else if (target.matches("[data-source-field]")) {
            action.fields[target.closest<HTMLElement>("[data-field-id]").dataset.fieldId].keyID = target.value;
            save();
            return;
        } else {
            return;
        }
        save();
        void render();
    });
    body.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing && (event.target as HTMLElement).matches("input")) {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
            return;
        }
        const target = (event.target as Element).closest<SVGElement>(".b3-menu__action[data-action]");
        if (target && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
    });
    body.addEventListener("click", event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("button[data-action], .b3-menu__action[data-action]");
        if (!target) {
            return;
        }
        const rule = rules[index];
        const actionIndex = Number(target.closest<HTMLElement>("[data-index]")?.dataset.index);
        const action = rule?.actions[actionIndex];
        switch (target.dataset.action) {
            case "add-rule":
                rules.push(createRule());
                index = rules.length - 1;
                break;
            case "remove-rule":
                rules.splice(index, 1);
                index = Math.min(index, rules.length - 1);
                save(null);
                void render();
                return;
            case "add-action":
                rule.actions.push({type: "edit", target: "current", fields: {}});
                break;
            case "remove-action":
                rule.actions.splice(actionIndex, 1);
                break;
            case "remove-field":
                delete action.fields[target.closest<HTMLElement>("[data-field-id]").dataset.fieldId];
                break;
            case "add-field":
                chooseField(target, fieldsOf(databases.get(targetID(action))).filter(field => !action.fields[field.id]), field => {
                    action.fields[field.id] = {mode: "static", value: genEmptyFilterValue(field).value};
                    save();
                    void render();
                });
                return;
            case "database":
                openSearchAV({avID, blockID: blockElement.dataset.nodeId, target, purpose: "selectRelation", callback: element => {
                    action.avID = element.dataset.avId;
                    action.fields = {};
                    action.filters = [];
                    save();
                    void render();
                }});
                return;
            default:
                return;
        }
        save();
        void render();
    });
    await render();
};
