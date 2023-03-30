import {hasClosestByAttribute} from "../../protyle/util/hasClosest";
import {closePanel} from "./closePanel";
import {popMenu} from "../menu";

let clientX: number;
let clientY: number;
let xDiff: number;
let yDiff: number;
let time: number;

export const handleTouchEnd = (event: TouchEvent) => {
    if (window.siyuan.mobile.editor) {
        document.querySelectorAll(".protyle-breadcrumb__bar--hide").forEach(item => {
            item.classList.remove("protyle-breadcrumb__bar--hide");
        });
        window.siyuan.hideBreadcrumb = false;
    }

    if (!clientX || !clientY || xDiff === 0) {
        return;
    }

    const target = event.target as HTMLElement;
    let scrollElement = hasClosestByAttribute(target, "data-type", "NodeCodeBlock") || hasClosestByAttribute(target, "data-type", "NodeTable");
    if (scrollElement) {
        scrollElement = scrollElement.classList.contains("table") ? (scrollElement.firstElementChild as HTMLElement) : (scrollElement.firstElementChild.nextElementSibling as HTMLElement);
        if ((xDiff < 0 && scrollElement.scrollLeft > 0) ||
            (xDiff > 0 && scrollElement.clientWidth + scrollElement.scrollLeft < scrollElement.scrollWidth)) {
            return;
        }
    }

    let show = false;
    if (new Date().getTime() - time < 1000) {
        show = true;
    } else if (Math.abs(xDiff) > window.innerWidth / 3) {
        show = true;
    }
    const menuElement = hasClosestByAttribute(target, "id", "menu");
    if (show && menuElement && xDiff < 0) {
        closePanel();
        return;
    }
    const sideElement = hasClosestByAttribute(target, "id", "sidebar");
    if (show && sideElement && xDiff > 0) {
        closePanel();
        return;
    }
    if (!show) {
        closePanel();
        return;
    }
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        if (xDiff > 0) {
            popMenu();
        } else {
            document.getElementById("toolbarFile").dispatchEvent(new CustomEvent("click"));
        }
    }
};

export const handleTouchStart = (event: TouchEvent) => {
    xDiff = 0;
    yDiff = 0;
    if (navigator.userAgent.indexOf("iPhone") > -1 ||
        (event.touches[0].clientX > 8 && event.touches[0].clientX < window.innerWidth - 8)) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
        time = new Date().getTime();
    } else {
        clientX = null;
        clientY = null;
        time = 0;
        event.stopImmediatePropagation();
    }
};

export const handleTouchMove = (event: TouchEvent) => {
    if (!clientX || !clientY) {
        return;
    }
    xDiff = Math.floor(clientX - event.touches[0].clientX);
    yDiff = Math.floor(clientY - event.touches[0].clientY);

    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        const target = event.target as HTMLElement;
        let scrollElement = hasClosestByAttribute(target, "data-type", "NodeCodeBlock") || hasClosestByAttribute(target, "data-type", "NodeTable");
        if (scrollElement) {
            scrollElement = scrollElement.classList.contains("table") ? (scrollElement.firstElementChild as HTMLElement) : (scrollElement.firstElementChild.nextElementSibling as HTMLElement);
            if ((xDiff < 0 && scrollElement.scrollLeft > 0) ||
                (xDiff > 0 && scrollElement.clientWidth + scrollElement.scrollLeft < scrollElement.scrollWidth)) {
                return;
            }
        }
        const menuElement = hasClosestByAttribute(target, "id", "menu");
        if (menuElement && xDiff < 0) {
            menuElement.style.right = xDiff + "px";
            return;
        }
        const sideElement = hasClosestByAttribute(target, "id", "sidebar");
        if (sideElement && xDiff > 0) {
            sideElement.style.left = -xDiff + "px";
            return;
        }
        console.log(event);
        if (xDiff < 0) {
            document.getElementById("sidebar").style.left = -window.innerWidth - xDiff + "px";
        } else {
            document.getElementById("menu").style.right = -window.innerWidth + xDiff + "px";
        }
    }
};
