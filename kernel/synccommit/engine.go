// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"errors"
	"os"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
)

const maxPreparedDocumentBytes = int64(512 * 1024 * 1024)

type documentLocation struct {
	boxID string
	path  string
}

type executionGroup struct {
	key    string
	parent *os.Root
}

type executionItem struct {
	change     Change
	guard      PathGuard
	relative   string
	targetName string
	group      *executionGroup
	stagedName string
	backupName string
	sourceName string
	existed    bool
	document   bool
	location   documentLocation
	validated  *filesys.ValidatedDocument
}

type execution struct {
	items      []*executionItem
	groups     map[string]*executionGroup
	indexBatch *model.RawDocumentIndexBatch
	intent     Intent
	unlock     func()
}

func (execution *execution) close() {
	if execution.indexBatch != nil {
		execution.indexBatch.Unlock()
		execution.indexBatch = nil
	}
	for _, group := range execution.groups {
		_ = group.parent.Close()
	}
	if execution.unlock != nil {
		execution.unlock()
		execution.unlock = nil
	}
}

func (engine *Engine) Commit(request CommitRequest) (Result, error) {
	if engine == nil {
		return Result{}, wrapError(ErrorInternal, false, errors.New("sync commit engine is nil"))
	}
	if err := validateCommitRequest(request); err != nil {
		return Result{}, wrapError(ErrorInvalid, false, err)
	}
	if receipt, exists := LookupReceipt(request.SessionID, request.Owner); exists {
		cleanupPending := false
		if _, statErr := os.Lstat(IntentPath(request.SessionID)); statErr == nil {
			intent, readErr := readIntent(IntentPath(request.SessionID))
			if readErr != nil || engine.cleanupRecordedIntent(IntentPath(request.SessionID), intent) != nil {
				cleanupPending = true
			}
		}
		return Result{Receipt: receipt, Decided: true, Resumed: true, CleanupPending: cleanupPending}, nil
	}
	intentPath := IntentPath(request.SessionID)
	if _, err := os.Lstat(intentPath); err == nil {
		result, resumeErr := engine.resumePath(intentPath, request.Owner)
		result.Resumed = true
		return result, resumeErr
	} else if !os.IsNotExist(err) {
		return Result{}, wrapError(ErrorInternal, false, err)
	}
	plan, err := engine.Plan(request)
	if err != nil {
		return Result{}, err
	}
	return engine.CommitPlan(plan)
}

func (engine *Engine) Plan(request CommitRequest) (*Plan, error) {
	if err := validateCommitRequest(request); err != nil {
		return nil, wrapError(ErrorInvalid, false, err)
	}
	if request.ExpectedGeneration != model.WorkspaceGeneration() {
		return nil, wrapError(ErrorConflict, false, errors.New("workspace generation changed"))
	}
	execution, err := engine.prepareOnline(request)
	if err != nil {
		return nil, err
	}
	return &Plan{request: request, execution: execution}, nil
}

func (engine *Engine) CommitPlan(plan *Plan) (Result, error) {
	if plan == nil || plan.execution == nil || !plan.closed.CompareAndSwap(false, true) {
		return Result{}, wrapError(ErrorInvalid, false, errors.New("kernel sync plan is closed"))
	}
	request := plan.request
	execution := plan.execution
	plan.execution = nil
	defer execution.close()
	decided := false
	defer func() {
		if !decided {
			_ = execution.cleanupArtifacts()
		}
	}()
	if request.ExpectedGeneration != model.WorkspaceGeneration() {
		return Result{}, wrapError(ErrorConflict, false, errors.New("workspace generation changed"))
	}
	if request.EnterCritical == nil || !request.EnterCritical() {
		return Result{}, wrapError(ErrorLocked, false, errors.New("kernel sync lease cannot enter commit"))
	}
	if err := execution.createBackups(); err != nil {
		return Result{}, wrapError(ErrorInternal, false, err)
	}
	if err := execution.syncGroups(); err != nil {
		return Result{}, wrapError(ErrorInternal, false, err)
	}
	if err := engine.inject("prepared-durable", 0); err != nil {
		return Result{}, wrapError(ErrorInternal, false, err)
	}
	execution.intent = execution.buildIntent(request.SessionID, request.Owner)
	if err := engine.inject("intent", 0); err != nil {
		return Result{}, wrapError(ErrorInternal, false, err)
	}
	intentPath, renamed, err := writeIntent(execution.intent)
	decided = renamed
	if renamed {
		if faultErr := engine.inject("intent-renamed", 0); err == nil {
			err = faultErr
		}
	}
	if err != nil {
		return Result{Decided: renamed}, wrapError(ErrorInternal, renamed, err)
	}
	result, err := engine.resumeExecution(intentPath, execution)
	result.Decided = true
	return result, wrapError(ErrorInternal, true, err)
}

func validateCommitRequest(request CommitRequest) error {
	if !validSessionID(request.SessionID) || request.Owner == "" || request.ExpectedGeneration == 0 ||
		len(request.Changes) == 0 || len(request.Changes) > maxIntentChanges {
		return errors.New("invalid kernel sync commit request")
	}
	seen := map[string]struct{}{}
	for _, change := range request.Changes {
		if change.Path == "" || (change.Operation != OperationWrite && change.Operation != OperationDelete) {
			return errors.New("invalid kernel sync change")
		}
		if _, exists := seen[change.Path]; exists {
			return errors.New("duplicate kernel sync change path")
		}
		seen[change.Path] = struct{}{}
		if change.Operation == OperationWrite && (change.StagePath == "" || change.Size < 0 || !strings.HasPrefix(change.Hash, contentHashPrefix)) {
			return errors.New("invalid kernel sync write")
		}
	}
	return nil
}
