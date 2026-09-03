import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {genIconHTML} from "./util";
import {applyMermaidLayout, getMermaidLayout, MERMAID_LAYOUT_ATTR} from "./mermaidLayout";
import {MERMAID_SANITIZE_OPTIONS} from "./mermaidSanitize";
import {isZenumlDiagram} from "./mermaidZenuml";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {escapeHtml} from "../../util/escape";

let mermaidTidyTreePromise: Promise<void>;
let mermaidZenumlPromise: Promise<void>;

const registerMermaidExternalDiagrams = (mermaidElements: Element[], cdn: string) => {
    if (!mermaidElements.some((item) => isZenumlDiagram(item.getAttribute("data-content")))) {
        return Promise.resolve();
    }
    if (!mermaidZenumlPromise) {
        mermaidZenumlPromise = addScript(
            `${cdn}/js/mermaid/mermaid-zenuml.min.js?v=0.2.3`,
            "protyleMermaidZenumlScript"
        ).then(async () => {
            await window.mermaid.registerExternalDiagrams([window.zenuml]);
        });
    }
    return mermaidZenumlPromise;
};

const registerMermaidLayouts = (mermaidElements: Element[], cdn: string) => {
    if (!mermaidElements.some((item) => getMermaidLayout(item.getAttribute(MERMAID_LAYOUT_ATTR)) === "tidy-tree")) {
        return Promise.resolve();
    }
    if (!mermaidTidyTreePromise) {
        mermaidTidyTreePromise = addScript(
            `${cdn}/js/mermaid/mermaid-layout-tidy-tree.min.js?v=0.2.2`,
            "protyleMermaidTidyTreeScript"
        ).then(() => {
            window.mermaid.registerLayoutLoaders(window.mermaidTidyTree);
        });
    }
    return mermaidTidyTreePromise;
};

export const mermaidRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let mermaidElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "mermaid" && element.getAttribute("data-render") !== "true") {
        mermaidElements = [element];
    } else {
        mermaidElements = Array.from(element.querySelectorAll('[data-subtype="mermaid"]:not([data-render="true"])'));
    }
    if (mermaidElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/mermaid/mermaid.min.js?v=11.16.1`, "protyleMermaidScript").then(async () => {
        await registerMermaidExternalDiagrams(mermaidElements, cdn);
        await registerMermaidLayouts(mermaidElements, cdn);
        window.mermaid.registerIconPacks([
            {
                name: "logos",
                loader: () =>
                    fetch(`${cdn}/js/mermaid/icons.json?v=1.2.13`).then((res) => res.json()),
            },
        ]);
        const config: any = {
            // 升级后无 https://github.com/siyuan-note/siyuan/issues/3587，可使用 loose
            securityLevel: getHostCapabilities().remoteKernel ? "strict" : "loose",
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
            const observer = new MutationObserver(() => {
                initMermaid(hideElements);
                observer.disconnect();
            });
            hideElements.forEach(item => {
                const hideElement = hasClosestByAttribute(item, "fold", "1");
                if (hideElement) {
                    observer.observe(hideElement, {attributeFilter: ["fold"]});
                } else {
                    const cardElement = hasClosestByClassName(item, "card__block", true);
                    if (cardElement) {
                        observer.observe(cardElement, {attributeFilter: ["class"]});
                    }
                }
            });
        }
        initMermaid(normalElements);
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
            const content = applyMermaidLayout(
                Lute.UnEscapeHTMLStr(item.getAttribute("data-content")),
                getMermaidLayout(item.getAttribute(MERMAID_LAYOUT_ATTR))
            );
            const mermaidData = await window.mermaid.render(id, content);
            let svg = mermaidData.svg.replace(/(href|src|xlink:href)\s*=\s*["']\\\\/gi, (match, p1) => `${p1}="about:blank"`);
            svg = window.DOMPurify.sanitize(svg, MERMAID_SANITIZE_OPTIONS);
            renderElement.lastElementChild.innerHTML = svg;
        } catch (e) {
            const errorElement = document.querySelector("#" + id);
            const errorDiagram = errorElement ?
                window.DOMPurify.sanitize(errorElement.outerHTML, MERMAID_SANITIZE_OPTIONS) : "";
            const errorMessage = escapeHtml(e instanceof Error ? e.message : String(e)).replace(/\n/g, "<br>");
            renderElement.lastElementChild.innerHTML = `${errorDiagram}<div class="fn__hr"></div><div class="ft__error">${errorMessage}</div>`;
            errorElement?.parentElement?.remove();
        }
    });
};
