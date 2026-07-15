// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	kernelSyncManifestMaxFiles       = 500_000
	kernelSyncManifestMaxDirectories = 100_000
	kernelSyncManifestMaxDirEntries  = 50_000
)

var kernelSyncManifestHashCache = struct {
	sync.Mutex
	values map[string]string
}{values: map[string]string{}}

func kernelSyncManifestHashCacheKey(candidate kernelSyncScanCandidate) string {
	return candidate.path + "\x00" + candidate.changeToken + "\x00" + fmt.Sprint(candidate.size)
}

type kernelSyncManifestRequest struct {
	SessionID    string   `json:"sessionId"`
	Includes     []string `json:"includes"`
	Excludes     []string `json:"excludes"`
	AssetFormats []string `json:"assetFormats"`
}

type kernelSyncManifestEntry struct {
	Path        string `json:"path"`
	Hash        string `json:"hash"`
	Size        int64  `json:"size"`
	Mtime       int64  `json:"mtime"`
	ChangeToken string `json:"changeToken"`
}

type kernelSyncManifestResult struct {
	Entries          []kernelSyncManifestEntry `json:"entries"`
	ObservedFiles    []string                  `json:"observedFiles"`
	OpaqueRoots      []string                  `json:"opaqueRoots"`
	CoveredDirs      []string                  `json:"coveredDirs"`
	ExistingDirs     []string                  `json:"existingDirs"`
	Generation       uint64                    `json:"generation"`
	RunID            string                    `json:"runId"`
	LocalDeviceID    string                    `json:"localDeviceId"`
	RemoteDeviceID   string                    `json:"remoteDeviceId"`
	RulesFingerprint string                    `json:"rulesFingerprint"`
	ProtocolVersion  string                    `json:"protocolVersion"`
	ServiceVersion   int                       `json:"serviceVersion"`
}

type kernelSyncGlobMatcher struct {
	includes        []*regexp.Regexp
	excludes        []*regexp.Regexp
	includePrefixes []string
}

func compileKernelSyncGlob(pattern string) (*regexp.Regexp, error) {
	if len(pattern) > 512 || strings.ContainsRune(pattern, 0) || strings.Contains(pattern, "\\") {
		return nil, fmt.Errorf("invalid sync glob: %q", pattern)
	}
	var expression strings.Builder
	expression.WriteByte('^')
	for index := 0; index < len(pattern); {
		char := pattern[index]
		if char == '*' {
			if index+1 < len(pattern) && pattern[index+1] == '*' {
				index += 2
				if index < len(pattern) && pattern[index] == '/' {
					expression.WriteString("(?:.*/)?")
					index++
				} else {
					expression.WriteString(".*")
				}
				continue
			}
			expression.WriteString("[^/]*")
			index++
			continue
		}
		if char == '?' {
			expression.WriteString("[^/]")
			index++
			continue
		}
		expression.WriteString(regexp.QuoteMeta(string(char)))
		index++
	}
	expression.WriteByte('$')
	return regexp.Compile(expression.String())
}

func newKernelSyncGlobMatcher(includes, excludes []string) (*kernelSyncGlobMatcher, error) {
	if len(includes) > 10_000 || len(excludes) > 10_000 {
		return nil, fmt.Errorf("sync scope contains too many patterns")
	}
	matcher := &kernelSyncGlobMatcher{}
	for _, pattern := range includes {
		compiled, err := compileKernelSyncGlob(pattern)
		if err != nil {
			return nil, err
		}
		matcher.includes = append(matcher.includes, compiled)
		wildcard := strings.IndexAny(pattern, "?*")
		literal := pattern
		if wildcard >= 0 {
			literal = pattern[:wildcard]
		}
		if strings.HasSuffix(literal, "/") {
			literal = strings.TrimRight(literal, "/")
		} else if slash := strings.LastIndex(literal, "/"); slash >= 0 {
			literal = literal[:slash]
		} else if wildcard >= 0 {
			literal = ""
		}
		matcher.includePrefixes = append(matcher.includePrefixes, literal)
	}
	for _, pattern := range excludes {
		compiled, err := compileKernelSyncGlob(pattern)
		if err != nil {
			return nil, err
		}
		matcher.excludes = append(matcher.excludes, compiled)
	}
	return matcher, nil
}

func (matcher *kernelSyncGlobMatcher) excluded(relative string) bool {
	for _, expression := range matcher.excludes {
		if expression.MatchString(relative) || expression.MatchString(relative+"/__siyuan_sync_probe__") {
			return true
		}
	}
	return false
}

func (matcher *kernelSyncGlobMatcher) descend(relative string) bool {
	if relative == "" {
		return true
	}
	if matcher.excluded(relative) {
		return false
	}
	if len(matcher.includes) == 0 {
		return true
	}
	for _, prefix := range matcher.includePrefixes {
		if prefix == "" || prefix == relative || strings.HasPrefix(prefix, relative+"/") || strings.HasPrefix(relative, prefix+"/") {
			return true
		}
	}
	return false
}

func (matcher *kernelSyncGlobMatcher) matches(relative string) bool {
	if matcher.excluded(relative) {
		return false
	}
	if len(matcher.includes) == 0 {
		return true
	}
	for _, expression := range matcher.includes {
		if expression.MatchString(relative) {
			return true
		}
	}
	return false
}

type kernelSyncScanFrame struct {
	path     string
	relative string
}

type kernelSyncScanCandidate struct {
	path        string
	size        int64
	mtime       int64
	changeToken string
}

func readKernelSyncManifest(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	var request kernelSyncManifestRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = "invalid kernel sync manifest request"
		return
	}
	session, err := lookupKernelSyncSession(c, strings.TrimSpace(request.SessionID))
	if err != nil {
		ret.Code = http.StatusLocked
		ret.Msg = err.Error()
		return
	}
	matcher, err := newKernelSyncGlobMatcher(request.Includes, request.Excludes)
	if err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = err.Error()
		return
	}
	assetFormats := map[string]struct{}{}
	for _, format := range request.AssetFormats {
		format = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(format), "."))
		if format != "" {
			assetFormats[format] = struct{}{}
		}
	}
	result, err := buildKernelSyncManifest(session, matcher, assetFormats)
	if err != nil {
		ret.Code = http.StatusConflict
		ret.Msg = err.Error()
		return
	}
	ret.Data = result
}

func buildKernelSyncManifest(session *kernelSyncSession, matcher *kernelSyncGlobMatcher, assetFormats map[string]struct{}) (*kernelSyncManifestResult, error) {
	if session.generation != model.WorkspaceGeneration() {
		return nil, fmt.Errorf("workspace generation changed")
	}
	result := &kernelSyncManifestResult{
		Generation: session.generation, ExistingDirs: []string{"/data"}, RunID: session.runID,
		LocalDeviceID: session.localID, RemoteDeviceID: session.remoteID, RulesFingerprint: session.rulesHash,
		ProtocolVersion: session.syncVersion, ServiceVersion: kernelSyncProtocolVersion,
	}
	frames := []kernelSyncScanFrame{{path: "/data"}}
	var candidates []kernelSyncScanCandidate
	for len(frames) > 0 {
		frame := frames[0]
		frames = frames[1:]
		guard, err := resolveWorkspacePath(frame.path, false)
		if err != nil {
			return nil, fmt.Errorf("resolve manifest directory %s: %w", frame.path, err)
		}
		unlock := lockWorkspacePaths(guard)
		if err = guard.revalidate(); err != nil {
			unlock()
			return nil, err
		}
		root, relativePath, err := guard.openWorkspaceRoot()
		if err != nil {
			unlock()
			return nil, err
		}
		directory, err := root.OpenRoot(relativePath)
		_ = root.Close()
		if err != nil {
			unlock()
			return nil, err
		}
		entries, err := readRootDirLimited(directory, kernelSyncManifestMaxDirEntries)
		if err != nil {
			_ = directory.Close()
			unlock()
			return nil, err
		}
		result.CoveredDirs = append(result.CoveredDirs, frame.path)
		for _, entry := range entries {
			name := entry.Name()
			snapshot, snapshotErr := snapshotReadDirEntry(directory, name)
			if snapshotErr != nil {
				_ = directory.Close()
				unlock()
				return nil, fmt.Errorf("snapshot %s/%s: %w", frame.path, name, snapshotErr)
			}
			childPath := frame.path + "/" + name
			childRelative := name
			if frame.relative != "" {
				childRelative = frame.relative + "/" + name
			}
			if snapshot.isLink {
				result.OpaqueRoots = append(result.OpaqueRoots, childPath)
				continue
			}
			if snapshot.info.IsDir() {
				result.ExistingDirs = append(result.ExistingDirs, childPath)
				if len(result.ExistingDirs) > kernelSyncManifestMaxDirectories {
					_ = directory.Close()
					unlock()
					return nil, fmt.Errorf("manifest directory limit exceeded")
				}
				childAbs := filepath.Join(util.DataDir, filepath.FromSlash(childRelative))
				if rejectEncryptedBoxPath(childAbs) || !matcher.descend(childRelative) {
					result.OpaqueRoots = append(result.OpaqueRoots, childPath)
				} else {
					frames = append(frames, kernelSyncScanFrame{path: childPath, relative: childRelative})
				}
				continue
			}
			result.ObservedFiles = append(result.ObservedFiles, childPath)
			if len(result.ObservedFiles) > kernelSyncManifestMaxFiles {
				_ = directory.Close()
				unlock()
				return nil, fmt.Errorf("manifest file limit exceeded")
			}
			if !matcher.matches(childRelative) {
				continue
			}
			if len(assetFormats) > 0 && strings.HasPrefix(childRelative, "assets/") {
				extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
				if _, exists := assetFormats[extension]; !exists {
					continue
				}
			}
			candidates = append(candidates, kernelSyncScanCandidate{
				path: childPath, size: snapshot.info.Size(), mtime: snapshot.info.ModTime().Unix(), changeToken: snapshot.changeToken,
			})
		}
		_ = directory.Close()
		unlock()
		sort.Slice(frames, func(left, right int) bool { return frames[left].path < frames[right].path })
	}
	sort.Slice(candidates, func(left, right int) bool { return candidates[left].path < candidates[right].path })
	for _, candidate := range candidates {
		entry, err := hashKernelSyncManifestCandidate(candidate)
		if err != nil {
			return nil, err
		}
		result.Entries = append(result.Entries, entry)
	}
	sort.Strings(result.ObservedFiles)
	sort.Strings(result.OpaqueRoots)
	sort.Strings(result.CoveredDirs)
	sort.Strings(result.ExistingDirs)
	if session.generation != model.WorkspaceGeneration() {
		return nil, fmt.Errorf("workspace generation changed")
	}
	return result, nil
}

func hashKernelSyncManifestCandidate(candidate kernelSyncScanCandidate) (kernelSyncManifestEntry, error) {
	cacheKey := kernelSyncManifestHashCacheKey(candidate)
	kernelSyncManifestHashCache.Lock()
	cached := kernelSyncManifestHashCache.values[cacheKey]
	kernelSyncManifestHashCache.Unlock()
	if cached != "" {
		return kernelSyncManifestEntry{
			Path: candidate.path, Hash: cached, Size: candidate.size, Mtime: candidate.mtime, ChangeToken: candidate.changeToken,
		}, nil
	}
	guard, err := resolveWorkspacePath(candidate.path, false)
	if err != nil {
		return kernelSyncManifestEntry{}, err
	}
	unlock := lockWorkspacePaths(guard)
	defer unlock()
	if err = guard.revalidate(); err != nil {
		return kernelSyncManifestEntry{}, err
	}
	root, relativePath, err := guard.openWorkspaceRoot()
	if err != nil {
		return kernelSyncManifestEntry{}, err
	}
	defer root.Close()
	file, err := root.Open(relativePath)
	if err != nil {
		return kernelSyncManifestEntry{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return kernelSyncManifestEntry{}, err
	}
	if info.IsDir() || info.Size() != candidate.size {
		return kernelSyncManifestEntry{}, fmt.Errorf("source changed while building manifest: %s", candidate.path)
	}
	changeToken, err := fileChangeToken(file, info)
	if err != nil || changeToken != candidate.changeToken {
		return kernelSyncManifestEntry{}, fmt.Errorf("source changed while building manifest: %s", candidate.path)
	}
	hasher := sha256.New()
	if _, err = io.Copy(hasher, file); err != nil {
		return kernelSyncManifestEntry{}, err
	}
	hash := fmt.Sprintf("sha256:%x", hasher.Sum(nil))
	kernelSyncManifestHashCache.Lock()
	if len(kernelSyncManifestHashCache.values) >= kernelSyncManifestMaxFiles {
		kernelSyncManifestHashCache.values = map[string]string{}
	}
	kernelSyncManifestHashCache.values[cacheKey] = hash
	kernelSyncManifestHashCache.Unlock()
	return kernelSyncManifestEntry{
		Path: candidate.path, Hash: hash, Size: candidate.size,
		Mtime: candidate.mtime, ChangeToken: candidate.changeToken,
	}, nil
}
