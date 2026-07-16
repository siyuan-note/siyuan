// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func withEngineWorkspace(t *testing.T) string {
	t.Helper()
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	logging.SetLogPath(filepath.Join(util.TempDir, "synccommit-test.log"))
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
	})
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	return workspace
}

func testCommitRequest(t *testing.T, sessionID, targetPath string, oldContent, newContent []byte) CommitRequest {
	t.Helper()
	stagePath := filepath.Join(util.TempDir, sessionID+".stage")
	if err := os.MkdirAll(filepath.Dir(stagePath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stagePath, newContent, 0600); err != nil {
		t.Fatal(err)
	}
	oldHash := sha256.Sum256(oldContent)
	newHash := sha256.Sum256(newContent)
	return CommitRequest{
		SessionID: sessionID, Owner: "test-owner", ExpectedGeneration: model.WorkspaceGeneration(),
		EnterCritical: func() bool { return true },
		Changes: []Change{{
			Operation: OperationWrite, Path: targetPath, StagePath: stagePath, Size: int64(len(newContent)),
			Hash: fmt.Sprintf("sha256:%x", newHash[:]), IfMatch: fmt.Sprintf("sha256:%x", oldHash[:]),
		}},
	}
}

func TestEngineResumesEveryDurableStage(t *testing.T) {
	points := []string{"intent-renamed", "publish", "published", "indexed", "receipt", "receipt-persisted", "cleanup", "retire"}
	for index, point := range points {
		t.Run(point, func(t *testing.T) {
			withEngineWorkspace(t)
			target := filepath.Join(util.DataDir, "assets", "target.bin")
			oldContent := []byte("old")
			newContent := []byte("new durable content")
			if err := os.WriteFile(target, oldContent, 0644); err != nil {
				t.Fatal(err)
			}
			sessionID := fmt.Sprintf("%048x", index+1)
			request := testCommitRequest(t, sessionID, "/data/assets/target.bin", oldContent, newContent)
			var activePoint = point
			fired := false
			engine := NewEngine(Options{
				Advance: func() uint64 { return model.AdvanceWorkspaceGeneration() },
				FaultHook: func(actual string, _ int) error {
					if actual == activePoint && !fired {
						fired = true
						return fmt.Errorf("injected %s failure", actual)
					}
					return nil
				},
			})
			result, err := engine.Commit(request)
			if !fired {
				t.Fatalf("fault point %s was not reached", point)
			}
			if point == "cleanup" || point == "retire" {
				if err != nil || !result.CleanupPending {
					t.Fatalf("post-receipt failure must return committed cleanup debt: %+v %v", result, err)
				}
			} else if err == nil {
				t.Fatalf("fault point %s did not interrupt the first attempt", point)
			}
			activePoint = ""
			resumed, resumeErr := engine.Resume(sessionID, request.Owner)
			if resumeErr != nil || resumed.Receipt.SessionID != sessionID {
				t.Fatalf("resume %s failed: %+v %v", point, resumed, resumeErr)
			}
			actual, readErr := os.ReadFile(target)
			if readErr != nil || !bytes.Equal(actual, newContent) {
				t.Fatalf("resumed content mismatch: %q %v", actual, readErr)
			}
			if _, statErr := os.Stat(IntentPath(sessionID)); !os.IsNotExist(statErr) {
				t.Fatalf("resumed intent was not retired: %v", statErr)
			}
			if _, statErr := os.Stat(receiptPath(sessionID)); statErr != nil {
				t.Fatalf("durable receipt is missing: %v", statErr)
			}
			if _, exists := LookupReceipt(sessionID, "wrong-owner"); exists {
				t.Fatal("durable receipt was exposed to another owner")
			}
		})
	}
}

func TestEngineAbortsEveryPreDecisionStage(t *testing.T) {
	for index, point := range []string{"staged", "prepared-durable", "intent"} {
		t.Run(point, func(t *testing.T) {
			withEngineWorkspace(t)
			target := filepath.Join(util.DataDir, "assets", "target.bin")
			oldContent := []byte("old")
			newContent := []byte("new")
			if err := os.WriteFile(target, oldContent, 0644); err != nil {
				t.Fatal(err)
			}
			sessionID := fmt.Sprintf("%048x", 20+index)
			request := testCommitRequest(t, sessionID, "/data/assets/target.bin", oldContent, newContent)
			fired := false
			engine := NewEngine(Options{FaultHook: func(actual string, _ int) error {
				if actual == point && !fired {
					fired = true
					return fmt.Errorf("injected %s failure", actual)
				}
				return nil
			}})
			result, err := engine.Commit(request)
			if err == nil || result.Decided || !fired {
				t.Fatalf("pre-decision fault did not abort cleanly: %+v %v", result, err)
			}
			if _, statErr := os.Stat(IntentPath(sessionID)); !os.IsNotExist(statErr) {
				t.Fatalf("pre-decision fault retained an intent: %v", statErr)
			}
			actual, readErr := os.ReadFile(target)
			if readErr != nil || !bytes.Equal(actual, oldContent) {
				t.Fatalf("pre-decision fault changed target: %q %v", actual, readErr)
			}
			leftovers, globErr := filepath.Glob(filepath.Join(filepath.Dir(target), ".siyuan-*.tmp"))
			if globErr != nil || len(leftovers) != 0 {
				t.Fatalf("pre-decision fault leaked artifacts: %v %v", leftovers, globErr)
			}
		})
	}
}

func TestEngineRecoversPartialWriteAndDelete(t *testing.T) {
	withEngineWorkspace(t)
	writeTarget := filepath.Join(util.DataDir, "assets", "write.bin")
	deleteTarget := filepath.Join(util.DataDir, "assets", "delete.bin")
	if err := os.WriteFile(writeTarget, []byte("old write"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(deleteTarget, []byte("old delete"), 0644); err != nil {
		t.Fatal(err)
	}
	sessionID := "111111111111111111111111111111111111111111111111"
	writeContent := []byte("new write")
	request := testCommitRequest(t, sessionID, "/data/assets/write.bin", []byte("old write"), writeContent)
	deleteHash := sha256.Sum256([]byte("old delete"))
	request.Changes = append(request.Changes, Change{
		Operation: OperationDelete, Path: "/data/assets/delete.bin", IfMatch: fmt.Sprintf("sha256:%x", deleteHash[:]),
	})
	fired := false
	engine := NewEngine(Options{
		Advance: func() uint64 { return model.AdvanceWorkspaceGeneration() },
		FaultHook: func(point string, index int) error {
			if point == "publish" && index == 1 && !fired {
				fired = true
				return fmt.Errorf("injected partial publication")
			}
			return nil
		},
	})
	if result, err := engine.Commit(request); err == nil || !result.Decided {
		t.Fatalf("partial publication did not retain a decided intent: %+v %v", result, err)
	}
	if _, err := os.Stat(deleteTarget); err != nil {
		t.Fatalf("pending deletion changed before resume: %v", err)
	}
	engine.options.FaultHook = nil
	if _, err := engine.Resume(sessionID, request.Owner); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(writeTarget)
	if err != nil || !bytes.Equal(actual, writeContent) {
		t.Fatalf("write recovery mismatch: %q %v", actual, err)
	}
	if _, err = os.Stat(deleteTarget); !os.IsNotExist(err) {
		t.Fatalf("delete recovery mismatch: %v", err)
	}
}

func TestEngineSharesParentHandlesAcrossLargeBatch(t *testing.T) {
	withEngineWorkspace(t)
	const count = 256
	request := CommitRequest{
		SessionID: "222222222222222222222222222222222222222222222222", Owner: "test-owner",
		ExpectedGeneration: model.WorkspaceGeneration(), EnterCritical: func() bool { return true },
		Changes: make([]Change, 0, count),
	}
	for index := 0; index < count; index++ {
		content := []byte(fmt.Sprintf("content-%d", index))
		digest := sha256.Sum256(content)
		stagePath := filepath.Join(util.TempDir, fmt.Sprintf("stage-%03d", index))
		if err := os.MkdirAll(filepath.Dir(stagePath), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(stagePath, content, 0600); err != nil {
			t.Fatal(err)
		}
		request.Changes = append(request.Changes, Change{
			Operation: OperationWrite, Path: fmt.Sprintf("/data/assets/file-%03d.bin", index), StagePath: stagePath,
			Size: int64(len(content)), Hash: fmt.Sprintf("sha256:%x", digest[:]), ModTime: time.Now(), IfNoneMatch: true,
		})
	}
	engine := NewEngine(Options{})
	execution, err := engine.prepareOnline(request)
	if err != nil {
		t.Fatal(err)
	}
	defer execution.close()
	defer execution.cleanupArtifacts()
	if len(execution.groups) != 1 {
		t.Fatalf("same physical parent opened %d times", len(execution.groups))
	}
}

func TestEngineRecoversAfterRealProcessCrash(t *testing.T) {
	points := []string{"intent-renamed", "publish", "receipt-persisted"}
	for index, point := range points {
		t.Run(point, func(t *testing.T) {
			workspace := withEngineWorkspace(t)
			target := filepath.Join(util.DataDir, "assets", "crash.bin")
			oldContent := []byte("old crash content")
			newContent := []byte("new crash content")
			if err := os.WriteFile(target, oldContent, 0644); err != nil {
				t.Fatal(err)
			}
			sessionID := fmt.Sprintf("%048x", 100+index)
			request := testCommitRequest(t, sessionID, "/data/assets/crash.bin", oldContent, newContent)
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			command := exec.Command(executable, "-test.run=^TestSyncCommitCrashHelper$")
			command.Env = append(os.Environ(),
				"SIYUAN_SYNC_CRASH_HELPER=1", "SIYUAN_SYNC_CRASH_POINT="+point,
				"SIYUAN_SYNC_WORKSPACE="+workspace, "SIYUAN_SYNC_SESSION="+sessionID,
				"SIYUAN_SYNC_STAGE="+request.Changes[0].StagePath,
			)
			if runErr := command.Run(); runErr == nil {
				t.Fatal("crash helper exited successfully")
			}
			engine := NewEngine(Options{Advance: func() uint64 { return model.AdvanceWorkspaceGeneration() }})
			if err = engine.RecoverAll(); err != nil {
				t.Fatal(err)
			}
			actual, readErr := os.ReadFile(target)
			if readErr != nil || !bytes.Equal(actual, newContent) {
				t.Fatalf("crash recovery mismatch: %q %v", actual, readErr)
			}
		})
	}
}

func TestSyncCommitCrashHelper(t *testing.T) {
	if os.Getenv("SIYUAN_SYNC_CRASH_HELPER") != "1" {
		return
	}
	workspace := os.Getenv("SIYUAN_SYNC_WORKSPACE")
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	logging.SetLogPath(filepath.Join(util.TempDir, "synccommit-test.log"))
	target, err := os.ReadFile(filepath.Join(util.DataDir, "assets", "crash.bin"))
	if err != nil {
		os.Exit(70)
	}
	newContent := []byte("new crash content")
	newHash := sha256.Sum256(newContent)
	oldHash := sha256.Sum256(target)
	request := CommitRequest{
		SessionID: os.Getenv("SIYUAN_SYNC_SESSION"), Owner: "test-owner", ExpectedGeneration: model.WorkspaceGeneration(),
		EnterCritical: func() bool { return true },
		Changes: []Change{{
			Operation: OperationWrite, Path: "/data/assets/crash.bin", StagePath: os.Getenv("SIYUAN_SYNC_STAGE"),
			Size: int64(len(newContent)), Hash: fmt.Sprintf("sha256:%x", newHash[:]), IfMatch: fmt.Sprintf("sha256:%x", oldHash[:]),
		}},
	}
	crashPoint := os.Getenv("SIYUAN_SYNC_CRASH_POINT")
	engine := NewEngine(Options{
		Advance: func() uint64 { return model.AdvanceWorkspaceGeneration() },
		FaultHook: func(point string, _ int) error {
			if point == crashPoint {
				os.Exit(73)
			}
			return nil
		},
	})
	_, _ = engine.Commit(request)
	os.Exit(74)
}

func TestDefaultRecoveryReadinessFailsClosed(t *testing.T) {
	withEngineWorkspace(t)
	SetRecoveryPending()
	t.Cleanup(SetRecoveryPending)
	if Ready() {
		t.Fatal("recovery readiness opened before recovery")
	}
	if err := os.MkdirAll(intentDir(), 0700); err != nil {
		t.Fatal(err)
	}
	brokenIntentPath := IntentPath("ffffffffffffffffffffffffffffffffffffffffffffffff")
	if err := os.WriteFile(brokenIntentPath, []byte("not valid JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Recover(); err == nil {
		t.Fatal("invalid intent directory did not fail recovery")
	}
	if Ready() {
		t.Fatal("failed recovery opened readiness gate")
	}
	if err := os.Remove(brokenIntentPath); err != nil {
		t.Fatal(err)
	}
	if err := Recover(); err != nil {
		t.Fatal(err)
	}
	if !Ready() {
		t.Fatal("successful recovery did not open readiness gate")
	}
}
