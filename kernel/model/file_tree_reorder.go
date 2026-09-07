package model

import (
	"fmt"
	"maps"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// fileTreeSortLess 只比较排序规则字段，相同值由自定义顺序决定。
func fileTreeSortLess(left, right *File, mode int) bool {
	leftName, rightName := left.Name, right.Name
	if left.TitleEmpty {
		leftName = Conf.Language(16)
	}
	if right.TitleEmpty {
		rightName = Conf.Language(16)
	}
	switch mode {
	case util.SortModeNameASC:
		return util.PinYinCompare4FileTree(leftName, rightName)
	case util.SortModeNameDESC:
		return util.PinYinCompare4FileTree(rightName, leftName)
	case util.SortModeAlphanumASC:
		return util.NaturalCompare(leftName, rightName) && !util.NaturalCompare(rightName, leftName)
	case util.SortModeAlphanumDESC:
		return util.NaturalCompare(rightName, leftName) && !util.NaturalCompare(leftName, rightName)
	case util.SortModeUpdatedASC:
		return left.Mtime < right.Mtime
	case util.SortModeUpdatedDESC:
		return left.Mtime > right.Mtime
	case util.SortModeCreatedASC:
		return left.CTime < right.CTime
	case util.SortModeCreatedDESC:
		return left.CTime > right.CTime
	case util.SortModeRefCountASC:
		return left.Count < right.Count
	case util.SortModeRefCountDESC:
		return left.Count > right.Count
	case util.SortModeSizeASC:
		return left.Size < right.Size
	case util.SortModeSizeDESC:
		return left.Size > right.Size
	case util.SortModeSubDocCountASC:
		return left.SubFileCount < right.SubFileCount
	case util.SortModeSubDocCountDESC:
		return left.SubFileCount > right.SubFileCount
	}
	return false
}

func sortDocTreeFiles(docs []*File, mode int) {
	sort.SliceStable(docs, func(i, j int) bool {
		left, right := docs[i], docs[j]
		if fileTreeSortLess(left, right, mode) {
			return true
		}
		if fileTreeSortLess(right, left, mode) {
			return false
		}
		if left.Sort != right.Sort {
			return left.Sort < right.Sort
		}
		return left.ID > right.ID
	})
}

type DocTreeReorderResult struct {
	Changed    bool   `json:"changed"`
	Conflict   bool   `json:"conflict"`
	Notebook   string `json:"notebook"`
	ParentPath string `json:"parentPath"`
}

// 父级已经使用自定义排序时恢复继承，避免留下多余的排序覆盖。
func resolveDraggedDocSortMode(boxID, listPath string) (*int, error) {
	mode := util.SortModeCustom
	if listPath == "/" {
		if Conf.FileTree.Sort == util.SortModeCustom {
			mode = util.SortModeFileTree
		}
		return &mode, nil
	}
	parentPath := path.Dir(strings.TrimSuffix(listPath, ".sy"))
	if parentPath != "/" {
		parentPath += ".sy"
	}
	inherited, err := ResolveDocTreeSortMode(boxID, parentPath)
	if err != nil {
		return nil, err
	}
	if inherited == util.SortModeCustom {
		return nil, nil
	}
	return &mode, nil
}

// ReorderDocTree 在移动前检查完整列表，确认冲突后仅设置目标列表的排序方式。
func ReorderDocTree(sourceIDs []string, targetID, position string, preview, removeSorts bool) (ret *DocTreeReorderResult, err error) {
	if err = validateReorderArgs(sourceIDs, targetID, position); err != nil {
		return
	}
	FlushTxQueue()
	target := treenode.GetBlockTree(targetID)
	if !isSortableDocument(target) || Conf.Box(target.BoxID) == nil {
		return nil, fmt.Errorf("target document [%s] is unavailable", targetID)
	}
	box := Conf.Box(target.BoxID)
	parentDir := path.Dir(target.Path)
	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	existingSorts, err := readSortConfMap(confPath)
	if err != nil {
		return nil, err
	}
	listPath := parentDir
	if listPath != "/" {
		listPath += ".sy"
	}
	mode, err := ResolveDocTreeSortMode(box.ID, listPath)
	if err != nil {
		return nil, err
	}
	// 隐藏文档和超过显示上限的文档也必须参与排序。
	docs, _, err := ListDocTree(box.ID, listPath, mode, false, true, int(^uint(0)>>1))
	if err != nil {
		return nil, err
	}
	byID := map[string]*File{}
	currentIDs := make([]string, 0, len(docs))
	for _, doc := range docs {
		byID[doc.ID] = doc
		currentIDs = append(currentIDs, doc.ID)
	}
	siblingIDs, err := loadSiblingCustomOrder(box.ID, parentDir, existingSorts)
	if err != nil {
		return nil, err
	}
	for _, id := range siblingIDs {
		if byID[id] == nil {
			return nil, fmt.Errorf("document [%s] could not be read", id)
		}
	}
	var fromPaths []string
	for _, id := range sourceIDs {
		source := treenode.GetBlockTree(id)
		if !isSortableDocument(source) || Conf.Box(source.BoxID) == nil {
			return nil, fmt.Errorf("source document [%s] is unavailable", id)
		}
		if source.BoxID == target.BoxID && (target.Path == source.Path ||
			strings.HasPrefix(target.Path, strings.TrimSuffix(source.Path, ".sy")+"/")) {
			return nil, fmt.Errorf("cannot move document [%s] into itself", id)
		}
		if byID[id] != nil {
			continue
		}
		sourceParent := path.Dir(source.Path)
		if sourceParent != "/" {
			sourceParent += ".sy"
		}
		sourceDocs, _, loadErr := ListDocTree(source.BoxID, sourceParent, util.SortModeCustom, false, true, int(^uint(0)>>1))
		if loadErr != nil {
			return nil, loadErr
		}
		for _, doc := range sourceDocs {
			if doc.ID == id {
				byID[id] = doc
				break
			}
		}
		if byID[id] == nil {
			return nil, fmt.Errorf("source document [%s] could not be read", id)
		}
		currentIDs = append(currentIDs, id)
		fromPaths = append(fromPaths, source.Path)
	}
	orderedIDs, changed, err := reorderIDSequence(currentIDs, sourceIDs, targetID, position)
	if err != nil {
		return nil, err
	}
	ret = &DocTreeReorderResult{Changed: changed || len(fromPaths) > 0, Notebook: box.ID, ParentPath: listPath}
	for i := 1; i < len(orderedIDs); i++ {
		if fileTreeSortLess(byID[orderedIDs[i]], byID[orderedIDs[i-1]], mode) {
			ret.Conflict = true
			break
		}
	}
	if preview || !ret.Changed || ret.Conflict && !removeSorts {
		return ret, nil
	}
	var declaredMode *int
	if ret.Conflict {
		declaredMode, err = resolveDraggedDocSortMode(box.ID, listPath)
		if err != nil {
			return ret, err
		}
	}
	if len(fromPaths) > 0 {
		if err = MoveDocs(fromPaths, box.ID, listPath, nil); err != nil {
			return ret, err
		}
	}
	fileTreeSortLock.Lock()
	fullSortIDs, err := readSortConfMap(confPath)
	if err != nil {
		fileTreeSortLock.Unlock()
		return ret, err
	}
	sortIDs := map[string]int{}
	for i, id := range orderedIDs {
		sortIDs[id] = i + 1
	}
	maps.Copy(fullSortIDs, sortIDs)
	err = writeSortConfMap(confPath, fullSortIDs)
	fileTreeSortLock.Unlock()
	if err != nil {
		return ret, err
	}
	if ret.Conflict {
		if listPath == "/" {
			boxConf := box.GetConf()
			boxConf.SortMode = *declaredMode
			if err = box.SaveConf(boxConf); err != nil {
				return ret, err
			}
			PushDocSortModeChanged("notebook", box.ID, "", "/", declaredMode)
		} else if _, err = SetDocSortMode(util.GetTreeID(listPath), declaredMode); err != nil {
			return ret, err
		}
	}
	IncSync()
	pushFiletreeSortChanged(sortIDs)
	return ret, nil
}
