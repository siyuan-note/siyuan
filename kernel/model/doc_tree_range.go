// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var errDocTreeChanged = errors.New("document tree changed, please retry")
var errDocTreeUnavailable = errors.New("document tree item is unavailable")

// DocTreeAccess 将目录可发现性和引用来源限制绑定到同一次请求的访问上下文。
type DocTreeAccess struct {
	Published      bool
	Policy         PublishAccess
	RefBoxes       []string
	PolicyRevision string
}

func DocTreePublishAccessRevision(policy PublishAccess) string {
	data, _ := json.Marshal(policy)
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

type DocTreeRange struct {
	Box, ParentID, Path, Revision  string
	Files                          []*File
	Total, Offset, Limit, SortMode int
	Stale                          bool
}

type DocTreeLocation struct {
	ParentID, Path, ID, Revision string
	Index, Total, SortMode       int
}

type docTreeQuery struct {
	box        *Box
	parentID   string
	listPath   string
	directory  string
	sortMode   int
	access     DocTreeAccess
	visibility func(string, string) bool
	key        string
	refSort    bool
}

type docTreeBuild struct {
	done  chan struct{}
	order *cache.DocTreeOrder
	err   error
}

var docTreeBuilds = struct {
	sync.Mutex
	values map[string]*docTreeBuild
}{values: map[string]*docTreeBuild{}}

func docTreeVisible(access DocTreeAccess) func(string, string) bool {
	if !access.Published {
		return func(string, string) bool { return true }
	}
	invisible := GetInvisiblePublishAccess(access.Policy)
	disabled := GetDisablePublishAccess(access.Policy)
	return func(box, p string) bool {
		return CheckPathAccessableByPublishIgnore(box, p, invisible) && CheckPathAccessableByPublishIgnore(box, p, disabled)
	}
}

// 直接读取已认证的属性，读取失败不作为可见文档计数，也不搬移源文件。
func readDocTreeIAL(box *Box, p string) (map[string]string, error) {
	if _, err := box.validateBoxPath(p); err != nil {
		return nil, err
	}
	ial, err := filesys.DocIAL(filepath.Join(util.DataDir, box.ID, p))
	if err != nil {
		return nil, err
	}
	if len(ial) == 0 {
		return nil, filesys.ErrInvalidDocIAL
	}
	return ial, nil
}

func newDocTreeQuery(notebook, parentID string, access DocTreeAccess) (*docTreeQuery, error) {
	if access.Published && access.PolicyRevision != "" && access.PolicyRevision != DocTreePublishAccessRevision(GetPublishAccess()) {
		return nil, errDocTreeChanged
	}
	if !ast.IsNodeIDPattern(notebook) || parentID != "" && !ast.IsNodeIDPattern(parentID) {
		return nil, errDocTreeUnavailable
	}
	box := Conf.Box(notebook)
	if box == nil || access.Published && IsEncryptedBoxDeniedByPublishAccess(notebook) {
		return nil, errDocTreeUnavailable
	}
	if IsEncryptedBox(notebook) {
		if _, err := GetDEKIfUnlocked(notebook); err != nil {
			return nil, err
		}
	}
	query := &docTreeQuery{box: box, parentID: parentID, listPath: "/", directory: "/", access: access, visibility: docTreeVisible(access)}
	if parentID != "" {
		doc := treenode.GetBlockTreeInExactBox(parentID, notebook)
		if doc == nil || doc.Type != "d" || doc.RootID != parentID || IsBoxDoc(notebook, parentID) {
			return nil, errDocTreeUnavailable
		}
		query.listPath = doc.Path
		query.directory = strings.TrimSuffix(doc.Path, ".sy")
	}
	// 逐级验证可见性并复用同一祖先属性链解析继承排序。
	mode := util.SortModeUnassigned
	for current := query.listPath; current != "/"; {
		if !query.visibility(notebook, current) {
			return nil, errDocTreeUnavailable
		}
		ial, err := readDocTreeIAL(box, current)
		if err != nil {
			return nil, err
		}
		if ial[DocHiddenAttr] == "true" {
			return nil, errDocTreeUnavailable
		}
		if mode == util.SortModeUnassigned {
			if declared := docSortModeFromIAL(ial); declared != nil {
				mode = *declared
			}
		}
		current = path.Dir(strings.TrimSuffix(current, ".sy"))
		if current != "/" {
			current += ".sy"
		}
	}
	if mode == util.SortModeUnassigned {
		mode = box.GetConf().SortMode
		if mode == util.SortModeFileTree {
			mode = Conf.LoadFileTree().Sort
		}
	}
	query.sortMode = mode
	query.refSort = mode == util.SortModeRefCountASC || mode == util.SortModeRefCountDESC
	if !query.visibility(notebook, "/") {
		return nil, errDocTreeUnavailable
	}
	key, err := json.Marshal([]interface{}{util.DataDir, notebook, parentID, query.listPath, mode, Conf.Lang, access.Published, access.Policy, access.RefBoxes})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(key)
	query.key = hex.EncodeToString(digest[:])
	return query, nil
}

func (query *docTreeQuery) childCount(ctx context.Context, p string) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	directory := strings.TrimSuffix(p, ".sy")
	version, stable := cache.DocTreeSourceVersion(query.box.ID, true)
	if count, ok := cache.GetDocTreeChildCount(query.key, query.box.ID, directory); stable && ok {
		return count, nil
	}
	entries, err := os.ReadDir(filepath.Join(util.DataDir, query.box.ID, directory))
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	count := 0
	for _, entry := range entries {
		if err = ctx.Err(); err != nil {
			return 0, err
		}
		if !docTreeEntry(entry, query.box.ID) {
			continue
		}
		childPath := path.Join(strings.TrimSuffix(p, ".sy"), entry.Name())
		if !query.visibility(query.box.ID, childPath) {
			continue
		}
		ial, readErr := readDocTreeIAL(query.box, childPath)
		if readErr != nil {
			return 0, readErr
		}
		if ial[DocHiddenAttr] != "true" {
			count++
		}
	}
	if stable {
		cache.PutDocTreeChildCount(query.key, query.box.ID, directory, version, count)
	}
	return count, nil
}

func docTreeEntry(entry os.DirEntry, notebook string) bool {
	id, ok := strings.CutSuffix(entry.Name(), ".sy")
	return ok && entry.Type().IsRegular() && ast.IsNodeIDPattern(id) && id != notebook
}

func (query *docTreeQuery) readFile(p string) (*File, error) {
	ial, err := readDocTreeIAL(query.box, p)
	if err != nil {
		return nil, err
	}
	if ial[DocHiddenAttr] == "true" || !query.visibility(query.box.ID, p) {
		return nil, errDocTreeChanged
	}
	info, err := os.Stat(filepath.Join(util.DataDir, query.box.ID, p))
	if err != nil {
		return nil, err
	}
	file := query.box.docFromFileInfo(&FileInfo{path: p, name: path.Base(p), size: info.Size()}, ial)
	if file == nil {
		return nil, errDocTreeUnavailable
	}
	return file, nil
}

func (query *docTreeQuery) collect(ctx context.Context) (*cache.DocTreeOrder, error) {
	version, stable := cache.DocTreeSourceVersion(query.box.ID, query.refSort)
	if !stable {
		return nil, errDocTreeChanged
	}
	entries, err := os.ReadDir(filepath.Join(util.DataDir, query.box.ID, query.directory))
	if os.IsNotExist(err) && query.parentID != "" {
		entries, err = []os.DirEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	files := make([]*File, 0, len(entries))
	for _, entry := range entries {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		if !docTreeEntry(entry, query.box.ID) {
			continue
		}
		p := path.Join(query.directory, entry.Name())
		if !query.visibility(query.box.ID, p) {
			continue
		}
		ial, readErr := readDocTreeIAL(query.box, p)
		if readErr != nil {
			return nil, readErr
		}
		if ial[DocHiddenAttr] == "true" {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".sy")
		file := &File{ID: id, Path: p, Name: ial["title"], TitleEmpty: ial[NodeAttrTitleEmpty] == "true"}
		if query.sortMode == util.SortModeUpdatedASC || query.sortMode == util.SortModeUpdatedDESC ||
			query.sortMode == util.SortModeCreatedASC || query.sortMode == util.SortModeCreatedDESC {
			created, _ := time.ParseInLocation("20060102150405", id[:14], time.Local)
			file.CTime, file.Mtime = created.Unix(), created.Unix()
			if updated, parseErr := time.ParseInLocation("20060102150405", ial["updated"], time.Local); parseErr == nil {
				file.Mtime = updated.Unix()
			}
		}
		if query.sortMode == util.SortModeSizeASC || query.sortMode == util.SortModeSizeDESC {
			info, statErr := entry.Info()
			if statErr != nil {
				return nil, statErr
			}
			file.Size = uint64(info.Size())
		}
		if query.sortMode == util.SortModeSubDocCountASC || query.sortMode == util.SortModeSubDocCountDESC {
			file.SubFileCount, err = query.childCount(ctx, p)
			if err != nil {
				return nil, err
			}
		}
		files = append(files, file)
	}
	if query.refSort {
		counts, countErr := sql.QueryDocTreeRefCounts(nil, query.access.RefBoxes, query.visibility)
		if countErr != nil {
			return nil, countErr
		}
		for _, file := range files {
			file.Count = counts[file.ID]
		}
	}
	fileTreeSortLock.Lock()
	sorts, err := readDocTreeSorts(filepath.Join(util.DataDir, query.box.ID, ".siyuan", "sort.json"))
	fileTreeSortLock.Unlock()
	if err != nil {
		return nil, err
	}
	for _, file := range files {
		file.Sort = sorts[file.ID]
	}
	sortDocTreeFiles(files, query.sortMode)
	ids := make([]string, 0, len(files))
	positions := make([]int, 0, len(files))
	var childCounts []int
	if query.sortMode == util.SortModeSubDocCountASC || query.sortMode == util.SortModeSubDocCountDESC {
		childCounts = make([]int, 0, len(files))
	}
	for _, file := range files {
		ids = append(ids, file.ID)
		positions = append(positions, file.Sort)
		if childCounts != nil {
			childCounts = append(childCounts, file.SubFileCount)
		}
	}
	scope := cache.DocTreeOrderScope{Directory: query.directory, Sorts: positions, ChildCounts: childCounts,
		Title: query.sortMode == util.SortModeNameASC || query.sortMode == util.SortModeNameDESC ||
			query.sortMode == util.SortModeAlphanumASC || query.sortMode == util.SortModeAlphanumDESC,
		Updated: query.sortMode == util.SortModeUpdatedASC || query.sortMode == util.SortModeUpdatedDESC,
		Size:    query.sortMode == util.SortModeSizeASC || query.sortMode == util.SortModeSizeDESC}
	order, admitted := cache.PutDocTreeOrder(query.key, query.box.ID, query.refSort, version, ids, scope)
	if !admitted {
		return nil, errDocTreeChanged
	}
	return order, nil
}

// 范围读取只消费排序配置；损坏或中断的写入交由维护流程恢复，不在查询中重写源。
func readDocTreeSorts(filename string) (map[string]int, error) {
	data, err := filelock.ReadFile(filename)
	if os.IsNotExist(err) {
		return map[string]int{}, nil
	}
	if err != nil {
		return nil, err
	}
	var sorts map[string]int
	if err = json.Unmarshal(data, &sorts); err != nil {
		return nil, err
	}
	if sorts == nil {
		return nil, errors.New("invalid document tree sorting configuration")
	}
	return sorts, nil
}

func (query *docTreeQuery) order(ctx context.Context) (*cache.DocTreeOrder, error) {
	if cached := cache.GetDocTreeOrder(query.key, query.box.ID, query.refSort); cached != nil {
		return cached, nil
	}
	docTreeBuilds.Lock()
	if pending := docTreeBuilds.values[query.key]; pending != nil {
		docTreeBuilds.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-pending.done:
			return pending.order, pending.err
		}
	}
	pending := &docTreeBuild{done: make(chan struct{})}
	docTreeBuilds.values[query.key] = pending
	docTreeBuilds.Unlock()
	pending.order, pending.err = query.collect(ctx)
	docTreeBuilds.Lock()
	delete(docTreeBuilds.values, query.key)
	close(pending.done)
	docTreeBuilds.Unlock()
	return pending.order, pending.err
}

// 短暂让出执行机会，避免连续空转耗尽重试，而源写入尚无机会完成。
func waitDocTreeRetry(ctx context.Context, attempt int) error {
	if attempt == 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(time.Duration(attempt) * 20 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func ListDocTreeRange(ctx context.Context, notebook, parentID string, offset, limit int, revision string, access DocTreeAccess) (*DocTreeRange, error) {
	if offset < 0 || limit < 1 || limit > 10240 {
		return nil, fmt.Errorf("invalid document tree range")
	}
	for attempt := 0; attempt < 3; attempt++ {
		if err := waitDocTreeRetry(ctx, attempt); err != nil {
			return nil, err
		}
		version, stable := cache.DocTreeSourceVersion(notebook, true)
		if !stable {
			continue
		}
		query, err := newDocTreeQuery(notebook, parentID, access)
		if err != nil {
			return nil, err
		}
		order, err := query.order(ctx)
		if errors.Is(err, errDocTreeChanged) {
			continue
		}
		if err != nil {
			return nil, err
		}
		result := &DocTreeRange{Box: notebook, ParentID: parentID, Path: query.listPath, Revision: order.Revision(),
			Files: []*File{}, Total: order.Len(), Offset: min(offset, order.Len()), Limit: limit, SortMode: query.sortMode}
		result.Stale = revision != "" && revision != result.Revision
		if !result.Stale {
			ids := order.IDs(result.Offset, limit)
			counts, countErr := sql.QueryDocTreeRefCounts(ids, access.RefBoxes, query.visibility)
			if countErr != nil {
				return nil, countErr
			}
			for index, id := range ids {
				if err = ctx.Err(); err != nil {
					return nil, err
				}
				file, readErr := query.readFile(path.Join(query.directory, id+".sy"))
				if readErr != nil {
					err = readErr
					break
				}
				file.Count = counts[id]
				file.Sort = order.Sort(result.Offset + index)
				var cached bool
				file.SubFileCount, cached = order.ChildCount(result.Offset + index)
				if !cached {
					file.SubFileCount, err = query.childCount(ctx, file.Path)
					if err != nil {
						break
					}
					order.SetChildCount(result.Offset+index, file.SubFileCount)
				}
				result.Files = append(result.Files, file)
			}
		}
		current, stable := cache.DocTreeSourceVersion(notebook, true)
		if !stable || current != version || !cache.DocTreeOrderCurrent(order) {
			continue
		}
		if err != nil {
			return nil, err
		}
		return result, nil
	}
	return nil, errDocTreeChanged
}

func LocateDocTreeItem(ctx context.Context, notebook, id string, access DocTreeAccess) ([]DocTreeLocation, error) {
	if !ast.IsNodeIDPattern(id) || id == notebook {
		return nil, errDocTreeUnavailable
	}
	for attempt := 0; attempt < 3; attempt++ {
		if err := waitDocTreeRetry(ctx, attempt); err != nil {
			return nil, err
		}
		version, stable := cache.DocTreeSourceVersion(notebook, true)
		if !stable {
			continue
		}
		target := treenode.GetBlockTreeInExactBox(id, notebook)
		if target == nil || target.Type != "d" || target.RootID != id {
			return nil, errDocTreeUnavailable
		}
		ids := strings.Split(strings.Trim(strings.TrimSuffix(target.Path, ".sy"), "/"), "/")
		parentID := ""
		steps := make([]DocTreeLocation, 0, len(ids))
		var stepErr error
		for _, childID := range ids {
			query, err := newDocTreeQuery(notebook, parentID, access)
			if err != nil {
				stepErr = err
				break
			}
			order, err := query.order(ctx)
			if err != nil {
				stepErr = err
				break
			}
			index := order.Index(childID)
			if index < 0 {
				stepErr = errDocTreeUnavailable
				break
			}
			steps = append(steps, DocTreeLocation{ParentID: parentID, Path: query.listPath, ID: childID,
				Index: index, Total: order.Len(), SortMode: query.sortMode, Revision: order.Revision()})
			parentID = childID
		}
		current, stable := cache.DocTreeSourceVersion(notebook, true)
		if !stable || current != version || errors.Is(stepErr, errDocTreeChanged) {
			continue
		}
		if stepErr != nil {
			return nil, stepErr
		}
		return steps, nil
	}
	return nil, errDocTreeChanged
}
