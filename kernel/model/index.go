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

	"github.com/88250/lute/parse"
	"github.com/dustin/go-humanize"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
			logging.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, p, err)
			continue
		}

		docIAL := parse.IAL2MapUnEsc(tree.Root.KramdownIAL)
		if "" == docIAL["updated"] {
			updated := util.TimeFromID(tree.Root.ID)
			tree.Root.SetIALAttr("updated", updated)
			docIAL["updated"] = updated
			writeJSONQueue(tree)
		}

		cache.PutDocIAL(p, docIAL)

		util.IncBootProgress(bootProgressPart, fmt.Sprintf(Conf.Language(92), util.ShortPathForBootingDisplay(tree.Path)))
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
		//logging.LogInfof("use existing database for box [%s]", box.ID)
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
		sql.DeleteByBoxTx(tx, box.ID)
		if err = sql.CommitTx(tx); nil != err {
			return
		}
	}

	bootProgressPart = 20.0 / float64(boxLen) / float64(treeCount)

	context := map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress}
	i = 0
	// 块级行级入库，缓存块
	// 这里不能并行插入，因为 SQLite 不支持
	for _, file := range files {
		if file.isdir || !strings.HasSuffix(file.name, ".sy") {
			continue
		}

		tree, err := filesys.LoadTree(box.ID, file.path, luteEngine)
		if nil != err {
			logging.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, file.path, err)
			continue
		}

		util.IncBootProgress(bootProgressPart, fmt.Sprintf(Conf.Language(93), util.ShortPathForBootingDisplay(tree.Path)))
		tx, err := sql.BeginTx()
		if nil != err {
			continue
		}
		if err = sql.InsertBlocksSpans(tx, tree, context); nil != err {
			sql.RollbackTx(tx)
			continue
		}
		if err = sql.CommitTx(tx); nil != err {
			continue
		}
		if 1 < i && 0 == i%64 {
			util.PushEndlessProgress(fmt.Sprintf("["+box.Name+"] "+Conf.Language(53), i, treeCount-i))
		}
		i++
	}

	end := time.Now()
	elapsed := end.Sub(start).Seconds()
	logging.LogInfof("rebuilt database for notebook [%s] in [%.2fs], tree [count=%d, size=%s]", box.ID, elapsed, treeCount, humanize.Bytes(uint64(treeSize)))

	util.PushEndlessProgress(fmt.Sprintf(Conf.Language(56), treeCount))
	return
}

func IndexRefs() {
	sql.EnableCache()
	defer sql.ClearBlockCache()

	start := time.Now()
	util.SetBootDetails("Resolving refs...")
	util.PushEndlessProgress(Conf.Language(54))

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
					logging.LogErrorf("parse box [%s] tree [%s] failed", box.ID, file.path)
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
				}
				i++
			}
		}
	}
	logging.LogInfof("resolved refs [%d] in [%dms]", len(refBlocks), time.Now().Sub(start).Milliseconds())
}

func init() {
	eventbus.Subscribe(eventbus.EvtSQLInsertBlocks, func(context map[string]interface{}, blockCount int, hash string) {
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
			// Android/iOS 端不显示数据索引和搜索索引状态提示 https://github.com/siyuan-note/siyuan/issues/6392
			return
		}

		msg := fmt.Sprintf(Conf.Language(89), blockCount, hash)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtSQLInsertBlocksFTS, func(context map[string]interface{}, blockCount int, hash string) {
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
			// Android/iOS 端不显示数据索引和搜索索引状态提示 https://github.com/siyuan-note/siyuan/issues/6392
			return
		}

		msg := fmt.Sprintf(Conf.Language(90), blockCount, hash)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
}
