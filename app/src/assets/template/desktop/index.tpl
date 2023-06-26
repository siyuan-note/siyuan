<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="apple-touch-icon" href="../../icon.png">
    <style id="editorFontSize" type="text/css"></style>
    <style id="editorAttr" type="text/css"></style>
</head>
<body class="fn__flex-column">
<div id="loading" class="b3-dialog b3-dialog--open">
    <div class="b3-dialog__scrim" style="background-color: #1e1e1e"></div>
    <img style="position: absolute;width: 36vh;" src="../../icon.png">
</div>
<div id="toolbar" class="toolbar fn__flex"></div>
<div class="fn__flex-1 fn__flex">
    <div id="dockLeft" class="dock dock--vertical"></div>
    <div id="layouts" class="layout fn__flex-1"></div>
    <div id="dockRight" class="dock dock--vertical"></div>
</div>
<div id="dockBottom" class="dock fn__none"></div>
<div id="status" class="fn__flex status"></div>
<div id="commonMenu" class="b3-menu fn__none">
    <div class="b3-menu__title fn__none">
        <svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
        <span class="b3-menu__label"></span>
    </div>
    <div class="b3-menu__items"></div>
</div>
<div id="message" class="b3-snackbars"></div>
</body>
</html>
