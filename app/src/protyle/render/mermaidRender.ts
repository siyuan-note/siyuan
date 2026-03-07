import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {genIconHTML} from "./util";

// 同一 target 共用一个监听器，重复调用时合并 items 而非替换，避免前次 hideElements 更多时被后次覆盖
const mermaidObserverMap = new Map<Element, { observer: MutationObserver; group: { items: Element[]; attributeFilter: string[] } }>();

export const disconnectMermaidObservers = (rootElement: Element) => {
    mermaidObserverMap.forEach(({observer}, target) => {
        if (rootElement.contains(target)) {
            observer.disconnect();
            mermaidObserverMap.delete(target);
        }
    });
};

export const mermaidRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let mermaidElements: Element[] | NodeListOf<Element> = [];
    if (element.getAttribute("data-subtype") === "mermaid" && element.getAttribute("data-render") !== "true") {
        mermaidElements = [element];
    } else {
        mermaidElements = element.querySelectorAll('[data-subtype="mermaid"]:not([data-render="true"])');
    }
    if (mermaidElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/mermaid/mermaid.min.js?v=11.12.0`, "protyleMermaidScript").then(() => {
        addScript(`${cdn}/js/mermaid/mermaid-zenuml.min.js?v=0.2.2`, "protyleMermaidZenumlScript").then(async () => {
            await window.mermaid.registerExternalDiagrams([window.zenuml]);
            window.mermaid.registerIconPacks([
                {
                    name: "logos",
                    loader: () =>
                        fetch(`${cdn}/js/mermaid/icons.json?v=11.11.0`).then((res) => res.json()),
                },
            ]);
            const config: any = {
                securityLevel: "loose", // 升级后无 https://github.com/siyuan-note/siyuan/issues/3587，可使用该选项
                altFontFamily: "sans-serif",
                fontFamily: "sans-serif",
                startOnLoad: false,
                flowchart: {
                    htmlLabels: true,
                    useMaxWidth: !0
                },
                sequence: {
                    useMaxWidth: true,
                    diagramMarginX: 8,
                    diagramMarginY: 8,
                    boxMargin: 8,
                    showSequenceNumbers: true // Mermaid 时序图增加序号 https://github.com/siyuan-note/siyuan/pull/6992 https://mermaid.js.org/syntax/sequenceDiagram.html#sequencenumbers
                },
                gantt: {
                    leftPadding: 75,
                    rightPadding: 20
                }
            };
            if (window.siyuan.config.appearance.mode === 1) {
                config.theme = "dark";
            }
            window.mermaid.initialize(config);
            const hideElements: Element[] = [];
            const normalElements: Element[] = [];
            mermaidElements.forEach(item => {
                if (item.firstElementChild.clientWidth === 0) {
                    hideElements.push(item);
                } else {
                    normalElements.push(item);
                }
            });
            if (hideElements.length > 0) {
                const targetToItems = new Map<Element, { items: Element[]; attributeFilter: string[] }>();
                hideElements.forEach(item => {
                    const hideElement = hasClosestByAttribute(item, "fold", "1");
                    let target: Element;
                    let attributeFilter: string[];
                    if (hideElement) {
                        target = hideElement;
                        attributeFilter = ["fold"];
                    } else {
                        const cardElement = hasClosestByClassName(item, "card__block", true);
                        if (!cardElement) {
                            return;
                        }
                        target = cardElement;
                        attributeFilter = ["class"];
                    }
                    const group = targetToItems.get(target);
                    if (group) {
                        group.items.push(item);
                    } else {
                        targetToItems.set(target, {items: [item], attributeFilter});
                    }
                });
                targetToItems.forEach((group, target) => {
                    const existing = mermaidObserverMap.get(target);
                    if (existing) {
                        group.items.forEach(item => {
                            if (!existing.group.items.includes(item)) {
                                existing.group.items.push(item);
                            }
                        });
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        initMermaid(group.items);
                        observer.disconnect();
                        mermaidObserverMap.delete(target);
                    });
                    observer.observe(target, {attributeFilter: group.attributeFilter});
                    mermaidObserverMap.set(target, {observer, group});
                });
            }
            initMermaid(normalElements);
        });
    });
};

const initMermaid = (mermaidElements: Element[]) => {
    const wysiswgElement = hasClosestByClassName(mermaidElements[0], "protyle-wysiwyg", true);
    mermaidElements.forEach(async (item: HTMLElement) => {
        if (item.getAttribute("data-render") === "true") {
            return;
        }
        item.setAttribute("data-render", "true");
        if (!item.firstElementChild.classList.contains("protyle-icons")) {
            item.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
        }
        const renderElement = item.firstElementChild.nextElementSibling as HTMLElement;
        if (!item.getAttribute("data-content")) {
            renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span>`;
            return;
        }
        const id = "mermaid" + Lute.NewNodeID();
        try {
            renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div contenteditable="false"><span id="${id}"></span></div>`;
            const mermaidData = await window.mermaid.render(id, Lute.UnEscapeHTMLStr(item.getAttribute("data-content")));
            renderElement.lastElementChild.innerHTML = mermaidData.svg;
        } catch (e) {
            const errorElement = document.querySelector("#" + id);
            renderElement.lastElementChild.innerHTML = `${errorElement.outerHTML}<div class="fn__hr"></div><div class="ft__error">${e.message.replace(/\n/, "<br>")}</div>`;
            errorElement.parentElement.remove();
        }
    });
};
