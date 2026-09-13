// SiYuan - From thought to insight, with agents
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

package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var setRepoIndexRetentionDays = contractHandler(apicontract.SetRepoIndexRetentionDays, func(c *gin.Context, request apicontract.SetRepoIndexRetentionDaysRequest) apicontract.Response[apicontract.Null] {
	daysInt := int(request.Days)
	if 1 > daysInt {
		daysInt = 180
	}

	model.Conf.Repo.IndexRetentionDays = daysInt
	model.Conf.Save()

	return apicontract.Success(apicontract.Null{})
})

var setRetentionIndexesDaily = contractHandler(apicontract.SetRetentionIndexesDaily, func(c *gin.Context, request apicontract.SetRetentionIndexesDailyRequest) apicontract.Response[apicontract.Null] {
	indexesInt := int(request.Indexes)
	if 1 > indexesInt {
		indexesInt = 180
	}

	model.Conf.Repo.RetentionIndexesDaily = indexesInt
	model.Conf.Save()

	return apicontract.Success(apicontract.Null{})
})

var getRepoFile = contractHandler(apicontract.GetRepoFile, func(c *gin.Context, request apicontract.GetRepoFileRequest) apicontract.Response[apicontract.BinaryContent] {
	ret := gulu.Ret.NewResult()

	if !holdRepoFileRequest(c, request.ID, ret) {
		return contractFailure[apicontract.BinaryContent](ret)
	}
	data, p, err := model.GetRepoFile(request.ID)
	if err != nil {
		return apicontract.Failure[apicontract.BinaryContent](-1, err.Error())
	}

	return repoFileResponse(data, p)
})

var rollbackRepoSnapshotFile = contractHandler(apicontract.RollbackRepoSnapshotFile, func(c *gin.Context, request apicontract.RollbackRepoSnapshotFileRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	if !holdRepoFileRequest(c, request.ID, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	err := model.RollbackRepoSnapshotFile(request.ID)
	if nil != err {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var openRepoSnapshotFile = contractHandler(apicontract.OpenRepoSnapshotFile, func(c *gin.Context, request apicontract.OpenRepoSnapshotFileRequest) apicontract.Response[apicontract.RepoOpenFileData] {
	ret := gulu.Ret.NewResult()

	if !holdRepoFileRequest(c, request.ID, ret) {
		return contractFailure[apicontract.RepoOpenFileData](ret)
	}

	title, content, displayInText, updated, err := model.OpenRepoSnapshotFile(request.ID)
	if err != nil {
		return apicontract.Failure[apicontract.RepoOpenFileData](-1, err.Error())
	}

	return apicontract.Success(apicontract.RepoOpenFileData{Title: title, Content: content, DisplayInText: displayInText, Updated: updated})
})

var diffRepoSnapshots = contractHandler(apicontract.DiffRepoSnapshots, func(c *gin.Context, request apicontract.DiffRepoSnapshotsRequest) apicontract.Response[apicontract.RepoDiffData] {
	diff, err := model.DiffRepoSnapshots(request.Left, request.Right)
	if err != nil {
		return apicontract.Failure[apicontract.RepoDiffData](-1, err.Error())
	}

	return apicontract.Success(apicontract.RepoDiffData{AddsLeft: repoDiffFiles(diff.AddsLeft), UpdatesLeft: repoDiffFiles(diff.UpdatesLeft), UpdatesRight: repoDiffFiles(diff.UpdatesRight), RemovesRight: repoDiffFiles(diff.RemovesRight), Left: (*apicontract.RepoDiffIndex)(diff.LeftIndex), Right: (*apicontract.RepoDiffIndex)(diff.RightIndex)})
})

var getCloudSpace = contractHandler(apicontract.GetCloudSpace, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.CloudSpaceData] {
	sync, backup, hSize, hAssetSize, hTotalSize, exchangeSize, hTrafficUploadSize, hTrafficDownloadSize, hTrafficAPIGet, hTrafficAPIPut, err := model.GetCloudSpace()
	if err != nil {
		util.PushErrMsg(err.Error(), 3000)
		return apicontract.Failure[apicontract.CloudSpaceData](1, err.Error())
	}
	return apicontract.Success(apicontract.CloudSpaceData{
		Sync: cloudSyncContract(sync), Backup: cloudBackupContract(backup),
		HAssetSize: hAssetSize, HSize: hSize, HTotalSize: hTotalSize, HExchangeSize: exchangeSize,
		HTrafficUploadSize: hTrafficUploadSize, HTrafficDownloadSize: hTrafficDownloadSize,
		HTrafficAPIGet: hTrafficAPIGet, HTrafficAPIPut: hTrafficAPIPut,
	})
})

var checkoutRepo = contractHandler(apicontract.CheckoutRepo, func(c *gin.Context, request apicontract.CheckoutRepoRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	if request.SessionID != "" {
		if util.InvalidIDPattern(request.SessionID, ret) {
			return contractFailure[apicontract.Null](ret)
		}
		markerDir := filepath.Join(util.TempDir, "ai", "agent")
		os.MkdirAll(markerDir, 0755)
		markerPath := filepath.Join(markerDir, "agentRollback_"+request.SessionID+".json")
		marker := map[string]string{"sessionID": request.SessionID, "snapshotID": request.ID}
		if data, err := json.Marshal(marker); err == nil {
			os.WriteFile(markerPath, data, 0644)
		}
	}

	model.CheckoutRepo(request.ID)

	return apicontract.Success(apicontract.Null{})
})

var downloadCloudSnapshot = contractHandler(apicontract.DownloadCloudSnapshot, func(c *gin.Context, request apicontract.DownloadCloudSnapshotRequest) apicontract.Response[apicontract.Null] {
	if err := model.DownloadCloudSnapshot(request.Tag, request.ID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var uploadCloudSnapshot = contractHandler(apicontract.UploadCloudSnapshot, func(c *gin.Context, request apicontract.UploadCloudSnapshotRequest) apicontract.Response[apicontract.Null] {
	if err := model.UploadCloudSnapshot(request.Tag, request.ID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var getRepoSnapshots = contractHandler(apicontract.GetRepoSnapshots, func(c *gin.Context, request apicontract.GetRepoSnapshotsRequest) apicontract.Response[apicontract.RepoSnapshotsData] {
	snapshots, pageCount, totalCount, err := model.GetRepoSnapshots(int(request.Page))
	if err != nil {
		return apicontract.Failure[apicontract.RepoSnapshotsData](-1, err.Error())
	}
	return apicontract.Success(apicontract.RepoSnapshotsData{Snapshots: repoSnapshots(snapshots), PageCount: pageCount, TotalCount: totalCount})
})

var searchRepoFile = contractHandler(apicontract.SearchRepoFile, func(c *gin.Context, request apicontract.SearchRepoFileRequest) apicontract.Response[apicontract.RepoSearchData] {
	if 1 > len(request.Keyword) {
		return apicontract.Failure[apicontract.RepoSearchData](-1, "keyword is empty")
	}

	files, pageCount, totalCount, err := model.SearchRepoFile(request.Keyword, int(request.Page))
	if err != nil {
		return apicontract.Failure[apicontract.RepoSearchData](-1, err.Error())
	}

	return apicontract.Success(apicontract.RepoSearchData{Files: repoDiffFiles(files), PageCount: pageCount, TotalCount: totalCount})
})

var getRepoDocHistory = contractHandler(apicontract.GetRepoDocHistory, func(c *gin.Context, request apicontract.GetRepoDocHistoryRequest) apicontract.Response[apicontract.RepoDocHistoryData] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.ID, ret) {
		return contractFailure[apicontract.RepoDocHistoryData](ret)
	}

	if block := treenode.GetBlockTree(request.ID); block != nil {
		if err := holdEncryptedBoxRequest(c, block.BoxID); err != nil {
			return apicontract.Failure[apicontract.RepoDocHistoryData](-1, model.Conf.Language(314))
		}
	}

	files, pageCount, totalCount, err := model.GetRepoDocHistory(request.ID, int(request.Page))
	if err != nil {
		return apicontract.Failure[apicontract.RepoDocHistoryData](-1, err.Error())
	}

	return apicontract.Success(apicontract.RepoDocHistoryData{Files: repoDocHistories(files), PageCount: pageCount, TotalCount: totalCount})
})

var exportRepoFile = contractHandler(apicontract.ExportRepoFile, func(c *gin.Context, request apicontract.ExportRepoFileRequest) apicontract.Response[apicontract.RepoExportData] {
	ret := gulu.Ret.NewResult()

	if !holdRepoFileRequest(c, request.ID, ret) {
		return contractFailure[apicontract.RepoExportData](ret)
	}

	exportPath, err := model.ExportRepoFile(request.ID)
	if err != nil {
		return apicontract.Failure[apicontract.RepoExportData](-1, err.Error())
	}

	return apicontract.Success(apicontract.RepoExportData{Path: exportPath})
})

func holdRepoFileRequest(c *gin.Context, id string, ret *gulu.Result) bool {
	boxID, err := model.ResolveRepoFileBoxID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return false
	}
	if err = holdEncryptedBoxRequest(c, boxID); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return false
	}
	return true
}

var getCloudRepoSnapshots = contractHandler(apicontract.GetCloudRepoSnapshots, func(c *gin.Context, request apicontract.GetCloudRepoSnapshotsRequest) apicontract.Response[apicontract.RepoCloudSnapshotsData] {
	snapshots, pageCount, totalCount, err := model.GetCloudRepoSnapshots(int(request.Page))
	if err != nil {
		return apicontract.Failure[apicontract.RepoCloudSnapshotsData](-1, err.Error())
	}

	return apicontract.Success(apicontract.RepoCloudSnapshotsData{Snapshots: repoLogs(snapshots), PageCount: pageCount, TotalCount: totalCount})
})

var getCloudRepoTagSnapshots = contractHandler(apicontract.GetCloudRepoTagSnapshots, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.RepoCloudTagsData] {
	snapshots, err := model.GetCloudRepoTagSnapshots()
	if err != nil {
		return apicontract.Failure[apicontract.RepoCloudTagsData](-1, err.Error())
	}

	return apicontract.Success(apicontract.RepoCloudTagsData{Snapshots: repoLogs(snapshots)})
})

var removeCloudRepoTagSnapshot = contractHandler(apicontract.RemoveCloudRepoTagSnapshot, func(c *gin.Context, request apicontract.RemoveCloudRepoTagSnapshotRequest) apicontract.Response[apicontract.Null] {
	err := model.RemoveCloudRepoTag(request.Tag)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var getRepoTagSnapshots = contractHandler(apicontract.GetRepoTagSnapshots, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.RepoTagsData] {
	snapshots, err := model.GetTagSnapshots()
	if err != nil {
		return apicontract.Failure[apicontract.RepoTagsData](-1, err.Error())
	}

	return apicontract.Success(apicontract.RepoTagsData{Snapshots: repoSnapshots(snapshots)})
})

var removeRepoTagSnapshot = contractHandler(apicontract.RemoveRepoTagSnapshot, func(c *gin.Context, request apicontract.RemoveRepoTagSnapshotRequest) apicontract.Response[apicontract.Null] {
	err := model.RemoveTagSnapshot(request.Tag)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var createSnapshot = contractHandler(apicontract.CreateSnapshot, func(c *gin.Context, request apicontract.CreateSnapshotRequest) apicontract.Response[apicontract.CreateSnapshotData] {
	id, created, err := model.CreateRepoSnapshot(request.Memo)
	if err != nil {
		return apicontract.Failure[apicontract.CreateSnapshotData](-1, fmt.Sprintf(model.Conf.Language(140), err))
	}
	return apicontract.Success(apicontract.CreateSnapshotData{ID: id, Created: created})
})

var checkSnapshot = contractHandler(apicontract.CheckSnapshot, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.CheckSnapshotData] {
	changed, err := model.CheckRepoSnapshot()
	if err != nil {
		return apicontract.Failure[apicontract.CheckSnapshotData](-1, err.Error())
	}
	return apicontract.Success(apicontract.CheckSnapshotData{Changed: changed})
})

var setSnapshotMemo = contractHandler(apicontract.SetSnapshotMemo, func(c *gin.Context, request apicontract.SetSnapshotMemoRequest) apicontract.Response[apicontract.Null] {
	if err := model.SetRepoSnapshotMemo(request.ID, request.Memo); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var tagSnapshot = contractHandler(apicontract.TagSnapshot, func(c *gin.Context, request apicontract.TagSnapshotRequest) apicontract.Response[apicontract.Null] {
	if err := model.TagSnapshot(request.ID, request.Name); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, fmt.Sprintf(model.Conf.Language(140), err), 5000)
	}

	return apicontract.Success(apicontract.Null{})
})

var importRepoKey = contractHandler(apicontract.ImportRepoKey, func(c *gin.Context, request apicontract.ImportRepoKeyRequest) apicontract.Response[apicontract.RepoKeyData] {
	retKey, err := model.ImportRepoKey(request.Key)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.RepoKeyData](-1, fmt.Sprintf(model.Conf.Language(137), err), 5000)
	}

	return apicontract.Success(apicontract.RepoKeyData{Key: retKey})
})

var initRepoKeyFromPassphrase = contractHandler(apicontract.InitRepoKeyFromPassphrase, func(c *gin.Context, request apicontract.InitRepoKeyFromPassphraseRequest) apicontract.Response[apicontract.RepoKeyData] {
	if err := model.InitRepoKeyFromPassphrase(request.Pass); err != nil {
		return apicontract.FailureWithTimeout[apicontract.RepoKeyData](-1, fmt.Sprintf(model.Conf.Language(137), err), 5000)
	}

	return apicontract.Success(apicontract.RepoKeyData{Key: base64.StdEncoding.EncodeToString(model.Conf.Repo.Key)})
})

var initRepoKey = contractHandler(apicontract.InitRepoKey, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.RepoKeyData] {
	if err := model.InitRepoKey(); err != nil {
		return apicontract.FailureWithTimeout[apicontract.RepoKeyData](-1, fmt.Sprintf(model.Conf.Language(137), err), 5000)
	}

	return apicontract.Success(apicontract.RepoKeyData{Key: base64.StdEncoding.EncodeToString(model.Conf.Repo.Key)})
})

var resetRepo = contractHandler(apicontract.ResetRepo, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := model.ResetRepo(); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, fmt.Sprintf(model.Conf.Language(146), err.Error()), 5000)
	}

	return apicontract.Success(apicontract.Null{})
})

var purgeRepo = contractHandler(apicontract.PurgeRepo, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := model.PurgeRepo(); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, fmt.Sprintf(model.Conf.Language(201), err.Error()), 5000)
	}

	return apicontract.Success(apicontract.Null{})
})

var purgeCloudRepo = contractHandler(apicontract.PurgeCloudRepo, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := model.PurgeCloud(); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, fmt.Sprintf(model.Conf.Language(201), err.Error()), 5000)
	}

	return apicontract.Success(apicontract.Null{})
})

// repoFileResponse 保留文件媒体类型和文件内容末尾的成功信封。
func repoFileResponse(data []byte, path string) apicontract.Response[apicontract.BinaryContent] {
	contentType := mime.TypeByExtension(filepath.Ext(path))
	if contentType == "" {
		if detected := mimetype.Detect(data); detected != nil {
			contentType = detected.String()
		}
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	// 非空文件由 Content-Length 限定载荷；空文件保留成功信封。
	if len(data) == 0 {
		data, _ = json.Marshal(apicontract.Success(apicontract.Null{}))
	}
	return apicontract.SuccessBinary(contentType, data)
}
func repoDiffFiles(values []*model.DiffFile) []*apicontract.RepoDiffFile {
	if values == nil {
		return nil
	}
	ret := make([]*apicontract.RepoDiffFile, len(values))
	for i, value := range values {
		ret[i] = (*apicontract.RepoDiffFile)(value)
	}
	return ret
}
func repoDocHistories(values []*model.RepoDocHistory) []*apicontract.RepoDocHistory {
	if values == nil {
		return nil
	}
	ret := make([]*apicontract.RepoDocHistory, len(values))
	for i, value := range values {
		ret[i] = (*apicontract.RepoDocHistory)(value)
	}
	return ret
}
func repoLog(value *dejavu.Log) *apicontract.RepoLog {
	if value == nil {
		return nil
	}
	ret := &apicontract.RepoLog{ID: value.ID, Memo: value.Memo, Created: value.Created, HCreated: value.HCreated, Count: value.Count, Size: value.Size, HSize: value.HSize, SystemID: value.SystemID, SystemName: value.SystemName, SystemOS: value.SystemOS, Tag: value.Tag, HTagUpdated: value.HTagUpdated}
	if value.Files != nil {
		ret.Files = make([]*apicontract.RepoFile, len(value.Files))
		for i, file := range value.Files {
			ret.Files[i] = repoFile(file)
		}
	}
	return ret
}
func repoFile(value *entity.File) *apicontract.RepoFile { return (*apicontract.RepoFile)(value) }
func repoLogs(values []*dejavu.Log) []*apicontract.RepoLog {
	if values == nil {
		return nil
	}
	ret := make([]*apicontract.RepoLog, len(values))
	for i, value := range values {
		ret[i] = repoLog(value)
	}
	return ret
}
func repoSnapshots(values []*model.Snapshot) []*apicontract.RepoSnapshot {
	if values == nil {
		return nil
	}
	ret := make([]*apicontract.RepoSnapshot, len(values))
	for i, value := range values {
		if value == nil {
			continue
		}
		snapshot := &apicontract.RepoSnapshot{RepoLog: *repoLog(value.Log), RequiresDownload: value.RequiresDownload}
		if value.TypesCount != nil {
			snapshot.TypesCount = make([]*apicontract.RepoTypeCount, len(value.TypesCount))
			for j, count := range value.TypesCount {
				snapshot.TypesCount[j] = (*apicontract.RepoTypeCount)(count)
			}
		}
		ret[i] = snapshot
	}
	return ret
}
