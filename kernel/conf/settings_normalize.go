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
	if fileTree.CreateDocAtTop == nil {
		fileTree.CreateDocAtTop = new(true)
	}
	if fileTree.BoxDocEnabled == nil {
		fileTree.BoxDocEnabled = new(false)
	}
	fileTree.RecentDocsMaxListCount = max(MinFileTreeRecentDocsListCount, min(MaxFileTreeRecentDocsListCount, fileTree.RecentDocsMaxListCount))
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

// NormalizeExport 将已废弃的块引用导出模式统一转换为脚注与锚点哈希模式。
func NormalizeExport(export *Export) *Export {
	if export == nil {
		export = NewExport()
	}
	if export.BlockRefMode == 0 || export.BlockRefMode == 1 || export.BlockRefMode == 5 {
		export.BlockRefMode = 4
	}
	return export
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
	search.Limit = max(32, search.Limit)
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
