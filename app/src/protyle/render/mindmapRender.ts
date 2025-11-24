import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../util/hasClosest";
import {genIconHTML} from "./util";

export const mindmapRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
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
    addScript(`${cdn}/js/markmap/d3.min.js`, "protyleD3Script")
        .then(() => addScript(`${cdn}/js/markmap/markmap-lib.min.js`, "protyleMarkmapLibScript"))
        .then(() => addScript(`${cdn}/js/markmap/markmap-view.min.js`, "protyleMarkmapScript"))
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
                e.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
            if (!e.getAttribute("data-content")) {
                renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span>`;
                return;
            }
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
                const mm: any = (window as any).markmap;

                // Prefer the new markmap Transformer API when available
                let data: any = null;
                let rootData: any = null;
                try {
                    if (mm && typeof mm.Transformer === "function") {
                        const transformer = new mm.Transformer();
                        const tx = transformer.transform(md);
                        // tx contains { root, features }
                        rootData = tx && tx.root;

                        // load assets required by used features
                        const assetsGetter = typeof transformer.getUsedAssets === "function" ? "getUsedAssets" : (typeof transformer.getAssets === "function" ? "getAssets" : null);
                        if (assetsGetter) {
                            const assets = (transformer as any)[assetsGetter](tx.features);
                            const styles = assets && assets.styles;
                            const scripts = assets && assets.scripts;
                            if (styles && typeof mm.loadCSS === "function") {
                                try { mm.loadCSS(styles); } catch (err) { /* ignore */ }
                            }
                            if (scripts && typeof mm.loadJS === "function") {
                                try { mm.loadJS(scripts, { getMarkmap: () => (window as any).markmap }); } catch (err) { /* ignore */ }
                            }
                        }
                    } else if (mm && typeof mm.transform === "function") {
                        data = mm.transform(md);
                    } else if ((window as any).markmap && typeof (window as any).markmap.transform === "function") {
                        data = (window as any).markmap.transform(md);
                    }
                } catch (e) {
                    // fallback, leave data/rootData null and let downstream handle it
                    data = null;
                    rootData = null;
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
                if (MarkmapCtor && typeof MarkmapCtor.create === "function") {
                    if (rootData) {
                        // When Transformer was used we have a `root` structure
                        MarkmapCtor.create(svg, null, rootData);
                    } else {
                        if (!data && typeof MarkmapCtor.transform === "function") {
                            try { data = MarkmapCtor.transform(md); } catch (err) { data = null; }
                        }
                        MarkmapCtor.create(svg, data || { root: { children: [] } }, { embedCSS: true });
                    }
                } else {
                    throw new Error("Markmap not available");
                }
            } catch (error) {

                renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div class="ft__error" style="height:${e.style.height || "420px"}" contenteditable="false">Mindmap render error: <br>${error}</div>`;
            }
            e.setAttribute("data-render", "true");
        });
    });
};
