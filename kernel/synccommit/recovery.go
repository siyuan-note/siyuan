// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var recoveryMu sync.Mutex

func (engine *Engine) Resume(sessionID, owner string) (Result, error) {
	if receipt, exists := LookupReceipt(sessionID, owner); exists {
		intentPath := IntentPath(sessionID)
		cleanupPending := false
		if _, statErr := os.Lstat(intentPath); statErr == nil {
			intent, readErr := readIntent(intentPath)
			if readErr != nil || engine.cleanupRecordedIntent(intentPath, intent) != nil {
				cleanupPending = true
			}
		}
		return Result{Receipt: receipt, Decided: true, Resumed: true, CleanupPending: cleanupPending}, nil
	}
	result, err := engine.resumePath(IntentPath(sessionID), owner)
	result.Resumed = true
	return result, err
}

func (engine *Engine) RecoverAll() error {
	recoveryMu.Lock()
	defer recoveryMu.Unlock()
	paths, err := listIntentPaths()
	if err != nil {
		return err
	}
	var errs []error
	for _, intentPath := range paths {
		if _, resumeErr := engine.resumePath(intentPath, ""); resumeErr != nil {
			errs = append(errs, fmt.Errorf("recover kernel sync intent %s: %w", filepath.Base(intentPath), resumeErr))
		}
	}
	if pruneErr := pruneReceipts(time.Now()); pruneErr != nil {
		errs = append(errs, pruneErr)
	}
	return errors.Join(errs...)
}

func (engine *Engine) resumePath(intentPath, expectedOwner string) (Result, error) {
	intent, err := readIntent(intentPath)
	if err != nil {
		return Result{Decided: true}, wrapError(ErrorInternal, true, err)
	}
	if expectedOwner != "" && intent.Owner != expectedOwner {
		return Result{Decided: true}, wrapError(ErrorForbidden, true, errors.New("kernel sync intent owner does not match"))
	}
	if receipt, exists := LookupReceipt(intent.SessionID, intent.Owner); exists {
		cleanupErr := engine.cleanupRecordedIntent(intentPath, intent)
		return Result{Receipt: receipt, Decided: true, Resumed: true, CleanupPending: cleanupErr != nil}, nil
	}
	execution, err := engine.prepareRecovery(intent)
	if err != nil {
		return Result{Decided: true}, wrapError(ErrorInternal, true, err)
	}
	defer execution.close()
	return engine.resumeExecution(intentPath, execution)
}

func (engine *Engine) prepareRecovery(intent Intent) (*execution, error) {
	execution := &execution{intent: intent, groups: map[string]*executionGroup{}}
	physicalTargets := map[string]struct{}{}
	for _, change := range intent.Changes {
		guard, err := ResolvePath(change.Path, true)
		if err != nil {
			return nil, err
		}
		if guard.RejectsEncryptedBox() || !SameOrNestedPath(filepath.Clean(util.DataDir), guard.AbsPath()) ||
			SamePath(filepath.Clean(util.DataDir), guard.AbsPath()) {
			return nil, errors.New("kernel sync recovery must target plaintext /data descendants")
		}
		targetKey := ComparisonKey(guard.ResolvedPath())
		if _, exists := physicalTargets[targetKey]; exists {
			return nil, errors.New("kernel sync recovery contains duplicate physical targets")
		}
		physicalTargets[targetKey] = struct{}{}
		_, location, document, locationErr := notebookDocumentLocation(guard)
		if locationErr != nil {
			return nil, locationErr
		}
		execution.items = append(execution.items, &executionItem{
			change: Change{
				Operation: change.Operation, Path: change.Path, Size: change.Size, Hash: change.Hash,
				IfNoneMatch: change.IfNoneMatch,
			},
			guard: guard, targetName: change.TargetName, stagedName: change.StagedName,
			backupName: change.BackupName, document: document, location: location,
		})
	}
	guards := make([]PathGuard, len(execution.items))
	for index, item := range execution.items {
		guards[index] = item.guard
	}
	execution.unlock = LockPaths(guards...)
	succeeded := false
	defer func() {
		if !succeeded {
			execution.close()
		}
	}()
	for _, item := range execution.items {
		if err := item.guard.Revalidate(); err != nil {
			return nil, err
		}
		workspaceRoot, relativePath, err := item.guard.OpenWorkspaceRoot()
		if err != nil {
			return nil, err
		}
		parent, targetName, err := OpenRootParent(workspaceRoot, relativePath, item.change.Operation == OperationWrite)
		_ = workspaceRoot.Close()
		if err != nil {
			return nil, err
		}
		if targetName != item.targetName {
			_ = parent.Close()
			return nil, errors.New("kernel sync recovery target changed")
		}
		groupKey := ComparisonKey(filepath.Dir(item.guard.ResolvedPath()))
		if group := execution.groups[groupKey]; group != nil {
			_ = parent.Close()
			item.group = group
		} else {
			item.group = &executionGroup{key: groupKey, parent: parent}
			execution.groups[groupKey] = item.group
		}
		if item.change.Operation == OperationWrite {
			if err = engine.selectRecoverySource(item); err != nil {
				return nil, err
			}
		}
	}
	if err := execution.prepareIndex(); err != nil {
		return nil, err
	}
	if err := execution.prepareHPathProjection(); err != nil {
		return nil, err
	}
	succeeded = true
	return execution, nil
}

func (engine *Engine) selectRecoverySource(item *executionItem) error {
	candidates := []string{item.targetName, item.stagedName}
	var lastErr error
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		file, err := item.group.parent.Open(candidate)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		hasher := sha256.New()
		var validated *filesys.ValidatedDocument
		if item.document {
			validated, err = filesys.ValidateDocument(io.TeeReader(file, hasher), item.change.Size,
				util.GetTreeID(item.location.path), maxPreparedDocumentBytes)
		} else {
			_, err = io.Copy(hasher, file)
		}
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil && contentHashPrefix+hex.EncodeToString(hasher.Sum(nil)) == item.change.Hash {
			item.sourceName, item.validated = candidate, validated
			return nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("kernel sync recovery source is missing or changed")
	}
	return lastErr
}

func (engine *Engine) resumeExecution(intentPath string, execution *execution) (Result, error) {
	for index, item := range execution.items {
		if err := engine.inject("publish", index); err != nil {
			return Result{Decided: true}, err
		}
		if item.change.Operation == OperationDelete {
			// RemoveAll is anchored to the already-validated parent Root. It is
			// idempotent for recovery and lets the kernel, rather than the
			// plugin, own recursive directory deletion semantics.
			if err := item.group.parent.RemoveAll(item.targetName); err != nil && !os.IsNotExist(err) {
				return Result{Decided: true}, err
			}
			continue
		}
		if item.sourceName != item.targetName {
			if err := PublishStagedFile(item.group.parent, item.sourceName, item.targetName, item.change.IfNoneMatch); err != nil {
				// IfNoneMatch 的目标可能由同一 intent 的早先尝试发布，验证成功后视为幂等完成。
				if validateErr := engine.validatePublishedTarget(item); validateErr != nil {
					return Result{Decided: true}, err
				}
			}
			item.sourceName = item.targetName
		}
	}
	if err := engine.inject("published", 0); err != nil {
		return Result{Decided: true}, err
	}
	if err := execution.syncGroups(); err != nil {
		return Result{Decided: true}, err
	}
	if execution.indexBatch != nil {
		if err := engine.inject("index", 0); err != nil {
			return Result{Decided: true}, err
		}
		if _, err := execution.indexBatch.Commit(); err != nil {
			return Result{Decided: true}, err
		}
	}
	if err := engine.inject("indexed", 0); err != nil {
		return Result{Decided: true}, err
	}
	engine.options.Reload()
	generation := engine.options.Advance()
	if generation == 0 {
		generation = model.WorkspaceGeneration()
	}
	receipt := Receipt{
		Version: receiptVersion, SessionID: execution.intent.SessionID, Owner: execution.intent.Owner,
		Generation: generation, Changes: len(execution.items), CommittedAt: time.Now().UTC(),
	}
	if err := engine.inject("receipt", 0); err != nil {
		return Result{Decided: true}, err
	}
	renamed, err := writeReceipt(receipt)
	if err != nil {
		return Result{Receipt: receipt, Decided: true}, err
	}
	if !renamed {
		return Result{Receipt: receipt, Decided: true}, errors.New("receipt was not persisted")
	}
	if err = engine.inject("receipt-persisted", 0); err != nil {
		return Result{Receipt: receipt, Decided: true, CleanupPending: true}, err
	}
	cleanupErr := engine.cleanupExecution(execution)
	if cleanupErr == nil {
		cleanupErr = engine.inject("retire", 0)
		if cleanupErr == nil {
			cleanupErr = retireIntent(intentPath)
		}
	}
	if cleanupErr != nil {
		logging.LogWarnf("kernel sync intent [%s] cleanup remains pending: %s", execution.intent.SessionID, cleanupErr)
	}
	return Result{Receipt: receipt, Decided: true, CleanupPending: cleanupErr != nil}, nil
}

func (engine *Engine) validatePublishedTarget(item *executionItem) error {
	file, err := item.group.parent.Open(item.targetName)
	if err != nil {
		return err
	}
	actual, hashErr := hashReader(file)
	closeErr := file.Close()
	if hashErr == nil {
		hashErr = closeErr
	}
	if hashErr != nil {
		return hashErr
	}
	if actual != item.change.Hash {
		return errors.New("published target hash does not match intent")
	}
	return nil
}

func (execution *execution) syncGroups() error {
	keys := make([]string, 0, len(execution.groups))
	for key := range execution.groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if err := SyncRoot(execution.groups[key].parent); err != nil {
			return err
		}
	}
	return nil
}

func (engine *Engine) cleanupExecution(execution *execution) error {
	if err := engine.inject("cleanup", 0); err != nil {
		return err
	}
	return execution.cleanupArtifacts()
}

func (execution *execution) cleanupArtifacts() error {
	var errs []error
	for _, item := range execution.items {
		for _, name := range []string{item.stagedName, item.backupName} {
			if name == "" {
				continue
			}
			if err := item.group.parent.Remove(name); err != nil && !os.IsNotExist(err) {
				errs = append(errs, err)
			}
		}
	}
	if len(errs) == 0 {
		if err := execution.syncGroups(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (engine *Engine) cleanupRecordedIntent(intentPath string, intent Intent) error {
	execution, err := engine.openCleanupExecution(intent)
	if err != nil {
		return err
	}
	defer execution.close()
	if err = engine.cleanupExecution(execution); err != nil {
		return err
	}
	return retireIntent(intentPath)
}

func (engine *Engine) openCleanupExecution(intent Intent) (*execution, error) {
	execution := &execution{intent: intent, groups: map[string]*executionGroup{}}
	for _, change := range intent.Changes {
		guard, err := ResolvePath(change.Path, true)
		if err != nil {
			return nil, err
		}
		execution.items = append(execution.items, &executionItem{
			change: Change{Operation: change.Operation, Path: change.Path}, guard: guard,
			targetName: change.TargetName, stagedName: change.StagedName, backupName: change.BackupName,
		})
	}
	guards := make([]PathGuard, len(execution.items))
	for index, item := range execution.items {
		guards[index] = item.guard
	}
	execution.unlock = LockPaths(guards...)
	succeeded := false
	defer func() {
		if !succeeded {
			execution.close()
		}
	}()
	for _, item := range execution.items {
		workspaceRoot, relativePath, err := item.guard.OpenWorkspaceRoot()
		if err != nil {
			return nil, err
		}
		parent, targetName, err := OpenRootParent(workspaceRoot, relativePath, false)
		_ = workspaceRoot.Close()
		if err != nil {
			return nil, err
		}
		if targetName != item.targetName {
			_ = parent.Close()
			return nil, errors.New("cleanup target changed")
		}
		key := ComparisonKey(filepath.Dir(item.guard.ResolvedPath()))
		if group := execution.groups[key]; group != nil {
			_ = parent.Close()
			item.group = group
		} else {
			item.group = &executionGroup{key: key, parent: parent}
			execution.groups[key] = item.group
		}
	}
	succeeded = true
	return execution, nil
}
