package model

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type pinnedDocRef struct {
	ID       string `json:"id"`
	Notebook string `json:"notebook"`
}

type pinnedDocsStorage struct {
	Version int            `json:"version"`
	Docs    []pinnedDocRef `json:"docs"`
}

type PinnedDoc struct {
	ID, Notebook, Name, Path, Icon string
	SubFileCount                   int
	Unavailable                    bool
	ChildrenSortMode               *int
}

var pinnedDocsLock sync.Mutex

// 置顶入口允许普通笔记本根文档，不使用同级排序对根文档的排除规则。
func isPinnableDocument(tree *treenode.BlockTree) bool {
	return tree != nil && tree.ID == tree.RootID && tree.Type == "d" && !IsEncryptedBox(tree.BoxID)
}

func readPinnedDocs() (ret pinnedDocsStorage, err error) {
	ret = pinnedDocsStorage{Version: 1, Docs: []pinnedDocRef{}}
	data, err := filelock.ReadFile(filepath.Join(util.DataDir, "storage", "pinned-docs.json"))
	if os.IsNotExist(err) {
		return ret, nil
	}
	if err != nil {
		return
	}
	ret = pinnedDocsStorage{}
	if err = json.Unmarshal(data, &ret); err != nil {
		return
	}
	if ret.Version != 1 || ret.Docs == nil {
		return ret, fmt.Errorf("unsupported pinned documents version [%d]", ret.Version)
	}
	seen := map[string]bool{}
	for _, doc := range ret.Docs {
		if !ast.IsNodeIDPattern(doc.ID) || !ast.IsNodeIDPattern(doc.Notebook) || seen[doc.ID] {
			return ret, fmt.Errorf("invalid pinned document [%s]", doc.ID)
		}
		seen[doc.ID] = true
	}
	return
}

func writePinnedDocs(data pinnedDocsStorage) error {
	encoded, err := json.Marshal(data)
	if err != nil {
		return err
	}
	dir := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	if err = filelock.WriteFile(filepath.Join(dir, "pinned-docs.json"), encoded); err != nil {
		return err
	}
	IncSyncIfNeeded(filepath.Join(dir, "pinned-docs.json"))
	util.BroadcastByType("filetree", "pinnedDocsChanged", 0, "", nil)
	return nil
}

// 置顶只保存普通文档的标识，名称和子文档始终从源文档读取。
func GetPinnedDocs() (ret []PinnedDoc, err error) {
	pinnedDocsLock.Lock()
	defer pinnedDocsLock.Unlock()
	ret = []PinnedDoc{}
	stored, err := readPinnedDocs()
	if err != nil {
		return nil, err
	}
	if len(stored.Docs) == 0 {
		return ret, nil
	}
	notebooks, err := ListNotebooks()
	if err != nil {
		return nil, err
	}
	boxes := map[string]*Box{}
	for _, box := range notebooks {
		boxes[box.ID] = box
	}
	for _, ref := range stored.Docs {
		boxID := ref.Notebook
		bt := treenode.GetBlockTree(ref.ID)
		if bt != nil {
			boxID = bt.BoxID
		}
		box := boxes[boxID]
		if box == nil || IsEncryptedBox(boxID) {
			continue
		}
		doc := PinnedDoc{ID: ref.ID, Notebook: boxID, Name: ref.ID, Unavailable: box.Closed}
		if box.Closed {
			ret = append(ret, doc)
			continue
		}
		if !isPinnableDocument(bt) {
			continue
		}
		info := box.Stat(bt.Path)
		if info == nil {
			continue
		}
		ial := box.docIAL(bt.Path)
		if ial == nil {
			return nil, fmt.Errorf("cannot read pinned document [%s]", ref.ID)
		}
		if ref.ID != boxID && ial[DocHiddenAttr] == "true" {
			continue
		}
		file := box.docFromFileInfo(info, ial)
		if file == nil {
			return nil, fmt.Errorf("cannot read pinned document [%s]", ref.ID)
		}
		doc.Name, doc.Path, doc.Icon = file.Name, file.Path, file.Icon
		doc.ChildrenSortMode = file.ChildrenSortMode
		if file.TitleEmpty {
			doc.Name = Conf.Language(16)
		}
		if ref.ID == boxID {
			doc.SubFileCount = BoxDocSubFileCount(boxID)
		} else {
			doc.SubFileCount, err = visibleDocCount(boxID, strings.TrimSuffix(bt.Path, ".sy"), box.docIAL, nil)
			if err != nil {
				return nil, err
			}
		}
		ret = append(ret, doc)
	}
	return
}

// 根层顺序独立于源文档顺序，按相对位置更新以保留其他窗口新增的入口。
func UpdatePinnedDocs(ids []string, action, targetID string, after bool) error {
	if len(ids) == 0 {
		return fmt.Errorf("document IDs are required")
	}
	if action != "pin" && action != "unpin" {
		return fmt.Errorf("invalid pinned document action")
	}
	pinnedDocsLock.Lock()
	defer pinnedDocsLock.Unlock()
	stored, err := readPinnedDocs()
	if err != nil {
		return err
	}
	selected := map[string]bool{}
	refs := []pinnedDocRef{}
	for _, id := range ids {
		if !ast.IsNodeIDPattern(id) {
			return fmt.Errorf("invalid document ID [%s]", id)
		}
		if selected[id] {
			continue
		}
		selected[id] = true
		if action == "unpin" {
			continue
		}
		bt := treenode.GetBlockTree(id)
		if bt != nil && IsEncryptedBox(bt.BoxID) {
			return fmt.Errorf("%s", Conf.Language(396))
		}
		if !isPinnableDocument(bt) {
			return fmt.Errorf("document [%s] cannot be pinned", id)
		}
		box := Conf.Box(bt.BoxID)
		if box == nil || box.Stat(bt.Path) == nil {
			return fmt.Errorf("document [%s] is unavailable", id)
		}
		ial := box.docIAL(bt.Path)
		if ial == nil {
			return fmt.Errorf("cannot read pinned document [%s]", id)
		}
		if id != bt.BoxID && ial[DocHiddenAttr] == "true" {
			return fmt.Errorf("document [%s] cannot be pinned", id)
		}
		refs = append(refs, pinnedDocRef{ID: id, Notebook: bt.BoxID})
	}
	if action == "pin" && selected[targetID] {
		return nil
	}
	remaining := []pinnedDocRef{}
	for _, ref := range stored.Docs {
		if !selected[ref.ID] {
			remaining = append(remaining, ref)
		}
	}
	index := 0
	if targetID != "" && action == "pin" {
		index = -1
		for i, ref := range remaining {
			if ref.ID == targetID {
				index = i
				break
			}
		}
		if index < 0 {
			return fmt.Errorf("pinned target [%s] is unavailable", targetID)
		}
		if after {
			index++
		}
	}
	result := append([]pinnedDocRef{}, remaining[:index]...)
	result = append(result, refs...)
	result = append(result, remaining[index:]...)
	if slices.Equal(stored.Docs, result) {
		return nil
	}
	stored.Docs = result
	return writePinnedDocs(stored)
}

// 源文档删除或跨笔记本移动后维护入口，异常配置保留原文件并记录错误。
func maintainPinnedDocs(ids map[string]bool, notebook, destination string) {
	pinnedDocsLock.Lock()
	defer pinnedDocsLock.Unlock()
	stored, err := readPinnedDocs()
	if err != nil {
		logging.LogErrorf("read pinned documents failed: %s", err)
		return
	}
	ret := []pinnedDocRef{}
	changed := false
	for _, ref := range stored.Docs {
		if ids[ref.ID] || notebook != "" && ref.Notebook == notebook {
			changed = true
			if destination == "" {
				continue
			}
			ref.Notebook = destination
		}
		ret = append(ret, ref)
	}
	if changed {
		stored.Docs = ret
		if err = writePinnedDocs(stored); err != nil {
			logging.LogErrorf("write pinned documents failed: %s", err)
		}
	}
}
