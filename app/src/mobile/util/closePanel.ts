export const closePanel = () => {
    document.getElementById("menu").style.right = "-100vw";
    document.getElementById("sidebar").style.left = "-100vw";
    document.getElementById("model").style.top = "-200vh";
    const maskElement = document.querySelector(".side-mask") as HTMLElement;
    maskElement.classList.add("fn__none");
    maskElement.style.opacity = "";
    window.siyuan.menus.menu.remove();
};
