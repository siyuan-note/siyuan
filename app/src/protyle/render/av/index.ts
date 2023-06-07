
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
                filter:{},
                sorts: {},
                columns:[{
                    id:"",
                    name:"",
                    type:"",
                }],
                rows:[{
                    id:"",
                    cells:[{
                        value:"",
                    }]
                }]
            }
            e.setAttribute("data-render", "true");
        });
    }
}
