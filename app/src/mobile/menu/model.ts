export const openModel = (obj: {
    html: string,
    icon?: string,
    title: string,
    bindEvent: (element: HTMLElement) => void
}) => {
    const modelElement = document.getElementById("model");
    modelElement.style.transform = "translateY(0px)";
    modelElement.style.zIndex = (++window.siyuan.zIndex).toString();
    const iconElement  = modelElement.querySelector(".toolbar__icon");
    if(obj.icon) {
        iconElement.classList.remove("fn__none");
        iconElement.querySelector("use").setAttribute("xlink:href", "#" + obj.icon);
    } else {
        iconElement.classList.add("fn__none");
    }
    modelElement.querySelector(".toolbar__text").innerHTML = obj.title;
    const modelMainElement = modelElement.querySelector("#modelMain") as HTMLElement;
    modelMainElement.innerHTML = obj.html;
    obj.bindEvent(modelMainElement);
};
