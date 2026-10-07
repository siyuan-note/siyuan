// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package bazaar

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	maxInstallBackupCount       = 32
	maxInstallBackupBytes int64 = 512 * 1024 * 1024
)

// InstallBackupInfo 仅记录代码恢复点和原启用标志，不保存运行时数据或配置内容。
type InstallBackupInfo struct {
	ID                string   `json:"id"`
	FormatVersion     int      `json:"formatVersion"`
	PackageType       string   `json:"packageType"`
	PackageName       string   `json:"packageName"`
	InstalledRevision string   `json:"installedRevision"`
	PackageHash       string   `json:"packageHash"`
	PreviousEnabled   *bool    `json:"previousEnabled,omitempty"`
	CreatedAt         int64    `json:"createdAt"`
	CodeOnly          bool     `json:"codeOnly"`
	OmittedPaths      []string `json:"omittedPaths,omitempty"`
}

func installPrivateRoot() string {
	confDir := util.ConfDir
	if confDir == "" && filepath.IsAbs(util.DataDir) {
		confDir = filepath.Join(filepath.Dir(util.DataDir), "conf")
	}
	if confDir == "" {
		return ""
	}
	return filepath.Join(confDir, "plugin-development")
}

func DefaultInstallBackupRoot() string {
	root := installPrivateRoot()
	if root == "" {
		return ""
	}
	return filepath.Join(root, "install-backups")
}

// makePrivateInstallDir 拒绝链接目录及非绝对根；已有目录同样逐层检查。
func makePrivateInstallDir(root string) error {
	if !filepath.IsAbs(root) {
		return errors.New("private package operation root is unavailable")
	}
	if err := rejectInstallPathLinks(root); err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	return rejectInstallPathLinks(root)
}

func rejectInstallPathLinks(target string) error {
	target, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	for current := target; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && (info.Mode()&os.ModeSymlink != 0 || !info.IsDir()) {
			return errors.New("package operation path must contain only regular directories")
		}
		if filepath.Dir(current) == current {
			return nil
		}
	}
}

func validInstallBackupID(id string) bool {
	data, err := hex.DecodeString(id)
	return err == nil && len(data) == 16 && strings.ToLower(id) == id
}

func ReadInstallBackup(root, id string) (*InstallBackupInfo, string, error) {
	packageInstallLock.Lock()
	defer packageInstallLock.Unlock()
	return readInstallBackup(root, id)
}

func readInstallBackup(root, id string) (*InstallBackupInfo, string, error) {
	if !validInstallBackupID(id) || !filepath.IsAbs(root) {
		return nil, "", errors.New("invalid install backup")
	}
	directory := filepath.Join(root, id)
	if err := rejectInstallPathLinks(directory); err != nil {
		return nil, "", err
	}
	metadataPath := filepath.Join(directory, "manifest.json")
	data, err := readInstallRegularPath(metadataPath, 1024*1024)
	if err != nil {
		return nil, "", err
	}
	backup := &InstallBackupInfo{}
	if err = json.Unmarshal(data, backup); err != nil || backup.ID != id || backup.FormatVersion != 1 ||
		backup.PackageType != "plugins" || !IsValidPackageName(backup.PackageName) || !backup.CodeOnly ||
		!validInstallHash(backup.PackageHash) || !validInstallHash(backup.InstalledRevision) || len(backup.OmittedPaths) != 0 {
		return nil, "", errors.New("invalid install backup metadata")
	}
	return backup, filepath.Join(directory, "code.zip"), nil
}

func ListInstallBackups(root, packageName string) ([]*InstallBackupInfo, error) {
	if !IsValidPackageName(packageName) || !filepath.IsAbs(root) {
		return nil, errors.New("invalid install backup request")
	}
	packageInstallLock.Lock()
	defer packageInstallLock.Unlock()
	if err := rejectInstallPathLinks(root); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return []*InstallBackupInfo{}, nil
	}
	if err != nil {
		return nil, err
	}
	backups := []*InstallBackupInfo{}
	for _, entry := range entries {
		if !entry.IsDir() || !validInstallBackupID(entry.Name()) {
			continue
		}
		backup, _, err := readInstallBackup(root, entry.Name())
		if err != nil {
			return nil, err
		}
		if backup.PackageName == packageName {
			backups = append(backups, backup)
		}
	}
	sort.Slice(backups, func(i, j int) bool { return backups[i].CreatedAt > backups[j].CreatedAt })
	return backups, nil
}

// excludedInstallCodePath 识别无法安全纳入完整代码恢复点的路径；命中时拒绝覆盖，不生成残缺备份。
func excludedInstallCodePath(name string) bool {
	for _, component := range strings.Split(strings.ToLower(name), "/") {
		if component == ".env" || strings.HasPrefix(component, ".env.") {
			return true
		}
		switch component {
		case ".git", ".ssh", ".aws", ".config", ".cache", "data", "storage", "config", "configs", "settings", "cache", "logs", "backup", "backups", "secrets", "credentials":
			return true
		}
		if strings.HasPrefix(component, "id_rsa") || strings.HasPrefix(component, "id_ed25519") {
			return true
		}
		switch component {
		case "data.json", "config.json", "settings.json", "token.json", "tokens.json", "auth.json", "credentials.json", "secrets.json":
			return true
		}
		switch filepath.Ext(component) {
		case ".pem", ".key", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3", ".log", ".bak":
			return true
		}
	}
	return false
}

// createInstallBackup 必须在 packageInstallLock 内调用；额度用尽时拒绝更新，不自动删除恢复点。
func createInstallBackup(installPath, revision string, options PackageInstallOptions) (*InstallBackupInfo, error) {
	if options.PackageType != "plugins" || !IsValidPackageName(options.PackageName) {
		return nil, errors.New("code backups support plugins only")
	}
	if err := makePrivateInstallDir(options.BackupRoot); err != nil {
		return nil, err
	}
	count, used, err := installBackupUsage(options.BackupRoot)
	if err != nil {
		return nil, err
	}
	if count >= maxInstallBackupCount || used >= maxInstallBackupBytes {
		return nil, errors.New("backup_failed: install backup retention is full; existing recovery copies were preserved")
	}
	idBytes := make([]byte, 16)
	if _, err = rand.Read(idBytes); err != nil {
		return nil, err
	}
	backup := &InstallBackupInfo{
		ID: hex.EncodeToString(idBytes), FormatVersion: 1, PackageType: options.PackageType,
		PackageName: options.PackageName, InstalledRevision: revision, CodeOnly: true, CreatedAt: time.Now().UnixMilli(),
	}
	if options.PriorEnabled != nil {
		enabled, err := options.PriorEnabled()
		if err != nil {
			return nil, err
		}
		backup.PreviousEnabled = &enabled
	}
	stage, err := os.MkdirTemp(options.BackupRoot, ".pending-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(stage)
	file, err := os.OpenFile(filepath.Join(stage, "code.zip"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	digest := sha256.New()
	limited := &installBackupWriter{writer: io.MultiWriter(file, digest), remaining: min(MaxLocalPackageArchiveSize, maxInstallBackupBytes-used)}
	writer := zip.NewWriter(limited)
	manifestFound := false
	copiedRevision, err := visitInstallTree(installPath, func(name string, info fs.FileInfo, data []byte) error {
		if excludedInstallCodePath(name) {
			return errors.New("backup_failed: plugin code directory contains ambiguous runtime, configuration or credential paths; refusing incomplete code recovery")
		}
		if name == "plugin.json" {
			var manifest Package
			if err := json.Unmarshal(data, &manifest); err != nil || manifest.Name != options.PackageName {
				return errors.New("backup_failed: existing plugin manifest identity is invalid")
			}
			manifestFound = true
		}
		for _, marker := range []string{"-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN OPENSSH PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----"} {
			if bytes.Contains(data, []byte(marker)) {
				return errors.New("backup_failed: private key material in plugin code directory")
			}
		}
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		header.SetMode(0644)
		if info.IsDir() {
			header.Name += "/"
			header.SetMode(os.ModeDir | 0755)
			header.Method = zip.Store
		}
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}
		_, err = entry.Write(data)
		return err
	})
	closeErr := writer.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr = file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, err
	}
	if copiedRevision != revision {
		return nil, ErrInstalledRevisionConflict
	}
	if !manifestFound {
		return nil, errors.New("backup_failed: existing plugin manifest is missing")
	}
	backup.PackageHash = fmt.Sprintf("%x", digest.Sum(nil))
	metadata, err := json.Marshal(backup)
	if err != nil {
		return nil, err
	}
	if used+limited.written+int64(len(metadata)) > maxInstallBackupBytes {
		return nil, errors.New("backup_failed: install backup retention is full")
	}
	metadataFile, err := os.OpenFile(filepath.Join(stage, "manifest.json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	_, err = metadataFile.Write(metadata)
	if err == nil {
		err = metadataFile.Sync()
	}
	closeErr = metadataFile.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, err
	}
	if err = syncInstallDirectory(stage); err != nil {
		return nil, err
	}
	if err = os.Rename(stage, filepath.Join(options.BackupRoot, backup.ID)); err != nil {
		return nil, err
	}
	if err = syncInstallDirectory(options.BackupRoot); err != nil {
		return nil, err
	}
	return backup, nil
}

type installBackupWriter struct {
	writer    io.Writer
	remaining int64
	written   int64
}

func (writer *installBackupWriter) Write(data []byte) (int, error) {
	if int64(len(data)) > writer.remaining {
		return 0, errors.New("backup_failed: install backup size limit exceeded")
	}
	n, err := writer.writer.Write(data)
	writer.remaining -= int64(n)
	writer.written += int64(n)
	return n, err
}

func installBackupUsage(root string) (count int, size int64, err error) {
	err = filepath.WalkDir(root, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || name == root {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.IsDir() {
			if filepath.Dir(name) == root {
				count++
			}
			return nil
		}
		if !info.Mode().IsRegular() {
			return errors.New("invalid install backup file")
		}
		size += info.Size()
		return nil
	})
	return
}
