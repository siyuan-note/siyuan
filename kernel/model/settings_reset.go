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
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 仅清理内置偏好；保存的布局、插件数据、最近记录和未知键保持不变。
var resetSettingsStorageKeys = []string{
	"local-zoom", "local-searchdata", "local-searchasset", "local-searchunref",
	"local-exportpdf", "local-exportword", "local-exportimg", "local-pdftheme", "local-flashcard",
	"local-mobile-bars", "local-mobile-bottom-bar", "local-mobile-side-panel", "local-outline",
	"local-fileposition", "local-dialogposition",
}

func defaultWorkspaceSettings(current *AppConf) *AppConf {
	next := current.cloneSettings()
	next.Editor.Store(conf.NewEditor())
	next.Editor.Load().Markdown = util.NewMarkdown()
	if current.Editor.Load() != nil {
		next.Editor.Load().HistoryRetentionDays = current.Editor.Load().HistoryRetentionDays
		next.Editor.Load().Emoji = current.Editor.Load().Emoji
	}
	next.FileTree.Store(conf.NewFileTree())
	next.FileTree.Load().RecentDocsMaxListCount = conf.MinFileTreeRecentDocsListCount
	next.Tag.Store(conf.NewTag())
	next.Export.Store(conf.NewExport())
	next.Search.Store(conf.NewSearch())
	next.Graph.Store(conf.NewGraph())
	next.Flashcard.Store(conf.NewFlashcard())
	next.OCR.Store(conf.NewOCR())
	next.Appearance.Store(conf.NewAppearanceForContainer(util.IsMobileContainer()))
	next.Appearance.Load().Lang = current.Lang
	if current.Appearance.Load() != nil {
		next.Appearance.Load().Mode = current.Appearance.Load().Mode
		next.Appearance.Load().DarkThemes = current.Appearance.Load().DarkThemes
		next.Appearance.Load().LightThemes = current.Appearance.Load().LightThemes
		next.Appearance.Load().Icons = current.Appearance.Load().Icons
	}
	next.UILayout.Store(&conf.UILayout{})
	keymap := conf.Keymap{}
	if current.Keymap.Load() != nil {
		// 内置快捷键在前端启动时按平台补全，插件快捷键完整保留。
		for key, value := range *current.Keymap.Load() {
			if key != "general" && key != "editor" {
				keymap[key] = value
			}
		}
	}
	next.Keymap.Store(&keymap)
	if current.System.Load() != nil {
		system := *current.System.Load()
		system.DownloadInstallPkg = conf.NewSystem().DownloadInstallPkg
		system.SettingsWindow = false
		next.System.Store(&system)
	}
	// 仅规范化被重置的配置段，未重置的配置段与当前内存配置共享，保持原样。
	next.Appearance.Store(conf.NormalizeAppearance(next.Appearance.Load(), util.IsMobileContainer()))
	next.UILayout.Store(conf.NormalizeUILayout(next.UILayout.Load()))
	next.Keymap.Store(conf.NormalizeKeymap(next.Keymap.Load()))
	next.Editor.Store(conf.NormalizeEditor(next.Editor.Load()))
	next.Export.Store(conf.NormalizeExport(next.Export.Load()))
	next.FileTree.Store(conf.NormalizeFileTree(next.FileTree.Load()))
	next.Tag.Store(conf.NormalizeTag(next.Tag.Load()))
	next.Search.Store(conf.NormalizeSearch(next.Search.Load()))
	next.Graph.Store(conf.NormalizeGraph(next.Graph.Load()))
	{
		confSectionValue0, confSectionValue1 := conf.NormalizeFlashcard(next.Flashcard.Load())
		next.Flashcard.Store(confSectionValue0)
		_ = confSectionValue1
	}
	next.OCR.Store(conf.NormalizeOCR(next.OCR.Load()))
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
		util.ReportFileSysFatalError(err)
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
	recordPersistedConf(config)
	{
		confSectionValue0, confSectionValue1, confSectionValue2 := next.Editor.Load(), next.FileTree.Load(), next.Tag.Load()
		Conf.Editor.Store(confSectionValue0)
		Conf.FileTree.Store(confSectionValue1)
		Conf.Tag.Store(confSectionValue2)
	}
	{
		confSectionValue0, confSectionValue1, confSectionValue2 := next.Export.Load(), next.Search.Load(), next.Graph.Load()
		Conf.Export.Store(confSectionValue0)
		Conf.Search.Store(confSectionValue1)
		Conf.Graph.Store(confSectionValue2)
	}
	{
		confSectionValue0, confSectionValue1, confSectionValue2 := next.Flashcard.Load(), next.OCR.Load(), next.Appearance.Load()
		Conf.Flashcard.Store(confSectionValue0)
		Conf.OCR.Store(confSectionValue1)
		Conf.Appearance.Store(confSectionValue2)
	}
	{
		confSectionValue0, confSectionValue1 := next.UILayout.Load(), next.Keymap.Load()
		Conf.UILayout.Store(confSectionValue0)
		Conf.Keymap.Store(confSectionValue1)
	}
	if Conf.System.Load() != nil {
		replaceConfSectionLocked(&Conf.System, func(system *conf.System) bool {
			system.DownloadInstallPkg = next.System.Load().DownloadInstallPkg
			system.SettingsWindow = next.System.Load().SettingsWindow
			return true
		})
	}
	return nil
}

// ApplyResetSettings 更新运行时依赖，索引按现有队列重建，不修改笔记本密钥或历史保留策略。
func ApplyResetSettings(previousSearch *conf.Search) {
	confSearchSnapshot := Conf.LoadSearch()

	applyConfRuntime()
	ChangeHistoryTick(Conf.Editor.Load().GenerateHistoryInterval)
	ResetVirtualBlockRefCache()
	RefreshBoxDocFeature()
	refreshAppearanceConfig()
	WatchThemes()
	go nativePaddle.Close()
	if previousSearch == nil || previousSearch.CaseSensitive != confSearchSnapshot.CaseSensitive ||
		previousSearch.HanSensitiveVal() != confSearchSnapshot.HanSensitiveVal() ||
		previousSearch.IndexAssetPath != confSearchSnapshot.IndexAssetPath {
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
			return rollbackSettingsReset(err)
		}
	}
	if err = os.Remove(settingsResetJournalPath()); err != nil {
		return rollbackSettingsReset(err)
	}
	return nil
}

// 回滚失败时停止内核，保留恢复日志，避免后续保存被下次启动的回滚覆盖。
func rollbackSettingsReset(cause error) error {
	if err := recoverSettingsReset(); err != nil {
		util.ReportFileSysFatalError(errors.Join(cause, err))
	}
	return cause
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
