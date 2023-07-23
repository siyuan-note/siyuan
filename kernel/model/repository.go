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
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/dustin/go-humanize"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/encryption"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/studio-b12/gowebdav"
)

func init() {
	subscribeRepoEvents()
}

type Snapshot struct {
	*dejavu.Log
	TypesCount []*TypeCount `json:"typesCount"`
}

type TypeCount struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}

func OpenRepoSnapshotDoc(fileID string) (content string, isProtyleDoc bool, updated int64, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	file, err := repo.GetFile(fileID)
	if nil != err {
		return
	}

	data, err := repo.OpenFile(file)
	if nil != err {
		return
	}

	updated = file.Updated

	if strings.HasSuffix(file.Path, ".sy") {
		luteEngine := NewLute()
		var snapshotTree *parse.Tree
		isProtyleDoc, snapshotTree, err = parseTreeInSnapshot(data, luteEngine)
		if nil != err {
			logging.LogErrorf("parse tree from snapshot file [%s] failed", fileID)
			return
		}

		if !isProtyleDoc {
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
		if isProtyleDoc {
			util.PushMsg(Conf.Language(36), 5000)
			formatRenderer := render.NewFormatRenderer(snapshotTree, luteEngine.RenderOptions)
			content = gulu.Str.FromBytes(formatRenderer.Render())
		} else {
			content = luteEngine.Tree2BlockDOM(snapshotTree, luteEngine.RenderOptions)
		}
	} else {
		isProtyleDoc = true
		if strings.HasSuffix(file.Path, ".json") {
			content = gulu.Str.FromBytes(data)
		} else {
			if strings.Contains(file.Path, "assets/") { // 剔除笔记本级或者文档级资源文件路径前缀
				file.Path = file.Path[strings.Index(file.Path, "assets/"):]
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
	Title   string `json:"title"`
	Path    string `json:"path"`
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
	if nil != err {
		return
	}

	diff, err := repo.DiffIndex(left, right)
	if nil != err {
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
		title, parseErr := parseTitleInSnapshot(removeRight.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			continue
		}

		ret.AddsLeft = append(ret.AddsLeft, &DiffFile{
			FileID:  removeRight.ID,
			Title:   title,
			Path:    removeRight.Path,
			HSize:   humanize.Bytes(uint64(removeRight.Size)),
			Updated: removeRight.Updated,
		})
	}
	if 1 > len(ret.AddsLeft) {
		ret.AddsLeft = []*DiffFile{}
	}

	for _, addLeft := range diff.AddsLeft {
		title, parseErr := parseTitleInSnapshot(addLeft.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			continue
		}

		ret.RemovesRight = append(ret.RemovesRight, &DiffFile{
			FileID:  addLeft.ID,
			Title:   title,
			Path:    addLeft.Path,
			HSize:   humanize.Bytes(uint64(addLeft.Size)),
			Updated: addLeft.Updated,
		})
	}
	if 1 > len(ret.RemovesRight) {
		ret.RemovesRight = []*DiffFile{}
	}

	for _, updateLeft := range diff.UpdatesLeft {
		title, parseErr := parseTitleInSnapshot(updateLeft.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			continue
		}

		ret.UpdatesLeft = append(ret.UpdatesLeft, &DiffFile{
			FileID:  updateLeft.ID,
			Title:   title,
			Path:    updateLeft.Path,
			HSize:   humanize.Bytes(uint64(updateLeft.Size)),
			Updated: updateLeft.Updated,
		})
	}
	if 1 > len(ret.UpdatesLeft) {
		ret.UpdatesLeft = []*DiffFile{}
	}

	for _, updateRight := range diff.UpdatesRight {
		title, parseErr := parseTitleInSnapshot(updateRight.ID, repo, luteEngine)
		if "" == title || nil != parseErr {
			continue
		}

		ret.UpdatesRight = append(ret.UpdatesRight, &DiffFile{
			FileID:  updateRight.ID,
			Title:   title,
			Path:    updateRight.Path,
			HSize:   humanize.Bytes(uint64(updateRight.Size)),
			Updated: updateRight.Updated,
		})
	}
	if 1 > len(ret.UpdatesRight) {
		ret.UpdatesRight = []*DiffFile{}
	}
	return
}

func parseTitleInSnapshot(fileID string, repo *dejavu.Repo, luteEngine *lute.Lute) (title string, err error) {
	file, err := repo.GetFile(fileID)
	if nil != err {
		logging.LogErrorf("get file [%s] failed: %s", fileID, err)
		return
	}

	title = path.Base(file.Path)
	if strings.HasSuffix(file.Path, ".sy") {
		var data []byte
		data, err = repo.OpenFile(file)
		if nil != err {
			logging.LogErrorf("open file [%s] failed: %s", fileID, err)
			return
		}

		var tree *parse.Tree
		tree, err = filesys.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
		if nil != err {
			logging.LogErrorf("parse file [%s] failed: %s", fileID, err)
			return
		}

		title = tree.Root.IALAttr("title")
	}
	return
}

func parseTreeInSnapshot(data []byte, luteEngine *lute.Lute) (isProtyleDoc bool, tree *parse.Tree, err error) {
	isProtyleDoc = 1024*1024*1 <= len(data)
	tree, err = filesys.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	if nil != err {
		return
	}
	return
}

func GetRepoSnapshots(page int) (ret []*Snapshot, pageCount, totalCount int, err error) {
	ret = []*Snapshot{}
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	logs, pageCount, totalCount, err := repo.GetIndexLogs(page, 32)
	if nil != err {
		if dejavu.ErrNotFoundIndex == err {
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
		ext := path.Ext(f.Path)
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

func ImportRepoKey(base64Key string) (err error) {
	util.PushMsg(Conf.Language(136), 3000)

	base64Key = strings.TrimSpace(base64Key)
	base64Key = gulu.Str.RemoveInvisible(base64Key)
	if 1 > len(base64Key) {
		err = errors.New(Conf.Language(142))
		return
	}

	key, err := base64.StdEncoding.DecodeString(base64Key)
	if nil != err {
		logging.LogErrorf("import data repo key failed: %s", err)
		return errors.New(Conf.Language(157))
	}
	if 32 != len(key) {
		return errors.New(Conf.Language(157))
	}

	Conf.Repo.Key = key
	Conf.Save()

	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); nil != err {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); nil != err {
		return
	}

	initDataRepo()
	return
}

func ResetRepo() (err error) {
	msgId := util.PushMsg(Conf.Language(144), 1000*60)

	repo, err := newRepository()
	if nil != err {
		return
	}

	if err = repo.Reset(); nil != err {
		return
	}

	Conf.Repo.Key = nil
	Conf.Sync.Enabled = false
	Conf.Save()

	util.PushUpdateMsg(msgId, Conf.Language(145), 3000)
	go func() {
		time.Sleep(2 * time.Second)
		util.ReloadUI()
	}()
	return
}

func PurgeRepo() (err error) {
	msg := Conf.Language(202)
	util.PushEndlessProgress(msg)
	defer util.PushClearProgress()

	repo, err := newRepository()
	if nil != err {
		return
	}

	stat, err := repo.Purge()
	if nil != err {
		return
	}

	deletedIndexes := stat.Indexes
	deletedObjects := stat.Objects
	deletedSize := humanize.Bytes(uint64(stat.Size))
	msg = fmt.Sprintf(Conf.Language(203), deletedIndexes, deletedObjects, deletedSize)
	util.PushMsg(msg, 5000)
	return
}

func InitRepoKeyFromPassphrase(passphrase string) (err error) {
	passphrase = gulu.Str.RemoveInvisible(passphrase)
	passphrase = strings.TrimSpace(passphrase)
	if "" == passphrase {
		return errors.New(Conf.Language(142))
	}

	util.PushMsg(Conf.Language(136), 3000)
	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); nil != err {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); nil != err {
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
		if nil != err {
			logging.LogErrorf("init data repo key failed: %s", err)
			return
		}
	}

	Conf.Repo.Key = key
	Conf.Save()

	initDataRepo()
	return
}

func InitRepoKey() (err error) {
	util.PushMsg(Conf.Language(136), 3000)

	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); nil != err {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); nil != err {
		return
	}

	randomBytes := make([]byte, 16)
	_, err = rand.Read(randomBytes)
	if nil != err {
		return
	}
	password := string(randomBytes)
	randomBytes = make([]byte, 16)
	_, err = rand.Read(randomBytes)
	if nil != err {
		logging.LogErrorf("init data repo key failed: %s", err)
		return
	}
	salt := string(randomBytes)

	key, err := encryption.KDF(password, salt)
	if nil != err {
		logging.LogErrorf("init data repo key failed: %s", err)
		return
	}
	Conf.Repo.Key = key
	Conf.Save()

	initDataRepo()
	return
}

func initDataRepo() {
	time.Sleep(1 * time.Second)
	util.PushMsg(Conf.Language(138), 3000)
	time.Sleep(1 * time.Second)
	if initErr := IndexRepo("[Init] Init local data repo"); nil != initErr {
		util.PushErrMsg(fmt.Sprintf(Conf.Language(140), initErr), 0)
	}
}

func CheckoutRepo(id string) {
	task.AppendTask(task.RepoCheckout, checkoutRepo, id)
}

func checkoutRepo(id string) {
	var err error
	if 1 > len(Conf.Repo.Key) {
		util.PushErrMsg(Conf.Language(26), 7000)
		return
	}

	repo, err := newRepository()
	if nil != err {
		logging.LogErrorf("new repository failed: %s", err)
		util.PushErrMsg(Conf.Language(141), 7000)
		return
	}

	util.PushEndlessProgress(Conf.Language(63))
	WaitForWritingFiles()
	CloseWatchAssets()
	defer WatchAssets()

	// 恢复快照时自动暂停同步，避免刚刚恢复后的数据又被同步覆盖
	syncEnabled := Conf.Sync.Enabled
	Conf.Sync.Enabled = false
	Conf.Save()

	_, _, err = repo.Checkout(id, map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	if nil != err {
		logging.LogErrorf("checkout repository failed: %s", err)
		util.PushClearProgress()
		util.PushErrMsg(Conf.Language(141), 7000)
		return
	}

	task.AppendTask(task.DatabaseIndexFull, fullReindex)
	task.AppendTask(task.DatabaseIndexRef, IndexRefs)
	task.AppendTask(task.ReloadUI, util.ReloadUIResetScroll)

	if syncEnabled {
		func() {
			time.Sleep(5 * time.Second)
			util.PushMsg(Conf.Language(134), 0)
		}()
	}
	return
}

func DownloadCloudSnapshot(tag, id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3:
		if !IsThirdPartySyncPaid() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	defer util.PushClearProgress()

	var downloadFileCount, downloadChunkCount int
	var downloadBytes int64
	if "" == tag {
		downloadFileCount, downloadChunkCount, downloadBytes, err = repo.DownloadIndex(id, map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	} else {
		downloadFileCount, downloadChunkCount, downloadBytes, err = repo.DownloadTagIndex(tag, id, map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	}
	if nil != err {
		return
	}
	msg := fmt.Sprintf(Conf.Language(153), downloadFileCount, downloadChunkCount, humanize.Bytes(uint64(downloadBytes)))
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
	if nil != err {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3:
		if !IsThirdPartySyncPaid() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	util.PushEndlessProgress(Conf.Language(116))
	defer util.PushClearProgress()
	uploadFileCount, uploadChunkCount, uploadBytes, err := repo.UploadTagIndex(tag, id, map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress})
	if nil != err {
		if errors.Is(err, dejavu.ErrCloudBackupCountExceeded) {
			err = fmt.Errorf(Conf.Language(84), Conf.Language(154))
			return
		}
		err = errors.New(fmt.Sprintf(Conf.Language(84), formatRepoErrorMsg(err)))
		return
	}
	msg := fmt.Sprintf(Conf.Language(152), uploadFileCount, uploadChunkCount, humanize.Bytes(uint64(uploadBytes)))
	util.PushMsg(msg, 5000)
	util.PushStatusBar(msg)
	return
}

func RemoveCloudRepoTag(tag string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	if "" == tag {
		err = errors.New("tag is empty")
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3:
		if !IsThirdPartySyncPaid() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	err = repo.RemoveCloudRepoTag(tag)
	if nil != err {
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
	if nil != err {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3:
		if !IsThirdPartySyncPaid() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	logs, err := repo.GetCloudRepoTagLogs(map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar})
	if nil != err {
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
	if nil != err {
		return
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			util.PushErrMsg(Conf.Language(29), 5000)
			return
		}
	case conf.ProviderWebDAV, conf.ProviderS3:
		if !IsThirdPartySyncPaid() {
			util.PushErrMsg(Conf.Language(214), 5000)
			return
		}
	}

	if 1 > page {
		page = 1
	}

	logs, pageCount, totalCount, err := repo.GetCloudRepoLogs(page)
	if nil != err {
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
	if nil != err {
		return
	}

	logs, err := repo.GetTagLogs()
	if nil != err {
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
	if nil != err {
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

	name = strings.TrimSpace(name)
	name = gulu.Str.RemoveInvisible(name)
	if "" == name {
		err = errors.New(Conf.Language(142))
		return
	}

	if !gulu.File.IsValidFilename(name) {
		err = errors.New(Conf.Language(151))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	index, err := repo.GetIndex(id)
	if nil != err {
		return
	}

	if err = repo.AddTag(index.ID, name); nil != err {
		msg := fmt.Sprintf("Add tag to data snapshot [%s] failed: %s", index.ID, err)
		util.PushStatusBar(msg)
		return
	}
	return
}

func IndexRepo(memo string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	memo = strings.TrimSpace(memo)
	memo = gulu.Str.RemoveInvisible(memo)
	if "" == memo {
		err = errors.New(Conf.Language(142))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	util.PushEndlessProgress(Conf.Language(143))

	start := time.Now()
	latest, _ := repo.Latest()
	WaitForWritingFiles()
	index, err := repo.Index(memo, map[string]interface{}{
		eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBarAndProgress,
	})
	if nil != err {
		util.PushStatusBar("Index data repo failed: " + html.EscapeString(err.Error()))
		return
	}
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
var syncingStorages = false

func waitForSyncingStorages() {
	for syncingStorages {
		time.Sleep(time.Second)
	}
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
	if nil != err {
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", err)
		logging.LogErrorf(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	start := time.Now()
	err = indexRepoBeforeCloudSync(repo)
	if nil != err {
		planSyncAfter(fixSyncInterval)
		return
	}

	syncContext := map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	mergeResult, trafficStat, err := repo.SyncDownload(syncContext)
	if errors.Is(err, dejavu.ErrRepoFatalErr) {
		// 重置仓库并再次尝试同步
		if _, resetErr := resetRepository(repo); nil == resetErr {
			mergeResult, trafficStat, err = repo.SyncDownload(syncContext)
		}
	}
	elapsed := time.Since(start)
	if nil != err {
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo download failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			msg = fmt.Sprintf(Conf.Language(43), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
			if 2 == Conf.User.UserSiYuanSubscriptionPlan {
				msg = fmt.Sprintf(Conf.Language(68), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
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
	msg := fmt.Sprintf(Conf.Language(150), trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.Bytes(uint64(trafficStat.UploadBytes)), humanize.Bytes(uint64(trafficStat.DownloadBytes)))
	Conf.Sync.Stat = msg
	Conf.Save()
	autoSyncErrCount = 0
	BootSyncSucc = 0

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
	if nil != err {
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", err)
		logging.LogErrorf(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	start := time.Now()
	err = indexRepoBeforeCloudSync(repo)
	if nil != err {
		planSyncAfter(fixSyncInterval)
		return
	}

	syncContext := map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	trafficStat, err := repo.SyncUpload(syncContext)
	if errors.Is(err, dejavu.ErrRepoFatalErr) {
		// 重置仓库并再次尝试同步
		if _, resetErr := resetRepository(repo); nil == resetErr {
			trafficStat, err = repo.SyncUpload(syncContext)
		}
	}
	elapsed := time.Since(start)
	if nil != err {
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo upload failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			msg = fmt.Sprintf(Conf.Language(43), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
			if 2 == Conf.User.UserSiYuanSubscriptionPlan {
				msg = fmt.Sprintf(Conf.Language(68), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
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
	msg := fmt.Sprintf(Conf.Language(150), trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.Bytes(uint64(trafficStat.UploadBytes)), humanize.Bytes(uint64(trafficStat.DownloadBytes)))
	Conf.Sync.Stat = msg
	Conf.Save()
	autoSyncErrCount = 0
	BootSyncSucc = 0

	processSyncMergeResult(false, true, &dejavu.MergeResult{}, trafficStat, "u", elapsed)
	return
}

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
	if nil != err {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", html.EscapeString(err.Error()))
		logging.LogErrorf(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	start := time.Now()
	err = indexRepoBeforeCloudSync(repo)
	if nil != err {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)
		return
	}

	syncContext := map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	fetchedFiles, err := repo.GetSyncCloudFiles(syncContext)
	if errors.Is(err, dejavu.ErrRepoFatalErr) {
		// 重置仓库并再次尝试同步
		if _, resetErr := resetRepository(repo); nil == resetErr {
			fetchedFiles, err = repo.GetSyncCloudFiles(syncContext)
		}
	}

	syncingFiles = sync.Map{}
	syncingStorages = false
	for _, fetchedFile := range fetchedFiles {
		name := path.Base(fetchedFile.Path)
		if strings.HasSuffix(name, ".sy") {
			id := name[:len(name)-3]
			syncingFiles.Store(id, true)
			continue
		}
		if strings.HasPrefix(fetchedFile.Path, "/storage/") {
			syncingStorages = true
		}
	}

	elapsed := time.Since(start)
	logging.LogInfof("boot get sync cloud files elapsed [%.2fs]", elapsed.Seconds())
	if nil != err {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			msg = fmt.Sprintf(Conf.Language(43), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
			if 2 == Conf.User.UserSiYuanSubscriptionPlan {
				msg = fmt.Sprintf(Conf.Language(68), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
			}
		}
		Conf.Sync.Stat = msg
		Conf.Save()
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		BootSyncSucc = 1
		return
	}

	if 0 < len(fetchedFiles) {
		go func() {
			_, syncErr := syncRepo(false, false)
			if nil != err {
				logging.LogErrorf("boot background sync repo failed: %s", syncErr)
				return
			}
		}()
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
	if nil != err {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", err)
		logging.LogErrorf(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	latest, _ := repo.Latest()
	start := time.Now()
	err = indexRepoBeforeCloudSync(repo)
	if nil != err {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)
		return
	}

	syncContext := map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	mergeResult, trafficStat, err := repo.Sync(syncContext)
	if errors.Is(err, dejavu.ErrRepoFatalErr) {
		// 重置仓库并再次尝试同步
		if _, resetErr := resetRepository(repo); nil == resetErr {
			mergeResult, trafficStat, err = repo.Sync(syncContext)
		}
	}
	elapsed := time.Since(start)
	if nil != err {
		autoSyncErrCount++
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			msg = fmt.Sprintf(Conf.Language(43), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
			if 2 == Conf.User.UserSiYuanSubscriptionPlan {
				msg = fmt.Sprintf(Conf.Language(68), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
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

	syncedLatest, _ := repo.Latest()
	dataChanged = nil == latest || latest.ID != syncedLatest.ID

	util.PushStatusBar(fmt.Sprintf(Conf.Language(149), elapsed.Seconds()))
	Conf.Sync.Synced = util.CurrentTimeMillis()
	msg := fmt.Sprintf(Conf.Language(150), trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.Bytes(uint64(trafficStat.UploadBytes)), humanize.Bytes(uint64(trafficStat.DownloadBytes)))
	Conf.Sync.Stat = msg
	Conf.Save()
	autoSyncErrCount = 0

	processSyncMergeResult(exit, byHand, mergeResult, trafficStat, "a", elapsed)
	return
}

func processSyncMergeResult(exit, byHand bool, mergeResult *dejavu.MergeResult, trafficStat *dejavu.TrafficStat, mode string, elapsed time.Duration) {
	logging.LogInfof("synced data repo [kernel=%s, provider=%d, mode=%s/%t, ufc=%d, dfc=%d, ucc=%d, dcc=%d, ub=%s, db=%s] in [%.2fs], merge result [conflicts=%d, upserts=%d, removes=%d]",
		KernelID, Conf.Sync.Provider, mode, byHand,
		trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.Bytes(uint64(trafficStat.UploadBytes)), humanize.Bytes(uint64(trafficStat.DownloadBytes)),
		elapsed.Seconds(),
		len(mergeResult.Conflicts), len(mergeResult.Upserts), len(mergeResult.Removes))

	//logSyncMergeResult(mergeResult)

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
				tree, loadTreeErr := loadTree(absPath, luteEngine)
				if nil != loadTreeErr {
					logging.LogErrorf("load conflicted file [%s] failed: %s", absPath, loadTreeErr)
					continue
				}
				tree.Box = boxID
				tree.Path = strings.TrimPrefix(file.Path, "/"+boxID)

				resetTree(tree, "Conflicted")
				createTreeTx(tree)
			}
		}

		historyDir := filepath.Join(util.HistoryDir, mergeResult.Time.Format("2006-01-02-150405")+"-sync")
		indexHistoryDir(filepath.Base(historyDir), luteEngine)
	}

	if 1 > len(mergeResult.Upserts) && 1 > len(mergeResult.Removes) && 1 > len(mergeResult.Conflicts) { // 没有数据变更
		syncSameCount++
		if 10 < syncSameCount {
			syncSameCount = 5
		}
		if !byHand {
			delay := time.Minute * time.Duration(int(math.Pow(2, float64(syncSameCount))))
			if fixSyncInterval.Minutes() > delay.Minutes() {
				delay = time.Minute * 8
			}
			planSyncAfter(delay)
		}
		util.PushClearProgress()
		return
	}

	// 有数据变更，需要重建索引
	var upserts, removes []string
	var upsertTrees int
	var needReloadFlashcard, needReloadOcrTexts, needReloadFiletree bool
	for _, file := range mergeResult.Upserts {
		upserts = append(upserts, file.Path)
		if strings.HasPrefix(file.Path, "/storage/riff/") {
			needReloadFlashcard = true
		}

		if strings.HasPrefix(file.Path, "/data/assets/ocr-texts.json") {
			needReloadOcrTexts = true
		}

		if strings.HasSuffix(file.Path, "/.siyuan/conf.json") {
			needReloadFiletree = true
		}

		if strings.HasSuffix(file.Path, ".sy") {
			upsertTrees++
		}
	}
	for _, file := range mergeResult.Removes {
		removes = append(removes, file.Path)
		if strings.HasPrefix(file.Path, "/storage/riff/") {
			needReloadFlashcard = true
		}

		if strings.HasPrefix(file.Path, "/data/assets/ocr-texts.json") {
			needReloadOcrTexts = true
		}

		if strings.HasSuffix(file.Path, "/.siyuan/conf.json") {
			needReloadFiletree = true
		}
	}

	if needReloadFlashcard {
		LoadFlashcards()
	}

	if needReloadOcrTexts {
		LoadAssetsTexts()
	}

	syncingFiles = sync.Map{}
	syncingStorages = false

	cache.ClearDocsIAL()              // 同步后文档树文档图标没有更新 https://github.com/siyuan-note/siyuan/issues/4939
	if needFullReindex(upsertTrees) { // 改进同步后全量重建索引判断 https://github.com/siyuan-note/siyuan/issues/5764
		FullReindex()
		return
	}

	if needReloadFiletree {
		util.BroadcastByType("filetree", "reloadFiletree", 0, "", nil)
	}

	if exit { // 退出时同步不用推送事件
		return
	}

	upsertRootIDs, removeRootIDs := incReindex(upserts, removes)
	go func() {
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
			// 移动端不推送差异详情
			upsertRootIDs = []string{}
		}

		util.WaitForUILoaded()
		util.BroadcastByType("main", "syncMergeResult", 0, "",
			map[string]interface{}{"upsertRootIDs": upsertRootIDs, "removeRootIDs": removeRootIDs})

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

func indexRepoBeforeCloudSync(repo *dejavu.Repo) (err error) {
	start := time.Now()
	latest, _ := repo.Latest()
	index, err := repo.Index("[Sync] Cloud sync", map[string]interface{}{
		eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar,
	})
	if errors.Is(err, dejavu.ErrNotFoundObject) {
		var resetErr error
		index, resetErr = resetRepository(repo)
		if nil != resetErr {
			return
		}
		err = nil
	}

	if nil != err {
		msg := fmt.Sprintf(Conf.Language(140), formatRepoErrorMsg(err))
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 12000)
		logging.LogErrorf("index data repo before cloud sync failed: %s", err)
		return
	}
	elapsed := time.Since(start)

	if nil == latest || latest.ID != index.ID {
		// 对新创建的快照需要更新备注，加入耗时统计
		index.Memo = fmt.Sprintf("[Sync] Cloud sync, completed in %.2fs", elapsed.Seconds())
		if err = repo.PutIndex(index); nil != err {
			util.PushStatusBar("Save data snapshot for cloud sync failed")
			logging.LogErrorf("put index into data repo before cloud sync failed: %s", err)
			return
		}
		util.PushStatusBar(fmt.Sprintf(Conf.Language(147), elapsed.Seconds()))
	} else {
		util.PushStatusBar(fmt.Sprintf(Conf.Language(148), elapsed.Seconds()))
	}

	if 7000 < elapsed.Milliseconds() {
		logging.LogWarnf("index data repo before cloud sync elapsed [%dms]", elapsed.Milliseconds())
	}
	return
}

func resetRepository(repo *dejavu.Repo) (index *entity.Index, err error) {
	logging.LogWarnf("data repo is corrupted, try to reset it")
	err = os.RemoveAll(filepath.Join(repo.Path))
	if nil != err {
		logging.LogErrorf("remove data repo failed: %s", err)
		return
	}
	index, err = repo.Index("[Sync] Cloud sync", map[string]interface{}{
		eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar,
	})
	logging.LogWarnf("data repo has been reset")

	go func() {
		time.Sleep(5 * time.Second)
		util.PushMsg(Conf.Language(105), 5000)
	}()
	return
}

func newRepository() (ret *dejavu.Repo, err error) {
	cloudConf, err := buildCloudConf()
	if nil != err {
		return
	}

	var cloudRepo cloud.Cloud
	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		cloudRepo = cloud.NewSiYuan(&cloud.BaseCloud{Conf: cloudConf})
	case conf.ProviderS3:
		s3HTTPClient := &http.Client{Transport: httpclient.NewTransport(cloudConf.S3.SkipTlsVerify)}
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
	default:
		err = fmt.Errorf("unknown cloud provider [%d]", Conf.Sync.Provider)
		return
	}

	ignoreLines := getIgnoreLines()
	ignoreLines = append(ignoreLines, "/.siyuan/conf.json") // 忽略旧版同步配置
	ret, err = dejavu.NewRepo(util.DataDir, util.RepoDir, util.HistoryDir, util.TempDir, Conf.System.ID, Conf.System.Name, Conf.System.OS, Conf.Repo.Key, ignoreLines, cloudRepo)
	if nil != err {
		logging.LogErrorf("init data repo failed: %s", err)
		return
	}
	return
}

func subscribeRepoEvents() {
	eventbus.Subscribe(eventbus.EvtIndexBeforeWalkData, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(158), path)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	indexWalkDataCount := 0
	eventbus.Subscribe(eventbus.EvtIndexWalkData, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(158), filepath.Base(path))
		if 0 == indexWalkDataCount%1024 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
		indexWalkDataCount++
	})
	eventbus.Subscribe(eventbus.EvtIndexBeforeGetLatestFiles, func(context map[string]interface{}, total int) {
		msg := fmt.Sprintf(Conf.Language(159), 0, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtIndexGetLatestFile, func(context map[string]interface{}, count int, total int) {
		msg := fmt.Sprintf(Conf.Language(159), count, total)
		if 0 == count%64 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtIndexUpsertFiles, func(context map[string]interface{}, total int) {
		msg := fmt.Sprintf(Conf.Language(160), 0, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtIndexUpsertFile, func(context map[string]interface{}, count int, total int) {
		msg := fmt.Sprintf(Conf.Language(160), count, total)
		if 0 == count%64 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
	})

	eventbus.Subscribe(eventbus.EvtCheckoutBeforeWalkData, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(161), path)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	coWalkDataCount := 0
	eventbus.Subscribe(eventbus.EvtCheckoutWalkData, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(161), filepath.Base(path))
		if 0 == coWalkDataCount%1024 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
		coWalkDataCount++
	})
	var bootProgressPart float64
	eventbus.Subscribe(eventbus.EvtCheckoutUpsertFiles, func(context map[string]interface{}, total int) {
		msg := fmt.Sprintf(Conf.Language(162), 0, total)
		util.SetBootDetails(msg)
		bootProgressPart = 10 / float64(total)
		util.ContextPushMsg(context, msg)
	})
	coUpsertFileCount := 0
	eventbus.Subscribe(eventbus.EvtCheckoutUpsertFile, func(context map[string]interface{}, count, total int) {
		msg := fmt.Sprintf(Conf.Language(162), count, total)
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == coUpsertFileCount%64 {
			util.ContextPushMsg(context, msg)
		}
		coUpsertFileCount++
	})
	eventbus.Subscribe(eventbus.EvtCheckoutRemoveFiles, func(context map[string]interface{}, total int) {
		msg := fmt.Sprintf(Conf.Language(163), 0, total)
		util.SetBootDetails(msg)
		bootProgressPart = 10 / float64(total)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtCheckoutRemoveFile, func(context map[string]interface{}, count, total int) {
		msg := fmt.Sprintf(Conf.Language(163), count, total)
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == count%64 {
			util.ContextPushMsg(context, msg)
		}
	})

	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadIndex, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(164), id[:7])
		util.IncBootProgress(1, msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadFiles, func(context map[string]interface{}, total int) {
		msg := fmt.Sprintf(Conf.Language(165), 0, total)
		util.SetBootDetails(msg)
		bootProgressPart = 10 / float64(total)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadFile, func(context map[string]interface{}, count, total int) {
		msg := fmt.Sprintf(Conf.Language(165), count, total)
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == count%8 {
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadChunks, func(context map[string]interface{}, total int) {
		msg := fmt.Sprintf(Conf.Language(166), 0, total)
		util.SetBootDetails(msg)
		bootProgressPart = 10 / float64(total)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadChunk, func(context map[string]interface{}, count, total int) {
		msg := fmt.Sprintf(Conf.Language(166), count, total)
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == count%8 {
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadRef, func(context map[string]interface{}, ref string) {
		msg := fmt.Sprintf(Conf.Language(167), ref)
		util.IncBootProgress(1, msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadIndex, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(168), id[:7])
		util.IncBootProgress(1, msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadFiles, func(context map[string]interface{}, total int) {
		msg := fmt.Sprintf(Conf.Language(169), 0, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadFile, func(context map[string]interface{}, count, total int) {
		msg := fmt.Sprintf(Conf.Language(169), count, total)
		if 0 == count%8 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadChunks, func(context map[string]interface{}, total int) {
		msg := fmt.Sprintf(Conf.Language(170), 0, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadChunk, func(context map[string]interface{}, count, total int) {
		msg := fmt.Sprintf(Conf.Language(170), count, total)
		if 0 == count%8 {
			util.SetBootDetails(msg)
			util.ContextPushMsg(context, msg)
		}
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadRef, func(context map[string]interface{}, ref string) {
		msg := fmt.Sprintf(Conf.Language(171), ref)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudLock, func(context map[string]interface{}) {
		msg := fmt.Sprintf(Conf.Language(186))
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudUnlock, func(context map[string]interface{}) {
		msg := fmt.Sprintf(Conf.Language(187))
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadIndexes, func(context map[string]interface{}) {
		msg := fmt.Sprintf(Conf.Language(208))
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeUploadCheckIndex, func(context map[string]interface{}) {
		msg := fmt.Sprintf(Conf.Language(209))
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudBeforeFixObjects, func(context map[string]interface{}, count, total int) {
		msg := fmt.Sprintf(Conf.Language(210), count, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtCloudAfterFixObjects, func(context map[string]interface{}) {
		msg := fmt.Sprintf(Conf.Language(211))
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
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
		userId = Conf.User.UserId
		token = Conf.User.UserToken
		availableSize = Conf.User.GetCloudRepoAvailableSize()
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
			Endpoint:      Conf.Sync.S3.Endpoint,
			AccessKey:     Conf.Sync.S3.AccessKey,
			SecretKey:     Conf.Sync.S3.SecretKey,
			Bucket:        Conf.Sync.S3.Bucket,
			Region:        Conf.Sync.S3.Region,
			PathStyle:     Conf.Sync.S3.PathStyle,
			SkipTlsVerify: Conf.Sync.S3.SkipTlsVerify,
			Timeout:       Conf.Sync.S3.Timeout,
		}
	case conf.ProviderWebDAV:
		ret.WebDAV = &cloud.ConfWebDAV{
			Endpoint:      Conf.Sync.WebDAV.Endpoint,
			Username:      Conf.Sync.WebDAV.Username,
			Password:      Conf.Sync.WebDAV.Password,
			SkipTlsVerify: Conf.Sync.WebDAV.SkipTlsVerify,
			Timeout:       Conf.Sync.WebDAV.Timeout,
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
	if nil != err {
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
		s.HSize = humanize.Bytes(uint64(syncSize))
		b.HSize = humanize.Bytes(uint64(backupSize))
		hAssetSize = humanize.Bytes(uint64(assetSize))
		hSize = humanize.Bytes(uint64(totalSize))
		hTotalSize = humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize))
		hExchangeSize = humanize.Bytes(uint64(Conf.User.UserSiYuanPointExchangeRepoSize))
		hTrafficUploadSize = humanize.Bytes(uint64(Conf.User.UserTrafficUpload))
		hTrafficDownloadSize = humanize.Bytes(uint64(Conf.User.UserTrafficDownload))
		hTrafficAPIGet = humanize.SIWithDigits(Conf.User.UserTrafficAPIGet, 2, "")
		hTrafficAPIPut = humanize.SIWithDigits(Conf.User.UserTrafficAPIPut, 2, "")
	}
	return
}

func getCloudSpace() (stat *cloud.Stat, err error) {
	repo, err := newRepository()
	if nil != err {
		return
	}

	stat, err = repo.GetCloudRepoStat()
	if nil != err {
		logging.LogErrorf("get cloud repo stat failed: %s", err)
		return
	}
	return
}
