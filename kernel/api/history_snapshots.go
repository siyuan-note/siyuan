package api

import (
	"path/filepath"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getDocHistorySnapshots = contractHandler(apicontract.GetDocHistorySnapshots, func(c *gin.Context, request apicontract.DocHistorySnapshotsRequest) apicontract.Response[apicontract.DocHistorySnapshotsData] {
	histories, err := model.ResolveDocHistorySnapshots(request.ID, request.Created, request.Op)
	if err != nil {
		return apicontract.Failure[apicontract.DocHistorySnapshotsData](-1, err.Error())
	}
	boxes := map[string]bool{}
	for _, history := range histories {
		boxes[model.ExtractBoxIDFromHistoryPath(filepath.Join(util.WorkspaceDir, history.HistoryPath))] = true
	}
	ids := make([]string, 0, len(boxes))
	for id := range boxes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if err = holdEncryptedBoxRequest(c, id); err != nil {
			return apicontract.Failure[apicontract.DocHistorySnapshotsData](-1, model.Conf.Language(314))
		}
	}
	if err = model.GetDocHistorySnapshots(c.Request.Context(), request.ID, histories); err != nil {
		return apicontract.Failure[apicontract.DocHistorySnapshotsData](-1, err.Error())
	}
	data := apicontract.DocHistorySnapshotsData{Histories: make([]*apicontract.DocHistorySnapshotEntry, 0, len(histories))}
	for _, history := range histories {
		entry := &apicontract.DocHistorySnapshotEntry{Created: history.Created, HistoryPath: history.HistoryPath, Snapshots: docHistorySnapshots(history.Snapshots)}
		data.Histories = append(data.Histories, entry)
	}
	return apicontract.Success(data)
})

func docHistorySnapshots(values []*model.DocHistorySnapshot) []*apicontract.DocHistorySnapshot {
	ret := make([]*apicontract.DocHistorySnapshot, 0, len(values))
	for _, snapshot := range values {
		ret = append(ret, &apicontract.DocHistorySnapshot{
			ID: snapshot.ID, FileID: snapshot.FileID, Tags: snapshot.Tags, Memo: snapshot.Memo, Created: snapshot.Created,
		})
	}
	return ret
}
