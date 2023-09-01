/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  animationStarted,
  apiPageLayoutToViewerModes,
  apiPageModeToSidebarView,
  AutoPrintRegExp,
  CursorTool,
  DEFAULT_SCALE_VALUE,
  getActiveOrFocusedElement,
  isValidRotation,
  isValidScrollMode,
  isValidSpreadMode,
  normalizeWheelEventDirection,
  parseQueryString,
  ProgressBar,
  RendererType,
  RenderingStates,
  ScrollMode,
  SidebarView,
  SpreadMode,
  TextLayerMode,
} from "./ui_utils.js";
import {
  AnnotationEditorType,
  build,
  createPromiseCapability,
  FeatureTest,
  getDocument,
  getFilenameFromUrl,
  getPdfFilenameFromUrl,
  GlobalWorkerOptions,
  InvalidPDFException,
  isDataScheme,
  isPdfFile,
  loadScript,
  MissingPDFException,
  OPS,
  PDFWorker,
  shadow,
  UnexpectedResponseException,
  version,
} from "./pdfjs";
import { AppOptions, OptionKind } from "./app_options.js";
import { AutomationEventBus, EventBus } from "./event_utils.js";
import { LinkTarget, PDFLinkService } from "./pdf_link_service.js";
import { AnnotationEditorParams } from "./annotation_editor_params";
import { OverlayManager } from "./overlay_manager.js";
import { PasswordPrompt } from "./password_prompt.js";
import { PDFAttachmentViewer } from "./pdf_attachment_viewer";
import { PDFCursorTools } from "./pdf_cursor_tools";
import { PDFDocumentProperties } from "./pdf_document_properties";
import { PDFFindBar } from "./pdf_find_bar";
import { PDFFindController } from "./pdf_find_controller.js";
import { PDFHistory } from "./pdf_history.js";
import { PDFLayerViewer } from "./pdf_layer_viewer";
import { PDFOutlineViewer } from "./pdf_outline_viewer";
import { PDFPresentationMode } from "./pdf_presentation_mode";
import { PDFRenderingQueue } from "./pdf_rendering_queue.js";
import { PDFScriptingManager } from "./pdf_scripting_manager.js";
import { PDFSidebar } from "./pdf_sidebar";
import { PDFSidebarResizer } from "./pdf_sidebar_resizer";
import { PDFThumbnailViewer } from "./pdf_thumbnail_viewer";
import { PDFViewer } from "./pdf_viewer.js";
import { SecondaryToolbar } from "./secondary_toolbar.js";
import { Toolbar } from "./toolbar.js";
import { ViewHistory } from "./view_history.js";
import { DefaultExternalServices } from './genericcom'
import { getPdfInstance, hlPDFRect } from '../anno'
import {hasClosestByClassName} from "../../protyle/util/hasClosest";

const FORCE_PAGES_LOADED_TIMEOUT = 10000; // ms
const WHEEL_ZOOM_DISABLED_TIMEOUT = 1000; // ms

const ViewOnLoad = {
  UNKNOWN: -1,
  PREVIOUS: 0, // Default value.
  INITIAL: 1,
};

const ViewerCssTheme = {
  AUTOMATIC: 0, // Default value.
  LIGHT: 1,
  DARK: 2,
};

// NOTE
class PDFViewerApplication {
  constructor (pdfId) {
    this.pdfId = pdfId
    this.initialBookmark = document.location.hash.substring(1)
    this._initializedCapability = createPromiseCapability()
    this.appConfig = null
    this.pdfDocument = null
    this.pdfLoadingTask = null
    this.printService = null
    /** @type {PDFViewer} */
    this.pdfViewer = null
    /** @type {PDFThumbnailViewer} */
    this.pdfThumbnailViewer = null
    /** @type {PDFRenderingQueue} */
    this.pdfRenderingQueue = null
    /** @type {PDFPresentationMode} */
    this.pdfPresentationMode = null
    /** @type {PDFDocumentProperties} */
    this.pdfDocumentProperties = null
    /** @type {PDFLinkService} */
    this.pdfLinkService = null
    /** @type {PDFHistory} */
    this.pdfHistory = null
    /** @type {PDFSidebar} */
    this.pdfSidebar = null
    /** @type {PDFSidebarResizer} */
    this.pdfSidebarResizer = null
    /** @type {PDFOutlineViewer} */
    this.pdfOutlineViewer = null
    /** @type {PDFAttachmentViewer} */
    this.pdfAttachmentViewer = null
    /** @type {PDFLayerViewer} */
    this.pdfLayerViewer = null
    /** @type {PDFCursorTools} */
    this.pdfCursorTools = null
    /** @type {PDFScriptingManager} */
    this.pdfScriptingManager = null
    /** @type {ViewHistory} */
    this.store = null
    /** @type {DownloadManager} */
    this.downloadManager = null
    /** @type {OverlayManager} */
    this.overlayManager = null
    /** @type {Preferences} */
    this.preferences = null
    /** @type {Toolbar} */
    this.toolbar = null
    /** @type {SecondaryToolbar} */
    this.secondaryToolbar = null
    /** @type {EventBus} */
    this.eventBus = null
    /** @type {IL10n} */
    this.l10n = null
    /** @type {AnnotationEditorParams} */
    this.annotationEditorParams = null
    this.isInitialViewSet = false
    this.downloadComplete = false
    // NOTE 不使用 initialBookmark
    this.isViewerEmbedded = true
    this.url = ""
    this.baseUrl = ""
    this._downloadUrl = ""
    this.externalServices = DefaultExternalServices
    this._boundEvents = Object.create(null)
    this.documentInfo = null
    this.metadata = null
    this._contentDispositionFilename = null
    this._contentLength = null
    this._saveInProgress = false
    this._wheelUnusedTicks = 0
    this._wheelUnusedFactor = 1
    this._touchUnusedTicks = 0
    this._touchUnusedFactor = 1
    this._PDFBug = null
    this._hasAnnotationEditors = false
    this._title = document.title
    this._printAnnotationStoragePromise = null
    this._touchInfo = null
    this._isCtrlKeyDown = false
  }
  // Called once when the document is loaded.
  async initialize(appConfig) {
    this.preferences = this.externalServices.createPreferences();
    this.appConfig = appConfig;

    await this._initializeOptions();
    this._forceCssTheme();
    // NOTE await this._initializeL10n();
    // https://github.com/siyuan-note/siyuan/issues/8997
    AppOptions.set("ignoreDestinationZoom", true);

    if (
      this.isViewerEmbedded &&
      AppOptions.get("externalLinkTarget") === LinkTarget.NONE
    ) {
      // Prevent external links from "replacing" the viewer,
      // when it's embedded in e.g. an <iframe> or an <object>.
      AppOptions.set("externalLinkTarget", LinkTarget.TOP);
    }
    await this._initializeViewerComponents();

    // Bind the various event handlers *after* the viewer has been
    // initialized, to prevent errors if an event arrives too soon.
    this.bindEvents();
    this.bindWindowEvents();

    // We can start UI localization now.
    const appContainer = appConfig.appContainer || document.documentElement;
    // NOTE
    this.eventBus.dispatch('localized', {source: this})

    this._initializedCapability.resolve();
  }

  /**
   * @private
   */
  async _initializeOptions() {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      if (AppOptions.get("disablePreferences")) {
        if (AppOptions.get("pdfBugEnabled")) {
          await this._parseHashParams();
        }
        // Give custom implementations of the default viewer a simpler way to
        // opt-out of having the `Preferences` override existing `AppOptions`.
        return;
      }
      if (AppOptions._hasUserOptions()) {
        console.warn(
          "_initializeOptions: The Preferences may override manually set AppOptions; " +
            'please use the "disablePreferences"-option in order to prevent that.'
        );
      }
    }
    try {
      AppOptions.setAll(await this.preferences.getAll());
    } catch (reason) {
      console.error(`_initializeOptions: "${reason.message}".`);
    }

    if (AppOptions.get("pdfBugEnabled")) {
      await this._parseHashParams();
    }
  }

  /**
   * Potentially parse special debugging flags in the hash section of the URL.
   * @private
   */
  async _parseHashParams() {
    const hash = document.location.hash.substring(1);
    if (!hash) {
      return;
    }
    const { mainContainer, viewerContainer } = this.appConfig,
      params = parseQueryString(hash);

    if (
      (typeof PDFJSDev === "undefined" || !PDFJSDev.test("PRODUCTION")) &&
      params.get("workermodules") === "true"
    ) {
      AppOptions.set("workerSrc", "../src/pdf.worker.js");
    } else if (params.get("disableworker") === "true") {
      try {
        await loadFakeWorker();
      } catch (ex) {
        console.error(`_parseHashParams: "${ex.message}".`);
      }
    }
    if (params.has("disablerange")) {
      AppOptions.set("disableRange", params.get("disablerange") === "true");
    }
    if (params.has("disablestream")) {
      AppOptions.set("disableStream", params.get("disablestream") === "true");
    }
    if (params.has("disableautofetch")) {
      AppOptions.set(
        "disableAutoFetch",
        params.get("disableautofetch") === "true"
      );
    }
    if (params.has("disablefontface")) {
      AppOptions.set(
        "disableFontFace",
        params.get("disablefontface") === "true"
      );
    }
    if (params.has("disablehistory")) {
      AppOptions.set("disableHistory", params.get("disablehistory") === "true");
    }
    if (params.has("verbosity")) {
      AppOptions.set("verbosity", params.get("verbosity") | 0);
    }
    if (params.has("textlayer")) {
      switch (params.get("textlayer")) {
        case "off":
          AppOptions.set("textLayerMode", TextLayerMode.DISABLE);
          break;
        case "visible":
        case "shadow":
        case "hover":
          viewerContainer.classList.add(`textLayer-${params.get("textlayer")}`);
          try {
            await loadPDFBug(this);
            this._PDFBug.loadCSS();
          } catch (ex) {
            console.error(`_parseHashParams: "${ex.message}".`);
          }
          break;
      }
    }
    if (params.has("pdfbug")) {
      AppOptions.set("pdfBug", true);
      AppOptions.set("fontExtraProperties", true);

      const enabled = params.get("pdfbug").split(",");
      try {
        await loadPDFBug(this);
        this._PDFBug.init({ OPS }, mainContainer, enabled);
      } catch (ex) {
        console.error(`_parseHashParams: "${ex.message}".`);
      }
    }
    // It is not possible to change locale for the (various) extension builds.
    if (
      (typeof PDFJSDev === "undefined" ||
        PDFJSDev.test("!PRODUCTION || GENERIC")) &&
      params.has("locale")
    ) {
      AppOptions.set("locale", params.get("locale"));
    }
  }

  /**
   * @private
   */
  async _initializeL10n() {
    this.l10n = this.externalServices.createL10n(
      typeof PDFJSDev === "undefined" || PDFJSDev.test("!PRODUCTION || GENERIC")
        ? { locale: AppOptions.get("locale") }
        : null
    );
    const dir = await this.l10n.getDirection();
    document.getElementsByTagName("html")[0].dir = dir;
  }

  /**
   * @private
   */
  _forceCssTheme() {
    const cssTheme = AppOptions.get("viewerCssTheme");
    if (
      cssTheme === ViewerCssTheme.AUTOMATIC ||
      !Object.values(ViewerCssTheme).includes(cssTheme)
    ) {
      return;
    }
    try {
      const styleSheet = document.styleSheets[0];
      const cssRules = styleSheet?.cssRules || [];
      for (let i = 0, ii = cssRules.length; i < ii; i++) {
        const rule = cssRules[i];
        if (
          rule instanceof CSSMediaRule &&
          rule.media?.[0] === "(prefers-color-scheme: dark)"
        ) {
          if (cssTheme === ViewerCssTheme.LIGHT) {
            styleSheet.deleteRule(i);
            return;
          }
          // cssTheme === ViewerCssTheme.DARK
          const darkRules =
            /^@media \(prefers-color-scheme: dark\) {\n\s*([\w\s-.,:;/\\{}()]+)\n}$/.exec(
              rule.cssText
            );
          if (darkRules?.[1]) {
            styleSheet.deleteRule(i);
            styleSheet.insertRule(darkRules[1], i);
          }
          return;
        }
      }
    } catch (reason) {
      console.error(`_forceCssTheme: "${reason?.message}".`);
    }
  }

  /**
   * @private
   */
  async _initializeViewerComponents() {
    const { appConfig, externalServices } = this;

    const eventBus = externalServices.isInAutomation
      ? new AutomationEventBus()
      : new EventBus();
    this.eventBus = eventBus;

    this.overlayManager = new OverlayManager();

    const pdfRenderingQueue = new PDFRenderingQueue();
    pdfRenderingQueue.onIdle = this._cleanup.bind(this);
    this.pdfRenderingQueue = pdfRenderingQueue;

    const pdfLinkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: AppOptions.get("externalLinkTarget"),
      externalLinkRel: AppOptions.get("externalLinkRel"),
      ignoreDestinationZoom: AppOptions.get("ignoreDestinationZoom"),
    });
    this.pdfLinkService = pdfLinkService;

    const downloadManager = externalServices.createDownloadManager();
    this.downloadManager = downloadManager;

    const findController = new PDFFindController({
      linkService: pdfLinkService,
      eventBus,
      updateMatchesCountOnProgress:
        typeof PDFJSDev === "undefined"
          ? !window.isGECKOVIEW
          : !PDFJSDev.test("GECKOVIEW"),
    });
    this.findController = findController;

    const pdfScriptingManager = new PDFScriptingManager({
      eventBus,
      sandboxBundleSrc:
        typeof PDFJSDev === "undefined" ||
        PDFJSDev.test("!PRODUCTION || GENERIC || CHROME")
          ? AppOptions.get("sandboxBundleSrc")
          : null,
      scriptingFactory: externalServices,
      docPropertiesLookup: this._scriptingDocProperties.bind(this),
    });
    this.pdfScriptingManager = pdfScriptingManager;

    const container = appConfig.mainContainer,
      viewer = appConfig.viewerContainer;
    const annotationEditorMode = AppOptions.get("annotationEditorMode");
    const pageColors =
      AppOptions.get("forcePageColors") ||
      window.matchMedia("(forced-colors: active)").matches
        ? {
            background: AppOptions.get("pageColorsBackground"),
            foreground: AppOptions.get("pageColorsForeground"),
          }
        : null;

    this.pdfViewer = new PDFViewer({
      container,
      viewer,
      eventBus,
      renderingQueue: pdfRenderingQueue,
      linkService: pdfLinkService,
      downloadManager,
      findController,
      scriptingManager:
        AppOptions.get("enableScripting") && pdfScriptingManager,
      renderer:
        typeof PDFJSDev === "undefined" ||
        PDFJSDev.test("!PRODUCTION || GENERIC")
          ? AppOptions.get("renderer")
          : null,
      l10n: this.l10n,
      textLayerMode: AppOptions.get("textLayerMode"),
      annotationMode: AppOptions.get("annotationMode"),
      annotationEditorMode,
      imageResourcesPath: AppOptions.get("imageResourcesPath"),
      enablePrintAutoRotate: AppOptions.get("enablePrintAutoRotate"),
      useOnlyCssZoom: AppOptions.get("useOnlyCssZoom"),
      isOffscreenCanvasSupported: AppOptions.get("isOffscreenCanvasSupported"),
      maxCanvasPixels: AppOptions.get("maxCanvasPixels"),
      enablePermissions: AppOptions.get("enablePermissions"),
      pageColors,
    });
    pdfRenderingQueue.setViewer(this.pdfViewer);
    pdfLinkService.setViewer(this.pdfViewer);
    pdfScriptingManager.setViewer(this.pdfViewer);

    if (appConfig.sidebar?.thumbnailView) {
      this.pdfThumbnailViewer = new PDFThumbnailViewer({
        container: appConfig.sidebar.thumbnailView,
        renderingQueue: pdfRenderingQueue,
        linkService: pdfLinkService,
        l10n: this.l10n,
        pageColors,
      });
      pdfRenderingQueue.setThumbnailViewer(this.pdfThumbnailViewer);
    }

    // The browsing history is only enabled when the viewer is standalone,
    // i.e. not when it is embedded in a web page.
    if (!this.isViewerEmbedded && !AppOptions.get("disableHistory")) {
      this.pdfHistory = new PDFHistory({
        linkService: pdfLinkService,
        eventBus,
      });
      pdfLinkService.setHistory(this.pdfHistory);
    }

    if (!this.supportsIntegratedFind && appConfig.findBar) {
      this.findBar = new PDFFindBar(appConfig.findBar, eventBus, this.l10n);
    }

    if (appConfig.annotationEditorParams) {
      if (annotationEditorMode !== AnnotationEditorType.DISABLE) {
        this.annotationEditorParams = new AnnotationEditorParams(
          appConfig.annotationEditorParams,
          eventBus
        );
      } else {
        for (const id of ["editorModeButtons", "editorModeSeparator"]) {
          document.getElementById(id)?.classList.add("hidden");
        }
      }
    }

    if (appConfig.documentProperties) {
      this.pdfDocumentProperties = new PDFDocumentProperties(
        appConfig.documentProperties,
        this.overlayManager,
        eventBus,
        this.l10n,
        /* fileNameLookup = */ () => {
          return this._docFilename;
        }
      );
    }

    // NOTE: The cursor-tools are unlikely to be helpful/useful in GeckoView,
    // in particular the `HandTool` which basically simulates touch scrolling.
    if (appConfig.secondaryToolbar?.cursorHandToolButton) {
      this.pdfCursorTools = new PDFCursorTools({
        container,
        eventBus,
        cursorToolOnLoad: AppOptions.get("cursorToolOnLoad"),
      });
    }

    if (appConfig.toolbar) {
      this.toolbar = new Toolbar(appConfig.toolbar, eventBus, this.l10n);
    }

    if (appConfig.secondaryToolbar) {
      this.secondaryToolbar = new SecondaryToolbar(
        appConfig.secondaryToolbar,
        eventBus,
        this.externalServices
      );
    }

    if (
      this.supportsFullscreen &&
      appConfig.secondaryToolbar?.presentationModeButton
    ) {
      this.pdfPresentationMode = new PDFPresentationMode({
        container,
        pdfViewer: this.pdfViewer,
        eventBus,
      });
    }

    if (appConfig.passwordOverlay) {
      this.passwordPrompt = new PasswordPrompt(
        appConfig.passwordOverlay,
        this.overlayManager,
        this.l10n,
        this.isViewerEmbedded
      );
    }

    if (appConfig.sidebar?.outlineView) {
      this.pdfOutlineViewer = new PDFOutlineViewer({
        container: appConfig.sidebar.outlineView,
        eventBus,
        linkService: pdfLinkService,
        downloadManager,
      });
    }

    if (appConfig.sidebar?.attachmentsView) {
      this.pdfAttachmentViewer = new PDFAttachmentViewer({
        container: appConfig.sidebar.attachmentsView,
        eventBus,
        downloadManager,
      });
    }

    if (appConfig.sidebar?.layersView) {
      this.pdfLayerViewer = new PDFLayerViewer({
        container: appConfig.sidebar.layersView,
        eventBus,
        l10n: this.l10n,
      });
    }

    if (appConfig.sidebar) {
      this.pdfSidebar = new PDFSidebar({
        elements: appConfig.sidebar,
        pdfViewer: this.pdfViewer,
        pdfThumbnailViewer: this.pdfThumbnailViewer,
        eventBus,
        l10n: this.l10n,
      });
      this.pdfSidebar.onToggled = this.forceRendering.bind(this);

      this.pdfSidebarResizer = new PDFSidebarResizer(
        appConfig.sidebarResizer,
        eventBus,
        this.l10n
      );
    }
  }

  run(config) {
    // NOTE
    this.initialize(config).then(webViewerInitialized(this));
  }

  get initialized() {
    return this._initializedCapability.settled;
  }

  get initializedPromise() {
    return this._initializedCapability.promise;
  }

  zoomIn(steps, scaleFactor) {
    if (this.pdfViewer.isInPresentationMode) {
      return;
    }
    this.pdfViewer.increaseScale({
      drawingDelay: AppOptions.get("defaultZoomDelay"),
      steps,
      scaleFactor,
    });
  }

  zoomOut(steps, scaleFactor) {
    if (this.pdfViewer.isInPresentationMode) {
      return;
    }
    this.pdfViewer.decreaseScale({
      drawingDelay: AppOptions.get("defaultZoomDelay"),
      steps,
      scaleFactor,
    });
  }

  zoomReset() {
    if (this.pdfViewer.isInPresentationMode) {
      return;
    }
    this.pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE;
  }

  get pagesCount() {
    return this.pdfDocument ? this.pdfDocument.numPages : 0;
  }

  get page() {
    return this.pdfViewer.currentPageNumber;
  }

  set page(val) {
    this.pdfViewer.currentPageNumber = val;
  }

  get supportsPrinting() {
    return PDFPrintServiceFactory.instance.supportsPrinting;
  }

  get supportsFullscreen() {
    return shadow(this, "supportsFullscreen", document.fullscreenEnabled);
  }

  get supportsPinchToZoom() {
    return this.externalServices.supportsPinchToZoom;
  }

  get supportsIntegratedFind() {
    return this.externalServices.supportsIntegratedFind;
  }

  get supportsDocumentFonts() {
    return this.externalServices.supportsDocumentFonts;
  }

  get loadingBar() {
    // NOTE
    const bar = new ProgressBar(this.appConfig.appContainer.querySelector("#loadingBar"))
    return shadow(this, "loadingBar", bar);
  }

  get supportedMouseWheelZoomModifierKeys() {
    return this.externalServices.supportedMouseWheelZoomModifierKeys;
  }

  initPassiveLoading() {
    if (
      typeof PDFJSDev === "undefined" ||
      !PDFJSDev.test("MOZCENTRAL || CHROME")
    ) {
      throw new Error("Not implemented: initPassiveLoading");
    }
    this.externalServices.initPassiveLoading({
      onOpenWithTransport: range => {
        this.open({ range });
      },
      onOpenWithData: (data, contentDispositionFilename) => {
        if (isPdfFile(contentDispositionFilename)) {
          this._contentDispositionFilename = contentDispositionFilename;
        }
        this.open({ data });
      },
      onOpenWithURL: (url, length, originalUrl) => {
        this.open({ url, length, originalUrl });
      },
      onError: err => {
        this.l10n.get("loading_error").then(msg => {
          this._documentError(msg, err);
        });
      },
      onProgress: (loaded, total) => {
        this.progress(loaded / total);
      },
    });
  }

  setTitleUsingUrl(url = "", downloadUrl = null) {
    this.url = url;
    this.baseUrl = url.split("#")[0];
    if (downloadUrl) {
      this._downloadUrl =
        downloadUrl === url ? this.baseUrl : downloadUrl.split("#")[0];
    }
    if (isDataScheme(url)) {
      this._hideViewBookmark();
    }
    let title = getPdfFilenameFromUrl(url, "");
    if (!title) {
      try {
        title = decodeURIComponent(getFilenameFromUrl(url)) || url;
      } catch (ex) {
        // decodeURIComponent may throw URIError,
        // fall back to using the unprocessed url in that case
        title = url;
      }
    }
    this.setTitle(title);
  }

  setTitle(title = this._title) {
    this._title = title;

    if (this.isViewerEmbedded) {
      // Embedded PDF viewers should not be changing their parent page's title.
      return;
    }
    const editorIndicator =
      this._hasAnnotationEditors && !this.pdfRenderingQueue.printing;
    document.title = `${editorIndicator ? "* " : ""}${title}`;
  }

  get _docFilename() {
    // Use `this.url` instead of `this.baseUrl` to perform filename detection
    // based on the reference fragment as ultimate fallback if needed.
    return this._contentDispositionFilename || getPdfFilenameFromUrl(this.url);
  }

  /**
   * @private
   */
  _hideViewBookmark() {
    const { secondaryToolbar } = this.appConfig;
    // URL does not reflect proper document location - hiding some buttons.
    // NOTE
    secondaryToolbar?.viewBookmarkButton.classList.add("fn__hidden");

    // Avoid displaying multiple consecutive separators in the secondaryToolbar.
    if (secondaryToolbar?.presentationModeButton.classList.contains("fn__hidden")) {
      document.getElementById("viewBookmarkSeparator")?.classList.add("fn__hidden");
    }
  }

  /**
   * Closes opened PDF document.
   * @returns {Promise} - Returns the promise, which is resolved when all
   *                      destruction is completed.
   */
  async close() {
    this._unblockDocumentLoadEvent();
    this._hideViewBookmark();

    if (!this.pdfLoadingTask) {
      return;
    }
    if (
      (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) &&
      this.pdfDocument?.annotationStorage.size > 0 &&
      this._annotationStorageModified
    ) {
      try {
        // Trigger saving, to prevent data loss in forms; see issue 12257.
        await this.save();
      } catch (reason) {
        // Ignoring errors, to ensure that document closing won't break.
      }
    }
    const promises = [];

    promises.push(this.pdfLoadingTask.destroy());
    this.pdfLoadingTask = null;

    if (this.pdfDocument) {
      this.pdfDocument = null;

      this.pdfThumbnailViewer?.setDocument(null);
      this.pdfViewer.setDocument(null);
      this.pdfLinkService.setDocument(null);
      this.pdfDocumentProperties?.setDocument(null);
    }
    this.pdfLinkService.externalLinkEnabled = true;
    this.store = null;
    this.isInitialViewSet = false;
    this.downloadComplete = false;
    this.url = "";
    this.baseUrl = "";
    this._downloadUrl = "";
    this.documentInfo = null;
    this.metadata = null;
    this._contentDispositionFilename = null;
    this._contentLength = null;
    this._saveInProgress = false;
    this._hasAnnotationEditors = false;

    promises.push(this.pdfScriptingManager.destroyPromise);

    this.setTitle();
    this.pdfSidebar?.reset();
    this.pdfOutlineViewer?.reset();
    this.pdfAttachmentViewer?.reset();
    this.pdfLayerViewer?.reset();

    this.pdfHistory?.reset();
    this.findBar?.reset();
    this.toolbar?.reset();
    this.secondaryToolbar?.reset();
    this._PDFBug?.cleanup();

    await Promise.all(promises);
  }

  /**
   * Opens a new PDF document.
   * @param {Object} args - Accepts any/all of the properties from
   *   {@link DocumentInitParameters}, and also a `originalUrl` string.
   * @returns {Promise} - Promise that is resolved when the document is opened.
   */
  async open(args) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      let deprecatedArgs = false;
      if (typeof args === "string") {
        args = { url: args }; // URL
        deprecatedArgs = true;
      } else if (args?.byteLength) {
        args = { data: args }; // ArrayBuffer
        deprecatedArgs = true;
      }
      if (deprecatedArgs) {
        console.error(
          "The `PDFViewerApplication.open` signature was updated, please use an object instead."
        );
      }
    }

    if (this.pdfLoadingTask) {
      // We need to destroy already opened document.
      await this.close();
    }
    // Set the necessary global worker parameters, using the available options.
    const workerParams = AppOptions.getAll(OptionKind.WORKER);
    Object.assign(GlobalWorkerOptions, workerParams);

    if (
      (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) &&
      args.url
    ) {
      // The Firefox built-in viewer always calls `setTitleUsingUrl`, before
      // `initPassiveLoading`, and it never provides an `originalUrl` here.
      this.setTitleUsingUrl(
        args.originalUrl || args.url,
        /* downloadUrl = */ args.url
      );
    }
    // Set the necessary API parameters, using all the available options.
    const apiParams = AppOptions.getAll(OptionKind.API);
    const params = {
      canvasMaxAreaInBytes: this.externalServices.canvasMaxAreaInBytes,
      ...apiParams,
      ...args,
    };

    if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("PRODUCTION")) {
      // NOTE https://github.com/siyuan-note/siyuan/issues/8103
      // params.docBaseUrl ||= document.URL.split("#")[0];
    } else if (PDFJSDev.test("MOZCENTRAL || CHROME")) {
      params.docBaseUrl ||= this.baseUrl;
    }
    const loadingTask = getDocument(params);
    this.pdfLoadingTask = loadingTask;

    loadingTask.onPassword = (updateCallback, reason) => {
      if (this.isViewerEmbedded) {
        // The load event can't be triggered until the password is entered, so
        // if the viewer is in an iframe and its visibility depends on the
        // onload callback then the viewer never shows (bug 1801341).
        this._unblockDocumentLoadEvent();
      }

      this.pdfLinkService.externalLinkEnabled = false;
      this.passwordPrompt.setUpdateCallback(updateCallback, reason);
      this.passwordPrompt.open();
    };

    loadingTask.onProgress = ({ loaded, total }) => {
      this.progress(loaded / total);
    };

    return loadingTask.promise.then(
      pdfDocument => {
        this.load(pdfDocument);
      },
      reason => {
        if (loadingTask !== this.pdfLoadingTask) {
          return undefined; // Ignore errors for previously opened PDF files.
        }

        let key = "loadingError";
        if (reason instanceof InvalidPDFException) {
          key = "invalidFileError";
        } else if (reason instanceof MissingPDFException) {
          key = "missingFileError";
        } else if (reason instanceof UnexpectedResponseException) {
          key = "unexpectedResponseError";
        }
        // NOTE
        this._documentError(window.siyuan.languages[key], {message: reason?.message})
        throw reason
      }
    );
  }

  /**
   * @private
   */
  _ensureDownloadComplete() {
    if (this.pdfDocument && this.downloadComplete) {
      return;
    }
    throw new Error("PDF document not downloaded.");
  }

  async download() {
    const url = this._downloadUrl,
      filename = this._docFilename;
    try {
      this._ensureDownloadComplete();

      const data = await this.pdfDocument.getData();
      const blob = new Blob([data], { type: "application/pdf" });

      await this.downloadManager.download(blob, url, filename);
    } catch (reason) {
      // When the PDF document isn't ready, or the PDF file is still
      // downloading, simply download using the URL.
      await this.downloadManager.downloadUrl(url, filename);
    }
  }

  async save() {
    if (this._saveInProgress) {
      return;
    }
    this._saveInProgress = true;
    await this.pdfScriptingManager.dispatchWillSave();

    const url = this._downloadUrl,
      filename = this._docFilename;
    try {
      this._ensureDownloadComplete();

      const data = await this.pdfDocument.saveDocument();
      const blob = new Blob([data], { type: "application/pdf" });

      await this.downloadManager.download(blob, url, filename);
    } catch (reason) {
      // When the PDF document isn't ready, or the PDF file is still
      // downloading, simply fallback to a "regular" download.
      console.error(`Error when saving the document: ${reason.message}`);
      await this.download();
    } finally {
      await this.pdfScriptingManager.dispatchDidSave();
      this._saveInProgress = false;
    }

    if (this._hasAnnotationEditors) {
      this.externalServices.reportTelemetry({
        type: "editing",
        data: { type: "save" },
      });
    }
  }

  downloadOrSave() {
    if (this.pdfDocument?.annotationStorage.size > 0) {
      this.save();
    } else {
      this.download();
    }
  }

  /**
   * Report the error; used for errors affecting loading and/or parsing of
   * the entire PDF document.
   */
  _documentError(message, moreInfo = null) {
    this._unblockDocumentLoadEvent();

    this._otherError(message, moreInfo);

    this.eventBus.dispatch("documenterror", {
      source: this,
      message,
      reason: moreInfo?.message ?? null,
    });
  }

  /**
   * Report the error; used for errors affecting e.g. only a single page.
   * @param {string} message - A message that is human readable.
   * @param {Object} [moreInfo] - Further information about the error that is
   *                              more technical. Should have a 'message' and
   *                              optionally a 'stack' property.
   */
  _otherError(message, moreInfo = null) {
    const moreInfoText = [`PDF.js v${version || "?"} (build: ${build || "?"})`];
    if (moreInfo) {
      moreInfoText.push(`Message: ${moreInfo.message}`);

      if (moreInfo.stack) {
        moreInfoText.push(`Stack: ${moreInfo.stack}`);
      } else {
        if (moreInfo.filename) {
          moreInfoText.push(`File: ${moreInfo.filename}`);
        }
        if (moreInfo.lineNumber) {
          moreInfoText.push(`Line: ${moreInfo.lineNumber}`);
        }
      }
    }

    console.error(`${message}\n\n${moreInfoText.join("\n")}`);
  }

  progress(level) {
    if (!this.loadingBar || this.downloadComplete) {
      // Don't accidentally show the loading bar again when the entire file has
      // already been fetched (only an issue when disableAutoFetch is enabled).
      return;
    }
    const percent = Math.round(level * 100);
    // When we transition from full request to range requests, it's possible
    // that we discard some of the loaded data. This can cause the loading
    // bar to move backwards. So prevent this by only updating the bar if it
    // increases.
    if (percent <= this.loadingBar.percent) {
      return;
    }
    this.loadingBar.percent = percent;

    // When disableAutoFetch is enabled, it's not uncommon for the entire file
    // to never be fetched (depends on e.g. the file structure). In this case
    // the loading bar will not be completely filled, nor will it be hidden.
    // To prevent displaying a partially filled loading bar permanently, we
    // hide it when no data has been loaded during a certain amount of time.
    if (
      this.pdfDocument?.loadingParams.disableAutoFetch ??
      AppOptions.get("disableAutoFetch")
    ) {
      this.loadingBar.setDisableAutoFetch();
    }
  }

  load(pdfDocument) {
    this.pdfDocument = pdfDocument;

    pdfDocument.getDownloadInfo().then(({ length }) => {
      this._contentLength = length; // Ensure that the correct length is used.
      this.downloadComplete = true;
      this.loadingBar?.hide();

      firstPagePromise.then(() => {
        this.eventBus.dispatch("documentloaded", { source: this });
      });
    });

    // Since the `setInitialView` call below depends on this being resolved,
    // fetch it early to avoid delaying initial rendering of the PDF document.
    const pageLayoutPromise = pdfDocument.getPageLayout().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    });
    const pageModePromise = pdfDocument.getPageMode().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    });
    const openActionPromise = pdfDocument.getOpenAction().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    });

    this.toolbar?.setPagesCount(pdfDocument.numPages, false);
    this.secondaryToolbar?.setPagesCount(pdfDocument.numPages);

    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("CHROME")) {
      const baseUrl = location.href.split("#")[0];
      // Ignore "data:"-URLs for performance reasons, even though it may cause
      // internal links to not work perfectly in all cases (see bug 1803050).
      this.pdfLinkService.setDocument(
        pdfDocument,
        isDataScheme(baseUrl) ? null : baseUrl
      );
    } else {
      this.pdfLinkService.setDocument(pdfDocument);
    }
    this.pdfDocumentProperties?.setDocument(pdfDocument);

    const pdfViewer = this.pdfViewer;
    pdfViewer.setDocument(pdfDocument);
    const { firstPagePromise, onePageRendered, pagesPromise } = pdfViewer;

    this.pdfThumbnailViewer?.setDocument(pdfDocument);

    const storedPromise = (this.store = new ViewHistory(
      pdfDocument.fingerprints[0]
    ))
      .getMultiple({
        page: null,
        zoom: DEFAULT_SCALE_VALUE,
        scrollLeft: "0",
        scrollTop: "0",
        rotation: null,
        sidebarView: SidebarView.UNKNOWN,
        scrollMode: ScrollMode.UNKNOWN,
        spreadMode: SpreadMode.UNKNOWN,
      })
      .catch(() => {
        /* Unable to read from storage; ignoring errors. */
        return Object.create(null);
      });

    firstPagePromise.then(pdfPage => {
      this.loadingBar?.setWidth(this.appConfig.viewerContainer);
      this._initializeAnnotationStorageCallbacks(pdfDocument);

      Promise.all([
        animationStarted,
        storedPromise,
        pageLayoutPromise,
        pageModePromise,
        openActionPromise,
      ])
        .then(async ([timeStamp, stored, pageLayout, pageMode, openAction]) => {
          const viewOnLoad = AppOptions.get("viewOnLoad");

          this._initializePdfHistory({
            fingerprint: pdfDocument.fingerprints[0],
            viewOnLoad,
            initialDest: openAction?.dest,
          });
          const initialBookmark = this.initialBookmark;

          // Initialize the default values, from user preferences.
          const zoom = AppOptions.get("defaultZoomValue");
          let hash = zoom ? `zoom=${zoom}` : null;

          let rotation = null;
          let sidebarView = AppOptions.get("sidebarViewOnLoad");
          let scrollMode = AppOptions.get("scrollModeOnLoad");
          let spreadMode = AppOptions.get("spreadModeOnLoad");
          // NOTE
          stored.page = this.pdfId || stored.page;
          if (stored.page && viewOnLoad !== ViewOnLoad.INITIAL) {
            hash =
              `page=${stored.page}&zoom=${zoom || stored.zoom},` +
              `${stored.scrollLeft},${stored.scrollTop}`;

            rotation = parseInt(stored.rotation, 10);
            // Always let user preference take precedence over the view history.
            if (sidebarView === SidebarView.UNKNOWN) {
              sidebarView = stored.sidebarView | 0;
            }
            if (scrollMode === ScrollMode.UNKNOWN) {
              scrollMode = stored.scrollMode | 0;
            }
            if (spreadMode === SpreadMode.UNKNOWN) {
              spreadMode = stored.spreadMode | 0;
            }
          }
          // NOTE 定位分页，最后通过 showHighlight 进行高亮
          if (hash.indexOf("page=") === -1 && this.pdfId) {
            hash += `&page=${this.pdfId}`;
          }
          // NOTE: Ignore the pageMode/pageLayout in GeckoView since there's no
          // sidebar available, nor any UI for changing the Scroll/Spread modes.
          if (
            typeof PDFJSDev === "undefined"
              ? !window.isGECKOVIEW
              : !PDFJSDev.test("GECKOVIEW")
          ) {
            // Always let the user preference/view history take precedence.
            if (pageMode && sidebarView === SidebarView.UNKNOWN) {
              sidebarView = apiPageModeToSidebarView(pageMode);
            }
            if (
              pageLayout &&
              scrollMode === ScrollMode.UNKNOWN &&
              spreadMode === SpreadMode.UNKNOWN
            ) {
              const modes = apiPageLayoutToViewerModes(pageLayout);
              // TODO: Try to improve page-switching when using the mouse-wheel
              // and/or arrow-keys before allowing the document to control this.
              // scrollMode = modes.scrollMode;
              spreadMode = modes.spreadMode;
            }
          }

          this.setInitialView(hash, {
            rotation,
            sidebarView,
            scrollMode,
            spreadMode,
          });
          this.eventBus.dispatch("documentinit", { source: this });
          // Make all navigation keys work on document load,
          // unless the viewer is embedded in a web page.
          if (!this.isViewerEmbedded) {
            pdfViewer.focus();
          }

          // For documents with different page sizes, once all pages are
          // resolved, ensure that the correct location becomes visible on load.
          // (To reduce the risk, in very large and/or slow loading documents,
          //  that the location changes *after* the user has started interacting
          //  with the viewer, wait for either `pagesPromise` or a timeout.)
          await Promise.race([
            pagesPromise,
            new Promise(resolve => {
              setTimeout(resolve, FORCE_PAGES_LOADED_TIMEOUT);
            }),
          ]);
          if (!initialBookmark && !hash) {
            return;
          }
          if (pdfViewer.hasEqualPageSizes) {
            return;
          }
          this.initialBookmark = initialBookmark;

          // eslint-disable-next-line no-self-assign
          pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
          // Re-apply the initial document location.
          this.setInitialView(hash);
        })
        .catch(() => {
          // Ensure that the document is always completely initialized,
          // even if there are any errors thrown above.
          this.setInitialView();
        })
        .then(function () {
          // At this point, rendering of the initial page(s) should always have
          // started (and may even have completed).
          // To prevent any future issues, e.g. the document being completely
          // blank on load, always trigger rendering here.
          pdfViewer.update();
          // NOTE: 没有渲染完就切换页签导致 https://ld246.com/article/1677072688346
          const tabElement = hasClosestByClassName(pdfViewer.container, "fn__flex-1")
          if (tabElement) {
            tabElement.removeAttribute("data-loading")
          }
        });
    });

    pagesPromise.then(
      () => {
        this._unblockDocumentLoadEvent();

        this._initializeAutoPrint(pdfDocument, openActionPromise);
      },
      reason => {
        this.l10n.get("loading_error").then(msg => {
          this._documentError(msg, { message: reason?.message });
        });
      }
    );

    onePageRendered.then(data => {
      this.externalServices.reportTelemetry({
        type: "pageInfo",
        timestamp: data.timestamp,
      });

      if (this.pdfOutlineViewer) {
        pdfDocument.getOutline().then(outline => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the outline resolved.
          }
          this.pdfOutlineViewer.render({ outline, pdfDocument });
        });
      }
      if (this.pdfAttachmentViewer) {
        pdfDocument.getAttachments().then(attachments => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the attachments resolved.
          }
          this.pdfAttachmentViewer.render({ attachments });
        });
      }
      if (this.pdfLayerViewer) {
        // Ensure that the layers accurately reflects the current state in the
        // viewer itself, rather than the default state provided by the API.
        pdfViewer.optionalContentConfigPromise.then(optionalContentConfig => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the layers resolved.
          }
          this.pdfLayerViewer.render({ optionalContentConfig, pdfDocument });
        });
      }
    });

    this._initializePageLabels(pdfDocument);
    this._initializeMetadata(pdfDocument);
  }

  /**
   * @private
   */
  async _scriptingDocProperties(pdfDocument) {
    if (!this.documentInfo) {
      // It should be *extremely* rare for metadata to not have been resolved
      // when this code runs, but ensure that we handle that case here.
      await new Promise(resolve => {
        this.eventBus._on("metadataloaded", resolve, { once: true });
      });
      if (pdfDocument !== this.pdfDocument) {
        return null; // The document was closed while the metadata resolved.
      }
    }
    if (!this._contentLength) {
      // Always waiting for the entire PDF document to be loaded will, most
      // likely, delay sandbox-creation too much in the general case for all
      // PDF documents which are not provided as binary data to the API.
      // Hence we'll simply have to trust that the `contentLength` (as provided
      // by the server), when it exists, is accurate enough here.
      await new Promise(resolve => {
        this.eventBus._on("documentloaded", resolve, { once: true });
      });
      if (pdfDocument !== this.pdfDocument) {
        return null; // The document was closed while the downloadInfo resolved.
      }
    }

    return {
      ...this.documentInfo,
      baseURL: this.baseUrl,
      filesize: this._contentLength,
      filename: this._docFilename,
      metadata: this.metadata?.getRaw(),
      authors: this.metadata?.get("dc:creator"),
      numPages: this.pagesCount,
      URL: this.url,
    };
  }

  /**
   * @private
   */
  async _initializeAutoPrint(pdfDocument, openActionPromise) {
    const [openAction, javaScript] = await Promise.all([
      openActionPromise,
      !this.pdfViewer.enableScripting ? pdfDocument.getJavaScript() : null,
    ]);

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the auto print data resolved.
    }
    let triggerAutoPrint = false;

    if (openAction?.action === "Print") {
      triggerAutoPrint = true;
    }
    if (javaScript) {
      javaScript.some(js => {
        if (!js) {
          // Don't warn/fallback for empty JavaScript actions.
          return false;
        }
        console.warn("Warning: JavaScript support is not enabled");
        return true;
      });

      if (!triggerAutoPrint) {
        // Hack to support auto printing.
        for (const js of javaScript) {
          if (js && AutoPrintRegExp.test(js)) {
            triggerAutoPrint = true;
            break;
          }
        }
      }
    }

    if (triggerAutoPrint) {
      this.triggerPrinting();
    }
  }

  /**
   * @private
   */
  async _initializeMetadata(pdfDocument) {
    const { info, metadata, contentDispositionFilename, contentLength } =
      await pdfDocument.getMetadata();

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the metadata resolved.
    }
    this.documentInfo = info;
    this.metadata = metadata;
    this._contentDispositionFilename ??= contentDispositionFilename;
    this._contentLength ??= contentLength; // See `getDownloadInfo`-call above.

    // Provides some basic debug information
    // NOTE console.log(
    //   `PDF ${pdfDocument.fingerprints[0]} [${info.PDFFormatVersion} ` +
    //     `${(info.Producer || "-").trim()} / ${(info.Creator || "-").trim()}] ` +
    //     `(PDF.js: ${version || "?"} [${build || "?"}])`
    // );
    let pdfTitle = info.Title;

    const metadataTitle = metadata?.get("dc:title");
    if (metadataTitle) {
      // Ghostscript can produce invalid 'dc:title' Metadata entries:
      //  - The title may be "Untitled" (fixes bug 1031612).
      //  - The title may contain incorrectly encoded characters, which thus
      //    looks broken, hence we ignore the Metadata entry when it contains
      //    characters from the Specials Unicode block (fixes bug 1605526).
      if (
        metadataTitle !== "Untitled" &&
        !/[\uFFF0-\uFFFF]/g.test(metadataTitle)
      ) {
        pdfTitle = metadataTitle;
      }
    }
    if (pdfTitle) {
      this.setTitle(
        `${pdfTitle} - ${this._contentDispositionFilename || this._title}`
      );
    } else if (this._contentDispositionFilename) {
      this.setTitle(this._contentDispositionFilename);
    }

    if (
      info.IsXFAPresent &&
      !info.IsAcroFormPresent &&
      !pdfDocument.isPureXfa
    ) {
      if (pdfDocument.loadingParams.enableXfa) {
        console.warn("Warning: XFA Foreground documents are not supported");
      } else {
        console.warn("Warning: XFA support is not enabled");
      }
    } else if (
      (info.IsAcroFormPresent || info.IsXFAPresent) &&
      !this.pdfViewer.renderForms
    ) {
      console.warn("Warning: Interactive form support is not enabled");
    }

    if (info.IsSignaturesPresent) {
      console.warn("Warning: Digital signatures validation is not supported");
    }

    this.eventBus.dispatch("metadataloaded", { source: this });
  }

  /**
   * @private
   */
  async _initializePageLabels(pdfDocument) {
    if (
      typeof PDFJSDev === "undefined"
        ? window.isGECKOVIEW
        : PDFJSDev.test("GECKOVIEW")
    ) {
      return;
    }
    const labels = await pdfDocument.getPageLabels();

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the page labels resolved.
    }
    if (!labels || AppOptions.get("disablePageLabels")) {
      return;
    }
    const numLabels = labels.length;
    // Ignore page labels that correspond to standard page numbering,
    // or page labels that are all empty.
    let standardLabels = 0,
      emptyLabels = 0;
    for (let i = 0; i < numLabels; i++) {
      const label = labels[i];
      if (label === (i + 1).toString()) {
        standardLabels++;
      } else if (label === "") {
        emptyLabels++;
      } else {
        break;
      }
    }
    if (standardLabels >= numLabels || emptyLabels >= numLabels) {
      return;
    }
    const { pdfViewer, pdfThumbnailViewer, toolbar } = this;

    pdfViewer.setPageLabels(labels);
    pdfThumbnailViewer?.setPageLabels(labels);

    // Changing toolbar page display to use labels and we need to set
    // the label of the current page.
    toolbar?.setPagesCount(numLabels, true);
    toolbar?.setPageNumber(
      pdfViewer.currentPageNumber,
      pdfViewer.currentPageLabel
    );
  }

  /**
   * @private
   */
  _initializePdfHistory({ fingerprint, viewOnLoad, initialDest = null }) {
    if (!this.pdfHistory) {
      return;
    }
    this.pdfHistory.initialize({
      fingerprint,
      resetHistory: viewOnLoad === ViewOnLoad.INITIAL,
      updateUrl: AppOptions.get("historyUpdateUrl"),
    });

    if (this.pdfHistory.initialBookmark) {
      this.initialBookmark = this.pdfHistory.initialBookmark;

      this.initialRotation = this.pdfHistory.initialRotation;
    }

    // Always let the browser history/document hash take precedence.
    if (
      initialDest &&
      !this.initialBookmark &&
      viewOnLoad === ViewOnLoad.UNKNOWN
    ) {
      this.initialBookmark = JSON.stringify(initialDest);
      // TODO: Re-factor the `PDFHistory` initialization to remove this hack
      // that's currently necessary to prevent weird initial history state.
      this.pdfHistory.push({ explicitDest: initialDest, pageNumber: null });
    }
  }

  /**
   * @private
   */
  _initializeAnnotationStorageCallbacks(pdfDocument) {
    if (pdfDocument !== this.pdfDocument) {
      return;
    }
    const { annotationStorage } = pdfDocument;

    annotationStorage.onSetModified = () => {
      // NOTE window.addEventListener("beforeunload", beforeUnload);

      if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
        this._annotationStorageModified = true;
      }
    };
    annotationStorage.onResetModified = () => {
      // NOTE window.removeEventListener("beforeunload", beforeUnload);

      if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
        delete this._annotationStorageModified;
      }
    };
    annotationStorage.onAnnotationEditor = typeStr => {
      this._hasAnnotationEditors = !!typeStr;
      this.setTitle();

      if (typeStr) {
        this.externalServices.reportTelemetry({
          type: "editing",
          data: { type: typeStr },
        });
      }
    };
  }

  setInitialView(
    storedHash,
    { rotation, sidebarView, scrollMode, spreadMode } = {}
  ) {
    const setRotation = angle => {
      if (isValidRotation(angle)) {
        this.pdfViewer.pagesRotation = angle;
      }
    };
    const setViewerModes = (scroll, spread) => {
      if (isValidScrollMode(scroll)) {
        this.pdfViewer.scrollMode = scroll;
      }
      if (isValidSpreadMode(spread)) {
        this.pdfViewer.spreadMode = spread;
      }
    };
    this.isInitialViewSet = true;
    this.pdfSidebar?.setInitialView(sidebarView);

    setViewerModes(scrollMode, spreadMode);

    if (this.initialBookmark) {
      setRotation(this.initialRotation);
      delete this.initialRotation;

      this.pdfLinkService.setHash(this.initialBookmark);
      this.initialBookmark = null;
    } else if (storedHash) {
      setRotation(rotation);

      this.pdfLinkService.setHash(storedHash);
    }

    // Ensure that the correct page number is displayed in the UI,
    // even if the active page didn't change during document load.
    this.toolbar?.setPageNumber(
      this.pdfViewer.currentPageNumber,
      this.pdfViewer.currentPageLabel
    );
    this.secondaryToolbar?.setPageNumber(this.pdfViewer.currentPageNumber);

    if (!this.pdfViewer.currentScaleValue) {
      // Scale was not initialized: invalid bookmark or scale was not specified.
      // Setting the default one.
      this.pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE;
    }
  }

  /**
   * @private
   */
  _cleanup() {
    if (!this.pdfDocument) {
      return; // run cleanup when document is loaded
    }
    this.pdfViewer.cleanup();
    this.pdfThumbnailViewer?.cleanup();

    // NOTE: 防止定时任务导致 PDF this.messageHandler.sendWithPromise 报错
    if (this.pdfLoadingTask.destroyed) {
      return;
    }

    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || GENERIC")
    ) {
      // We don't want to remove fonts used by active page SVGs.
      this.pdfDocument.cleanup(
        /* keepLoadedFonts = */ this.pdfViewer.renderer === RendererType.SVG
      );
    } else {
      this.pdfDocument.cleanup();
    }
  }

  forceRendering() {
    this.pdfRenderingQueue.printing = !!this.printService;
    this.pdfRenderingQueue.isThumbnailViewEnabled =
      this.pdfSidebar?.visibleView === SidebarView.THUMBS;
    this.pdfRenderingQueue.renderHighestPriority();
  }

  beforePrint() {
    this._printAnnotationStoragePromise = this.pdfScriptingManager
      .dispatchWillPrint()
      .catch(() => {
        /* Avoid breaking printing; ignoring errors. */
      })
      .then(() => {
        return this.pdfDocument?.annotationStorage.print;
      });

    if (this.printService) {
      // There is no way to suppress beforePrint/afterPrint events,
      // but PDFPrintService may generate double events -- this will ignore
      // the second event that will be coming from native window.print().
      return;
    }

    if (!this.supportsPrinting) {
      // NOTE
      this._otherError(window.siyuan.languages.printingNotSupported)
      return;
    }

    // The beforePrint is a sync method and we need to know layout before
    // returning from this method. Ensure that we can get sizes of the pages.
    if (!this.pdfViewer.pageViewsReady) {
      // NOTE
      window.alert(window.siyuan.languages.printingNotReady)
      return;
    }

    const pagesOverview = this.pdfViewer.getPagesOverview();
    const printContainer = this.appConfig.printContainer;
    const printResolution = AppOptions.get("printResolution");
    const optionalContentConfigPromise =
      this.pdfViewer.optionalContentConfigPromise;

    const printService = PDFPrintServiceFactory.instance.createPrintService(
      this.pdfDocument,
      pagesOverview,
      printContainer,
      printResolution,
      optionalContentConfigPromise,
      this._printAnnotationStoragePromise,
      this.l10n
    );
    this.printService = printService;
    this.forceRendering();
    // Disable the editor-indicator during printing (fixes bug 1790552).
    this.setTitle();

    printService.layout();

    if (this._hasAnnotationEditors) {
      this.externalServices.reportTelemetry({
        type: "editing",
        data: { type: "print" },
      });
    }
  }

  afterPrint() {
    if (this._printAnnotationStoragePromise) {
      this._printAnnotationStoragePromise.then(() => {
        this.pdfScriptingManager.dispatchDidPrint();
      });
      this._printAnnotationStoragePromise = null;
    }

    if (this.printService) {
      this.printService.destroy();
      this.printService = null;

      this.pdfDocument?.annotationStorage.resetModified();
    }
    this.forceRendering();
    // Re-enable the editor-indicator after printing (fixes bug 1790552).
    this.setTitle();
  }

  rotatePages(delta) {
    this.pdfViewer.pagesRotation += delta;
    // Note that the thumbnail viewer is updated, and rendering is triggered,
    // in the 'rotationchanging' event handler.
  }

  requestPresentationMode() {
    this.pdfPresentationMode?.request();
  }

  triggerPrinting() {
    if (!this.supportsPrinting) {
      return;
    }
    window.print();
  }

  bindEvents() {
    const { eventBus, _boundEvents } = this;

    _boundEvents.beforePrint = this.beforePrint.bind(this);
    _boundEvents.afterPrint = this.afterPrint.bind(this);

    eventBus._on("resize", webViewerResize);
    eventBus._on("hashchange", webViewerHashchange);
    eventBus._on("beforeprint", _boundEvents.beforePrint);
    eventBus._on("afterprint", _boundEvents.afterPrint);
    eventBus._on("pagerender", webViewerPageRender);
    eventBus._on("pagerendered", webViewerPageRendered);
    eventBus._on("updateviewarea", webViewerUpdateViewarea);
    eventBus._on("pagechanging", webViewerPageChanging);
    eventBus._on("scalechanging", webViewerScaleChanging);
    eventBus._on("rotationchanging", webViewerRotationChanging);
    eventBus._on("sidebarviewchanged", webViewerSidebarViewChanged);
    eventBus._on("pagemode", webViewerPageMode);
    eventBus._on("namedaction", webViewerNamedAction);
    eventBus._on("presentationmodechanged", webViewerPresentationModeChanged);
    eventBus._on("presentationmode", webViewerPresentationMode);
    eventBus._on(
      "switchannotationeditormode",
      webViewerSwitchAnnotationEditorMode
    );
    eventBus._on(
      "switchannotationeditorparams",
      webViewerSwitchAnnotationEditorParams
    );
    eventBus._on("print", webViewerPrint);
    eventBus._on("download", webViewerDownload);
    eventBus._on("firstpage", webViewerFirstPage);
    eventBus._on("lastpage", webViewerLastPage);
    eventBus._on("nextpage", webViewerNextPage);
    eventBus._on("previouspage", webViewerPreviousPage);
    eventBus._on("zoomin", webViewerZoomIn);
    eventBus._on("zoomout", webViewerZoomOut);
    eventBus._on("zoomreset", webViewerZoomReset);
    eventBus._on("pagenumberchanged", webViewerPageNumberChanged);
    eventBus._on("scalechanged", webViewerScaleChanged);
    eventBus._on("rotatecw", webViewerRotateCw);
    eventBus._on("rotateccw", webViewerRotateCcw);
    eventBus._on("optionalcontentconfig", webViewerOptionalContentConfig);
    eventBus._on("switchscrollmode", webViewerSwitchScrollMode);
    eventBus._on("scrollmodechanged", webViewerScrollModeChanged);
    eventBus._on("switchspreadmode", webViewerSwitchSpreadMode);
    eventBus._on("spreadmodechanged", webViewerSpreadModeChanged);
    eventBus._on("documentproperties", webViewerDocumentProperties);
    eventBus._on("findfromurlhash", webViewerFindFromUrlHash);
    eventBus._on("updatefindmatchescount", webViewerUpdateFindMatchesCount);
    eventBus._on("updatefindcontrolstate", webViewerUpdateFindControlState);

    if (AppOptions.get("pdfBug")) {
      _boundEvents.reportPageStatsPDFBug = reportPageStatsPDFBug;

      eventBus._on("pagerendered", _boundEvents.reportPageStatsPDFBug);
      eventBus._on("pagechanging", _boundEvents.reportPageStatsPDFBug);
    }
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      eventBus._on("fileinputchange", webViewerFileInputChange);
      eventBus._on("openfile", webViewerOpenFile);
    }
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
      eventBus._on(
        "annotationeditorstateschanged",
        webViewerAnnotationEditorStatesChanged
      );
    }
  }

  bindWindowEvents() {
    const { eventBus, _boundEvents } = this;

    function addWindowResolutionChange(evt = null) {
      if (evt) {
        webViewerResolutionChange(evt);
      }
      const mediaQueryList = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`
      );
      mediaQueryList.addEventListener("change", addWindowResolutionChange, {
        once: true,
      });

      if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
        return;
      }
      _boundEvents.removeWindowResolutionChange ||= function () {
        mediaQueryList.removeEventListener("change", addWindowResolutionChange);
        _boundEvents.removeWindowResolutionChange = null;
      };
    }
    addWindowResolutionChange();

    _boundEvents.windowResize = () => {
      eventBus.dispatch("resize", { source: window });
    };
    _boundEvents.windowHashChange = () => {
      eventBus.dispatch("hashchange", {
        source: window,
        hash: document.location.hash.substring(1),
      });
    };
    _boundEvents.windowBeforePrint = () => {
      eventBus.dispatch("beforeprint", { source: window });
    };
    _boundEvents.windowAfterPrint = () => {
      eventBus.dispatch("afterprint", { source: window });
    };
    _boundEvents.windowUpdateFromSandbox = event => {
      eventBus.dispatch("updatefromsandbox", {
        source: window,
        detail: event.detail,
      });
    };

    window.addEventListener("visibilitychange", webViewerVisibilityChange);
    window.addEventListener("wheel", webViewerWheel, { passive: false });
    window.addEventListener("touchstart", webViewerTouchStart, {
      passive: false,
    });
    window.addEventListener("touchmove", webViewerTouchMove, {
      passive: false,
    });
    window.addEventListener("touchend", webViewerTouchEnd, {
      passive: false,
    });
    window.addEventListener("click", webViewerClick);
    window.addEventListener("keydown", webViewerKeyDown);
    window.addEventListener("keyup", webViewerKeyUp);
    window.addEventListener("resize", _boundEvents.windowResize);
    window.addEventListener("hashchange", _boundEvents.windowHashChange);
    window.addEventListener("beforeprint", _boundEvents.windowBeforePrint);
    window.addEventListener("afterprint", _boundEvents.windowAfterPrint);
    window.addEventListener(
      "updatefromsandbox",
      _boundEvents.windowUpdateFromSandbox
    );
  }

  unbindEvents() {
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
      throw new Error("Not implemented: unbindEvents");
    }
    const { eventBus, _boundEvents } = this;

    eventBus._off("resize", webViewerResize);
    eventBus._off("hashchange", webViewerHashchange);
    eventBus._off("beforeprint", _boundEvents.beforePrint);
    eventBus._off("afterprint", _boundEvents.afterPrint);
    eventBus._off("pagerender", webViewerPageRender);
    eventBus._off("pagerendered", webViewerPageRendered);
    eventBus._off("updateviewarea", webViewerUpdateViewarea);
    eventBus._off("pagechanging", webViewerPageChanging);
    eventBus._off("scalechanging", webViewerScaleChanging);
    eventBus._off("rotationchanging", webViewerRotationChanging);
    eventBus._off("sidebarviewchanged", webViewerSidebarViewChanged);
    eventBus._off("pagemode", webViewerPageMode);
    eventBus._off("namedaction", webViewerNamedAction);
    eventBus._off("presentationmodechanged", webViewerPresentationModeChanged);
    eventBus._off("presentationmode", webViewerPresentationMode);
    eventBus._off("print", webViewerPrint);
    eventBus._off("download", webViewerDownload);
    eventBus._off("firstpage", webViewerFirstPage);
    eventBus._off("lastpage", webViewerLastPage);
    eventBus._off("nextpage", webViewerNextPage);
    eventBus._off("previouspage", webViewerPreviousPage);
    eventBus._off("zoomin", webViewerZoomIn);
    eventBus._off("zoomout", webViewerZoomOut);
    eventBus._off("zoomreset", webViewerZoomReset);
    eventBus._off("pagenumberchanged", webViewerPageNumberChanged);
    eventBus._off("scalechanged", webViewerScaleChanged);
    eventBus._off("rotatecw", webViewerRotateCw);
    eventBus._off("rotateccw", webViewerRotateCcw);
    eventBus._off("optionalcontentconfig", webViewerOptionalContentConfig);
    eventBus._off("switchscrollmode", webViewerSwitchScrollMode);
    eventBus._off("scrollmodechanged", webViewerScrollModeChanged);
    eventBus._off("switchspreadmode", webViewerSwitchSpreadMode);
    eventBus._off("spreadmodechanged", webViewerSpreadModeChanged);
    eventBus._off("documentproperties", webViewerDocumentProperties);
    eventBus._off("findfromurlhash", webViewerFindFromUrlHash);
    eventBus._off("updatefindmatchescount", webViewerUpdateFindMatchesCount);
    eventBus._off("updatefindcontrolstate", webViewerUpdateFindControlState);

    if (_boundEvents.reportPageStatsPDFBug) {
      eventBus._off("pagerendered", _boundEvents.reportPageStatsPDFBug);
      eventBus._off("pagechanging", _boundEvents.reportPageStatsPDFBug);

      _boundEvents.reportPageStatsPDFBug = null;
    }
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      eventBus._off("fileinputchange", webViewerFileInputChange);
      eventBus._off("openfile", webViewerOpenFile);
    }

    _boundEvents.beforePrint = null;
    _boundEvents.afterPrint = null;
  }

  unbindWindowEvents() {
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
      throw new Error("Not implemented: unbindWindowEvents");
    }
    const { _boundEvents } = this;

    window.removeEventListener("visibilitychange", webViewerVisibilityChange);
    window.removeEventListener("wheel", webViewerWheel, { passive: false });
    window.removeEventListener("touchstart", webViewerTouchStart, {
      passive: false,
    });
    window.removeEventListener("touchmove", webViewerTouchMove, {
      passive: false,
    });
    window.removeEventListener("touchend", webViewerTouchEnd, {
      passive: false,
    });
    window.removeEventListener("click", webViewerClick);
    window.removeEventListener("keydown", webViewerKeyDown);
    window.removeEventListener("keyup", webViewerKeyUp);
    window.removeEventListener("resize", _boundEvents.windowResize);
    window.removeEventListener("hashchange", _boundEvents.windowHashChange);
    window.removeEventListener("beforeprint", _boundEvents.windowBeforePrint);
    window.removeEventListener("afterprint", _boundEvents.windowAfterPrint);
    window.removeEventListener(
      "updatefromsandbox",
      _boundEvents.windowUpdateFromSandbox
    );

    _boundEvents.removeWindowResolutionChange?.();
    _boundEvents.windowResize = null;
    _boundEvents.windowHashChange = null;
    _boundEvents.windowBeforePrint = null;
    _boundEvents.windowAfterPrint = null;
    _boundEvents.windowUpdateFromSandbox = null;
  }

  _accumulateTicks(ticks, prop) {
    // If the direction changed, reset the accumulated ticks.
    if ((this[prop] > 0 && ticks < 0) || (this[prop] < 0 && ticks > 0)) {
      this[prop] = 0;
    }
    this[prop] += ticks;
    const wholeTicks = Math.trunc(this[prop]);
    this[prop] -= wholeTicks;
    return wholeTicks;
  }

  _accumulateFactor(previousScale, factor, prop) {
    if (factor === 1) {
      return 1;
    }
    // If the direction changed, reset the accumulated factor.
    if ((this[prop] > 1 && factor < 1) || (this[prop] < 1 && factor > 1)) {
      this[prop] = 1;
    }

    const newFactor =
      Math.floor(previousScale * factor * this[prop] * 100) /
      (100 * previousScale);
    this[prop] = factor / newFactor;

    return newFactor;
  }

  _centerAtPos(previousScale, x, y) {
    const { pdfViewer } = this;
    const scaleDiff = pdfViewer.currentScale / previousScale - 1;
    if (scaleDiff !== 0) {
      const [top, left] = pdfViewer.containerTopLeft;
      pdfViewer.container.scrollLeft += (x - left) * scaleDiff;
      pdfViewer.container.scrollTop += (y - top) * scaleDiff;
    }
  }

  /**
   * Should be called *after* all pages have loaded, or if an error occurred,
   * to unblock the "load" event; see https://bugzilla.mozilla.org/show_bug.cgi?id=1618553
   * @private
   */
  _unblockDocumentLoadEvent() {
    document.blockUnblockOnload?.(false);

    // Ensure that this method is only ever run once.
    this._unblockDocumentLoadEvent = () => {};
  }

  /**
   * Used together with the integration-tests, to enable awaiting full
   * initialization of the scripting/sandbox.
   */
  get scriptingReady() {
    return this.pdfScriptingManager.ready;
  }
};

if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
  const HOSTED_VIEWER_ORIGINS = [
    "null",
    "http://mozilla.github.io",
    "https://mozilla.github.io",
  ];
  // eslint-disable-next-line no-var
  var validateFileURL = function (file) {
    if (!file) {
      return;
    }
    try {
      const viewerOrigin = new URL(window.location.href).origin || "null";
      if (HOSTED_VIEWER_ORIGINS.includes(viewerOrigin)) {
        // Hosted or local viewer, allow for any file locations
        return;
      }
      const fileOrigin = new URL(file, window.location.href).origin;
      // Removing of the following line will not guarantee that the viewer will
      // start accepting URLs from foreign origin -- CORS headers on the remote
      // server must be properly configured.
      if (fileOrigin !== viewerOrigin) {
        throw new Error("file origin does not match viewer's");
      }
    } catch (ex) {
      // NOTE
      console.log(window.siyuan.languages.loadingError, ex.message)
      throw ex;
    }
  };
}

async function loadFakeWorker() {
  GlobalWorkerOptions.workerSrc ||= AppOptions.get("workerSrc");

  if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("PRODUCTION")) {
    // NOTE
    window.pdfjsWorker = await import(`${Constants.PROTYLE_CDN}/js/pdf/pdf.worker.js?v=3.5.141`)
    return;
  }
  await loadScript(PDFWorker.workerSrc);
}

async function loadPDFBug(self) {
  // NOTE
  // const { debuggerScriptPath } = self.appConfig;
  // const { PDFBug } =
  //   typeof PDFJSDev === "undefined" || !PDFJSDev.test("PRODUCTION")
  //     ? await import(debuggerScriptPath) // eslint-disable-line no-unsanitized/method
  //     : await __non_webpack_import__(debuggerScriptPath); // eslint-disable-line no-undef
  //
  // self._PDFBug = PDFBug;
}

function reportPageStatsPDFBug({ pageNumber }) {
  // NOTE
  // if (!globalThis.Stats?.enabled) {
  //   return;
  // }
  // const pageView = PDFViewerApplication.pdfViewer.getPageView(
  //   /* index = */ pageNumber - 1
  // );
  // globalThis.Stats.add(pageNumber, pageView?.pdfPage?.stats);
}

// NOTE
function webViewerInitialized(pdf) {
  const { appConfig, eventBus } = pdf;
  const file = appConfig.file
  // if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
  //   const queryString = document.location.search.substring(1);
  //   const params = parseQueryString(queryString);
  //   file = params.get("file") ?? AppOptions.get("defaultUrl");
  //   validateFileURL(file);
  // } else if (PDFJSDev.test("MOZCENTRAL")) {
  //   file = window.location.href;
  // } else if (PDFJSDev.test("CHROME")) {
  //   file = AppOptions.get("defaultUrl");
  // }
  //
  // if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
  //   const fileInput = appConfig.openFileInput;
  //   fileInput.value = null;
  //
  //   fileInput.addEventListener("change", function (evt) {
  //     const { files } = evt.target;
  //     if (!files || files.length === 0) {
  //       return;
  //     }
  //     eventBus.dispatch("fileinputchange", {
  //       source: this,
  //       fileInput: evt.target,
  //     });
  //   });
  //
  //   // Enable dragging-and-dropping a new PDF file onto the viewerContainer.
  //   appConfig.mainContainer.addEventListener("dragover", function (evt) {
  //     evt.preventDefault();
  //
  //     evt.dataTransfer.dropEffect =
  //       evt.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
  //   });
  //   appConfig.mainContainer.addEventListener("drop", function (evt) {
  //     evt.preventDefault();
  //
  //     const { files } = evt.dataTransfer;
  //     if (!files || files.length === 0) {
  //       return;
  //     }
  //     eventBus.dispatch("fileinputchange", {
  //       source: this,
  //       fileInput: evt.dataTransfer,
  //     });
  //   });
  // }

  if (!pdf.supportsDocumentFonts) {
    AppOptions.set("disableFontFace", true);
    console.warn('Web fonts are disabled: unable to use embedded PDF fonts.')
  }

  if (!pdf.supportsPrinting) {
    appConfig.toolbar?.print.classList.add("fn__hidden");
    appConfig.secondaryToolbar?.printButton.classList.add("fn__hidden");
  }

  if (!pdf.supportsFullscreen) {
    appConfig.secondaryToolbar?.presentationModeButton.classList.add("fn__hidden");
  }

  if (pdf.supportsIntegratedFind) {
    appConfig.toolbar?.viewFind.classList.add("fn__hidden");
  }

  appConfig.mainContainer.addEventListener(
    "transitionend",
    function (evt) {
      if (evt.target === /* mainContainer */ this) {
        // NOTE
        pdf.eventBus.dispatch("resize", { source: this });
      }
    },
    true
  );

  try {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      if (file) {
        pdf.open({ url: file });
      } else {
        pdf._hideViewBookmark();
      }
    } else if (PDFJSDev.test("MOZCENTRAL || CHROME")) {
      pdf.setTitleUsingUrl(file, /* downloadUrl = */ file);
      pdf.initPassiveLoading();
    } else {
      throw new Error("Not implemented: webViewerInitialized");
    }
  } catch (reason) {
    pdf._documentError(window.siyuan.languages.loadingError, reason)
  }
}

// NOTE
function webViewerPageRender({ pageNumber, source }) {
  const pdfInstance = getPdfInstance(source.div)
  if (!pdfInstance) {
    return
  }
  // If the page is (the most) visible when it starts rendering,
  // ensure that the page number input loading indicator is displayed.
  if (pageNumber === pdfInstance.page) {
    pdfInstance.toolbar?.updateLoadingIndicatorState(true);
  }
}

// NOTE
function webViewerPageRendered({ pageNumber, error, source }) {
  const pdfInstance = getPdfInstance(source.div)
  if (!pdfInstance) {
    return
  }
  // If the page is still visible when it has finished rendering,
  // ensure that the page number input loading indicator is hidden.
  if (pageNumber === pdfInstance.page) {
    pdfInstance.toolbar?.updateLoadingIndicatorState(false);
  }

  // Use the rendered page to set the corresponding thumbnail image.
  if (pdfInstance.pdfSidebar?.visibleView === SidebarView.THUMBS) {
    const pageView = pdfInstance.pdfViewer.getPageView(
      /* index = */ pageNumber - 1
    );
    const thumbnailView = pdfInstance.pdfThumbnailViewer?.getThumbnail(
      /* index = */ pageNumber - 1
    );
    if (pageView && thumbnailView) {
      thumbnailView.setImage(pageView);
    }
  }

  if (error) {
    pdfInstance._otherError('An error occurred while rendering the page.', error)
  }
}

// NOTE
function webViewerPageMode({ mode, source }) {
  const pdfInstance = getPdfInstance(source.externalLinkTarget)
  if (!pdfInstance) {
    return
  }
  // Handle the 'pagemode' hash parameter, see also `PDFLinkService_setHash`.
  let view;
  switch (mode) {
    case "thumbs":
      view = SidebarView.THUMBS;
      break;
    case "bookmarks":
    case "outline": // non-standard
      view = SidebarView.OUTLINE;
      break;
    case "attachments": // non-standard
      view = SidebarView.ATTACHMENTS;
      break;
    case "layers": // non-standard
      view = SidebarView.LAYERS;
      break;
    case "none":
      view = SidebarView.NONE;
      break;
    default:
      console.error('Invalid "pagemode" hash parameter: ' + mode);
      return;
  }
  pdfInstance.pdfSidebar?.switchView(view, /* forceOpen = */ true);
}

// NOTE
function webViewerNamedAction(evt) {
  const pdfInstance = getPdfInstance(evt.source.externalLinkTarget)
  if (!pdfInstance) {
    return
  }
  // Processing a couple of named actions that might be useful, see also
  // `PDFLinkService.executeNamedAction`.
  switch (evt.action) {
    case "GoToPage":
      pdfInstance.appConfig.toolbar?.pageNumber.select();
      break;

    case "Find":
      if (!pdfInstance.supportsIntegratedFind) {
        pdfInstance?.findBar.toggle();
      }
      break;

    case "Print":
      pdfInstance.triggerPrinting();
      break;

    case "SaveAs":
      pdfInstance.downloadOrSave();
      break;
  }
}

// NOTE
function webViewerPresentationModeChanged(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.presentationModeState = evt.state;
}

// NOTE
function webViewerSidebarViewChanged({ view, source }) {
  const pdfInstance = getPdfInstance(source.outerContainer)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfRenderingQueue.isThumbnailViewEnabled =
    view === SidebarView.THUMBS;

  if (pdfInstance.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    pdfInstance.store?.set("sidebarView", view).catch(() => {
      // Unable to write to storage.
    });
  }
}

// NOTE
function webViewerUpdateViewarea({ location, source }) {
  const pdfInstance = getPdfInstance(source.container)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    pdfInstance.store
      ?.setMultiple({
        page: location.pageNumber,
        zoom: location.scale,
        scrollLeft: location.left,
        scrollTop: location.top,
        rotation: location.rotation,
      })
      .catch(() => {
        // Unable to write to storage.
      });
  }
  if (pdfInstance.appConfig.secondaryToolbar) {
    const href = pdfInstance.pdfLinkService.getAnchorUrl(
      location.pdfOpenParams
    );
    pdfInstance.appConfig.secondaryToolbar.viewBookmarkButton.href =
      href;
  }
}

// NOTE
function webViewerScrollModeChanged(evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  if (
    pdfInstance.isInitialViewSet &&
    !pdfInstance.pdfViewer.isInPresentationMode
  ) {
    // Only update the storage when the document has been loaded *and* rendered.
    pdfInstance.store?.set("scrollMode", evt.mode).catch(() => {
      // Unable to write to storage.
    });
  }
}

// NOTE
function webViewerSpreadModeChanged(evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  if (
    pdfInstance.isInitialViewSet &&
    !pdfInstance.pdfViewer.isInPresentationMode
  ) {
    // Only update the storage when the document has been loaded *and* rendered.
    pdfInstance.store?.set("spreadMode", evt.mode).catch(() => {
      // Unable to write to storage.
    });
  }
}

// NOTE
function webViewerResize() {
  // const { pdfDocument, pdfViewer, pdfRenderingQueue } = PDFViewerApplication;
  //
  // if (pdfRenderingQueue.printing && window.matchMedia("print").matches) {
  //   // Work-around issue 15324 by ignoring "resize" events during printing.
  //   return;
  // }
  //
  // if (!pdfDocument) {
  //   return;
  // }
  // const currentScaleValue = pdfViewer.currentScaleValue;
  // if (
  //   currentScaleValue === "auto" ||
  //   currentScaleValue === "page-fit" ||
  //   currentScaleValue === "page-width"
  // ) {
  //   // Note: the scale is constant for 'page-actual'.
  //   pdfViewer.currentScaleValue = currentScaleValue;
  // }
  // pdfViewer.update();
}

function webViewerHashchange(evt) {
  // NOTE
}

if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
  // eslint-disable-next-line no-var
  var webViewerFileInputChange = function (evt) {
    if (PDFViewerApplication.pdfViewer?.isInPresentationMode) {
      return; // Opening a new PDF file isn't supported in Presentation Mode.
    }
    const file = evt.fileInput.files[0];

    PDFViewerApplication.open({
      url: URL.createObjectURL(file),
      originalUrl: file.name,
    });
  };

  // eslint-disable-next-line no-var
  var webViewerOpenFile = function (evt) {
    const fileInput = PDFViewerApplication.appConfig.openFileInput;
    fileInput.click();
  };
}

// NOTE
function webViewerPresentationMode({ source }) {
  const pdfInstance = getPdfInstance(source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.requestPresentationMode();
}

// NOTE
function webViewerSwitchAnnotationEditorMode(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.annotationEditorMode = evt.mode;
}

// NOTE
function webViewerSwitchAnnotationEditorParams(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.annotationEditorParams = evt;
}

// NOTE
function webViewerPrint(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.triggerPrinting();
}

// NOTE
function webViewerDownload(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.downloadOrSave();
}

// NOTE
function webViewerFirstPage(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.page = 1;
}

// NOTE
function webViewerLastPage(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.page = pdfInstance.pagesCount;
}

// NOTE
function webViewerNextPage(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.nextPage();
}

// NOTE
function webViewerPreviousPage(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.previousPage();
}

// NOTE
function webViewerZoomIn(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.zoomIn();
}

// NOTE
function webViewerZoomOut(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.zoomOut();
}

// NOTE
function webViewerZoomReset(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.zoomReset();
}

// NOTE
function webViewerPageNumberChanged(evt) {
  let pdfInstance
  if (evt.pdfInstance) {
    pdfInstance = evt.pdfInstance
  } else {
    pdfInstance = getPdfInstance(evt.source.toolbar)
  }
  if (!pdfInstance || typeof evt.value === 'undefined') {
    return
  }
  const pdfViewer = pdfInstance.pdfViewer;
  // Note that for `<input type="number">` HTML elements, an empty string will
  // be returned for non-number inputs; hence we simply do nothing in that case.
  if (evt.value !== "") {
    pdfInstance.pdfLinkService.goToPage(evt.value);
  }
  // NOTE
  if (evt.id) {
    hlPDFRect(pdfInstance.pdfViewer.container, evt.id)
  }
  // Ensure that the page number input displays the correct value, even if the
  // value entered by the user was invalid (e.g. a floating point number).
  if (
    evt.value !== pdfViewer.currentPageNumber.toString() &&
    evt.value !== pdfViewer.currentPageLabel
  ) {
    pdfInstance.toolbar?.setPageNumber(
      pdfViewer.currentPageNumber,
      pdfViewer.currentPageLabel
    );
  }
}

// NOTE
function webViewerScaleChanged(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.currentScaleValue = evt.value;
}

// NOTE
function webViewerRotateCw(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.rotatePages(90);
}

// NOTE
function webViewerRotateCcw(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.rotatePages(-90);
}

// NOTE
function webViewerOptionalContentConfig(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.optionalContentConfigPromise = evt.promise;
}

// NOTE
function webViewerSwitchScrollMode(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.scrollMode = evt.mode;
}

// NOTE
function webViewerSwitchSpreadMode(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.spreadMode = evt.mode;
}

// NOTE
function webViewerDocumentProperties(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfDocumentProperties?.open();
}

// NOTE
function webViewerFindFromUrlHash(evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.eventBus.dispatch("find", {
    source: evt.source,
    type: "",
    query: evt.query,
    phraseSearch: evt.phraseSearch,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
    matchDiacritics: true,
  });
}

// NOTE
function webViewerUpdateFindMatchesCount({ matchesCount, source }) {
  const pdfInstance = getPdfInstance(source._linkService.pdfViewer.container)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.supportsIntegratedFind) {
    pdfInstance.externalServices.updateFindMatchesCount(matchesCount);
  } else {
    pdfInstance.findBar.updateResultsCount(matchesCount);
  }
}

// NOTE
function webViewerUpdateFindControlState({
  state,
  previous,
  matchesCount,
  rawQuery,
  source,
}) {
  const pdfInstance = getPdfInstance(source._linkService.pdfViewer.container)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.supportsIntegratedFind) {
    pdfInstance.externalServices.updateFindControlState({
      result: state,
      findPrevious: previous,
      matchesCount,
      rawQuery,
    });
  } else {
    pdfInstance.findBar?.updateUIState(state, previous, matchesCount);
  }
}

// NOTE
function webViewerScaleChanging(evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  pdfInstance.toolbar?.setPageScale(evt.presetValue, evt.scale);

  pdfInstance.pdfViewer.update();
}

// NOTE
function webViewerRotationChanging(evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.pdfThumbnailViewer) {
    pdfInstance.pdfThumbnailViewer.pagesRotation = evt.pagesRotation;
  }

  pdfInstance.forceRendering();
  // Ensure that the active page doesn't change during rotation.
  pdfInstance.pdfViewer.currentPageNumber = evt.pageNumber;
}

// NOTE
function webViewerPageChanging({ pageNumber, pageLabel, source }) {
  const pdfInstance = getPdfInstance(source.container)
  if (!pdfInstance) {
    return
  }
  pdfInstance.toolbar?.setPageNumber(pageNumber, pageLabel);
  pdfInstance.secondaryToolbar?.setPageNumber(pageNumber);

  if (pdfInstance.pdfSidebar?.visibleView === SidebarView.THUMBS) {
    pdfInstance.pdfThumbnailViewer?.scrollThumbnailIntoView(
      pageNumber
    );
  }

  // Show/hide the loading indicator in the page number input element.
  const currentPage = pdfInstance.pdfViewer.getPageView(
    /* index = */ pageNumber - 1
  );
  pdfInstance.toolbar?.updateLoadingIndicatorState(
    currentPage?.renderingState === RenderingStates.RUNNING
  );
}

// NOTE
function webViewerResolutionChange(evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.refresh();
}

function webViewerVisibilityChange(evt) {
  if (document.visibilityState === "visible") {
    // Ignore mouse wheel zooming during tab switches (bug 1503412).
    setZoomDisabledTimeout();
  }
}

let zoomDisabledTimeout = null;
function setZoomDisabledTimeout() {
  if (zoomDisabledTimeout) {
    clearTimeout(zoomDisabledTimeout);
  }
  zoomDisabledTimeout = setTimeout(function () {
    zoomDisabledTimeout = null;
  }, WHEEL_ZOOM_DISABLED_TIMEOUT);
}

// NOTE
function webViewerWheel(evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }
  const {
    pdfViewer,
    supportedMouseWheelZoomModifierKeys,
    supportsPinchToZoom,
  } = pdfInstance;

  if (pdfViewer.isInPresentationMode) {
    return;
  }

  // Pinch-to-zoom on a trackpad maps to a wheel event with ctrlKey set to true
  // https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent#browser_compatibility
  // Hence if ctrlKey is true but ctrl key hasn't been pressed then we can
  // infer that we have a pinch-to-zoom.
  // But the ctrlKey could have been pressed outside of the browser window,
  // hence we try to do some magic to guess if the scaleFactor is likely coming
  // from a pinch-to-zoom or not.

  // It is important that we query deltaMode before delta{X,Y}, so that
  // Firefox doesn't switch to DOM_DELTA_PIXEL mode for compat with other
  // browsers, see https://bugzilla.mozilla.org/show_bug.cgi?id=1392460.
  const deltaMode = evt.deltaMode;

  // The following formula is a bit strange but it comes from:
  // https://searchfox.org/mozilla-central/rev/d62c4c4d5547064487006a1506287da394b64724/widget/InputData.cpp#618-626
  let scaleFactor = Math.exp(-evt.deltaY / 100);

  const isBuiltInMac =
    typeof PDFJSDev !== "undefined" &&
    PDFJSDev.test("MOZCENTRAL") &&
    FeatureTest.platform.isMac;
  const isPinchToZoom =
    evt.ctrlKey &&
    !pdfInstance._isCtrlKeyDown &&
    deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
    evt.deltaX === 0 &&
    (Math.abs(scaleFactor - 1) < 0.05 || isBuiltInMac) &&
    evt.deltaZ === 0;

  if (
    isPinchToZoom ||
    (evt.ctrlKey && supportedMouseWheelZoomModifierKeys.ctrlKey) ||
    (evt.metaKey && supportedMouseWheelZoomModifierKeys.metaKey)
  ) {
    // Only zoom the pages, not the entire viewer.
    evt.preventDefault();
    // NOTE: this check must be placed *after* preventDefault.
    if (zoomDisabledTimeout || document.visibilityState === "hidden") {
      return;
    }

    const previousScale = pdfViewer.currentScale;
    if (isPinchToZoom && supportsPinchToZoom) {
      scaleFactor = pdfInstance._accumulateFactor(
        previousScale,
        scaleFactor,
        "_wheelUnusedFactor"
      );
      if (scaleFactor < 1) {
        pdfInstance.zoomOut(null, scaleFactor);
      } else if (scaleFactor > 1) {
        pdfInstance.zoomIn(null, scaleFactor);
      } else {
        return;
      }
    } else {
      const delta = normalizeWheelEventDirection(evt);

      let ticks = 0;
      if (
        deltaMode === WheelEvent.DOM_DELTA_LINE ||
        deltaMode === WheelEvent.DOM_DELTA_PAGE
      ) {
        // For line-based devices, use one tick per event, because different
        // OSs have different defaults for the number lines. But we generally
        // want one "clicky" roll of the wheel (which produces one event) to
        // adjust the zoom by one step.
        if (Math.abs(delta) >= 1) {
          ticks = Math.sign(delta);
        } else {
          // If we're getting fractional lines (I can't think of a scenario
          // this might actually happen), be safe and use the accumulator.
          ticks = pdfInstance._accumulateTicks(
            delta,
            "_wheelUnusedTicks"
          );
        }
      } else {
        // pixel-based devices
        const PIXELS_PER_LINE_SCALE = 30;
        ticks = pdfInstance._accumulateTicks(
          delta / PIXELS_PER_LINE_SCALE,
          "_wheelUnusedTicks"
        );
      }

      if (ticks < 0) {
        pdfInstance.zoomOut(-ticks);
      } else if (ticks > 0) {
        pdfInstance.zoomIn(ticks);
      } else {
        return;
      }
    }

    // After scaling the page via zoomIn/zoomOut, the position of the upper-
    // left corner is restored. When the mouse wheel is used, the position
    // under the cursor should be restored instead.
    pdfInstance._centerAtPos(previousScale, evt.clientX, evt.clientY);
  } else {
    setZoomDisabledTimeout();
  }
}

// NOTE
function webViewerTouchStart(evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }
  if (
    pdfInstance.pdfViewer.isInPresentationMode ||
    evt.touches.length < 2
  ) {
    return;
  }
  evt.preventDefault();

  if (evt.touches.length !== 2) {
    pdfInstance._touchInfo = null;
    return;
  }

  let [touch0, touch1] = evt.touches;
  if (touch0.identifier > touch1.identifier) {
    [touch0, touch1] = [touch1, touch0];
  }
  pdfInstance._touchInfo = {
    touch0X: touch0.pageX,
    touch0Y: touch0.pageY,
    touch1X: touch1.pageX,
    touch1Y: touch1.pageY,
  };
}

// NOTE
function webViewerTouchMove(evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }
  if (!pdfInstance._touchInfo || evt.touches.length !== 2) {
    return;
  }

  const { pdfViewer, _touchInfo, supportsPinchToZoom } = pdfInstance;
  let [touch0, touch1] = evt.touches;
  if (touch0.identifier > touch1.identifier) {
    [touch0, touch1] = [touch1, touch0];
  }
  const { pageX: page0X, pageY: page0Y } = touch0;
  const { pageX: page1X, pageY: page1Y } = touch1;
  const {
    touch0X: pTouch0X,
    touch0Y: pTouch0Y,
    touch1X: pTouch1X,
    touch1Y: pTouch1Y,
  } = _touchInfo;

  if (
    Math.abs(pTouch0X - page0X) <= 1 &&
    Math.abs(pTouch0Y - page0Y) <= 1 &&
    Math.abs(pTouch1X - page1X) <= 1 &&
    Math.abs(pTouch1Y - page1Y) <= 1
  ) {
    // Touches are really too close and it's hard do some basic
    // geometry in order to guess something.
    return;
  }

  _touchInfo.touch0X = page0X;
  _touchInfo.touch0Y = page0Y;
  _touchInfo.touch1X = page1X;
  _touchInfo.touch1Y = page1Y;

  if (pTouch0X === page0X && pTouch0Y === page0Y) {
    // First touch is fixed, if the vectors are collinear then we've a pinch.
    const v1X = pTouch1X - page0X;
    const v1Y = pTouch1Y - page0Y;
    const v2X = page1X - page0X;
    const v2Y = page1Y - page0Y;
    const det = v1X * v2Y - v1Y * v2X;
    // 0.02 is approximatively sin(0.15deg).
    if (Math.abs(det) > 0.02 * Math.hypot(v1X, v1Y) * Math.hypot(v2X, v2Y)) {
      return;
    }
  } else if (pTouch1X === page1X && pTouch1Y === page1Y) {
    // Second touch is fixed, if the vectors are collinear then we've a pinch.
    const v1X = pTouch0X - page1X;
    const v1Y = pTouch0Y - page1Y;
    const v2X = page0X - page1X;
    const v2Y = page0Y - page1Y;
    const det = v1X * v2Y - v1Y * v2X;
    if (Math.abs(det) > 0.02 * Math.hypot(v1X, v1Y) * Math.hypot(v2X, v2Y)) {
      return;
    }
  } else {
    const diff0X = page0X - pTouch0X;
    const diff1X = page1X - pTouch1X;
    const diff0Y = page0Y - pTouch0Y;
    const diff1Y = page1Y - pTouch1Y;
    const dotProduct = diff0X * diff1X + diff0Y * diff1Y;
    if (dotProduct >= 0) {
      // The two touches go in almost the same direction.
      return;
    }
  }

  evt.preventDefault();

  const distance = Math.hypot(page0X - page1X, page0Y - page1Y) || 1;
  const pDistance = Math.hypot(pTouch0X - pTouch1X, pTouch0Y - pTouch1Y) || 1;
  const previousScale = pdfViewer.currentScale;
  if (supportsPinchToZoom) {
    const newScaleFactor = pdfInstance._accumulateFactor(
      previousScale,
      distance / pDistance,
      "_touchUnusedFactor"
    );
    if (newScaleFactor < 1) {
      pdfInstance.zoomOut(null, newScaleFactor);
    } else if (newScaleFactor > 1) {
      pdfInstance.zoomIn(null, newScaleFactor);
    } else {
      return;
    }
  } else {
    const PIXELS_PER_LINE_SCALE = 30;
    const ticks = pdfInstance._accumulateTicks(
      (distance - pDistance) / PIXELS_PER_LINE_SCALE,
      "_touchUnusedTicks"
    );
    if (ticks < 0) {
      pdfInstance.zoomOut(-ticks);
    } else if (ticks > 0) {
      pdfInstance.zoomIn(ticks);
    } else {
      return;
    }
  }

  PDFViewerApplication._centerAtPos(
    previousScale,
    (page0X + page1X) / 2,
    (page0Y + page1Y) / 2
  );
}

// NOTE
function webViewerTouchEnd(evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }
  if (!pdfInstance._touchInfo) {
    return;
  }

  evt.preventDefault();
  pdfInstance._touchInfo = null;
  pdfInstance._touchUnusedTicks = 0;
  pdfInstance._touchUnusedFactor = 1;
}

// NOTE
function webViewerClick(evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }

  // 点击后证快捷键可正常使用，select 等也可正常使用 https://github.com/siyuan-note/siyuan/issues/7869
  if (!["SELECT", "TEXTAREA", "INPUT"].includes(evt.target.tagName)) {
    pdfInstance.pdfViewer.focus();
  }

  if (!pdfInstance.secondaryToolbar?.isOpen) {
    return;
  }
  const appConfig = pdfInstance.appConfig;
  if (
    pdfInstance.pdfViewer.containsElement(evt.target) ||
    (appConfig.toolbar?.container.contains(evt.target) &&
        !appConfig.secondaryToolbar.toggleButton.contains(evt.target)) // NOTE
  ) {
    pdfInstance.secondaryToolbar.close();
  }
}

// NOTE
function webViewerKeyUp(evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }
  // evt.ctrlKey is false hence we use evt.key.
  if (evt.key === "Control") {
    pdfInstance._isCtrlKeyDown = false;
  }
  // 快捷键高亮取消
  if (evt.keyCode === 68 && pdfInstance.appConfig.toolbar.rectAnno.classList.contains('toggled')) {
    pdfInstance.appConfig.toolbar.rectAnno.dispatchEvent(
        new MouseEvent('click'))
  }
}

// NOTE
function webViewerKeyDown(evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }
  pdfInstance._isCtrlKeyDown = evt.key === "Control";

  if (pdfInstance.overlayManager.active) {
    return;
  }
  const { eventBus, pdfViewer } = pdfInstance;
  const isViewerInPresentationMode = pdfViewer.isInPresentationMode;

  let handled = false,
    ensureViewerFocused = false;
  const cmd =
    (evt.ctrlKey ? 1 : 0) |
    (evt.altKey ? 2 : 0) |
    (evt.shiftKey ? 4 : 0) |
    (evt.metaKey ? 8 : 0);

  if (cmd === 0 && [38, 40].includes(evt.keyCode)) {
    // NOTE https://github.com/siyuan-note/siyuan/issues/8164
    if (document.activeElement) {
      document.activeElement.blur();
    }
    setTimeout(() => {
      pdfViewer.focus();
    })
    return;
  }

  // NOTE
  if (!evt.repeat && (cmd === 8 || cmd === 1 || cmd === 2) && evt.keyCode === 68 &&  // D
      !pdfInstance.appConfig.toolbar.rectAnno.classList.contains('toggled')) {
    pdfInstance.appConfig.toolbar.rectAnno.dispatchEvent(
        new MouseEvent('click'))
    evt.preventDefault()
    return
  }

  if (!evt.repeat &&  cmd !== 1 && cmd !== 2 && cmd !== 4  && cmd !== 8 &&
      [48, 49, 50, 51, 52, 53, 54, 55].includes(evt.keyCode) &&
      getSelection().rangeCount > 0 &&
      !pdfInstance.appConfig.toolbar.rectAnno.classList.contains('toggled')) {
    const range = getSelection().getRangeAt(0);
    if (range.toString() !== "" && hasClosestByClassName(range.commonAncestorContainer, "pdfViewer")) {
      pdfInstance.appConfig.appContainer.dispatchEvent(new CustomEvent("click", {detail: (evt.keyCode - 48).toString()}));
      evt.preventDefault()
      return
    }
  }

  // First, handle the key bindings that are independent whether an input
  // control is selected or not.
  if (cmd === 1 || cmd === 8 || cmd === 5 || cmd === 12) {
    // either CTRL or META key with optional SHIFT.
    switch (evt.keyCode) {
      case 70: // f
        if (!pdfInstance.supportsIntegratedFind && !evt.shiftKey) {
          pdfInstance.findBar?.open();
          handled = true;
        }
        break;
      case 71: // g
        if (!pdfInstance.supportsIntegratedFind) {
          const { state } = pdfInstance.findController;
          if (state) {
            const newState = {
              source: window,
              type: "again",
              findPrevious: cmd === 5 || cmd === 12,
            };
            eventBus.dispatch("find", { ...state, ...newState });
          }
          handled = true;
        }
        break;
      case 61: // FF/Mac '='
      case 107: // FF '+' and '='
      case 187: // Chrome '+'
      case 171: // FF with German keyboard
        pdfInstance.zoomIn();
        handled = true;
        break;
      case 173: // FF/Mac '-'
      case 109: // FF '-'
      case 189: // Chrome '-'
        pdfInstance.zoomOut();
        handled = true;
        break;
      case 48: // '0'
      case 96: // '0' on Numpad of Swedish keyboard
        if (!isViewerInPresentationMode) {
          // keeping it unhandled (to restore page zoom to 100%)
          setTimeout(function () {
            // ... and resetting the scale after browser adjusts its scale
            pdfInstance.zoomReset();
          });
          handled = false;
        }
        break;

      case 38: // up arrow
        if (isViewerInPresentationMode || pdfInstance.page > 1) {
          pdfInstance.page = 1;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
      case 40: // down arrow
        if (
          isViewerInPresentationMode ||
          pdfInstance.page < pdfInstance.pagesCount
        ) {
          PDFViewerApplication.page = PDFViewerApplication.pagesCount;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
    }
  }

  // NOTE
  // if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC || CHROME")) {
  //   // CTRL or META without shift
  //   if (cmd === 1 || cmd === 8) {
  //     switch (evt.keyCode) {
  //       case 83: // s
  //         eventBus.dispatch("download", { source: window });
  //         handled = true;
  //         break;
  //
  //       case 79: // o
  //         if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
  //           eventBus.dispatch("openfile", { source: window });
  //           handled = true;
  //         }
  //         break;
  //     }
  //   }
  // }

  // CTRL+ALT or Option+Command
  if (cmd === 3 || cmd === 10) {
    switch (evt.keyCode) {
      case 80: // p
        pdfInstance.requestPresentationMode();
        handled = true;
        pdfInstance.externalServices.reportTelemetry({
          type: "buttons",
          data: { id: "presentationModeKeyboard" },
        });
        break;
      case 71: // g
        // focuses input#pageNumber field
        if (pdfInstance.appConfig.toolbar) {
          pdfInstance.appConfig.toolbar.pageNumber.select();
          handled = true;
        }
        break;
    }
  }

  if (handled) {
    if (ensureViewerFocused && !isViewerInPresentationMode) {
      pdfViewer.focus();
    }
    evt.preventDefault();
    return;
  }

  // Some shortcuts should not get handled if a control/input element
  // is selected.
  const curElement = getActiveOrFocusedElement();
  const curElementTagName = curElement?.tagName.toUpperCase();
  if (
    curElementTagName === "INPUT" ||
    curElementTagName === "TEXTAREA" ||
    curElementTagName === "SELECT" ||
    curElement?.isContentEditable
  ) {
    // Make sure that the secondary toolbar is closed when Escape is pressed.
    if (evt.keyCode !== /* Esc = */ 27) {
      return;
    }
  }

  // No control key pressed at all.
  if (cmd === 0) {
    let turnPage = 0,
      turnOnlyIfPageFit = false;
    switch (evt.keyCode) {
      case 38: // up arrow
      case 33: // pg up
        // vertical scrolling using arrow/pg keys
        if (pdfViewer.isVerticalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
        turnPage = -1;
        break;
      case 8: // backspace
        if (!isViewerInPresentationMode) {
          turnOnlyIfPageFit = true;
        }
        turnPage = -1;
        break;
      case 37: // left arrow
        // horizontal scrolling using arrow keys
        if (pdfViewer.isHorizontalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
      /* falls through */
      case 75: // 'k'
      case 80: // 'p'
        turnPage = -1;
        break;
      case 27: // esc key
        if (pdfInstance.secondaryToolbar?.isOpen) {
          pdfInstance.secondaryToolbar.close();
          handled = true;
        }
        if (
          !pdfInstance.supportsIntegratedFind &&
          pdfInstance.findBar?.opened
        ) {
          pdfInstance.findBar.close();
          handled = true;
        }
        break;
      case 40: // down arrow
      case 34: // pg down
        // vertical scrolling using arrow/pg keys
        if (pdfViewer.isVerticalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
        turnPage = 1;
        break;
      case 13: // enter key
      case 32: // spacebar
        if (!isViewerInPresentationMode) {
          turnOnlyIfPageFit = true;
        }
        turnPage = 1;
        break;
      case 39: // right arrow
        // horizontal scrolling using arrow keys
        if (pdfViewer.isHorizontalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
      /* falls through */
      case 74: // 'j'
      case 78: // 'n'
        turnPage = 1;
        break;

      case 36: // home
        if (isViewerInPresentationMode || pdfInstance.page > 1) {
          pdfInstance.page = 1;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
      case 35: // end
        if (
          isViewerInPresentationMode ||
          pdfInstance.page < pdfInstance.pagesCount
        ) {
          pdfInstance.page = pdfInstance.pagesCount;
          handled = true;
          ensureViewerFocused = true;
        }
        break;

      case 83: // 's'
        pdfInstance.pdfCursorTools?.switchTool(CursorTool.SELECT);
        break;
      case 72: // 'h'
        pdfInstance.pdfCursorTools?.switchTool(CursorTool.HAND);
        break;

      case 82: // 'r'
        pdfInstance.rotatePages(90);
        break;

      case 115: // F4
        pdfInstance.pdfSidebar?.toggle();
        break;
    }

    if (
      turnPage !== 0 &&
      (!turnOnlyIfPageFit || pdfViewer.currentScaleValue === "page-fit")
    ) {
      if (turnPage > 0) {
        pdfViewer.nextPage();
      } else {
        pdfViewer.previousPage();
      }
      handled = true;
    }
  }

  // shift-key
  if (cmd === 4) {
    switch (evt.keyCode) {
      case 13: // enter key
      case 32: // spacebar
        if (
          !isViewerInPresentationMode &&
          pdfViewer.currentScaleValue !== "page-fit"
        ) {
          break;
        }
        pdfViewer.previousPage();

        handled = true;
        break;

      case 82: // 'r'
        pdfInstance.rotatePages(-90);
        break;
    }
  }

  if (!handled && !isViewerInPresentationMode) {
    // 33=Page Up  34=Page Down  35=End    36=Home
    // 37=Left     38=Up         39=Right  40=Down
    // 32=Spacebar
    if (
      (evt.keyCode >= 33 && evt.keyCode <= 40) ||
      (evt.keyCode === 32 && curElementTagName !== "BUTTON")
    ) {
      ensureViewerFocused = true;
    }
  }

  if (ensureViewerFocused && !pdfViewer.containsElement(curElement)) {
    // The page container is not focused, but a page navigation key has been
    // pressed. Change the focus to the viewer container to make sure that
    // navigation by keyboard works as expected.
    pdfViewer.focus();
  }

  if (handled) {
    evt.preventDefault();
  }
}

function beforeUnload(evt) {
  evt.preventDefault();
  evt.returnValue = "";
  return false;
}

// NOTE
function webViewerAnnotationEditorStatesChanged(data) {
  const pdfInstance = getPdfInstance(data.target)
  if (!pdfInstance || pdfInstance.overlayManager.active) {
    return
  }
  pdfInstance.externalServices.updateEditorStates(data);
}

/* Abstract factory for the print service. */
const PDFPrintServiceFactory = {
  instance: {
    supportsPrinting: false,
    createPrintService() {
      throw new Error("Not implemented: createPrintService");
    },
  },
};

// NOTE
export {
  PDFPrintServiceFactory,
  PDFViewerApplication,
  webViewerPageNumberChanged,
};
