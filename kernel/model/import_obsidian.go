// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	ObsidianTaskStateQueued       = "queued"
	ObsidianTaskStateAnalyzing    = "analyzing"
	ObsidianTaskStateReady        = "ready"
	ObsidianTaskStateRevalidating = "revalidating"
	ObsidianTaskStateStaging      = "staging"
	ObsidianTaskStateCreating     = "creating"
	ObsidianTaskStateWriting      = "writing"
	ObsidianTaskStateIndexing     = "indexing"
	ObsidianTaskStateCompleted    = "completed"
	ObsidianTaskStateFailed       = "failed"
	ObsidianTaskStateCancelled    = "cancelled"
)

const (
	obsidianReadyTTL  = 30 * time.Minute
	obsidianResultTTL = 10 * time.Minute
)

type ObsidianVaultAnalysis struct {
	VaultName               string   `json:"vaultName"`
	VaultPath               string   `json:"vaultPath"`
	NotebookName            string   `json:"notebookName"`
	MarkdownCount           int      `json:"markdownCount"`
	SyntheticParentCount    int      `json:"syntheticParentCount"`
	NameAdjustmentCount     int      `json:"nameAdjustmentCount"`
	ImportableAssetCount    int      `json:"importableAssetCount"`
	ImportableAssetSize     int64    `json:"importableAssetSize"`
	UnreferencedFileCount   int      `json:"unreferencedFileCount"`
	WikiLinkCount           int      `json:"wikiLinkCount"`
	EmbedCount              int      `json:"embedCount"`
	BlockIDCount            int      `json:"blockIDCount"`
	FootnoteCount           int      `json:"footnoteCount"`
	CommentCount            int      `json:"commentCount"`
	MissingCount            int      `json:"missingCount"`
	AmbiguousCount          int      `json:"ambiguousCount"`
	UnsupportedCount        int      `json:"unsupportedCount"`
	SkippedHiddenCount      int      `json:"skippedHiddenCount"`
	SkippedLinkCount        int      `json:"skippedLinkCount"`
	SkippedSpecialCount     int      `json:"skippedSpecialCount"`
	SkippedNestedVaultCount int      `json:"skippedNestedVaultCount"`
	BlockingErrors          []string `json:"blockingErrors"`
	Warnings                []string `json:"warnings"`
}

type ObsidianVaultImportResult struct {
	NotebookID               string `json:"notebookID"`
	NotebookName             string `json:"notebookName"`
	MarkdownCount            int    `json:"markdownCount"`
	SyntheticParentCount     int    `json:"syntheticParentCount"`
	NameAdjustmentCount      int    `json:"nameAdjustmentCount"`
	ImportedAttachmentCount  int    `json:"importedAttachmentCount"`
	UnreferencedFileCount    int    `json:"unreferencedFileCount"`
	ConvertedLinkCount       int    `json:"convertedLinkCount"`
	ConvertedEmbedCount      int    `json:"convertedEmbedCount"`
	ConvertedFootnoteCount   int    `json:"convertedFootnoteCount"`
	PreservedCommentCount    int    `json:"preservedCommentCount"`
	PreservedUnresolvedCount int    `json:"preservedUnresolvedCount"`
	SkippedPathCount         int    `json:"skippedPathCount"`
	Incomplete               bool   `json:"incomplete"`
	FailedStage              string `json:"failedStage,omitempty"`
}

type ObsidianVaultTask struct {
	TaskID   string                     `json:"taskID"`
	State    string                     `json:"state"`
	Progress int                        `json:"progress"`
	Message  string                     `json:"message"`
	Error    string                     `json:"error,omitempty"`
	Analysis *ObsidianVaultAnalysis     `json:"analysis,omitempty"`
	Result   *ObsidianVaultImportResult `json:"result,omitempty"`
}

type obsidianSourceFile struct {
	RelPath string
	AbsPath string
	Size    int64
	ModTime time.Time
	IsMD    bool
}

type obsidianHeading struct {
	Level int
	Text  string
	Chain string
	ID    string
}

type obsidianDocPlan struct {
	Source          *obsidianSourceFile
	RelPath         string
	Title           string
	ID              string
	TargetPath      string
	HPath           string
	Synthetic       bool
	Headings        []*obsidianHeading
	HeadingByText   map[string][]string
	HeadingByChain  map[string][]string
	BlockIDs        map[string]string
	DuplicateBlocks map[string]bool
}

type obsidianAssetPlan struct {
	Source    *obsidianSourceFile
	FinalName string
}

type obsidianVaultContext struct {
	Root             string
	Files            map[string]*obsidianSourceFile
	Docs             []*obsidianDocPlan
	DocsByRel        map[string]*obsidianDocPlan
	DocsByBase       map[string][]*obsidianDocPlan
	Assets           map[string]*obsidianAssetPlan
	ReferencedAssets map[string]*obsidianAssetPlan
	ImportAssets     map[string]*obsidianAssetPlan
	Analysis         *ObsidianVaultAnalysis
}

type obsidianTask struct {
	TaskID    string
	State     string
	Progress  int
	Message   string
	Err       string
	Analysis  *ObsidianVaultAnalysis
	Result    *ObsidianVaultImportResult
	Context   *obsidianVaultContext
	Cancel    context.CancelFunc
	ExpiresAt time.Time
}

type obsidianSpan struct {
	Start int
	End   int
}

type obsidianWikiToken struct {
	Start  int
	End    int
	Raw    string
	Target string
	Alias  string
	Embed  bool
}

type obsidianScanResult struct {
	Wikis      []obsidianWikiToken
	Comments   []obsidianSpan
	Protected  []obsidianSpan
	Footnotes  int
	BlockIDs   []string
	Duplicates map[string]bool
}

var (
	obsidianTasksMu                 sync.Mutex
	obsidianTasks                   = map[string]*obsidianTask{}
	obsidianActive                  string
	errObsidianVaultUnreadable      = errors.New("Obsidian Vault is unreadable")
	errObsidianVaultNotDirectory    = errors.New("Obsidian Vault path is not a directory")
	errObsidianVaultUnsafePath      = errors.New("Obsidian Vault path is unsafe")
	errObsidianVaultConfigMissing   = errors.New("Obsidian Vault config directory is missing")
	errObsidianVaultMarkdownMissing = errors.New("Obsidian Vault has no readable Markdown")

	obsidianBlockIDPattern  = regexp.MustCompile(`(?m)(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$`)
	obsidianQuotePattern    = regexp.MustCompile(`^((?:[ \t]*>[ \t]?)+)(.*)$`)
	obsidianListItemPattern = regexp.MustCompile(`^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)(.*)$`)
	obsidianFootnotePattern = regexp.MustCompile(`(?m)\[\^[^\]\r\n]+\]`)
)

func StartObsidianVaultAnalysis(localPath string) (*ObsidianVaultTask, error) {
	var replacedTaskID string
	obsidianTasksMu.Lock()
	if obsidianActive != "" {
		if active := obsidianTasks[obsidianActive]; active != nil && !isObsidianTerminalState(active.State) {
			if !isObsidianPreImportState(active.State) {
				obsidianTasksMu.Unlock()
				return nil, errors.New(Conf.Language(329))
			}
			if active.Cancel != nil {
				active.Cancel()
			}
			replacedTaskID = active.TaskID
			finishObsidianTaskLocked(active, ObsidianTaskStateCancelled, "Import cancelled", "")
		}
	}

	taskID := ast.NewNodeID()
	ctx, cancel := context.WithCancel(context.Background())
	task := &obsidianTask{TaskID: taskID, State: ObsidianTaskStateQueued, Message: "Waiting to analyze", Cancel: cancel}
	obsidianTasks[taskID] = task
	obsidianActive = taskID
	ret := snapshotObsidianTask(task)
	obsidianTasksMu.Unlock()

	if replacedTaskID != "" {
		removeObsidianTemp(replacedTaskID)
	}
	go analyzeObsidianVaultTask(ctx, taskID, localPath)
	return ret, nil
}

func GetObsidianVaultTask(taskID string) (*ObsidianVaultTask, error) {
	obsidianTasksMu.Lock()
	defer obsidianTasksMu.Unlock()
	task := obsidianTasks[taskID]
	if task == nil {
		return nil, errors.New(Conf.Language(330))
	}
	return snapshotObsidianTask(task), nil
}

func CancelObsidianVaultTask(taskID string) (*ObsidianVaultTask, error) {
	obsidianTasksMu.Lock()
	task := obsidianTasks[taskID]
	if task == nil {
		obsidianTasksMu.Unlock()
		return nil, errors.New(Conf.Language(330))
	}
	if !isObsidianCancellableState(task.State) {
		ret := snapshotObsidianTask(task)
		obsidianTasksMu.Unlock()
		return ret, errors.New(Conf.Language(331))
	}
	if task.Cancel != nil {
		task.Cancel()
	}
	finishObsidianTaskLocked(task, ObsidianTaskStateCancelled, "Import cancelled", "")
	ret := snapshotObsidianTask(task)
	obsidianTasksMu.Unlock()
	removeObsidianTemp(taskID)
	return ret, nil
}

func StartObsidianVaultImport(taskID, notebookName string) (*ObsidianVaultTask, error) {
	obsidianTasksMu.Lock()
	task := obsidianTasks[taskID]
	if task == nil || task.State != ObsidianTaskStateReady || task.Context == nil {
		obsidianTasksMu.Unlock()
		return nil, errors.New(Conf.Language(332))
	}
	if time.Now().After(task.ExpiresAt) {
		finishObsidianTaskLocked(task, ObsidianTaskStateCancelled, "Analysis expired", "")
		obsidianTasksMu.Unlock()
		return nil, errors.New(Conf.Language(332))
	}

	name := strings.TrimSpace(util.RemoveInvalid(notebookName))
	if name == "" {
		name = task.Analysis.NotebookName
	}
	ctx, cancel := context.WithCancel(context.Background())
	task.Cancel = cancel
	task.State = ObsidianTaskStateRevalidating
	task.Progress = 1
	task.Message = "Revalidating source files"
	ret := snapshotObsidianTask(task)
	obsidianTasksMu.Unlock()

	go importObsidianVaultTask(ctx, taskID, name)
	return ret, nil
}

func IsObsidianVaultTaskActive() bool {
	obsidianTasksMu.Lock()
	defer obsidianTasksMu.Unlock()
	if obsidianActive == "" {
		return false
	}
	task := obsidianTasks[obsidianActive]
	return task != nil && !isObsidianTerminalState(task.State)
}

func snapshotObsidianTask(task *obsidianTask) *ObsidianVaultTask {
	return &ObsidianVaultTask{
		TaskID: task.TaskID, State: task.State, Progress: task.Progress, Message: task.Message,
		Error: task.Err, Analysis: task.Analysis, Result: task.Result,
	}
}

func isObsidianTerminalState(state string) bool {
	return state == ObsidianTaskStateCompleted || state == ObsidianTaskStateFailed || state == ObsidianTaskStateCancelled
}

func isObsidianCancellableState(state string) bool {
	return state == ObsidianTaskStateQueued || state == ObsidianTaskStateAnalyzing || state == ObsidianTaskStateReady ||
		state == ObsidianTaskStateRevalidating || state == ObsidianTaskStateStaging
}

func isObsidianPreImportState(state string) bool {
	return state == ObsidianTaskStateQueued || state == ObsidianTaskStateAnalyzing || state == ObsidianTaskStateReady
}

func finishObsidianTaskLocked(task *obsidianTask, state, message, errMessage string) {
	task.State = state
	task.Message = message
	task.Err = errMessage
	task.Context = nil
	if state == ObsidianTaskStateCompleted {
		task.Progress = 100
	}
	if obsidianActive == task.TaskID {
		obsidianActive = ""
	}
	task.Cancel = nil
	time.AfterFunc(obsidianResultTTL, func() {
		obsidianTasksMu.Lock()
		delete(obsidianTasks, task.TaskID)
		obsidianTasksMu.Unlock()
	})
}

func updateObsidianTask(taskID, state string, progress int, message string) bool {
	obsidianTasksMu.Lock()
	defer obsidianTasksMu.Unlock()
	task := obsidianTasks[taskID]
	if task == nil || isObsidianTerminalState(task.State) {
		return false
	}
	task.State = state
	task.Progress = progress
	task.Message = message
	return true
}

func failObsidianTask(taskID, stage string, err error, result *ObsidianVaultImportResult) {
	logging.LogErrorf("Obsidian Vault import task [%s] failed at [%s]: %s", taskID, stage, err)
	userError := Conf.Language(334)
	if stage == "analyzing" {
		userError = Conf.Language(333)
		if language := obsidianVaultErrorLanguage(err); language > 0 {
			userError = Conf.Language(language)
		}
	}
	obsidianTasksMu.Lock()
	if task := obsidianTasks[taskID]; task != nil && !isObsidianTerminalState(task.State) {
		if result != nil {
			incompleteSuffix := Conf.Language(335)
			if result.Incomplete && !strings.HasSuffix(result.NotebookName, incompleteSuffix) {
				result.NotebookName += incompleteSuffix
			}
			result.FailedStage = stage
			task.Result = result
		}
		finishObsidianTaskLocked(task, ObsidianTaskStateFailed, "Import failed", userError)
	}
	obsidianTasksMu.Unlock()
}

func obsidianVaultErrorLanguage(err error) int {
	switch {
	case errors.Is(err, errObsidianVaultUnreadable):
		return 336
	case errors.Is(err, errObsidianVaultNotDirectory):
		return 337
	case errors.Is(err, errObsidianVaultUnsafePath):
		return 338
	case errors.Is(err, errObsidianVaultConfigMissing):
		return 339
	case errors.Is(err, errObsidianVaultMarkdownMissing):
		return 340
	default:
		return 0
	}
}

func analyzeObsidianVaultTask(ctx context.Context, taskID, localPath string) {
	if !updateObsidianTask(taskID, ObsidianTaskStateAnalyzing, 1, "Analyzing Obsidian Vault") {
		return
	}
	vaultContext, err := analyzeObsidianVault(ctx, localPath, func(progress int, message string) {
		updateObsidianTask(taskID, ObsidianTaskStateAnalyzing, progress, message)
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return
		}
		failObsidianTask(taskID, "analyzing", err, nil)
		return
	}

	obsidianTasksMu.Lock()
	task := obsidianTasks[taskID]
	if task == nil || isObsidianTerminalState(task.State) {
		obsidianTasksMu.Unlock()
		return
	}
	task.Context = vaultContext
	task.Analysis = vaultContext.Analysis
	task.State = ObsidianTaskStateReady
	task.Progress = 100
	task.Message = "Analysis completed"
	task.ExpiresAt = time.Now().Add(obsidianReadyTTL)
	obsidianTasksMu.Unlock()

	time.AfterFunc(obsidianReadyTTL, func() {
		obsidianTasksMu.Lock()
		if current := obsidianTasks[taskID]; current != nil && current.State == ObsidianTaskStateReady &&
			time.Now().After(current.ExpiresAt) {
			finishObsidianTaskLocked(current, ObsidianTaskStateCancelled, "Analysis expired", "")
		}
		obsidianTasksMu.Unlock()
	})
}

func analyzeObsidianVault(ctx context.Context, localPath string, progress func(int, string)) (*obsidianVaultContext, error) {
	root, err := validateObsidianVaultRoot(localPath)
	if err != nil {
		return nil, err
	}
	ret := &obsidianVaultContext{
		Root: root, Files: map[string]*obsidianSourceFile{}, DocsByRel: map[string]*obsidianDocPlan{},
		DocsByBase: map[string][]*obsidianDocPlan{}, Assets: map[string]*obsidianAssetPlan{},
		ReferencedAssets: map[string]*obsidianAssetPlan{}, ImportAssets: map[string]*obsidianAssetPlan{}, Analysis: &ObsidianVaultAnalysis{
			VaultName: filepath.Base(root), VaultPath: root, NotebookName: filepath.Base(root), BlockingErrors: []string{}, Warnings: []string{},
		},
	}

	if err = scanObsidianVaultFiles(ctx, ret, "", root); err != nil {
		return nil, err
	}
	progress(20, "Planning documents")
	if err = planObsidianDocuments(ctx, ret); err != nil {
		return nil, err
	}
	progress(35, "Analyzing Markdown syntax")
	if err = analyzeObsidianDocuments(ctx, ret, progress); err != nil {
		return nil, err
	}
	ret.Analysis.MarkdownCount = countObsidianSourceDocs(ret.Docs)
	var assetKeys []string
	for key := range ret.Assets {
		assetKeys = append(assetKeys, key)
	}
	sort.Strings(assetKeys)
	for _, key := range assetKeys {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		asset := ret.Assets[key]
		if err = validateObsidianReadableFile(asset.Source); err != nil {
			if ret.ReferencedAssets[key] != nil {
				return nil, fmt.Errorf("read referenced attachment [%s]: %w", asset.Source.RelPath, err)
			}
			ret.Analysis.Warnings = append(ret.Analysis.Warnings, asset.Source.RelPath)
			continue
		}
		ret.ImportAssets[key] = asset
		ret.Analysis.ImportableAssetCount++
		ret.Analysis.ImportableAssetSize += asset.Source.Size
	}
	ret.Analysis.UnreferencedFileCount = len(ret.ImportAssets) - len(ret.ReferencedAssets)
	if ret.Analysis.UnreferencedFileCount < 0 {
		ret.Analysis.UnreferencedFileCount = 0
	}
	progress(100, "Analysis completed")
	return ret, nil
}

func validateObsidianVaultRoot(localPath string) (string, error) {
	if strings.TrimSpace(localPath) == "" {
		return "", fmt.Errorf("%w: path is empty", errObsidianVaultUnreadable)
	}
	abs, err := filepath.Abs(filepath.Clean(localPath))
	if err != nil {
		return "", fmt.Errorf("%w: normalize Vault path: %v", errObsidianVaultUnreadable, err)
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return "", fmt.Errorf("%w: read Vault root: %v", errObsidianVaultUnreadable, err)
	}
	if !info.IsDir() {
		return "", errObsidianVaultNotDirectory
	}
	if info.Mode()&os.ModeSymlink != 0 || isObsidianResolvedLink(abs) {
		return "", fmt.Errorf("%w: Vault root is a symbolic link or reparse point", errObsidianVaultUnsafePath)
	}
	if util.IsSensitivePath(abs) {
		return "", fmt.Errorf("%w: selected Vault path is sensitive", errObsidianVaultUnsafePath)
	}
	workspace, _ := filepath.Abs(filepath.Clean(util.WorkspaceDir))
	if sameObsidianPath(abs, workspace) || gulu.File.IsSubPath(workspace, abs) || gulu.File.IsSubPath(abs, workspace) {
		return "", fmt.Errorf("%w: Vault root and SiYuan workspace contain each other", errObsidianVaultUnsafePath)
	}
	configPath := filepath.Join(abs, ".obsidian")
	configInfo, statErr := os.Lstat(configPath)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return "", errObsidianVaultConfigMissing
		}
		return "", fmt.Errorf("%w: read Vault config directory: %v", errObsidianVaultUnreadable, statErr)
	}
	if !configInfo.IsDir() || configInfo.Mode()&os.ModeSymlink != 0 || isObsidianResolvedLink(configPath) {
		return "", errObsidianVaultConfigMissing
	}
	return abs, nil
}

func scanObsidianVaultFiles(ctx context.Context, vault *obsidianVaultContext, relDir, absDir string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return fmt.Errorf("read Vault directory [%s]: %w", relDir, err)
	}
	sort.Slice(entries, func(i, j int) bool { return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name()) })
	for _, entry := range entries {
		if err = ctx.Err(); err != nil {
			return err
		}
		name := entry.Name()
		rel := path.Join(relDir, filepath.ToSlash(name))
		abs := filepath.Join(absDir, name)
		if strings.HasPrefix(name, ".") {
			if relDir == "" && name == ".obsidian" {
				continue
			}
			vault.Analysis.SkippedHiddenCount++
			continue
		}
		entryInfo, infoErr := entry.Info()
		if infoErr != nil {
			if entry.IsDir() || strings.EqualFold(filepath.Ext(name), ".md") {
				return fmt.Errorf("read Vault path [%s]: %w", rel, infoErr)
			}
			vault.Analysis.Warnings = append(vault.Analysis.Warnings, rel)
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 || entryInfo.Mode()&os.ModeSymlink != 0 || isObsidianResolvedLink(abs) {
			vault.Analysis.SkippedLinkCount++
			continue
		}
		if entryInfo.IsDir() {
			nestedConfig := filepath.Join(abs, ".obsidian")
			if nestedInfo, nestedErr := os.Lstat(nestedConfig); nestedErr == nil {
				if nestedInfo.IsDir() || nestedInfo.Mode()&os.ModeSymlink != 0 || isObsidianResolvedLink(nestedConfig) {
					vault.Analysis.SkippedNestedVaultCount++
					continue
				}
			}
			if err = scanObsidianVaultFiles(ctx, vault, rel, abs); err != nil {
				return err
			}
			continue
		}
		if !isObsidianImportableFileMode(entryInfo.Mode()) {
			vault.Analysis.SkippedSpecialCount++
			continue
		}

		ext := strings.ToLower(filepath.Ext(name))
		isMD := ext == ".md"
		file := &obsidianSourceFile{RelPath: rel, AbsPath: abs, Size: entryInfo.Size(), ModTime: entryInfo.ModTime(), IsMD: isMD}
		key := obsidianPathKey(rel)
		if existing := vault.Files[key]; existing != nil && existing.RelPath != rel {
			return fmt.Errorf("Vault paths differ only by letter case [%s] and [%s]", existing.RelPath, rel)
		}
		vault.Files[key] = file
		if !isMD {
			finalName := util.AssetName(util.FilterUploadFileName(filepath.Base(rel)), ast.NewNodeID())
			vault.Assets[key] = &obsidianAssetPlan{Source: file, FinalName: finalName}
		}
	}
	return nil
}

func isObsidianImportableFileMode(mode fs.FileMode) bool {
	return mode.IsRegular()
}

func isObsidianResolvedLink(p string) bool {
	resolved, err := filepath.EvalSymlinks(p)
	return err == nil && !sameObsidianPath(filepath.Clean(p), filepath.Clean(resolved))
}

func sameObsidianPath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

func obsidianPathKey(p string) string {
	p = path.Clean(strings.TrimPrefix(filepath.ToSlash(p), "/"))
	if p == "." {
		return ""
	}
	return strings.ToLower(p)
}

func countObsidianSourceDocs(docs []*obsidianDocPlan) int {
	ret := 0
	for _, doc := range docs {
		if !doc.Synthetic {
			ret++
		}
	}
	return ret
}

func planObsidianDocuments(ctx context.Context, vault *obsidianVaultContext) error {
	var mdFiles []*obsidianSourceFile
	for _, file := range vault.Files {
		if file.IsMD {
			mdFiles = append(mdFiles, file)
		}
	}
	if len(mdFiles) == 0 {
		return errObsidianVaultMarkdownMissing
	}
	sort.Slice(mdFiles, func(i, j int) bool { return strings.ToLower(mdFiles[i].RelPath) < strings.ToLower(mdFiles[j].RelPath) })

	for _, file := range mdFiles {
		if err := ctx.Err(); err != nil {
			return err
		}
		relWithoutExt := strings.TrimSuffix(filepath.ToSlash(file.RelPath), filepath.Ext(file.RelPath))
		title := sanitizeObsidianTitle(path.Base(relWithoutExt))
		doc := &obsidianDocPlan{
			Source: file, RelPath: relWithoutExt, Title: title, ID: ast.NewNodeID(),
			HeadingByText: map[string][]string{}, HeadingByChain: map[string][]string{},
			BlockIDs: map[string]string{}, DuplicateBlocks: map[string]bool{},
		}
		vault.Docs = append(vault.Docs, doc)
		vault.DocsByRel[obsidianPathKey(relWithoutExt)] = doc
		baseKey := strings.ToLower(path.Base(relWithoutExt))
		vault.DocsByBase[baseKey] = append(vault.DocsByBase[baseKey], doc)
	}

	dirs := map[string]bool{}
	for _, doc := range vault.Docs {
		for dir := path.Dir(doc.RelPath); dir != "." && dir != "/" && dir != ""; dir = path.Dir(dir) {
			dirs[dir] = true
		}
	}
	var dirPaths []string
	for dir := range dirs {
		dirPaths = append(dirPaths, dir)
	}
	sort.Slice(dirPaths, func(i, j int) bool {
		leftDepth := strings.Count(dirPaths[i], "/")
		rightDepth := strings.Count(dirPaths[j], "/")
		if leftDepth == rightDepth {
			return strings.ToLower(dirPaths[i]) < strings.ToLower(dirPaths[j])
		}
		return leftDepth < rightDepth
	})
	dirDocs := map[string]*obsidianDocPlan{}
	for _, dir := range dirPaths {
		if existing := vault.DocsByRel[obsidianPathKey(dir)]; existing != nil {
			dirDocs[obsidianPathKey(dir)] = existing
			continue
		}
		doc := &obsidianDocPlan{
			RelPath: dir, Title: sanitizeObsidianTitle(path.Base(dir)), ID: ast.NewNodeID(), Synthetic: true,
			HeadingByText: map[string][]string{}, HeadingByChain: map[string][]string{},
			BlockIDs: map[string]string{}, DuplicateBlocks: map[string]bool{},
		}
		vault.Docs = append(vault.Docs, doc)
		dirDocs[obsidianPathKey(dir)] = doc
		vault.Analysis.SyntheticParentCount++
	}

	titleUses := map[string]map[string]int{}
	var assignDir func(string, string, string)
	assignDir = func(dir, parentTarget, parentHPath string) {
		contentTarget := parentTarget
		contentHPath := parentHPath
		if dir != "" {
			dirDoc := dirDocs[obsidianPathKey(dir)]
			dirDoc.Title = uniqueObsidianTitle(parentTarget, dirDoc.Title, titleUses, vault.Analysis)
			dirDoc.TargetPath = path.Join(parentTarget, dirDoc.ID+".sy")
			dirDoc.HPath = path.Join(parentHPath, dirDoc.Title)
			contentTarget = path.Join(parentTarget, dirDoc.ID)
			contentHPath = dirDoc.HPath
		}

		var directDocs []*obsidianDocPlan
		for _, doc := range vault.Docs {
			docDir := path.Dir(doc.RelPath)
			if docDir == "." {
				docDir = ""
			}
			if doc.Synthetic || docDir != dir {
				continue
			}
			if childDir := path.Join(dir, path.Base(doc.RelPath)); dirs[childDir] && dirDocs[obsidianPathKey(childDir)] == doc {
				continue
			}
			directDocs = append(directDocs, doc)
		}
		sort.Slice(directDocs, func(i, j int) bool {
			return strings.ToLower(directDocs[i].RelPath) < strings.ToLower(directDocs[j].RelPath)
		})
		for _, doc := range directDocs {
			doc.Title = uniqueObsidianTitle(contentTarget, doc.Title, titleUses, vault.Analysis)
			doc.TargetPath = path.Join(contentTarget, doc.ID+".sy")
			doc.HPath = path.Join(contentHPath, doc.Title)
		}

		var childDirs []string
		for candidate := range dirs {
			parent := path.Dir(candidate)
			if parent == "." {
				parent = ""
			}
			if parent == dir {
				childDirs = append(childDirs, candidate)
			}
		}
		sort.Slice(childDirs, func(i, j int) bool { return strings.ToLower(childDirs[i]) < strings.ToLower(childDirs[j]) })
		for _, child := range childDirs {
			assignDir(child, contentTarget, contentHPath)
		}
	}
	assignDir("", "/", "/")

	sort.Slice(vault.Docs, func(i, j int) bool {
		return strings.ToLower(vault.Docs[i].RelPath) < strings.ToLower(vault.Docs[j].RelPath)
	})
	return nil
}

func sanitizeObsidianTitle(title string) string {
	ret := strings.TrimSpace(util.RemoveInvalid(title))
	if ret == "" {
		return "Untitled"
	}
	return ret
}

func uniqueObsidianTitle(parent, title string, uses map[string]map[string]int, analysis *ObsidianVaultAnalysis) string {
	parentKey := obsidianPathKey(parent)
	if uses[parentKey] == nil {
		uses[parentKey] = map[string]int{}
	}
	key := strings.ToLower(title)
	uses[parentKey][key]++
	count := uses[parentKey][key]
	if count == 1 {
		return title
	}
	analysis.NameAdjustmentCount++
	return fmt.Sprintf("%s (%d)", title, count)
}

func analyzeObsidianDocuments(ctx context.Context, vault *obsidianVaultContext, progress func(int, string)) error {
	sourceCount := countObsidianSourceDocs(vault.Docs)
	processed := 0
	for _, doc := range vault.Docs {
		if doc.Synthetic {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		data, err := readStableObsidianFile(doc.Source)
		if err != nil {
			return fmt.Errorf("read Markdown [%s]: %w", doc.Source.RelPath, err)
		}
		if !utf8.Valid(data) {
			return fmt.Errorf("Markdown [%s] is not valid UTF-8", doc.Source.RelPath)
		}
		scan := scanObsidianSource(data)
		for _, blockID := range scan.BlockIDs {
			if scan.Duplicates[blockID] {
				doc.DuplicateBlocks[blockID] = true
			}
			if doc.BlockIDs[blockID] == "" {
				doc.BlockIDs[blockID] = ast.NewNodeID()
			}
		}
		tree, _, _, _ := parseStdMd(data)
		if tree == nil {
			return fmt.Errorf("parse Markdown [%s] failed", doc.Source.RelPath)
		}
		buildObsidianHeadingIndex(doc, tree)
		vault.Analysis.WikiLinkCount += countObsidianNonEmbedTokens(scan.Wikis)
		vault.Analysis.EmbedCount += countObsidianEmbedTokens(scan.Wikis)
		vault.Analysis.CommentCount += len(scan.Comments)
		vault.Analysis.FootnoteCount += scan.Footnotes
		vault.Analysis.BlockIDCount += len(scan.BlockIDs)
		processed++
		progress(35+processed*30/maxInt(sourceCount, 1), "Analyzing Markdown syntax")
	}

	for _, doc := range vault.Docs {
		if doc.Synthetic {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		data, err := readStableObsidianFile(doc.Source)
		if err != nil {
			return fmt.Errorf("read Markdown [%s]: %w", doc.Source.RelPath, err)
		}
		scan := scanObsidianSource(data)
		for _, token := range scan.Wikis {
			resolved := resolveObsidianTarget(vault, doc, token.Target)
			if resolved.Ambiguous {
				vault.Analysis.AmbiguousCount++
			}
			switch resolved.Status {
			case "missing":
				vault.Analysis.MissingCount++
			case "unsupported":
				vault.Analysis.UnsupportedCount++
			case "resolved":
				if resolved.Asset != nil {
					vault.ReferencedAssets[obsidianPathKey(resolved.Asset.Source.RelPath)] = resolved.Asset
				}
			}
		}
		tree, _, _, _ := parseStdMd(data)
		if tree == nil {
			return fmt.Errorf("parse Markdown [%s] failed", doc.Source.RelPath)
		}
		analyzeObsidianMarkdownLinks(vault, doc, tree)
	}
	return nil
}

func readStableObsidianFile(file *obsidianSourceFile) ([]byte, error) {
	before, err := os.Stat(file.AbsPath)
	if err != nil {
		return nil, err
	}
	if before.Size() != file.Size || !before.ModTime().Equal(file.ModTime) {
		return nil, errors.New("source file changed during analysis")
	}
	data, err := os.ReadFile(file.AbsPath)
	if err != nil {
		return nil, err
	}
	after, err := os.Stat(file.AbsPath)
	if err != nil {
		return nil, err
	}
	if before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return nil, errors.New("source file changed while reading")
	}
	return data, nil
}

func validateObsidianReadableFile(file *obsidianSourceFile) error {
	opened, err := os.Open(file.AbsPath)
	if err != nil {
		return err
	}
	defer opened.Close()
	buffer := make([]byte, 1)
	_, err = opened.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return validateObsidianSourceMetadata(file)
}

func buildObsidianHeadingIndex(doc *obsidianDocPlan, tree *parse.Tree) {
	stack := make([]string, 6)
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || node.Type != ast.NodeHeading {
			return ast.WalkContinue
		}
		text, blockID := splitObsidianBlockID(strings.TrimSpace(node.Text()))
		if text == "" {
			return ast.WalkContinue
		}
		level := node.HeadingLevel
		if level < 1 || level > 6 {
			level = 1
		}
		stack[level-1] = text
		for i := level; i < len(stack); i++ {
			stack[i] = ""
		}
		var chainParts []string
		for i := 0; i < level; i++ {
			if stack[i] != "" {
				chainParts = append(chainParts, stack[i])
			}
		}
		headingID := doc.BlockIDs[blockID]
		if headingID == "" {
			headingID = ast.NewNodeID()
		}
		heading := &obsidianHeading{Level: level, Text: text, Chain: strings.Join(chainParts, "#"), ID: headingID}
		doc.Headings = append(doc.Headings, heading)
		doc.HeadingByText[strings.ToLower(text)] = append(doc.HeadingByText[strings.ToLower(text)], heading.ID)
		doc.HeadingByChain[strings.ToLower(heading.Chain)] = append(doc.HeadingByChain[strings.ToLower(heading.Chain)], heading.ID)
		return ast.WalkContinue
	})
}

func splitObsidianBlockID(text string) (content, blockID string) {
	match := obsidianBlockIDPattern.FindStringSubmatchIndex(text)
	if len(match) == 0 {
		return text, ""
	}
	return strings.TrimSpace(text[:match[0]]), text[match[2]:match[3]]
}

func countObsidianNonEmbedTokens(tokens []obsidianWikiToken) int {
	ret := 0
	for _, token := range tokens {
		if !token.Embed {
			ret++
		}
	}
	return ret
}

func countObsidianEmbedTokens(tokens []obsidianWikiToken) int {
	ret := 0
	for _, token := range tokens {
		if token.Embed {
			ret++
		}
	}
	return ret
}

type obsidianResolvedTarget struct {
	Status    string
	Doc       *obsidianDocPlan
	Asset     *obsidianAssetPlan
	ID        string
	Ambiguous bool
}

func resolveObsidianTarget(vault *obsidianVaultContext, current *obsidianDocPlan, rawTarget string) obsidianResolvedTarget {
	target := strings.TrimSpace(rawTarget)
	if target == "" {
		return obsidianResolvedTarget{Status: "unsupported"}
	}
	decoded, err := url.PathUnescape(target)
	if err != nil {
		return obsidianResolvedTarget{Status: "unsupported"}
	}
	target = strings.ReplaceAll(decoded, "\\", "/")

	docPart := target
	fragment := ""
	if index := strings.Index(target, "#"); index >= 0 {
		docPart = target[:index]
		fragment = target[index+1:]
	}
	if docPart == "" {
		return resolveObsidianDocumentFragment(current, fragment)
	}

	ext := strings.ToLower(path.Ext(docPart))
	if ext != "" && ext != ".md" {
		if fragment != "" {
			docPart = strings.TrimSuffix(docPart, "#"+fragment)
		}
		asset, status := resolveObsidianAsset(vault, current, docPart)
		if status == "ambiguous" {
			return obsidianResolvedTarget{Status: "resolved", Asset: asset, Ambiguous: true}
		}
		return obsidianResolvedTarget{Status: status, Asset: asset}
	}

	docPart = strings.TrimSuffix(docPart, path.Ext(docPart))
	doc, status := resolveObsidianDocument(vault, current, docPart)
	ambiguous := status == "ambiguous"
	if status != "resolved" && !ambiguous {
		return obsidianResolvedTarget{Status: status}
	}
	if fragment == "" {
		return obsidianResolvedTarget{Status: "resolved", Doc: doc, ID: doc.ID, Ambiguous: ambiguous}
	}
	resolved := resolveObsidianDocumentFragment(doc, fragment)
	resolved.Ambiguous = resolved.Ambiguous || ambiguous
	return resolved
}

func resolveObsidianDocument(vault *obsidianVaultContext, current *obsidianDocPlan, target string) (*obsidianDocPlan, string) {
	target = strings.TrimSpace(strings.TrimPrefix(target, "/"))
	if target == "" {
		return current, "resolved"
	}
	var candidates []*obsidianDocPlan
	if strings.HasPrefix(target, "./") || strings.HasPrefix(target, "../") {
		candidate := path.Clean(path.Join(path.Dir(current.RelPath), target))
		if candidate == ".." || strings.HasPrefix(candidate, "../") {
			return nil, "unsupported"
		}
		if doc := vault.DocsByRel[obsidianPathKey(candidate)]; doc != nil {
			return doc, "resolved"
		}
		return nil, "missing"
	}
	if strings.Contains(target, "/") {
		if doc := vault.DocsByRel[obsidianPathKey(path.Clean(target))]; doc != nil {
			return doc, "resolved"
		}
		return nil, "missing"
	}
	currentCandidate := path.Join(path.Dir(current.RelPath), target)
	if doc := vault.DocsByRel[obsidianPathKey(currentCandidate)]; doc != nil {
		return doc, "resolved"
	}
	candidates = vault.DocsByBase[strings.ToLower(target)]
	if len(candidates) == 1 {
		return candidates[0], "resolved"
	}
	if len(candidates) > 1 {
		sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].RelPath < candidates[j].RelPath })
		return candidates[0], "ambiguous"
	}
	return nil, "missing"
}

func resolveObsidianDocumentFragment(doc *obsidianDocPlan, fragment string) obsidianResolvedTarget {
	if doc == nil {
		return obsidianResolvedTarget{Status: "missing"}
	}
	fragment = strings.TrimSpace(fragment)
	if fragment == "" {
		return obsidianResolvedTarget{Status: "resolved", Doc: doc, ID: doc.ID}
	}
	if strings.HasPrefix(fragment, "^") {
		blockID := strings.TrimPrefix(fragment, "^")
		if doc.DuplicateBlocks[blockID] {
			if id := doc.BlockIDs[blockID]; id != "" {
				return obsidianResolvedTarget{Status: "resolved", Doc: doc, ID: id, Ambiguous: true}
			}
			return obsidianResolvedTarget{Status: "missing"}
		}
		if id := doc.BlockIDs[blockID]; id != "" {
			return obsidianResolvedTarget{Status: "resolved", Doc: doc, ID: id}
		}
		return obsidianResolvedTarget{Status: "missing"}
	}
	key := strings.ToLower(fragment)
	ids := doc.HeadingByChain[key]
	if len(ids) == 0 {
		ids = doc.HeadingByText[key]
	}
	if len(ids) == 1 {
		return obsidianResolvedTarget{Status: "resolved", Doc: doc, ID: ids[0]}
	}
	if len(ids) > 1 {
		return obsidianResolvedTarget{Status: "resolved", Doc: doc, ID: ids[0], Ambiguous: true}
	}
	return obsidianResolvedTarget{Status: "missing"}
}

func resolveObsidianAsset(vault *obsidianVaultContext, current *obsidianDocPlan, target string) (*obsidianAssetPlan, string) {
	target = strings.TrimSpace(strings.TrimPrefix(target, "/"))
	if target == "" || path.Ext(target) == "" {
		return nil, "unsupported"
	}
	if strings.HasPrefix(target, "./") || strings.HasPrefix(target, "../") {
		candidate := path.Clean(path.Join(path.Dir(current.RelPath), target))
		if candidate == ".." || strings.HasPrefix(candidate, "../") {
			return nil, "unsupported"
		}
		if asset := vault.Assets[obsidianPathKey(candidate)]; asset != nil {
			return asset, "resolved"
		}
		return nil, "missing"
	}
	if strings.Contains(target, "/") {
		if asset := vault.Assets[obsidianPathKey(path.Clean(target))]; asset != nil {
			return asset, "resolved"
		}
		return nil, "missing"
	}
	currentCandidate := path.Join(path.Dir(current.RelPath), target)
	if asset := vault.Assets[obsidianPathKey(currentCandidate)]; asset != nil {
		return asset, "resolved"
	}
	var candidates []*obsidianAssetPlan
	for _, asset := range vault.Assets {
		if strings.EqualFold(path.Base(asset.Source.RelPath), target) {
			candidates = append(candidates, asset)
		}
	}
	if len(candidates) == 1 {
		return candidates[0], "resolved"
	}
	if len(candidates) > 1 {
		sort.Slice(candidates, func(i, j int) bool { return candidates[i].Source.RelPath < candidates[j].Source.RelPath })
		return candidates[0], "ambiguous"
	}
	return nil, "missing"
}

func analyzeObsidianMarkdownLinks(vault *obsidianVaultContext, current *obsidianDocPlan, tree *parse.Tree) {
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		var destination string
		if node.Type == ast.NodeLinkDest {
			destination = node.TokensStr()
		} else if node.IsTextMarkType("a") {
			destination = node.TextMarkAHref
		} else {
			return ast.WalkContinue
		}
		resolved := resolveObsidianMarkdownDestination(vault, current, destination)
		if resolved.Ambiguous {
			vault.Analysis.AmbiguousCount++
		}
		if resolved.Asset != nil && resolved.Status == "resolved" {
			vault.ReferencedAssets[obsidianPathKey(resolved.Asset.Source.RelPath)] = resolved.Asset
		}
		switch resolved.Status {
		case "missing":
			vault.Analysis.MissingCount++
		case "unsupported":
			if isObsidianUnsafeLocalDestination(destination) {
				vault.Analysis.UnsupportedCount++
			}
		}
		return ast.WalkContinue
	})
}

func isObsidianUnsafeLocalDestination(destination string) bool {
	destination = strings.TrimSpace(strings.ToLower(destination))
	if destination == "" || strings.HasPrefix(destination, "assets/") || strings.Contains(destination, "://") ||
		strings.HasPrefix(destination, "data:") || strings.HasPrefix(destination, "mailto:") || strings.HasPrefix(destination, "file:") ||
		strings.HasPrefix(destination, "obsidian:") {
		return false
	}
	return strings.HasPrefix(destination, "/") || destination == ".." || strings.HasPrefix(destination, "../")
}

func resolveObsidianMarkdownDestination(vault *obsidianVaultContext, current *obsidianDocPlan, destination string) obsidianResolvedTarget {
	destination = strings.TrimSpace(destination)
	if destination == "" {
		return obsidianResolvedTarget{Status: "unsupported"}
	}
	if strings.HasPrefix(destination, "#") {
		return resolveObsidianDocumentFragment(current, strings.TrimPrefix(destination, "#"))
	}
	lowerDestination := strings.ToLower(destination)
	if strings.HasPrefix(destination, "/") || strings.Contains(destination, "://") || strings.HasPrefix(lowerDestination, "data:") ||
		strings.HasPrefix(lowerDestination, "mailto:") || strings.HasPrefix(lowerDestination, "file:") || strings.HasPrefix(lowerDestination, "obsidian:") {
		return obsidianResolvedTarget{Status: "unsupported"}
	}
	decoded, err := url.PathUnescape(destination)
	if err != nil {
		return obsidianResolvedTarget{Status: "unsupported"}
	}
	decoded = strings.ReplaceAll(decoded, "\\", "/")
	fragment := ""
	if index := strings.Index(decoded, "#"); index >= 0 {
		fragment = decoded[index+1:]
		decoded = decoded[:index]
	}
	if strings.EqualFold(path.Ext(decoded), ".md") {
		doc, status := resolveObsidianDocument(vault, current, strings.TrimSuffix(decoded, path.Ext(decoded)))
		ambiguous := status == "ambiguous"
		if status != "resolved" && !ambiguous {
			return obsidianResolvedTarget{Status: status}
		}
		if fragment != "" {
			resolved := resolveObsidianDocumentFragment(doc, fragment)
			resolved.Ambiguous = resolved.Ambiguous || ambiguous
			return resolved
		}
		return obsidianResolvedTarget{Status: "resolved", Doc: doc, ID: doc.ID, Ambiguous: ambiguous}
	}
	asset, status := resolveObsidianAsset(vault, current, decoded)
	if status == "ambiguous" {
		return obsidianResolvedTarget{Status: "resolved", Asset: asset, Ambiguous: true}
	}
	return obsidianResolvedTarget{Status: status, Asset: asset}
}

func scanObsidianSource(data []byte) *obsidianScanResult {
	ret := &obsidianScanResult{Duplicates: map[string]bool{}}
	protected := make([]bool, len(data))
	markProtected := func(start, end int) {
		if start < 0 {
			start = 0
		}
		if end > len(data) {
			end = len(data)
		}
		for i := start; i < end; i++ {
			protected[i] = true
		}
		ret.Protected = append(ret.Protected, obsidianSpan{Start: start, End: end})
	}

	if bytes.HasPrefix(data, []byte("---\n")) || bytes.HasPrefix(data, []byte("---\r\n")) {
		lineEnd := bytes.IndexByte(data, '\n')
		for pos := lineEnd + 1; pos < len(data); {
			next := bytes.IndexByte(data[pos:], '\n')
			end := len(data)
			if next >= 0 {
				end = pos + next + 1
			}
			line := strings.TrimSpace(string(data[pos:end]))
			if line == "---" {
				markProtected(0, end)
				break
			}
			pos = end
		}
	}
	protectObsidianIndentedCode(data, protected, markProtected)

	var fenceMarker byte
	fenceLen := 0
	for lineStart := 0; lineStart < len(data); {
		lineEnd := bytes.IndexByte(data[lineStart:], '\n')
		if lineEnd < 0 {
			lineEnd = len(data)
		} else {
			lineEnd += lineStart + 1
		}
		if protected[lineStart] {
			lineStart = lineEnd
			continue
		}
		trimmed := bytes.TrimLeft(data[lineStart:lineEnd], " \t")
		if len(trimmed) >= 3 && (trimmed[0] == '`' || trimmed[0] == '~') {
			run := 1
			for run < len(trimmed) && trimmed[run] == trimmed[0] {
				run++
			}
			if run >= 3 {
				if fenceMarker == 0 {
					fenceMarker = trimmed[0]
					fenceLen = run
					markProtected(lineStart, lineEnd)
					lineStart = lineEnd
					continue
				}
				if trimmed[0] == fenceMarker && run >= fenceLen {
					markProtected(lineStart, lineEnd)
					fenceMarker = 0
					fenceLen = 0
					lineStart = lineEnd
					continue
				}
			}
		}
		if fenceMarker != 0 {
			markProtected(lineStart, lineEnd)
		}
		lineStart = lineEnd
	}
	protectObsidianHTML(data, protected, markProtected)

	for i := 0; i < len(data); {
		if protected[i] {
			i++
			continue
		}
		if data[i] == '\\' {
			i += 2
			continue
		}
		if data[i] == '`' {
			run := 1
			for i+run < len(data) && data[i+run] == '`' {
				run++
			}
			needle := bytes.Repeat([]byte{'`'}, run)
			if closeAt := bytes.Index(data[i+run:], needle); closeAt >= 0 {
				end := i + run + closeAt + run
				markProtected(i, end)
				i = end
				continue
			}
		}
		if i+1 < len(data) && data[i] == '%' && data[i+1] == '%' {
			closeAt := bytes.Index(data[i+2:], []byte("%%"))
			if closeAt < 0 {
				i += 2
				continue
			}
			end := i + 2 + closeAt + 2
			ret.Comments = append(ret.Comments, obsidianSpan{Start: i, End: end})
			markProtected(i, end)
			i = end
			continue
		}
		if data[i] == '$' {
			run := 1
			if i+1 < len(data) && data[i+1] == '$' {
				run = 2
			}
			needle := bytes.Repeat([]byte{'$'}, run)
			if closeAt := bytes.Index(data[i+run:], needle); closeAt >= 0 {
				end := i + run + closeAt + run
				markProtected(i, end)
				i = end
				continue
			}
		}
		start := i
		embed := false
		if i+2 < len(data) && data[i] == '!' && data[i+1] == '[' && data[i+2] == '[' {
			embed = true
			i++
		}
		if i+1 < len(data) && data[i] == '[' && data[i+1] == '[' {
			if closeAt := bytes.Index(data[i+2:], []byte("]]")); closeAt >= 0 {
				end := i + 2 + closeAt + 2
				inside := string(data[i+2 : i+2+closeAt])
				target, alias, _ := strings.Cut(inside, "|")
				ret.Wikis = append(ret.Wikis, obsidianWikiToken{
					Start: start, End: end, Raw: string(data[start:end]), Target: strings.TrimSpace(target),
					Alias: strings.TrimSpace(alias), Embed: embed,
				})
				i = end
				continue
			}
		}
		i++
	}

	masked := append([]byte(nil), data...)
	for index, value := range protected {
		if value && masked[index] != '\n' && masked[index] != '\r' {
			masked[index] = ' '
		}
	}
	blockCounts := map[string]int{}
	for _, match := range obsidianBlockIDPattern.FindAllSubmatch(masked, -1) {
		id := string(match[1])
		blockCounts[id]++
		if blockCounts[id] == 1 {
			ret.BlockIDs = append(ret.BlockIDs, id)
		} else {
			ret.Duplicates[id] = true
		}
	}
	ret.Footnotes = len(obsidianFootnotePattern.FindAll(masked, -1))
	return ret
}

func protectObsidianIndentedCode(data []byte, protected []bool, markProtected func(start, end int)) {
	previousBlank := true
	inCodeBlock := false
	for lineStart := 0; lineStart < len(data); {
		lineEnd := bytes.IndexByte(data[lineStart:], '\n')
		if lineEnd < 0 {
			lineEnd = len(data)
		} else {
			lineEnd += lineStart + 1
		}
		line := bytes.TrimRight(data[lineStart:lineEnd], "\r\n")
		blank := len(bytes.TrimSpace(line)) == 0
		indent := 0
		for _, token := range line {
			if token == ' ' {
				indent++
			} else if token == '\t' {
				indent = 4
				break
			} else {
				break
			}
		}
		indented := indent >= 4
		if inCodeBlock && !blank && !indented {
			inCodeBlock = false
		}
		if !inCodeBlock && previousBlank && indented && !blank {
			inCodeBlock = true
		}
		if inCodeBlock || protected[lineStart] {
			markProtected(lineStart, lineEnd)
		}
		previousBlank = blank
		lineStart = lineEnd
	}
}

func protectObsidianHTML(data []byte, protected []bool, markProtected func(start, end int)) {
	lowerData := bytes.ToLower(data)
	for index := 0; index < len(data); index++ {
		if data[index] != '<' || protected[index] {
			continue
		}
		if bytes.HasPrefix(data[index:], []byte("<!--")) {
			end := len(data)
			if closeIndex := bytes.Index(data[index+4:], []byte("-->")); closeIndex >= 0 {
				end = index + 4 + closeIndex + 3
			}
			markProtected(index, end)
			index = end - 1
			continue
		}
		tagEnd := obsidianHTMLTagEnd(data, index)
		if tagEnd < 0 {
			continue
		}
		tagName, closing := obsidianHTMLTagName(data[index:tagEnd])
		if tagName == "" {
			continue
		}
		end := tagEnd
		if !closing && data[tagEnd-2] != '/' {
			closingTag := []byte("</" + strings.ToLower(tagName))
			if closeIndex := bytes.Index(lowerData[tagEnd:], closingTag); closeIndex >= 0 {
				closeStart := tagEnd + closeIndex
				closeEnd := obsidianHTMLTagEnd(data, closeStart)
				lineEnd := bytes.IndexByte(data[tagEnd:], '\n')
				lineStart := bytes.LastIndexByte(data[:index], '\n') + 1
				atLineStart := len(bytes.TrimSpace(data[lineStart:index])) == 0
				if closeEnd >= 0 && (atLineStart || lineEnd < 0 || closeEnd <= tagEnd+lineEnd+1) {
					end = closeEnd
				}
			}
		}
		markProtected(index, end)
		index = end - 1
	}
}

func obsidianHTMLTagEnd(data []byte, start int) int {
	quote := byte(0)
	for index := start + 1; index < len(data); index++ {
		if quote != 0 {
			if data[index] == quote {
				quote = 0
			}
			continue
		}
		if data[index] == '\'' || data[index] == '"' {
			quote = data[index]
			continue
		}
		if data[index] == '>' {
			return index + 1
		}
		if data[index] == '\n' || data[index] == '\r' {
			return -1
		}
	}
	return -1
}

func obsidianHTMLTagName(tag []byte) (name string, closing bool) {
	index := 1
	if index < len(tag) && tag[index] == '/' {
		closing = true
		index++
	}
	start := index
	for index < len(tag) && (tag[index] >= 'a' && tag[index] <= 'z' || tag[index] >= 'A' && tag[index] <= 'Z' || tag[index] >= '0' && tag[index] <= '9' || tag[index] == '-') {
		index++
	}
	if index == start {
		return "", false
	}
	return string(tag[start:index]), closing
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

type obsidianTransformStats struct {
	ConvertedLinks      int
	ConvertedEmbeds     int
	ConvertedFootnotes  int
	PreservedUnresolved int
	PreservedComments   int
	ReservedIDs         map[string]bool
	FootnoteIDs         map[string]bool
}

func importObsidianVaultTask(ctx context.Context, taskID, notebookName string) {
	obsidianTasksMu.Lock()
	task := obsidianTasks[taskID]
	if task == nil || task.Context == nil || isObsidianTerminalState(task.State) {
		obsidianTasksMu.Unlock()
		return
	}
	vault := task.Context
	obsidianTasksMu.Unlock()

	if err := revalidateObsidianVault(ctx, vault); err != nil {
		if !errors.Is(err, context.Canceled) {
			failObsidianTask(taskID, "revalidating", err, nil)
		}
		return
	}
	if !updateObsidianTask(taskID, ObsidianTaskStateStaging, 10, "Converting Markdown") {
		return
	}

	tempRoot := obsidianTempPath(taskID)
	if err := os.RemoveAll(tempRoot); err != nil {
		failObsidianTask(taskID, "staging", err, nil)
		return
	}
	docsTemp := filepath.Join(tempRoot, "docs")
	assetsTemp := filepath.Join(tempRoot, "assets")
	if err := os.MkdirAll(docsTemp, 0755); err != nil {
		failObsidianTask(taskID, "staging", err, nil)
		return
	}

	result := &ObsidianVaultImportResult{
		NotebookName: notebookName, MarkdownCount: vault.Analysis.MarkdownCount,
		SyntheticParentCount: vault.Analysis.SyntheticParentCount, NameAdjustmentCount: vault.Analysis.NameAdjustmentCount,
		UnreferencedFileCount:    vault.Analysis.UnreferencedFileCount,
		PreservedUnresolvedCount: vault.Analysis.MissingCount + vault.Analysis.UnsupportedCount,
		SkippedPathCount: vault.Analysis.SkippedHiddenCount + vault.Analysis.SkippedLinkCount + vault.Analysis.SkippedSpecialCount +
			vault.Analysis.SkippedNestedVaultCount,
	}
	for index, doc := range vault.Docs {
		if err := ctx.Err(); err != nil {
			removeObsidianTemp(taskID)
			return
		}
		var tree *parse.Tree
		if doc.Synthetic {
			tree = treenode.NewTree("", doc.TargetPath, doc.HPath, doc.Title)
		} else {
			data, err := readStableObsidianFile(doc.Source)
			if err != nil {
				failObsidianTask(taskID, "staging", fmt.Errorf("read Markdown [%s]: %w", doc.Source.RelPath, err), nil)
				removeObsidianTemp(taskID)
				return
			}
			transformed, stats := transformObsidianMarkdown(vault, doc, data)
			tree, err = parseObsidianMd(transformed, vault, doc, stats)
			if err != nil {
				failObsidianTask(taskID, "staging", fmt.Errorf("convert Markdown [%s]: %w", doc.Source.RelPath, err), nil)
				removeObsidianTemp(taskID)
				return
			}
			result.ConvertedLinkCount += stats.ConvertedLinks
			result.ConvertedEmbedCount += stats.ConvertedEmbeds
			result.ConvertedFootnoteCount += stats.ConvertedFootnotes
			result.PreservedCommentCount += stats.PreservedComments
		}
		if err := writeObsidianTempTree(docsTemp, tree); err != nil {
			failObsidianTask(taskID, "staging", err, nil)
			removeObsidianTemp(taskID)
			return
		}
		updateObsidianTask(taskID, ObsidianTaskStateStaging, 10+(index+1)*55/maxInt(len(vault.Docs), 1), "Converting Markdown")
	}

	if err := os.MkdirAll(assetsTemp, 0755); err != nil {
		failObsidianTask(taskID, "staging", err, nil)
		removeObsidianTemp(taskID)
		return
	}
	var assetKeys []string
	for key := range vault.ImportAssets {
		assetKeys = append(assetKeys, key)
	}
	sort.Strings(assetKeys)
	for index, key := range assetKeys {
		if err := ctx.Err(); err != nil {
			removeObsidianTemp(taskID)
			return
		}
		asset := vault.ImportAssets[key]
		destination := filepath.Join(assetsTemp, asset.FinalName)
		if err := copyStableObsidianFile(asset.Source, destination); err != nil {
			failObsidianTask(taskID, "staging", fmt.Errorf("copy attachment [%s]: %w", asset.Source.RelPath, err), nil)
			removeObsidianTemp(taskID)
			return
		}
		result.ImportedAttachmentCount++
		updateObsidianTask(taskID, ObsidianTaskStateStaging, 65+(index+1)*15/maxInt(len(assetKeys), 1), "Copying attachments")
	}
	if err := writeObsidianSortFile(tempRoot, vault.Docs); err != nil {
		failObsidianTask(taskID, "staging", err, nil)
		removeObsidianTemp(taskID)
		return
	}
	if err := ctx.Err(); err != nil {
		removeObsidianTemp(taskID)
		return
	}

	if !updateObsidianTask(taskID, ObsidianTaskStateCreating, 82, "Creating notebook") {
		removeObsidianTemp(taskID)
		return
	}
	notebookName = availableObsidianNotebookName(notebookName)
	boxID, err := CreateBox(notebookName)
	if err != nil {
		failObsidianTask(taskID, "creating", err, result)
		removeObsidianTemp(taskID)
		return
	}
	result.NotebookID = boxID
	result.NotebookName = notebookName

	if !updateObsidianTask(taskID, ObsidianTaskStateWriting, 86, "Writing notebook") {
		markObsidianNotebookIncomplete(boxID, notebookName)
		removeObsidianTemp(taskID)
		return
	}
	boxDir := filepath.Join(util.DataDir, boxID)
	if err = copyObsidianTreeFiles(docsTemp, boxDir); err != nil {
		result.Incomplete = true
		markObsidianNotebookIncomplete(boxID, notebookName)
		failObsidianTask(taskID, "writing", err, result)
		removeObsidianTemp(taskID)
		return
	}
	sortData, readErr := os.ReadFile(filepath.Join(tempRoot, "sort.json"))
	if readErr != nil {
		result.Incomplete = true
		markObsidianNotebookIncomplete(boxID, notebookName)
		failObsidianTask(taskID, "writing", readErr, result)
		removeObsidianTemp(taskID)
		return
	}
	if err = filelock.WriteFile(filepath.Join(boxDir, ".siyuan", "sort.json"), sortData); err != nil {
		result.Incomplete = true
		markObsidianNotebookIncomplete(boxID, notebookName)
		failObsidianTask(taskID, "writing", err, result)
		removeObsidianTemp(taskID)
		return
	}
	if err = os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		result.Incomplete = true
		markObsidianNotebookIncomplete(boxID, notebookName)
		failObsidianTask(taskID, "writing", err, result)
		removeObsidianTemp(taskID)
		return
	}

	for _, key := range assetKeys {
		asset := vault.ImportAssets[key]
		source := filepath.Join(assetsTemp, asset.FinalName)
		destination := filepath.Join(util.DataDir, "assets", asset.FinalName)
		if filelock.IsExist(destination) {
			err = fmt.Errorf("global attachment [%s] already exists", asset.FinalName)
		} else {
			err = filelock.Rename(source, destination)
		}
		if err != nil {
			result.Incomplete = true
			markObsidianNotebookIncomplete(boxID, notebookName)
			failObsidianTask(taskID, "writing", err, result)
			removeObsidianTemp(taskID)
			return
		}
	}

	updateObsidianTask(taskID, ObsidianTaskStateIndexing, 95, "Indexing notebook")
	existed, err := Mount(boxID)
	if err != nil {
		result.Incomplete = true
		markObsidianNotebookIncomplete(boxID, notebookName)
		failObsidianTask(taskID, "indexing", err, result)
		removeObsidianTemp(taskID)
		return
	}
	box := Conf.Box(boxID)
	if box == nil {
		result.Incomplete = true
		markObsidianNotebookIncomplete(boxID, notebookName)
		failObsidianTask(taskID, "indexing", errors.New("created notebook is not mounted"), result)
		removeObsidianTemp(taskID)
		return
	}
	event := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
	event.Data = map[string]any{"box": box, "existed": existed}
	util.PushEvent(event)
	IncSync()
	removeObsidianTemp(taskID)

	obsidianTasksMu.Lock()
	if current := obsidianTasks[taskID]; current != nil && !isObsidianTerminalState(current.State) {
		current.Result = result
		finishObsidianTaskLocked(current, ObsidianTaskStateCompleted, "Import completed", "")
	}
	obsidianTasksMu.Unlock()
}

func revalidateObsidianVault(ctx context.Context, vault *obsidianVaultContext) error {
	fresh := &obsidianVaultContext{
		Root: vault.Root, Files: map[string]*obsidianSourceFile{}, Assets: map[string]*obsidianAssetPlan{},
		Analysis: &ObsidianVaultAnalysis{BlockingErrors: []string{}, Warnings: []string{}},
	}
	if err := scanObsidianVaultFiles(ctx, fresh, "", vault.Root); err != nil {
		return err
	}
	originalMarkdown := map[string]bool{}
	for _, doc := range vault.Docs {
		if !doc.Synthetic {
			originalMarkdown[obsidianPathKey(doc.Source.RelPath)] = true
		}
	}
	currentMarkdown := map[string]bool{}
	for key, file := range fresh.Files {
		if file.IsMD {
			currentMarkdown[key] = true
		}
	}
	if len(originalMarkdown) != len(currentMarkdown) {
		return errors.New("the Markdown file list changed after analysis")
	}
	for key := range originalMarkdown {
		if !currentMarkdown[key] {
			return errors.New("the Markdown file list changed after analysis")
		}
	}
	if len(vault.Assets) != len(fresh.Assets) {
		return errors.New("the attachment file list changed after analysis")
	}
	for key := range vault.Assets {
		if fresh.Assets[key] == nil {
			return errors.New("the attachment file list changed after analysis")
		}
	}
	for _, doc := range vault.Docs {
		if doc.Synthetic {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := validateObsidianSourceMetadata(doc.Source); err != nil {
			return fmt.Errorf("Markdown [%s] changed after analysis: %w", doc.Source.RelPath, err)
		}
	}
	for _, asset := range vault.ImportAssets {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := validateObsidianSourceMetadata(asset.Source); err != nil {
			return fmt.Errorf("attachment [%s] changed after analysis: %w", asset.Source.RelPath, err)
		}
	}
	return nil
}

func validateObsidianSourceMetadata(file *obsidianSourceFile) error {
	info, err := os.Stat(file.AbsPath)
	if err != nil {
		return err
	}
	if info.Size() != file.Size || !info.ModTime().Equal(file.ModTime) {
		return errors.New("path, size or modification time differs")
	}
	return nil
}

func transformObsidianMarkdown(vault *obsidianVaultContext, doc *obsidianDocPlan, data []byte) ([]byte, *obsidianTransformStats) {
	scan := scanObsidianSource(data)
	stats := &obsidianTransformStats{ReservedIDs: map[string]bool{}, FootnoteIDs: map[string]bool{}, PreservedComments: len(scan.Comments)}
	for _, heading := range doc.Headings {
		stats.ReservedIDs[heading.ID] = true
	}
	for _, id := range doc.BlockIDs {
		stats.ReservedIDs[id] = true
	}

	type replacement struct {
		start int
		end   int
		text  string
	}
	var replacements []replacement
	for _, token := range scan.Wikis {
		resolved := resolveObsidianTarget(vault, doc, token.Target)
		if resolved.Status != "resolved" {
			stats.PreservedUnresolved++
			continue
		}
		converted := renderObsidianWikiToken(token, resolved, stats)
		if converted != "" {
			replacements = append(replacements, replacement{start: token.Start, end: token.End, text: converted})
		}
	}
	sort.Slice(replacements, func(i, j int) bool { return replacements[i].start > replacements[j].start })
	ret := append([]byte(nil), data...)
	for _, item := range replacements {
		ret = append(ret[:item.start], append([]byte(item.text), ret[item.end:]...)...)
	}
	ret = convertObsidianFootnotes(ret, stats)
	ret = injectObsidianBlockIAL(ret, doc)
	return ret, stats
}

func renderObsidianWikiToken(token obsidianWikiToken, resolved obsidianResolvedTarget, stats *obsidianTransformStats) string {
	if resolved.Doc != nil {
		if token.Embed {
			stats.ConvertedEmbeds++
			return "\n\n{{SELECT * FROM blocks WHERE id = '" + resolved.ID + "'}}\n\n"
		}
		stats.ConvertedLinks++
		anchor := obsidianWikiLinkAnchor(token, resolved.Doc)
		if token.Alias == "" {
			return "((" + resolved.ID + " '" + escapeObsidianDynamicBlockRefText(anchor) + "'))"
		}
		return "((" + resolved.ID + " \"" + escapeObsidianBlockRefText(anchor) + "\"))"
	}
	if resolved.Asset == nil {
		return ""
	}
	stats.ConvertedLinks++
	assetPath := "assets/" + resolved.Asset.FinalName
	label := token.Alias
	if label == "" {
		label = filepath.Base(resolved.Asset.Source.RelPath)
	}
	if token.Embed && isObsidianImage(resolved.Asset.Source.RelPath) {
		width, height, hasSize := parseObsidianImageSize(token.Alias)
		image := "![" + escapeObsidianMarkdownText(filepath.Base(resolved.Asset.Source.RelPath)) + "](" + assetPath + ")"
		if hasSize {
			style := "width: " + strconv.Itoa(width) + "px;"
			if height > 0 {
				style += " height: " + strconv.Itoa(height) + "px;"
			}
			image += "{: style=\"" + style + "\"}"
		}
		return image
	}
	return "[" + escapeObsidianMarkdownText(label) + "](" + assetPath + ")"
}

func obsidianWikiLinkAnchor(token obsidianWikiToken, doc *obsidianDocPlan) string {
	if token.Alias != "" {
		return token.Alias
	}
	target := strings.TrimSpace(token.Target)
	if decoded, err := url.PathUnescape(target); err == nil {
		target = decoded
	}
	target = strings.ReplaceAll(target, "\\", "/")
	docPart, fragment, _ := strings.Cut(target, "#")
	fragment = strings.TrimSpace(fragment)
	if fragment != "" && !strings.HasPrefix(fragment, "^") {
		parts := strings.Split(fragment, "#")
		if heading := strings.TrimSpace(parts[len(parts)-1]); heading != "" {
			return heading
		}
	}
	docPart = strings.TrimSpace(docPart)
	if docPart != "" {
		docPart = strings.TrimSuffix(docPart, path.Ext(docPart))
		if title := path.Base(docPart); title != "." && title != "/" && title != "" {
			return title
		}
	}
	return doc.Title
}

func escapeObsidianBlockRefText(text string) string {
	return strings.ReplaceAll(strings.ReplaceAll(text, "\\", "\\\\"), "\"", "\\\"")
}

func escapeObsidianDynamicBlockRefText(text string) string {
	return strings.ReplaceAll(strings.ReplaceAll(text, "\\", "\\\\"), "'", "\\'")
}

func escapeObsidianMarkdownText(text string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "[", "\\[", "]", "\\]")
	return replacer.Replace(text)
}

func isObsidianImage(filePath string) bool {
	ext := strings.ToLower(path.Ext(filePath))
	for _, imageExt := range util.SiYuanAssetsImage {
		if ext == imageExt {
			return true
		}
	}
	return false
}

func parseObsidianImageSize(value string) (width, height int, ok bool) {
	if value == "" {
		return
	}
	parts := strings.Split(strings.ToLower(strings.TrimSpace(value)), "x")
	if len(parts) > 2 {
		return
	}
	width, err := strconv.Atoi(parts[0])
	if err != nil || width < 1 || width > 10000 {
		return 0, 0, false
	}
	if len(parts) == 2 {
		height, err = strconv.Atoi(parts[1])
		if err != nil || height < 1 || height > 10000 {
			return 0, 0, false
		}
	}
	return width, height, true
}

func convertObsidianFootnotes(data []byte, stats *obsidianTransformStats) []byte {
	scan := scanObsidianSource(data)
	masked := maskObsidianProtected(data, scan.Protected)
	definitionPattern := regexp.MustCompile(`(?m)^\[\^([^\]\r\n]+)\]:[ \t]*(.*?)[ \t]*\r?$`)
	matches := definitionPattern.FindAllSubmatchIndex(masked, -1)
	if len(matches) == 0 {
		return data
	}
	type definition struct {
		label string
		text  string
		start int
		end   int
		id    string
	}
	definitions := map[string][]*definition{}
	var orderedDefinitions []*definition
	for _, match := range matches {
		label := string(data[match[2]:match[3]])
		def := &definition{label: label, text: string(data[match[4]:match[5]]), start: match[0], end: match[1], id: ast.NewNodeID()}
		definitions[label] = append(definitions[label], def)
		orderedDefinitions = append(orderedDefinitions, def)
	}
	refPattern := regexp.MustCompile(`\[\^([^\]\r\n]+)\]`)
	refMatches := refPattern.FindAllSubmatchIndex(masked, -1)
	var orderedLabels []string
	seen := map[string]bool{}
	for _, match := range refMatches {
		insideDefinition := false
		for _, def := range orderedDefinitions {
			if match[0] >= def.start && match[1] <= def.end {
				insideDefinition = true
				break
			}
		}
		if insideDefinition {
			continue
		}
		label := string(data[match[2]:match[3]])
		if len(definitions[label]) == 1 && !seen[label] {
			seen[label] = true
			orderedLabels = append(orderedLabels, label)
		}
	}
	for _, def := range orderedDefinitions {
		if len(definitions[def.label]) == 1 && !seen[def.label] {
			seen[def.label] = true
			orderedLabels = append(orderedLabels, def.label)
		}
	}
	if len(orderedLabels) == 0 {
		return data
	}
	numbers := map[string]int{}
	for index, label := range orderedLabels {
		numbers[label] = index + 1
		def := definitions[label][0]
		stats.ReservedIDs[def.id] = true
		stats.FootnoteIDs[def.id] = true
	}

	type replacement struct {
		start int
		end   int
		text  string
	}
	var replacements []replacement
	for _, def := range orderedDefinitions {
		if len(definitions[def.label]) == 1 {
			replacements = append(replacements, replacement{start: def.start, end: def.end})
		}
	}
	for _, match := range refMatches {
		insideDefinition := false
		for _, def := range orderedDefinitions {
			if match[0] >= def.start && match[1] <= def.end {
				insideDefinition = true
				break
			}
		}
		if insideDefinition {
			continue
		}
		label := string(data[match[2]:match[3]])
		defs := definitions[label]
		if len(defs) != 1 {
			continue
		}
		number := numbers[label]
		replacements = append(replacements, replacement{
			start: match[0], end: match[1], text: fmt.Sprintf("((%s \"[%d]\"))", defs[0].id, number),
		})
	}
	sort.Slice(replacements, func(i, j int) bool { return replacements[i].start > replacements[j].start })
	ret := append([]byte(nil), data...)
	for _, item := range replacements {
		ret = append(ret[:item.start], append([]byte(item.text), ret[item.end:]...)...)
	}
	ret = bytes.TrimRight(ret, "\r\n")
	ret = append(ret, []byte("\n\n")...)
	for _, label := range orderedLabels {
		def := definitions[label][0]
		line := fmt.Sprintf("%d. %s\n   {: id=\"%s\"}\n", numbers[label], def.text, def.id)
		ret = append(ret, []byte(line)...)
		stats.ConvertedFootnotes++
	}
	return ret
}

func injectObsidianBlockIAL(data []byte, doc *obsidianDocPlan) []byte {
	if len(doc.BlockIDs) == 0 {
		return data
	}
	scan := scanObsidianSource(data)
	masked := maskObsidianProtected(data, scan.Protected)
	matches := obsidianBlockIDPattern.FindAllSubmatchIndex(masked, -1)
	firstMatches := map[string]int{}
	for index, match := range matches {
		blockID := string(data[match[2]:match[3]])
		if _, ok := firstMatches[blockID]; !ok {
			firstMatches[blockID] = index
		}
	}
	ret := append([]byte(nil), data...)
	for index := len(matches) - 1; index >= 0; index-- {
		match := matches[index]
		blockID := string(data[match[2]:match[3]])
		if doc.BlockIDs[blockID] == "" || (doc.DuplicateBlocks[blockID] && firstMatches[blockID] != index) {
			continue
		}
		lineStart := bytes.LastIndexByte(data[:match[0]], '\n') + 1
		linePrefix := strings.TrimRight(string(data[lineStart:match[0]]), " \t")
		quotePrefix, blockPrefix := splitObsidianQuotePrefix(linePrefix)
		if listItemMatch := obsidianListItemPattern.FindStringSubmatch(blockPrefix); len(listItemMatch) == 3 {
			replacement := []byte(quotePrefix + listItemMatch[1] + "{: id=\"" + doc.BlockIDs[blockID] + "\"}" + listItemMatch[2])
			ret = append(ret[:lineStart], append(replacement, ret[match[1]:]...)...)
			continue
		}
		replacement := []byte("\n" + quotePrefix + "{: id=\"" + doc.BlockIDs[blockID] + "\"}")
		ret = append(ret[:match[0]], append(replacement, ret[match[1]:]...)...)
	}
	return ret
}

func splitObsidianQuotePrefix(line string) (prefix, content string) {
	match := obsidianQuotePattern.FindStringSubmatch(line)
	if len(match) != 3 {
		return "", line
	}
	return match[1], match[2]
}

func maskObsidianProtected(data []byte, spans []obsidianSpan) []byte {
	ret := append([]byte(nil), data...)
	for _, span := range spans {
		for index := span.Start; index < span.End && index < len(ret); index++ {
			if ret[index] != '\r' && ret[index] != '\n' {
				ret[index] = ' '
			}
		}
	}
	return ret
}

func parseObsidianMd(markdown []byte, vault *obsidianVaultContext, doc *obsidianDocPlan, stats *obsidianTransformStats) (*parse.Tree, error) {
	luteEngine := util.NewStdLute()
	luteEngine.SetYamlFrontMatter(true)
	luteEngine.SetBlockRef(true)
	luteEngine.SetKramdownIAL(true)
	luteEngine.SetCallout(true)
	luteEngine.SetArbitraryTaskListItemMarker(true)
	luteEngine.SetExportNormalizeTaskListMarker(false)
	luteEngine.SetSup(true)
	tree := parse.Parse("", markdown, luteEngine.ParseOptions)
	if tree == nil {
		return nil, errors.New("parse tree failed")
	}
	normalizeTree(tree)
	normalizeObsidianCallouts(tree)
	htmlBlock2Inline(tree)
	parse.TextMarks2Inlines(tree)
	parse.NestedInlines2FlattedSpansHybrid(tree, false)
	markObsidianFootnoteRefs(tree, stats)
	rewriteObsidianMarkdownLinks(tree, vault, doc, stats)
	assignObsidianTreeIDs(tree, doc, stats.ReservedIDs)
	return tree, nil
}

func markObsidianFootnoteRefs(tree *parse.Tree, stats *obsidianTransformStats) {
	if len(stats.FootnoteIDs) == 0 {
		return
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && treenode.IsBlockRef(node) && stats.FootnoteIDs[node.TextMarkBlockRefID] {
			node.TextMarkType += " sup"
		}
		return ast.WalkContinue
	})
}

func normalizeObsidianCallouts(tree *parse.Tree) {
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || node.Type != ast.NodeCallout {
			return ast.WalkContinue
		}
		typ := strings.ToUpper(node.CalloutType)
		if !ast.IsBuiltInCalloutType(typ) {
			return ast.WalkContinue
		}
		node.CalloutType = typ
		if node.CalloutIcon == "" {
			node.CalloutIcon = ast.GetCalloutIcon(typ)
		}
		if node.CalloutTitle == "" {
			node.CalloutTitle = ast.GetCalloutTitle(typ)
		}
		return ast.WalkSkipChildren
	})
}

func rewriteObsidianMarkdownLinks(tree *parse.Tree, vault *obsidianVaultContext, doc *obsidianDocPlan, stats *obsidianTransformStats) {
	if vault == nil {
		return
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.Type == ast.NodeImage {
			destination := node.ChildByType(ast.NodeLinkDest)
			if destination == nil {
				return ast.WalkContinue
			}
			resolved := resolveObsidianMarkdownDestination(vault, doc, destination.TokensStr())
			if resolved.Status != "resolved" || resolved.Asset == nil {
				return ast.WalkContinue
			}
			destination.Tokens = []byte("assets/" + resolved.Asset.FinalName)
			if !isObsidianImage(resolved.Asset.Source.RelPath) {
				node.Type = ast.NodeLink
				if node.FirstChild != nil && node.FirstChild.Type == ast.NodeBang {
					node.FirstChild.Unlink()
				}
			}
			stats.ConvertedLinks++
			return ast.WalkSkipChildren
		}
		if node.IsTextMarkType("a") {
			resolved := resolveObsidianMarkdownDestination(vault, doc, node.TextMarkAHref)
			if resolved.Status != "resolved" {
				return ast.WalkContinue
			}
			if resolved.Asset != nil {
				node.TextMarkAHref = "assets/" + resolved.Asset.FinalName
				stats.ConvertedLinks++
				return ast.WalkContinue
			}
			if resolved.Doc != nil {
				types := strings.Fields(node.TextMarkType)
				for index, typ := range types {
					if typ == "a" {
						types[index] = "block-ref"
					}
				}
				node.TextMarkType = strings.Join(types, " ")
				node.TextMarkBlockRefID = resolved.ID
				node.TextMarkBlockRefSubtype = "s"
				node.TextMarkAHref = ""
				stats.ReservedIDs[resolved.ID] = true
				stats.ConvertedLinks++
			}
			return ast.WalkContinue
		}
		if node.Type == ast.NodeLinkDest {
			resolved := resolveObsidianMarkdownDestination(vault, doc, node.TokensStr())
			if resolved.Status == "resolved" && resolved.Asset != nil {
				node.Tokens = []byte("assets/" + resolved.Asset.FinalName)
				stats.ConvertedLinks++
			}
		}
		return ast.WalkContinue
	})
}

func assignObsidianTreeIDs(tree *parse.Tree, doc *obsidianDocPlan, reservedIDs map[string]bool) {
	headingIndex := 0
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeHeading && headingIndex < len(doc.Headings) {
			node.ID = doc.Headings[headingIndex].ID
			node.SetIALAttr("id", node.ID)
			reservedIDs[node.ID] = true
			headingIndex++
		}
		return ast.WalkContinue
	})
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !node.IsBlock() || node.Type == ast.NodeKramdownBlockIAL {
			return ast.WalkContinue
		}
		if node.Type == ast.NodeDocument {
			node.ID = doc.ID
		} else if !reservedIDs[node.ID] {
			node.ID = ast.NewNodeID()
		}
		node.SetIALAttr("id", node.ID)
		node.SetIALAttr("updated", util.TimeFromID(node.ID))
		return ast.WalkContinue
	})
	tree.ID = doc.ID
	tree.Box = ""
	tree.Path = doc.TargetPath
	tree.HPath = doc.HPath
	tree.Root.Box = ""
	tree.Root.Path = doc.TargetPath
	tree.Root.Spec = treenode.CurrentSpec
	tree.Root.SetIALAttr("id", doc.ID)
	tree.Root.SetIALAttr("title", doc.Title)
	tree.Root.SetIALAttr("updated", util.TimeFromID(doc.ID))
	tree.Root.RemoveIALAttrsByPrefix("custom-")
}

func writeObsidianTempTree(docsTemp string, tree *parse.Tree) error {
	if tree == nil || tree.Root == nil {
		return errors.New("cannot stage an empty tree")
	}
	if tree.Root.FirstChild == nil {
		tree.Root.AppendChild(treenode.NewParagraph(""))
	}
	treenode.UpgradeSpec(tree)
	tree.Root.SetIALAttr("type", "doc")
	luteEngine := util.NewLute()
	renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	data := renderer.Render()
	if !json.Valid(data) {
		return fmt.Errorf("generated tree [%s] is not valid JSON", tree.HPath)
	}
	if !util.UseSingleLineSave {
		var buffer bytes.Buffer
		if err := json.Indent(&buffer, data, "", "\t"); err != nil {
			return err
		}
		data = buffer.Bytes()
	}
	target := filepath.Join(docsTemp, filepath.FromSlash(strings.TrimPrefix(tree.Path, "/")))
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	return filelock.WriteFile(target, data)
}

func copyStableObsidianFile(source *obsidianSourceFile, destination string) error {
	if err := validateObsidianSourceMetadata(source); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	if err := filelock.Copy(source.AbsPath, destination); err != nil {
		return err
	}
	return validateObsidianSourceMetadata(source)
}

func writeObsidianSortFile(tempRoot string, docs []*obsidianDocPlan) error {
	grouped := map[string][]*obsidianDocPlan{}
	for _, doc := range docs {
		grouped[path.Dir(doc.TargetPath)] = append(grouped[path.Dir(doc.TargetPath)], doc)
	}
	sortValues := map[string]int{}
	for _, group := range grouped {
		sort.Slice(group, func(i, j int) bool { return strings.ToLower(group[i].RelPath) < strings.ToLower(group[j].RelPath) })
		for index, doc := range group {
			sortValues[doc.ID] = index
		}
	}
	data, err := gulu.JSON.MarshalJSON(sortValues)
	if err != nil {
		return err
	}
	return filelock.WriteFile(filepath.Join(tempRoot, "sort.json"), data)
}

func copyObsidianTreeFiles(sourceRoot, destinationRoot string) error {
	return filepath.WalkDir(sourceRoot, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(sourceRoot, current)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		destination := filepath.Join(destinationRoot, rel)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0755)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("staged document tree contains a symbolic link")
		}
		return filelock.Copy(current, destination)
	})
}

func availableObsidianNotebookName(requested string) string {
	base := sanitizeObsidianTitle(requested)
	existing := map[string]bool{}
	boxes, _ := ListNotebooks()
	for _, box := range boxes {
		existing[strings.ToLower(box.Name)] = true
	}
	if !existing[strings.ToLower(base)] {
		return base
	}
	for index := 2; ; index++ {
		candidate := fmt.Sprintf("%s (%d)", base, index)
		if !existing[strings.ToLower(candidate)] {
			return candidate
		}
	}
}

func markObsidianNotebookIncomplete(boxID, originalName string) {
	box := Conf.GetBox(boxID)
	if box == nil {
		return
	}
	conf := box.GetConf()
	conf.Name = originalName + Conf.Language(335)
	if err := box.SaveConf(conf); err != nil {
		logging.LogErrorf("mark incomplete Obsidian notebook [%s] failed: %s", boxID, err)
	}
}

func obsidianTempPath(taskID string) string {
	return filepath.Join(util.TempDir, "import", "obsidian", taskID)
}

func removeObsidianTemp(taskID string) {
	root := filepath.Join(util.TempDir, "import", "obsidian")
	target := obsidianTempPath(taskID)
	if !gulu.File.IsSubPath(root, target) {
		return
	}
	if err := os.RemoveAll(target); err != nil {
		logging.LogWarnf("remove Obsidian import temp [%s] failed: %s", target, err)
	}
}

// Obsidian 导入保持独立实现，避免改变通用 Markdown 导入行为。
