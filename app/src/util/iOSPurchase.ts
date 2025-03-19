export const IOSPurchase = (data:string) => {
    /// #if MOBILE
    document.querySelector("#modelMain").dispatchEvent(new CustomEvent("click", {
        detail: document.querySelector("#modelMain #refresh")
    }));
    /// #else
    document.querySelector('.config__tab-container[data-name="account"] #refresh').dispatchEvent(new Event("click"));
    /// #endif
}
