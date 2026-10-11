package model

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
	"golang.org/x/mod/semver"
)

const installPackageMetadataVersion = 1

// installPackageMetadata 记录线上取得的校验信息，仅在安装包校验成功后持久化。
type installPackageMetadata struct {
	FormatVersion int    `json:"formatVersion"`
	Version       string `json:"version"`
	Channel       string `json:"channel"`
	FileName      string `json:"fileName"`
	Checksum      string `json:"checksum"`
	Signature     string `json:"signature,omitempty"`
}

func validInstallPackageMetadata(metadata *installPackageMetadata) bool {
	if metadata == nil || metadata.FormatVersion != installPackageMetadataVersion ||
		!isValidUpdateChannel(metadata.Channel) || !isReleaseAllowed(metadata.Channel, metadata.Version) ||
		metadata.Version != strings.TrimPrefix(normalizeReleaseVersion(metadata.Version), "v") ||
		installPackageVersion(metadata.FileName) != normalizeReleaseVersion(metadata.Version) ||
		metadata.FileName != filepath.Base(metadata.FileName) || strings.Contains(metadata.FileName, "\\") {
		return false
	}
	return metadata.Checksum != "" && metadata.Checksum == normalizeSHA256(metadata.Checksum)
}

// installPackageMetadataMAC 使用独立的用途前缀，防止临时目录中的记录被改写后绕过校验。
func installPackageMetadataMAC(metadata *installPackageMetadata, key string) []byte {
	unsigned := *metadata
	unsigned.Signature = ""
	data, _ := json.Marshal(unsigned)
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte("siyuan-install-package-v1\x00"))
	mac.Write(data)
	return mac.Sum(nil)
}

func saveInstallPackageMetadata(installDir string, metadata *installPackageMetadata, key string) error {
	if key == "" || !validInstallPackageMetadata(metadata) {
		return errors.New("install package metadata or authentication key is invalid")
	}
	signed := *metadata
	signed.Signature = hex.EncodeToString(installPackageMetadataMAC(metadata, key))
	data, err := json.Marshal(signed)
	if err != nil {
		return err
	}
	return gulu.File.WriteFileSafer(filepath.Join(installDir, metadata.FileName+".json"), data, 0600)
}

func readInstallPackageMetadata(path, key string) (*installPackageMetadata, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 16*1024+1))
	if err != nil {
		return nil, err
	}
	metadata := &installPackageMetadata{}
	if len(data) > 16*1024 {
		return nil, io.ErrUnexpectedEOF
	}
	if err = json.Unmarshal(data, metadata); err != nil {
		return nil, err
	}
	signature, err := hex.DecodeString(metadata.Signature)
	if err != nil || key == "" || !validInstallPackageMetadata(metadata) ||
		!hmac.Equal(signature, installPackageMetadataMAC(metadata, key)) {
		return nil, errors.New("install package metadata authentication failed")
	}
	return metadata, nil
}

// verifiedInstallPackagePath 每次读取都重新校验文件，拒绝缺失、不完整或被修改的安装包。
func verifiedInstallPackagePath(installDir string, metadata *installPackageMetadata) string {
	if !validInstallPackageMetadata(metadata) {
		return ""
	}
	path := filepath.Join(installDir, metadata.FileName)
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return ""
	}
	checksum, err := sha256Hash(path)
	if err != nil || metadata.Checksum != checksum {
		return ""
	}
	return path
}

// findReadyInstallPackage 只使用本地已验证记录，不访问更新服务，也不等待下载任务。
func findReadyInstallPackage(installDir, currentVersion, channel, suffix, key string) string {
	if !isValidUpdateChannel(channel) || suffix == "" || !semver.IsValid(normalizeReleaseVersion(currentVersion)) {
		return ""
	}
	entries, err := os.ReadDir(installDir)
	if os.IsNotExist(err) {
		return ""
	}
	if err != nil {
		logging.LogWarnf("read ready install packages failed: %s", err)
		return ""
	}
	var selected *installPackageMetadata
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		metadata, readErr := readInstallPackageMetadata(filepath.Join(installDir, entry.Name()), key)
		if readErr != nil || !validInstallPackageMetadata(metadata) ||
			entry.Name() != metadata.FileName+".json" ||
			metadata.FileName != "siyuan-"+metadata.Version+"-"+suffix ||
			!isReleaseAllowed(channel, metadata.Version) ||
			semver.Compare(normalizeReleaseVersion(metadata.Version), normalizeReleaseVersion(currentVersion)) <= 0 {
			continue
		}
		if selected == nil || semver.Compare(normalizeReleaseVersion(metadata.Version), normalizeReleaseVersion(selected.Version)) > 0 {
			selected = metadata
		}
	}
	return verifiedInstallPackagePath(installDir, selected)
}
