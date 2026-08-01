let modelDestroyCallback: (() => void) | undefined;
let modelBackCallback: (() => void) | undefined;

export const backModel = () => {
    if (!modelBackCallback) {
        return false;
    }
    const callback = modelBackCallback;
    modelBackCallback = undefined;
    callback();
    return true;
};

export const destroyModel = () => {
    modelDestroyCallback?.();
    modelDestroyCallback = undefined;
    modelBackCallback = undefined;
};

export const openModel = (obj: {
    html: string,
    icon?: string,
    title: string,
    bindEvent: (element: HTMLElement) => void,
    destroyCallback?: () => void,
    backCallback?: () => void,
}) => {
    destroyModel();
    const modelElement = document.getElementById("model");
    modelElement.style.transform = "translateY(0px)";
    modelElement.style.zIndex = (++window.siyuan.zIndex).toString();
    const iconElement = modelElement.querySelector(".toolbar__icon") as HTMLElement;
    if(obj.icon) {
        iconElement.classList.remove("fn__none");
        iconElement.querySelector("use").setAttribute("xlink:href", "#" + obj.icon);
    } else {
        iconElement.classList.add("fn__none");
    }
    iconElement.onclick = obj.backCallback ? backModel : null;
    modelElement.querySelector(".toolbar__text").innerHTML = obj.title;
    const modelMainElement = modelElement.querySelector("#modelMain") as HTMLElement;
    modelMainElement.innerHTML = obj.html;
    obj.bindEvent(modelMainElement);
    modelDestroyCallback = obj.destroyCallback;
    modelBackCallback = obj.backCallback;
};
