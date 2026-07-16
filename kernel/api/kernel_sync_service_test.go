// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/synccommit"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type kernelSyncTestEnvelope struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

type gatedKernelSyncReader struct {
	data    []byte
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (reader *gatedKernelSyncReader) Read(buffer []byte) (int, error) {
	reader.once.Do(func() {
		close(reader.started)
		<-reader.release
	})
	if len(reader.data) == 0 {
		return 0, io.EOF
	}
	read := copy(buffer, reader.data)
	reader.data = reader.data[read:]
	return read, nil
}

func invokeKernelSyncTestHandler(t *testing.T, method, target string, body []byte, handler gin.HandlerFunc) kernelSyncTestEnvelope {
	t.Helper()
	envelope, err := invokeKernelSyncTestHandlerResult(method, target, body, handler)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func invokeKernelSyncTestHandlerResult(method, target string, body []byte, handler gin.HandlerFunc) (kernelSyncTestEnvelope, error) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, target, bytes.NewReader(body))
	handler(context)
	var envelope kernelSyncTestEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		return envelope, fmt.Errorf("decode response %s: %w", recorder.Body.String(), err)
	}
	return envelope, nil
}

func kernelSyncTestBeginBody(t *testing.T) []byte {
	t.Helper()
	rulesFingerprint, err := kernelSyncRulesFingerprint(nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(kernelSyncBeginRequest{
		RunID: "run-test", LocalDeviceID: "device-local", RemoteDeviceID: "device-remote",
		RulesFingerprint: rulesFingerprint, ProtocolVersion: "2",
	})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestKernelSyncRulesFingerprintContract(t *testing.T) {
	fingerprint, err := kernelSyncRulesFingerprint(nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	const expected = "sha256:a653890d22c753fa88c4c842b16fa4d4f5ab5b67315344710171d5d9e644add6"
	if fingerprint != expected {
		t.Fatalf("rules fingerprint contract changed: %s", fingerprint)
	}
}

func TestKernelSyncRequestOwnerUsesStablePluginSubject(t *testing.T) {
	gin.SetMode(gin.TestMode)
	if err := model.InitJwtKey(); err != nil {
		t.Fatal(err)
	}
	first, err := model.CreatePluginJWT("test-plugin")
	if err != nil {
		t.Fatal(err)
	}
	second, err := model.CreatePluginJWT("test-plugin")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		model.RevokePluginJWT(first)
		model.RevokePluginJWT(second)
	})
	owner := func(token string) string {
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Request = httptest.NewRequest(http.MethodPost, "/api/sync/kernel/begin", nil)
		context.Request.Header.Set(model.XAuthTokenKey, token)
		return kernelSyncRequestOwner(context)
	}
	if firstOwner, secondOwner := owner(first), owner(second); firstOwner != "plugin:test-plugin" || firstOwner != secondOwner {
		t.Fatalf("expected stable plugin owner, got %q and %q", firstOwner, secondOwner)
	}
}

func TestKernelSyncRecoveryReadinessGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousReady := kernelSyncRecoveryReady
	ready := false
	kernelSyncRecoveryReady = func() bool { return ready }
	defer func() { kernelSyncRecoveryReady = previousReady }()

	router := gin.New()
	router.POST("/kernel-sync", requireKernelSyncRecoveryReady, func(c *gin.Context) { c.Status(http.StatusNoContent) })
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/kernel-sync", nil))
	if recorder.Code != http.StatusServiceUnavailable || recorder.Header().Get("Retry-After") != "1" {
		t.Fatalf("closed readiness gate returned %d with headers %v", recorder.Code, recorder.Header())
	}
	var envelope kernelSyncTestEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil || envelope.Code != http.StatusServiceUnavailable {
		t.Fatalf("invalid readiness response: %s", recorder.Body.String())
	}

	ready = true
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/kernel-sync", nil))
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("open readiness gate returned %d", recorder.Code)
	}
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
		manifestResult.RemoteDeviceID != "device-remote" ||
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
	leftovers, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".siyuan-*.tmp"))
	if err != nil || len(leftovers) != 0 {
		t.Fatalf("commit left recovery files: %v %v", leftovers, err)
	}
	walEntries, err := os.ReadDir(filepath.Dir(synccommit.IntentPath(session.SessionID)))
	if err != nil || len(walEntries) != 0 {
		t.Fatalf("commit left recovery WAL entries: %v %v", walEntries, err)
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

func TestKernelSyncServiceRejectsManifestRulesOutsideSessionBinding(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() { util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp }()
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
	body, err := json.Marshal(kernelSyncManifestRequest{SessionID: session.SessionID, Includes: []string{"assets/**"}})
	if err != nil {
		t.Fatal(err)
	}
	manifest := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/readManifest", body, readKernelSyncManifest)
	if manifest.Code != http.StatusConflict {
		t.Fatalf("expected manifest binding conflict, got %d: %s", manifest.Code, manifest.Msg)
	}
	aborted := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
	if aborted.Code != 0 {
		t.Fatalf("abort failed: %s", aborted.Msg)
	}
}

func TestKernelSyncServiceExplicitRenewal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() { util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp }()
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
	renewed := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/renew?sessionId="+session.SessionID, nil, renewKernelSync)
	if renewed.Code != 0 || !bytes.Contains(renewed.Data, []byte(`"renewed":true`)) {
		t.Fatalf("renew failed: %s %s", renewed.Msg, renewed.Data)
	}
	aborted := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
	if aborted.Code != 0 {
		t.Fatalf("abort failed: %s", aborted.Msg)
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

func TestKernelSyncServiceDeletesHistoryTreeRecursively(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	kernelSyncReloadFiletree, kernelSyncIncSync = func() {}, func() { model.AdvanceWorkspaceGeneration() }
	defer func() { kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync }()
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() { util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp }()
	tree := filepath.Join(util.DataDir, "storage", "petal", "test-plugin", "history", "run", "nested")
	if err := os.MkdirAll(tree, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tree, "payload.bin"), []byte("payload"), 0644); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	path := "/data/storage/petal/test-plugin/history/run"
	query := url.Values{"sessionId": {session.SessionID}, "operation": {"delete"}, "path": {path}}
	staged := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), nil, stageKernelSyncBatch)
	if staged.Code != 0 {
		t.Fatalf("stage delete %s failed: %s", path, staged.Msg)
	}
	commit := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
	if commit.Code != 0 {
		t.Fatalf("commit failed: %s", commit.Msg)
	}
	if _, err := os.Lstat(filepath.Join(util.DataDir, "storage", "petal", "test-plugin", "history", "run")); !os.IsNotExist(err) {
		t.Fatalf("history tree still exists: %v", err)
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

func TestWorkspacePathComparisonKeyForCaseInsensitiveVolume(t *testing.T) {
	left := workspacePathComparisonKeyFor(`C:\Workspace\data\assets\Foo.bin`, true)
	right := workspacePathComparisonKeyFor(`c:\workspace\data\assets\foo.bin`, true)
	if left != right {
		t.Fatalf("case-insensitive comparison keys differ: %q != %q", left, right)
	}
}

func TestDetectPathCaseInsensitiveMatchesFilesystem(t *testing.T) {
	probe := filepath.Join(t.TempDir(), "CaseProbe")
	if err := os.Mkdir(probe, 0755); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(probe)
	if err != nil {
		t.Fatal(err)
	}
	alternateInfo, alternateErr := os.Lstat(filepath.Join(filepath.Dir(probe), "caseProbe"))
	actual := alternateErr == nil && os.SameFile(info, alternateInfo)
	if detected := detectPathCaseInsensitive(probe); detected != actual {
		t.Fatalf("case sensitivity detection mismatch: detected=%v actual=%v", detected, actual)
	}
}

func TestKernelSyncServiceRejectsCaseInsensitiveTargetCollision(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("requires a case-insensitive Windows workspace")
	}
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() { util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp }()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	stage := func(path string, content []byte) kernelSyncTestEnvelope {
		hash := sha256.Sum256(content)
		query := url.Values{
			"sessionId": {session.SessionID}, "operation": {"write"}, "path": {path}, "offset": {"0"},
			"size": {fmt.Sprint(len(content))}, "hash": {fmt.Sprintf("sha256:%x", hash[:])},
			"modTime": {"1700000000"}, "ifNoneMatch": {"true"}, "final": {"true"},
		}
		return invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), content, stageKernelSyncBatch)
	}
	if staged := stage("/data/assets/Foo.bin", []byte("first")); staged.Code != 0 {
		t.Fatalf("first stage failed: %s", staged.Msg)
	}
	if staged := stage("/data/assets/foo.bin", []byte("second")); staged.Code != http.StatusConflict {
		t.Fatalf("expected physical target collision, got %d: %s", staged.Code, staged.Msg)
	}
	aborted := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
	if aborted.Code != 0 {
		t.Fatalf("abort failed: %s", aborted.Msg)
	}
}

func TestKernelSyncConcurrentAbortObservesCommittedReceipt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	reloadReached := make(chan struct{})
	reloadContinue := make(chan struct{})
	kernelSyncReloadFiletree = func() {
		close(reloadReached)
		<-reloadContinue
	}
	kernelSyncIncSync = func() { model.AdvanceWorkspaceGeneration() }
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
		kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync
	}()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	content := []byte("committed while abort waits")
	hash := sha256.Sum256(content)
	query := url.Values{
		"sessionId": {session.SessionID}, "operation": {"write"}, "path": {"/data/assets/race.bin"}, "offset": {"0"},
		"size": {fmt.Sprint(len(content))}, "hash": {fmt.Sprintf("sha256:%x", hash[:])},
		"modTime": {"1700000000"}, "ifNoneMatch": {"true"}, "final": {"true"},
	}
	if staged := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), content, stageKernelSyncBatch); staged.Code != 0 {
		t.Fatalf("stage failed: %s", staged.Msg)
	}
	type handlerResult struct {
		envelope kernelSyncTestEnvelope
		err      error
	}
	commitResult := make(chan handlerResult, 1)
	go func() {
		envelope, err := invokeKernelSyncTestHandlerResult(http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
		commitResult <- handlerResult{envelope: envelope, err: err}
	}()
	select {
	case <-reloadReached:
	case <-time.After(5 * time.Second):
		t.Fatal("commit did not reach the terminal publication point")
	}
	abortResult := make(chan handlerResult, 1)
	go func() {
		envelope, err := invokeKernelSyncTestHandlerResult(http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
		abortResult <- handlerResult{envelope: envelope, err: err}
	}()
	time.Sleep(20 * time.Millisecond)
	close(reloadContinue)
	committed := <-commitResult
	if committed.err != nil || committed.envelope.Code != 0 {
		t.Fatalf("commit failed: %+v %v", committed.envelope, committed.err)
	}
	aborted := <-abortResult
	if aborted.err != nil || aborted.envelope.Code != 0 || !bytes.Contains(aborted.envelope.Data, []byte(`"committed":true`)) {
		t.Fatalf("abort did not observe the committed receipt: %+v %v", aborted.envelope, aborted.err)
	}
}

func TestKernelSyncAbortResumesDurableDecisionAfterInjectedPublicationFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	previousFaultHook := kernelSyncCommitFaultHook
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	kernelSyncReloadFiletree = func() {}
	kernelSyncIncSync = func() { model.AdvanceWorkspaceGeneration() }
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
		kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync
		kernelSyncCommitFaultHook = previousFaultHook
	}()
	assetsDir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	contents := map[string][]byte{
		"/data/assets/first.bin":  []byte("first durable payload"),
		"/data/assets/second.bin": []byte("second durable payload"),
	}
	for path, content := range contents {
		hash := sha256.Sum256(content)
		query := url.Values{
			"sessionId": {session.SessionID}, "operation": {"write"}, "path": {path}, "offset": {"0"},
			"size": {fmt.Sprint(len(content))}, "hash": {fmt.Sprintf("sha256:%x", hash[:])},
			"modTime": {"1700000000"}, "ifNoneMatch": {"true"}, "final": {"true"},
		}
		if staged := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), content, stageKernelSyncBatch); staged.Code != 0 {
			t.Fatalf("stage %s failed: %s", path, staged.Msg)
		}
	}
	injected := false
	kernelSyncCommitFaultHook = func(point string, index int) error {
		if point == "publish" && index == 1 && !injected {
			injected = true
			return fmt.Errorf("injected live publication failure")
		}
		return nil
	}
	failed := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
	if failed.Code != http.StatusInternalServerError {
		t.Fatalf("expected injected commit failure, got %d: %s", failed.Code, failed.Msg)
	}
	walPath := synccommit.IntentPath(session.SessionID)
	if _, err := os.Stat(walPath); err != nil {
		t.Fatalf("durable decision WAL was not preserved: %v", err)
	}
	kernelSyncCommitFaultHook = nil
	resumed := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
	if resumed.Code != 0 || !bytes.Contains(resumed.Data, []byte(`"committed":true`)) {
		t.Fatalf("abort did not resume the durable decision: %d %s %s", resumed.Code, resumed.Msg, resumed.Data)
	}
	for path, content := range contents {
		actual, err := os.ReadFile(filepath.Join(workspace, filepath.FromSlash(strings.TrimPrefix(path, "/"))))
		if err != nil || !bytes.Equal(actual, content) {
			t.Fatalf("recovered %s mismatch: %q %v", path, actual, err)
		}
	}
	if _, err := os.Stat(walPath); !os.IsNotExist(err) {
		t.Fatalf("resumed commit retained WAL: %v", err)
	}
}

func TestKernelSyncCommitReportsSuccessWhenPostDecisionCleanupFails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	previousFaultHook := kernelSyncCommitFaultHook
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	kernelSyncReloadFiletree = func() {}
	kernelSyncIncSync = func() { model.AdvanceWorkspaceGeneration() }
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
		kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync
		kernelSyncCommitFaultHook = previousFaultHook
	}()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	content := []byte("committed before cleanup failure")
	hash := sha256.Sum256(content)
	query := url.Values{
		"sessionId": {session.SessionID}, "operation": {"write"}, "path": {"/data/assets/cleanup.bin"}, "offset": {"0"},
		"size": {fmt.Sprint(len(content))}, "hash": {fmt.Sprintf("sha256:%x", hash[:])},
		"modTime": {"1700000000"}, "ifNoneMatch": {"true"}, "final": {"true"},
	}
	if staged := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), content, stageKernelSyncBatch); staged.Code != 0 {
		t.Fatalf("stage failed: %s", staged.Msg)
	}
	kernelSyncCommitFaultHook = func(point string, _ int) error {
		if point == "cleanup" {
			return fmt.Errorf("injected cleanup failure")
		}
		return nil
	}
	commit := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
	if commit.Code != 0 || !bytes.Contains(commit.Data, []byte(`"committed":true`)) || !bytes.Contains(commit.Data, []byte(`"cleanupPending":true`)) {
		t.Fatalf("post-decision cleanup failure was reported as an aborted commit: %d %s %s", commit.Code, commit.Msg, commit.Data)
	}
	if _, err := os.Stat(synccommit.IntentPath(session.SessionID)); err != nil {
		t.Fatalf("cleanup failure did not retain the WAL: %v", err)
	}
	kernelSyncCommitFaultHook = nil
	if err := kernelSyncEngine.RecoverAll(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(synccommit.IntentPath(session.SessionID)); !os.IsNotExist(err) {
		t.Fatalf("recovery did not retire cleanup WAL: %v", err)
	}
}

func TestKernelSyncConcurrentCommitsShareTerminalReceipt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	reloadReached := make(chan struct{})
	reloadContinue := make(chan struct{})
	kernelSyncReloadFiletree = func() {
		close(reloadReached)
		<-reloadContinue
	}
	kernelSyncIncSync = func() { model.AdvanceWorkspaceGeneration() }
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
		kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync
	}()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	content := []byte("one publication, two commit callers")
	hash := sha256.Sum256(content)
	query := url.Values{
		"sessionId": {session.SessionID}, "operation": {"write"}, "path": {"/data/assets/concurrent.bin"}, "offset": {"0"},
		"size": {fmt.Sprint(len(content))}, "hash": {fmt.Sprintf("sha256:%x", hash[:])},
		"modTime": {"1700000000"}, "ifNoneMatch": {"true"}, "final": {"true"},
	}
	if staged := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), content, stageKernelSyncBatch); staged.Code != 0 {
		t.Fatalf("stage failed: %s", staged.Msg)
	}
	type handlerResult struct {
		envelope kernelSyncTestEnvelope
		err      error
	}
	results := make(chan handlerResult, 2)
	commitTarget := "/api/sync/kernel/commit?sessionId=" + session.SessionID
	go func() {
		envelope, err := invokeKernelSyncTestHandlerResult(http.MethodPost, commitTarget, nil, commitKernelSync)
		results <- handlerResult{envelope: envelope, err: err}
	}()
	select {
	case <-reloadReached:
	case <-time.After(5 * time.Second):
		t.Fatal("first commit did not reach terminal publication")
	}
	go func() {
		envelope, err := invokeKernelSyncTestHandlerResult(http.MethodPost, commitTarget, nil, commitKernelSync)
		results <- handlerResult{envelope: envelope, err: err}
	}()
	time.Sleep(20 * time.Millisecond)
	close(reloadContinue)
	for index := 0; index < 2; index++ {
		result := <-results
		if result.err != nil || result.envelope.Code != 0 || !bytes.Contains(result.envelope.Data, []byte(`"committed":true`)) {
			t.Fatalf("concurrent commit %d failed: %+v %v", index, result.envelope, result.err)
		}
	}
}

func TestKernelSyncPreconditionFailureDoesNotCreateParentDirectories(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() { util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp }()
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
	content := []byte("must not create directories")
	hash := sha256.Sum256(content)
	query := url.Values{
		"sessionId": {session.SessionID}, "operation": {"write"}, "path": {"/data/missing/deeper/file.bin"}, "offset": {"0"},
		"size": {fmt.Sprint(len(content))}, "hash": {fmt.Sprintf("sha256:%x", hash[:])},
		"modTime": {"1700000000"}, "ifMatch": {"sha256:" + string(bytes.Repeat([]byte{'0'}, 64))}, "final": {"true"},
	}
	if staged := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), content, stageKernelSyncBatch); staged.Code != 0 {
		t.Fatalf("stage failed: %s", staged.Msg)
	}
	commit := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
	if commit.Code != http.StatusConflict {
		t.Fatalf("expected missing-target precondition conflict, got %d: %s", commit.Code, commit.Msg)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "missing")); !os.IsNotExist(err) {
		t.Fatalf("precondition failure created parent directories: %v", err)
	}
	_ = invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
}

func TestKernelSyncStageStreamsChunksAndValidatesOverlap(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() { util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp }()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	content := bytes.Repeat([]byte("streamed-chunk-"), 64*1024)
	digest := sha256.Sum256(content)
	half := len(content) / 2
	stage := func(offset int, final bool, chunk []byte) kernelSyncTestEnvelope {
		query := url.Values{
			"sessionId": {session.SessionID}, "operation": {"write"}, "path": {"/data/assets/stream.bin"},
			"offset": {fmt.Sprint(offset)}, "size": {fmt.Sprint(len(content))},
			"hash": {fmt.Sprintf("sha256:%x", digest[:])}, "modTime": {"1700000000"},
			"ifNoneMatch": {"true"}, "final": {fmt.Sprint(final)},
		}
		return invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), chunk, stageKernelSyncBatch)
	}
	if result := stage(0, false, content[:half]); result.Code != 0 {
		t.Fatalf("first streamed chunk failed: %s", result.Msg)
	}
	if result := stage(0, false, content[:half]); result.Code != 0 {
		t.Fatalf("overlap retry failed: %s", result.Msg)
	}
	if result := stage(half, true, content[half:]); result.Code != 0 || !bytes.Contains(result.Data, []byte(`"complete":true`)) {
		t.Fatalf("final streamed chunk failed: %d %s %s", result.Code, result.Msg, result.Data)
	}
	chunkFiles, err := filepath.Glob(filepath.Join(util.TempDir, "kernel-sync", "session-*", ".chunk-*"))
	if err != nil || len(chunkFiles) != 0 {
		t.Fatalf("streamed staging leaked temporary chunks: %v %v", chunkFiles, err)
	}
	_ = invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/abort?sessionId="+session.SessionID, nil, abortKernelSync)
}

func TestKernelSyncCommitWaitsForInflightStage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	kernelSyncReloadFiletree = func() {}
	kernelSyncIncSync = func() { model.AdvanceWorkspaceGeneration() }
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
		kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync
	}()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	begin := invokeKernelSyncTestHandler(t, http.MethodPost, "/api/sync/kernel/begin", kernelSyncTestBeginBody(t), beginKernelSync)
	var session struct {
		SessionID string `json:"sessionId"`
	}
	if begin.Code != 0 || json.Unmarshal(begin.Data, &session) != nil {
		t.Fatalf("begin failed: %s", begin.Msg)
	}
	content := []byte("commit must wait for this staged body")
	digest := sha256.Sum256(content)
	query := url.Values{
		"sessionId": {session.SessionID}, "operation": {"write"}, "path": {"/data/assets/inflight.bin"},
		"offset": {"0"}, "size": {fmt.Sprint(len(content))}, "hash": {fmt.Sprintf("sha256:%x", digest[:])},
		"modTime": {"1700000000"}, "ifNoneMatch": {"true"}, "final": {"true"},
	}
	reader := &gatedKernelSyncReader{data: append([]byte(nil), content...), started: make(chan struct{}), release: make(chan struct{})}
	type handlerResult struct {
		envelope kernelSyncTestEnvelope
		err      error
	}
	stageResult := make(chan handlerResult, 1)
	go func() {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/sync/kernel/stageBatch?"+query.Encode(), reader)
		stageKernelSyncBatch(context)
		var envelope kernelSyncTestEnvelope
		err := json.Unmarshal(recorder.Body.Bytes(), &envelope)
		stageResult <- handlerResult{envelope: envelope, err: err}
	}()
	select {
	case <-reader.started:
	case <-time.After(5 * time.Second):
		t.Fatal("stage handler did not start reading")
	}
	commitResult := make(chan handlerResult, 1)
	go func() {
		envelope, err := invokeKernelSyncTestHandlerResult(http.MethodPost,
			"/api/sync/kernel/commit?sessionId="+session.SessionID, nil, commitKernelSync)
		commitResult <- handlerResult{envelope: envelope, err: err}
	}()
	select {
	case result := <-commitResult:
		t.Fatalf("commit completed before stage: %+v", result)
	case <-time.After(50 * time.Millisecond):
	}
	close(reader.release)
	staged := <-stageResult
	if staged.err != nil || staged.envelope.Code != 0 {
		t.Fatalf("stage failed: %+v %v", staged.envelope, staged.err)
	}
	committed := <-commitResult
	if committed.err != nil || committed.envelope.Code != 0 {
		t.Fatalf("commit failed after stage: %+v %v", committed.envelope, committed.err)
	}
}
