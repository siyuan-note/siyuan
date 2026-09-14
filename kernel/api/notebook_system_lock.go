package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var setEncryptedNotebookFollowSystemLock = contractHandler(apicontract.SetEncryptedNotebookFollowSystemLock, func(c *gin.Context, request apicontract.EncryptedNotebookFollowSystemLockRequest) apicontract.Response[apicontract.Null] {
	model.SetEncryptedNotebookFollowSystemLock(request.Enabled)
	model.Conf.Save()
	return apicontract.Success(apicontract.Null{})
})

var lockEncryptedNotebooksOnSystemLock = contractHandler(apicontract.LockEncryptedNotebooksOnSystemLock, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	model.LockEncryptedNotebooksOnSystemLock()
	return apicontract.Success(apicontract.Null{})
})
