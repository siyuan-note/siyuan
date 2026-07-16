// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func (engine *Engine) prepareOnline(request CommitRequest) (*execution, error) {
	execution := &execution{groups: map[string]*executionGroup{}}
	physicalTargets := map[string]struct{}{}
	var documentBytes int64
	for _, change := range request.Changes {
		guard, err := ResolvePath(change.Path, true)
		if err != nil {
			execution.close()
			return nil, wrapError(ErrorForbidden, false, err)
		}
		if guard.RejectsEncryptedBox() || !SameOrNestedPath(filepath.Clean(util.DataDir), guard.AbsPath()) ||
			SamePath(filepath.Clean(util.DataDir), guard.AbsPath()) {
			execution.close()
			return nil, wrapError(ErrorForbidden, false, errors.New("kernel sync changes must target plaintext /data descendants"))
		}
		targetKey := ComparisonKey(guard.ResolvedPath())
		if _, exists := physicalTargets[targetKey]; exists {
			execution.close()
			return nil, wrapError(ErrorConflict, false, errors.New("physical target already has a staged change"))
		}
		physicalTargets[targetKey] = struct{}{}
		item := &executionItem{change: change, guard: guard}
		_, location, document, locationErr := notebookDocumentLocation(guard)
		if locationErr != nil {
			execution.close()
			return nil, wrapError(ErrorInvalid, false, locationErr)
		}
		item.document, item.location = document, location
		if change.Operation == OperationWrite {
			if document {
				documentBytes += change.Size
			}
			if documentBytes > maxPreparedDocumentBytes {
				execution.close()
				return nil, wrapError(ErrorInvalid, false, errors.New("prepared document byte limit exceeded"))
			}
			file, openErr := os.Open(change.StagePath)
			if openErr != nil {
				execution.close()
				return nil, wrapError(ErrorInternal, false, openErr)
			}
			hasher := sha256.New()
			var validated *filesys.ValidatedDocument
			var validateErr error
			if document {
				validated, validateErr = filesys.ValidateDocument(io.TeeReader(file, hasher), change.Size, util.GetTreeID(location.path), maxPreparedDocumentBytes)
			} else {
				_, validateErr = io.Copy(hasher, file)
			}
			closeErr := file.Close()
			if validateErr == nil {
				validateErr = closeErr
			}
			if validateErr != nil {
				execution.close()
				return nil, wrapError(ErrorInvalid, false, validateErr)
			}
			if actual := contentHashPrefix + hex.EncodeToString(hasher.Sum(nil)); actual != change.Hash {
				execution.close()
				return nil, wrapError(ErrorConflict, false, errors.New("staged write hash changed"))
			}
			item.validated = validated
		}
		execution.items = append(execution.items, item)
	}
	guards := make([]PathGuard, len(execution.items))
	for index, item := range execution.items {
		guards[index] = item.guard
	}
	unlock := LockPaths(guards...)
	succeeded := false
	defer func() {
		if !succeeded {
			_ = execution.cleanupArtifacts()
			execution.close()
			unlock()
		}
	}()
	if err := execution.openAndCheckParents(); err != nil {
		return nil, err
	}
	if err := execution.stageSiblingFiles(); err != nil {
		return nil, wrapError(ErrorInternal, false, err)
	}
	if err := engine.inject("staged", 0); err != nil {
		return nil, wrapError(ErrorInternal, false, err)
	}
	if request.ExpectedGeneration != model.WorkspaceGeneration() {
		return nil, wrapError(ErrorConflict, false, errors.New("workspace generation changed"))
	}
	if err := execution.prepareIndex(); err != nil {
		return nil, wrapError(ErrorConflict, false, err)
	}
	if err := execution.prepareHPathProjection(); err != nil {
		return nil, wrapError(ErrorConflict, false, err)
	}
	if err := execution.recheckPreconditions(); err != nil {
		return nil, err
	}
	execution.unlock = unlock
	succeeded = true
	return execution, nil
}

func (execution *execution) openAndCheckParents() error {
	for _, item := range execution.items {
		if err := item.guard.Revalidate(); err != nil {
			return wrapError(ErrorForbidden, false, err)
		}
		workspaceRoot, relativePath, err := item.guard.OpenWorkspaceRoot()
		if err != nil {
			return wrapError(ErrorForbidden, false, err)
		}
		parent, targetName, parentErr := OpenRootParent(workspaceRoot, relativePath, false)
		_ = workspaceRoot.Close()
		item.relative, item.targetName = relativePath, targetName
		if os.IsNotExist(parentErr) {
			if item.change.Operation == OperationDelete || item.change.IfMatch != "" {
				return wrapError(ErrorConflict, false, errors.New("precondition failed: target does not exist"))
			}
			item.targetName = filepath.Base(relativePath)
			continue
		}
		if parentErr != nil {
			return wrapError(ErrorInternal, false, parentErr)
		}
		groupKey := ComparisonKey(filepath.Dir(item.guard.ResolvedPath()))
		if group := execution.groups[groupKey]; group != nil {
			_ = parent.Close()
			item.group = group
		} else {
			item.group = &executionGroup{key: groupKey, parent: parent}
			execution.groups[groupKey] = item.group
		}
		exists, ok, message, checkErr := checkFilePrecondition(item.group.parent, item.targetName, item.change.IfMatch, item.change.IfNoneMatch)
		if checkErr != nil {
			return wrapError(ErrorInternal, false, checkErr)
		}
		if !ok {
			return wrapError(ErrorConflict, false, errors.New(message))
		}
		item.existed = exists
		if exists {
			info, statErr := item.group.parent.Stat(item.targetName)
			if statErr != nil {
				return wrapError(ErrorInternal, false, statErr)
			}
			if info.IsDir() && item.change.Operation != OperationDelete {
				return wrapError(ErrorConflict, false, errors.New("kernel sync batch only accepts file changes"))
			}
		}
		if item.change.Operation == OperationDelete && !exists {
			return wrapError(ErrorConflict, false, errors.New("delete target no longer exists"))
		}
	}
	return nil
}

func (execution *execution) ensureGroup(item *executionItem) error {
	if item.group != nil {
		return nil
	}
	workspaceRoot, _, err := item.guard.OpenWorkspaceRoot()
	if err != nil {
		return err
	}
	parent, targetName, err := OpenRootParent(workspaceRoot, item.relative, true)
	_ = workspaceRoot.Close()
	if err != nil {
		return err
	}
	groupKey := ComparisonKey(filepath.Dir(item.guard.ResolvedPath()))
	if group := execution.groups[groupKey]; group != nil {
		_ = parent.Close()
		item.group = group
	} else {
		item.group = &executionGroup{key: groupKey, parent: parent}
		execution.groups[groupKey] = item.group
	}
	item.targetName = targetName
	return nil
}

func (execution *execution) stageSiblingFiles() error {
	for _, item := range execution.items {
		if item.change.Operation != OperationWrite {
			continue
		}
		if err := execution.ensureGroup(item); err != nil {
			return err
		}
		staged, err := os.Open(item.change.StagePath)
		if err != nil {
			return err
		}
		item.stagedName, err = StageFile(item.group.parent, staged, 0644, item.change.ModTime)
		closeErr := staged.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			return err
		}
		item.sourceName = item.stagedName
	}
	return nil
}

func (execution *execution) prepareIndex() error {
	var targets []model.RawDocumentIndexTarget
	for _, item := range execution.items {
		if item.document {
			targets = append(targets, model.RawDocumentIndexTarget{BoxID: item.location.boxID, DocumentPath: item.location.path})
		}
	}
	if len(targets) == 0 {
		return nil
	}
	batch, err := model.LockRawDocumentIndexBatch(targets)
	if err != nil {
		return err
	}
	execution.indexBatch = batch
	for _, item := range execution.items {
		if !item.document {
			continue
		}
		if item.change.Operation == OperationDelete {
			if _, err = batch.PrepareRemoval(item.location.boxID, item.location.path); err != nil {
				return err
			}
			continue
		}
		if item.validated == nil {
			return errors.New("validated document is missing")
		}
		if _, err = batch.PrepareUpsertValidated(item.location.boxID, item.location.path, item.validated); err != nil {
			return err
		}
	}
	return nil
}

func (execution *execution) prepareHPathProjection() error {
	if execution.indexBatch == nil {
		return nil
	}
	titles := map[string]string{}
	for _, item := range execution.items {
		if !item.document {
			continue
		}
		key := filesys.DocumentTitleOverlayKey(item.location.boxID, item.location.path)
		if item.change.Operation == OperationDelete {
			titles[key] = "Untitled"
			continue
		}
		if item.validated == nil || item.validated.Tree == nil || item.validated.Tree.Root == nil {
			return errors.New("validated document tree is missing")
		}
		titles[key] = item.validated.Tree.Root.IALAttr("title")
	}
	return execution.indexBatch.PrepareHPathProjection(titles)
}

func (execution *execution) recheckPreconditions() error {
	for _, item := range execution.items {
		exists, ok, message, err := checkFilePrecondition(item.group.parent, item.targetName, item.change.IfMatch, item.change.IfNoneMatch)
		if err != nil {
			return wrapError(ErrorInternal, false, err)
		}
		if !ok {
			return wrapError(ErrorConflict, false, errors.New(message))
		}
		item.existed = exists
		if exists {
			info, statErr := item.group.parent.Stat(item.targetName)
			if statErr != nil {
				return wrapError(ErrorInternal, false, statErr)
			}
			if info.IsDir() && item.change.Operation != OperationDelete {
				return wrapError(ErrorConflict, false, errors.New("kernel sync batch only accepts file changes"))
			}
		}
		if item.change.Operation == OperationDelete && !exists {
			return wrapError(ErrorConflict, false, errors.New("delete target no longer exists"))
		}
	}
	return nil
}

func checkFilePrecondition(root *os.Root, relativePath, ifMatch string, ifNoneMatch bool) (exists, ok bool, message string, err error) {
	file, err := root.Open(relativePath)
	if os.IsNotExist(err) {
		if ifMatch != "" {
			return false, false, "precondition failed: target does not exist", nil
		}
		return false, true, "", nil
	}
	if err != nil {
		return false, false, "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return true, false, "", err
	}
	if ifNoneMatch {
		return true, false, "precondition failed: target already exists", nil
	}
	if info.IsDir() {
		if ifMatch != "" {
			return true, false, "precondition failed: directory hashes are not supported", nil
		}
		return true, true, "", nil
	}
	if ifMatch != "" {
		actual, hashErr := hashReader(file)
		if hashErr != nil {
			return true, false, "", hashErr
		}
		if actual != ifMatch {
			return true, false, "precondition failed: target hash changed", nil
		}
	}
	return true, true, "", nil
}

func hashReader(reader io.Reader) (string, error) {
	hasher := sha256.New()
	if _, err := io.Copy(hasher, reader); err != nil {
		return "", err
	}
	return contentHashPrefix + hex.EncodeToString(hasher.Sum(nil)), nil
}

func (execution *execution) createBackups() error {
	for _, item := range execution.items {
		// Deletes do not mutate the target until after the durable intent is
		// installed, and a decided delete is always rolled forward. Keeping a
		// hard-link backup is therefore unnecessary and would exclude
		// directories, which cannot be hard-linked.
		if !item.existed || item.change.Operation == OperationDelete {
			continue
		}
		name, err := siblingName(".siyuan-sync-backup-")
		if err == nil {
			err = item.group.parent.Link(item.targetName, name)
		}
		if err != nil {
			return err
		}
		item.backupName = name
	}
	return nil
}

func siblingName(prefix string) (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(value[:]) + ".tmp", nil
}

func (execution *execution) buildIntent(sessionID, owner string) Intent {
	intent := Intent{Version: intentVersion, SessionID: sessionID, Owner: owner, Changes: make([]IntentChange, 0, len(execution.items))}
	for _, item := range execution.items {
		intent.Changes = append(intent.Changes, IntentChange{
			Operation: item.change.Operation, Path: item.change.Path, TargetName: item.targetName,
			StagedName: item.stagedName, BackupName: item.backupName, Size: item.change.Size,
			Hash: item.change.Hash, IfNoneMatch: item.change.IfNoneMatch,
		})
	}
	return intent
}

func notebookDocumentLocation(guard PathGuard) (string, documentLocation, bool, error) {
	dataPath, err := filepath.Abs(util.DataDir)
	if err != nil {
		return "", documentLocation{}, false, err
	}
	resolvedDataPath, err := ResolveExistingPath(dataPath)
	if err != nil {
		return "", documentLocation{}, false, err
	}
	lexical, lexicalInside, err := relativePath(dataPath, guard.AbsPath())
	if err != nil {
		return "", documentLocation{}, false, err
	}
	physical, physicalInside, err := relativePath(resolvedDataPath, guard.ResolvedPath())
	if err != nil {
		return "", documentLocation{}, false, err
	}
	if !lexicalInside && !physicalInside {
		return "", documentLocation{}, false, nil
	}
	if lexicalInside != physicalInside || filepath.ToSlash(lexical) != filepath.ToSlash(physical) {
		return "", documentLocation{}, true, errors.New("document path is redirected")
	}
	parts := strings.FieldsFunc(filepath.ToSlash(lexical), func(r rune) bool { return r == '/' })
	if len(parts) < 2 || !ast.IsNodeIDPattern(parts[0]) || !strings.EqualFold(filepath.Ext(parts[len(parts)-1]), ".sy") {
		return "", documentLocation{}, false, nil
	}
	if filepath.Ext(parts[len(parts)-1]) != ".sy" {
		return "", documentLocation{}, true, errors.New("document extension must be lowercase .sy")
	}
	documentID := strings.TrimSuffix(parts[len(parts)-1], ".sy")
	if !ast.IsNodeIDPattern(documentID) {
		return "", documentLocation{}, true, errors.New("document filename is not a block ID")
	}
	location := documentLocation{boxID: parts[0], path: path.Clean("/" + strings.Join(parts[1:], "/"))}
	return documentID, location, true, nil
}

func relativePath(root, candidate string) (string, bool, error) {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return "", false, err
	}
	if filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false, nil
	}
	return filepath.Clean(relative), true, nil
}
