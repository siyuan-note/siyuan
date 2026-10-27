// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var fileTraversalDiagnosticLock sync.Mutex

var checkFileTraversal = contractHandler(apicontract.CheckFileTraversal, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.SystemFileTraversalData] {
	if !fileTraversalDiagnosticLock.TryLock() {
		return apicontract.Failure[apicontract.SystemFileTraversalData](-1, "file traversal diagnostic is already running")
	}
	defer fileTraversalDiagnosticLock.Unlock()
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Minute)
	defer cancel()
	text, err := filelock.DiagnoseWalk(ctx, util.DataDir)
	if err != nil {
		message := strings.ReplaceAll(err.Error(), filepath.Clean(util.DataDir), "<data>")
		return apicontract.Failure[apicontract.SystemFileTraversalData](-1, message)
	}
	metadata, err := json.Marshal(struct {
		Type      string `json:"type"`
		Version   string `json:"version"`
		Platform  string `json:"platform"`
		Container string `json:"container"`
	}{"kernel", util.Ver, util.MobileOSVer, util.Container})
	if err != nil {
		return apicontract.Failure[apicontract.SystemFileTraversalData](-1, err.Error())
	}
	return apicontract.Success(apicontract.SystemFileTraversalData{Text: string(metadata) + "\n" + text})
})
