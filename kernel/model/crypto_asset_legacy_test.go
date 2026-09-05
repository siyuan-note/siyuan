// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// legacyEncryptedAssetFixture 按无版本字段的资源格式生成样本，不调用当前资源编码器。
func legacyEncryptedAssetFixture(t *testing.T, boxID, diskName, originalName string, dek, plaintext []byte) []byte {
	t.Helper()
	const chunkSize = 1024 * 1024
	chunks := (len(plaintext) + chunkSize - 1) / chunkSize
	if chunks == 0 {
		chunks = 1
	}
	metadata, err := json.Marshal(struct {
		OriginalName string `json:"originalName"`
		Size         int64  `json:"size"`
		Chunks       uint64 `json:"chunks"`
	}{originalName, int64(len(plaintext)), uint64(chunks)})
	if err != nil {
		t.Fatal(err)
	}
	key := util.DeriveSubKey(dek, "siyuan/asset")
	defer clear(key)
	prefix := "siyuan:asset:" + boxID + ":assets/" + diskName
	encryptedMetadata, err := util.EncryptWithAAD(key, metadata, []byte(prefix+":metadata"))
	if err != nil {
		t.Fatal(err)
	}
	ret := []byte{'S', 'Y', 'A', 'E'}
	ret = binary.BigEndian.AppendUint32(ret, uint32(len(encryptedMetadata)))
	ret = append(ret, encryptedMetadata...)
	for i := range chunks {
		start, end := i*chunkSize, min((i+1)*chunkSize, len(plaintext))
		chunk, encryptErr := util.EncryptWithAAD(key, plaintext[start:end], []byte(fmt.Sprintf("%s:content:%d", prefix, i)))
		if encryptErr != nil {
			t.Fatal(encryptErr)
		}
		ret = binary.BigEndian.AppendUint32(ret, uint32(len(chunk)))
		ret = append(ret, chunk...)
	}
	return binary.BigEndian.AppendUint32(ret, 0)
}

func TestLegacyEncryptedAssetReaders(t *testing.T) {
	const boxID, diskName, originalName = "20260905120000-legacy1", "asset.bin", "旧附件.bin"
	dek := bytes.Repeat([]byte{31}, 32)
	for _, size := range []int{0, 1, 1024*1024 - 1, 1024 * 1024, 2*1024*1024 + 17} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			plaintext := bytes.Repeat([]byte{123}, size)
			ciphertext := legacyEncryptedAssetFixture(t, boxID, diskName, originalName, dek, plaintext)
			plain, name, err := DecryptAssetWithName(boxID, diskName, dek, ciphertext)
			if err != nil || name != originalName || !bytes.Equal(plain, plaintext) {
				t.Fatalf("legacy asset failed to open: name=%q err=%v", name, err)
			}
			if name, err = DecryptAssetName(boxID, diskName, dek, ciphertext); err != nil || name != originalName {
				t.Fatalf("legacy name failed to open: name=%q err=%v", name, err)
			}
			if name, err = DecryptAssetNameFromReader(boxID, diskName, dek, bytes.NewReader(ciphertext)); err != nil || name != originalName {
				t.Fatalf("legacy streamed name failed to open: name=%q err=%v", name, err)
			}
			var output bytes.Buffer
			name, err = DecryptAssetToWriter(boxID, diskName, dek, bytes.NewReader(ciphertext), &output)
			if err != nil || name != originalName || !bytes.Equal(output.Bytes(), plaintext) {
				t.Fatalf("legacy streamed content failed to open: name=%q err=%v", name, err)
			}
			upgraded, err := EncryptAsset(boxID, diskName, name, dek, plain)
			if err != nil {
				t.Fatal(err)
			}
			metadata, _, err := decryptAssetMetadata(boxID, diskName, dek, upgraded)
			if err != nil || metadata.Spec != encryptedAssetSpec || len(metadata.ContainerID) != encryptedAssetContainerIDSize {
				t.Fatalf("saving legacy content did not use current format: %v", err)
			}
			if plain, name, err = DecryptAssetWithName(boxID, diskName, dek, upgraded); err != nil || name != originalName || !bytes.Equal(plain, plaintext) {
				t.Fatalf("saving legacy content changed its name or bytes: %v", err)
			}
		})
	}
}

func TestLegacyEncryptedAssetRejectsCorruption(t *testing.T) {
	const boxID, diskName = "20260905120000-legacy1", "asset.bin"
	dek := bytes.Repeat([]byte{31}, 32)
	ciphertext := legacyEncryptedAssetFixture(t, boxID, diskName, "legacy.bin", dek, bytes.Repeat([]byte{17}, 2*1024*1024))
	offset := 8 + int(binary.BigEndian.Uint32(ciphertext[4:8]))
	chunkSize := 4 + int(binary.BigEndian.Uint32(ciphertext[offset:offset+4]))
	for _, problem := range []string{"metadata", "chunk", "reordered chunks", "truncated", "trailing", "wrong box", "wrong name", "wrong key"} {
		t.Run(problem, func(t *testing.T) {
			data := append([]byte(nil), ciphertext...)
			actualBoxID, actualName, key := boxID, diskName, dek
			switch problem {
			case "metadata":
				data[8] ^= 1
			case "chunk":
				data[offset+chunkSize-1] ^= 1
			case "reordered chunks":
				copy(data[offset:offset+chunkSize], ciphertext[offset+chunkSize:offset+2*chunkSize])
				copy(data[offset+chunkSize:offset+2*chunkSize], ciphertext[offset:offset+chunkSize])
			case "truncated":
				data = data[:len(data)-1]
			case "trailing":
				data = append(data, 1)
			case "wrong box":
				actualBoxID = "20260905120000-legacy2"
			case "wrong name":
				actualName = "renamed.bin"
			case "wrong key":
				key = bytes.Repeat([]byte{32}, 32)
			}
			if _, _, err := DecryptAssetWithName(actualBoxID, actualName, key, data); err == nil {
				t.Fatal("legacy asset accepted invalid content or context")
			}
		})
	}
}

func TestEncryptedAssetNeverFallsBackBetweenFormats(t *testing.T) {
	const boxID, diskName = "20260905120000-legacy1", "asset.bin"
	dek := bytes.Repeat([]byte{31}, 32)
	plaintext := bytes.Repeat([]byte{17}, 2*1024*1024)
	legacy := legacyEncryptedAssetFixture(t, boxID, diskName, "asset.bin", dek, plaintext)
	current, err := EncryptAsset(boxID, diskName, "asset.bin", dek, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	legacyOffset := 8 + int(binary.BigEndian.Uint32(legacy[4:8]))
	currentOffset := 8 + int(binary.BigEndian.Uint32(current[4:8]))
	for name, mixed := range map[string][]byte{
		"current metadata with legacy chunks": append(append([]byte(nil), current[:currentOffset]...), legacy[legacyOffset:]...),
		"legacy metadata with current chunks": append(append([]byte(nil), legacy[:legacyOffset]...), current[currentOffset:]...),
	} {
		t.Run(name, func(t *testing.T) {
			var output bytes.Buffer
			if _, err = DecryptAssetToWriter(boxID, diskName, dek, bytes.NewReader(mixed), &output); err == nil || output.Len() != 0 {
				t.Fatal("mixed formats were accepted or emitted unauthenticated plaintext")
			}
		})
	}
}

func TestLegacyEncryptedAssetDiskExportAndSnapshot(t *testing.T) {
	const boxID, diskName, originalName = "20260905120000-legacy3", "asset.bin", "旧版附件.bin"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()
	oldWorkspaceDir, oldTempDir := util.WorkspaceDir, util.TempDir
	util.WorkspaceDir, util.TempDir = filepath.Dir(util.DataDir), t.TempDir()
	defer func() { util.WorkspaceDir, util.TempDir = oldWorkspaceDir, oldTempDir }()
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	dek, err := GetDEKIfUnlocked(boxID)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(dek)
	plaintext := bytes.Repeat([]byte("legacy asset contents"), 100000)
	ciphertext := legacyEncryptedAssetFixture(t, boxID, diskName, originalName, dek, plaintext)
	assetPath := filepath.Join(util.DataDir, boxID, "assets", diskName)
	if err = os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(assetPath, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	if plain, err := ReadAssetBytesInBox(boxID, "assets/"+diskName); err != nil || !bytes.Equal(plain, plaintext) {
		t.Fatalf("legacy disk read failed: %v", err)
	}
	if name := LookupAssetOriginalName(boxID, diskName); name != originalName {
		t.Fatalf("legacy download name changed: %q", name)
	}
	if plain, err := decryptRepoDataIfNeeded(ciphertext, "/"+boxID+"/assets/"+diskName); err != nil || !bytes.Equal(plain, plaintext) {
		t.Fatalf("legacy snapshot read failed: %v", err)
	}
	exportPath := filepath.Join(util.TempDir, "desktop", "asset.bin")
	if err = copyAssetDecryptIfEncrypted(assetPath, exportPath); err != nil {
		t.Fatalf("legacy desktop export failed: %v", err)
	}
	if plain, err := os.ReadFile(exportPath); err != nil || !bytes.Equal(plain, plaintext) {
		t.Fatalf("legacy desktop export changed content: %v", err)
	}
	lease, err := AcquireMobileExportLease("assets/" + diskName + "?box=" + boxID)
	if err != nil {
		t.Fatalf("legacy mobile export failed: %v", err)
	}
	defer ReleaseMobileExportLease(lease.ID)
	if plain, err := os.ReadFile(lease.Path); err != nil || lease.Name != originalName || !bytes.Equal(plain, plaintext) {
		t.Fatalf("legacy mobile export changed content or name: %v", err)
	}
	if data, err := os.ReadFile(assetPath); err != nil || !bytes.Equal(data, ciphertext) {
		t.Fatalf("reading legacy asset modified the source: %v", err)
	}
}
