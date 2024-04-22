export const openModel = (obj: {
    html: string,
    icon: string,
    title: string,
    bindEvent: (element: HTMLElement) => void
}) => {
    const modelElement = document.getElementById("model");
    modelElement.style.transform = "translateY(0px)";
    modelElement.style.zIndex = (++window.siyuan.zIndex).toString();
    modelElement.querySelector(".toolbar__icon use").setAttribute("xlink:href", "#" + obj.icon);
    modelElement.querySelector(".toolbar__text").innerHTML = obj.title;
    const modelMainElement = modelElement.querySelector("#modelMain") as HTMLElement;
    modelMainElement.innerHTML = obj.html;
    obj.bindEvent(modelMainElement);
};
