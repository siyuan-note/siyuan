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
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	mathRand "math/rand"
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/encryption"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/studio-b12/gowebdav"
)

// AutoPurgeRepoJob 自动清理数据仓库 https://github.com/siyuan-note/siyuan/issues/13091
func AutoPurgeRepoJob() {
	task.AppendTaskWithTimeout(task.RepoAutoPurge, 12*time.Hour, autoPurgeRepo, true)
}

var (
	autoPurgeRepoAfterFirstSync = false
	lastAutoPurgeRepo           = time.Time{}

	purgeCancelMu sync.Mutex
	purgeCancel   context.CancelFunc
)

func autoPurgeRepo(cron bool) {
	if cron && !autoPurgeRepoAfterFirstSync {
		return
	}
	if time.Since(lastAutoPurgeRepo) < 6*time.Hour {
		return
	}

	autoPurgeRepoAfterFirstSync = true
	defer func() {
		lastAutoPurgeRepo = time.Now()
	}()

	if 1 > len(Conf.Repo.Key) {
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	now := time.Now()

	dateGroupedIndexes := map[string][]*entity.Index{} // 按照日期分组
	// 收集指定日期内需要保留的索引
	var date string
	page := 1
	for {
		indexes, pageCount, _, err := repo.GetIndexes(page, 512)
		if nil != err {
			logging.LogErrorf("get data repo index logs failed: %s", err)
			return
		}
		if 1 > len(indexes) {
			break
		}

		tooOld := false
		for _, index := range indexes {
			if now.UnixMilli()-index.Created <= int64(Conf.Repo.IndexRetentionDays)*24*60*60*1000 {
				date = time.UnixMilli(index.Created).Format("2006-01-02")
				if _, ok := dateGroupedIndexes[date]; !ok {
					dateGroupedIndexes[date] = []*entity.Index{}
				}
				dateGroupedIndexes[date] = append(dateGroupedIndexes[date], index)
			} else {
				tooOld = true
				break
			}
		}
		if tooOld {
			break
		}
		page++
		if page > pageCount {
			break
		}
	}

	todayDate := now.Format("2006-01-02")
	// 过滤出每日需要保留的索引
	var retentionIndexIDs []string
	for date, indexes := range dateGroupedIndexes {
		if len(indexes) <= Conf.Repo.RetentionIndexesDaily || todayDate == date {
			for _, index := range indexes {
				retentionIndexIDs = append(retentionIndexIDs, index.ID)
			}
			continue
		}

		keepIndexes := hashset.New()
		keepIndexes.Add(indexes[0]) // 每天最后一个固定保留
		// 随机保留指定数量的索引
		for i := 0; i < Conf.Repo.RetentionIndexesDaily*7; i++ {
			keepIndexes.Add(indexes[mathRand.Intn(len(indexes)-1)])
			if keepIndexes.Size() >= Conf.Repo.RetentionIndexesDaily {
				break
			}
		}

		for _, keepIndex := range keepIndexes.Values() {
			retentionIndexIDs = append(retentionIndexIDs, keepIndex.(*entity.Index).ID)
		}
	}

	retentionIndexIDs = gulu.Str.RemoveDuplicatedElem(retentionIndexIDs)
	if 3 > len(retentionIndexIDs) {
		logging.LogInfof("no index to purge [ellapsed=%.2fs]", time.Since(now).Seconds())
		return
	}

	purgeCancelMu.Lock()
	var ctx context.Context
	ctx, purgeCancel = context.WithCancel(context.Background())
	cancelCtx := ctx
	purgeCancelMu.Unlock()
	defer func() {
		purgeCancelMu.Lock()
		if nil != purgeCancel {
			purgeCancel()
			purgeCancel = nil
		}
		purgeCancelMu.Unlock()
	}()

	_, err = repo.Purge(cancelCtx, retentionIndexIDs...)
}

func cancelPurge() {
	purgeCancelMu.Lock()
	defer purgeCancelMu.Unlock()
	if nil != purgeCancel {
		purgeCancel()
		purgeCancel = nil
	}
}

func GetRepoFile(fileID string) (ret []byte, p string, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	file, err := repo.GetFile(fileID)
	if err != nil {
		return
	}

	ret, err = repo.OpenFile(file)
	p = file.Path
	return
}

func RollbackRepoSnapshotFile(fileID string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	file, err := repo.GetFile(fileID)
	if err != nil {
		return
	}

	data, err := repo.OpenFile(file)
	if err != nil {
		return
	}

	dir, f := filepath.Split(file.Path)
	tempRepoDiffDir := filepath.Join(util.TempDir, "repo", "rollback", dir)
	if err = os.MkdirAll(tempRepoDiffDir, 0755); nil != err {
		logging.LogErrorf("mkdir [%s] failed: %v", tempRepoDiffDir, err)
		return
	}

	// 回滚快照时默认为当前数据创建一个快照
	// When rolling back a snapshot, a snapshot is created for the current data by default https://github.com/siyuan-note/siyuan/issues/12470
	FlushTxQueue()
	_, err = repo.Index("Backup before checkout", false, map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	if err != nil {
		logging.LogErrorf("index repository failed: %s", err)
		util.PushClearProgress()
		util.PushErrMsg(fmt.Sprintf(Conf.Language(140), err), 0)
		return
	}
	util.PushClearProgress()

	from := filepath.Join(tempRepoDiffDir, f)
	// 加密笔记本的快照数据是密文，写入临时文件前先解密
	if strings.HasSuffix(file.Path, ".sy") {
		boxID := strings.TrimPrefix(file.Path, "/")
		boxID = strings.Split(boxID, "/")[0]
		if IsEncryptedBox(boxID) {
			data = decryptRepoDataIfNeeded(data, file.Path)
		}
	}
	if err = os.WriteFile(from, data, 0644); nil != err {
		logging.LogErrorf("write file [%s] failed: %v", filepath.Join(tempRepoDiffDir, file.Path), err)
		return
	}
	// 解密后的临时文件在函数返回时清理，避免加密文档明文残留在磁盘
	defer os.Remove(from)

	if strings.HasSuffix(file.Path, ".sy") {
		boxID := strings.TrimPrefix(file.Path, "/")
		boxID = strings.Split(boxID, "/")[0]
		origBoxID := boxID // 保留原始 boxID 用于加密边界校验

		// 加密笔记本的快照回滚要求原笔记本已挂载：
		// WriteTree 根据 tree.Box 判断是否加密落盘。若原笔记本未挂载导致
		// getRollbackBox fallback 到普通 Rollback 笔记本，解密后的 .sy 将被 WriteTree
		// 以明文落盘，违反加密笔记本"数据不跨边界"的约束。
		if IsEncryptedBox(origBoxID) && nil == Conf.Box(origBoxID) {
			logging.LogErrorf("rollback encrypted repo snapshot requires notebook [%s] to be mounted", origBoxID)
			err = errors.New(Conf.Language(314))
			return
		}

		var box *Box
		var needResetTree bool
		box, needResetTree, err = getRollbackBox(boxID)
		if err != nil {
			logging.LogErrorf("get rollback box [%s] failed: %s", boxID, err)
			return
		}
		boxID = box.ID

		var destPath, parentHPath string
		rootID := util.GetTreeID(file.Path)
		workingDoc := treenode.GetBlockTree(rootID)
		if needResetTree {
			workingDoc = nil
		}
		destPath, parentHPath, err = getRollbackDockPath(boxID, file.Path, workingDoc)
		if err != nil {
			return
		}

		tree, _ := loadTree(from, util.NewLute())
		if nil == tree {
			msg := fmt.Sprintf("no such file or directory: %s", from)
			logging.LogError(msg)
			err = errors.New(msg)
			return
		}

		tree.Box = boxID
		tree.Path = filepath.ToSlash(strings.TrimPrefix(destPath, util.DataDir+string(os.PathSeparator)+boxID))
		tree.HPath = parentHPath + "/" + tree.Root.IALAttr("title")
		if needResetTree {
			resetTree(tree, "", true)
		}

		if nil != workingDoc && "d" == workingDoc.Type {
			workingDocPath := filepath.Join(util.DataDir, boxID, workingDoc.Path)
			if err = filelock.Remove(workingDocPath); err != nil {
				return
			}
			logging.LogInfof("removed working doc file [%s]", workingDocPath)
		}
		if nil != workingDoc {
			treenode.RemoveBlockTreesByRootID(boxID, rootID)
		}

		sql.RemoveTreeQueue(boxID, rootID)
		if writeErr := indexWriteTreeIndexQueue(tree); nil != writeErr {
			return
		}
		ReloadFiletree()
		ReloadProtyle(rootID)

		msg := fmt.Sprintf(Conf.Language(286), path.Join(box.Name, tree.HPath))
		util.PushMsg(msg, 7000)
	} else {
		to := filepath.Join(util.DataDir, file.Path)
		if err = filelock.CopyNewtimes(from, to); nil != err {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", from, to, err)
			return
		}

		if strings.Contains(file.Path, "/storage/av/") && strings.HasSuffix(file.Path, ".json") {
			avID := strings.TrimSuffix(filepath.Base(file.Path), ".json")
			cache.RemoveAVData(avID)
			ReloadAttrView(avID)
		}

		msg := fmt.Sprintf(Conf.Language(286), to)
		util.PushMsg(msg, 7000)
	}

	IncSync()
	return
}

func OpenRepoSnapshotFile(fileID string) (title, content string, displayInText bool, updated int64, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	file, err := repo.GetFile(fileID)
	if err != nil {
		return
	}

	data, err := repo.OpenFile(file)
	if err != nil {
		return
	}

	updated = file.Updated

	if strings.HasSuffix(file.Path, ".sy") {
		// 加密笔记本的 .sy 在仓库里是密文，按路径提取 boxID 解密
		data = decryptRepoDataIfNeeded(data, file.Path)
		luteEngine := NewLute()
		var snapshotTree *parse.Tree
		displayInText, snapshotTree, err = parseTreeInSnapshot(data, luteEngine)
		if err != nil {
			logging.LogErrorf("parse tree from snapshot file [%s] failed", fileID)
			return
		}
		title = snapshotTree.Root.IALAttr("title")

		if !displayInText {
			renderTree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}}
			var unlinks []*ast.Node
			ast.Walk(snapshotTree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}

				n.RemoveIALAttr("heading-fold")
				n.RemoveIALAttr("fold")
				return ast.WalkContinue
			})

			for _, unlink := range unlinks {
				unlink.Unlink()
			}

			var appends []*ast.Node
			for n := snapshotTree.Root.FirstChild; nil != n; n = n.Next {
				appends = append(appends, n)
			}
			for _, n := range appends {
				renderTree.Root.AppendChild(n)
			}

			snapshotTree = renderTree
		}

		luteEngine.RenderOptions.ProtyleContenteditable = false
		if displayInText {
			util.PushMsg(Conf.Language(36), 5000)
			formatRenderer := render.NewFormatRenderer(snapshotTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
			content = gulu.Str.FromBytes(formatRenderer.Render())
		} else {
			content = luteEngine.Tree2BlockDOM(snapshotTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
		}
	} else {
		displayInText = true
		title = file.Path
		// 加密 notebook 的 AV 定义在仓库里是密文，需先解密再展示
		if strings.Contains(file.Path, "storage/av/") && strings.HasSuffix(file.Path, ".json") {
			repoBoxID := ""
			origPath := strings.TrimPrefix(file.Path, "/")
			if parts := strings.SplitN(origPath, "/", 2); len(parts) >= 1 && ast.IsNodeIDPattern(parts[0]) {
				repoBoxID = parts[0]
			}
			if repoBoxID != "" && IsEncryptedBox(repoBoxID) {
				HoldBoxReadLock(repoBoxID)
				defer ReleaseBoxReadLock(repoBoxID)
				if dek, dekErr := GetDEKIfUnlocked(repoBoxID); dekErr == nil && dek != nil {
					avID := strings.TrimSuffix(filepath.Base(file.Path), ".json")
					if plainData, decErr := av.DecryptAVDataLocked(repoBoxID, avID, data); decErr == nil {
						data = plainData
					} else {
						logging.LogWarnf("decrypt repo snapshot AV [%s] failed: %s", file.Path, decErr)
						content = file.Path
						return
					}
				} else {
					content = file.Path
					return
				}
			}
		}
		if mimeType := mime.TypeByExtension(filepath.Ext(file.Path)); strings.HasPrefix(mimeType, "text/") || strings.Contains(mimeType, "json") {
			// 如果是文本文件，直接返回文本内容
			// All plain text formats are supported when comparing data snapshots https://github.com/siyuan-note/siyuan/issues/12975
			content = gulu.Str.FromBytes(data)
		} else {
			if strings.Contains(file.Path, "assets/") { // 剔除笔记本级或者文档级资源文件路径前缀
				// 加密 notebook 的 asset 在仓库里是密文，不解密直接写临时目录会泄漏密文
				// 先用原始 path 检测是否加密 box，再裁剪 file.Path 到 assets/ 前缀
				repoBoxID := ""
				origPath := strings.TrimPrefix(file.Path, "/")
				if parts := strings.SplitN(origPath, "/", 2); len(parts) >= 1 && ast.IsNodeIDPattern(parts[0]) {
					repoBoxID = parts[0]
				}
				if repoBoxID != "" && IsEncryptedBox(repoBoxID) {
					HoldBoxReadLock(repoBoxID)
					defer ReleaseBoxReadLock(repoBoxID)
					// 加密 asset：尝试解密后预览，无法解密则 fail-closed
					if dek, dekErr := GetDEKIfUnlocked(repoBoxID); dekErr == nil && dek != nil {
						diskName := filepath.Base(file.Path)
						if plainData, decErr := DecryptAsset(repoBoxID, diskName, dek, data); decErr == nil {
							data = plainData
						} else {
							logging.LogWarnf("decrypt repo snapshot asset [%s] failed: %s", file.Path, decErr)
							content = file.Path
							return
						}
					} else {
						content = file.Path
						return
					}
				}
				// 保留 boxID 前缀，确保 LockBox 清理和 serveRepoDiff 加密校验能命中
				file.Path = path.Join(repoBoxID, file.Path[strings.Index(file.Path, "assets/"):])
				if util.IsDisplayableAsset(file.Path) {
					dir, f := filepath.Split(file.Path)
					tempRepoDiffDir := filepath.Join(util.TempDir, "repo", "diff", dir)
					if mkErr := os.MkdirAll(tempRepoDiffDir, 0755); nil != mkErr {
						logging.LogErrorf("mkdir [%s] failed: %v", tempRepoDiffDir, mkErr)
					} else {
						if wrErr := os.WriteFile(filepath.Join(tempRepoDiffDir, f), data, 0644); nil != wrErr {
							logging.LogErrorf("write file [%s] failed: %v", filepath.Join(tempRepoDiffDir, file.Path), wrErr)
						}
					}
					content = path.Join("repo", "diff", file.Path)
				}
			} else {
				content = file.Path
			}
		}
	}
	return
}

type LeftRightDiff struct {
	LeftIndex    *DiffIndex  `json:"leftIndex"`
	RightIndex   *DiffIndex  `json:"rightIndex"`
	AddsLeft     []*DiffFile `json:"addsLeft"`
	UpdatesLeft  []*DiffFile `json:"updatesLeft"`
	UpdatesRight []*DiffFile `json:"updatesRight"`
	RemovesRight []*DiffFile `json:"removesRight"`
}

type DiffFile struct {
	FileID  string `json:"fileID"`
	IndexID string `json:"indexID"`
	Title   string `json:"title"`
	Path    string `json:"path"`
	HPath   string `json:"hPath,omitempty"`
	HSize   string `json:"hSize"`
	Updated int64  `json:"updated"`
}

type DiffIndex struct {
	ID      string `json:"id"`
	Created int64  `json:"created"`
}

func DiffRepoSnapshots(left, right string) (ret *LeftRightDiff, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	diff, err := repo.DiffIndex(left, right)
	if err != nil {
		return
	}

	ret = &LeftRightDiff{
		LeftIndex: &DiffIndex{
			ID:      diff.LeftIndex.ID,
			Created: diff.LeftIndex.Created,
		},
		RightIndex: &DiffIndex{
			ID:      diff.RightIndex.ID,
			Created: diff.RightIndex.Created,
		},
	}
	luteEngine := NewLute()
	for _, removeRight := range diff.RemovesRight {
		title, _, parseErr := parseTitleInSnapshot(removeRight.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			continue
		}

		ret.AddsLeft = append(ret.AddsLeft, &DiffFile{
			FileID:  removeRight.ID,
			Title:   title,
			Path:    removeRight.Path,
			HSize:   humanize.BytesCustomCeil(uint64(removeRight.Size), 2),
			Updated: removeRight.Updated,
		})
	}
	if 1 > len(ret.AddsLeft) {
		ret.AddsLeft = []*DiffFile{}
	}

	for _, addLeft := range diff.AddsLeft {
		title, _, parseErr := parseTitleInSnapshot(addLeft.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			continue
		}

		ret.RemovesRight = append(ret.RemovesRight, &DiffFile{
			FileID:  addLeft.ID,
			Title:   title,
			Path:    addLeft.Path,
			HSize:   humanize.BytesCustomCeil(uint64(addLeft.Size), 2),
			Updated: addLeft.Updated,
		})
	}
	if 1 > len(ret.RemovesRight) {
		ret.RemovesRight = []*DiffFile{}
	}

	for _, updateLeft := range diff.UpdatesLeft {
		title, _, parseErr := parseTitleInSnapshot(updateLeft.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			continue
		}

		ret.UpdatesLeft = append(ret.UpdatesLeft, &DiffFile{
			FileID:  updateLeft.ID,
			Title:   title,
			Path:    updateLeft.Path,
			HSize:   humanize.BytesCustomCeil(uint64(updateLeft.Size), 2),
			Updated: updateLeft.Updated,
		})
	}
	if 1 > len(ret.UpdatesLeft) {
		ret.UpdatesLeft = []*DiffFile{}
	}

	for _, updateRight := range diff.UpdatesRight {
		title, _, parseErr := parseTitleInSnapshot(updateRight.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			continue
		}

		ret.UpdatesRight = append(ret.UpdatesRight, &DiffFile{
			FileID:  updateRight.ID,
			Title:   title,
			Path:    updateRight.Path,
			HSize:   humanize.BytesCustomCeil(uint64(updateRight.Size), 2),
			Updated: updateRight.Updated,
		})
	}
	if 1 > len(ret.UpdatesRight) {
		ret.UpdatesRight = []*DiffFile{}
	}
	return
}

func parseTitleInSnapshot(fileID string, repo *dejavu.Repo, luteEngine *lute.Lute) (title, rootID string, err error) {
	file, err := repo.GetFile(fileID)
	if err != nil {
		logging.LogErrorf("get file [%s] failed: %s", fileID, err)
		return
	}

	title = path.Base(file.Path)
	if strings.HasSuffix(file.Path, ".sy") {
		var data []byte
		data, err = repo.OpenFile(file)
		if err != nil {
			logging.LogErrorf("open file [%s] failed: %s", fileID, err)
			return
		}

		// 加密笔记本的 .sy 在仓库里是密文，按路径提取 boxID 解密
		data = decryptRepoDataIfNeeded(data, file.Path)

		var tree *parse.Tree
		tree, err = dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
		if err != nil {
			logging.LogErrorf("parse file [%s] failed: %s", fileID, err)
			return
		}

		title = tree.Root.IALAttr("title")
		rootID = tree.Root.ID
	}
	return
}

// decryptRepoDataIfNeeded 判断仓库数据是否属于加密笔记本，如果是则按路径类型分流解密。
// file.Path 格式：/<boxID>/...
// .sy → DecryptFile，assets/* → DecryptAsset，storage/av/*.json → av.DecryptAVData。
// 其他文件或解锁失败时返回原数据（调用方 fallback）。
func decryptRepoDataIfNeeded(data []byte, filePath string) []byte {
	relPath := strings.TrimPrefix(filePath, "/")
	parts := strings.SplitN(relPath, "/", 2)
	if len(parts) < 1 || !ast.IsNodeIDPattern(parts[0]) {
		return data
	}
	boxID := parts[0]
	if !IsEncryptedBox(boxID) {
		return data
	}
	// 持读锁，防止 LockBox 在解密期间清 DEK/缓存
	HoldBoxReadLock(boxID)
	defer ReleaseBoxReadLock(boxID)
	dek, err := GetDEKIfUnlocked(boxID)
	if err != nil {
		return data // 加密笔记本未解锁：返回原数据
	}
	if len(parts) < 2 {
		return data
	}
	boxRelPath := parts[1]
	// 按路径类型分流
	if strings.HasPrefix(boxRelPath, "assets/") {
		diskName := filepath.Base(boxRelPath)
		plain, decErr := DecryptAsset(boxID, diskName, dek, data)
		if decErr != nil {
			return data
		}
		return plain
	}
	if strings.HasPrefix(boxRelPath, "storage/av/") && strings.HasSuffix(boxRelPath, ".json") {
		avID := strings.TrimSuffix(filepath.Base(boxRelPath), ".json")
		plain, decErr := av.DecryptAVDataLocked(boxID, avID, data)
		if decErr != nil {
			return data
		}
		return plain
	}
	// .sy 和其他文件用 file 子密钥 + 相对路径 AAD
	plain, decErr := DecryptFile(boxID, boxRelPath, dek, data)
	if decErr != nil {
		return data
	}
	return plain
}

func parseTreeInSnapshot(data []byte, luteEngine *lute.Lute) (isLargeDoc bool, tree *parse.Tree, err error) {
	isLargeDoc = 1024*1024*1 <= len(data)
	// data 可能是加密笔记本的密文，但 parseTreeInSnapshot 没有 file.Path 上下文
	// 密文解析会失败返回 err，调用方会 fallback 到文件名
	tree, err = dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	if err != nil {
		return
	}
	return
}

func SearchRepoFile(keyword string, page int) (ret []*DiffFile, pageCount, totalCount int, err error) {
	ret = []*DiffFile{}
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	files, fileIndexIDs, totalCount, pageCount, err := repo.SearchFile(keyword, page, 32)
	if err != nil {
		logging.LogErrorf("search repo file failed: %s", err)
		return
	}

	if 1 > len(files) {
		return
	}

	luteEngine := NewLute()
	for _, file := range files {
		title, rootID, parseErr := parseTitleInSnapshot(file.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			title = path.Base(file.Path)
		}

		var hpath string
		if "" != rootID && treenode.ExistBlockTree(rootID) {
			hpath, _ = GetHPathByID(rootID)
		} else {
			hpath = file.Path
		}
		ret = append(ret, &DiffFile{
			FileID:  file.ID,
			IndexID: fileIndexIDs[file.ID],
			Title:   title,
			Path:    file.Path,
			HPath:   hpath,
			HSize:   humanize.BytesCustomCeil(uint64(file.Size), 2),
			Updated: file.Updated,
		})
	}
	return
}

func ExportRepoFile(id string) (exportPath string, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	file, err := repo.GetFile(id)
	if err != nil {
		return
	}

	data, err := repo.OpenFile(file)
	if err != nil {
		return
	}

	// 加密笔记本的 .sy 在仓库里是密文，按路径提取 boxID 解密
	data = decryptRepoDataIfNeeded(data, file.Path)
	// 如果加密 box 已锁定，decryptRepoDataIfNeeded 返回原密文，应拒绝导出
	repoRel := strings.TrimPrefix(file.Path, "/")
	repoParts := strings.SplitN(repoRel, "/", 2)
	if len(repoParts) >= 1 && ast.IsNodeIDPattern(repoParts[0]) && IsEncryptedBox(repoParts[0]) {
		HoldBoxReadLock(repoParts[0])
		defer ReleaseBoxReadLock(repoParts[0])
		if _, dekErr := GetDEKIfUnlocked(repoParts[0]); dekErr != nil {
			err = errors.New(Conf.Language(314))
			return
		}
	}

	name := path.Base(file.Path)
	exportDir := filepath.Join(util.TempDir, "export", "repo")

	// 如果是 .sy 文件需要打包为 .sy.zip 以便导入
	var docTitle string
	if strings.HasSuffix(file.Path, ".sy") {
		var tree *parse.Tree
		luteEngine := NewLute()
		tree, err = dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
		if err != nil {
			logging.LogErrorf("parse file [%s] failed: %s", id, err)
			return
		}

		docTitle = tree.Root.IALAttr("title")
		exportDir = filepath.Join(exportDir, docTitle)
	}

	if err = os.MkdirAll(exportDir, 0755); err != nil {
		logging.LogErrorf("mkdir [%s] failed: %s", exportDir, err)
		return
	}

	exportFilePath := filepath.Join(exportDir, name)
	if err = os.WriteFile(exportFilePath, data, 0644); err != nil {
		logging.LogErrorf("write file [%s] failed: %s", exportFilePath, err)
		return
	}

	if strings.HasSuffix(file.Path, ".sy") {
		zipPath := filepath.Join(util.TempDir, "export", "repo", docTitle+".sy.zip")
		zip, zipErr := gulu.Zip.Create(zipPath)
		if zipErr != nil {
			logging.LogErrorf("create export .sy.zip [%s] failed: %s", exportDir, zipErr)
			return
		}

		if err = zip.AddDirectory(docTitle, exportDir); err != nil {
			logging.LogErrorf("create export .sy.zip [%s] failed: %s", exportDir, err)
			return
		}

		if err = zip.Close(); err != nil {
			logging.LogErrorf("close export .sy.zip failed: %s", err)
			return
		}

		exportPath = path.Join("/export/repo", url.PathEscape(filepath.Base(zipPath)))
		return
	}

	exportPath = path.Join("/export/repo", url.PathEscape(name))
	return
}

type Snapshot struct {
	*dejavu.Log
	TypesCount []*TypeCount `json:"typesCount"`
}

type TypeCount struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}

func GetRepoSnapshots(page int) (ret []*Snapshot, pageCount, totalCount int, err error) {
	ret = []*Snapshot{}
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	logs, pageCount, totalCount, err := repo.GetIndexLogs(page, 32)
	if err != nil {
		if errors.Is(err, dejavu.ErrNotFoundIndex) {
			logs = []*dejavu.Log{}
			err = nil
			return
		}

		logging.LogErrorf("get data repo index logs failed: %s", err)
		return
	}

	ret = buildSnapshots(logs)
	if 1 > len(ret) {
		ret = []*Snapshot{}
	}
	return
}

func buildSnapshots(logs []*dejavu.Log) (ret []*Snapshot) {
	for _, l := range logs {
		typesCount := statTypesByPath(l.Files)
		l.Files = nil // 置空，否则返回前端数据量太大
		ret = append(ret, &Snapshot{
			Log:        l,
			TypesCount: typesCount,
		})
	}
	return
}

func statTypesByPath(files []*entity.File) (ret []*TypeCount) {
	for _, f := range files {
		ext := util.Ext(f.Path)
		if "" == ext {
			ext = "NoExt"
		}

		found := false
		for _, tc := range ret {

			if tc.Type == ext {
				tc.Count++
				found = true
				break
			}
		}
		if !found {
			ret = append(ret, &TypeCount{Type: ext, Count: 1})
		}
	}

	sort.Slice(ret, func(i, j int) bool { return ret[i].Count > ret[j].Count })
	if 10 < len(ret) {
		otherCount := 0
		for _, tc := range ret[10:] {
			tc.Count += otherCount
		}
		other := &TypeCount{
			Type:  "Other",
			Count: otherCount,
		}
		ret = append(ret[:10], other)
	}
	return
}

func ImportRepoKey(base64Key string) (retKey string, err error) {
	util.PushMsg(Conf.Language(136), 3000)

	retKey = gulu.Str.RemoveInvisible(base64Key)
	retKey = strings.TrimSpace(retKey)
	if 1 > len(retKey) {
		err = errors.New(Conf.Language(142))
		return
	}

	key, err := base64.StdEncoding.DecodeString(retKey)
	if err != nil {
		logging.LogErrorf("import data repo key failed: %s", err)
		return "", errors.New(Conf.Language(157))
	}
	if 32 != len(key) {
		return "", errors.New(Conf.Language(157))
	}

	Conf.Repo.Key = key
	Conf.Save()
	logging.LogInfof("imported repo key [%x]", sha1.Sum(Conf.Repo.Key))

	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); err != nil {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); err != nil {
		return
	}

	initDataRepo()
	return
}

func ResetRepo() (err error) {
	logging.LogInfof("resetting data repo...")
	msgId := util.PushMsg(Conf.Language(144), 1000*60)

	repo, err := newRepository()
	if err != nil {
		return
	}

	if err = repo.Reset(); err != nil {
		logging.LogErrorf("reset data repo failed: %s", err)
		return
	}
	logging.LogInfof("reset data repo completed")

	Conf.Repo.Key = nil
	Conf.Sync.Enabled = false
	Conf.Save()

	util.PushUpdateMsg(msgId, Conf.Language(145), 3000)
	task.AppendAsyncTaskWithDelay(task.ReloadUI, 2*time.Second, util.ReloadUI)
	return
}

func PurgeCloud() (err error) {
	msg := Conf.Language(223)
	util.PushEndlessProgress(msg)
	defer util.PushClearProgress()

	repo, err := newRepository()
	if err != nil {
		return
	}

	stat, err := repo.PurgeCloud()
	if err != nil {
		return
	}

	deletedIndexes := stat.Indexes
	deletedObjects := stat.Objects
	deletedSize := humanize.BytesCustomCeil(uint64(stat.Size), 2)
	msg = fmt.Sprintf(Conf.Language(232), deletedIndexes, deletedObjects, deletedSize)
	util.PushMsg(msg, 7000)
	return
}

func PurgeRepo() (err error) {
	msg := Conf.Language(202)
	util.PushEndlessProgress(msg)
	defer util.PushClearProgress()

	repo, err := newRepository()
	if err != nil {
		return
	}

	stat, err := repo.Purge(context.Background())
	if err != nil {
		return
	}

	deletedIndexes := stat.Indexes
	deletedObjects := stat.Objects
	deletedSize := humanize.BytesCustomCeil(uint64(stat.Size), 2)
	msg = fmt.Sprintf(Conf.Language(203), deletedIndexes, deletedObjects, deletedSize)
	util.PushMsg(msg, 7000)
	return
}

func InitRepoKeyFromPassphrase(passphrase string) (err error) {
	passphrase = gulu.Str.RemoveInvisible(passphrase)
	passphrase = strings.TrimSpace(passphrase)
	if "" == passphrase {
		return errors.New(Conf.Language(142))
	}

	util.PushMsg(Conf.Language(136), 3000)
	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); err != nil {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); err != nil {
		return
	}

	var key []byte
	base64Data, base64Err := base64.StdEncoding.DecodeString(passphrase)
	if nil == base64Err && 32 == len(base64Data) {
		// 改进数据仓库 `通过密码生成密钥` https://github.com/siyuan-note/siyuan/issues/6782
		logging.LogInfof("passphrase is base64 encoded, use it as key directly")
		key = base64Data
	} else {
		salt := fmt.Sprintf("%x", sha256.Sum256([]byte(passphrase)))[:16]
		key, err = encryption.KDF(passphrase, salt)
		if err != nil {
			logging.LogErrorf("init data repo key failed: %s", err)
			return
		}
	}

	Conf.Repo.Key = key
	Conf.Save()
	logging.LogInfof("inited repo key [%x]", sha1.Sum(Conf.Repo.Key))

	initDataRepo()
	return
}

func InitRepoKey() (err error) {
	util.PushMsg(Conf.Language(136), 3000)

	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); err != nil {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); err != nil {
		return
	}

	randomBytes := make([]byte, 16)
	_, err = rand.Read(randomBytes)
	if err != nil {
		return
	}
	password := string(randomBytes)
	randomBytes = make([]byte, 16)
	_, err = rand.Read(randomBytes)
	if err != nil {
		logging.LogErrorf("init data repo key failed: %s", err)
		return
	}
	salt := string(randomBytes)

	key, err := encryption.KDF(password, salt)
	if err != nil {
		logging.LogErrorf("init data repo key failed: %s", err)
		return
	}
	Conf.Repo.Key = key
	Conf.Save()
	logging.LogInfof("inited repo key [%x]", sha1.Sum(Conf.Repo.Key))

	initDataRepo()
	return
}

func initDataRepo() {
	time.Sleep(1 * time.Second)
	util.PushMsg(Conf.Language(138), 3000)
	time.Sleep(1 * time.Second)
	if _, initErr := IndexRepo("[Init] Init local data repo"); nil != initErr {
		util.PushErrMsg(fmt.Sprintf(Conf.Language(140), initErr), 0)
	}
}

func CheckoutRepo(id string) {
	task.AppendTask(task.RepoCheckout, checkoutRepo, id)
}

func CheckoutRepoDirect(id string) {
	checkoutRepo(id)
}

func checkoutRepo(id string) {
	var err error
	if 1 > len(Conf.Repo.Key) {
		util.PushErrMsg(Conf.Language(26), 7000)
		return
	}

	repo, err := newRepository()
	if err != nil {
		logging.LogErrorf("new repository failed: %s", err)
		util.PushErrMsg(Conf.Language(141), 7000)
		return
	}

	util.PushEndlessProgress(Conf.Language(63))
	FlushTxQueue()

	CloseWatchAssets()
	defer WatchAssets()

	CloseWatchEmojis()
	defer WatchEmojis()

	// 若主题支持同步，需关闭监听器
	// CloseWatchThemes()
	// defer WatchThemes()

	// 恢复快照时自动暂停同步，避免刚刚恢复后的数据又被同步覆盖
	syncEnabled := Conf.Sync.Enabled
	Conf.Sync.Enabled = false
	Conf.Save()
	if syncEnabled {
		util.PushMsg(Conf.Language(134), 0)
	}

	// 回滚快照时默认为当前数据创建一个快照
	// When rolling back a snapshot, a snapshot is created for the current data by default https://github.com/siyuan-note/siyuan/issues/12470
	FlushTxQueue()
	_, err = repo.Index("Backup before checkout", false, map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	if err != nil {
		logging.LogErrorf("index repository failed: %s", err)
		util.PushClearProgress()
		util.PushErrMsg(fmt.Sprintf(Conf.Language(140), err), 0)
		return
	}

	_, _, err = repo.Checkout(id, map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	if err != nil {
		logging.LogErrorf("checkout repository failed: %s", err)
		util.PushClearProgress()
		util.PushErrMsg(Conf.Language(141), 7000)
		return
	}

	FullReindexDirect()
	appendAgentRollbackEntries()
	time.Sleep(time.Second)
	FlushTxQueue()
	task.AppendAsyncTaskWithDelay(task.ReloadUI, 1*time.Second, util.ReloadUI)
	return
}

func appendAgentRollbackEntries() {
	pattern := filepath.Join(util.TempDir, "ai", "agent", "agentRollback_*.json")
	markers, err := filepath.Glob(pattern)
	if err != nil {
		return
	}
	for _, markerPath := range markers {
		data, err := os.ReadFile(markerPath)
		if err != nil {
			os.Remove(markerPath)
			continue
		}
		var marker struct {
			SessionID  string `json:"sessionID"`
			SnapshotID string `json:"snapshotID"`
		}
		if nil != gulu.JSON.UnmarshalJSON(data, &marker) {
			os.Remove(markerPath)
			continue
		}

		sessionPath := filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions",
			marker.SessionID, "session.json")
		sessionData, err := os.ReadFile(sessionPath)
		if err != nil {
			os.Remove(markerPath)
			continue
		}

		var session map[string]any
		if nil != gulu.JSON.UnmarshalJSON(sessionData, &session) {
			os.Remove(markerPath)
			continue
		}

		entries, ok := session["entries"].([]any)
		if !ok {
			entries = make([]any, 0)
		}
		entry := map[string]any{
			"type":       "rollback",
			"snapshotID": marker.SnapshotID,
		}
		entries = append(entries, entry)
		session["entries"] = entries

		newData, err := gulu.JSON.MarshalIndentJSON(session, "", "\t")
		if err != nil {
			os.Remove(markerPath)
			continue
		}
		filelock.WriteFile(sessionPath, newData)
		os.Remove(markerPath)
	}
}

func DownloadCloudSnapshot(tag, id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3, conf.ProviderLocal:
		if !IsPaidUser() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	defer util.PushClearProgress()

	var downloadFileCount, downloadChunkCount int
	var downloadBytes int64
	if "" == tag {
		downloadFileCount, downloadChunkCount, downloadBytes, err = repo.DownloadIndex(id, map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	} else {
		downloadFileCount, downloadChunkCount, downloadBytes, err = repo.DownloadTagIndex(tag, id, map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	}
	if err != nil {
		return
	}
	msg := fmt.Sprintf(Conf.Language(153), downloadFileCount, downloadChunkCount, humanize.BytesCustomCeil(uint64(downloadBytes), 2))
	util.PushMsg(msg, 5000)
	util.PushStatusBar(msg)
	return
}

func UploadCloudSnapshot(tag, id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3, conf.ProviderLocal:
		if !IsPaidUser() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	util.PushEndlessProgress(Conf.Language(116))
	defer util.PushClearProgress()
	uploadFileCount, uploadChunkCount, uploadBytes, err := repo.UploadTagIndex(tag, id, map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	if err != nil {
		if errors.Is(err, dejavu.ErrCloudBackupCountExceeded) {
			err = fmt.Errorf(Conf.Language(84), Conf.Language(154))
			return
		}
		err = fmt.Errorf(Conf.Language(84), formatRepoErrorMsg(err))
		return
	}
	msg := fmt.Sprintf(Conf.Language(152), uploadFileCount, uploadChunkCount, humanize.BytesCustomCeil(uint64(uploadBytes), 2))
	util.PushMsg(msg, 5000)
	util.PushStatusBar(msg)
	return
}

func RemoveCloudRepoTag(tag string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3, conf.ProviderLocal:
		if !IsPaidUser() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	err = repo.RemoveCloudRepoTag(tag)
	if err != nil {
		return
	}
	return
}

func GetCloudRepoTagSnapshots() (ret []*dejavu.Log, err error) {
	ret = []*dejavu.Log{}
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3, conf.ProviderLocal:
		if !IsPaidUser() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	logs, err := repo.GetCloudRepoTagLogs(map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar})
	if err != nil {
		return
	}
	ret = logs
	if 1 > len(ret) {
		ret = []*dejavu.Log{}
	}
	return
}

func GetCloudRepoSnapshots(page int) (ret []*dejavu.Log, pageCount, totalCount int, err error) {
	ret = []*dejavu.Log{}
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3, conf.ProviderLocal:
		if !IsPaidUser() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	if 1 > page {
		page = 1
	}

	logs, pageCount, totalCount, err := repo.GetCloudRepoLogs(page)
	if err != nil {
		return
	}
	ret = logs
	if 1 > len(ret) {
		ret = []*dejavu.Log{}
	}
	return
}

func GetTagSnapshots() (ret []*Snapshot, err error) {
	ret = []*Snapshot{}
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	logs, err := repo.GetTagLogs()
	if err != nil {
		return
	}
	ret = buildSnapshots(logs)
	if 1 > len(ret) {
		ret = []*Snapshot{}
	}
	return
}

func RemoveTagSnapshot(tag string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	err = repo.RemoveTag(tag)
	return
}

func TagSnapshot(id, name string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	name = util.RemoveInvalid(name)
	name = strings.TrimSpace(name)
	if "" == name {
		err = errors.New(Conf.Language(142))
		return
	}

	if !gulu.File.IsValidFilename(name) {
		err = errors.New(Conf.Language(151))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	index, err := repo.GetIndex(id)
	if err != nil {
		return
	}

	if err = repo.AddTag(index.ID, name); err != nil {
		msg := fmt.Sprintf("Add tag to data snapshot [%s] failed: %s", index.ID, err)
		util.PushStatusBar(msg)
		return
	}
	return
}

func IndexRepo(memo string) (id string, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	memo = gulu.Str.RemoveInvisible(memo)
	memo = strings.TrimSpace(memo)
	if "" == memo {
		err = errors.New(Conf.Language(142))
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	util.PushEndlessProgress(Conf.Language(143))

	start := time.Now()
	latest, _ := repo.Latest()
	FlushTxQueue()
	index, err := repo.Index(memo, true, map[string]any{
		eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress,
	})
	if err != nil {
		util.PushStatusBar("Index data repo failed: " + html.EscapeString(err.Error()))
		return
	}
	id = index.ID
	elapsed := time.Since(start)

	if nil == latest || latest.ID != index.ID {
		msg := fmt.Sprintf(Conf.Language(147), elapsed.Seconds())
		util.PushStatusBar(msg)
		util.PushMsg(msg, 5000)
	} else {
		msg := fmt.Sprintf(Conf.Language(148), elapsed.Seconds())
		util.PushStatusBar(msg)
		util.PushMsg(msg, 5000)
	}
	util.PushClearProgress()
	return
}

var syncingFiles = sync.Map{}
var syncingStorages = atomic.Bool{}

func waitForSyncingStorages() {
	for isSyncingStorages() {
		time.Sleep(time.Second)
	}
}

func isSyncingStorages() bool {
	return syncingStorages.Load() || isBootSyncing.Load()
}

func IsSyncingFile(rootID string) (ret bool) {
	_, ret = syncingFiles.Load(rootID)
	return
}

func syncRepoDownload() (err error) {
	if 1 > len(Conf.Repo.Key) {
		planSyncAfter(fixSyncInterval)

		msg := Conf.Language(26)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		err = errors.New(msg)
		return
	}

	repo, err := newRepository()
	if err != nil {
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", err)
		logging.LogError(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	logging.LogInfof("downloading data repo [device=%s, kernel=%s, provider=%d, mode=%s/%t]", Conf.System.ID, KernelID, Conf.Sync.Provider, "d", true)
	start := time.Now()
	_, _, err = indexRepoBeforeCloudSync(repo)
	if err != nil {
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo download failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		Conf.Sync.Stat = msg
		Conf.Save()
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	beforeSyncPetals := getPetals()

	syncContext := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	mergeResult, trafficStat, err := repo.SyncDownload(syncContext)
	elapsed := time.Since(start)
	if err != nil {
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo download failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			u := Conf.GetUser()
			msg = fmt.Sprintf(Conf.Language(43), humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2))
			if 2 == u.UserSiYuanSubscriptionPlan {
				msg = fmt.Sprintf(Conf.Language(68), humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2))
			}
		}
		Conf.Sync.Stat = msg
		Conf.Save()
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	util.PushStatusBar(fmt.Sprintf(Conf.Language(149), elapsed.Seconds()))
	Conf.Sync.Synced = util.CurrentTimeMillis()
	msg := fmt.Sprintf(Conf.Language(150), trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.BytesCustomCeil(uint64(trafficStat.UploadBytes), 2), humanize.BytesCustomFloor(uint64(trafficStat.DownloadBytes), 2))
	Conf.Sync.Stat = msg
	Conf.Save()
	autoSyncErrCount = 0
	BootSyncSucc = 0

	calcPetalDiff(beforeSyncPetals, mergeResult)
	processSyncMergeResult(false, true, mergeResult, trafficStat, "d", elapsed)
	return
}

func syncRepoUpload() (err error) {
	if 1 > len(Conf.Repo.Key) {
		planSyncAfter(fixSyncInterval)

		msg := Conf.Language(26)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		err = errors.New(msg)
		return
	}

	repo, err := newRepository()
	if err != nil {
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", err)
		logging.LogError(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	logging.LogInfof("uploading data repo [device=%s, kernel=%s, provider=%d, mode=%s/%t]", Conf.System.ID, KernelID, Conf.Sync.Provider, "u", true)
	start := time.Now()
	_, _, err = indexRepoBeforeCloudSync(repo)
	if err != nil {
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo upload failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		Conf.Sync.Stat = msg
		Conf.Save()
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	syncContext := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	trafficStat, err := repo.SyncUpload(syncContext)
	elapsed := time.Since(start)
	if err != nil {
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo upload failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			u := Conf.GetUser()
			msg = fmt.Sprintf(Conf.Language(43), humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2))
			if 2 == u.UserSiYuanSubscriptionPlan {
				msg = fmt.Sprintf(Conf.Language(68), humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2))
			}
		}
		Conf.Sync.Stat = msg
		Conf.Save()
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	util.PushStatusBar(fmt.Sprintf(Conf.Language(149), elapsed.Seconds()))
	Conf.Sync.Synced = util.CurrentTimeMillis()
	msg := fmt.Sprintf(Conf.Language(150), trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.BytesCustomCeil(uint64(trafficStat.UploadBytes), 2), humanize.BytesCustomCeil(uint64(trafficStat.DownloadBytes), 2))
	Conf.Sync.Stat = msg
	Conf.Save()
	autoSyncErrCount = 0
	BootSyncSucc = 0

	processSyncMergeResult(false, true, &dejavu.MergeResult{}, trafficStat, "u", elapsed)
	return
}

var isBootSyncing = atomic.Bool{}

func bootSyncRepo() (err error) {
	if 1 > len(Conf.Repo.Key) {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		msg := Conf.Language(26)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		err = errors.New(msg)
		return
	}

	repo, err := newRepository()
	if err != nil {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", html.EscapeString(err.Error()))
		logging.LogError(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	isBootSyncing.Store(true)

	waitGroup := sync.WaitGroup{}
	var errs []error
	waitGroup.Go(func() {
		defer logging.Recover()

		start := time.Now()
		_, _, indexErr := indexRepoBeforeCloudSync(repo)
		if indexErr != nil {
			errs = append(errs, indexErr)
			autoSyncErrCount++
			planSyncAfter(fixSyncInterval)

			msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(indexErr))
			Conf.Sync.Stat = msg
			Conf.Save()
			util.PushStatusBar(msg)
			util.PushErrMsg(msg, 0)
			BootSyncSucc = 1
			isBootSyncing.Store(false)
			return
		}

		logging.LogInfof("boot index repo elapsed [%.2fs]", time.Since(start).Seconds())
	})
	var fetchedFiles []*entity.File
	waitGroup.Go(func() {
		defer logging.Recover()

		start := time.Now()
		syncContext := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
		cloudLatest, getErr := repo.GetCloudLatest(syncContext)
		if nil != getErr {
			errs = append(errs, getErr)
			if !errors.Is(getErr, cloud.ErrCloudObjectNotFound) {
				logging.LogErrorf("download cloud latest failed: %s", getErr)
				return
			}
		}
		fetchedFiles, getErr = repo.GetSyncCloudFiles(cloudLatest, syncContext)
		if errors.Is(getErr, dejavu.ErrRepoFatal) {
			errs = append(errs, getErr)
			autoSyncErrCount++
			planSyncAfter(fixSyncInterval)

			msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(getErr))
			Conf.Sync.Stat = msg
			Conf.Save()
			util.PushStatusBar(msg)
			util.PushErrMsg(msg, 0)
			BootSyncSucc = 1
			isBootSyncing.Store(false)
			return
		}

		logging.LogInfof("boot get sync cloud files elapsed [%.2fs]", time.Since(start).Seconds())
	})
	waitGroup.Wait()
	if 0 < len(errs) {
		err = errs[0]
	}

	if err != nil {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			u := Conf.GetUser()
			msg = fmt.Sprintf(Conf.Language(43), humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2))
			if 2 == u.UserSiYuanSubscriptionPlan {
				msg = fmt.Sprintf(Conf.Language(68), humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2))
			}
		}
		Conf.Sync.Stat = msg
		Conf.Save()
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		BootSyncSucc = 1
		isBootSyncing.Store(false)
		return
	}

	syncingFiles = sync.Map{}
	syncingStorages.Store(false)
	for _, fetchedFile := range fetchedFiles {
		name := path.Base(fetchedFile.Path)
		if strings.HasSuffix(name, ".sy") {
			id := name[:len(name)-3]
			syncingFiles.Store(id, true)
			continue
		}
		if strings.HasPrefix(fetchedFile.Path, "/storage/") {
			syncingStorages.Store(true)
		}
	}

	if 0 < len(fetchedFiles) {
		go func() {
			_, syncErr := syncRepoWithDNSRetry(false, false)
			isBootSyncing.Store(false)
			if err != nil {
				logging.LogErrorf("boot background sync repo failed: %s", syncErr)
				return
			}
		}()
	} else {
		isBootSyncing.Store(false)
	}
	return
}

func syncRepo(exit, byHand bool) (dataChanged bool, err error) {
	if 1 > len(Conf.Repo.Key) {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		msg := Conf.Language(26)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		err = errors.New(msg)
		return
	}

	repo, err := newRepository()
	if err != nil {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", err)
		logging.LogError(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	logging.LogInfof("syncing data repo [device=%s, kernel=%s, provider=%d, mode=%s/%t]", Conf.System.ID, KernelID, Conf.Sync.Provider, "a", byHand)
	start := time.Now()
	beforeIndex, afterIndex, err := indexRepoBeforeCloudSync(repo)
	if err != nil {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		Conf.Sync.Stat = msg
		Conf.Save()
		util.PushStatusBar(msg)
		if 1 > autoSyncErrCount || byHand {
			util.PushErrMsg(msg, 0)
		}
		if exit {
			ExitSyncSucc = 1
		}
		return
	}

	beforeSyncPetals := getPetals()

	syncContext := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	mergeResult, trafficStat, err := repo.Sync(syncContext)
	elapsed := time.Since(start)
	if err != nil {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			u := Conf.GetUser()
			msg = fmt.Sprintf(Conf.Language(43), humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2))
			if 2 == u.UserSiYuanSubscriptionPlan {
				msg = fmt.Sprintf(Conf.Language(68), humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2))
			}
		}
		Conf.Sync.Stat = msg
		Conf.Save()
		util.PushStatusBar(msg)
		if 1 > autoSyncErrCount || byHand {
			util.PushErrMsg(msg, 0)
		}
		if exit {
			ExitSyncSucc = 1
		}
		return
	}

	dataChanged = nil == beforeIndex || beforeIndex.ID != afterIndex.ID || mergeResult.DataChanged()

	util.PushStatusBar(fmt.Sprintf(Conf.Language(149), elapsed.Seconds()))
	Conf.Sync.Synced = util.CurrentTimeMillis()
	msg := fmt.Sprintf(Conf.Language(150), trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.BytesCustomCeil(uint64(trafficStat.UploadBytes), 2), humanize.BytesCustomCeil(uint64(trafficStat.DownloadBytes), 2))
	Conf.Sync.Stat = msg
	Conf.Save()
	autoSyncErrCount = 0

	calcPetalDiff(beforeSyncPetals, mergeResult)
	processSyncMergeResult(exit, byHand, mergeResult, trafficStat, "a", elapsed)

	if !exit {
		go func() {
			// 首次数据同步执行完成后再执行索引订正 Index fixing should not be performed before data synchronization https://github.com/siyuan-note/siyuan/issues/10761
			checkIndex()
			// 索引订正结束后执行数据仓库清理 Automatic purge for local data repo https://github.com/siyuan-note/siyuan/issues/13091
			autoPurgeRepo(false)
		}()
	}
	return
}

func calcPetalDiff(beforeSyncPetals []*Petal, mergeResult *dejavu.MergeResult) {
	var upsertPetals, removePetals []string
	afterSyncPetals := getPetals()
	for _, afterSyncPetal := range afterSyncPetals {
		if beforeSyncPetal := getPetalByName(afterSyncPetal.Name, beforeSyncPetals); nil != beforeSyncPetal {
			a, _ := gulu.JSON.MarshalJSON(afterSyncPetal)
			b, _ := gulu.JSON.MarshalJSON(beforeSyncPetal)
			if !bytes.Equal(a, b) {
				upsertPetals = append(upsertPetals, afterSyncPetal.Name)
			}
		} else {
			upsertPetals = append(upsertPetals, afterSyncPetal.Name)
		}
	}
	for _, beforeSyncPetal := range beforeSyncPetals {
		if nil == getPetalByName(beforeSyncPetal.Name, afterSyncPetals) {
			removePetals = append(removePetals, beforeSyncPetal.Name)
		}
	}

	mergeResult.UpsertPetals = gulu.Str.RemoveDuplicatedElem(upsertPetals)
	mergeResult.RemovePetals = gulu.Str.RemoveDuplicatedElem(removePetals)
}

func processSyncMergeResult(exit, byHand bool, mergeResult *dejavu.MergeResult, trafficStat *dejavu.TrafficStat, mode string, elapsed time.Duration) {
	logging.LogInfof("synced data repo [device=%s, kernel=%s, provider=%d, mode=%s/%t, ufc=%d, dfc=%d, ucc=%d, dcc=%d, ub=%s, db=%s] in [%.2fs], merge result [conflicts=%d, upserts=%d, removes=%d]\n\n",
		Conf.System.ID, KernelID, Conf.Sync.Provider, mode, byHand,
		trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.BytesCustomCeil(uint64(trafficStat.UploadBytes), 2), humanize.BytesCustomCeil(uint64(trafficStat.DownloadBytes), 2),
		elapsed.Seconds(),
		len(mergeResult.Conflicts), len(mergeResult.Upserts), len(mergeResult.Removes))

	//logSyncMergeResult(mergeResult)

	var needReloadFiletree bool
	if 0 < len(mergeResult.Conflicts) {
		luteEngine := util.NewLute()
		if Conf.Sync.GenerateConflictDoc {
			// 云端同步发生冲突时生成副本 https://github.com/siyuan-note/siyuan/issues/5687

			for _, file := range mergeResult.Conflicts {
				if !strings.HasSuffix(file.Path, ".sy") {
					continue
				}

				parts := strings.Split(file.Path[1:], "/")
				if 2 > len(parts) {
					continue
				}
				boxID := parts[0]

				absPath := filepath.Join(util.TempDir, "repo", "sync", "conflicts", mergeResult.Time.Format("2006-01-02-150405"), file.Path)
				// 加密笔记本的冲突 .sy 在临时目录里是密文，loadTree 无法从 temp 路径反推 box 解密
				if IsEncryptedBox(boxID) {
					raw, readErr := os.ReadFile(absPath)
					if readErr == nil {
						data := decryptRepoDataIfNeeded(raw, file.Path)
						if writeErr := os.WriteFile(absPath, data, 0644); writeErr != nil {
							logging.LogErrorf("decrypt conflicted file [%s] failed: %s", absPath, writeErr)
							continue
						}
					}
					// 解密后的冲突文件在函数返回时清理
					defer os.Remove(absPath)
				}
				tree, loadTreeErr := loadTree(absPath, luteEngine)
				if nil != loadTreeErr {
					logging.LogErrorf("load conflicted file [%s] failed: %s", absPath, loadTreeErr)
					continue
				}
				tree.Box = boxID
				tree.Path = strings.TrimPrefix(file.Path, "/"+boxID)

				previousPath := tree.Path
				resetTree(tree, "Conflicted", true)
				createTreeTx(tree)
				box := Conf.Box(boxID)
				if nil != box {
					box.addSort(previousPath, tree.ID)
				}
			}

			needReloadFiletree = true
		}

		historyDir := filepath.Join(util.HistoryDir, mergeResult.Time.Format("2006-01-02-150405")+"-sync")
		indexHistoryDir(filepath.Base(historyDir), luteEngine)
	}

	if 1 > len(mergeResult.Upserts) && 1 > len(mergeResult.Removes) && 1 > len(mergeResult.Conflicts) { // 没有数据变更
		syncSameCount.Add(1)
		if 10 < syncSameCount.Load() {
			syncSameCount.Store(5)
		}
		if !byHand {
			delay := time.Minute * time.Duration(int(math.Pow(2, float64(syncSameCount.Load()))))
			if fixSyncInterval.Minutes() > delay.Minutes() {
				delay = time.Minute * 8
			}
			planSyncAfter(delay)
		}
		return
	}

	// 有数据变更，需要重建索引
	var upserts, removes []string
	var upsertTrees int
	// 可能需要重新加载部分功能
	var needReloadFlashcard, needReloadOcrTexts, needReloadPlugin, needReloadSnippet bool
	reloadPluginSet := hashset.New()     // 插件代码变更 data/plugins/
	dataChangePluginSet := hashset.New() // 插件存储数据变更 data/storage/petal/
	needUnindexBoxes, needIndexBoxes := map[string]bool{}, map[string]bool{}
	needRestoreNotebookCrypto := false // 加密笔记本备份文件随同步到达，需恢复本机启用状态
	for _, file := range mergeResult.Upserts {
		upserts = append(upserts, file.Path)
		if strings.HasPrefix(file.Path, "/storage/riff/") {
			needReloadFlashcard = true
		}

		if strings.HasPrefix(file.Path, "/assets/ocr-texts.json") {
			needReloadOcrTexts = true
		}

		if strings.HasSuffix(file.Path, "/.siyuan/conf.json") {
			needReloadFiletree = true
			boxID := strings.TrimSuffix(strings.TrimPrefix(file.Path, "/"), "/.siyuan/conf.json")
			needUnindexBoxes[boxID] = true
			needIndexBoxes[boxID] = true
		}

		if file.Path == "/.siyuan/notebook-crypto-backup.json" {
			needRestoreNotebookCrypto = true
		}

		if strings.HasPrefix(file.Path, "/storage/petal/") {
			needReloadPlugin = true
			if parts := strings.Split(file.Path, "/"); 3 < len(parts) {
				if pluginName := parts[3]; "petals.json" != pluginName {
					dataChangePluginSet.Add(pluginName)
				}
			}
		}

		if strings.HasPrefix(file.Path, "/plugins/") {
			if parts := strings.Split(file.Path, "/"); 2 < len(parts) {
				needReloadPlugin = true
				reloadPluginSet.Add(parts[2])
			}
		}

		if strings.HasSuffix(file.Path, ".sy") {
			upsertTrees++
		}

		if util.IsMobileContainer() && strings.HasPrefix(file.Path, "/assets/") {
			absPath := filepath.Join(util.DataDir, file.Path)
			HandleAssetsChangeEvent(absPath)
		}

		if file.Path == "/snippets/conf.json" {
			needReloadSnippet = true
		}

		if strings.Contains(file.Path, "/storage/av/") && strings.HasSuffix(file.Path, ".json") {
			cache.RemoveAVData(strings.TrimSuffix(filepath.Base(file.Path), ".json"))
		}
	}

	// 加密笔记本备份文件随同步到达：若本机未启用，自动把配置装回 conf.json（不需主密码），
	// 让本机进入"已启用"状态，用户输主密码即可解锁。仅本机 Enabled=false 时生效，不覆盖已启用配置。
	if needRestoreNotebookCrypto {
		restoreNotebookCryptoConfigFromBackup()
	}

	removeWidgetDirSet, unloadPluginSet, uninstallPluginSet := hashset.New(), hashset.New(), hashset.New()
	for _, file := range mergeResult.Removes {
		removes = append(removes, file.Path)
		if strings.HasPrefix(file.Path, "/storage/riff/") {
			needReloadFlashcard = true
		}

		if strings.HasPrefix(file.Path, "/assets/ocr-texts.json") {
			needReloadOcrTexts = true
		}

		if strings.HasSuffix(file.Path, "/.siyuan/conf.json") {
			needReloadFiletree = true
			boxID := strings.TrimSuffix(strings.TrimPrefix(file.Path, "/"), "/.siyuan/conf.json")
			needUnindexBoxes[boxID] = true
		}

		if strings.HasPrefix(file.Path, "/storage/petal/") {
			needReloadPlugin = true
			if parts := strings.Split(file.Path, "/"); 3 < len(parts) {
				if pluginName := parts[3]; "petals.json" != pluginName {
					dataChangePluginSet.Add(pluginName)
				}
			}
		}

		if strings.HasPrefix(file.Path, "/plugins/") {
			if parts := strings.Split(file.Path, "/"); 2 < len(parts) {
				needReloadPlugin = true
				// 删除插件目录：卸载
				uninstallPluginSet.Add(parts[2])
			}
		}

		if strings.HasPrefix(file.Path, "/widgets/") {
			if parts := strings.Split(file.Path, "/"); 2 < len(parts) {
				removeWidgetDirSet.Add(parts[2])
			}
		}

		if util.IsMobileContainer() && strings.HasPrefix(file.Path, "/assets/") {
			absPath := filepath.Join(util.DataDir, file.Path)
			HandleAssetsRemoveEvent(absPath)
		}

		if file.Path == "/snippets/conf.json" {
			needReloadSnippet = true
		}

		if strings.Contains(file.Path, "/storage/av/") && strings.HasSuffix(file.Path, ".json") {
			cache.RemoveAVData(strings.TrimSuffix(filepath.Base(file.Path), ".json"))
		}
	}

	for _, upsertPetal := range mergeResult.UpsertPetals {
		needReloadPlugin = true
		reloadPluginSet.Add(upsertPetal)
	}
	for _, removePetal := range mergeResult.RemovePetals {
		needReloadPlugin = true
		// Petal 中删除插件：卸载
		uninstallPluginSet.Add(removePetal)
	}

	if needReloadFlashcard {
		LoadFlashcards()
	}

	if needReloadOcrTexts {
		util.LoadAssetsTexts()
	}

	if needReloadPlugin {
		PushReloadPlugin(uninstallPluginSet, unloadPluginSet, reloadPluginSet, dataChangePluginSet, "")
	}

	if needReloadSnippet {
		PushReloadSnippet(Conf.Snippet)
	}

	for _, widgetDir := range removeWidgetDirSet.Values() {
		widgetDirPath := filepath.Join(util.DataDir, "widgets", widgetDir.(string))
		gulu.File.RemoveEmptyDirs(widgetDirPath)
	}

	syncingFiles = sync.Map{}
	syncingStorages.Store(false)

	if needFullReindex(upsertTrees) { // 改进同步后全量重建索引判断 https://github.com/siyuan-note/siyuan/issues/5764
		FullReindex(false)
		return
	}

	if exit { // 退出时同步不用推送事件
		return
	}

	for boxID := range needUnindexBoxes {
		if box := Conf.GetBox(boxID); nil != box {
			box.Unindex()
		}
	}
	for boxID := range needIndexBoxes {
		if box := Conf.GetBox(boxID); nil != box {
			box.Index()
		}
	}

	needReloadUI := 0 < len(needUnindexBoxes) || 0 < len(needIndexBoxes)
	if needReloadUI {
		util.ReloadUI()
	}

	upsertRootIDs, removeRootIDs := incReindex(upserts, removes)
	needReloadFiletree = !needReloadUI && (needReloadFiletree || 0 < len(upsertRootIDs) || 0 < len(removeRootIDs))
	if needReloadFiletree {
		ReloadFiletree()
	}

	go func() {
		util.WaitForUILoaded()

		if 0 < len(upsertRootIDs) || 0 < len(removeRootIDs) {
			util.BroadcastByType("main", "syncMergeResult", 0, "",
				map[string]any{"upsertRootIDs": upsertRootIDs, "removeRootIDs": removeRootIDs})
		}

		time.Sleep(2 * time.Second)
		util.PushStatusBar(fmt.Sprintf(Conf.Language(149), elapsed.Seconds()))

		if 0 < len(mergeResult.Conflicts) {
			syConflict := false
			for _, file := range mergeResult.Conflicts {
				if strings.HasSuffix(file.Path, ".sy") {
					syConflict = true
					break
				}
			}

			if syConflict {
				// 数据同步发生冲突时在界面上进行提醒 https://github.com/siyuan-note/siyuan/issues/7332
				util.PushMsg(Conf.Language(108), 7000)
			}
		}
	}()
}

func logSyncMergeResult(mergeResult *dejavu.MergeResult) {
	if 1 > len(mergeResult.Conflicts) && 1 > len(mergeResult.Upserts) && 1 > len(mergeResult.Removes) {
		return
	}

	if 0 < len(mergeResult.Conflicts) {
		logBuilder := bytes.Buffer{}
		for i, f := range mergeResult.Conflicts {
			logBuilder.WriteString("  ")
			logBuilder.WriteString(f.Path)
			if i < len(mergeResult.Conflicts)-1 {
				logBuilder.WriteString("\n")
			}
		}
		logging.LogInfof("sync conflicts:\n%s", logBuilder.String())
	}
	if 0 < len(mergeResult.Upserts) {
		logBuilder := bytes.Buffer{}
		for i, f := range mergeResult.Upserts {
			logBuilder.WriteString("  ")
			logBuilder.WriteString(f.Path)
			if i < len(mergeResult.Upserts)-1 {
				logBuilder.WriteString("\n")
			}
		}
		logging.LogInfof("sync merge upserts:\n%s", logBuilder.String())
	}
	if 0 < len(mergeResult.Removes) {
		logBuilder := bytes.Buffer{}
		for i, f := range mergeResult.Removes {
			logBuilder.WriteString("  ")
			logBuilder.WriteString(f.Path)
			if i < len(mergeResult.Removes)-1 {
				logBuilder.WriteString("\n")
			}
		}
		logging.LogInfof("sync merge removes:\n%s", logBuilder.String())
	}
}

func needFullReindex(upsertTrees int) bool {
	return 0.2 < float64(upsertTrees)/float64(treenode.CountTrees())
}

var promotedPurgeDataRepo bool

func indexRepoBeforeCloudSync(repo *dejavu.Repo) (beforeIndex, afterIndex *entity.Index, err error) {
	start := time.Now()

	beforeIndex, _ = repo.Latest()
	FlushTxQueue()

	checkChunks := true
	if util.IsMobileContainer() {
		// 因为移动端私有数据空间不会存在外部操作导致分块损坏的情况，所以不需要检查分块以提升性能 https://github.com/siyuan-note/siyuan/issues/13216
		checkChunks = false
	}

	afterIndex, err = repo.Index("[Sync] Cloud sync", checkChunks,
		map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar})
	if err != nil {
		logging.LogErrorf("index data repo before cloud sync failed: %s", err)
		return
	}
	elapsed := time.Since(start)

	if nil == beforeIndex || beforeIndex.ID != afterIndex.ID {
		// 对新创建的快照需要更新备注，加入耗时统计
		afterIndex.Memo = fmt.Sprintf("[Sync] Cloud sync, completed in %.2fs", elapsed.Seconds())
		if err = repo.PutIndex(afterIndex); err != nil {
			util.PushStatusBar("Save data snapshot for cloud sync failed")
			logging.LogErrorf("put index into data repo before cloud sync failed: %s", err)
			return
		}
		util.PushStatusBar(fmt.Sprintf(Conf.Language(147), elapsed.Seconds()))
	} else {
		util.PushStatusBar(fmt.Sprintf(Conf.Language(148), elapsed.Seconds()))
	}

	if Conf.Repo.SyncIndexTiming < elapsed.Milliseconds() {
		logging.LogWarnf("index data repo before cloud sync elapsed [%dms]", elapsed.Milliseconds())
		if !promotedPurgeDataRepo {
			go func() {
				util.WaitForUILoaded()
				time.Sleep(3 * time.Second)

				if indexCount, _ := repo.CountIndexes(); 128 > indexCount {
					// 快照数量较少时不推送提示
					return
				}

				util.PushMsg(Conf.language(218), 24000)
				promotedPurgeDataRepo = true
			}()
		}
	}
	return
}

func newRepository() (ret *dejavu.Repo, err error) {
	cloudConf, err := buildCloudConf()
	if err != nil {
		return
	}

	var cloudRepo cloud.Cloud
	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		cloudRepo = cloud.NewSiYuan(&cloud.BaseCloud{Conf: cloudConf})
	case conf.ProviderS3:
		// 显式注入 SiYuan UA，覆盖 aws SDK 默认 UA（含架构、Go 版本、SDK 版本等冗余信息），便于 S3 服务端按 SiYuan/ 前缀识别加白名单
		s3HTTPClient := httpclient.NewUserAgentClient(httpclient.NewTransport(cloudConf.S3.SkipTlsVerify))
		s3HTTPClient.Timeout = time.Duration(cloudConf.S3.Timeout) * time.Second
		cloudRepo = cloud.NewS3(&cloud.BaseCloud{Conf: cloudConf}, s3HTTPClient)
	case conf.ProviderWebDAV:
		webdavClient := gowebdav.NewClient(cloudConf.WebDAV.Endpoint, cloudConf.WebDAV.Username, cloudConf.WebDAV.Password)
		a := cloudConf.WebDAV.Username + ":" + cloudConf.WebDAV.Password
		auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(a))
		webdavClient.SetHeader("Authorization", auth)
		webdavClient.SetHeader("User-Agent", util.UserAgent)
		webdavClient.SetTimeout(time.Duration(cloudConf.WebDAV.Timeout) * time.Second)
		webdavClient.SetTransport(httpclient.NewTransport(cloudConf.WebDAV.SkipTlsVerify))
		cloudRepo = cloud.NewWebDAV(&cloud.BaseCloud{Conf: cloudConf}, webdavClient)
	case conf.ProviderLocal:
		cloudRepo = cloud.NewLocal(&cloud.BaseCloud{Conf: cloudConf})
	default:
		err = fmt.Errorf("unknown cloud provider [%d]", Conf.Sync.Provider)
		return
	}

	ignoreLines := getSyncIgnoreLines()
	ignoreLines = append(ignoreLines, "/.siyuan/conf.json") // 忽略旧版同步配置
	ret, err = dejavu.NewRepo(util.DataDir, util.RepoDir, util.HistoryDir, util.TempDir, Conf.System.ID, Conf.System.Name, Conf.System.OS, Conf.Repo.Key, ignoreLines, cloudRepo)
	if err != nil {
		logging.LogErrorf("init data repo failed: %s", err)
		return
	}
	return
}

func init() {
	subscribeRepoEvents()
}

func subscribeRepoEvents() {
	eventbus.Subscribe(eventbus.EvtIndexBeforeWalkData, func(context map[string]any, path string) {
		msg := fmt.Sprintf(Conf.Language(158), path)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	indexWalkDataCount := 0
	eventbus.Subscribe(eventbus.EvtIndexWalkData, func(context map[string]any, path string) {
		msg := fmt.Sprintf(Conf.Language(158), filepath.Base(path))
		if 0 == indexWalkDataCount%1024 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
		indexWalkDataCount++
	})
	eventbus.Subscribe(eventbus.EvtIndexBeforeGetLatestFiles, func(context map[string]any, total int) {
		msg := fmt.Sprintf(Conf.Language(159), 0, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtIndexGetLatestFile, func(context map[string]any, count int, total int) {
		msg := fmt.Sprintf(Conf.Language(159), count, total)
		if 0 == count%64 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtIndexUpsertFiles, func(context map[string]any, total int) {
		msg := fmt.Sprintf(Conf.Language(160), 0, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtIndexUpsertFile, func(context map[string]any, count int, total int) {
		msg := fmt.Sprintf(Conf.Language(160), count, total)
		if 0 == count%32 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
	})

	eventbus.Subscribe(eventbus.EvtCheckoutBeforeWalkData, func(context map[string]any, path string) {
		msg := fmt.Sprintf(Conf.Language(161), path)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	coWalkDataCount := 0
	eventbus.Subscribe(eventbus.EvtCheckoutWalkData, func(context map[string]any, path string) {
		msg := fmt.Sprintf(Conf.Language(161), filepath.Base(path))
		if 0 == coWalkDataCount%512 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
		coWalkDataCount++
	})
	var bootProgressPart int32
	eventbus.Subscribe(eventbus.EvtCheckoutUpsertFiles, func(context map[string]any, total int) {
		msg := fmt.Sprintf(Conf.Language(162), 0, total)
		util.SetBootDetails(msg)
		bootProgressPart = int32(10 / float64(total))
		util.ContextPushMsg(context, msg)
	})
	coUpsertFileCount := 0
	eventbus.Subscribe(eventbus.EvtCheckoutUpsertFile, func(context map[string]any, count, total int) {
		msg := fmt.Sprintf(Conf.Language(162), count, total)
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == coUpsertFileCount%32 {
			util.ContextPushMsg(context, msg)
		}
		coUpsertFileCount++
	})
	eventbus.Subscribe(eventbus.EvtCheckoutRemoveFiles, func(context map[string]any, total int) {
		msg := fmt.Sprintf(Conf.Language(163), 0, total)
		util.SetBootDetails(msg)
		bootProgressPart = int32(10 / float64(total))
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtCheckoutRemoveFile, func(context map[string]any, count, total int) {
		msg := fmt.Sprintf(Conf.Language(163), count, total)
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == count%64 {
			util.ContextPushMsg(context, msg)
		}
	})

	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadIndex, func(context map[string]any, id string) {
		msg := fmt.Sprintf(Conf.Language(164), id[:7])
		util.IncBootProgress(1, msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadFiles, func(context map[string]any, total int) {
		msg := fmt.Sprintf(Conf.Language(165), 0, total)
		util.SetBootDetails(msg)
		bootProgressPart = int32(10 / float64(total))
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadFile, func(context map[string]any, count, total int) {
		msg := fmt.Sprintf(Conf.Language(165), count, total)
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == count%8 {
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadChunks, func(context map[string]any, total int) {
		msg := fmt.Sprintf(Conf.Language(166), 0, total)
		util.SetBootDetails(msg)
		bootProgressPart = int32(10 / float64(total))
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadChunk, func(context map[string]any, count, total int) {
		msg := fmt.Sprintf(Conf.Language(166), count, total)
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == count%8 {
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadRef, func(context map[string]any, ref string) {
		msg := fmt.Sprintf(Conf.Language(167), ref)
		util.IncBootProgress(1, msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadIndex, func(context map[string]any, id string) {
		msg := fmt.Sprintf(Conf.Language(168), id[:7])
		util.IncBootProgress(1, msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadFiles, func(context map[string]any, total int) {
		msg := fmt.Sprintf(Conf.Language(169), 0, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadFile, func(context map[string]any, count, total int) {
		msg := fmt.Sprintf(Conf.Language(169), count, total)
		if 0 == count%8 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadChunks, func(context map[string]any, total int) {
		msg := fmt.Sprintf(Conf.Language(170), 0, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadChunk, func(context map[string]any, count, total int) {
		msg := fmt.Sprintf(Conf.Language(170), count, total)
		if 0 == count%8 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadRef, func(context map[string]any, ref string) {
		msg := fmt.Sprintf(Conf.Language(171), ref)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudLock, func(context map[string]any) {
		msg := Conf.Language(186)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudUnlock, func(context map[string]any) {
		msg := Conf.Language(187)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadIndexes, func(context map[string]any) {
		msg := Conf.Language(208)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadCheckIndex, func(context map[string]any) {
		msg := Conf.Language(209)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeFixObjects, func(context map[string]any, count, total int) {
		msg := fmt.Sprintf(Conf.Language(210), count, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudAfterFixObjects, func(context map[string]any) {
		msg := Conf.Language(211)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudCorrupted, func() {
		util.PushErrMsg(Conf.language(220), 30000)
	})
	eventbus.Subscribe(eventbus.EvtCloudPurgeListObjects, func(context map[string]any) {
		util.ContextPushMsg(context, Conf.language(224))
	})
	eventbus.Subscribe(eventbus.EvtCloudPurgeListIndexes, func(context map[string]any) {
		util.ContextPushMsg(context, Conf.language(225))
	})
	eventbus.Subscribe(eventbus.EvtCloudPurgeListRefs, func(context map[string]any) {
		util.ContextPushMsg(context, Conf.language(226))
	})
	eventbus.Subscribe(eventbus.EvtCloudPurgeDownloadIndexes, func(context map[string]any) {
		util.ContextPushMsg(context, Conf.language(227))
	})
	eventbus.Subscribe(eventbus.EvtCloudPurgeDownloadFiles, func(context map[string]any) {
		util.ContextPushMsg(context, Conf.language(228))
	})
	eventbus.Subscribe(eventbus.EvtCloudPurgeRemoveIndexes, func(context map[string]any) {
		util.ContextPushMsg(context, Conf.language(229))
	})
	eventbus.Subscribe(eventbus.EvtCloudPurgeRemoveIndexesV2, func(context map[string]any) {
		util.ContextPushMsg(context, Conf.language(230))
	})
	eventbus.Subscribe(eventbus.EvtCloudPurgeRemoveObjects, func(context map[string]any) {
		util.ContextPushMsg(context, Conf.language(231))
	})
}

func buildCloudConf() (ret *cloud.Conf, err error) {
	if !cloud.IsValidCloudDirName(Conf.Sync.CloudName) {
		logging.LogWarnf("invalid cloud repo name, rename it to [main]")
		Conf.Sync.CloudName = "main"
		Conf.Save()
	}

	userId, token, availableSize := "0", "", int64(1024*1024*1024*1024*2)
	if nil != Conf.User && conf.ProviderSiYuan == Conf.Sync.Provider {
		u := Conf.GetUser()
		userId = u.UserId
		token = u.UserToken
		availableSize = u.GetCloudRepoAvailableSize()
	}

	ret = &cloud.Conf{
		Dir:           Conf.Sync.CloudName,
		UserID:        userId,
		Token:         token,
		AvailableSize: availableSize,
		Server:        util.GetCloudServer(),
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		ret.Endpoint = util.GetCloudSyncServer()
	case conf.ProviderS3:
		ret.S3 = &cloud.ConfS3{
			Endpoint:       Conf.Sync.S3.Endpoint,
			AccessKey:      Conf.Sync.S3.AccessKey,
			SecretKey:      Conf.Sync.S3.SecretKey,
			Bucket:         Conf.Sync.S3.Bucket,
			Region:         Conf.Sync.S3.Region,
			PathStyle:      Conf.Sync.S3.PathStyle,
			SkipTlsVerify:  Conf.Sync.S3.SkipTlsVerify,
			Timeout:        Conf.Sync.S3.Timeout,
			ConcurrentReqs: Conf.Sync.S3.ConcurrentReqs,
		}
	case conf.ProviderWebDAV:
		ret.WebDAV = &cloud.ConfWebDAV{
			Endpoint:       Conf.Sync.WebDAV.Endpoint,
			Username:       Conf.Sync.WebDAV.Username,
			Password:       Conf.Sync.WebDAV.Password,
			SkipTlsVerify:  Conf.Sync.WebDAV.SkipTlsVerify,
			Timeout:        Conf.Sync.WebDAV.Timeout,
			ConcurrentReqs: Conf.Sync.WebDAV.ConcurrentReqs,
		}
	case conf.ProviderLocal:
		ret.Local = &cloud.ConfLocal{
			Endpoint:       Conf.Sync.Local.Endpoint,
			Timeout:        Conf.Sync.Local.Timeout,
			ConcurrentReqs: Conf.Sync.Local.ConcurrentReqs,
		}
	default:
		err = fmt.Errorf("invalid provider [%d]", Conf.Sync.Provider)
		return
	}
	return
}

type Backup struct {
	Size    int64  `json:"size"`
	HSize   string `json:"hSize"`
	Updated string `json:"updated"`
	SaveDir string `json:"saveDir"` // 本地备份数据存放目录路径
}

type Sync struct {
	Size      int64  `json:"size"`
	HSize     string `json:"hSize"`
	Updated   string `json:"updated"`
	CloudName string `json:"cloudName"` // 云端同步数据存放目录名
	SaveDir   string `json:"saveDir"`   // 本地同步数据存放目录路径
}

func GetCloudSpace() (s *Sync, b *Backup, hSize, hAssetSize, hTotalSize, hExchangeSize, hTrafficUploadSize, hTrafficDownloadSize, hTrafficAPIGet, hTrafficAPIPut string, err error) {
	stat, err := getCloudSpace()
	if err != nil {
		err = errors.New(Conf.Language(30) + " " + err.Error())
		return
	}

	syncSize := stat.Sync.Size
	syncUpdated := stat.Sync.Updated
	s = &Sync{
		Size:    syncSize,
		HSize:   "-",
		Updated: syncUpdated,
	}

	backupSize := stat.Backup.Size
	backupUpdated := stat.Backup.Updated
	b = &Backup{
		Size:    backupSize,
		HSize:   "-",
		Updated: backupUpdated,
	}

	assetSize := stat.AssetSize
	totalSize := syncSize + backupSize + assetSize
	hAssetSize = "-"
	hSize = "-"
	hTotalSize = "-"
	hExchangeSize = "-"
	hTrafficUploadSize = "-"
	hTrafficDownloadSize = "-"
	hTrafficAPIGet = "-"
	hTrafficAPIPut = "-"
	if conf.ProviderSiYuan == Conf.Sync.Provider {
		s.HSize = humanize.BytesCustomCeil(uint64(syncSize), 2)
		b.HSize = humanize.BytesCustomCeil(uint64(backupSize), 2)
		hAssetSize = humanize.BytesCustomCeil(uint64(assetSize), 2)
		hSize = humanize.BytesCustomCeil(uint64(totalSize), 2)
		if u := Conf.GetUser(); nil != u {
			hTotalSize = humanize.BytesCustomCeil(uint64(u.UserSiYuanRepoSize), 2)
			hExchangeSize = humanize.BytesCustomCeil(uint64(u.UserSiYuanPointExchangeRepoSize), 2)
			hTrafficUploadSize = humanize.BytesCustomCeil(uint64(u.UserTrafficUpload), 2)
			hTrafficDownloadSize = humanize.BytesCustomCeil(uint64(u.UserTrafficDownload), 2)
			hTrafficAPIGet = humanize.SIWithDigits(u.UserTrafficAPIGet, 2, "")
			hTrafficAPIPut = humanize.SIWithDigits(u.UserTrafficAPIPut, 2, "")
		}
	}
	return
}

func getCloudSpace() (stat *cloud.Stat, err error) {
	repo, err := newRepository()
	if err != nil {
		return
	}

	stat, err = repo.GetCloudRepoStat()
	if err != nil {
		logging.LogErrorf("get cloud repo stat failed: %s", err)
		return
	}
	return
}
