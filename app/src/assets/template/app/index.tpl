<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <!-- https://electronjs.org/docs/tutorial/security#csp-meta-tag
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'"/>-->
    <style id="editorFontSize" type="text/css"></style>
</head>
<body class="fn__flex-column">
<div id="loading" class="b3-dialog b3-dialog--open">
    <div class="b3-dialog__scrim" style="background-color: #212224"></div>
    <img style="position: absolute;width: 36vh;" src="../../icon.png">
    <button onclick="window.location.reload()" id="loadingRefresh" style="display: none;position: absolute;bottom: 16px;background: transparent;border: 1px solid #4285f4;color: #4285f4;border-radius: 4px;line-height: 20px;padding: 4px 8px;">Refresh</button>
</div>
<div id="toolbar" class="toolbar fn__flex"></div>
<div id="dockTop" class="dock"></div>
<div class="fn__flex-1 fn__flex">
    <div id="dockLeft" class="dock dock--vertical"></div>
    <div id="layouts" class="layout fn__flex-1"></div>
    <div id="dockRight" class="dock dock--vertical"></div>
</div>
<div id="dockBottom" class="dock"></div>
<div id="commonMenu" class="b3-menu fn__none"></div>
<div id="dragBg" style="z-index:199;pointer-events: none;" class="b3-dialog__scrim fn__none"></div>
<div id="message" class="b3-snackbars"></div>
<script>
  setTimeout(() => {
    const refreshElement = document.getElementById("loadingRefresh")
    if (refreshElement) {
      refreshElement.style.display = ""
    }
  }, 2000)
</script>
</body>
</html>
