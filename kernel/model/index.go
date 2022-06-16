// SiYuan - Build Your Eternal Digital Garden
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
	"crypto/sha256"
	"fmt"
	"runtime/debug"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/dustin/go-humanize"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func (box *Box) BootIndex() {
	util.SetBootDetails("Listing files...")
	files := box.ListFiles("/")
	boxLen := len(Conf.GetOpenedBoxes())
	if 1 > boxLen {
		boxLen = 1
	}
	bootProgressPart := 10.0 / float64(boxLen) / float64(len(files))

	luteEngine := NewLute()
	i := 0
	// 读取并缓存路径映射
	for _, file := range files {
		if file.isdir || !strings.HasSuffix(file.name, ".sy") {
			continue
		}

		p := file.path
		tree, err := filesys.LoadTree(box.ID, p, luteEngine)
		if nil != err {
			util.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, p, err)
			continue
		}

		docIAL := parse.IAL2MapUnEsc(tree.Root.KramdownIAL)
		cache.PutDocIAL(p, docIAL)

		util.IncBootProgress(bootProgressPart, "Parsing tree "+util.ShortPathForBootingDisplay(tree.Path))
		// 缓存块树
		treenode.IndexBlockTree(tree)
		if 1 < i && 0 == i%64 {
			filelock.ReleaseAllFileLocks()
		}
		i++
	}
	return
}

func (box *Box) Index(fullRebuildIndex bool) (treeCount int, treeSize int64) {
	defer debug.FreeOSMemory()

	sql.IndexMode()
	defer sql.NormalMode()

	//os.MkdirAll("pprof", 0755)
	//cpuProfile, _ := os.Create("pprof/cpu_profile_index")
	//pprof.StartCPUProfile(cpuProfile)
	//defer pprof.StopCPUProfile()

	util.SetBootDetails("Listing files...")
	files := box.ListFiles("/")
	boxLen := len(Conf.GetOpenedBoxes())
	if 1 > boxLen {
		boxLen = 1
	}
	bootProgressPart := 10.0 / float64(boxLen) / float64(len(files))

	luteEngine := NewLute()
	idTitleMap := map[string]string{}
	idHashMap := map[string]string{}

	util.PushEndlessProgress(fmt.Sprintf("["+box.Name+"] "+Conf.Language(64), len(files)))

	i := 0
	// 读取并缓存路径映射
	for _, file := range files {
		if file.isdir || !strings.HasSuffix(file.name, ".sy") {
			continue
		}

		p := file.path

		tree, err := filesys.LoadTree(box.ID, p, luteEngine)
		if nil != err {
			util.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, p, err)
			continue
		}

		docIAL := parse.IAL2MapUnEsc(tree.Root.KramdownIAL)
		cache.PutDocIAL(p, docIAL)

		util.IncBootProgress(bootProgressPart, "Parsing tree "+util.ShortPathForBootingDisplay(tree.Path))
		treeSize += file.size
		treeCount++
		// 缓存文档标题，后面做 Path -> HPath 路径映射时需要
		idTitleMap[tree.ID] = tree.Root.IALAttr("title")
		// 缓存块树
		treenode.IndexBlockTree(tree)
		// 缓存 ID-Hash，后面需要用于判断是否要重建库
		idHashMap[tree.ID] = tree.Hash
		if 1 < i && 0 == i%64 {
			util.PushEndlessProgress(fmt.Sprintf(Conf.Language(88), i, len(files)-i))
			filelock.ReleaseAllFileLocks()
		}
		i++
	}

	box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间

	// 检查是否需要重新建库
	util.SetBootDetails("Checking data hashes...")
	var ids []string
	for id := range idTitleMap {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] >= ids[j] })
	buf := bytes.Buffer{}
	for _, id := range ids {
		hash, _ := idHashMap[id]
		buf.WriteString(hash)
		util.SetBootDetails("Checking hash " + hash)
	}
	boxHash := fmt.Sprintf("%x", sha256.Sum256(buf.Bytes()))

	dbBoxHash := sql.GetBoxHash(box.ID)
	if boxHash == dbBoxHash {
		//util.LogInfof("use existing database for box [%s]", box.ID)
		util.SetBootDetails("Use existing database for notebook " + box.ID)
		return
	}

	// 开始重建库

	sql.DisableCache()
	defer sql.EnableCache()

	start := time.Now()
	if !fullRebuildIndex {
		tx, err := sql.BeginTx()
		if nil != err {
			return
		}
		sql.PutBoxHash(tx, box.ID, boxHash)
		util.SetBootDetails("Cleaning obsolete indexes...")
		util.PushEndlessProgress(Conf.Language(108))
		if err = sql.DeleteByBoxTx(tx, box.ID); nil != err {
			return
		}
		if err = sql.CommitTx(tx); nil != err {
			return
		}
	}

	bootProgressPart = 40.0 / float64(boxLen) / float64(treeCount)

	i = 0
	// 块级行级入库，缓存块
	// 这里不能并行插入，因为 SQLite 不支持
	for _, file := range files {
		if file.isdir || !strings.HasSuffix(file.name, ".sy") {
			continue
		}

		tree, err := filesys.LoadTree(box.ID, file.path, luteEngine)
		if nil != err {
			util.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, file.path, err)
			continue
		}

		util.IncBootProgress(bootProgressPart, "Indexing tree "+util.ShortPathForBootingDisplay(tree.Path))
		tx, err := sql.BeginTx()
		if nil != err {
			continue
		}
		if err = sql.InsertBlocksSpans(tx, tree); nil != err {
			continue
		}
		if err = sql.CommitTx(tx); nil != err {
			continue
		}
		if 1 < i && 0 == i%64 {
			util.PushEndlessProgress(fmt.Sprintf("["+box.Name+"] "+Conf.Language(53), i, treeCount-i))
			filelock.ReleaseAllFileLocks()
		}
		i++
	}

	end := time.Now()
	elapsed := end.Sub(start).Seconds()
	util.LogInfof("rebuilt database for notebook [%s] in [%.2fs], tree [count=%d, size=%s]", box.ID, elapsed, treeCount, humanize.Bytes(uint64(treeSize)))

	util.PushEndlessProgress(fmt.Sprintf(Conf.Language(56), treeCount))
	return
}

func IndexRefs() {
	sql.EnableCache()
	defer sql.ClearBlockCache()

	start := time.Now()
	util.SetBootDetails("Resolving refs...")
	util.PushEndlessProgress(Conf.Language(54))

	// 解析并更新引用块
	util.SetBootDetails("Resolving ref block content...")
	refUnresolvedBlocks := sql.GetRefUnresolvedBlocks() // TODO: v2.2.0 以后移除
	if 0 < len(refUnresolvedBlocks) {
		dynamicRefTreeIDs := hashset.New()
		bootProgressPart := 10.0 / float64(len(refUnresolvedBlocks))
		anchors := map[string]string{}
		var refBlockIDs []string
		for i, refBlock := range refUnresolvedBlocks {
			util.IncBootProgress(bootProgressPart, "Resolving ref block content "+util.ShortPathForBootingDisplay(refBlock.ID))
			tx, err := sql.BeginTx()
			if nil != err {
				return
			}
			blockContent := sql.ResolveRefContent(refBlock, &anchors)
			refBlock.Content = blockContent
			refBlockIDs = append(refBlockIDs, refBlock.ID)
			dynamicRefTreeIDs.Add(refBlock.RootID)
			sql.CommitTx(tx)
			if 1 < i && 0 == i%64 {
				util.PushEndlessProgress(fmt.Sprintf(Conf.Language(53), i, len(refUnresolvedBlocks)-i))
			}
		}

		// 将需要更新动态引用文本内容的块先删除，后面会重新插入，这样比直接 update 快很多
		util.SetBootDetails("Deleting unresolved block content...")
		tx, err := sql.BeginTx()
		if nil != err {
			return
		}
		sql.DeleteBlockByIDs(tx, refBlockIDs)
		sql.CommitTx(tx)

		bootProgressPart = 10.0 / float64(len(refUnresolvedBlocks))
		for i, refBlock := range refUnresolvedBlocks {
			util.IncBootProgress(bootProgressPart, "Updating block content "+util.ShortPathForBootingDisplay(refBlock.ID))
			tx, err = sql.BeginTx()
			if nil != err {
				return
			}
			sql.InsertBlock(tx, refBlock)
			sql.CommitTx(tx)
			if 1 < i && 0 == i%64 {
				util.PushEndlessProgress(fmt.Sprintf(Conf.Language(53), i, len(refUnresolvedBlocks)-i))
			}
		}

		if 0 < dynamicRefTreeIDs.Size() {
			// 块引锚文本静态化
			for _, dynamicRefTreeIDVal := range dynamicRefTreeIDs.Values() {
				dynamicRefTreeID := dynamicRefTreeIDVal.(string)
				util.IncBootProgress(bootProgressPart, "Persisting block ref text "+util.ShortPathForBootingDisplay(dynamicRefTreeID))
				tree, err := loadTreeByBlockID(dynamicRefTreeID)
				if nil != err {
					util.LogErrorf("tree [%s] dynamic ref text to static failed: %s", dynamicRefTreeID, err)
					continue
				}
				legacyDynamicRefTreeToStatic(tree)
				if err := filesys.WriteTree(tree); nil == err {
					//util.LogInfof("persisted tree [%s] dynamic ref text", tree.Box+tree.Path)
				}
			}
		}
	}

	// 引用入库
	util.SetBootDetails("Indexing refs...")
	refBlocks := sql.GetRefExistedBlocks()
	refTreeIDs := hashset.New()
	for _, refBlock := range refBlocks {
		refTreeIDs.Add(refBlock.RootID)
	}
	if 0 < refTreeIDs.Size() {
		luteEngine := NewLute()
		bootProgressPart := 10.0 / float64(refTreeIDs.Size())
		for _, box := range Conf.GetOpenedBoxes() {
			tx, err := sql.BeginTx()
			if nil != err {
				return
			}
			sql.DeleteRefsByBoxTx(tx, box.ID)
			sql.CommitTx(tx)

			files := box.ListFiles("/")
			i := 0
			for _, file := range files {
				if file.isdir || !strings.HasSuffix(file.name, ".sy") {
					continue
				}

				if file.isdir || !strings.HasSuffix(file.name, ".sy") {
					continue
				}

				id := strings.TrimSuffix(file.name, ".sy")
				if !refTreeIDs.Contains(id) {
					continue
				}

				util.IncBootProgress(bootProgressPart, "Indexing ref "+util.ShortPathForBootingDisplay(file.path))

				tree, err := filesys.LoadTree(box.ID, file.path, luteEngine)
				if nil != err {
					util.LogErrorf("parse box [%s] tree [%s] failed", box.ID, file.path)
					continue
				}

				tx, err = sql.BeginTx()
				if nil != err {
					continue
				}
				sql.InsertRefs(tx, tree)
				if err = sql.CommitTx(tx); nil != err {
					continue
				}
				if 1 < i && 0 == i%64 {
					util.PushEndlessProgress(fmt.Sprintf(Conf.Language(55), i))
					filelock.ReleaseAllFileLocks()
				}
				i++
			}
		}
	}
	util.LogInfof("resolved refs [%d] in [%dms]", len(refBlocks), time.Now().Sub(start).Milliseconds())
}

func legacyDynamicRefTreeToStatic(tree *parse.Tree) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeBlockRef != n.Type {
			return ast.WalkContinue
		}
		if isLegacyDynamicBlockRef(n) {
			idNode := n.ChildByType(ast.NodeBlockRefID)
			defID := idNode.TokensStr()
			def := sql.GetBlock(defID)
			var text string
			if nil == def {
				if "zh_CN" == Conf.Lang {
					text = "解析引用锚文本失败，请尝试更新该引用指向的定义块后再重新打开该文档"
				} else {
					text = "Failed to parse the ref anchor text, please try to update the def block pointed to by the ref and then reopen this document"
				}
			} else {
				text = sql.GetRefText(defID)
			}
			if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(text) {
				text = gulu.Str.SubStr(text, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
			}
			treenode.SetDynamicBlockRefText(n, text)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
}

func isLegacyDynamicBlockRef(blockRef *ast.Node) bool {
	return nil == blockRef.ChildByType(ast.NodeBlockRefText) && nil == blockRef.ChildByType(ast.NodeBlockRefDynamicText)
}
