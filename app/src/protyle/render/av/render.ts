import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {showHeaderCellMenu} from "./cell";

export const avRender = (element: Element, cb?: () => void) => {
    let avElements: Element[] = [];
    if (element.getAttribute("data-type") === "NodeAttributeView") {
        // 编辑器内代码块编辑渲染
        avElements = [element];
    } else {
        avElements = Array.from(element.querySelectorAll('[data-type="NodeAttributeView"]'));
    }
    if (avElements.length === 0) {
        return;
    }
    if (avElements.length > 0) {
        avElements.forEach((e: HTMLElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            fetchPost("/api/av/renderAttributeView", {id: e.getAttribute("data-av-id")}, (response) => {
                const data = response.data.av;
                // header
                let tableHTML = '<div class="av__row av__row--header"><div class="av__firstcol"><svg style="height: 42px"><use xlink:href="#iconUncheck"></use></svg></div>';
                let index = 0;
                data.columns.forEach((column: IAVColumn) => {
                    if (column.hidden) {
                        return;
                    }
                    tableHTML += `<div class="av__cell" data-index="${index}" data-id="${column.id}" data-dtype="${column.type}" data-wrap="${column.wrap}" style="width: ${column.width || 200}px;">
    <svg><use xlink:href="#${column.icon || getColIconByType(column.type)}"></use></svg>
    <span>${column.name}</span>
</div>`;
                    index++;
                });
                tableHTML += `<div class="block__icons">
    <div class="block__icon block__icon--show" data-type="av-header-add"><svg><use xlink:href="#iconAdd"></use></svg></div>
    <div class="fn__space"></div>
    <div class="block__icon block__icon--show"  data-type="av-header-more"><svg><use xlink:href="#iconMore"></use></svg></div>
</div>
</div>`;

                // body
                data.rows.forEach((row: IAVRow) => {
                    tableHTML += `<div class="av__row" data-id="${row.id}">
<div class="av__gutters">
    <button><svg><use xlink:href="#iconLine"></use></svg></button>
</div>
<div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>`;
                    row.cells.forEach((cell, index) => {
                        tableHTML += `<div class="av__cell" data-index="${index}" style="width: ${data.columns[index].width || 200}px;${cell.bgColor ? `background-color:${cell.bgColor};` : ""}${cell.color ? `color:${cell.color};` : ""}">${cell.renderValue?.content || ""}</div>`;
                    });
                    tableHTML += "<div></div></div>";
                });
                const paddingLeft = e.parentElement.style.paddingLeft;
                const paddingRight = e.parentElement.style.paddingRight;
                e.style.width = e.parentElement.clientWidth + "px";
                e.style.alignSelf = "center";
                e.firstElementChild.outerHTML = `<div>
    <div style="padding-left: ${paddingLeft};padding-right: ${paddingRight};">
        <div>
            <div>tab1</div>
        </div>
        <div contenteditable="true">
            ${data.title}
        </div>
    </div>
    <div class="av__scroll">
        <div style="padding-left: ${paddingLeft};padding-right: ${paddingRight};float: left;">
            ${tableHTML}
            <div class="block__icon block__icon--show">
                <div class="fn__space"></div>
                <svg><use xlink:href="#iconAdd"></use></svg><span class="fn__space"></span>
                ${window.siyuan.languages.addAttr}
            </div>
            <div class="av__row--footer">Calculate</div>
        </div>
    </div>
</div>`;
                e.setAttribute("data-render", "true");
                if (cb) {
                    cb();
                }
            });
        });
    }
};

export const refreshAV = (protyle: IProtyle, operation: IOperation) => {
    if (operation.action === "addAttrViewCol") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.parentID}"]`)).forEach((item: HTMLElement) => {
            item.removeAttribute("data-render");
            avRender(item, () => {
                showHeaderCellMenu(protyle, item, item.querySelector(".av__row--header").lastElementChild.previousElementSibling as HTMLElement);
            });
        });
    } else if (operation.action === "insertAttrViewBlock") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach((item: HTMLElement) => {
            item.removeAttribute("data-render");
            avRender(item);
        });
    }
};
