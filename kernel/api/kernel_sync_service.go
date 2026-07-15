// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
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
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	kernelSyncLeaseTTL        = 3 * time.Minute
	kernelSyncRenewInterval   = time.Minute
	kernelSyncMaxChunkBytes   = int64(8 * 1024 * 1024)
	kernelSyncMaxStagedBytes  = int64(4 * 1024 * 1024 * 1024)
	kernelSyncMaxChanges      = 100_000
	kernelSyncProtocolVersion = 1
)

var (
	kernelSyncSessionsMu     sync.Mutex
	kernelSyncSessions       = map[string]*kernelSyncSession{}
	kernelSyncTerminals      = map[string]kernelSyncTerminal{}
	kernelSyncReloadFiletree = model.ReloadFiletree
	kernelSyncIncSync        = model.IncSync
)

type kernelSyncTerminal struct {
	owner      string
	committed  bool
	generation uint64
	changes    int
	expiresAt  time.Time
}

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

	mu          sync.Mutex
	changes     map[string]*kernelSyncChange
	stagedBytes int64
	closed      bool
	committing  bool
	done        chan struct{}
}

type kernelSyncBeginRequest struct {
	RunID            string `json:"runId"`
	LocalDeviceID    string `json:"localDeviceId"`
	RemoteDeviceID   string `json:"remoteDeviceId"`
	RulesFingerprint string `json:"rulesFingerprint"`
	ProtocolVersion  string `json:"protocolVersion"`
}

type kernelSyncChange struct {
	Operation   string
	Path        string
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

func pruneKernelSyncTerminalsLocked(now time.Time) {
	for id, terminal := range kernelSyncTerminals {
		if !terminal.expiresAt.After(now) {
			delete(kernelSyncTerminals, id)
		}
	}
}

func recordKernelSyncTerminal(session *kernelSyncSession, committed bool, generation uint64, changes int) {
	kernelSyncSessionsMu.Lock()
	defer kernelSyncSessionsMu.Unlock()
	pruneKernelSyncTerminalsLocked(time.Now())
	if len(kernelSyncTerminals) >= 1024 {
		var oldestID string
		var oldest time.Time
		for id, terminal := range kernelSyncTerminals {
			if oldestID == "" || terminal.expiresAt.Before(oldest) {
				oldestID, oldest = id, terminal.expiresAt
			}
		}
		delete(kernelSyncTerminals, oldestID)
	}
	kernelSyncTerminals[session.id] = kernelSyncTerminal{
		owner: session.owner, committed: committed, generation: generation, changes: changes, expiresAt: time.Now().Add(time.Hour),
	}
}

func lookupKernelSyncTerminal(c *gin.Context, sessionID string) (kernelSyncTerminal, bool) {
	kernelSyncSessionsMu.Lock()
	defer kernelSyncSessionsMu.Unlock()
	pruneKernelSyncTerminalsLocked(time.Now())
	terminal, exists := kernelSyncTerminals[sessionID]
	return terminal, exists && terminal.owner == kernelSyncRequestOwner(c)
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
	kernelSyncSessionsMu.Lock()
	pruneKernelSyncTerminalsLocked(time.Now())
	kernelSyncSessions[id] = session
	kernelSyncSessionsMu.Unlock()
	go session.maintainLease()
	ret.Data = map[string]any{
		"sessionId": id, "leaseId": id, "generation": session.generation, "protocolVersion": kernelSyncProtocolVersion,
		"maxChunkBytes": kernelSyncMaxChunkBytes, "maxStagedBytes": kernelSyncMaxStagedBytes,
		"runId": session.runID, "localDeviceId": session.localID, "remoteDeviceId": session.remoteID,
		"rulesFingerprint": session.rulesHash, "syncProtocolVersion": session.syncVersion,
	}
}

func (session *kernelSyncSession) maintainLease() {
	ticker := time.NewTicker(kernelSyncRenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-session.done:
			return
		case <-session.lease.Done():
			session.close(false)
			return
		case <-ticker.C:
			session.mu.Lock()
			committing := session.committing
			session.mu.Unlock()
			if committing {
				continue
			}
			if !session.lease.Renew(kernelSyncLeaseTTL) {
				session.close(false)
				return
			}
		}
	}
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
	session.mu.Unlock()
	kernelSyncSessionsMu.Lock()
	if kernelSyncSessions[session.id] == session {
		delete(kernelSyncSessions, session.id)
	}
	kernelSyncSessionsMu.Unlock()
	if unlockLease {
		session.lease.Unlock()
	}
	_ = os.RemoveAll(session.stageDir)
}

func lookupKernelSyncSession(c *gin.Context, sessionID string) (*kernelSyncSession, error) {
	if len(sessionID) != 48 {
		return nil, errors.New("invalid kernel sync session")
	}
	kernelSyncSessionsMu.Lock()
	session := kernelSyncSessions[sessionID]
	kernelSyncSessionsMu.Unlock()
	if session == nil || session.owner != kernelSyncRequestOwner(c) {
		return nil, errors.New("kernel sync session is not active")
	}
	select {
	case <-session.lease.Done():
		return nil, errors.New("kernel sync lease expired")
	default:
	}
	return session, nil
}

func abortKernelSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	sessionID := strings.TrimSpace(c.Query("sessionId"))
	session, err := lookupKernelSyncSession(c, sessionID)
	if err != nil {
		if terminal, exists := lookupKernelSyncTerminal(c, sessionID); exists {
			ret.Data = map[string]any{"aborted": !terminal.committed, "committed": terminal.committed}
			return
		}
		ret.Data = map[string]any{"aborted": false}
		return
	}
	recordKernelSyncTerminal(session, false, session.generation, 0)
	session.close(true)
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
	defer session.mu.Unlock()
	if session.closed || session.generation != model.WorkspaceGeneration() {
		ret.Code = http.StatusConflict
		ret.Msg = "workspace generation changed"
		return
	}
	if session.committing {
		ret.Code = http.StatusConflict
		ret.Msg = "kernel sync session is committing"
		return
	}
	change := session.changes[metadata.path]
	if metadata.operation == "delete" {
		if change != nil && change.Operation != "delete" {
			ret.Code = http.StatusConflict
			ret.Msg = "path already has a staged write"
			return
		}
		if change == nil {
			if len(session.changes) >= kernelSyncMaxChanges {
				ret.Code = http.StatusRequestEntityTooLarge
				ret.Msg = "staged change limit exceeded"
				return
			}
			session.changes[metadata.path] = &kernelSyncChange{
				Operation: "delete", Path: metadata.path, IfMatch: metadata.ifMatch, IfNoneMatch: metadata.ifNoneMatch, Complete: true,
			}
		}
		ret.Data = map[string]any{"staged": true}
		return
	}
	if change == nil {
		if len(session.changes) >= kernelSyncMaxChanges {
			ret.Code = http.StatusRequestEntityTooLarge
			ret.Msg = "staged change limit exceeded"
			return
		}
		if session.stagedBytes+metadata.size > kernelSyncMaxStagedBytes {
			ret.Code = http.StatusRequestEntityTooLarge
			ret.Msg = "session staged byte limit exceeded"
			return
		}
		stagePath := filepath.Join(session.stageDir, fmt.Sprintf("%08d.data", len(session.changes)))
		change = &kernelSyncChange{
			Operation: "write", Path: metadata.path, StagePath: stagePath, Size: metadata.size, Hash: metadata.hash,
			ModTime: metadata.modTime, IfMatch: metadata.ifMatch, IfNoneMatch: metadata.ifNoneMatch,
		}
		session.changes[metadata.path] = change
		session.stagedBytes += metadata.size
	} else if change.Operation != "write" || change.Size != metadata.size || change.Hash != metadata.hash ||
		!change.ModTime.Equal(metadata.modTime) || change.IfMatch != metadata.ifMatch || change.IfNoneMatch != metadata.ifNoneMatch {
		ret.Code = http.StatusConflict
		ret.Msg = "staged write metadata changed"
		return
	}
	if change.Complete {
		ret.Data = map[string]any{"staged": true, "complete": true, "size": change.Size, "hash": change.Hash}
		return
	}
	chunk, err := io.ReadAll(io.LimitReader(c.Request.Body, kernelSyncMaxChunkBytes+1))
	if err != nil || int64(len(chunk)) > kernelSyncMaxChunkBytes {
		ret.Code = http.StatusRequestEntityTooLarge
		ret.Msg = "staged chunk exceeds transfer limit"
		return
	}
	if metadata.offset+int64(len(chunk)) > change.Size {
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
	if metadata.offset < info.Size() {
		overlap := min(int64(len(chunk)), info.Size()-metadata.offset)
		existing := make([]byte, overlap)
		if _, err = file.ReadAt(existing, metadata.offset); err != nil || !equalBytes(existing, chunk[:overlap]) {
			_ = file.Close()
			ret.Code = http.StatusConflict
			ret.Msg = "retried staged chunk content differs"
			return
		}
	}
	if _, err = file.WriteAt(chunk, metadata.offset); err == nil && metadata.final {
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
		actual, hashErr := syncContentHashFile(change.StagePath, change.Hash)
		if hashErr != nil || actual != change.Hash {
			ret.Code = http.StatusUnprocessableEntity
			ret.Msg = "staged write hash mismatch"
			return
		}
		change.Complete = true
	}
	ret.Data = map[string]any{"staged": true, "complete": change.Complete, "received": metadata.offset + int64(len(chunk))}
}

func equalBytes(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
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
	changes := make([]*kernelSyncChange, 0, len(session.changes))
	for _, change := range session.changes {
		if !change.Complete {
			return nil, fmt.Errorf("staged change is incomplete: %s", change.Path)
		}
		copy := *change
		changes = append(changes, &copy)
	}
	sort.Slice(changes, func(left, right int) bool { return changes[left].Path < changes[right].Path })
	session.committing = true
	return changes, nil
}

type preparedKernelSyncChange struct {
	change     *kernelSyncChange
	guard      workspacePathGuard
	parent     *os.Root
	targetName string
	stagedName string
	backupName string
	existed    bool
	published  bool
}

func commitKernelSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	sessionID := strings.TrimSpace(c.Query("sessionId"))
	session, err := lookupKernelSyncSession(c, sessionID)
	if err != nil {
		if terminal, exists := lookupKernelSyncTerminal(c, sessionID); exists && terminal.committed {
			ret.Data = map[string]any{
				"committed": true, "generation": terminal.generation, "changes": terminal.changes, "alreadyTerminal": true,
			}
			return
		}
		ret.Code = http.StatusLocked
		ret.Msg = err.Error()
		return
	}
	session.operationMu.Lock()
	defer session.operationMu.Unlock()
	changes, err := sortedKernelSyncChanges(session)
	if err != nil {
		ret.Code = http.StatusConflict
		ret.Msg = err.Error()
		return
	}
	committed := false
	defer func() {
		if !committed {
			session.mu.Lock()
			session.committing = false
			session.mu.Unlock()
		}
	}()
	if session.generation != model.WorkspaceGeneration() {
		ret.Code = http.StatusConflict
		ret.Msg = "workspace generation changed"
		return
	}
	if len(changes) == 0 {
		recordKernelSyncTerminal(session, true, session.generation, 0)
		committed = true
		session.closeOperationLocked(true)
		ret.Data = map[string]any{"committed": true, "generation": session.generation, "changes": 0}
		return
	}
	if !session.lease.EnterCritical() {
		ret.Code = http.StatusLocked
		ret.Msg = "kernel sync lease cannot enter commit"
		return
	}

	guards := make([]workspacePathGuard, 0, len(changes))
	prepared := make([]*preparedKernelSyncChange, 0, len(changes))
	documentTargets := make([]model.RawDocumentIndexTarget, 0)
	documentLocations := map[string]kernelSyncDocumentLocation{}
	for _, change := range changes {
		guard, resolveErr := resolveWorkspacePath(change.Path, true)
		if resolveErr != nil {
			ret.Code = http.StatusForbidden
			ret.Msg = resolveErr.Error()
			return
		}
		if guard.rejectsEncryptedBox() {
			ret.Code = http.StatusForbidden
			ret.Msg = "kernel sync does not support encrypted notebook files"
			return
		}
		_, location, documentPath, locationErr := kernelSyncNotebookDocumentLocation(guard)
		if locationErr != nil {
			ret.Code = http.StatusUnprocessableEntity
			ret.Msg = locationErr.Error()
			return
		}
		if documentPath {
			documentTargets = append(documentTargets, model.RawDocumentIndexTarget{BoxID: location.boxID, DocumentPath: location.path})
			documentLocations[change.Path] = location
		}
		guards = append(guards, guard)
		prepared = append(prepared, &preparedKernelSyncChange{change: change, guard: guard})
	}

	var indexBatch *model.RawDocumentIndexBatch
	if len(documentTargets) > 0 {
		indexBatch, err = model.LockRawDocumentIndexBatch(documentTargets)
		if err != nil {
			ret.Code = http.StatusUnprocessableEntity
			ret.Msg = err.Error()
			return
		}
		defer indexBatch.Unlock()
	}
	unlocks := lockWorkspacePaths(guards...)
	defer unlocks()
	defer func() {
		for _, item := range prepared {
			if item.parent != nil {
				if item.stagedName != "" {
					_ = item.parent.Remove(item.stagedName)
				}
				if item.backupName != "" {
					_ = item.parent.Remove(item.backupName)
				}
				_ = item.parent.Close()
			}
		}
	}()

	for _, item := range prepared {
		if err = item.guard.revalidate(); err != nil {
			ret.Code = http.StatusForbidden
			ret.Msg = err.Error()
			return
		}
		workspaceRoot, relativePath, openErr := item.guard.openWorkspaceRoot()
		if openErr != nil {
			ret.Code = http.StatusForbidden
			ret.Msg = openErr.Error()
			return
		}
		parent, targetName, parentErr := openRootParentForCommit(workspaceRoot, relativePath, item.change.Operation == "write")
		_ = workspaceRoot.Close()
		if parentErr != nil {
			ret.Code = http.StatusInternalServerError
			ret.Msg = parentErr.Error()
			return
		}
		item.parent, item.targetName = parent, targetName
		exists, preconditionOK, message, preconditionErr := checkRootFilePreconditionLocked(parent, targetName, item.change.IfMatch, item.change.IfNoneMatch)
		if preconditionErr != nil {
			ret.Code = http.StatusInternalServerError
			ret.Msg = preconditionErr.Error()
			return
		}
		if !preconditionOK {
			ret.Code = http.StatusConflict
			ret.Msg = message
			return
		}
		item.existed = exists
		if exists {
			info, statErr := parent.Stat(targetName)
			if statErr != nil {
				ret.Code = http.StatusInternalServerError
				ret.Msg = statErr.Error()
				return
			}
			if info.IsDir() {
				ret.Code = http.StatusConflict
				ret.Msg = "kernel sync batch only accepts file changes"
				return
			}
		}
		if item.change.Operation == "delete" && !exists {
			ret.Code = http.StatusConflict
			ret.Msg = "delete target no longer exists"
			return
		}
		if item.change.Operation == "write" {
			staged, openErr := os.Open(item.change.StagePath)
			if openErr != nil {
				ret.Code = http.StatusInternalServerError
				ret.Msg = openErr.Error()
				return
			}
			item.stagedName, err = stageFileForRootCommit(parent, staged, 0644, item.change.ModTime)
			closeErr := staged.Close()
			if err == nil {
				err = closeErr
			}
			if err != nil {
				ret.Code = http.StatusInternalServerError
				ret.Msg = err.Error()
				return
			}
		}
	}

	if indexBatch != nil {
		for _, item := range prepared {
			location, documentPath := documentLocations[item.change.Path]
			if !documentPath {
				continue
			}
			if item.change.Operation == "delete" {
				if _, err = indexBatch.PrepareRemoval(location.boxID, location.path); err != nil {
					ret.Code = http.StatusConflict
					ret.Msg = err.Error()
					return
				}
				continue
			}
			staged, openErr := item.parent.Open(item.stagedName)
			if openErr != nil {
				ret.Code = http.StatusInternalServerError
				ret.Msg = openErr.Error()
				return
			}
			info, statErr := staged.Stat()
			if statErr == nil {
				_, statErr = indexBatch.PrepareUpsert(location.boxID, location.path, staged, info.Size())
			}
			closeErr := staged.Close()
			if statErr == nil {
				statErr = closeErr
			}
			if statErr != nil {
				ret.Code = http.StatusUnprocessableEntity
				ret.Msg = statErr.Error()
				return
			}
		}
	}
	if session.generation != model.WorkspaceGeneration() {
		ret.Code = http.StatusConflict
		ret.Msg = "workspace generation changed"
		return
	}

	for _, item := range prepared {
		if item.existed {
			item.backupName, err = newKernelSyncSiblingName(".siyuan-sync-backup-")
			if err == nil {
				err = item.parent.Link(item.targetName, item.backupName)
			}
			if err != nil {
				ret.Code = http.StatusInternalServerError
				ret.Msg = err.Error()
				return
			}
		}
	}

	var publishErr error
	for _, item := range prepared {
		if item.change.Operation == "delete" {
			publishErr = item.parent.Remove(item.targetName)
		} else {
			publishErr = commitRootStagedFile(item.parent, item.stagedName, item.targetName, false)
			if publishErr == nil {
				item.stagedName = ""
			}
		}
		if publishErr != nil {
			break
		}
		item.published = true
	}
	if publishErr == nil && indexBatch != nil {
		publishErr = indexBatch.Commit()
	}
	if publishErr != nil {
		rollbackErr := rollbackKernelSyncFiles(prepared)
		ret.Code = http.StatusInternalServerError
		ret.Msg = errors.Join(publishErr, rollbackErr).Error()
		return
	}

	kernelSyncReloadFiletree()
	kernelSyncIncSync()
	newGeneration := model.WorkspaceGeneration()
	recordKernelSyncTerminal(session, true, newGeneration, len(prepared))
	committed = true
	session.closeOperationLocked(true)
	ret.Data = map[string]any{"committed": true, "generation": newGeneration, "changes": len(prepared)}
}

func newKernelSyncSiblingName(prefix string) (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(value[:]) + ".tmp", nil
}

func rollbackKernelSyncFiles(prepared []*preparedKernelSyncChange) error {
	var errs []error
	for index := len(prepared) - 1; index >= 0; index-- {
		item := prepared[index]
		if !item.published {
			continue
		}
		if removeErr := item.parent.Remove(item.targetName); removeErr != nil && !os.IsNotExist(removeErr) {
			errs = append(errs, fmt.Errorf("remove published %s: %w", item.change.Path, removeErr))
			continue
		}
		if item.existed {
			if restoreErr := item.parent.Link(item.backupName, item.targetName); restoreErr != nil {
				errs = append(errs, fmt.Errorf("restore %s: %w", item.change.Path, restoreErr))
			}
		}
	}
	return errors.Join(errs...)
}
