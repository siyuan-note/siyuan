// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type managedEncryptedExport struct {
	boxID     string
	artifact  string
	expiresAt time.Time
}

var managedEncryptedExports = struct {
	sync.Mutex
	jobs map[string]managedEncryptedExport
}{jobs: map[string]managedEncryptedExport{}}

type ExportArtifactLease struct {
	ID   string `json:"leaseID"`
	Path string `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type MobileExportLease = ExportArtifactLease

type mobileExportLeaseState struct {
	boxID      string
	cleanupDir string
	expiresAt  time.Time
	timer      *time.Timer
}

var mobileExportLeaseTTL = 30 * time.Minute

var mobileExportLeases = struct {
	sync.Mutex
	leases map[string]*mobileExportLeaseState
}{leases: map[string]*mobileExportLeaseState{}}

func newManagedEncryptedExportID() (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return hex.EncodeToString(random), nil
}

// registerManagedEncryptedExport 登记一个加密笔记本的导出产物，返回相对路径作为下载令牌。
// kind 标识产物来源（resources/sy/markdown/repo），仅影响注册 key 的分段，解析与撤销均按 boxID 前缀匹配。
func registerManagedEncryptedExport(boxID, kind, artifact string) string {
	relativePath := path.Join(boxID, kind, filepath.Base(artifact))
	managedEncryptedExports.Lock()
	managedEncryptedExports.jobs[relativePath] = managedEncryptedExport{
		boxID:     boxID,
		artifact:  artifact,
		expiresAt: time.Now().Add(time.Hour),
	}
	managedEncryptedExports.Unlock()
	return relativePath
}

// RegisterManagedEncryptedExport 是 registerManagedEncryptedExport 的导出包装，供 api 层调用。
func RegisterManagedEncryptedExport(boxID, kind, artifact string) string {
	return registerManagedEncryptedExport(boxID, kind, artifact)
}

// ResolveManagedEncryptedExport 返回仍有效的加密导出产物，未登记、已撤销或过期的路径均不可下载。
func ResolveManagedEncryptedExport(relativePath string) (boxID, artifact string, ok bool) {
	relativePath = path.Clean("/" + relativePath)
	relativePath = relativePath[1:]

	managedEncryptedExports.Lock()
	job, ok := managedEncryptedExports.jobs[relativePath]
	if !ok {
		managedEncryptedExports.Unlock()
		return "", "", false
	}
	if time.Now().After(job.expiresAt) {
		delete(managedEncryptedExports.jobs, relativePath)
		managedEncryptedExports.Unlock()
		_ = os.Remove(job.artifact)
		return "", "", false
	}
	managedEncryptedExports.Unlock()
	return job.boxID, job.artifact, true
}

// RevokeManagedEncryptedExportsForBox 使指定笔记本的所有导出下载链接立即失效。
func RevokeManagedEncryptedExportsForBox(boxID string) {
	managedEncryptedExports.Lock()
	defer managedEncryptedExports.Unlock()
	for relativePath, job := range managedEncryptedExports.jobs {
		if job.boxID == boxID {
			delete(managedEncryptedExports.jobs, relativePath)
		}
	}
}

// clearEncryptedExportTempOnBoot 清理异常退出后残留的加密笔记本明文导出目录。
// 加密导出的第一层目录固定为 boxID，普通导出和插件临时目录不使用该命名形式。
func clearEncryptedExportTempOnBoot() {
	if strings.TrimSpace(util.TempDir) == "" {
		logging.LogWarnf("skip clearing stale encrypted export temp: temp dir is not initialized")
		return
	}
	exportDir := filepath.Join(util.TempDir, "export")
	entries, err := os.ReadDir(exportDir)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		logging.LogWarnf("read export temp dir [%s] failed: %s", exportDir, err)
		return
	}
	for _, entry := range entries {
		if !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		entryPath := filepath.Join(exportDir, entry.Name())
		if err = os.RemoveAll(entryPath); err != nil {
			logging.LogWarnf("remove stale encrypted export temp [%s] failed: %s", entryPath, err)
		}
	}
}

// IsManagedEncryptedExportPath 判断相对路径是否属于加密导出受控范围（<boxID>/<kind>/<file> 结构）。
// 只要路径首段是合法 boxID 格式即视为受控，不依赖 box 是否仍存在（笔记本删除后仍需按注册表拒绝，
// 避免因 IsEncryptedBox 返回 false 而 fail-open 暴露明文产物）。
func IsManagedEncryptedExportPath(relativePath string) bool {
	relativePath = path.Clean("/" + relativePath)
	parts := strings.SplitN(strings.TrimPrefix(relativePath, "/"), "/", 3)
	return len(parts) >= 1 && ast.IsNodeIDPattern(parts[0])
}

// AcquireExportArtifactLease 为导出产物取得覆盖整个复制过程的生命周期租约。
func AcquireExportArtifactLease(exportPath string) (lease *ExportArtifactLease, err error) {
	if after, ok := strings.CutPrefix(exportPath, "/export/"); ok {
		fileName, decodeErr := url.PathUnescape(after)
		if decodeErr != nil {
			return nil, decodeErr
		}
		fileName = filepath.Clean(fileName)
		if fileName == "." || strings.HasPrefix(fileName, "..") || filepath.IsAbs(fileName) {
			return nil, errors.New("invalid export path")
		}
		if IsManagedEncryptedExportPath(fileName) {
			boxID, artifact, resolved := ResolveManagedEncryptedExport(fileName)
			if !resolved {
				return nil, errors.New("managed export is unavailable")
			}
			if err = AcquireEncryptedBoxOperation(boxID); err != nil {
				return nil, err
			}
			HoldBoxReadLock(boxID)
			release := true
			defer func() {
				if release {
					ReleaseBoxReadLock(boxID)
					ReleaseEncryptedBoxOperation(boxID)
				}
			}()
			_, artifact, resolved = ResolveManagedEncryptedExport(fileName)
			if !resolved {
				return nil, errors.New("managed export is unavailable")
			}
			if _, dekErr := GetDEKIfUnlocked(boxID); dekErr != nil {
				return nil, dekErr
			}
			lease, err = registerMobileExportLease(boxID, artifact, filepath.Base(fileName), "")
			if err == nil {
				release = false
			}
			return
		}
		artifact := filepath.Join(util.TempDir, "export", fileName)
		if !gulu.File.IsSubPath(filepath.Join(util.TempDir, "export"), artifact) {
			return nil, errors.New("export path is outside export directory")
		}
		return registerMobileExportLease("", artifact, filepath.Base(fileName), "")
	}

	if !strings.HasPrefix(exportPath, "assets/") {
		return nil, errors.New("unsupported export path")
	}
	relativePath, boxID, parseErr := assetPathAndBox(exportPath, "")
	if parseErr != nil {
		return nil, parseErr
	}
	if boxID == "" || !IsEncryptedBox(boxID) {
		artifact, resolveErr := GetAssetAbsPath(relativePath)
		if resolveErr != nil {
			return nil, resolveErr
		}
		return registerMobileExportLease("", artifact, filepath.Base(artifact), "")
	}

	if err = AcquireEncryptedBoxOperation(boxID); err != nil {
		return nil, err
	}
	HoldBoxReadLock(boxID)
	release := true
	defer func() {
		if release {
			ReleaseBoxReadLock(boxID)
			ReleaseEncryptedBoxOperation(boxID)
		}
	}()
	dek, dekErr := GetDEKIfUnlocked(boxID)
	if dekErr != nil {
		return nil, dekErr
	}
	artifact, resolveErr := GetAssetAbsPathInBox(relativePath, boxID)
	if resolveErr != nil {
		return nil, resolveErr
	}
	diskName := filepath.Base(relativePath)
	leaseID, idErr := newManagedEncryptedExportID()
	if idErr != nil {
		return nil, idErr
	}
	cleanupDir := filepath.Join(util.TempDir, "export", boxID, "mobile", leaseID)
	if mkErr := os.MkdirAll(cleanupDir, 0700); mkErr != nil {
		return nil, mkErr
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(cleanupDir)
		}
	}()
	source, openErr := filelock.OpenFile(artifact, os.O_RDONLY, 0)
	if openErr != nil {
		return nil, openErr
	}
	sourceOpen := true
	defer func() {
		if sourceOpen {
			_ = filelock.CloseFile(source)
		}
	}()
	plainPath := filepath.Join(cleanupDir, "artifact")
	destination, createErr := os.OpenFile(plainPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if createErr != nil {
		return nil, createErr
	}
	originalName, decryptErr := DecryptAssetToWriter(boxID, diskName, dek, source, destination)
	sourceCloseErr := filelock.CloseFile(source)
	sourceOpen = false
	closeErr := destination.Close()
	if decryptErr != nil {
		return nil, decryptErr
	}
	if sourceCloseErr != nil {
		return nil, sourceCloseErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	originalName = util.FilterFileName(filepath.Base(originalName))
	if originalName == "" || originalName == "." {
		originalName = diskName
	}
	lease, err = registerMobileExportLeaseWithID(leaseID, boxID, plainPath, originalName, cleanupDir)
	if err != nil {
		_ = os.RemoveAll(cleanupDir)
		return nil, err
	}
	cleanup = false
	release = false
	return
}

// AcquireMobileExportLease 为移动端导出取得覆盖整个原生复制过程的生命周期租约。
func AcquireMobileExportLease(exportPath string) (lease *MobileExportLease, err error) {
	return AcquireExportArtifactLease(exportPath)
}

// GetMobileExportName 返回移动端保存对话框使用的文件名，不生成明文临时文件。
func GetMobileExportName(exportPath string) string {
	if after, ok := strings.CutPrefix(exportPath, "/export/"); ok {
		if decoded, err := url.PathUnescape(after); err == nil {
			if IsManagedEncryptedExportPath(decoded) {
				return ""
			}
			return util.FilterFileName(filepath.Base(decoded))
		}
		return ""
	}
	if !strings.HasPrefix(exportPath, "assets/") {
		return ""
	}
	relativePath, boxID, err := assetPathAndBox(exportPath, "")
	if err != nil {
		return ""
	}
	diskName := filepath.Base(relativePath)
	if boxID == "" || !IsEncryptedBox(boxID) {
		return util.FilterFileName(diskName)
	}
	return ""
}

func registerMobileExportLease(boxID, artifact, name, cleanupDir string) (*MobileExportLease, error) {
	leaseID, err := newManagedEncryptedExportID()
	if err != nil {
		return nil, err
	}
	return registerMobileExportLeaseWithID(leaseID, boxID, artifact, name, cleanupDir)
}

func registerMobileExportLeaseWithID(leaseID, boxID, artifact, name, cleanupDir string) (*MobileExportLease, error) {
	info, err := os.Stat(artifact)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("export artifact [%s] is a directory", artifact)
	}
	state := &mobileExportLeaseState{
		boxID:      boxID,
		cleanupDir: cleanupDir,
		expiresAt:  time.Now().Add(mobileExportLeaseTTL),
	}
	mobileExportLeases.Lock()
	if _, exists := mobileExportLeases.leases[leaseID]; exists {
		mobileExportLeases.Unlock()
		return nil, fmt.Errorf("mobile export lease [%s] already exists", leaseID)
	}
	mobileExportLeases.leases[leaseID] = state
	state.timer = time.AfterFunc(mobileExportLeaseTTL, func() {
		releaseMobileExportLease(leaseID, true)
	})
	mobileExportLeases.Unlock()
	return &MobileExportLease{ID: leaseID, Path: artifact, Name: name, Size: info.Size()}, nil
}

// ReleaseExportArtifactLease 释放导出产物租约；重复调用不会产生副作用。
func ReleaseExportArtifactLease(leaseID string) {
	releaseMobileExportLease(leaseID, false)
}

// ReleaseMobileExportLease 释放移动端导出租约；重复调用不会产生副作用。
func ReleaseMobileExportLease(leaseID string) {
	ReleaseExportArtifactLease(leaseID)
}

func releaseMobileExportLease(leaseID string, expired bool) {
	mobileExportLeases.Lock()
	state, ok := mobileExportLeases.leases[leaseID]
	if ok {
		delete(mobileExportLeases.leases, leaseID)
	}
	mobileExportLeases.Unlock()
	if !ok {
		return
	}
	if state.timer != nil {
		state.timer.Stop()
	}
	if state.cleanupDir != "" {
		if err := os.RemoveAll(state.cleanupDir); err != nil {
			logging.LogWarnf("remove mobile export lease [%s] failed: %s", leaseID, err)
		}
	}
	if state.boxID != "" {
		ReleaseBoxReadLock(state.boxID)
		ReleaseEncryptedBoxOperation(state.boxID)
	}
	if expired {
		logging.LogWarnf("mobile export lease [%s] expired at [%s]", leaseID, state.expiresAt.Format(time.RFC3339))
	}
}
