// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSystemFileTraversal(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	path := filepath.Join(util.DataDir, "probe.txt")
	if err := os.WriteFile(path, []byte("private-document-content"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"", "{}"} {
		recorder := systemContractRequest(t, "POST", "checkFileTraversal", checkFileTraversal, strings.NewReader(body))
		var result struct {
			Code int                                 `json:"code"`
			Data apicontract.SystemFileTraversalData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Code != 0 || !strings.Contains(result.Data.Text, `"contentRead":false`) || !strings.Contains(result.Data.Text, `"uid":`) || !strings.Contains(result.Data.Text, `"version":"`+util.Ver+`"`) {
			t.Fatalf("diagnostic failed: %s", recorder.Body.String())
		}
		if strings.Contains(result.Data.Text, util.DataDir) || strings.Contains(result.Data.Text, "private-document-content") {
			t.Fatal("diagnostic exposes an absolute path or document content")
		}
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "private-document-content" {
		t.Fatalf("diagnostic changed source: %v", err)
	}
	var recorderBody string
	func() {
		fileTraversalDiagnosticLock.Lock()
		defer fileTraversalDiagnosticLock.Unlock()
		recorderBody = systemContractRequest(t, "POST", "checkFileTraversal", checkFileTraversal, nil).Body.String()
	}()
	if !strings.Contains(recorderBody, "already running") {
		t.Fatalf("concurrent diagnostic accepted: %s", recorderBody)
	}
	util.DataDir = filepath.Join(util.DataDir, "missing")
	recorder := systemContractRequest(t, "POST", "checkFileTraversal", checkFileTraversal, nil)
	var failed struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &failed); err != nil {
		t.Fatal(err)
	}
	if failed.Code != -1 {
		t.Fatalf("missing root accepted: %s", recorder.Body.String())
	}
	if strings.Contains(failed.Msg, util.DataDir) {
		t.Fatal("diagnostic failure exposes an absolute workspace path")
	}
}
