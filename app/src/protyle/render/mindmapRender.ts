import { addScript } from "../util/addScript";
import { Constants } from "../../constants";
import { hasClosestByClassName } from "../util/hasClosest";
import { genIconHTML } from "./util";

export const mindmapRender = (element: Element, cdn = Constants.PROTYLE_CDN, markmapOptions: {zoom?: boolean; pan?: boolean} = {}) => {
    let mindmapElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "mindmap") {
        // 编辑器内代码块编辑渲染
        mindmapElements = [element];
    } else {
        mindmapElements = Array.from(element.querySelectorAll('[data-subtype="mindmap"]'));
    }
    if (mindmapElements.length === 0) {
        return;
    }
    // load d3 first, then markmap-lib, then markmap-view (in order)
    addScript(`${cdn}/js/d3/d3.min.js?v6.7.0`, "protyleD3Script")
        .then(() => addScript(`${cdn}/js/markmap/markmap-lib.min.js?v0.14.4`, "protyleMarkmapLibScript"))
        .then(() => addScript(`${cdn}/js/markmap/markmap-view.min.js?v0.14.4`, "protyleMarkmapScript"))
        .then(() => {
            const wysiswgElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
            let width: number = undefined;
            if (wysiswgElement && wysiswgElement.clientWidth > 0 && mindmapElements[0].firstElementChild.clientWidth === 0 && wysiswgElement.firstElementChild) {
                width = wysiswgElement.firstElementChild.clientWidth;
            }
            mindmapElements.forEach((e: HTMLDivElement) => {
                if (e.getAttribute("data-render") === "true") {
                    return;
                }
                if (!e.firstElementChild.classList.contains("protyle-icons")) {
                    // Add home icon for mindmap (reset view), edit and more
                    e.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement, ["home", "edit", "more"]));
                }
                const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
                if (!e.getAttribute("data-content")) {
                    renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span>`;
                    return;
                }
                let transformer: any = null;
                try {
                    // create or reuse container for markmap
                    if (!renderElement.lastElementChild || renderElement.childElementCount === 1) {
                        renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div style="height:${e.style.height || "420px"}" contenteditable="false"></div>`;
                    } else {
                        renderElement.lastElementChild.classList.remove("ft__error");
                    }

                    // Convert stored content to markdown using Lute (prefer existing instance), then transform/render with markmap
                    const raw = Lute.UnEscapeHTMLStr(e.getAttribute("data-content"));
                    let md: string = raw;
                    // prefer protyle's lute instance if available
                    if ((window as any).protyle && (window as any).protyle.lute && typeof (window as any).protyle.lute.BlockDOM2Md === "function") {
                        md = (window as any).protyle.lute.BlockDOM2Md(raw);
                    } else if (typeof Lute === "function" && typeof Lute.New === "function") {
                        try {
                            const luteInst = Lute.New();
                            if (luteInst && typeof luteInst.BlockDOM2Md === "function") {
                                md = luteInst.BlockDOM2Md(raw);
                            } else if (luteInst && typeof luteInst.BlockDOM2HTML === "function") {
                                md = luteInst.BlockDOM2HTML(raw);
                            }
                        } catch (e) {
                            // fallback to raw
                            md = raw;
                        }
                    }

                    // Try to obtain markmap entry from loaded bundles (single unified reference)
                    const mm: any = (window as any).markmap || (window as any).Markmap || null;

                    // Prefer the Transformer API when available (transform -> getUsedAssets -> load assets -> create)
                    let rootData: any = null;
                    if (mm) {
                        if (typeof mm.Transformer === "function") {
                            transformer = new mm.Transformer();
                            // transform markdown -> { root, features }
                            const tx = transformer.transform(md) || {};
                            rootData = tx.root || null;

                            // select asset getter: prefer getUsedAssets then getAssets
                            const assetsGetter = typeof transformer.getUsedAssets === "function" ? "getUsedAssets" : (typeof transformer.getAssets === "function" ? "getAssets" : null);
                            if (assetsGetter) {
                                const assets = (transformer as any)[assetsGetter](tx.features || {});
                                const styles = assets && assets.styles;
                                const scripts = assets && assets.scripts;

                                const loadCSS = typeof mm.loadCSS === "function" ? mm.loadCSS : null;
                                const loadJS = typeof mm.loadJS === "function" ? mm.loadJS : null;
                                if (styles && loadCSS) {
                                    try { loadCSS(styles); } catch (err) { /* ignore */ }
                                }
                                if (scripts && loadJS) {
                                    try { loadJS(scripts, { getMarkmap: () => (window as any).markmap || mm }); } catch (err) { /* ignore */ }
                                }
                            }
                        } else {
                            // fallback: try older transform functions (may return root-like object)
                            const transformFn = mm.transform || (window as any).markmap && (window as any).markmap.transform;
                            if (typeof transformFn === "function") {
                                try {
                                    const tx = transformFn(md) || {};
                                    rootData = tx.root || tx || null;
                                } catch (err) {
                                    rootData = null;
                                }
                            }
                        }
                    }

                    // container for svg
                    const container = renderElement.lastElementChild as HTMLElement;
                    // clear existing content and append an svg for markmap
                    container.innerHTML = "";
                    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                    // use width if calculated earlier
                    if (typeof width === "number" && width > 0) {
                        svg.setAttribute("width", String(width));
                    } else {
                        svg.setAttribute("width", "100%");
                    }
                    svg.setAttribute("height", "100%");
                    container.appendChild(svg);

                    // prefer Markmap.create if available
                    const MarkmapCtor = (mm && (mm.Markmap || mm.default || mm)) || (window as any).Markmap;
                    // default options, allow overriding via markmapOptions (e.g. in export we can pass zoom/pan false)
                    const options = Object.assign({
                        duration: 0,        // 🔥 禁用动画，设为0
                    }, markmapOptions || {});
                    // create and store markmap + transformer on the element so callers can update instead of re-creating
                    if (MarkmapCtor && typeof MarkmapCtor.create === "function") {
                        if (rootData) {
                            const markmapInstance = MarkmapCtor.create(svg, options, rootData);
                            const mmEntry: any = (e as any).__markmap || {};
                            mmEntry.transformer = transformer || mmEntry.transformer || null;
                            mmEntry.markmap = markmapInstance;
                            mmEntry.options = options;
                            (e as any).__markmap = mmEntry;
                        }
                    } else {
                        throw new Error("Markmap not available");
                    }
                } catch (error) {

                    renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div class="ft__error" style="height:${e.style.height || "420px"}" contenteditable="false">Mindmap render error: <br>${error}</div>`;
                }
                e.setAttribute("data-render", "true");
                // expose a small helper to update content (callable by toolbar)
                try {
                    const mmEntry: any = (e as any).__markmap;
                    if (mmEntry && mmEntry.transformer && mmEntry.markmap) {
                        (e as any).__markmap.updateContent = (newMarkdown: string) => {
                            try {
                                const tx2 = mmEntry.transformer.transform(newMarkdown) || {};
                                const root2 = tx2.root || null;
                                if (mmEntry.markmap && typeof mmEntry.markmap.setData === "function") {
                                    mmEntry.markmap.setData(root2, mmEntry.options);
                                }
                            } catch (e) {
                                // ignore update errors
                                console.error("markmap updateContent error", e);
                            }
                        };
                    }
                } catch (e) {
                    // ignore
                }
            });
        });
};
