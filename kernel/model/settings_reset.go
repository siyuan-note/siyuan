package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 仅清理内置偏好；保存的布局、插件数据、最近记录和未知键保持不变。
var resetSettingsStorageKeys = []string{
	"local-zoom", "local-settings-window-mode", "local-searchdata", "local-searchasset", "local-searchunref",
	"local-exportpdf", "local-exportword", "local-exportimg", "local-pdftheme", "local-flashcard",
	"local-mobile-bars", "local-mobile-bottom-bar", "local-mobile-side-panel", "local-outline",
	"local-fileposition", "local-dialogposition",
}

func defaultWorkspaceSettings(current *AppConf) *AppConf {
	next := *current
	next.Editor = conf.NewEditor()
	next.Editor.Markdown = util.NewMarkdown()
	next.Editor.NormalizeFontFamilies()
	if current.Editor != nil {
		next.Editor.HistoryRetentionDays = current.Editor.HistoryRetentionDays
		next.Editor.Emoji = current.Editor.Emoji
	}
	next.FileTree = conf.NewFileTree()
	next.FileTree.UseSingleLineSave = util.DefaultUseSingleLineSave
	next.FileTree.LargeFileWarningSize = util.DefaultLargeFileWarningSize
	next.FileTree.RecentDocsMaxListCount = conf.MinFileTreeRecentDocsListCount
	next.Tag = conf.NewTag()
	next.Export = conf.NewExport()
	next.Search = conf.NewSearch()
	next.Graph = conf.NewGraph()
	next.Flashcard = conf.NewFlashcard()
	next.OCR = conf.NewOCR(util.IsMobileContainer())
	next.Appearance = conf.NewAppearance()
	next.Appearance.Lang = current.Lang
	if current.Appearance != nil {
		next.Appearance.Mode = current.Appearance.Mode
		next.Appearance.DarkThemes = current.Appearance.DarkThemes
		next.Appearance.LightThemes = current.Appearance.LightThemes
		next.Appearance.Icons = current.Appearance.Icons
	}
	next.UILayout = &conf.UILayout{}
	keymap := conf.Keymap{}
	if current.Keymap != nil {
		// 内置快捷键在前端启动时按平台补全，插件快捷键完整保留。
		for key, value := range *current.Keymap {
			if key != "general" && key != "editor" {
				keymap[key] = value
			}
		}
	}
	next.Keymap = &keymap
	if current.System != nil {
		system := *current.System
		system.DownloadInstallPkg = conf.NewSystem().DownloadInstallPkg
		next.System = &system
	}
	return &next
}

// ResetSettings 仅替换普通偏好。磁盘提交前不发布内存状态，敏感配置不经过前端往返。
func ResetSettings() error {
	if util.ReadOnly {
		return errors.New("read-only mode")
	}
	Conf.m.Lock()
	localStorageLock.Lock()
	bootAppearanceConfLock.Lock()
	defer Conf.m.Unlock()
	defer localStorageLock.Unlock()
	defer bootAppearanceConfLock.Unlock()
	if err := recoverSettingsReset(); err != nil {
		return err
	}
	next := defaultWorkspaceSettings(Conf)
	config, err := next.marshalForSave()
	if err != nil {
		return err
	}
	storage := map[string]json.RawMessage{}
	data, err := filelock.ReadFile(settingsResetPaths()[1])
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err == nil {
		if err = json.Unmarshal(data, &storage); err != nil || storage == nil {
			return errors.New("invalid local settings storage")
		}
	}
	for _, key := range resetSettingsStorageKeys {
		delete(storage, key)
	}
	local, err := json.MarshalIndent(storage, "", "  ")
	if err != nil {
		return err
	}
	boot, err := json.Marshal(defaultBootAppearanceSelection())
	if err != nil {
		return err
	}
	if err = writeSettingsReset([][]byte{config, local, boot}, filelock.WriteFile); err != nil {
		return err
	}
	Conf.Editor, Conf.FileTree, Conf.Tag = next.Editor, next.FileTree, next.Tag
	Conf.Export, Conf.Search, Conf.Graph = next.Export, next.Search, next.Graph
	Conf.Flashcard, Conf.OCR, Conf.Appearance = next.Flashcard, next.OCR, next.Appearance
	Conf.UILayout, Conf.Keymap = next.UILayout, next.Keymap
	if Conf.System != nil {
		Conf.System.DownloadInstallPkg = next.System.DownloadInstallPkg
	}
	return nil
}

// ApplyResetSettings 更新运行时依赖，索引按现有队列重建，不修改笔记本密钥或历史保留策略。
func ApplyResetSettings(previousSearch *conf.Search) {
	util.MarkdownSettings = Conf.Editor.Markdown
	util.UseSingleLineSave = Conf.FileTree.UseSingleLineSave
	util.LargeFileWarningSize = Conf.FileTree.LargeFileWarningSize
	util.StatusBarCfg = Conf.Appearance.StatusBar
	util.NotificationsCfg = Conf.Appearance.Notifications
	ChangeHistoryTick(Conf.Editor.GenerateHistoryInterval)
	ResetVirtualBlockRefCache()
	RefreshBoxDocFeature()
	refreshAppearanceConfig()
	WatchThemes()
	sql.SetCaseSensitive(Conf.Search.CaseSensitive)
	sql.SetHanSensitive(Conf.Search.HanSensitiveVal())
	sql.SetIndexAssetPath(Conf.Search.IndexAssetPath)
	go nativePaddle.Close()
	if previousSearch == nil || previousSearch.CaseSensitive != Conf.Search.CaseSensitive ||
		previousSearch.HanSensitiveVal() != Conf.Search.HanSensitiveVal() ||
		previousSearch.IndexAssetPath != Conf.Search.IndexAssetPath {
		// 队列重建会重新加载闪卡调度参数，保留卡片和复习进度。
		task.AppendTask(task.DatabaseIndexFull, fullReindex)
	} else {
		deckLock.Lock()
		waitForSyncingStorages()
		LoadFlashcards()
		deckLock.Unlock()
	}
}

type settingsResetFile struct {
	Exists bool   `json:"exists"`
	Data   []byte `json:"data"`
}

type settingsResetJournal struct {
	Version int                 `json:"version"`
	Files   []settingsResetFile `json:"files"`
}

func settingsResetPaths() []string {
	return []string{filepath.Join(util.ConfDir, "conf.json"), filepath.Join(util.DataDir, "storage", "local.json"),
		filepath.Join(util.ConfDir, bootAppearanceConfigName)}
}

func settingsResetJournalPath() string { return filepath.Join(util.ConfDir, "settings-reset.json") }

// writeSettingsReset 只协调三个固定配置文件；恢复日志保存原始磁盘字节，凭据维持已有加密形式。
func writeSettingsReset(next [][]byte, write func(string, []byte) error) error {
	paths := settingsResetPaths()
	journal := settingsResetJournal{Version: 1}
	for _, path := range paths {
		data, err := filelock.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && !json.Valid(data) {
			return errors.New("invalid settings file")
		}
		journal.Files = append(journal.Files, settingsResetFile{Exists: err == nil, Data: data})
	}
	data, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	if err = gulu.File.WriteFileSafer(settingsResetJournalPath(), data, 0600); err != nil {
		return err
	}
	for i, path := range paths {
		if err = os.MkdirAll(filepath.Dir(path), 0755); err == nil {
			err = write(path, next[i])
		}
		if err != nil {
			return errors.Join(err, recoverSettingsReset())
		}
	}
	if err = os.Remove(settingsResetJournalPath()); err != nil {
		return errors.Join(err, recoverSettingsReset())
	}
	return nil
}

// recoverSettingsReset 在读取主配置之前回滚未提交操作，未知日志保持原样并阻止继续启动。
func recoverSettingsReset() error {
	data, err := os.ReadFile(settingsResetJournalPath())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var journal settingsResetJournal
	paths := settingsResetPaths()
	if err = json.Unmarshal(data, &journal); err != nil {
		return err
	}
	if journal.Version != 1 || len(journal.Files) != len(paths) {
		return errors.New("unsupported settings reset journal")
	}
	for _, original := range journal.Files {
		if original.Exists && !json.Valid(original.Data) || !original.Exists && len(original.Data) != 0 {
			return errors.New("invalid settings reset journal data")
		}
	}
	for i, original := range journal.Files {
		if original.Exists {
			err = filelock.WriteFile(paths[i], original.Data)
		} else {
			err = os.Remove(paths[i])
			if os.IsNotExist(err) {
				err = nil
			}
		}
		if err != nil {
			return fmt.Errorf("restore settings: %w", err)
		}
	}
	return os.Remove(settingsResetJournalPath())
}
