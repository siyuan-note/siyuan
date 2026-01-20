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
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func PushReloadSnippet(snippet *conf.Snpt) {
	util.BroadcastByType("main", "setSnippet", 0, "", snippet)
}

func PushReloadPlugin(upsertCodePluginSet, upsertDataPluginSet, unloadPluginNameSet, uninstallPluginNameSet *hashset.Set, excludeApp string) {
	// 集合去重
	if nil != uninstallPluginNameSet {
		for _, n := range uninstallPluginNameSet.Values() {
			pluginName := n.(string)
			if nil != upsertCodePluginSet {
				upsertCodePluginSet.Remove(pluginName)
			}
			if nil != upsertDataPluginSet {
				upsertDataPluginSet.Remove(pluginName)
			}
			if nil != unloadPluginNameSet {
				unloadPluginNameSet.Remove(pluginName)
			}
		}
	}
	if nil != unloadPluginNameSet {
		for _, n := range unloadPluginNameSet.Values() {
			pluginName := n.(string)
			if nil != upsertCodePluginSet {
				upsertCodePluginSet.Remove(pluginName)
			}
			if nil != upsertDataPluginSet {
				upsertDataPluginSet.Remove(pluginName)
			}
		}
	}
	if nil != upsertCodePluginSet {
		for _, n := range upsertCodePluginSet.Values() {
			pluginName := n.(string)
			if nil != upsertDataPluginSet {
				upsertDataPluginSet.Remove(pluginName)
			}
		}
	}

	upsertCodePlugins, upsertDataPlugins, unloadPlugins, uninstallPlugins := []string{}, []string{}, []string{}, []string{}
	if nil != upsertCodePluginSet {
		for _, n := range upsertCodePluginSet.Values() {
			upsertCodePlugins = append(upsertCodePlugins, n.(string))
		}
	}
	if nil != upsertDataPluginSet {
		for _, n := range upsertDataPluginSet.Values() {
			upsertDataPlugins = append(upsertDataPlugins, n.(string))
		}
	}
	if nil != unloadPluginNameSet {
		for _, n := range unloadPluginNameSet.Values() {
			unloadPlugins = append(unloadPlugins, n.(string))
		}
	}
	if nil != uninstallPluginNameSet {
		for _, n := range uninstallPluginNameSet.Values() {
			uninstallPlugins = append(uninstallPlugins, n.(string))
		}
	}

	pushReloadPlugin0(upsertCodePlugins, upsertDataPlugins, unloadPlugins, uninstallPlugins, excludeApp)
}

func pushReloadPlugin0(upsertCodePlugins, upsertDataPlugins, unloadPlugins, uninstallPlugins []string, excludeApp string) {
	logging.LogInfof("reload plugins [codeChanges=%v, dataChanges=%v, unloads=%v, uninstalls=%v]", upsertCodePlugins, upsertDataPlugins, unloadPlugins, uninstallPlugins)
	if "" == excludeApp {
		util.BroadcastByType("main", "reloadPlugin", 0, "", map[string]interface{}{
			"upsertCodePlugins": upsertCodePlugins,
			"upsertDataPlugins": upsertDataPlugins,
			"unloadPlugins":     unloadPlugins,
			"uninstallPlugins":  uninstallPlugins,
		})
		return
	}

	util.BroadcastByTypeAndExcludeApp(excludeApp, "main", "reloadPlugin", 0, "", map[string]interface{}{
		"upsertCodePlugins": upsertCodePlugins,
		"upsertDataPlugins": upsertDataPlugins,
		"unloadPlugins":     unloadPlugins,
		"uninstallPlugins":  uninstallPlugins,
	})
}

func refreshDocInfo(tree *parse.Tree) {
	if nil == tree {
		return
	}

	refreshDocInfoWithSize(tree, filesys.TreeSize(tree))
}

func refreshDocInfoWithSize(tree *parse.Tree, size uint64) {
	if nil == tree {
		return
	}

	refreshDocInfo0(tree, size)
	go func() {
		time.Sleep(128 * time.Millisecond)
		refreshParentDocInfo(tree)
	}()
}

func refreshParentDocInfo(tree *parse.Tree) {
	parentTree := loadParentTree(tree)
	if nil == parentTree {
		return
	}

	luteEngine := lute.New()
	renderer := render.NewJSONRenderer(parentTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	data := renderer.Render()
	refreshDocInfo0(parentTree, uint64(len(data)))
}

func refreshDocInfo0(tree *parse.Tree, size uint64) {
	cTime, _ := time.ParseInLocation("20060102150405", tree.ID[:14], time.Local)
	mTime := cTime
	if updated := tree.Root.IALAttr("updated"); "" != updated {
		if updatedTime, err := time.ParseInLocation("20060102150405", updated, time.Local); err == nil {
			mTime = updatedTime
		}
	}

	subFileCount := 0
	subFiles, err := os.ReadDir(filepath.Join(util.DataDir, tree.Box, strings.TrimSuffix(tree.Path, ".sy")))
	if err == nil {
		for _, subFile := range subFiles {
			if "true" == tree.Root.IALAttr("custom-hidden") {
				continue
			}

			if strings.HasSuffix(subFile.Name(), ".sy") {
				subFileCount++
			}
		}
	}

	docInfo := map[string]interface{}{
		"rootID":       tree.ID,
		"name":         tree.Root.IALAttr("title"),
		"alias":        tree.Root.IALAttr("alias"),
		"name1":        tree.Root.IALAttr("name"),
		"memo":         tree.Root.IALAttr("memo"),
		"bookmark":     tree.Root.IALAttr("bookmark"),
		"size":         size,
		"hSize":        humanize.BytesCustomCeil(size, 2),
		"mtime":        mTime.Unix(),
		"ctime":        cTime.Unix(),
		"hMtime":       mTime.Format("2006-01-02 15:04:05") + ", " + util.HumanizeTime(mTime, Conf.Lang),
		"hCtime":       cTime.Format("2006-01-02 15:04:05") + ", " + util.HumanizeTime(cTime, Conf.Lang),
		"subFileCount": subFileCount,
	}

	task.AppendAsyncTaskWithDelay(task.ReloadProtyle, 500*time.Millisecond, util.PushReloadDocInfo, docInfo)
}

func ReloadFiletree() {
	task.AppendAsyncTaskWithDelay(task.ReloadFiletree, 200*time.Millisecond, util.PushReloadFiletree)
}

func ReloadTag() {
	task.AppendAsyncTaskWithDelay(task.ReloadTag, 200*time.Millisecond, util.PushReloadTag)
}

func ReloadProtyle(rootID string) {
	// 刷新关联的引用
	defTree, _ := LoadTreeByBlockID(rootID)
	if nil != defTree {
		defIDs := sql.QueryChildDefIDsByRootDefID(rootID)

		var defNodes []*ast.Node
		ast.Walk(defTree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			if gulu.Str.Contains(n.ID, defIDs) {
				defNodes = append(defNodes, n)
			}
			return ast.WalkContinue
		})

		for _, def := range defNodes {
			refreshDynamicRefText(def, defTree)
		}
	}

	// 刷新关联的嵌入块
	refIDs := sql.QueryRefIDsByDefID(rootID, true)
	var rootIDs []string
	bts := treenode.GetBlockTrees(refIDs)
	for _, bt := range bts {
		rootIDs = append(rootIDs, bt.RootID)
	}
	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)
	for _, id := range rootIDs {
		task.AppendAsyncTaskWithDelay(task.ReloadProtyle, 200*time.Millisecond, util.PushReloadProtyle, id)
	}

	task.AppendAsyncTaskWithDelay(task.ReloadProtyle, 200*time.Millisecond, util.PushReloadProtyle, rootID)
}

// refreshRefCount 用于刷新定义块处的引用计数。
func refreshRefCount(blockID string) {
	sql.FlushQueue()

	bt := treenode.GetBlockTree(blockID)
	if nil == bt {
		return
	}

	isDoc := bt.ID == bt.RootID
	var rootRefIDs []string
	var refCount, rootRefCount int
	refIDs := sql.QueryRefIDsByDefID(bt.ID, isDoc)
	if isDoc {
		rootRefIDs = refIDs
	} else {
		rootRefIDs = sql.QueryRefIDsByDefID(bt.RootID, true)
	}
	refCount = len(refIDs)
	rootRefCount = len(rootRefIDs)
	var defIDs []string
	if isDoc {
		defIDs = sql.QueryChildDefIDsByRootDefID(bt.ID)
	} else {
		defIDs = append(defIDs, bt.ID)
	}

	util.PushSetDefRefCount(bt.RootID, blockID, defIDs, refCount, rootRefCount)
}

// refreshDynamicRefText 用于刷新块引用的动态锚文本。
// 该实现依赖了数据库缓存，导致外部调用时可能需要阻塞等待数据库写入后才能获取到 refs
func refreshDynamicRefText(updatedDefNode *ast.Node, updatedTree *parse.Tree) {
	changedDefs := map[string]*ast.Node{updatedDefNode.ID: updatedDefNode}
	changedTrees := map[string]*parse.Tree{updatedTree.ID: updatedTree}
	refreshDynamicRefTexts(changedDefs, changedTrees)
}

// refreshDynamicRefTexts 用于批量刷新块引用的动态锚文本。
// 该实现依赖了数据库缓存，导致外部调用时可能需要阻塞等待数据库写入后才能获取到 refs
func refreshDynamicRefTexts(updatedDefNodes map[string]*ast.Node, updatedTrees map[string]*parse.Tree) (changedRootIDs []string) {
	for t := range updatedTrees {
		changedRootIDs = append(changedRootIDs, t)
	}

	for i := 0; i < 7; i++ {
		updatedRefNodes, updatedRefTrees := refreshDynamicRefTexts0(updatedDefNodes, updatedTrees)
		if 1 > len(updatedRefNodes) {
			break
		}
		updatedDefNodes, updatedTrees = updatedRefNodes, updatedRefTrees

		for t := range updatedTrees {
			changedRootIDs = append(changedRootIDs, t)
		}
	}

	changedRootIDs = gulu.Str.RemoveDuplicatedElem(changedRootIDs)
	return
}

func refreshDynamicRefTexts0(updatedDefNodes map[string]*ast.Node, updatedTrees map[string]*parse.Tree) (updatedRefNodes map[string]*ast.Node, updatedRefTrees map[string]*parse.Tree) {
	updatedRefNodes = map[string]*ast.Node{}
	updatedRefTrees = map[string]*parse.Tree{}

	// 1. 更新引用的动态锚文本
	treeRefNodeIDs := map[string]*hashset.Set{}
	var changedNodes []*ast.Node
	var refs []*sql.Ref
	for _, updateNode := range updatedDefNodes {
		refs, changedNodes = getRefsCacheByDefNode(updateNode)
		for _, ref := range refs {
			if refIDs, ok := treeRefNodeIDs[ref.RootID]; !ok {
				refIDs = hashset.New()
				refIDs.Add(ref.BlockID)
				treeRefNodeIDs[ref.RootID] = refIDs
			} else {
				refIDs.Add(ref.BlockID)
			}
		}
	}
	for _, n := range changedNodes {
		updatedDefNodes[n.ID] = n
	}

	changedRefTree := map[string]*parse.Tree{}

	for refTreeID, refNodeIDs := range treeRefNodeIDs {
		refTree, ok := updatedTrees[refTreeID]
		if !ok {
			var err error
			refTree, err = LoadTreeByBlockID(refTreeID)
			if err != nil {
				continue
			}
		}

		var refTreeChanged bool
		ast.Walk(refTree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if n.IsBlock() && refNodeIDs.Contains(n.ID) {
				changed, changedDefNodes := updateRefText(n, updatedDefNodes)
				if !refTreeChanged && changed {
					refTreeChanged = true
					updatedRefNodes[n.ID] = n
					updatedRefTrees[refTreeID] = refTree
				}

				// 推送动态锚文本节点刷新
				for _, defNode := range changedDefNodes {
					switch defNode.refType {
					case "ref-d":
						task.AppendAsyncTaskWithDelay(task.SetRefDynamicText, 200*time.Millisecond, util.PushSetRefDynamicText, refTreeID, n.ID, defNode.id, defNode.refText)
					}
				}
				return ast.WalkContinue
			}
			return ast.WalkContinue
		})

		if refTreeChanged {
			changedRefTree[refTreeID] = refTree
			sql.UpdateRefsTreeQueue(refTree)
		}
	}

	// 2. 更新属性视图主键内容
	updateAttributeViewBlockText(updatedDefNodes)

	// 3. 保存变更
	for _, tree := range changedRefTree {
		indexWriteTreeUpsertQueue(tree)
	}
	return
}

func updateAttributeViewBlockText(updatedDefNodes map[string]*ast.Node) {
	var parents []*ast.Node
	for _, updatedDefNode := range updatedDefNodes {
		for parent := updatedDefNode.Parent; nil != parent && ast.NodeDocument != parent.Type; parent = parent.Parent {
			parents = append(parents, parent)
		}
	}
	for _, parent := range parents {
		updatedDefNodes[parent.ID] = parent
	}

	for _, updatedDefNode := range updatedDefNodes {
		avs := updatedDefNode.IALAttr(av.NodeAttrNameAvs)
		if "" == avs {
			continue
		}

		avIDs := strings.Split(avs, ",")
		for _, avID := range avIDs {
			attrView, parseErr := av.ParseAttributeView(avID)
			if nil != parseErr {
				continue
			}

			changedAv := false
			blockValues := attrView.GetBlockKeyValues()
			if nil == blockValues {
				continue
			}

			for _, blockValue := range blockValues.Values {
				if blockValue.Block.ID == updatedDefNode.ID {
					newIcon, newContent := getNodeAvBlockText(updatedDefNode, avID)
					if newIcon != blockValue.Block.Icon {
						blockValue.Block.Icon = newIcon
						changedAv = true
					}
					if newContent != blockValue.Block.Content {
						blockValue.Block.Content = util.UnescapeHTML(newContent)
						changedAv = true
					}
					break
				}
			}
			if changedAv {
				av.SaveAttributeView(attrView)
				ReloadAttrView(avID)

				refreshRelatedSrcAvs(avID, nil)
			}
		}
	}
}

// ReloadAttrView 用于重新加载属性视图。
func ReloadAttrView(avID string) {
	task.AppendAsyncTaskWithDelay(task.ReloadAttributeView, 200*time.Millisecond, pushReloadAttrView, avID)
}

func pushReloadAttrView(avID string) {
	util.BroadcastByType("protyle", "refreshAttributeView", 0, "", map[string]interface{}{"id": avID})
}
