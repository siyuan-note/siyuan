package conf

import (
	"math"
	"strconv"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// NormalizeFileTree 统一文档树偏好边界；默认图标的版本迁移由加载入口处理。
func NormalizeFileTree(fileTree *FileTree) *FileTree {
	if fileTree == nil {
		fileTree = NewFileTree()
	}
	if fileTree.MaxListCount < 1 {
		fileTree.MaxListCount = 512
	}
	fileTree.MaxListCount = min(10240, fileTree.MaxListCount)
	if fileTree.MaxOpenTabCount < 1 {
		fileTree.MaxOpenTabCount = 8
	}
	fileTree.MaxOpenTabCount = min(fileTree.MaxOpenTabCount, 32)
	if fileTree.DocIconClickMode < 0 || fileTree.DocIconClickMode > 1 {
		fileTree.DocIconClickMode = 0
	}
	if fileTree.ParentDocTitleClickMode < 0 || fileTree.ParentDocTitleClickMode > 2 {
		fileTree.ParentDocTitleClickMode = 0
	}
	if fileTree.TabStartupMode == nil {
		fileTree.TabStartupMode = new(int)
		if fileTree.CloseTabsOnStart {
			*fileTree.TabStartupMode = 2
		}
	}
	if *fileTree.TabStartupMode < 0 || *fileTree.TabStartupMode > 2 {
		fileTree.TabStartupMode = new(int)
	}
	fileTree.CloseTabsOnStart = *fileTree.TabStartupMode == 2
	fileTree.DocCreateSavePath = util.TrimSpaceInPath(fileTree.DocCreateSavePath)
	fileTree.DocCreateTemplatePath = util.NormalizeTemplatePath(fileTree.DocCreateTemplatePath)
	fileTree.RefCreateSavePath = util.TrimSpaceInPath(fileTree.RefCreateSavePath)
	fileTree.ShorthandSavePath = util.TrimSpaceInPath(fileTree.ShorthandSavePath)
	if fileTree.ShorthandSavePath != "" && !strings.HasPrefix(fileTree.ShorthandSavePath, "/") {
		fileTree.ShorthandSavePath = "/" + fileTree.ShorthandSavePath
	}
	if fileTree.LargeFileWarningSize < 2 {
		fileTree.LargeFileWarningSize = 8
	}
	fileTree.LargeFileWarningSize = min(10240, fileTree.LargeFileWarningSize)
	if fileTree.CreateDocAtTop == nil {
		fileTree.CreateDocAtTop = new(true)
	}
	fileTree.RecentDocsMaxListCount = max(MinFileTreeRecentDocsListCount, min(MaxFileTreeRecentDocsListCount, fileTree.RecentDocsMaxListCount))
	switch fileTree.RecentDocsSort {
	case "viewedAt", "created", "updated", "openAt", "closedAt":
	default:
		fileTree.RecentDocsSort = "viewedAt"
	}
	return fileTree
}

// NormalizeEditor 保留合法的历史配置，并为缺失字段和越界值补全默认值。
func NormalizeEditor(editor *Editor) *Editor {
	defaults := NewEditor()
	if editor == nil {
		editor = defaults
	}
	if editor.BacklinkSort == nil {
		editor.BacklinkSort = defaults.BacklinkSort
	}
	if editor.BackmentionSort == nil {
		editor.BackmentionSort = defaults.BackmentionSort
	}
	if editor.DatabaseAttrShow == nil {
		editor.DatabaseAttrShow = defaults.DatabaseAttrShow
	}
	if editor.DatabaseAttrUseTabs == nil {
		editor.DatabaseAttrUseTabs = defaults.DatabaseAttrUseTabs
	}
	if editor.CheckBlockRef == nil {
		editor.CheckBlockRef = defaults.CheckBlockRef
	}
	if editor.HashTagSearch == nil {
		editor.HashTagSearch = defaults.HashTagSearch
	}
	editor.AssetOpen = NormalizeAssetOpen(editor.AssetOpen)
	editor.NormalizeFontFamilies()
	editor.Emoji = util.FilterRecentIconValues(editor.Emoji)
	if editor.FontSize < 9 || editor.FontSize > 72 {
		editor.FontSize = 16
	}
	if editor.BacklinkGlobalSort < 0 || editor.BacklinkGlobalSort > 2 {
		editor.BacklinkGlobalSort = defaults.BacklinkGlobalSort
	}
	if editor.BacklinkBlockSort < 0 || editor.BacklinkBlockSort > 2 {
		editor.BacklinkBlockSort = defaults.BacklinkBlockSort
	}
	if editor.FloatWindowMode < 0 || editor.FloatWindowMode > 2 {
		editor.FloatWindowMode = defaults.FloatWindowMode
	}
	if editor.HeadingEmbedMode < 0 || editor.HeadingEmbedMode > 2 {
		editor.HeadingEmbedMode = defaults.HeadingEmbedMode
	}
	if editor.DatabaseAttrClickMode < 0 || editor.DatabaseAttrClickMode > 1 {
		editor.DatabaseAttrClickMode = defaults.DatabaseAttrClickMode
	}
	if editor.DatabaseAttrViewMode < 0 || editor.DatabaseAttrViewMode > 1 {
		editor.DatabaseAttrViewMode = defaults.DatabaseAttrViewMode
	}
	switch editor.CodeTabSpaces {
	case 0, 2, 4, 6, 8:
	default:
		editor.CodeTabSpaces = defaults.CodeTabSpaces
	}
	if editor.PlantUMLServePath == "" {
		editor.PlantUMLServePath = defaults.PlantUMLServePath
	}
	if editor.KaTexMacros == "" {
		editor.KaTexMacros = "{}"
	}
	if editor.BlockRefDynamicAnchorTextMaxLen < 1 {
		editor.BlockRefDynamicAnchorTextMaxLen = 64
	}
	editor.BlockRefDynamicAnchorTextMaxLen = min(5120, editor.BlockRefDynamicAnchorTextMaxLen)
	editor.GenerateHistoryInterval = min(1440, editor.GenerateHistoryInterval)
	if editor.HistoryRetentionDays < 1 {
		editor.HistoryRetentionDays = 30
	}
	editor.HistoryRetentionDays = min(3650, editor.HistoryRetentionDays)
	if editor.FloatWindowDelay == nil {
		editor.FloatWindowDelay = new(620)
	} else {
		editor.FloatWindowDelay = new(max(0, min(2000, *editor.FloatWindowDelay)))
	}
	editor.CursorSurroundingLines = NormalizeCursorSurroundingLines(editor.CursorSurroundingLines)
	editor.DynamicLoadBlocks = max(MinDynamicLoadBlocks, editor.DynamicLoadBlocks)
	if len(editor.SpellcheckLanguages) == 0 {
		editor.SpellcheckLanguages = []string{"en-US"}
	}
	editor.BacklinkExpandCount = NormalizeBacklinkExpandCount(editor.BacklinkExpandCount)
	editor.BackmentionExpandCount = NormalizeBacklinkExpandCount(editor.BackmentionExpandCount)
	if editor.HeadingNumberFormat == "" {
		editor.HeadingNumberFormat = DefaultHeadingNumberFormat
	}
	if editor.Markdown == nil {
		editor.Markdown = &util.Markdown{}
	}
	if editor.Markdown.CodeBlockMiddleDot == nil {
		editor.Markdown.CodeBlockMiddleDot = defaults.Markdown.CodeBlockMiddleDot
	}
	if editor.Markdown.BlockFullWidthTaskList == nil {
		editor.Markdown.BlockFullWidthTaskList = defaults.Markdown.BlockFullWidthTaskList
	}
	return editor
}

// NormalizeExport 补全缺失的导出配置，不推断配置格式版本。
func NormalizeExport(export *Export) *Export {
	defaults := NewExport()
	if export == nil {
		export = defaults
	}
	if export.BlockEmbedMode < 0 || export.BlockEmbedMode > 1 {
		export.BlockEmbedMode = defaults.BlockEmbedMode
	}
	if export.FileAnnotationRefMode < 0 || export.FileAnnotationRefMode > 1 {
		export.FileAnnotationRefMode = defaults.FileAnnotationRefMode
	}
	return export
}

// MigrateExportBlockRefMode 转换旧格式的块引用导出模式，保留其余模式。
func MigrateExportBlockRefMode(export *Export) bool {
	if export != nil && (export.BlockRefMode == 0 || export.BlockRefMode == 1 || export.BlockRefMode == 5) {
		export.BlockRefMode = 4
		return true
	}
	return false
}

// NormalizeSearch 保留非空布尔指针表示的用户选择。
func NormalizeSearch(search *Search) *Search {
	if search == nil {
		search = NewSearch()
	}
	if search.CustomBlock == nil {
		search.CustomBlock = new(true)
	}
	if search.Mindmap == nil {
		search.Mindmap = new(true)
	}
	if search.MindmapItem == nil {
		search.MindmapItem = new(false)
	}
	if search.Limit < 1 {
		search.Limit = 64
	}
	search.Limit = max(32, min(10240, search.Limit))
	if search.BacklinkMentionKeywordsLimit < 1 {
		search.BacklinkMentionKeywordsLimit = 512
	}
	if search.HanSensitive == nil {
		search.SetHanSensitive(true)
	}
	return search
}

// NormalizeFlashcard 返回权重修复原因，由调用入口决定是否通知用户。
func NormalizeFlashcard(flashcard *Flashcard) (*Flashcard, string) {
	defaults := NewFlashcard()
	if flashcard == nil {
		flashcard = defaults
	}
	if flashcard.ReviewMode < 0 || flashcard.ReviewMode > 2 {
		flashcard.ReviewMode = defaults.ReviewMode
	}
	if flashcard.NewCardLimit < 0 {
		flashcard.NewCardLimit = defaults.NewCardLimit
	}
	if flashcard.ReviewCardLimit < 0 {
		flashcard.ReviewCardLimit = defaults.ReviewCardLimit
	}
	if flashcard.RequestRetention <= 0 || flashcard.RequestRetention >= 1 || math.IsNaN(flashcard.RequestRetention) {
		flashcard.RequestRetention = defaults.RequestRetention
	}
	if flashcard.MaximumInterval <= 0 || flashcard.MaximumInterval >= 36500 {
		flashcard.MaximumInterval = defaults.MaximumInterval
	}
	if flashcard.Weights == "" {
		flashcard.Weights = defaults.Weights
	}
	message := ""
	weights := strings.Split(flashcard.Weights, ",")
	if len(weights) != 19 {
		message = "fsrs store weights length must be [19]"
	} else {
		for _, weight := range weights {
			value, err := strconv.ParseFloat(strings.TrimSpace(weight), 64)
			if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
				message = "fsrs store weights contain invalid number"
				break
			}
		}
	}
	if message != "" {
		flashcard.Weights = defaults.Weights
	}
	return flashcard, message
}

// NormalizeAppearance 补全外观缺失字段，并将已移除的图标包和越界的状态栏配置转换为当前可用值。
// mobile 表示是否为移动端容器，决定状态栏默认项。
func NormalizeAppearance(appearance *Appearance, mobile bool) *Appearance {
	if appearance == nil {
		appearance = NewAppearanceForContainer(mobile)
	}
	if appearance.CloseButtonBehavior < 0 || appearance.CloseButtonBehavior > 1 {
		appearance.CloseButtonBehavior = 0
	}
	if "ant" == appearance.Icon || "material" == appearance.Icon {
		// v3.7.0 移除了 ant/material 图标包 https://github.com/siyuan-note/siyuan/issues/7976
		appearance.Icon = "litheness"
	}
	if "" == appearance.CodeBlockThemeDark {
		appearance.CodeBlockThemeDark = "dracula"
	}
	if "" == appearance.CodeBlockThemeLight {
		appearance.CodeBlockThemeLight = "github"
	}
	appearance.StatusBar = util.NormalizeStatusBar(appearance.StatusBar, mobile)
	if appearance.PDFTheme == nil {
		appearance.PDFTheme = NewPDFTheme()
	}
	if appearance.PDFTheme.Light != "light" && appearance.PDFTheme.Light != "dark" {
		appearance.PDFTheme.Light = "light"
	}
	if appearance.PDFTheme.Dark != "light" && appearance.PDFTheme.Dark != "dark" {
		appearance.PDFTheme.Dark = "dark"
	}
	if strings.TrimSpace(appearance.PDFTheme.AnnoColor) == "" {
		appearance.PDFTheme.AnnoColor = NewPDFTheme().AnnoColor
	}
	if appearance.MobileBars == nil {
		appearance.MobileBars = NewMobileBars()
	}
	if appearance.MobileBars.AutoHide == nil {
		appearance.MobileBars.AutoHide = new(true)
	}
	if appearance.MobileBars.SidebarSwipe == nil {
		appearance.MobileBars.SidebarSwipe = new(true)
	}
	if appearance.MobileBars.SidebarButtons == nil {
		appearance.MobileBars.SidebarButtons = new(true)
	}
	// 至少保留一种侧栏访问方式。
	if !*appearance.MobileBars.SidebarSwipe && !*appearance.MobileBars.SidebarButtons {
		appearance.MobileBars.SidebarButtons = new(true)
	}
	if nil == appearance.Notifications {
		appearance.Notifications = util.NewNotifications()
	}
	appearance.EntryVisibility = NormalizeEntryVisibility(appearance.EntryVisibility, EntryVisibilityProfileFull)
	appearance.NormalizeGlobalFontFamilies()
	return appearance
}

// NormalizeSync 限定同步间隔和并发数范围，并补全各存储服务的连接参数。
func NormalizeSync(sync *Sync) *Sync {
	if sync == nil {
		sync = NewSync()
	}
	if sync.AssetDownloadMode < 0 || sync.AssetDownloadMode > 1 {
		sync.AssetDownloadMode = 0
	}
	if 0 == sync.Mode {
		sync.Mode = 1
	}
	sync.Interval = max(30, min(60*60*12, sync.Interval))
	if nil == sync.S3 {
		sync.S3 = &S3{PathStyle: true, SkipTlsVerify: true}
	}
	sync.S3.Endpoint = util.NormalizeEndpoint(sync.S3.Endpoint)
	sync.S3.Timeout = util.NormalizeTimeout(sync.S3.Timeout)
	sync.S3.ConcurrentReqs = util.NormalizeConcurrentReqs(sync.S3.ConcurrentReqs, ProviderS3)
	if nil == sync.WebDAV {
		sync.WebDAV = &WebDAV{SkipTlsVerify: true}
	}
	sync.WebDAV.Endpoint = util.NormalizeEndpoint(sync.WebDAV.Endpoint)
	sync.WebDAV.Timeout = util.NormalizeTimeout(sync.WebDAV.Timeout)
	sync.WebDAV.ConcurrentReqs = util.NormalizeConcurrentReqs(sync.WebDAV.ConcurrentReqs, ProviderWebDAV)
	if nil == sync.Local {
		sync.Local = &Local{}
	}
	sync.Local.Endpoint = util.NormalizeLocalPath(sync.Local.Endpoint)
	sync.Local.Timeout = util.NormalizeTimeout(sync.Local.Timeout)
	sync.Local.ConcurrentReqs = util.NormalizeConcurrentReqs(sync.Local.ConcurrentReqs, ProviderLocal)
	if nil == sync.LAN {
		sync.LAN = &LANSync{MaxConcurrentReqs: 16}
	}
	if 1 > sync.LAN.MaxConcurrentReqs {
		sync.LAN.MaxConcurrentReqs = 16
	}
	sync.LAN.MaxConcurrentReqs = min(128, sync.LAN.MaxConcurrentReqs)
	return sync
}

// NormalizeSystem 补全系统配置的设备标识和网络代理；运行环境信息由加载入口按当前进程投影。
func NormalizeSystem(system *System) *System {
	if system == nil {
		system = NewSystem()
	}
	if system.AutoLaunch2 < 0 || system.AutoLaunch2 > 2 {
		system.AutoLaunch2 = 0
	}
	if system.LockScreenMode < 0 || system.LockScreenMode > 1 {
		system.LockScreenMode = 0
	}
	if nil == system.NetworkProxy {
		system.NetworkProxy = &NetworkProxy{}
	}
	if nil == system.DisabledFeatures {
		system.DisabledFeatures = []string{}
	}
	return system
}

// NormalizeRepo 限定数据仓库索引提示阈值和自动清理保留策略的下限。
func NormalizeRepo(repo *Repo) *Repo {
	defaults := NewRepo()
	if repo == nil {
		repo = defaults
	}
	repo.SyncIndexTiming = max(defaults.SyncIndexTiming, repo.SyncIndexTiming)
	if 1 > repo.IndexRetentionDays {
		repo.IndexRetentionDays = defaults.IndexRetentionDays
	}
	if 1 > repo.RetentionIndexesDaily {
		repo.RetentionIndexesDaily = defaults.RetentionIndexesDaily
	}
	return repo
}

// NormalizeGraph 在全局或局部关系图配置缺失时整体恢复默认值，否则仅限定最大块数。
func NormalizeGraph(graph *Graph) *Graph {
	if graph == nil || graph.Local == nil || graph.Global == nil {
		return NewGraph()
	}
	graph.NormalizeMaxBlocks()
	return graph
}

// NormalizeOCR 将已合并的内置模型名称转换为当前名称；缺失配置的默认来源由加载入口决定。
func NormalizeOCR(ocr *OCR) *OCR {
	if ocr == nil {
		ocr = NewOCR()
	}
	if ocr.ShowText == nil {
		ocr.ShowText = new(true)
	}
	if "small" == ocr.Model {
		// 内置模型统一为 Tiny，自行导入的模型仍保留内容摘要标识。
		ocr.Model = "tiny"
	}
	return ocr
}

// NormalizeAI 补全人工智能配置并对齐模型标识；密钥解密由加载入口负责。
func NormalizeAI(ai *AI) *AI {
	if ai == nil {
		ai = NewAI()
	}
	ai.Normalize()
	ai.ReconcileModelIDs()
	return ai
}

// NormalizeOIDC 补全 OpenID Connect 配置；环境变量覆盖和密钥解密由加载入口负责。
func NormalizeOIDC(oidc *OIDC) *OIDC {
	if oidc == nil {
		oidc = NewOIDC()
	}
	oidc.Normalize()
	return oidc
}

// NormalizePublish 保证发布服务始终带有认证配置，避免空认证配置写入后导致启动失败。
func NormalizePublish(publish *Publish) *Publish {
	if publish == nil {
		publish = NewPublish()
	}
	if nil == publish.Auth {
		publish.Auth = NewPublish().Auth
	}
	return publish
}

// NormalizeSnippet 在代码片段配置缺失时使用默认值。
func NormalizeSnippet(snippet *Snpt) *Snpt {
	if snippet == nil {
		snippet = NewSnpt()
	}
	return snippet
}

// NormalizeTag 在标签面板配置缺失时使用默认值。
func NormalizeTag(tag *Tag) *Tag {
	if tag == nil {
		tag = NewTag()
	}
	return tag
}

// NormalizeStat 在统计配置缺失时使用默认值。
func NormalizeStat(stat *Stat) *Stat {
	if stat == nil {
		stat = NewStat()
	}
	return stat
}

// NormalizeBazaar 在集市配置缺失时使用默认值。
func NormalizeBazaar(bazaar *Bazaar) *Bazaar {
	if bazaar == nil {
		bazaar = NewBazaar()
	}
	return bazaar
}

// NormalizeAPI 在 API 配置缺失时使用默认值。
func NormalizeAPI(api *API) *API {
	if api == nil {
		api = NewAPI()
	}
	return api
}

// NormalizeNotebookCrypto 在加密笔记本密钥管理配置缺失时使用默认值，已有配置原样保留。
func NormalizeNotebookCrypto(notebookCrypto *NotebookCrypto) *NotebookCrypto {
	if notebookCrypto == nil {
		notebookCrypto = NewNotebookCrypto()
	}
	return notebookCrypto
}

// NormalizeSecrets 在密钥库缺失时使用默认值；解密由加载入口负责。
func NormalizeSecrets(secrets *Secrets) *Secrets {
	if secrets == nil {
		secrets = NewSecrets()
	}
	return secrets
}

// NormalizeVariables 在变量库缺失时使用默认值。
func NormalizeVariables(variables *Variables) *Variables {
	if variables == nil {
		variables = NewVariables()
	}
	return variables
}

// NormalizeKeymap 在快捷键配置缺失时使用空配置，内置快捷键由前端按平台补全。
func NormalizeKeymap(keymap *Keymap) *Keymap {
	if keymap == nil {
		keymap = &Keymap{}
	}
	return keymap
}

// NormalizeUILayout 在界面布局缺失时使用空布局。
func NormalizeUILayout(uiLayout *UILayout) *UILayout {
	if uiLayout == nil {
		uiLayout = &UILayout{}
	}
	return uiLayout
}

// NormalizeOnboarding 在首次使用引导状态缺失时视为已完成，避免已有工作空间重复引导。
func NormalizeOnboarding(onboarding *Onboarding) *Onboarding {
	if onboarding == nil {
		onboarding = &Onboarding{State: OnboardingCompleted}
	}
	return onboarding
}
