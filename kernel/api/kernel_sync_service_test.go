// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type kernelSyncTestEnvelope struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

func invokeKernelSyncTestHandler(t *testing.T, method, target string, body []byte, handler gin.HandlerFunc) kernelSyncTestEnvelope {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, target, bytes.NewReader(body))
	handler(context)
	var envelope kernelSyncTestEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response %s: %v", recorder.Body.String(), err)
	}
	return envelope
}

func kernelSyncTestBeginBody(t *testing.T) []byte {
	t.Helper()
	body, err := json.Marshal(kernelSyncBeginRequest{
		RunID: "run-test", LocalDeviceID: "device-local", RemoteDeviceID: "device-remote",
		RulesFingerprint: "sha256:" + string(bytes.Repeat([]byte{'a'}, 64)), ProtocolVersion: "2",
	})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestKernelSyncServiceStagesAndCommitsWithCAS(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	kernelSyncReloadFiletree, kernelSyncIncSync = func() {}, func() { model.AdvanceWorkspaceGeneration() }
	defer func() { kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync }()
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
	}()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(util.DataDir, "assets", "test.bin")
	oldContent := []byte("old content")
	if err := os.WriteFile(target, oldContent, 0644); err != nil {
		t.Fatal(err)
	}

	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	if begin.Code != 0 {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(begin.Data, &session); err != nil || session.SessionID == "" {
		t.Fatalf("invalid begin result: %s", begin.Data)
	}
	manifestBody, err := json.Marshal(kernelSyncManifestRequest{SessionID: session.SessionID})
	if err != nil {
		t.Fatal(err)
	}
	manifest := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/readManifest", manifestBody, readKernelSyncManifest)
	if manifest.Code != 0 {
		t.Fatalf("manifest failed: %s", manifest.Msg)
	}
	var manifestResult kernelSyncManifestResult
	if err = json.Unmarshal(manifest.Data, &manifestResult); err != nil {
		t.Fatal(err)
	}
	if manifestResult.RunID != "run-test" || manifestResult.LocalDeviceID != "device-local" ||
		manifestResult.RemoteDeviceID != "device-remote" || manifestResult.RulesFingerprint != "sha256:"+string(bytes.Repeat([]byte{'a'}, 64)) ||
		manifestResult.ProtocolVersion != "2" || manifestResult.ServiceVersion != kernelSyncProtocolVersion {
		t.Fatalf("manifest did not preserve session binding: %+v", manifestResult)
	}
	newContent := []byte("new content published by one commit")
	oldHash := sha256.Sum256(oldContent)
	newHash := sha256.Sum256(newContent)
	query := url.Values{
		"sessionId": {session.SessionID}, "operation": {"write"}, "path": {"/data/assets/test.bin"},
		"offset": {"0"}, "size": {fmt.Sprint(len(newContent))}, "hash": {fmt.Sprintf("sha256:%x", newHash[:])},
		"modTime": {"1700000000"}, "ifMatch": {fmt.Sprintf("sha256:%x", oldHash[:])}, "final": {"true"},
	}
	staged := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), newContent, stageKernelSyncBatch)
	if staged.Code != 0 {
		t.Fatalf("stage failed: %s", staged.Msg)
	}
	before, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(before, oldContent) {
		t.Fatalf("staging changed the workspace: %q %v", before, err)
	}
	commit := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
	if commit.Code != 0 {
		t.Fatalf("commit failed: %s", commit.Msg)
	}
	after, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(after, newContent) {
		t.Fatalf("unexpected committed content: %q %v", after, err)
	}
	retried := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
	if retried.Code != 0 || !bytes.Contains(retried.Data, []byte(`"alreadyTerminal":true`)) {
		t.Fatalf("commit retry did not return the terminal receipt: %s %s", retried.Msg, retried.Data)
	}
	released := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
	if released.Code != 0 || !bytes.Contains(released.Data, []byte(`"committed":true`)) {
		t.Fatalf("abort did not recognize committed terminal state: %s %s", released.Msg, released.Data)
	}
}

func TestKernelSyncServiceRejectsInvalidBeginBinding(t *testing.T) {
	gin.SetMode(gin.TestMode)
	request := kernelSyncBeginRequest{
		RunID: "run-test", LocalDeviceID: "same-device", RemoteDeviceID: "same-device",
		RulesFingerprint: "sha256:" + string(bytes.Repeat([]byte{'z'}, 64)), ProtocolVersion: "2",
	}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", body, beginKernelSync)
	if begin.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid binding rejection, got %d: %s", begin.Code, begin.Msg)
	}
}

func TestKernelSyncServiceRejectsChangedPreconditionWithoutPublication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	kernelSyncReloadFiletree, kernelSyncIncSync = func() {}, func() { model.AdvanceWorkspaceGeneration() }
	defer func() { kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync }()
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
	}()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(util.DataDir, "assets", "test.bin")
	if err := os.WriteFile(target, []byte("current"), 0644); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	content := []byte("must not publish")
	hash := sha256.Sum256(content)
	query := url.Values{
		"sessionId": {session.SessionID}, "operation": {"write"}, "path": {"/data/assets/test.bin"},
		"offset": {"0"}, "size": {fmt.Sprint(len(content))}, "hash": {fmt.Sprintf("sha256:%x", hash[:])},
		"modTime": {"1700000000"}, "ifMatch": {"sha256:" + string(bytes.Repeat([]byte{'0'}, 64))}, "final": {"true"},
	}
	staged := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), content, stageKernelSyncBatch)
	if staged.Code != 0 {
		t.Fatalf("stage failed: %s", staged.Msg)
	}
	commit := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
	if commit.Code != http.StatusConflict {
		t.Fatalf("expected conflict, got %d: %s", commit.Code, commit.Msg)
	}
	localKernelSyncAbort := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
	if localKernelSyncAbort.Code != 0 {
		t.Fatalf("abort failed: %s", localKernelSyncAbort.Msg)
	}
	after, err := os.ReadFile(target)
	if err != nil || string(after) != "current" {
		t.Fatalf("precondition failure changed the workspace: %q %v", after, err)
	}
}

func TestKernelSyncServiceRejectsChangedWorkspaceGeneration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
	}()
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	model.AdvanceWorkspaceGeneration()
	commit := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
	if commit.Code != http.StatusConflict || commit.Msg != "workspace generation changed" {
		t.Fatalf("expected workspace generation conflict, got %d: %s", commit.Code, commit.Msg)
	}
	aborted := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
	if aborted.Code != 0 {
		t.Fatalf("abort failed: %s", aborted.Msg)
	}
}
