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

package flashcard

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/siyuan-note/filelock"
)

const (
	manifestFilename = "manifest.json"
	manifestEncoding = "canonical-json"
)

var manifestCapabilities = []string{
	"immutable-events",
	"immutable-snapshots",
	"operation-batches",
	"sqlite-projection",
	"versioned-entities",
	"writer-isolated-segments",
}

// Manifest 描述 v2 目录的确定性格式能力。
type Manifest struct {
	FormatVersion int      `json:"formatVersion"`
	MinimumClient string   `json:"minimumClient"`
	Encoding      string   `json:"encoding"`
	Capabilities  []string `json:"capabilities"`
}

// DefaultManifest 返回所有设备必须一致生成的 v2 格式清单。
func DefaultManifest() Manifest {
	return Manifest{
		FormatVersion: FormatVersion,
		MinimumClient: "3.9.0",
		Encoding:      manifestEncoding,
		Capabilities:  append([]string(nil), manifestCapabilities...),
	}
}

// ManifestBytes 返回确定性清单字节。
func ManifestBytes() ([]byte, error) {
	data, err := CanonicalJSON(DefaultManifest())
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

// EnsureManifest 创建或验证确定性格式清单。
func EnsureManifest(root string) error {
	if root == "" {
		return errors.New("flashcard v2 root is required")
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return fmt.Errorf("create flashcard v2 root: %w", err)
	}
	expected, err := ManifestBytes()
	if err != nil {
		return fmt.Errorf("encode flashcard manifest: %w", err)
	}
	path := filepath.Join(root, manifestFilename)
	info, statErr := os.Lstat(path)
	if statErr == nil && (info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular()) {
		return errors.New("flashcard manifest is not a regular file")
	}
	if statErr != nil && !os.IsNotExist(statErr) {
		return fmt.Errorf("inspect flashcard manifest: %w", statErr)
	}
	actual, err := filelock.ReadFile(path)
	if err == nil {
		if !bytes.Equal(actual, expected) {
			return errors.New("flashcard manifest is not the canonical supported manifest")
		}
		return nil
	}
	if !os.IsNotExist(err) {
		return fmt.Errorf("read flashcard manifest: %w", err)
	}
	if err = filelock.WriteFile(path, expected); err != nil {
		return fmt.Errorf("write flashcard manifest: %w", err)
	}
	actual, err = filelock.ReadFile(path)
	if err != nil {
		return fmt.Errorf("verify flashcard manifest: %w", err)
	}
	if !bytes.Equal(actual, expected) {
		return errors.New("flashcard manifest changed while being created")
	}
	return nil
}
