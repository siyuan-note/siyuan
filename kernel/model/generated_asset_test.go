// SiYuan - Refactor your thinking
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

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func useGeneratedAssetTestWorkspace(t *testing.T) string {
	t.Helper()
	originalWorkspaceDir := util.WorkspaceDir
	originalDataDir := util.DataDir
	originalConf := Conf
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	Conf = NewAppConf()
	Conf.Sync = conf.NewSync()
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		util.WorkspaceDir = originalWorkspaceDir
		util.DataDir = originalDataDir
		Conf = originalConf
	})
	return workspaceDir
}

func TestRemoveGeneratedAsset(t *testing.T) {
	useGeneratedAssetTestWorkspace(t)
	boxID := "20260715120000-abcdefg"
	assetsDir := filepath.Join(util.DataDir, boxID, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	diskName, err := StoreAssetForBox(boxID, assetsDir, "generated.png", []byte("generated"))
	if err != nil {
		t.Fatal(err)
	}
	assetPath := "assets/" + diskName
	if err = RemoveGeneratedAsset(boxID, assetPath); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(assetsDir, diskName)); !os.IsNotExist(err) {
		t.Fatalf("generated asset was not removed: %v", err)
	}
}

func TestRemoveGeneratedAssetCleansEncryptedNameMapping(t *testing.T) {
	useGeneratedAssetTestWorkspace(t)
	boxID := "20260715120001-abcdefg"
	t.Cleanup(func() {
		cachedDEKsLock.Lock()
		if cachedDEK, ok := cachedDEKs[boxID]; ok {
			zeroAndClear(cachedDEK)
			delete(cachedDEKs, boxID)
		}
		cachedDEKsLock.Unlock()
	})
	confDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	assetsDir := filepath.Join(util.DataDir, boxID, "assets")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	confData, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(confDir, "conf.json"), confData, 0644); err != nil {
		t.Fatal(err)
	}
	dek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	setDEKForTest(boxID, dek)
	diskName, err := StoreAssetForBox(boxID, assetsDir, "generated.png", []byte("generated"))
	if err != nil {
		t.Fatal(err)
	}
	if readAssetNameMapping(boxID)[diskName] != "generated.png" {
		t.Fatal("encrypted asset name mapping was not created")
	}
	assetPath := "assets/" + diskName + "?box=" + boxID
	if err = RemoveGeneratedAsset(boxID, assetPath); err != nil {
		t.Fatal(err)
	}
	if _, exists := readAssetNameMapping(boxID)[diskName]; exists {
		t.Fatal("encrypted asset name mapping was not removed")
	}
	if _, err = os.Stat(filepath.Join(assetsDir, diskName)); !os.IsNotExist(err) {
		t.Fatalf("encrypted generated asset was not removed: %v", err)
	}
}
