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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package bazaar

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	// MaxLocalPackageArchiveSize 限制上传的本地集市包压缩文件大小。
	MaxLocalPackageArchiveSize int64  = 128 * 1024 * 1024
	maxLocalPackageFileCount          = 10000
	maxLocalPackageFileSize    uint64 = 256 * 1024 * 1024
	maxLocalPackageExtractSize uint64 = 512 * 1024 * 1024
)

var localPackageManifests = map[string]string{
	"plugin.json":   "plugins",
	"theme.json":    "themes",
	"icon.json":     "icons",
	"template.json": "templates",
	"widget.json":   "widgets",
}

// ExtractLocalPackage 将本地集市包解压到临时目录并识别包类型。
func ExtractLocalPackage(archivePath string) (pkgType string, pkg *Package, packagePath string, cleanup func(), err error) {
	pkgType, pkg, packagePath, _, cleanup, err = extractLocalPackageWithHash(context.Background(), archivePath, "", false)
	return
}

// ExtractLocalPackageWithHash 从同一份已核验字节解压，不会在摘要验证后重新打开原始路径。
func ExtractLocalPackageWithHash(archivePath, expectedHash string) (pkgType string, pkg *Package, packagePath, packageHash string, cleanup func(), err error) {
	return ExtractLocalPackageWithHashContext(context.Background(), archivePath, expectedHash)
}

// ExtractLocalPackageWithHashContext 在核验与解压期间响应取消，未提交的临时内容会清理。
func ExtractLocalPackageWithHashContext(ctx context.Context, archivePath, expectedHash string) (pkgType string, pkg *Package, packagePath, packageHash string, cleanup func(), err error) {
	return extractLocalPackageWithHash(ctx, archivePath, expectedHash, true)
}

func extractLocalPackageWithHash(ctx context.Context, archivePath, expectedHash string, private bool) (pkgType string, pkg *Package, packagePath, packageHash string, cleanup func(), err error) {
	cleanup = func() {}
	if err = ctx.Err(); err != nil {
		return
	}
	if expectedHash != "" && !validInstallHash(expectedHash) {
		err = errors.New("invalid package hash")
		return
	}
	data, err := readInstallArchive(archivePath)
	if err != nil {
		return
	}
	packageHash = fmt.Sprintf("%x", sha256.Sum256(data))
	if expectedHash != "" && packageHash != expectedHash {
		err = ErrPackageHashConflict
		return
	}
	if err = ctx.Err(); err != nil {
		return
	}
	tempPath := filepath.Join(util.TempDir, "bazaar", "local", gulu.Rand.String(7))
	if private {
		root := filepath.Join(installPrivateRoot(), "install-operations")
		if err = makePrivateInstallDir(root); err != nil {
			return
		}
		tempPath, err = os.MkdirTemp(root, "extract-")
		if err != nil {
			return
		}
	}
	cleanup = func() { _ = os.RemoveAll(tempPath) }
	reader, readerErr := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if readerErr != nil {
		err = errors.New("invalid marketplace package archive")
		cleanup()
		return
	}
	if err = extractLocalPackageReaderContext(ctx, reader, tempPath); err != nil {
		cleanup()
		return
	}

	packagePath, err = localPackageRoot(tempPath)
	if err != nil {
		cleanup()
		return
	}

	var manifestPath string
	for manifestName, packageType := range localPackageManifests {
		candidate := filepath.Join(packagePath, manifestName)
		if info, statErr := os.Stat(candidate); statErr == nil && info.Mode().IsRegular() {
			if manifestPath != "" {
				err = errors.New("multiple marketplace package manifests found")
				cleanup()
				return
			}
			pkgType = packageType
			manifestPath = candidate
		}
	}
	if manifestPath == "" {
		err = errors.New("marketplace package manifest not found")
		cleanup()
		return
	}

	manifestData, readErr := os.ReadFile(manifestPath)
	if readErr != nil {
		err = readErr
		cleanup()
		return
	}
	pkg, err = parseInstallPackageManifest(manifestData)
	if err != nil || pkg == nil {
		err = errors.New("invalid marketplace package manifest")
		cleanup()
	}
	return
}

func extractLocalPackageReader(reader *zip.Reader, destination string) error {
	return extractLocalPackageReaderContext(context.Background(), reader, destination)
}

func extractLocalPackageReaderContext(ctx context.Context, reader *zip.Reader, destination string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateLocalPackageArchive(reader); err != nil {
		return err
	}
	if err := os.MkdirAll(destination, 0755); err != nil {
		return err
	}
	var extractedTotal uint64
	for _, item := range reader.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := extractLocalPackageItem(ctx, item, destination, &extractedTotal); err != nil {
			return err
		}
	}
	return ctx.Err()
}

func validateLocalPackageArchive(reader *zip.Reader) error {
	if len(reader.File) == 0 {
		return errors.New("marketplace package archive is empty")
	}
	if len(reader.File) > maxLocalPackageFileCount {
		return errors.New("marketplace package contains too many files")
	}

	var declaredTotal uint64
	seen := map[string]bool{}
	spellings := map[string]string{}
	for _, item := range reader.File {
		name := strings.TrimSuffix(item.Name, "/")
		if err := validateInstallRelativePath(name); err != nil {
			return err
		}
		key := strings.ToLower(name)
		if seen[key] {
			return errors.New("marketplace package contains duplicate or colliding paths")
		}
		seen[key] = true
		parts := strings.Split(name, "/")
		for i := range parts {
			prefix := strings.Join(parts[:i+1], "/")
			folded := strings.ToLower(prefix)
			if previous, ok := spellings[folded]; ok && previous != prefix {
				return errors.New("marketplace package contains colliding path components")
			}
			spellings[folded] = prefix
		}
		mode := item.Mode()
		if mode&os.ModeSymlink != 0 || (!mode.IsRegular() && !mode.IsDir()) {
			return errors.New("marketplace package contains an unsupported file")
		}
		if item.UncompressedSize64 > maxLocalPackageFileSize {
			return errors.New("marketplace package contains a file that is too large")
		}
		if ^uint64(0)-declaredTotal < item.UncompressedSize64 {
			return errors.New("marketplace package is too large")
		}
		declaredTotal += item.UncompressedSize64
		if declaredTotal > maxLocalPackageExtractSize {
			return errors.New("marketplace package is too large")
		}
	}

	return nil
}

func parseInstallPackageManifest(data []byte) (*Package, error) {
	var pkg *Package
	if err := gulu.JSON.UnmarshalJSON(data, &pkg); err != nil || pkg == nil {
		return nil, errors.New("invalid marketplace package manifest")
	}
	pkg.URL = strings.TrimSuffix(pkg.URL, "/")
	clearPackageDeprecationMetadata(pkg)
	return pkg, nil
}

// InspectLocalPackageWithHash 只在内存中查看同一份归档字节，不创建解压目录或修改安装目标。
func InspectLocalPackageWithHash(archivePath, expectedHash string) (pkgType string, pkg *Package, packageHash string, err error) {
	if expectedHash != "" && !validInstallHash(expectedHash) {
		return "", nil, "", errors.New("invalid package hash")
	}
	data, err := readInstallArchive(archivePath)
	if err != nil {
		return
	}
	packageHash = fmt.Sprintf("%x", sha256.Sum256(data))
	if expectedHash != "" && packageHash != expectedHash {
		err = ErrPackageHashConflict
		return
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return
	}
	if err = validateLocalPackageArchive(reader); err != nil {
		return
	}
	tops := map[string]bool{}
	hasRootManifest := false
	for _, item := range reader.File {
		name := strings.TrimSuffix(item.Name, "/")
		tops[strings.Split(name, "/")[0]] = true
		if _, ok := localPackageManifests[name]; ok && item.Mode().IsRegular() {
			hasRootManifest = true
		}
	}
	prefix := ""
	if !hasRootManifest {
		if len(tops) != 1 {
			err = errors.New("marketplace package manifest must be at the archive root or its only top-level directory")
			return
		}
		for top := range tops {
			prefix = top + "/"
		}
	}
	var manifest *zip.File
	for _, item := range reader.File {
		name := strings.TrimPrefix(item.Name, prefix)
		if kind, ok := localPackageManifests[name]; ok && item.Mode().IsRegular() {
			if manifest != nil {
				err = errors.New("multiple marketplace package manifests found")
				return
			}
			manifest, pkgType = item, kind
		}
	}
	if manifest == nil {
		err = errors.New("marketplace package manifest not found")
		return
	}
	stream, err := manifest.Open()
	if err != nil {
		return
	}
	defer stream.Close()
	manifestData, err := io.ReadAll(io.LimitReader(stream, 1024*1024+1))
	if err != nil {
		return
	}
	if len(manifestData) > 1024*1024 {
		err = errors.New("marketplace package manifest is too large")
		return
	}
	pkg, err = parseInstallPackageManifest(manifestData)
	return
}

type localPackageContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader localPackageContextReader) Read(data []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	return reader.reader.Read(data)
}

func extractLocalPackageItem(ctx context.Context, item *zip.File, destination string, extractedTotal *uint64) error {
	name := strings.ReplaceAll(item.Name, "\\", "/")
	if name == "" || strings.HasPrefix(name, "/") {
		return errors.New("marketplace package contains an invalid path")
	}
	destinationPath := filepath.Join(destination, filepath.FromSlash(name))
	if !gulu.File.IsSubPath(destination, destinationPath) {
		return errors.New("marketplace package contains an invalid path")
	}

	mode := item.Mode()
	if mode&os.ModeSymlink != 0 || (!mode.IsRegular() && !mode.IsDir()) {
		return errors.New("marketplace package contains an unsupported file")
	}
	if mode.IsDir() {
		return os.MkdirAll(destinationPath, 0755)
	}
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0755); err != nil {
		return err
	}

	source, err := item.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	written, copyErr := io.Copy(target, io.LimitReader(localPackageContextReader{ctx: ctx, reader: source}, int64(maxLocalPackageFileSize)+1))
	closeErr := target.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written > int64(maxLocalPackageFileSize) {
		return errors.New("marketplace package contains a file that is too large")
	}
	if uint64(written) > maxLocalPackageExtractSize-*extractedTotal {
		return errors.New("marketplace package is too large")
	}
	*extractedTotal += uint64(written)
	return nil
}

func localPackageRoot(extractPath string) (string, error) {
	if hasLocalPackageManifest(extractPath) {
		return extractPath, nil
	}
	entries, err := os.ReadDir(extractPath)
	if err != nil {
		return "", err
	}
	if len(entries) != 1 || !entries[0].IsDir() {
		return "", errors.New("marketplace package manifest must be at the archive root or its only top-level directory")
	}
	root := filepath.Join(extractPath, entries[0].Name())
	if !hasLocalPackageManifest(root) {
		return "", errors.New("marketplace package manifest not found")
	}
	return root, nil
}

func hasLocalPackageManifest(root string) bool {
	for manifestName := range localPackageManifests {
		if info, err := os.Stat(filepath.Join(root, manifestName)); err == nil && info.Mode().IsRegular() {
			return true
		}
	}
	return false
}
