package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getWorkspaceStorage = contractHandler(apicontract.GetWorkspaceStorage, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.WorkspaceStorageData] {
	storage, err := util.GetWorkspaceStorage(c.Request.Context(), util.WorkspaceDir)
	if err != nil {
		logging.LogWarnf("workspace storage scan failed: %s", err)
		return apicontract.Failure[apicontract.WorkspaceStorageData](-1, "failed to calculate workspace storage")
	}
	data := apicontract.WorkspaceStorageData{
		TotalSize: storage.TotalSize, AssetsSize: storage.AssetsSize, CalculatedAt: storage.CalculatedAt,
		Directories: make([]apicontract.WorkspaceStorageEntry, 0, len(storage.Directories)),
	}
	for _, name := range []string{"data", "repo", "history", "temp", "conf", "other"} {
		data.Directories = append(data.Directories, apicontract.WorkspaceStorageEntry{Name: name, Size: storage.Directories[name]})
	}
	return apicontract.Success(data)
})
