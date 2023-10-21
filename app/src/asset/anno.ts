import {fetchPost} from "../util/fetch";
import {setPosition} from "../util/setPosition";
import {hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import * as dayjs from "dayjs";
import {setStorageVal, writeText} from "../protyle/util/compatibility";
import {getAllModels} from "../layout/getAll";
import {focusByRange} from "../protyle/util/selection";
import {Constants} from "../constants";

export const initAnno = (element: HTMLElement, pdf: any, pdfConfig: any) => {
    getConfig(pdf);
    const rectAnnoElement = pdfConfig.toolbar.rectAnno;
    rectAnnoElement.addEventListener("click", () => {
        if (rectAnnoElement.classList.contains("toggled")) {
            rectAnnoElement.classList.remove("toggled");
            pdfConfig.mainContainer.classList.remove("rect-to-annotation");
        } else {
            pdf.pdfCursorTools.switchTool(0);
            rectAnnoElement.classList.add("toggled");
            pdfConfig.mainContainer.classList.add("rect-to-annotation");
            if (getSelection().rangeCount > 0) {
                getSelection().getRangeAt(0).collapse(true);
            }
            hideToolbar(element);
        }
    });
    const rectResizeElement = pdfConfig.mainContainer.lastElementChild;
    pdfConfig.mainContainer.addEventListener("mousedown", (event: MouseEvent) => {
        if (event.button === 2 || !rectAnnoElement.classList.contains("toggled")) {
            // 右键
            return;
        }
        let canvasRect = pdf.pdfViewer._getVisiblePages().first.view.canvas.getBoundingClientRect();
        if (event.clientX > canvasRect.right) {
            canvasRect = pdf.pdfViewer._getVisiblePages().last.view.canvas.getBoundingClientRect();
        }
        const containerRet = pdfConfig.mainContainer.getBoundingClientRect();
        const mostLeft = canvasRect.left;
        const mostRight = canvasRect.right;
        const mostBottom = containerRet.bottom;
        let x = event.clientX;
        if (event.clientX > mostRight) {
            x = mostRight;
        } else if (event.clientX < mostLeft) {
            x = mostLeft;
        }
        const mostTop = containerRet.top;
        const y = event.clientY;
        const documentSelf = document;
        documentSelf.onmousemove = (moveEvent) => {
            rectResizeElement.classList.remove("fn__none");
            let newTop = 0;
            let newLeft = 0;
            let newWidth = 0;
            let newHeight = 0;
            if (moveEvent.clientX < x) {
                if (moveEvent.clientX < mostLeft) {
                    // 向左越界
                    newLeft = mostLeft;
                } else {
                    // 向左
                    newLeft = moveEvent.clientX;
                }
                newWidth = x - newLeft;
            } else {
                if (moveEvent.clientX > mostRight) {
                    // 向右越界
                    newLeft = x;
                    newWidth = mostRight - newLeft;
                } else {
                    // 向右
                    newLeft = x;
                    newWidth = moveEvent.clientX - x;
                }
            }

            if (moveEvent.clientY > y) {
                if (moveEvent.clientY > mostBottom) {
                    // 向下越界
                    newTop = y;
                    newHeight = mostBottom - y;
                } else {
                    // 向下
                    newTop = y;
                    newHeight = moveEvent.clientY - y;
                }
            } else {
                if (moveEvent.clientY < mostTop) {
                    // 向上越界
                    newTop = mostTop;
                } else {
                    // 向上
                    newTop = moveEvent.clientY;
                }
                newHeight = y - newTop;
            }
            rectResizeElement.setAttribute("style",
                `top:${newTop}px;height:${newHeight}px;left:${newLeft}px;width:${newWidth}px;background-color:${moveEvent.altKey ? "var(--b3-pdf-background1)" : ""}`);
        };
        documentSelf.onmouseup = () => {
            documentSelf.onmousemove = null;
            documentSelf.onmouseup = null;
            documentSelf.ondragstart = null;
            documentSelf.onselectstart = null;
            documentSelf.onselect = null;
            rectAnnoElement.classList.remove("toggled");
            pdfConfig.mainContainer.classList.remove("rect-to-annotation");

            const coords = getHightlightCoordsByRect(pdf, window.siyuan.storage[Constants.LOCAL_PDFTHEME].annoColor || "var(--b3-pdf-background1)", rectResizeElement,
                rectResizeElement.style.backgroundColor ? "text" : "border");
            rectResizeElement.classList.add("fn__none");
            if (coords) {
                coords.forEach((item, index) => {
                    const newElement = showHighlight(item, pdf);
                    if (index === 0) {
                        rectElement = newElement;
                        copyAnno(`${pdf.appConfig.file.replace(location.origin, "").substr(1)}/${rectElement.getAttribute("data-node-id")}`,
                            pdf.appConfig.file.replace(location.origin, "").substr(8).replace(/-\d{14}-\w{7}.pdf$/, ""), pdf);
                    }
                });
            } else {
                rectElement = null;
            }
        };
    });

    element.addEventListener("click", (event) => {
        let processed = false;
        let target = event.target as HTMLElement;
        if (typeof event.detail === "string") {
            window.siyuan.storage[Constants.LOCAL_PDFTHEME].annoColor = event.detail === "0" ?
                (window.siyuan.storage[Constants.LOCAL_PDFTHEME].annoColor || "var(--b3-pdf-background1)")
                : `var(--b3-pdf-background${event.detail})`;
            setStorageVal(Constants.LOCAL_PDFTHEME, window.siyuan.storage[Constants.LOCAL_PDFTHEME]);
            const coords = getHightlightCoordsByRange(pdf, window.siyuan.storage[Constants.LOCAL_PDFTHEME].annoColor);
            if (coords) {
                coords.forEach((item, index) => {
                    const newElement = showHighlight(item, pdf);
                    if (index === 0) {
                        rectElement = newElement;
                        copyAnno(`${pdf.appConfig.file.replace(location.origin, "").substr(1)}/${rectElement.getAttribute("data-node-id")}`,
                            pdf.appConfig.file.replace(location.origin, "").substr(8).replace(/-\d{14}-\w{7}.pdf$/, ""), pdf);
                    }
                });
            }
            hideToolbar(element);
            return;
        }
        while (target && !target.classList.contains("pdf__outer")) {
            const type = target.getAttribute("data-type");
            if (target.classList.contains("color__square")) {
                const color = target.style.backgroundColor;
                window.siyuan.storage[Constants.LOCAL_PDFTHEME].annoColor = color;
                setStorageVal(Constants.LOCAL_PDFTHEME, window.siyuan.storage[Constants.LOCAL_PDFTHEME]);
                if (rectElement) {
                    const config = getConfig(pdf);
                    const annoItem = config[rectElement.getAttribute("data-node-id")];
                    annoItem.color = color;
                    Array.from(rectElement.children).forEach((item: HTMLElement) => {
                        item.style.border = "2px solid " + color;
                        if (annoItem.type === "text") {
                            item.style.backgroundColor = color;
                        } else {
                            item.style.backgroundColor = "transparent";
                        }
                    });
                    fetchPost("/api/asset/setFileAnnotation", {
                        path: pdf.appConfig.file.replace(location.origin, "").substr(1) + ".sya",
                        data: JSON.stringify(config),
                    });
                } else {
                    const coords = getHightlightCoordsByRange(pdf, color);
                    if (coords) {
                        coords.forEach((item, index) => {
                            const newElement = showHighlight(item, pdf);
                            if (index === 0) {
                                rectElement = newElement;
                                copyAnno(`${pdf.appConfig.file.replace(location.origin, "").substr(1)}/${rectElement.getAttribute("data-node-id")}`,
                                    pdf.appConfig.file.replace(location.origin, "").substr(8).replace(/-\d{14}-\w{7}.pdf$/, ""), pdf);
                            }
                        });
                    }
                }
                hideToolbar(element);
                processed = true;
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("pdf__rect")) {
                showToolbar(element, undefined, target);
                event.preventDefault();
                event.stopPropagation();
                processed = true;
                break;
            } else if (type === "remove") {
                const urlPath = pdf.appConfig.file.replace(location.origin, "").substr(1);
                const config = getConfig(pdf);
                delete config[rectElement.getAttribute("data-node-id")];
                rectElement.remove();
                fetchPost("/api/asset/setFileAnnotation", {
                    path: urlPath + ".sya",
                    data: JSON.stringify(config),
                });
                hideToolbar(element);
                event.preventDefault();
                event.stopPropagation();
                processed = true;
                break;
            } else if (type === "copy") {
                hideToolbar(element);
                copyAnno(`${pdf.appConfig.file.replace(location.origin, "").substr(1)}/${rectElement.getAttribute("data-node-id")}`,
                    pdf.appConfig.file.replace(location.origin, "").substr(8).replace(/-\d{14}-\w{7}.pdf$/, ""), pdf);
                event.preventDefault();
                event.stopPropagation();
                processed = true;
                break;
            } else if (type === "toggle") {
                const config = getConfig(pdf);
                const annoItem = config[rectElement.getAttribute("data-node-id")];
                if (annoItem.type === "border") {
                    annoItem.type = "text";
                } else {
                    annoItem.type = "border";
                }
                Array.from(rectElement.children).forEach((item: HTMLElement) => {
                    if (annoItem.type === "text") {
                        item.style.backgroundColor = item.style.border.replace("2px solid ", "");
                    } else {
                        item.style.backgroundColor = "";
                    }
                });
                fetchPost("/api/asset/setFileAnnotation", {
                    path: pdf.appConfig.file.replace(location.origin, "").substr(1) + ".sya",
                    data: JSON.stringify(config),
                });
                event.preventDefault();
                event.stopPropagation();
                processed = true;
                hideToolbar(element);
                break;
            }
            target = target.parentElement;
        }

        if (processed) {
            return;
        }

        setTimeout(() => {
            let isShow = false;
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                if (range.toString() !== "" &&
                    hasClosestByClassName(range.commonAncestorContainer, "pdfViewer")) {
                    showToolbar(element, range);
                    isShow = true;
                }
            }
            if (!isShow) {
                hideToolbar(element);
            }
        });
    });
    return pdf;
};

const hideToolbar = (element: HTMLElement) => {
    element.querySelector(".pdf__util").classList.add("fn__none");
};

let rectElement: HTMLElement;
const showToolbar = (element: HTMLElement, range: Range, target?: HTMLElement) => {
    if (target) {
        // 阻止 popover
        target.setAttribute("prevent-popover", "true");
        setTimeout(() => {
            target.removeAttribute("prevent-popover");
        }, 620);
    }

    const utilElement = element.querySelector(".pdf__util") as HTMLElement;
    utilElement.classList.remove("fn__none");

    if (range) {
        utilElement.classList.add("pdf__util--hide");
        const rects = range.getClientRects();
        const rect = rects[rects.length - 1];
        setPosition(utilElement, rect.left, rect.bottom);
        rectElement = null;
        return;
    }
    rectElement = target;
    utilElement.classList.remove("pdf__util--hide");
    const targetRect = target.firstElementChild.getBoundingClientRect();
    setPosition(utilElement, targetRect.left, targetRect.top + targetRect.height + 4);
};

const getHightlightCoordsByRange = (pdf: any, color: string) => {
    const range = window.getSelection().getRangeAt(0);
    const startPageElement = hasClosestByClassName(range.startContainer, "page");
    if (!startPageElement) {
        return;
    }
    const startIndex = parseInt(
        startPageElement.getAttribute("data-page-number")) - 1;

    const endPageElement = hasClosestByClassName(range.endContainer, "page");
    if (!endPageElement) {
        return;
    }
    const endIndex = parseInt(endPageElement.getAttribute("data-page-number")) - 1;
    // https://github.com/siyuan-note/siyuan/issues/5213
    const rangeContents = range.cloneContents();
    Array.from(rangeContents.children).forEach(item => {
        if (item.tagName === "BR" && item.previousElementSibling && item.nextElementSibling) {
            const previousText = item.previousElementSibling.textContent;
            const nextText = item.nextElementSibling.textContent;
            if (/^[A-Za-z]$/.test(previousText.substring(previousText.length - 2, previousText.length - 1)) &&
                /^[A-Za-z]$/.test(nextText.substring(0, 1))) {
                if (previousText.endsWith("-")) {
                    item.previousElementSibling.textContent = previousText.substring(0, previousText.length - 1);
                } else {
                    // 中文情况不能添加 https://github.com/siyuan-note/siyuan/issues/8152
                    item.insertAdjacentText("afterend", " ");
                }
            }
        }
    });
    // eslint-disable-next-line no-control-regex
    const content = Lute.EscapeHTMLStr(rangeContents.textContent.replace(/[\x00]|\n/g, ""));
    const startPage = pdf.pdfViewer.getPageView(startIndex);
    const startPageRect = startPage.canvas.getClientRects()[0];
    const startViewport = startPage.viewport;

    const cloneRange = range.cloneRange();
    if (startIndex !== endIndex) {
        const startDivs = startPage.textLayer.textDivs;
        range.setEndAfter(startDivs[startDivs.length - 1]);
    }

    const startSelected: number[] = [];
    mergeRects(range).forEach(function (r) {
        startSelected.push(
            startViewport.convertToPdfPoint(r.left - startPageRect.x,
                r.top - startPageRect.y).concat(startViewport.convertToPdfPoint(r.right - startPageRect.x,
                r.bottom - startPageRect.y)),
        );
    });

    const endSelected: number[] = [];
    if (startIndex !== endIndex) {
        focusByRange(cloneRange);
        const endPage = pdf.pdfViewer.getPageView(endIndex);
        const endPageRect = endPage.canvas.getClientRects()[0];
        const endViewport = endPage.viewport;
        const endDivs = endPage.textLayer.textDivs;
        cloneRange.setStart(endDivs[0], 0);
        mergeRects(cloneRange).forEach(function (r) {
            endSelected.push(
                endViewport.convertToPdfPoint(r.left - endPageRect.x,
                    r.top - endPageRect.y).concat(endViewport.convertToPdfPoint(r.right - endPageRect.x,
                    r.bottom - endPageRect.y)),
            );
        });
    }

    const id = Lute.NewNodeID();
    const pages: {
        index: number
        positions: number[]
    }[] = [];
    const results = [];
    if (startSelected.length > 0) {
        pages.push({
            index: startIndex,
            positions: startSelected,
        });
        results.push({
            index: startIndex,
            coords: startSelected,
            id,
            color,
            content,
            type: "text",
            mode: "text",
        });
    }
    if (endSelected.length > 0) {
        pages.push({
            index: endIndex,
            positions: endSelected,
        });
        results.push({index: endIndex, coords: endSelected, id, color, content, type: "text", mode: "text"});
    }
    if (pages.length === 0) {
        return;
    }
    setConfig(pdf, id, {
        pages,
        content,
        color,
        type: "text",
        mode: "text",
    });
    return results;
};

const getHightlightCoordsByRect = (pdf: any, color: string, rectResizeElement: HTMLElement, type: string) => {
    const rect = rectResizeElement.getBoundingClientRect();

    const startPageElement = hasClosestByClassName(document.elementFromPoint(rect.left, rect.top - 1), "page");
    if (!startPageElement) {
        return;
    }
    const startIndex = parseInt(
        startPageElement.getAttribute("data-page-number")) - 1;

    const startPage = pdf.pdfViewer.getPageView(startIndex);
    const startPageRect = startPage.canvas.getClientRects()[0];
    const startViewport = startPage.viewport;

    const startSelected = startViewport.convertToPdfPoint(
        rect.left - startPageRect.x,
        rect.top - startPageRect.y).concat(startViewport.convertToPdfPoint(rect.right - startPageRect.x,
        rect.bottom - startPageRect.y));

    const pages: {
        index: number
        positions: number[]
    }[] = [
        {
            index: startPage.id - 1,
            positions: [startSelected],
        }];

    const id = Lute.NewNodeID();
    const content = pdf.appConfig.file.replace(location.origin, "").substr(8).replace(/-\d{14}-\w{7}.pdf$/, "") +
        `-P${startPage.id}-${dayjs().format("YYYYMMDDHHmmss")}`;
    const result = [{
        index: startPage.id - 1,
        coords: [startSelected],
        id,
        color,
        content,
        type,
        mode: "rect",
    }];

    let endPageElement = document.elementFromPoint(rect.right, rect.bottom + 1);
    endPageElement = hasClosestByClassName(endPageElement, "page") as HTMLElement;
    if (endPageElement) {
        const endIndex = parseInt(
            endPageElement.getAttribute("data-page-number")) - 1;
        if (endIndex !== startIndex) {
            const endPage = pdf.pdfViewer.getPageView(endIndex);
            const endPageRect = endPage.canvas.getClientRects()[0];
            const endViewport = endPage.viewport;

            const endSelected = endViewport.convertToPdfPoint(
                rect.left - endPageRect.x,
                rect.top - endPageRect.y).concat(endViewport.convertToPdfPoint(rect.right - endPageRect.x,
                rect.bottom - endPageRect.y));
            pages.push({
                index: endPage.id - 1,
                positions: [endSelected],
            });
            result.push({
                index: endPage.id - 1,
                coords: [endSelected],
                id,
                color,
                content,
                type,
                mode: "rect",
            });
        }
    }

    setConfig(pdf, id, {
        pages,
        content,
        color,
        type,
        mode: "rect",
    });
    return result;
};

const mergeRects = (range: Range) => {
    const rects = range.getClientRects();
    const mergedRects: { left: number, top: number, right: number, bottom: number }[] = [];
    let lastTop: number = undefined;
    Array.from(rects).forEach(item => {
        if (item.height === 0 || item.width === 0) {
            return;
        }
        if (typeof lastTop === "undefined" || Math.abs(lastTop - item.top) > 4) {
            mergedRects.push({left: item.left, top: item.top, right: item.right, bottom: item.bottom});
            lastTop = item.top;
        } else {
            mergedRects[mergedRects.length - 1].right = item.right;
        }
    });
    return mergedRects;
};

export const getPdfInstance = (element: HTMLElement) => {
    let pdfInstance;
    getAllModels().asset.find(item => {
        if (item.pdfObject && element && item.element && typeof item.element.contains !== "undefined" && item.element.contains(element)) {
            pdfInstance = item.pdfObject;
            return true;
        }
    });
    return pdfInstance;
};

export const getHighlight = (element: HTMLElement) => {
    const pdfInstance: any = getPdfInstance(element);
    if (!pdfInstance) {
        return;
    }
    const pageIndex = parseInt(
        element.parentElement.getAttribute("data-page-number")) - 1;
    const config = getConfig(pdfInstance);
    Object.keys(config).find(key => {
        const item = config[key];
        const page = item.pages.find((page: { index: number }) => {
            if (page.index === pageIndex) {
                return true;
            }
        });

        if (page) {
            showHighlight({
                index: pageIndex,
                coords: page.positions,
                id: key,
                color: item.color,
                content: item.content,
                type: item.type,
                mode: item.mode || ""
            }, pdfInstance, pdfInstance.annoId === key);
        }
    });
};

const showHighlight = (selected: IPdfAnno, pdf: any, hl?: boolean) => {
    const pageIndex = selected.index;
    const page = pdf.pdfViewer.getPageView(pageIndex);
    let textLayerElement = page.textLayer.div;
    if (!textLayerElement.lastElementChild) {
        return;
    }
    const viewport = page.viewport;
    if (textLayerElement.lastElementChild.classList.contains("endOfContent")) {
        textLayerElement.insertAdjacentHTML("beforeend", "<div></div>");
    }
    textLayerElement = textLayerElement.lastElementChild;

    let html = `<div class="pdf__rect popover__block" data-node-id="${selected.id}" data-mode="${selected.mode}">`;
    selected.coords.forEach((rect) => {
        const bounds = viewport.convertToViewportRectangle(rect);
        const width = Math.abs(bounds[0] - bounds[2]);
        if (width <= 0) {
            return;
        }
        let style = `border: 2px solid ${selected.color};background-color: ${selected.color};`;
        if (selected.type === "border") {
            style = `border: 2px solid ${selected.color};`;
        }
        html += `<div style="${style}
        left:${Math.min(bounds[0], bounds[2])}px;
        top:${Math.min(bounds[1], bounds[3])}px;
        width:${width}px;
        height: ${Math.abs(bounds[1] - bounds[3])}px"></div>`;
    });
    textLayerElement.insertAdjacentHTML("beforeend", html + "</div>");
    textLayerElement.lastElementChild.setAttribute("data-content", selected.content);
    if (hl) {
        hlPDFRect(textLayerElement, selected.id);
    }
    return textLayerElement.lastElementChild;
};

export const hlPDFRect = (element: HTMLElement, id: string) => {
    const currentElement = element.querySelector(`.pdf__rect[data-node-id="${id}"]`);
    if (currentElement && currentElement.firstElementChild) {
        const scrollElement = hasClosestByAttribute(currentElement, "id",
            "viewerContainer");
        if (scrollElement) {
            const currentRect = currentElement.firstElementChild.getBoundingClientRect();
            const scrollRect = scrollElement.getBoundingClientRect();
            if (currentRect.top < scrollRect.top) {
                scrollElement.scrollTop = scrollElement.scrollTop -
                    (scrollRect.top - currentRect.top) -
                    (scrollRect.height - currentRect.height) / 2;
            } else if (currentRect.bottom > scrollRect.bottom) {
                scrollElement.scrollTop = scrollElement.scrollTop +
                    (currentRect.bottom - scrollRect.bottom) +
                    (scrollRect.height - currentRect.height) / 2;
            }
        }

        currentElement.classList.add("pdf__rect--hl");
        setTimeout(() => {
            currentElement.classList.remove("pdf__rect--hl");
        }, 1500);
    }
};

const copyAnno = (idPath: string, fileName: string, pdf: any) => {
    const mode = rectElement.getAttribute("data-mode");
    const content = rectElement.getAttribute("data-content");
    setTimeout(() => {
        if (mode === "rect" ||
            (mode === "" && rectElement.childElementCount === 1 && content.startsWith(fileName)) // 兼容历史，以前没有 mode
        ) {
            getRectImgData(pdf).then((imageDataURL: string) => {
                fetch(imageDataURL).then((response) => {
                    return response.blob();
                }).then((blob) => {
                    const formData = new FormData();
                    const imageName = content + ".png";
                    formData.append("file[]", blob, imageName);
                    fetchPost(Constants.UPLOAD_ADDRESS, formData, (response) => {
                        writeText(`<<${idPath} "${content}">>
![](${response.data.succMap[imageName]})`);
                    });
                });
            });
        } else {
            writeText(`<<${idPath} "${content}">>`);
        }
    }, Constants.TIMEOUT_DBLCLICK);
};

const getCaptureCanvas = async (pdfObj: any, pageNumber: number) => {
    const pdfPage = await pdfObj.pdfDocument.getPage(pageNumber);
    const viewport = pdfPage.getViewport({scale: 1.5 * pdfObj.pdfViewer.currentScale * window.pdfjsLib.PixelsPerInch.PDF_TO_CSS_UNITS});
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await pdfPage.render({
        canvasContext: canvas.getContext("2d"),
        viewport: viewport
    }).promise;

    return canvas;
};

async function getRectImgData(pdfObj: any) {
    const pageElement = hasClosestByClassName(rectElement, "page");
    if (!pageElement) {
        return;
    }

    const captureCanvas = await getCaptureCanvas(pdfObj, parseInt(pageElement.getAttribute("data-page-number")));

    const rectStyle = (rectElement.firstElementChild as HTMLElement).style;
    const scale = 1.5;
    const captureImageData = captureCanvas.getContext("2d").getImageData(
        scale * parseFloat(rectStyle.left),
        scale * parseFloat(rectStyle.top),
        scale * parseFloat(rectStyle.width),
        scale * parseFloat(rectStyle.height));

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = captureImageData.width;
    tempCanvas.height = captureImageData.height;
    const ctx = tempCanvas.getContext("2d");
    ctx.putImageData(captureImageData, 0, 0);
    return tempCanvas.toDataURL();
}

const setConfig = (pdf: any, id: string, data: IPdfAnno) => {
    const urlPath = pdf.appConfig.file.replace(location.origin, "").substr(1);
    const config = getConfig(pdf);
    config[id] = data;
    fetchPost("/api/asset/setFileAnnotation", {
        path: urlPath + ".sya",
        data: JSON.stringify(config),
    });
};

const getConfig = (pdf: any) => {
    if (pdf.appConfig.config) {
        return pdf.appConfig.config;
    }
    const urlPath = pdf.appConfig.file.replace(location.origin, "").substr(1) + ".sya";
    fetchPost("/api/asset/getFileAnnotation", {
        path: urlPath,
    }, (response) => {
        let config = {};
        if (response.code !== 1) {
            config = JSON.parse(response.data.data);
        }
        pdf.appConfig.config = config;
    });
};
