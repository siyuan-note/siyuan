// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/kernelsync"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/synccommit"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	kernelSyncLeaseTTL        = 3 * time.Minute
	kernelSyncMaxChunkBytes   = int64(8 * 1024 * 1024)
	kernelSyncMaxStagedBytes  = int64(4 * 1024 * 1024 * 1024)
	kernelSyncMaxChanges      = 100_000
	kernelSyncProtocolVersion = 1
)

var (
	kernelSyncManager        = kernelsync.NewManager[*kernelSyncSession]()
	kernelSyncReloadFiletree = model.ReloadFiletree
	kernelSyncIncSync        = model.IncSync
	kernelSyncEngine         = synccommit.NewEngine(synccommit.Options{
		Reload: func() { kernelSyncReloadFiletree() },
		Advance: func() uint64 {
			kernelSyncIncSync()
			return model.WorkspaceGeneration()
		},
		FaultHook: func(point string, index int) error { return injectKernelSyncCommitFault(point, index) },
	})
)

type kernelSyncSession struct {
	id          string
	owner       string
	runID       string
	localID     string
	remoteID    string
	rulesHash   string
	syncVersion string
	generation  uint64
	stageDir    string
	lease       *model.SyncIdleLock
	operationMu sync.Mutex

	mu             sync.Mutex
	changes        map[string]*kernelSyncChange
	stagedBytes    int64
	closed         bool
	committing     bool
	decided        bool
	inFlight       int
	stageDone      *sync.Cond
	done           chan struct{}
	recoverOnce    sync.Once
	recoveryResult *synccommit.Result
}

type kernelSyncBeginRequest struct {
	RunID            string `json:"runId"`
	LocalDeviceID    string `json:"localDeviceId"`
	RemoteDeviceID   string `json:"remoteDeviceId"`
	RulesFingerprint string `json:"rulesFingerprint"`
	ProtocolVersion  string `json:"protocolVersion"`
}

type kernelSyncChange struct {
	mu          sync.Mutex
	Operation   string
	Path        string
	TargetKey   string
	StagePath   string
	Size        int64
	Hash        string
	ModTime     time.Time
	IfMatch     string
	IfNoneMatch bool
	Complete    bool
}

func kernelSyncRequestOwner(c *gin.Context) string {
	if token := c.GetHeader(model.XAuthTokenKey); token != "" {
		if parsed := model.ParseXAuthToken(c.Request); parsed != nil {
			if subject := model.GetPluginJWTSubject(parsed); subject != "" {
				return "plugin:" + subject
			}
		}
		digest := sha256.Sum256([]byte(token))
		return "token:" + hex.EncodeToString(digest[:])
	}
	return "admin"
}

func validKernelSyncIdentity(value string) bool {
	if value == "" || len(value) > 256 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') ||
			char == '.' || char == '_' || char == ':' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func validateKernelSyncBeginRequest(request kernelSyncBeginRequest) error {
	if !validKernelSyncIdentity(request.RunID) || !validKernelSyncIdentity(request.LocalDeviceID) ||
		!validKernelSyncIdentity(request.RemoteDeviceID) || request.LocalDeviceID == request.RemoteDeviceID {
		return errors.New("invalid kernel sync run identity")
	}
	if len(request.RulesFingerprint) != len(syncContentSHA256Prefix)+sha256.Size*2 ||
		!strings.HasPrefix(request.RulesFingerprint, syncContentSHA256Prefix) {
		return errors.New("invalid kernel sync rules fingerprint")
	}
	if _, err := hex.DecodeString(strings.TrimPrefix(request.RulesFingerprint, syncContentSHA256Prefix)); err != nil {
		return errors.New("invalid kernel sync rules fingerprint")
	}
	if !validKernelSyncIdentity(request.ProtocolVersion) {
		return errors.New("invalid kernel sync protocol version")
	}
	return nil
}

func newKernelSyncID() (string, error) {
	var value [24]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func recordKernelSyncTerminal(session *kernelSyncSession, committed bool, generation uint64, changes int) {
	kernelSyncManager.RecordTerminal(session.id, session.owner, kernelsync.Terminal{
		Committed: committed, Generation: generation, Changes: changes,
	})
}

func lookupKernelSyncTerminal(c *gin.Context, sessionID string) (kernelsync.Terminal, bool) {
	owner := kernelSyncRequestOwner(c)
	if terminal, exists := kernelSyncManager.LookupTerminal(sessionID, owner); exists {
		return terminal, true
	}
	if receipt, receiptExists := synccommit.LookupReceipt(sessionID, owner); receiptExists {
		return kernelsync.Terminal{
			Committed: true, Generation: receipt.Generation, Changes: receipt.Changes,
			ExpiresAt: receipt.CommittedAt.Add(24 * time.Hour),
		}, true
	}
	return kernelsync.Terminal{}, false
}

func beginKernelSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	var request kernelSyncBeginRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = "invalid kernel sync begin request"
		return
	}
	request.RunID = strings.TrimSpace(request.RunID)
	request.LocalDeviceID = strings.TrimSpace(request.LocalDeviceID)
	request.RemoteDeviceID = strings.TrimSpace(request.RemoteDeviceID)
	request.RulesFingerprint = strings.ToLower(strings.TrimSpace(request.RulesFingerprint))
	request.ProtocolVersion = strings.TrimSpace(request.ProtocolVersion)
	if err := validateKernelSyncBeginRequest(request); err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = err.Error()
		return
	}

	lease, ok := model.TryLockSyncIdle(kernelSyncLeaseTTL)
	if !ok {
		ret.Code = http.StatusLocked
		ret.Msg = "workspace sync lease is busy"
		return
	}
	id, err := newKernelSyncID()
	if err != nil {
		lease.Unlock()
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError)
		return
	}
	stagingRoot := filepath.Join(util.TempDir, "kernel-sync")
	if err = os.MkdirAll(stagingRoot, 0700); err != nil {
		lease.Unlock()
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError)
		return
	}
	stageDir, err := os.MkdirTemp(stagingRoot, "session-")
	if err != nil {
		lease.Unlock()
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError)
		return
	}
	session := &kernelSyncSession{
		id: id, owner: kernelSyncRequestOwner(c), runID: request.RunID, localID: request.LocalDeviceID,
		remoteID: request.RemoteDeviceID, rulesHash: request.RulesFingerprint, syncVersion: request.ProtocolVersion,
		generation: model.WorkspaceGeneration(), stageDir: stageDir, lease: lease,
		changes: map[string]*kernelSyncChange{}, done: make(chan struct{}),
	}
	session.stageDone = sync.NewCond(&session.mu)
	kernelSyncManager.Add(id, session.owner, session)
	go session.watchLease()
	ret.Data = map[string]any{
		"sessionId": id, "leaseId": id, "generation": session.generation, "protocolVersion": kernelSyncProtocolVersion,
		"maxChunkBytes": kernelSyncMaxChunkBytes, "maxStagedBytes": kernelSyncMaxStagedBytes,
		"runId": session.runID, "localDeviceId": session.localID, "remoteDeviceId": session.remoteID,
		"rulesFingerprint": session.rulesHash, "syncProtocolVersion": session.syncVersion,
	}
}

func (session *kernelSyncSession) watchLease() {
	select {
	case <-session.done:
	case <-session.lease.Done():
		session.close(false)
	}
}

func (session *kernelSyncSession) renewLease() bool {
	session.mu.Lock()
	closed := session.closed
	session.mu.Unlock()
	return !closed && session.lease.Renew(kernelSyncLeaseTTL)
}

func (session *kernelSyncSession) recoverDecidedCommit() {
	session.recoverOnce.Do(func() {
		go func() {
			kernelsync.SuperviseRecovery(session.done, func() error {
				session.operationMu.Lock()
				result, err := kernelSyncEngine.Resume(session.id, session.owner)
				session.operationMu.Unlock()
				if err == nil {
					session.mu.Lock()
					session.recoveryResult = &result
					session.mu.Unlock()
				}
				return err
			}, func() {
				session.operationMu.Lock()
				session.mu.Lock()
				result := session.recoveryResult
				session.mu.Unlock()
				if result != nil {
					recordKernelSyncTerminal(session, true, result.Receipt.Generation, result.Receipt.Changes)
					session.closeOperationLocked(true)
				}
				session.operationMu.Unlock()
			})
		}()
	})
}

func (session *kernelSyncSession) close(unlockLease bool) {
	session.operationMu.Lock()
	defer session.operationMu.Unlock()
	session.closeOperationLocked(unlockLease)
}

func (session *kernelSyncSession) closeOperationLocked(unlockLease bool) {
	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		return
	}
	session.closed = true
	close(session.done)
	for session.inFlight > 0 {
		session.stageDone.Wait()
	}
	session.mu.Unlock()
	kernelSyncManager.Delete(session.id, func(candidate *kernelSyncSession) bool { return candidate == session })
	if unlockLease {
		session.lease.Unlock()
	}
	_ = os.RemoveAll(session.stageDir)
}

func lookupKernelSyncSession(c *gin.Context, sessionID string) (*kernelSyncSession, error) {
	if len(sessionID) != 48 {
		return nil, errors.New("invalid kernel sync session")
	}
	session, exists := kernelSyncManager.Lookup(sessionID, kernelSyncRequestOwner(c))
	if !exists || session == nil {
		return nil, errors.New("kernel sync session is not active")
	}
	select {
	case <-session.lease.Done():
		return nil, errors.New("kernel sync lease expired")
	default:
	}
	if !session.renewLease() {
		return nil, errors.New("kernel sync lease expired")
	}
	return session, nil
}

func renewKernelSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	session, err := lookupKernelSyncSession(c, strings.TrimSpace(c.Query("sessionId")))
	if err != nil {
		ret.Code = http.StatusLocked
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]any{"renewed": true, "sessionId": session.id}
}

func abortKernelSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	sessionID := strings.TrimSpace(c.Query("sessionId"))
	session, err := lookupKernelSyncSession(c, sessionID)
	if err != nil {
		if terminal, exists := lookupKernelSyncTerminal(c, sessionID); exists {
			ret.Data = map[string]any{"aborted": !terminal.Committed, "committed": terminal.Committed}
			return
		}
		ret.Data = map[string]any{"aborted": false}
		return
	}
	session.operationMu.Lock()
	defer session.operationMu.Unlock()
	session.mu.Lock()
	closed := session.closed
	session.mu.Unlock()
	if closed {
		if terminal, exists := lookupKernelSyncTerminal(c, sessionID); exists {
			ret.Data = map[string]any{"aborted": !terminal.Committed, "committed": terminal.Committed}
			return
		}
		ret.Data = map[string]any{"aborted": false}
		return
	}
	session.mu.Lock()
	decided := session.decided
	session.mu.Unlock()
	if !decided {
		_, statErr := os.Lstat(synccommit.IntentPath(session.id))
		decided = statErr == nil
	}
	if decided {
		result, resumeErr := kernelSyncEngine.Resume(session.id, session.owner)
		if resumeErr != nil {
			ret.Code = http.StatusInternalServerError
			ret.Msg = resumeErr.Error()
			ret.Data = map[string]any{"aborted": false, "commitDecided": true}
			return
		}
		recordKernelSyncTerminal(session, true, result.Receipt.Generation, result.Receipt.Changes)
		session.closeOperationLocked(true)
		ret.Data = map[string]any{"aborted": false, "committed": true}
		return
	}
	recordKernelSyncTerminal(session, false, session.generation, 0)
	session.closeOperationLocked(true)
	ret.Data = map[string]any{"aborted": true}
}

func readKernelSyncChunk(c *gin.Context) {
	session, err := lookupKernelSyncSession(c, strings.TrimSpace(c.Query("sessionId")))
	if err != nil {
		writeKernelSyncReadError(c, http.StatusLocked, err.Error())
		return
	}
	if session.generation != model.WorkspaceGeneration() {
		writeKernelSyncReadError(c, http.StatusConflict, "workspace generation changed")
		return
	}
	filePath := strings.TrimSpace(c.Query("path"))
	guard, err := resolveWorkspacePath(filePath, false)
	if err != nil || !sameOrNestedWorkspacePath(filepath.Clean(util.DataDir), guard.absPath) || sameWorkspacePath(filepath.Clean(util.DataDir), guard.absPath) {
		writeKernelSyncReadError(c, http.StatusForbidden, "kernel sync reads must target /data descendants")
		return
	}
	if guard.rejectsEncryptedBox() {
		writeKernelSyncReadError(c, http.StatusForbidden, "kernel sync does not expose encrypted notebook files")
		return
	}
	offset, parseErr := strconv.ParseInt(c.Query("offset"), 10, 64)
	length, lengthErr := strconv.ParseInt(c.Query("length"), 10, 64)
	expectedSize, sizeErr := strconv.ParseInt(c.Query("expectedSize"), 10, 64)
	if parseErr != nil || lengthErr != nil || sizeErr != nil || offset < 0 || length < 0 || length > kernelSyncMaxChunkBytes || expectedSize < 0 {
		writeKernelSyncReadError(c, http.StatusBadRequest, "invalid kernel sync chunk range")
		return
	}
	unlocks := lockWorkspacePaths(guard)
	if err = guard.revalidate(); err != nil {
		unlocks()
		writeKernelSyncReadError(c, http.StatusForbidden, err.Error())
		return
	}
	root, relativePath, err := guard.openWorkspaceRoot()
	if err != nil {
		unlocks()
		writeKernelSyncReadError(c, http.StatusForbidden, err.Error())
		return
	}
	file, err := root.Open(relativePath)
	if err != nil {
		_ = root.Close()
		unlocks()
		code := http.StatusInternalServerError
		if os.IsNotExist(err) {
			code = http.StatusNotFound
		}
		writeKernelSyncReadError(c, code, err.Error())
		return
	}
	info, err := file.Stat()
	if err == nil && (info.IsDir() || info.Size() != expectedSize || offset > info.Size() || length > info.Size()-offset) {
		err = errors.New("kernel sync source changed after manifest scan")
	}
	var changeToken string
	if err == nil {
		changeToken, err = fileChangeToken(file, info)
	}
	if expectedToken := strings.TrimSpace(c.Query("expectedChangeToken")); err == nil && expectedToken != "" && expectedToken != changeToken {
		err = errors.New("kernel sync source changed after manifest scan")
	}
	chunk := make([]byte, int(length))
	if err == nil {
		_, err = io.ReadFull(io.NewSectionReader(file, offset, length), chunk)
	}
	closeErr := file.Close()
	rootErr := root.Close()
	unlocks()
	if err == nil {
		err = errors.Join(closeErr, rootErr)
	}
	if err != nil {
		writeKernelSyncReadError(c, http.StatusConflict, err.Error())
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Siyuan-File-Change-Token", changeToken)
	c.Data(http.StatusOK, "application/octet-stream", chunk)
}

type kernelSyncStageMetadata struct {
	sessionID   string
	operation   string
	path        string
	targetKey   string
	offset      int64
	size        int64
	hash        string
	modTime     time.Time
	ifMatch     string
	ifNoneMatch bool
	final       bool
}

func parseKernelSyncStageMetadata(c *gin.Context) (kernelSyncStageMetadata, error) {
	metadata := kernelSyncStageMetadata{
		sessionID: strings.TrimSpace(c.Query("sessionId")), operation: strings.TrimSpace(c.Query("operation")),
		path: strings.TrimSpace(c.Query("path")), hash: strings.ToLower(strings.TrimSpace(c.Query("hash"))),
		ifMatch:     strings.ToLower(strings.TrimSpace(c.Query("ifMatch"))),
		ifNoneMatch: c.Query("ifNoneMatch") == "true", final: c.Query("final") == "true",
	}
	if metadata.operation != "write" && metadata.operation != "delete" {
		return metadata, errors.New("invalid staged operation")
	}
	guard, err := resolveWorkspacePath(metadata.path, true)
	if err != nil {
		return metadata, err
	}
	dataPath := filepath.Clean(util.DataDir)
	if !sameOrNestedWorkspacePath(dataPath, guard.absPath) || sameWorkspacePath(dataPath, guard.absPath) || guard.rejectsEncryptedBox() {
		return metadata, errors.New("kernel sync changes must target plaintext /data descendants")
	}
	relativePath, err := filepath.Rel(filepath.Clean(util.WorkspaceDir), guard.absPath)
	if err != nil || !validWorkspaceRootRelativePath(relativePath, false) {
		return metadata, errors.New("invalid kernel sync workspace path")
	}
	metadata.path = "/" + filepath.ToSlash(relativePath)
	metadata.targetKey = workspacePathComparisonKey(guard.resolvedPath)
	if metadata.ifMatch != "" && !strings.HasPrefix(metadata.ifMatch, syncContentSHA256Prefix) {
		return metadata, errors.New("ifMatch must use sha256")
	}
	if metadata.operation == "delete" {
		if c.Request.ContentLength > 0 {
			return metadata, errors.New("delete operation must not contain a body")
		}
		return metadata, nil
	}
	metadata.offset, err = strconv.ParseInt(c.Query("offset"), 10, 64)
	if err != nil || metadata.offset < 0 {
		return metadata, errors.New("invalid staged offset")
	}
	metadata.size, err = strconv.ParseInt(c.Query("size"), 10, 64)
	if err != nil || metadata.size < 0 || metadata.size > kernelSyncMaxStagedBytes {
		return metadata, errors.New("invalid staged size")
	}
	modTimeSec, err := strconv.ParseInt(c.Query("modTime"), 10, 64)
	if err != nil || modTimeSec < 0 {
		return metadata, errors.New("invalid staged modification time")
	}
	metadata.modTime = time.Unix(modTimeSec, 0)
	if len(metadata.hash) != len(syncContentSHA256Prefix)+sha256.Size*2 || !strings.HasPrefix(metadata.hash, syncContentSHA256Prefix) {
		return metadata, errors.New("invalid staged sha256")
	}
	if c.Request.ContentLength > kernelSyncMaxChunkBytes {
		return metadata, errors.New("staged chunk exceeds transfer limit")
	}
	return metadata, nil
}

func stageKernelSyncBatch(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	metadata, err := parseKernelSyncStageMetadata(c)
	if err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = err.Error()
		return
	}
	session, err := lookupKernelSyncSession(c, metadata.sessionID)
	if err != nil {
		ret.Code = http.StatusLocked
		ret.Msg = err.Error()
		return
	}
	session.mu.Lock()
	if session.closed || session.generation != model.WorkspaceGeneration() {
		session.mu.Unlock()
		ret.Code = http.StatusConflict
		ret.Msg = "workspace generation changed"
		return
	}
	if session.committing {
		session.mu.Unlock()
		ret.Code = http.StatusConflict
		ret.Msg = "kernel sync session is committing"
		return
	}
	change := session.changes[metadata.targetKey]
	if change != nil && change.Path != metadata.path {
		session.mu.Unlock()
		ret.Code = http.StatusConflict
		ret.Msg = "physical target already has a staged change"
		return
	}
	if metadata.operation == "delete" {
		if change != nil && change.Operation != "delete" {
			session.mu.Unlock()
			ret.Code = http.StatusConflict
			ret.Msg = "path already has a staged write"
			return
		}
		if change == nil {
			if len(session.changes) >= kernelSyncMaxChanges {
				session.mu.Unlock()
				ret.Code = http.StatusRequestEntityTooLarge
				ret.Msg = "staged change limit exceeded"
				return
			}
			session.changes[metadata.targetKey] = &kernelSyncChange{
				Operation: "delete", Path: metadata.path, TargetKey: metadata.targetKey,
				IfMatch: metadata.ifMatch, IfNoneMatch: metadata.ifNoneMatch, Complete: true,
			}
		}
		session.mu.Unlock()
		ret.Data = map[string]any{"staged": true}
		return
	}
	if change == nil {
		if len(session.changes) >= kernelSyncMaxChanges {
			session.mu.Unlock()
			ret.Code = http.StatusRequestEntityTooLarge
			ret.Msg = "staged change limit exceeded"
			return
		}
		if session.stagedBytes+metadata.size > kernelSyncMaxStagedBytes {
			session.mu.Unlock()
			ret.Code = http.StatusRequestEntityTooLarge
			ret.Msg = "session staged byte limit exceeded"
			return
		}
		stagePath := filepath.Join(session.stageDir, fmt.Sprintf("%08d.data", len(session.changes)))
		change = &kernelSyncChange{
			Operation: "write", Path: metadata.path, TargetKey: metadata.targetKey,
			StagePath: stagePath, Size: metadata.size, Hash: metadata.hash,
			ModTime: metadata.modTime, IfMatch: metadata.ifMatch, IfNoneMatch: metadata.ifNoneMatch,
		}
		session.changes[metadata.targetKey] = change
		session.stagedBytes += metadata.size
	} else if change.Operation != "write" || change.Size != metadata.size || change.Hash != metadata.hash ||
		!change.ModTime.Equal(metadata.modTime) || change.IfMatch != metadata.ifMatch || change.IfNoneMatch != metadata.ifNoneMatch {
		session.mu.Unlock()
		ret.Code = http.StatusConflict
		ret.Msg = "staged write metadata changed"
		return
	}
	session.inFlight++
	session.mu.Unlock()
	change.mu.Lock()
	defer func() {
		change.mu.Unlock()
		session.mu.Lock()
		session.inFlight--
		session.stageDone.Broadcast()
		session.mu.Unlock()
	}()
	if change.Complete {
		ret.Data = map[string]any{"staged": true, "complete": true, "size": change.Size, "hash": change.Hash}
		return
	}
	chunkFile, chunkSize, err := streamKernelSyncChunk(session.stageDir, c.Request.Body)
	if err != nil || chunkSize > kernelSyncMaxChunkBytes {
		if chunkFile != nil {
			chunkPath := chunkFile.Name()
			_ = chunkFile.Close()
			_ = os.Remove(chunkPath)
		}
		ret.Code = http.StatusRequestEntityTooLarge
		ret.Msg = "staged chunk exceeds transfer limit"
		return
	}
	chunkPath := chunkFile.Name()
	defer func() {
		_ = chunkFile.Close()
		_ = os.Remove(chunkPath)
	}()
	if metadata.offset+chunkSize > change.Size {
		ret.Code = http.StatusBadRequest
		ret.Msg = "staged chunk exceeds declared size"
		return
	}
	file, err := os.OpenFile(change.StagePath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError)
		return
	}
	info, statErr := file.Stat()
	if statErr != nil {
		_ = file.Close()
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError)
		return
	}
	if metadata.offset > info.Size() {
		_ = file.Close()
		ret.Code = http.StatusConflict
		ret.Msg = "staged chunks must be contiguous"
		return
	}
	overlap := min(chunkSize, max(int64(0), info.Size()-metadata.offset))
	if overlap > 0 {
		matches, compareErr := equalKernelSyncRanges(io.NewSectionReader(file, metadata.offset, overlap), chunkFile, overlap)
		if compareErr != nil || !matches {
			_ = file.Close()
			ret.Code = http.StatusConflict
			ret.Msg = "retried staged chunk content differs"
			return
		}
	}
	if _, err = chunkFile.Seek(overlap, io.SeekStart); err == nil {
		err = writeKernelSyncChunk(file, chunkFile, metadata.offset+overlap, chunkSize-overlap)
	}
	if err == nil && metadata.final {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError)
		return
	}
	if metadata.final {
		info, err = os.Stat(change.StagePath)
		if err != nil || info.Size() != change.Size {
			ret.Code = http.StatusConflict
			ret.Msg = "staged write is incomplete"
			return
		}
		actual, hashErr := syncContentHashFile(change.StagePath)
		if hashErr != nil || actual != change.Hash {
			ret.Code = http.StatusUnprocessableEntity
			ret.Msg = "staged write hash mismatch"
			return
		}
		change.Complete = true
	}
	ret.Data = map[string]any{"staged": true, "complete": change.Complete, "received": metadata.offset + chunkSize}
}

func streamKernelSyncChunk(stageDir string, reader io.Reader) (*os.File, int64, error) {
	file, err := os.CreateTemp(stageDir, ".chunk-")
	if err != nil {
		return nil, 0, err
	}
	size, err := io.Copy(file, io.LimitReader(reader, kernelSyncMaxChunkBytes+1))
	if err == nil {
		_, err = file.Seek(0, io.SeekStart)
	}
	if err != nil {
		path := file.Name()
		_ = file.Close()
		_ = os.Remove(path)
		return nil, 0, err
	}
	return file, size, nil
}

func equalKernelSyncRanges(left io.Reader, right io.Reader, size int64) (bool, error) {
	leftBuffer := make([]byte, 64*1024)
	rightBuffer := make([]byte, len(leftBuffer))
	for remaining := size; remaining > 0; {
		chunkSize := min(int64(len(leftBuffer)), remaining)
		if _, err := io.ReadFull(left, leftBuffer[:chunkSize]); err != nil {
			return false, err
		}
		if _, err := io.ReadFull(right, rightBuffer[:chunkSize]); err != nil {
			return false, err
		}
		if !bytes.Equal(leftBuffer[:chunkSize], rightBuffer[:chunkSize]) {
			return false, nil
		}
		remaining -= chunkSize
	}
	return true, nil
}

func writeKernelSyncChunk(target *os.File, source io.Reader, offset, size int64) error {
	buffer := make([]byte, 64*1024)
	for remaining := size; remaining > 0; {
		chunkSize := min(int64(len(buffer)), remaining)
		read, err := io.ReadFull(source, buffer[:chunkSize])
		if err != nil {
			return err
		}
		written, err := target.WriteAt(buffer[:read], offset)
		if err != nil {
			return err
		}
		if written != read {
			return io.ErrShortWrite
		}
		offset += int64(written)
		remaining -= int64(written)
	}
	return nil
}

func sortedKernelSyncChanges(session *kernelSyncSession) ([]*kernelSyncChange, error) {
	session.mu.Lock()
	defer session.mu.Unlock()
	if session.closed {
		return nil, errors.New("kernel sync session is closed")
	}
	if session.committing {
		return nil, errors.New("kernel sync session is already committing")
	}
	session.committing = true
	for session.inFlight > 0 {
		session.stageDone.Wait()
	}
	changes := make([]*kernelSyncChange, 0, len(session.changes))
	for _, change := range session.changes {
		if !change.Complete {
			session.committing = false
			return nil, fmt.Errorf("staged change is incomplete: %s", change.Path)
		}
		changes = append(changes, &kernelSyncChange{
			Operation: change.Operation, Path: change.Path, TargetKey: change.TargetKey, StagePath: change.StagePath,
			Size: change.Size, Hash: change.Hash, ModTime: change.ModTime, IfMatch: change.IfMatch,
			IfNoneMatch: change.IfNoneMatch, Complete: change.Complete,
		})
	}
	sort.Slice(changes, func(left, right int) bool {
		if changes[left].Operation == "delete" && changes[right].Operation == "delete" {
			leftDepth := strings.Count(changes[left].Path, "/")
			rightDepth := strings.Count(changes[right].Path, "/")
			if leftDepth != rightDepth {
				return leftDepth > rightDepth
			}
			return changes[left].Path > changes[right].Path
		}
		return changes[left].Path < changes[right].Path
	})
	return changes, nil
}

func commitKernelSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	sessionID := strings.TrimSpace(c.Query("sessionId"))
	session, err := lookupKernelSyncSession(c, sessionID)
	if err != nil {
		if terminal, exists := lookupKernelSyncTerminal(c, sessionID); exists && terminal.Committed {
			ret.Data = map[string]any{
				"committed": true, "generation": terminal.Generation, "changes": terminal.Changes, "alreadyTerminal": true,
			}
			return
		}
		ret.Code = http.StatusLocked
		ret.Msg = err.Error()
		return
	}
	session.operationMu.Lock()
	defer session.operationMu.Unlock()
	session.mu.Lock()
	closed := session.closed
	session.mu.Unlock()
	if closed {
		if terminal, exists := lookupKernelSyncTerminal(c, sessionID); exists && terminal.Committed {
			ret.Data = map[string]any{
				"committed": true, "generation": terminal.Generation, "changes": terminal.Changes, "alreadyTerminal": true,
			}
			return
		}
		ret.Code = http.StatusConflict
		ret.Msg = "kernel sync session is closed"
		return
	}
	changes, err := sortedKernelSyncChanges(session)
	if err != nil {
		ret.Code = http.StatusConflict
		ret.Msg = err.Error()
		return
	}
	if session.generation != model.WorkspaceGeneration() {
		session.mu.Lock()
		session.committing = false
		session.mu.Unlock()
		ret.Code = http.StatusConflict
		ret.Msg = "workspace generation changed"
		return
	}
	if len(changes) == 0 {
		recordKernelSyncTerminal(session, true, session.generation, 0)
		session.closeOperationLocked(true)
		ret.Data = map[string]any{"committed": true, "generation": session.generation, "changes": 0}
		return
	}
	request := synccommit.CommitRequest{
		SessionID: session.id, Owner: session.owner, ExpectedGeneration: session.generation,
		Changes: make([]synccommit.Change, 0, len(changes)),
	}
	for _, change := range changes {
		request.Changes = append(request.Changes, synccommit.Change{
			Operation: synccommit.Operation(change.Operation), Path: change.Path, StagePath: change.StagePath,
			Size: change.Size, Hash: change.Hash, ModTime: change.ModTime, IfMatch: change.IfMatch,
			IfNoneMatch: change.IfNoneMatch,
		})
	}
	enteredCritical := false
	request.EnterCritical = func() bool {
		enteredCritical = session.lease.EnterCritical()
		return enteredCritical
	}
	result, commitErr := kernelSyncEngine.Commit(request)
	if commitErr != nil {
		kind, decided := synccommit.ErrorInfo(commitErr)
		session.mu.Lock()
		session.committing = false
		session.decided = session.decided || decided
		session.mu.Unlock()
		if decided {
			session.recoverDecidedCommit()
		}
		if enteredCritical && !decided {
			recordKernelSyncTerminal(session, false, session.generation, 0)
			session.closeOperationLocked(true)
		}
		switch kind {
		case synccommit.ErrorInvalid:
			ret.Code = http.StatusUnprocessableEntity
		case synccommit.ErrorForbidden:
			ret.Code = http.StatusForbidden
		case synccommit.ErrorConflict:
			ret.Code = http.StatusConflict
		case synccommit.ErrorLocked:
			ret.Code = http.StatusLocked
		default:
			ret.Code = http.StatusInternalServerError
		}
		ret.Msg = commitErr.Error()
		ret.Data = map[string]any{"commitDecided": decided}
		return
	}
	recordKernelSyncTerminal(session, true, result.Receipt.Generation, result.Receipt.Changes)
	session.closeOperationLocked(true)
	ret.Data = map[string]any{
		"committed": true, "generation": result.Receipt.Generation, "changes": result.Receipt.Changes,
		"resumed": result.Resumed, "cleanupPending": result.CleanupPending,
	}
}
