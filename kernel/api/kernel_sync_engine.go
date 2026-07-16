// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/synccommit"
)

var kernelSyncCommitFaultHook func(point string, index int) error
var kernelSyncRecoveryReady = synccommit.Ready

func injectKernelSyncCommitFault(point string, index int) error {
	if kernelSyncCommitFaultHook == nil {
		return nil
	}
	return kernelSyncCommitFaultHook(point, index)
}

func requireKernelSyncRecoveryReady(c *gin.Context) {
	if kernelSyncRecoveryReady != nil && kernelSyncRecoveryReady() {
		c.Next()
		return
	}
	c.Header("Retry-After", "1")
	c.AbortWithStatusJSON(http.StatusServiceUnavailable, map[string]any{
		"code": http.StatusServiceUnavailable, "msg": "kernel sync recovery is not ready", "data": nil,
	})
}
