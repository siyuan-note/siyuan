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
	"errors"
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
	tempPath := filepath.Join(util.TempDir, "bazaar", "local", gulu.Rand.String(7))
	cleanup = func() { _ = os.RemoveAll(tempPath) }
	if err = extractLocalPackageArchive(archivePath, tempPath); err != nil {
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

	pkg, err = ParsePackageJSON(manifestPath)
	if err != nil || pkg == nil {
		err = errors.New("invalid marketplace package manifest")
		cleanup()
	}
	return
}

func extractLocalPackageArchive(archivePath, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return errors.New("invalid marketplace package archive")
	}
	defer reader.Close()

	if len(reader.File) == 0 {
		return errors.New("marketplace package archive is empty")
	}
	if len(reader.File) > maxLocalPackageFileCount {
		return errors.New("marketplace package contains too many files")
	}

	var declaredTotal uint64
	for _, item := range reader.File {
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

	if err = os.MkdirAll(destination, 0755); err != nil {
		return err
	}
	var extractedTotal uint64
	for _, item := range reader.File {
		if err = extractLocalPackageItem(item, destination, &extractedTotal); err != nil {
			return err
		}
	}
	return nil
}

func extractLocalPackageItem(item *zip.File, destination string, extractedTotal *uint64) error {
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
	written, copyErr := io.Copy(target, io.LimitReader(source, int64(maxLocalPackageFileSize)+1))
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
