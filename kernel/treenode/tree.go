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

package treenode

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func NodeHash(node *ast.Node, tree *parse.Tree, luteEngine *lute.Lute) string {
	ialArray := node.KramdownIAL
	sort.Slice(ialArray, func(i, j int) bool {
		return ialArray[i][0] < ialArray[j][0]
	})
	ial := parse.IAL2Tokens(ialArray)
	var md string
	if ast.NodeDocument != node.Type {
		md = FormatNode(node, luteEngine)
	}
	hpath := tree.HPath
	data := tree.Box + tree.Path + hpath + string(ial) + md
	var parentID string
	if nil != node.Parent {
		parentID = node.Parent.ID
	}
	if h := HeadingParent(node); nil != h {
		parentID = h.ID
	}
	data += parentID
	return fmt.Sprintf("%x", sha256.Sum256(gulu.Str.ToBytes(data)))[:7]
}

func TreeRoot(node *ast.Node) *ast.Node {
	for p := node; nil != p; p = p.Parent {
		if ast.NodeDocument == p.Type {
			return p
		}
	}
	return &ast.Node{Type: ast.NodeDocument}
}

func NewTree(boxID, p, hp, title string) *parse.Tree {
	id := util.GetTreeID(p)
	root := &ast.Node{Type: ast.NodeDocument, ID: id, Spec: "1", Box: boxID, Path: p}
	root.SetIALAttr("title", title)
	root.SetIALAttr("id", id)
	root.SetIALAttr("updated", util.TimeFromID(id))
	ret := &parse.Tree{Root: root, ID: id, Box: boxID, Path: p, HPath: hp}
	ret.Root.Spec = CurrentSpec
	newPara := &ast.Node{Type: ast.NodeParagraph, ID: ast.NewNodeID(), Box: boxID, Path: p}
	newPara.SetIALAttr("id", newPara.ID)
	newPara.SetIALAttr("updated", util.TimeFromID(newPara.ID))
	ret.Root.AppendChild(newPara)
	return ret
}

func IALStr(n *ast.Node) string {
	if 1 > len(n.KramdownIAL) {
		return ""
	}
	// 这里不能进行转义，否则会导致从数据库中读取后转换为 IAL 时解析错误
	// 所以 Some symbols should not be escaped to avoid inaccurate searches https://github.com/siyuan-note/siyuan/issues/10185 无法被修复了
	return string(parse.IAL2Tokens(n.KramdownIAL))
}

func RootChildIDs(rootID string) (ret []string) {
	root := GetBlockTree(rootID)
	if nil == root {
		return
	}

	ret = append(ret, rootID)
	boxLocalPath := filepath.Join(util.DataDir, root.BoxID)
	subFolder := filepath.Join(boxLocalPath, strings.TrimSuffix(root.Path, ".sy"))
	if !gulu.File.IsDir(subFolder) {
		return
	}
	filelock.Walk(subFolder, func(path string, d fs.DirEntry, err error) error {
		if strings.HasSuffix(path, ".sy") {
			name := filepath.Base(path)
			id := strings.TrimSuffix(name, ".sy")
			ret = append(ret, id)
		}
		return nil
	})
	return
}

func NewParagraph(id string) (ret *ast.Node) {
	newID := id
	if "" == newID {
		newID = ast.NewNodeID()
	}
	ret = &ast.Node{ID: newID, Type: ast.NodeParagraph}
	ret.SetIALAttr("id", newID)
	ret.SetIALAttr("updated", newID[:14])
	return
}

func NewSpanAnchor(id string) (ret *ast.Node) {
	return &ast.Node{Type: ast.NodeInlineHTML, Tokens: []byte("<span id=\"" + id + "\" style=\"display: none;\"></span>")}
}

func ContainOnlyDefaultIAL(tree *parse.Tree) bool {
	return 5 > len(tree.Root.KramdownIAL)
}

var CurrentSpec = "2"

var ErrSpecTooNew = fmt.Errorf("the document spec is too new")

func CheckSpec(tree *parse.Tree) (err error) {
	if CurrentSpec == tree.Root.Spec || "" == tree.Root.Spec {
		return
	}

	spec, err := strconv.Atoi(tree.Root.Spec)
	if nil != err {
		logging.LogErrorf("parse spec [%s] failed: %s", tree.Root.Spec, err)
		return
	}

	currentSpec, _ := strconv.Atoi(CurrentSpec)
	if spec > currentSpec {
		logging.LogErrorf("tree spec [%s] is newer than current spec [%s]", tree.Root.Spec, CurrentSpec)
		return ErrSpecTooNew
	}
	return
}

func UpgradeSpec(tree *parse.Tree) (upgraded bool) {
	if CurrentSpec == tree.Root.Spec {
		return
	}

	upgradeSpec1(tree)
	upgradeSpec2(tree)
	return true
}

func upgradeSpec2(tree *parse.Tree) {
	oldSpec, err := strconv.Atoi(tree.Root.Spec)
	if nil != err {
		logging.LogErrorf("parse spec [%s] failed: %s", tree.Root.Spec, err)
		return
	}

	if 2 <= oldSpec {
		return
	}

	// 增加了 Callout

	tree.Root.Spec = "2"
}

func upgradeSpec1(tree *parse.Tree) {
	if "" != tree.Root.Spec {
		return
	}

	parse.NestedInlines2FlattedSpans(tree, false)
	tree.Root.Spec = "1"
	return
}
