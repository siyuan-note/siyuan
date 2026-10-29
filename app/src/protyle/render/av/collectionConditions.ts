import type {AVAutomationBlockAttributeInput, AVAutomationBlockSourceInput} from "../../../types/api";
import {Menu} from "../../../plugin/Menu";
import {toggleMenu} from "../../../menus/menuToggle";
import {bindAliasInput} from "../../../menus/aliasInput";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {openInputDialog} from "../../../dialog/inputDialog";
import {upDownHint} from "../../../util/upDownHint";

export const toggleCollectionType = (types: string[], type: string) => {
    if (types.includes(type)) { return types.filter(item => item !== type); }
    const main = type.split(":")[0];
    return [...types.filter(item => type.includes(":") ? item !== main : !item.startsWith(main + ":")), type];
};

export const mountCollectionConditions = (host: HTMLElement, source: AVAutomationBlockSourceInput,
                                          save: () => void, onResize: () => void) => {
    const lang = window.siyuan.languages;
    const types: Record<string, string> = {
        d: lang.documentBlock, p: lang.paragraph, h: lang.headings, l: lang.list1, i: lang.listItem,
        c: lang.code, m: lang.math, t: lang.tableBlock, b: lang.quote, s: lang.superBlock,
        html: lang.htmlBlock, query_embed: lang.blockEmbed, av: lang.databaseBlock, iframe: lang.iframeBlock,
        widget: lang.widgetBlock, tb: lang.line, video: lang.videoBlock, audio: lang.audioBlock, custom: lang.customBlock,
        callout: lang.callout, tabs: lang.tabs, tab: lang.tabItem, mindmap: lang.mindmap, mindmap_item: lang.mindmapItem,
    };
    for (let level = 1; level <= 6; level++) { types[`h:h${level}`] = lang[`heading${level}`]; }
    Object.assign(types, {"l:u": lang.list, "l:o": lang["ordered-list"], "l:t": lang.check,
        "i:u": lang.unorderedListItemBlock, "i:o": lang.orderedListItemBlock, "i:t": lang.taskListItemBlock});
    ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"].forEach(type => types[`callout:${type}`] = `${lang.callout} - ${type}`);
    (source.types || []).filter(type => type.startsWith("callout:")).forEach(type => types[type] = `${lang.callout} - ${type.slice(8)}`);
    const operators = {equals: lang.filterOperatorIs, contains: lang.filterOperatorContains,
        exists: lang.automationAttrExists, notExists: lang.automationAttrNotExists};
    const nameOperators = {equals: lang.filterOperatorIs, contains: lang.filterOperatorContains, regex: lang.regex};
    const modeLabel = (mode: string) => mode === "or" ? lang.filterMatchAny : lang.filterMatchAll;
    const tagTargets = {"": lang.default, block: lang.automationCollectionTargetBlock, container: lang.automationCollectionTargetContainer};
    const tagTargetTips = {"": lang.automationCollectionTargetDefaultTip, block: lang.automationCollectionTargetBlockTip, container: lang.automationCollectionTargetContainerTip};
    const modeButton = (field: "tagMatch" | "attributeMatch", label: string) => `<button type="button" class="b3-button b3-button--cancel" data-match="${field}" aria-label="${escapeAttr(label)}">${modeLabel(source[field])}<svg><use xlink:href="#iconDown"></use></svg></button>`;
    const addButton = (action: string, label: string) => `<button type="button" class="b3-button b3-button--cancel b3-button--wrap av__automation-source-action" ${action}><svg><use xlink:href="#iconAdd"></use></svg><span>${escapeHtml(label)}</span></button>`;
    const chip = (kind: string, index: number, label: string, editable = false) => `<div class="b3-chip b3-chip--middle"><span class="fn__ellipsis${editable ? " b3-chip--pointer" : ""} ariaLabel" ${editable ? `data-edit-attribute="${index}" role="button" tabindex="0"` : ""} aria-label="${escapeAttr(label)}">${escapeHtml(label)}</span><svg class="b3-chip__close" data-remove-filter="${kind}" data-index="${index}" role="button" tabindex="0" aria-label="${escapeAttr(lang.delete)}"><use xlink:href="#iconClose"></use></svg></div>`;
    host.className = "av__automation-control";
    host.innerHTML = `<div class="av__automation-control" data-tag-target-control><div class="av__automation-row"><span class="av__automation-control-label fn__flex-1">${lang.automationCollectionTarget}</span><button type="button" class="b3-button b3-button--cancel b3-button--wrap av__automation-source-action" data-tag-target aria-label="${escapeAttr(lang.automationCollectionTarget)}"><span>${tagTargets[source.tagTarget || ""]}</span><svg><use xlink:href="#iconDown"></use></svg></button></div><div class="ft__on-surface ft__smaller av__automation-tip" data-tag-target-tip>${tagTargetTips[source.tagTarget || ""]}</div><div class="ft__on-surface ft__smaller av__automation-tip fn__none" data-tag-target-change-tip>${lang.automationCollectionTargetChangeTip}</div></div>
<div class="av__automation-control"><span class="av__automation-control-label">${lang.automationCollectionTypes}</span><div class="fn__flex-column"><div class="b3-chips b3-chips__doctag av__automation-chips" data-type-chips></div>${addButton("data-types", `${lang.addAttr} - ${lang.automationCollectionTypes}`)}</div></div>
<div class="av__automation-control"><div class="av__automation-row"><span class="av__automation-control-label fn__flex-1">${lang.tag}</span>${modeButton("tagMatch", lang.tag)}</div><div class="fn__flex-column" data-tags></div></div>
<div class="av__automation-control"><div class="av__automation-row"><span class="av__automation-control-label fn__flex-1">${lang.attr}</span>${modeButton("attributeMatch", lang.attr)}</div><div class="fn__flex-column"><div class="b3-chips b3-chips__doctag av__automation-chips" data-attribute-chips></div>${addButton("data-add-attribute", `${lang.addAttr} - ${lang.attr}`)}</div><div data-attribute-editor></div></div>`;
    const typeChips = host.querySelector<HTMLElement>("[data-type-chips]");
    const attributes = host.querySelector<HTMLElement>("[data-attribute-chips]");
    const editor = host.querySelector<HTMLElement>("[data-attribute-editor]");
    let draft: AVAutomationBlockAttributeInput;
    let editing = -1;
    const resize = () => { if (host.isConnected) { onResize(); } };
    const renderChips = () => {
        typeChips.innerHTML = (source.types || []).map((type, i) => chip("type", i, types[type] || type)).join("");
        attributes.innerHTML = (source.attributes || []).map((attr, i) => chip("attribute", i,
            `${attr.nameOperator && attr.nameOperator !== "equals" ? nameOperators[attr.nameOperator] + " " : ""}${attr.name} ${operators[attr.operator]}${["equals", "contains"].includes(attr.operator) ? " " + (attr.value || "") : ""}`, true)).join("");
        typeChips.classList.toggle("fn__none", !source.types?.length);
        attributes.classList.toggle("fn__none", !source.attributes?.length);
        resize();
    };
    const renderEditor = () => {
        editor.innerHTML = draft ? `<div class="av__automation-control"><div class="av__automation-row"><span class="fn__flex-1">${lang.attrName}</span><button type="button" class="b3-button b3-button--cancel" data-attr-name-operator>${nameOperators[draft.nameOperator || "equals"]}<svg><use xlink:href="#iconDown"></use></svg></button></div><input class="b3-text-field" data-attr-name aria-label="${escapeAttr(lang.attrName)}" placeholder="${draft.nameOperator === "regex" ? "^custom-dailynote-[0-9]{8}$" : draft.nameOperator === "contains" ? "dailynote" : "custom-name"}" maxlength="256" value="${escapeAttr(draft.name)}"><div class="av__automation-row"><button type="button" class="b3-button b3-button--cancel" data-attr-operator>${operators[draft.operator]}<svg><use xlink:href="#iconDown"></use></svg></button>${["equals", "contains"].includes(draft.operator) ? `<input class="b3-text-field fn__flex-1" data-attr-value aria-label="${escapeAttr(lang.text)}" value="${escapeAttr(draft.value || "")}">` : ""}</div><div class="av__automation-row"><button type="button" class="b3-button b3-button--text" data-confirm-attribute>${lang.confirm}</button><button type="button" class="b3-button b3-button--cancel" data-cancel-attribute>${lang.cancel}</button></div></div>` : "";
        host.querySelector<HTMLElement>("[data-add-attribute]").classList.toggle("fn__none", !!draft);
        resize();
    };
    const finishAttribute = (cancel = false) => {
        if (!draft) { return; }
        if (!cancel) {
            const input = editor.querySelector<HTMLInputElement>("[data-attr-name]");
            draft.name = draft.nameOperator === "regex" ? input.value.trim() : input.value.trim().toLowerCase();
            const valid = draft.nameOperator === "regex" ? !!draft.name :
                (draft.nameOperator === "contains" ? /^[a-z0-9-]+$/ : /^custom-[\w-]+$/).test(draft.name);
            input.setCustomValidity(valid ? "" : lang.invalid);
            if (!input.reportValidity()) { return; }
            const next = [...(source.attributes || [])];
            if (editing >= 0) { next[editing] = {...draft}; } else { next.push({...draft}); }
            source.attributes = next;
            save();
        }
        draft = undefined;
        editing = -1;
        renderChips();
        renderEditor();
    };
    bindAliasInput(host.querySelector("[data-tags]"), (source.tags || []).join(","), {
        addLabel: lang.addTag, removeLabel: lang.delete, placeholder: lang.tag, spellcheck: false,
        normalize: value => value.trim().replace(/^#+|#+$/g, ""),
        save: async value => {
            const tags = Array.from(new Set(value.split(",").map(tag => tag.trim().replace(/^#+|#+$/g, "")).filter(Boolean)));
            if (tags.length > 20) { return false; }
            source.tags = tags;
            save();
            window.setTimeout(resize, 0);
            return true;
        },
    });
    host.querySelector("[data-tags] button").classList.add("b3-button--wrap", "av__automation-source-action");
    const openTypes = (target: HTMLElement) => {
        let menu: Menu;
        toggleMenu({target, build: () => {
            menu = new Menu();
            menu.addItem({type: "empty", label: `<div class="b3-menu__filter av__automation-menu av__automation-menu--types fn__flex-column"><input class="b3-text-field" data-type-search placeholder="${escapeAttr(lang.searchPlaceholder)}" aria-label="${escapeAttr(lang.search)}"><div class="b3-list b3-list--background av__automation-menu-list fn__flex-1" data-type-list>${Object.entries(types).map(([type, label]) => `<button type="button" class="b3-list-item" data-collection-type="${escapeAttr(type)}"><span class="b3-list-item__text ariaLabel" aria-label="${escapeAttr(label)}">${escapeHtml(label)}</span><svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg></button>`).join("")}<button type="button" class="b3-list-item" data-custom-callout><svg class="b3-list-item__graphic"><use xlink:href="#iconAdd"></use></svg><span class="b3-list-item__text">${escapeHtml(`${lang.callout} - ${lang.custom}`)}</span></button></div></div>`, bind: element => {
                const search = element.querySelector<HTMLInputElement>("[data-type-search]");
                const list = element.querySelector<HTMLElement>("[data-type-list]");
                const refresh = () => {
                    const keyword = search.value.trim().toLowerCase();
                    list.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                    list.querySelectorAll<HTMLElement>("[data-collection-type]").forEach(item => {
                        item.classList.toggle("fn__none", !item.textContent.toLowerCase().includes(keyword));
                        const selected = source.types?.includes(item.dataset.collectionType) || false;
                        item.setAttribute("aria-pressed", String(selected));
                        item.querySelector("svg").classList.toggle("fn__none", !selected);
                    });
                    list.querySelector(".b3-list-item:not(.fn__none)")?.classList.add("b3-list-item--focus");
                };
                element.addEventListener("click", event => {
                    event.stopPropagation();
                    const item = (event.target as Element).closest<HTMLElement>("[data-collection-type]");
                    if (item) {
                        source.types = toggleCollectionType(source.types || [], item.dataset.collectionType);
                        save();
                        refresh();
                        renderChips();
                    } else if ((event.target as Element).closest("[data-custom-callout]")) {
                        menu.close();
                        openInputDialog({title: lang.callout, label: lang.type, value: "", maxLength: 256,
                            onConfirm: (value, dialog) => {
                                const type = value.trim();
                                if (!type || /[\r\n\t]/.test(type)) { return; }
                                types[`callout:${type}`] = `${lang.callout} - ${type}`;
                                source.types = toggleCollectionType(source.types || [], `callout:${type}`);
                                save();
                                renderChips();
                                dialog.destroy();
                            }});
                    }
                });
                search.addEventListener("input", refresh);
                search.addEventListener("keydown", event => {
                    event.stopPropagation();
                    if (event.isComposing) { return; }
                    upDownHint(list, event);
                    if (event.key === "Enter") {
                        event.preventDefault();
                        list.querySelector<HTMLElement>(".b3-list-item--focus, .b3-list-item:not(.fn__none)")?.click();
                    }
                });
                refresh();
            }});
        }, show: () => {
            const rect = target.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height, target});
            if (!isMobile()) { menu.element.querySelector<HTMLInputElement>("[data-type-search]").focus(); }
        }});
    };
    const choose = (target: HTMLElement, items: Array<{value: string, label: string}>, current: string,
                    select: (value: string) => void) => {
        let menu: Menu;
        toggleMenu({target, build: () => {
            menu = new Menu();
            items.forEach(item => menu.addItem({iconHTML: "", label: item.label, checked: item.value === current, click: () => select(item.value)}));
        }, show: () => {
            const rect = target.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height, target});
        }});
    };
    host.addEventListener("click", event => {
        const target = (event.target as Element).closest<HTMLElement>("button, [data-remove-filter], [data-edit-attribute]");
        if (!target) { return; }
        if (target.hasAttribute("data-types")) { openTypes(target); }
        else if (target.hasAttribute("data-tag-target")) {
            choose(target, Object.entries(tagTargets).map(([value, label]) => ({value, label})), source.tagTarget || "", value => {
                const next = value === "block" ? "block" : value === "container" ? "container" : "";
                if (next === (source.tagTarget || "")) { return; }
                if (next) { source.tagTarget = next; } else { delete source.tagTarget; }
                target.querySelector("span").textContent = tagTargets[next];
                host.querySelector("[data-tag-target-tip]").textContent = tagTargetTips[next];
                host.querySelector("[data-tag-target-change-tip]").classList.remove("fn__none");
                save();
                resize();
            });
        } else if (target.dataset.match) {
            const field = target.dataset.match === "tagMatch" ? "tagMatch" : "attributeMatch";
            choose(target, [{value: "and", label: lang.filterMatchAll}, {value: "or", label: lang.filterMatchAny}], source[field] || "and", mode => {
                source[field] = mode === "or" ? "or" : "and";
                save();
                target.firstChild.textContent = modeLabel(mode);
            });
        } else if (target.hasAttribute("data-attr-name-operator") && draft) {
            choose(target, Object.entries(nameOperators).map(([value, label]) => ({value, label})), draft.nameOperator || "equals", value => {
                if (value === "contains" || value === "regex") { draft.nameOperator = value; }
                else { delete draft.nameOperator; }
                renderEditor();
            });
        } else if (target.hasAttribute("data-attr-operator") && draft) {
            choose(target, Object.entries(operators).map(([value, label]) => ({value, label})), draft.operator, value => {
                draft.operator = value === "contains" ? "contains" : value === "exists" ? "exists" : value === "notExists" ? "notExists" : "equals";
                renderEditor();
            });
        } else if (target.hasAttribute("data-confirm-attribute")) { finishAttribute(); }
        else if (target.hasAttribute("data-cancel-attribute")) { finishAttribute(true); }
        else if (target.hasAttribute("data-add-attribute") || target.hasAttribute("data-edit-attribute")) {
            if (draft) { editor.querySelector<HTMLInputElement>("input").focus(); return; }
            editing = target.hasAttribute("data-edit-attribute") ? Number(target.dataset.editAttribute) : -1;
            if (editing < 0 && source.attributes?.length >= 20) { return; }
            draft = editing >= 0 ? {...source.attributes[editing]} : {name: "custom-", operator: "exists"};
            renderEditor();
            const input = editor.querySelector<HTMLInputElement>("[data-attr-name]");
            input.focus();
            if (editing < 0) { input.setSelectionRange(input.value.length, input.value.length); }
        } else if (target.dataset.removeFilter) {
            const index = Number(target.dataset.index);
            if (target.dataset.removeFilter === "type") { source.types.splice(index, 1); }
            else {
                source.attributes.splice(index, 1);
                if (editing === index) { draft = undefined; editing = -1; renderEditor(); }
                else if (editing > index) { editing--; }
            }
            save();
            renderChips();
        }
        resize();
    });
    const updateDraft = (event: Event) => {
        const input = event.target as HTMLInputElement;
        if (!draft) { return; }
        if (input.hasAttribute("data-attr-name")) { draft.name = input.value; input.setCustomValidity(""); }
        if (input.hasAttribute("data-attr-value")) { draft.value = input.value; }
    };
    host.addEventListener("input", updateDraft);
    host.addEventListener("change", updateDraft);
    host.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.isComposing) { return; }
        const target = event.target as HTMLElement;
        if (editor.contains(target) && target.matches("input")) {
            if (event.key === "Enter") { event.preventDefault(); finishAttribute(); }
            if (event.key === "Escape") { event.preventDefault(); finishAttribute(true); }
        } else if (target.matches("[data-remove-filter], [data-edit-attribute]") && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
    });
    renderChips();
};
