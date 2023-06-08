export const avRender = (element: Element) => {
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
        avElements.forEach((e: HTMLDivElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            const data = {
                title: "table",
                filter: {},
                sorts: {},
                columns: [{
                    width: 500,
                    icon: "",
                    id: "",
                    name: "columnA",
                    wrap: false,
                    type: "",
                }, {
                    width: 500,
                    icon: "",
                    id: "",
                    name: "columnB",
                    wrap: false,
                    type: "",
                }],
                rows: [{
                    id: "",
                    cells: [{
                        value: "a",
                    }, {
                        color: "var(--b3-card-error-color)",
                        bgColor: "var(--b3-card-error-background)",
                        value: "a1",
                    }]
                }, {
                    id: "",
                    cells: [{
                        color: "var(--b3-card-success-color)",
                        bgColor: "var(--b3-card-success-background)",
                        value: "b",
                    }, {
                        value: "b1",
                    }]
                }]
            };
            let tableHTML = "<div class='fn__flex'>";
            data.columns.forEach((column) => {
                tableHTML += `<div style="flex-shrink: 0;width: ${column.width}px;">${column.name}</div>`
            });
            tableHTML += "</div>";
            data.rows.forEach((row) => {
                tableHTML += "<div class='fn__flex'>";
                row.cells.forEach((cell, index) => {
                    tableHTML += `<div style="flex-shrink: 0;width: ${data.columns[index].width}px;background-color: ${cell.bgColor};color: ${cell.color}">${cell.value}</div>`
                });
                tableHTML += "</div>";
            });
            const paddingLeft = e.parentElement.style.paddingLeft;
            const paddingRight = e.parentElement.style.paddingRight;
            // 10: ::-webkit-scrollbar width
            e.style.width = (e.parentElement.clientWidth - 10) + "px";
            e.style.alignSelf = "center";
            e.firstElementChild.outerHTML = `<div>
    <div style="padding-left: ${paddingLeft};padding-right: ${paddingRight}">
        <div>
            <div>tab1</div>
        </div>
        <div contenteditable="true">
            ${data.title}
        </div>
    </div>
    <div class="av__scroll">
        <div style="padding-left: ${paddingLeft};padding-right: ${paddingRight};min-width: 100%;float: left;">
            ${tableHTML}
            <div>add</div>
        </div>
    </div>
</div>`;
            e.setAttribute("data-render", "true");
        });
    }
};
