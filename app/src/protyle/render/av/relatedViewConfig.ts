import {MenuItem} from "../../../menus/Menu";
import {toggleMenu} from "../../../menus/menuToggle";
import {fetchSyncPost} from "../../../util/fetch";
import {isMobile} from "../../../util/functions";
import {escapeHtml} from "../../../util/escape";
import {showMessage} from "../../../dialog/message";
import {transaction} from "../../wysiwyg/transaction";

const isReadonly = (protyle: IProtyle) => protyle?.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
    protyle?.options?.history?.created || protyle?.options?.history?.snapshot;

export const getRelatedViewConfigHTML = (field: IAVColumn, protyle: IProtyle) => {
    const lang = window.siyuan.languages._attrView;
    const enabled = field.relation?.detailView?.spec === 1 && field.relation.detailView.enabled;
    return `<label class="b3-menu__item b3-menu__item--wrap">
    <span class="b3-menu__label">${lang.showRelatedDatabaseView}</span>
    <input data-type="relatedViewEnabled" type="checkbox" class="b3-switch b3-switch--menu" ${enabled ? "checked" : ""} ${isReadonly(protyle) || !field.relation?.avID ? "disabled" : ""}>
</label>
<button class="b3-menu__item${enabled ? "" : " fn__none"}" data-type="relatedViewTarget" disabled>
    <svg class="b3-menu__icon"><use xlink:href="#iconTable"></use></svg>
    <span class="b3-menu__label">${lang.relatedDatabaseView}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<div class="b3-menu__item b3-menu__item--readonly${enabled ? "" : " fn__none"}" data-related-view-tip="true">
    <span class="b3-menu__label ft__on-surface ft__smaller fn__flex"><span class="fn__flex-center ft__breakword">${lang.relatedDatabaseViewShared}</span></span>
</div>`;
};

export const getRelatedTableViews = (views: IAVView[] | undefined) => {
    return (views || []).filter(view => view.type === "table" && !!view.id);
};

export const getRelatedTableView = (field: IAVColumn, views: IAVView[]) => {
    return views.find(view => view.id === field.relation?.detailView?.viewID) || views[0];
};

export const bindRelatedViewConfig = async (protyle: IProtyle, avID: string, field: IAVColumn,
                                          menuElement: HTMLElement, blockID: string) => {
    const switchElement = menuElement.querySelector<HTMLInputElement>('[data-type="relatedViewEnabled"]');
    let targetElement = menuElement.querySelector<HTMLButtonElement>('[data-type="relatedViewTarget"]');
    if (!switchElement || !targetElement || !field.relation) {
        return;
    }
    const lang = window.siyuan.languages._attrView;
    const targetAVID = field.relation.avID || "";
    const tipElement = menuElement.querySelector<HTMLElement>("[data-related-view-tip]");
    const sourceElement = menuElement.querySelector<HTMLElement>('[data-type="goSearchAV"]');
    const isCurrent = () => switchElement.isConnected && (field.relation.avID || "") === targetAVID &&
        (!sourceElement || sourceElement.dataset.avId === targetAVID);
    const canEdit = () => isCurrent() && !isReadonly(protyle) &&
        (!field.relation.detailView || field.relation.detailView.spec === 1);
    let views: IAVView[] = [];
    let pending = false;
    let unavailable = !targetAVID;
    const save = (value: IAVColumnRelation["detailView"]) => {
        if (!canEdit()) {
            return;
        }
        const previous = field.relation.detailView ? {...field.relation.detailView} : null;
        if (previous?.enabled === value.enabled && previous?.viewID === value.viewID) {
            return;
        }
        transaction(protyle, [{
            action: "setAttrViewRelationDetail", avID, keyID: field.id, blockID, data: value,
        }], [{
            action: "setAttrViewRelationDetail", avID, keyID: field.id, blockID, data: previous,
        }]);
        field.relation.detailView = value;
    };
    const render = () => {
        const enabled = field.relation.detailView?.spec === 1 && field.relation.detailView.enabled;
        switchElement.checked = !!enabled;
        switchElement.disabled = !canEdit() || pending || (!targetAVID && !enabled);
        const current = getRelatedTableView(field, views);
        const choices: IMenu[] = views.map(view => ({
            icon: "iconTable",
            label: escapeHtml(view.name || window.siyuan.languages._kernel[267]),
            checked: current?.id === view.id,
            disabled: !canEdit(),
            click: () => {
                if (!canEdit()) {
                    return;
                }
                save({spec: 1, enabled: true, viewID: view.id});
                render();
                if (!isMobile()) {
                    targetElement.focus();
                }
            },
        }));
        const message = pending ? window.siyuan.languages.loading : unavailable
            ? lang.relatedDatabaseViewUnavailable : lang.relatedDatabaseViewNoTable;
        const item = new MenuItem({
            icon: "iconTable",
            label: current ? escapeHtml(current.name || window.siyuan.languages._kernel[267]) : lang.relatedDatabaseView,
            disabled: !canEdit() || pending,
            submenu: choices.length ? choices : [{type: "readonly", iconHTML: "", label: message}],
        });
        targetElement.replaceWith(item.element);
        targetElement = item.element as HTMLButtonElement;
        targetElement.dataset.type = "relatedViewTarget";
        targetElement.classList.add("b3-menu__item--wrap");
        targetElement.setAttribute("aria-label", current
            ? `${lang.relatedDatabaseView} ${current.name || window.siyuan.languages._kernel[267]}` : lang.relatedDatabaseView);
        targetElement.classList.toggle("fn__none", !enabled);
        tipElement.classList.toggle("fn__none", !enabled);
        tipElement.querySelector(".fn__flex-center").textContent = current || pending
            ? lang.relatedDatabaseViewShared : message;
        const submenu = targetElement.querySelector<HTMLElement>(".b3-menu__submenu");
        const show = () => {
            if (!canEdit() || pending) {
                return;
            }
            targetElement.classList.add("b3-menu__item--show");
            window.siyuan.menus.menu.showSubMenu(submenu);
        };
        if (!isMobile()) {
            targetElement.addEventListener("mouseenter", show);
            targetElement.addEventListener("keydown", event => {
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    event.stopPropagation();
                    show();
                    submenu.querySelector<HTMLButtonElement>(".b3-menu__item:not([disabled])")?.focus();
                } else if (event.key === "ArrowLeft" || event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    targetElement.classList.remove("b3-menu__item--show");
                    targetElement.focus();
                }
            });
        }
        targetElement.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            if (!canEdit() || pending) {
                return;
            }
            if (isMobile()) {
                toggleMenu({target: targetElement, build: menu => {
                    (choices.length ? choices : [{type: "readonly", label: message} as IMenu]).forEach(choice => {
                        menu.append(new MenuItem(choice, menu).element);
                    });
                }, show: menu => menu.fullscreen("bottom")});
            } else {
                show();
            }
        });
    };
    menuElement.addEventListener("mouseover", event => {
        const hovered = (event.target as Element).closest(".b3-menu__item");
        if (hovered && !targetElement.contains(hovered)) {
            targetElement.classList.remove("b3-menu__item--show");
        }
    });
    if (sourceElement) {
        const observer = new MutationObserver(() => {
            if (!switchElement.isConnected) {
                observer.disconnect();
                return;
            }
            render();
        });
        observer.observe(sourceElement, {attributes: true, attributeFilter: ["data-av-id"]});
    }
    switchElement.addEventListener("change", () => {
        if (!canEdit() || pending) {
            render();
            return;
        }
        const enabled = switchElement.checked;
        const current = getRelatedTableView(field, views);
        if (enabled && !current) {
            showMessage(unavailable ? lang.relatedDatabaseViewUnavailable : lang.relatedDatabaseViewNoTable);
            render();
            return;
        }
        save({spec: 1, enabled, viewID: enabled ? current.id : field.relation.detailView?.viewID || ""});
        render();
    });
    if (!targetAVID) {
        render();
        return;
    }
    pending = true;
    render();
    try {
        const response = await fetchSyncPost("/api/av/getAttributeView", {id: targetAVID, blockID,
            relationFieldContext: {sourceAvID: avID, relationKeyID: field.id}});
        if (!switchElement.isConnected || field.relation.avID !== targetAVID) {
            return;
        }
        if (response.code !== 0) {
            unavailable = true;
        } else {
            unavailable = !response.data?.av;
            views = getRelatedTableViews(response.data?.av?.views);
        }
    } catch {
        unavailable = true;
    } finally {
        pending = false;
        if (switchElement.isConnected) {
            render();
        }
    }
};
