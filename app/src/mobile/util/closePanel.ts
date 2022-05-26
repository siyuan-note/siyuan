export const closePanel = () => {
    const menuElement = document.getElementById("menu");
    const sidebarElement = document.getElementById("sidebar");
    const scrimElement = document.querySelector(".scrim");
    const modelElement = document.getElementById("model");
    menuElement.style.right = "-100vw";
    sidebarElement.style.left = "-100vw";
    modelElement.style.top = "-100vh";
    scrimElement.classList.add("fn__none");
};
