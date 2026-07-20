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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	boxDocMetaSpec = 1
	boxDocMetaName = "boxDoc.json"
)

type boxDocMeta struct {
	Spec     int    `json:"spec"`
	BoxDocID string `json:"boxDocID"`
}

func boxDocMetaPath(boxID string) string {
	return filepath.Join(util.DataDir, boxID, ".siyuan", boxDocMetaName)
}

func boxDocPath(boxID string) string {
	if "" == boxID {
		return ""
	}
	return "/" + boxID + ".sy"
}

func readBoxDocID(boxID string) (ret string, err error) {
	data, err := filelock.ReadFile(boxDocMetaPath(boxID))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			err = nil
		}
		return
	}

	meta := &boxDocMeta{}
	if err = gulu.JSON.UnmarshalJSON(data, meta); err != nil {
		return "", fmt.Errorf("unmarshal box document metadata failed: %w", err)
	}
	if boxDocMetaSpec != meta.Spec {
		return "", fmt.Errorf("unsupported box document metadata spec [%d]", meta.Spec)
	}
	if !ast.IsNodeIDPattern(meta.BoxDocID) {
		return "", fmt.Errorf("invalid box document ID [%s]", meta.BoxDocID)
	}
	if boxID != meta.BoxDocID {
		return "", fmt.Errorf("box document ID [%s] does not match box ID [%s]", meta.BoxDocID, boxID)
	}
	return boxID, nil
}

func writeBoxDocID(boxID string) error {
	meta := &boxDocMeta{Spec: boxDocMetaSpec, BoxDocID: boxID}
	data, err := gulu.JSON.MarshalIndentJSON(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal box document metadata failed: %w", err)
	}
	return filelock.WriteFile(boxDocMetaPath(boxID), data)
}

func IsBoxDocEnabled() bool {
	return nil != Conf && nil != Conf.FileTree && nil != Conf.FileTree.BoxDocEnabled && *Conf.FileTree.BoxDocEnabled
}

func hiddenBoxDocRootIDs() (ret []string) {
	if IsBoxDocEnabled() || nil == Conf {
		return
	}
	for _, box := range Conf.GetOpenedBoxes() {
		ret = append(ret, box.ID)
	}
	return
}

func isHiddenBoxDocBlock(id, boxID string) bool {
	if IsBoxDocEnabled() {
		return false
	}
	var bt *treenode.BlockTree
	if "" == boxID {
		bt = treenode.GetBlockTree(id)
	} else {
		bt = treenode.GetBlockTreeInBox(id, boxID)
	}
	return nil != bt && IsBoxDoc(bt.BoxID, bt.RootID)
}

func EnsureBoxDoc(boxID string) (boxDocID string, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()
	return ensureBoxDoc0(boxID)
}

// ensureBoxDoc0 的调用方必须持有 createDocLock。
func ensureBoxDoc0(boxID string) (boxDocID string, err error) {
	if !ast.IsNodeIDPattern(boxID) {
		return "", fmt.Errorf("invalid box ID [%s]", boxID)
	}

	box := Conf.GetBox(boxID)
	if nil == box {
		return "", ErrBoxNotFound
	}

	if !IsBoxDocEnabled() {
		return
	}
	boxDocID = boxID

	boxDocID, err = findBoxDoc(box)
	if err != nil {
		return "", err
	}
	created, changed := false, false
	if "" == boxDocID {
		boxDocID = boxID
		if box.Exist(boxDocPath(boxDocID)) || nil != treenode.GetBlockTree(boxDocID) || "" != findUnindexedTreePathInAllBoxes(boxDocID) {
			return "", fmt.Errorf("box document ID [%s] is already in use", boxDocID)
		}
		if err = createBoxDoc(box, boxDocID); err != nil {
			return "", err
		}
		created = true
		changed = true
	} else {
		indexBoxDocIfNeeded(boxID, boxDocID)
		if err = reconcileBoxDoc(box, boxDocID); err != nil {
			return "", err
		}
	}

	storedBoxDocID, _ := readBoxDocID(boxID)
	if storedBoxDocID != boxID {
		if err = writeBoxDocID(boxID); err != nil {
			return "", err
		}
		changed = true
	}
	if changed {
		IncSync()
	}
	if created {
		logging.LogInfof("initialized box document [box=%s, id=%s]", boxID, boxDocID)
	}
	return
}

func RefreshBoxDocFeature() {
	if IsBoxDocEnabled() {
		for _, box := range Conf.GetOpenedBoxes() {
			if _, err := EnsureBoxDoc(box.ID); nil != err {
				logging.LogErrorf("ensure box document [%s] after enabling feature failed: %s", box.ID, err)
			}
		}
	}
	ReloadFiletree()
}

func findBoxDoc(box *Box) (ret string, err error) {
	boxDocID := box.ID
	if !box.Exist(boxDocPath(boxDocID)) {
		return
	}
	tree, err := filesys.LoadTree(box.ID, boxDocPath(boxDocID), util.NewLute())
	if err != nil {
		return "", err
	}
	if tree.ID != boxDocID || tree.Root.IALAttr(DocHiddenAttr) != "true" {
		return "", fmt.Errorf("box document ID [%s] is already in use", boxDocID)
	}
	return boxDocID, nil
}

func createBoxDoc(box *Box, boxDocID string) error {
	boxConf := box.GetConf()
	title := normalizeDocTitle(boxConf.Name)
	if "" == title {
		title = Conf.Language(16)
	}
	p := boxDocPath(boxDocID)
	tree := treenode.NewTree(box.ID, p, "/"+title, html.EscapeAttrVal(title))
	tree.Root.SetIALAttr(DocHiddenAttr, "true")
	if "" != boxConf.Icon {
		tree.Root.SetIALAttr("icon", boxConf.Icon)
	}
	if err := indexWriteTreeIndexQueue(tree); err != nil {
		return err
	}
	cache.PutDocIALInBox(tree.Path, tree.Box, parse.IAL2Map(tree.Root.KramdownIAL))
	return nil
}

func indexBoxDocIfNeeded(boxID, boxDocID string) {
	if nil != treenode.GetBlockTreeInBox(boxDocID, boxID) {
		return
	}
	tree, err := filesys.LoadTree(boxID, boxDocPath(boxDocID), util.NewLute())
	if err != nil {
		logging.LogErrorf("load box document [box=%s, id=%s] failed: %s", boxID, boxDocID, err)
		return
	}
	treenode.IndexBlockTree(tree)
	sql.IndexTreeQueue(tree)
	cache.PutDocIALInBox(tree.Path, tree.Box, parse.IAL2Map(tree.Root.KramdownIAL))
}

func reconcileBoxDoc(box *Box, boxDocID string) error {
	tree, err := filesys.LoadTree(box.ID, boxDocPath(boxDocID), util.NewLute())
	if err != nil {
		return err
	}
	boxConf := box.GetConf()
	title := normalizeDocTitle(boxConf.Name)
	if "" == title {
		title = Conf.Language(16)
	}
	titleChanged := tree.Root.IALAttr("title") != title
	changed := titleChanged || tree.HPath != "/"+title || tree.Root.IALAttr(DocHiddenAttr) != "true" ||
		tree.Root.IALAttr("icon") != boxConf.Icon
	if !changed {
		return nil
	}
	tree.HPath = "/" + title
	tree.Root.SetIALAttr("title", title)
	tree.Root.SetIALAttr(DocHiddenAttr, "true")
	if "" == boxConf.Icon {
		tree.Root.RemoveIALAttr("icon")
	} else {
		tree.Root.SetIALAttr("icon", boxConf.Icon)
	}
	tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		return err
	}
	if titleChanged {
		updateRefTextRenameDoc(tree)
	}
	IncSync()
	return nil
}

// BoxDocSubFileCount 返回笔记本顶层文档的可见下级文档数。
func BoxDocSubFileCount(boxID string) int {
	return boxDocSubFileCount(boxID, nil)
}

// BoxDocSubFileCountForPublish 返回发布访问控制下笔记本顶层文档的可见下级文档数。
func BoxDocSubFileCountForPublish(boxID string, publishAccess PublishAccess) int {
	publishIgnore := GetInvisiblePublishAccess(publishAccess)
	return boxDocSubFileCount(boxID, func(p string) bool {
		return CheckPathAccessableByPublishIgnore(boxID, p, publishIgnore)
	})
}

func boxDocSubFileCount(boxID string, include func(string) bool) int {
	entries, err := os.ReadDir(filepath.Join(util.DataDir, boxID))
	if err != nil {
		return 0
	}
	ret := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sy") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".sy")
		if id == boxID || !ast.IsNodeIDPattern(id) {
			continue
		}
		p := "/" + entry.Name()
		if nil != include && !include(p) {
			continue
		}
		ial := filesys.DocIAL(filepath.Join(util.DataDir, boxID, entry.Name()))
		if "true" == ial[DocHiddenAttr] {
			continue
		}
		ret++
	}
	return ret
}

func IsBoxDoc(boxID, id string) bool {
	box := Conf.Box(boxID)
	return nil != box && box.ID == id
}

func IsBoxDocPath(boxID, p string) bool {
	return IsBoxDoc(boxID, util.GetTreeID(p))
}

// normalizeBoxDocPath 将虚拟根文档下的路径映射到笔记本物理根路径。
func normalizeBoxDocPath(boxID, p string) string {
	box := Conf.Box(boxID)
	if nil == box {
		return p
	}
	prefix := "/" + box.ID + "/"
	if strings.HasPrefix(p, prefix) {
		return "/" + strings.TrimPrefix(p, prefix)
	}
	return p
}

func normalizeBoxDocTarget(boxID, p string) string {
	box := Conf.Box(boxID)
	if nil == box {
		return p
	}
	if boxDocPath(box.ID) == p {
		return "/"
	}
	return normalizeBoxDocPath(boxID, p)
}

func renameBoxDoc(boxID, name string) error {
	box := Conf.Box(boxID)
	if nil == box || !box.Exist(boxDocPath(box.ID)) {
		return nil
	}
	return renameDoc0(boxID, boxDocPath(box.ID), name)
}

func setBoxDocIcon(boxID, icon string) error {
	box := Conf.Box(boxID)
	if nil == box || !box.Exist(boxDocPath(box.ID)) {
		return nil
	}
	tree, err := filesys.LoadTree(boxID, boxDocPath(box.ID), util.NewLute())
	if err != nil {
		return err
	}
	oldAttrs := parse.IAL2Map(tree.Root.KramdownIAL)
	if "" == icon {
		tree.Root.RemoveIALAttr("icon")
	} else {
		tree.Root.SetIALAttr("icon", icon)
	}
	tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		return err
	}
	cache.PutDocIALInBox(tree.Path, tree.Box, parse.IAL2Map(tree.Root.KramdownIAL))
	pushBlockAttrs(oldAttrs, tree.Root)
	return nil
}

func removeBoxDocHiddenAttr(tree *parse.Tree) {
	if nil == tree || nil == tree.Root {
		return
	}
	tree.Root.RemoveIALAttr(DocHiddenAttr)
}
