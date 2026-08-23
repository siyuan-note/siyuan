<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>SiYuan</title>
    <meta name="viewport" content="width=device-width, height=device-height, interactive-widget=overlays-content, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
    <link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
</head>
<body class="fn__flex-column">
<div id="loading" class="b3-dialog b3-dialog--open">
    <div class="b3-dialog__scrim" style="background-color: #1e1e1e"></div>
    <img style="position: absolute;width: 24vh;" src="../../icon.svg">
</div>
<div class="mobile-safe-area"></div>
<div id="mobileTopBar" class="toolbar toolbar--border mobile-topbar">
    <input class="toolbar__title fn__hidden" id="toolbarName" autocomplete="off">
    <span class="toolbar__title toolbar__title--readonly fn__hidden fn__none" id="toolbarNameReadonly"></span>
    <button id="toolbarSync" class="toolbar__button toolbar__icon-deactivate fn__none" type="button">
        <svg><use xlink:href="#iconCloudSucc"></use></svg>
    </button>
</div>
<div id="editor" class="fn__none fn__flex-1"></div>
<div id="empty" class="b3-list--mobile"></div>
<div id="sidebar" class="side-panel fn__flex-column">
    <div class="toolbar toolbar--border" data-prevent-swipe style="-webkit-user-select: none">
        <div class="toolbar__scroll">
            <svg data-type="sidebar-file-tab" class="toolbar__icon toolbar__icon--active"><use xlink:href="#iconFiles"></use></svg>
            <svg data-type="sidebar-bookmark-tab" class="toolbar__icon"><use xlink:href="#iconBookmark"></use></svg>
            <svg data-type="sidebar-tag-tab" class="toolbar__icon"><use xlink:href="#iconTag"></use></svg>
            <svg data-type="sidebar-inbox-tab" class="toolbar__icon"><use xlink:href="#iconInbox"></use></svg>
            <svg data-menu="true" data-type="sidebar-plugin-tab" class="toolbar__icon fn__none"><use xlink:href="#iconPlugin"></use></svg>
        </div>
        <svg class="toolbar__icon"><use xlink:href="#iconRight"></use></svg>
    </div>
    <div class="fn__flex-1 b3-list--mobile">
        <div class="fn__flex-column" data-type="sidebar-file"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-bookmark"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-tag"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-inbox"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-plugin"></div>
    </div>
</div>
<div id="sidebarRight" class="side-panel side-panel--right fn__flex-column">
    <div class="toolbar toolbar--border" data-prevent-swipe style="-webkit-user-select: none">
        <div class="toolbar__scroll">
            <svg data-type="sidebar-outline-tab" class="toolbar__icon toolbar__icon--active"><use xlink:href="#iconOutline"></use></svg>
            <svg data-type="sidebar-backlink-tab" class="toolbar__icon"><use xlink:href="#iconLink"></use></svg>
        </div>
        <svg class="toolbar__icon"><use xlink:href="#iconLeft"></use></svg>
    </div>
    <div class="fn__flex-1 b3-list--mobile">
        <div class="fn__flex-column" data-type="sidebar-outline"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-backlink"></div>
    </div>
</div>
<div id="menu" class="b3-menu b3-menu--fullscreen fn__none"></div>
<div id="model" class="side-panel side-panel--all fn__flex-column">
    <div class="toolbar toolbar--border">
        <svg class="toolbar__icon"><use xlink:href="#iconMenu"></use></svg>
        <span class="toolbar__text"></span>
        <svg id="modelClose" class="toolbar__icon">
            <use xlink:href="#iconCloseRound"></use>
        </svg>
    </div>
    <div id="modelMain" class="fn__flex-1"></div>
</div>
<div id="commonMenuScrim" class="b3-menu__scrim fn__none" data-prevent-swipe aria-hidden="true"></div>
<div id="commonMenu" class="b3-menu fn__none">
    <div class="b3-menu__title fn__none">
        <svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
        <span class="b3-menu__label"></span>
    </div>
    <div class="b3-menu__items"></div>
</div>
<div id="message" class="b3-snackbars"></div>
<div id="tooltip" class="tooltip fn__none"></div>
<div id="status" class="status"></div>
<div id="mobileBottomBar" class="mobile-bottom-bar fn__none" role="group" aria-hidden="false" data-prevent-swipe>
    <button id="toolbarFile" class="mobile-bottom-bar__item" data-action="documents" type="button">
        <svg><use xlink:href="#iconFiles"></use></svg>
    </button>
    <button id="mobileBottomBarSearch" class="mobile-bottom-bar__item" data-action="search" type="button">
        <svg><use xlink:href="#iconSearch"></use></svg>
    </button>
    <button id="mobileBottomBarNewDoc" class="mobile-bottom-bar__item" data-action="newDoc" type="button">
        <svg><use xlink:href="#iconAddDoc"></use></svg>
    </button>
    <button id="toolbarTabs" class="mobile-bottom-bar__item" data-action="tabs" type="button">
        <span class="toolbar__tabs-count">0</span>
    </button>
    <button id="mobileBottomBarRecent" class="mobile-bottom-bar__item fn__none" data-action="recent" type="button">
        <svg><use xlink:href="#iconList"></use></svg>
    </button>
    <button id="mobileBottomBarOutline" class="mobile-bottom-bar__item fn__none" data-action="outline" type="button">
        <svg><use xlink:href="#iconOutline"></use></svg>
    </button>
    <button id="mobileBottomBarBookmark" class="mobile-bottom-bar__item fn__none" data-action="bookmark" type="button">
        <svg><use xlink:href="#iconBookmark"></use></svg>
    </button>
    <button id="mobileBottomBarTag" class="mobile-bottom-bar__item fn__none" data-action="tag" type="button">
        <svg><use xlink:href="#iconTag"></use></svg>
    </button>
    <button id="mobileBottomBarBacklink" class="mobile-bottom-bar__item fn__none" data-action="backlink" type="button">
        <svg><use xlink:href="#iconLink"></use></svg>
    </button>
    <button id="mobileBottomBarInbox" class="mobile-bottom-bar__item fn__none" data-action="inbox" type="button">
        <svg><use xlink:href="#iconInbox"></use></svg>
    </button>
    <button id="mobileBottomBarAgent" class="mobile-bottom-bar__item fn__none" data-action="agent" type="button">
        <svg><use xlink:href="#iconSparkles"></use></svg>
    </button>
    <button id="mobileBottomBarSpacedRepetition" class="mobile-bottom-bar__item fn__none" data-action="spacedRepetition" type="button">
        <svg><use xlink:href="#iconRiffCard"></use></svg>
    </button>
    <button id="mobileBottomBarCommand" class="mobile-bottom-bar__item fn__none" data-action="command" type="button">
        <svg><use xlink:href="#iconTerminal"></use></svg>
    </button>
    <button id="toolbarMore" class="mobile-bottom-bar__item" data-action="more" type="button">
        <svg><use xlink:href="#iconMore"></use></svg>
    </button>
</div>
<div id="keyboardToolbar" class="keyboard fn__none"></div>
<div class="side-mask fn__none"></div>
</body>
</html>
