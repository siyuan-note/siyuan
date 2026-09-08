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

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type assetUploadTestFile struct {
	name string
	data []byte
}

type assetUploadTestResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		ErrFiles    []string             `json:"errFiles"`
		FailedFiles []AssetUploadFailure `json:"failedFiles"`
		SuccFiles   []AssetUploadSuccess `json:"succFiles"`
	} `json:"data"`
}

func setupAssetUploadTest(t *testing.T) string {
	t.Helper()
	originalConf, originalDataDir := Conf, util.DataDir
	Conf = NewAppConf()
	Conf.Sync = conf.NewSync()
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		Conf = originalConf
		util.DataDir = originalDataDir
	})
	return filepath.Join(util.DataDir, "assets")
}

func newAssetUploadTestRequest(t *testing.T, files []assetUploadTestFile, values map[string]string) *http.Request {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for _, file := range files {
		part, err := writer.CreateFormFile("file[]", file.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write(file.data); err != nil {
			t.Fatal(err)
		}
	}
	for name, value := range values {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/asset/upload", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = request.MultipartForm.RemoveAll() })
	return request
}

func cacheAssetUploadTestFile(t *testing.T, assetsDir, name string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetsDir, name), data, 0644); err != nil {
		t.Fatal(err)
	}
	hash, err := util.GetEtagByHandle(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	cache.SetAssetHash(hash, "assets/"+name)
	t.Cleanup(func() { cache.RemoveAssetHash(hash) })
}

func executeAssetUploadTestRequest(t *testing.T, request *http.Request) assetUploadTestResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = request
	Upload(context)
	response := assetUploadTestResponse{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func cleanupAssetUploadTestHashes(t *testing.T, successes []AssetUploadSuccess) {
	t.Helper()
	t.Cleanup(func() {
		for _, success := range successes {
			if hash := cache.GetAssetHashByPath(success.Path); hash != nil {
				cache.RemoveAssetHash(hash.Hash)
			}
		}
	})
}

func TestRecordAssetUploadSuccessPreservesDuplicateNames(t *testing.T) {
	succMap := map[string]any{}
	var succFiles []AssetUploadSuccess
	recordAssetUploadSuccess(succMap, &succFiles, 0, "image.png", "assets/image-first.png")
	recordAssetUploadSuccess(succMap, &succFiles, 1, "image.png", "assets/image-second.png")

	if len(succFiles) != 2 {
		t.Fatalf("expected two successful files, got %d", len(succFiles))
	}
	if succFiles[0].Index != 0 || succFiles[0].Path != "assets/image-first.png" {
		t.Fatalf("unexpected first successful file: %+v", succFiles[0])
	}
	if succFiles[1].Index != 1 || succFiles[1].Path != "assets/image-second.png" {
		t.Fatalf("unexpected second successful file: %+v", succFiles[1])
	}
	if succMap["image.png"] != "assets/image-second.png" {
		t.Fatalf("legacy success map should retain the latest path, got %v", succMap["image.png"])
	}
}

func TestRecordAssetUploadFailurePreservesInputIndex(t *testing.T) {
	var failedFiles []AssetUploadFailure
	recordAssetUploadFailure(&failedFiles, 2, "missing.png", errors.New("file not found"))

	if len(failedFiles) != 1 {
		t.Fatalf("expected one failed file, got %d", len(failedFiles))
	}
	if failedFiles[0].Index != 2 || failedFiles[0].Name != "missing.png" || failedFiles[0].Error != "file not found" {
		t.Fatalf("unexpected failed file: %+v", failedFiles[0])
	}
}

func TestInsertLocalAssetsWithoutBlockIDUsesGlobalAssets(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	sourceData := []byte("agent pasted image")
	sourcePath := filepath.Join(t.TempDir(), "pasted.png")
	if err := os.WriteFile(sourcePath, sourceData, 0644); err != nil {
		t.Fatal(err)
	}
	hash, err := util.GetEtagByHandle(bytes.NewReader(sourceData), int64(len(sourceData)))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(assetsDir, "existing.png"), sourceData, 0644); err != nil {
		t.Fatal(err)
	}
	cache.SetAssetHash(hash, "assets/existing.png")
	t.Cleanup(func() { cache.RemoveAssetHash(hash) })

	succMap, succFiles, failedFiles, err := InsertLocalAssets("", []string{sourcePath}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(failedFiles) != 0 || len(succFiles) != 1 {
		t.Fatalf("unexpected local asset result: successes=%+v failures=%+v", succFiles, failedFiles)
	}
	if succMap["pasted.png"] != succFiles[0].Path || filepath.ToSlash(filepath.Dir(succFiles[0].Path)) != "assets" {
		t.Fatalf("local asset was not inserted into global assets: %+v", succFiles[0])
	}
	uploadedData, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(succFiles[0].Path)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(uploadedData, sourceData) {
		t.Fatalf("unexpected uploaded data: %q", uploadedData)
	}
	if uploadedHash := cache.GetAssetHashByPath(succFiles[0].Path); uploadedHash != nil {
		cache.RemoveAssetHash(uploadedHash.Hash)
	}
}

func TestMultipartUploadContinuesAfterFileOpenFailure(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	firstData := []byte("first upload")
	thirdData := []byte("third upload")
	cacheAssetUploadTestFile(t, assetsDir, "first.png", firstData)
	cacheAssetUploadTestFile(t, assetsDir, "third.png", thirdData)
	request := newAssetUploadTestRequest(t, []assetUploadTestFile{
		{name: "first.png", data: firstData},
		{name: "third.png", data: thirdData},
	}, nil)
	validFiles := request.MultipartForm.File["file[]"]
	request.MultipartForm.File["file[]"] = []*multipart.FileHeader{
		validFiles[0],
		{Filename: "broken.png"},
		validFiles[1],
	}

	response := executeAssetUploadTestRequest(t, request)

	if response.Code != 0 {
		t.Fatalf("unexpected upload response code: %d", response.Code)
	}
	if len(response.Data.SuccFiles) != 2 || response.Data.SuccFiles[0].Index != 0 ||
		response.Data.SuccFiles[1].Index != 2 {
		t.Fatalf("unexpected successful files: %+v", response.Data.SuccFiles)
	}
	if len(response.Data.FailedFiles) != 1 || response.Data.FailedFiles[0].Index != 1 ||
		response.Data.FailedFiles[0].Name != "broken.png" {
		t.Fatalf("unexpected failed files: %+v", response.Data.FailedFiles)
	}
	if len(response.Data.ErrFiles) != 1 {
		t.Fatalf("unexpected legacy error files: %+v", response.Data.ErrFiles)
	}
}

func TestMultipartUploadContinuesAfterDuplicateMatch(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	firstData := []byte("duplicate upload")
	secondData := []byte("second upload")
	cacheAssetUploadTestFile(t, assetsDir, "different.png", firstData)
	cacheAssetUploadTestFile(t, assetsDir, "second.png", secondData)
	if err := os.WriteFile(filepath.Join(assetsDir, "first-existing.png"), firstData, 0644); err != nil {
		t.Fatal(err)
	}
	request := newAssetUploadTestRequest(t, []assetUploadTestFile{
		{name: "first.png", data: firstData},
		{name: "second.png", data: secondData},
	}, map[string]string{"skipIfDuplicated": "true"})

	response := executeAssetUploadTestRequest(t, request)

	if response.Code != 0 || len(response.Data.FailedFiles) != 0 {
		t.Fatalf("unexpected upload response: %+v", response)
	}
	if len(response.Data.SuccFiles) != 2 || response.Data.SuccFiles[0].Index != 0 ||
		response.Data.SuccFiles[1].Index != 1 {
		t.Fatalf("unexpected successful files: %+v", response.Data.SuccFiles)
	}
}

func TestInsertLocalAssetsReusesCompleteRelativePaths(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	names := []string{"photo.png", "scans/photo.png", "scans/pages/photo.png"}
	inputs := make([]string, 0, len(names)+1)
	for _, name := range names {
		filePath := filepath.Join(assetsDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filePath, []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
		inputs = append(inputs, filePath)
	}
	inputs = append(inputs, filepath.Join(assetsDir, "scans", "missing.png"))
	_, successes, failures, err := InsertLocalAssets("", inputs, true)
	if err != nil || len(successes) != len(names) || len(failures) != 1 || failures[0].Index != len(names) {
		t.Fatalf("unexpected result: successes=%+v failures=%+v err=%v", successes, failures, err)
	}
	for index, success := range successes {
		if success.Path != "assets/"+names[index] {
			t.Fatalf("unexpected reused path: %+v", success)
		}
		content, readErr := os.ReadFile(filepath.Join(util.DataDir, filepath.FromSlash(success.Path)))
		if readErr != nil || string(content) != names[index] {
			t.Fatalf("reused path changed content: %q, %v", content, readErr)
		}
	}
}

func TestMultipartUploadUsesEncryptedDirectoryAttribution(t *testing.T) {
	setupAssetUploadTest(t)
	originalWorkspaceDir := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspaceDir })
	const boxID = "20260908000000-abcdefg"
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	confData, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	confDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err = os.MkdirAll(confDir, 0755); err != nil {
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
	t.Cleanup(func() {
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
		forgetRuntimeEncryptedBox(boxID)
	})

	plainData := []byte("private PDF rectangle capture")
	files := []assetUploadTestFile{
		{name: "annotation-capture-v2-20260908000001-hijklmn.png", data: plainData},
		{name: "annotation-capture-v2-20260908000001-hijklmn.png", data: plainData},
		{name: "annotation-90-capture-v2-20260908000001-hijklmn.png", data: []byte("rotated capture")},
		{name: "annotation-capture-v3-20260908000001-hijklmn.png", data: []byte("new capture profile")},
	}
	request := newAssetUploadTestRequest(t, files,
		map[string]string{"assetsDirPath": boxID + "/assets/", "skipIfDuplicated": "true"})
	response := executeAssetUploadTestRequest(t, request)

	if response.Code != 0 || len(response.Data.FailedFiles) != 0 || len(response.Data.SuccFiles) != len(files) {
		t.Fatalf("unexpected encrypted upload response: %+v", response)
	}
	paths := map[string]bool{}
	for index, success := range response.Data.SuccFiles {
		assetPath := success.Path
		if !strings.HasPrefix(assetPath, "assets/") || !strings.HasSuffix(assetPath, "?box="+boxID) {
			t.Fatalf("unexpected encrypted asset path: %s", assetPath)
		}
		if paths[assetPath] {
			t.Fatalf("encrypted captures reused a filename match: %s", assetPath)
		}
		paths[assetPath] = true
		diskName := filepath.Base(strings.SplitN(assetPath, "?", 2)[0])
		ciphertext, err := os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", diskName))
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Equal(ciphertext, files[index].data) {
			t.Fatal("encrypted notebook upload was stored as plaintext")
		}
		decrypted, originalName, err := DecryptAssetWithName(boxID, diskName, dek, ciphertext)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(decrypted, files[index].data) || originalName != files[index].name {
			t.Fatalf("unexpected decrypted upload: name=%q data=%q", originalName, decrypted)
		}
	}
	entries, err := os.ReadDir(filepath.Join(util.DataDir, boxID, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != len(files) {
		t.Fatalf("unexpected encrypted asset count: %d", len(entries))
	}
	if entries, readErr := os.ReadDir(filepath.Join(util.DataDir, "assets")); readErr == nil && len(entries) > 0 {
		t.Fatalf("encrypted upload created global assets: %+v", entries)
	} else if readErr != nil && !os.IsNotExist(readErr) {
		t.Fatal(readErr)
	}
}

func TestMultipartUploadDoesNotOverwriteFilesWithTheSameAssetID(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	name := "photo-20260828120000-abcdefg.png"
	firstData := []byte("first file with an existing asset ID")
	secondData := []byte("second file with an existing asset ID")
	cacheAssetUploadTestFile(t, assetsDir, "first-seed.png", firstData)
	cacheAssetUploadTestFile(t, assetsDir, "second-seed.png", secondData)
	request := newAssetUploadTestRequest(t, []assetUploadTestFile{
		{name: name, data: firstData},
		{name: name, data: secondData},
	}, nil)

	response := executeAssetUploadTestRequest(t, request)
	cleanupAssetUploadTestHashes(t, response.Data.SuccFiles)

	if len(response.Data.FailedFiles) != 0 || len(response.Data.SuccFiles) != 2 {
		t.Fatalf("unexpected upload response: %+v", response)
	}
	firstPath := response.Data.SuccFiles[0].Path
	secondPath := response.Data.SuccFiles[1].Path
	if firstPath == secondPath {
		t.Fatalf("different files used the same asset path: %s", firstPath)
	}
	firstUploaded, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(firstPath)))
	if err != nil {
		t.Fatal(err)
	}
	secondUploaded, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(secondPath)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(firstUploaded, firstData) || !bytes.Equal(secondUploaded, secondData) {
		t.Fatalf("uploaded contents were overwritten: first=%q second=%q", firstUploaded, secondUploaded)
	}
}

func TestMultipartUploadDoesNotReuseAnyConsecutiveAssetID(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	name := "photo-20260828120000-abcdefg-20260907120000-hijklmn.png"
	firstData := []byte("first file with consecutive asset IDs")
	secondData := []byte("second file with consecutive asset IDs")
	cacheAssetUploadTestFile(t, assetsDir, "first-consecutive-seed.png", firstData)
	cacheAssetUploadTestFile(t, assetsDir, "second-consecutive-seed.png", secondData)
	request := newAssetUploadTestRequest(t, []assetUploadTestFile{
		{name: name, data: firstData},
		{name: name, data: secondData},
	}, nil)

	response := executeAssetUploadTestRequest(t, request)
	cleanupAssetUploadTestHashes(t, response.Data.SuccFiles)

	if len(response.Data.FailedFiles) != 0 || len(response.Data.SuccFiles) != 2 {
		t.Fatalf("unexpected upload response: %+v", response)
	}
	if response.Data.SuccFiles[0].Path == response.Data.SuccFiles[1].Path {
		t.Fatalf("consecutive asset IDs reused the same path: %+v", response.Data.SuccFiles)
	}
	for index, success := range response.Data.SuccFiles {
		if strings.Contains(filepath.Base(success.Path), "-20260907120000-hijklmn.png") {
			t.Fatalf("upload %d retained the final external asset ID: %s", index, success.Path)
		}
	}
	firstUploaded, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(response.Data.SuccFiles[0].Path)))
	if err != nil {
		t.Fatal(err)
	}
	secondUploaded, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(response.Data.SuccFiles[1].Path)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(firstUploaded, firstData) || !bytes.Equal(secondUploaded, secondData) {
		t.Fatalf("uploaded contents were overwritten: first=%q second=%q", firstUploaded, secondUploaded)
	}
}

func TestMultipartUploadReusesSameContentWhenAssetIDsDiffer(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	existingName := "photo-20260828120001-hijklmn.png"
	uploadName := "photo-20260828120000-abcdefg.png"
	data := []byte("same file with an existing asset ID")
	cacheAssetUploadTestFile(t, assetsDir, existingName, data)
	request := newAssetUploadTestRequest(t, []assetUploadTestFile{
		{name: uploadName, data: data},
		{name: uploadName, data: data},
	}, nil)

	response := executeAssetUploadTestRequest(t, request)

	if len(response.Data.FailedFiles) != 0 || len(response.Data.SuccFiles) != 2 {
		t.Fatalf("unexpected upload response: %+v", response)
	}
	expectedPath := "assets/" + existingName
	if response.Data.SuccFiles[0].Path != expectedPath || response.Data.SuccFiles[1].Path != expectedPath {
		t.Fatalf("identical files were not reused: %+v", response.Data.SuccFiles)
	}
	entries, err := os.ReadDir(assetsDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("identical files created %d assets", len(entries))
	}
}

func TestInsertLocalAssetsDoesNotOverwriteFilesWithTheSameAssetID(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	name := "photo-20260828120000-abcdefg.png"
	firstData := []byte("first local file with an existing asset ID")
	secondData := []byte("second local file with an existing asset ID")
	cacheAssetUploadTestFile(t, assetsDir, "first-local-seed.png", firstData)
	cacheAssetUploadTestFile(t, assetsDir, "second-local-seed.png", secondData)
	firstPath := filepath.Join(t.TempDir(), name)
	secondPath := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(firstPath, firstData, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(secondPath, secondData, 0644); err != nil {
		t.Fatal(err)
	}

	_, successes, failures, err := InsertLocalAssets("", []string{firstPath, secondPath}, true)
	if err != nil {
		t.Fatal(err)
	}
	cleanupAssetUploadTestHashes(t, successes)
	if len(failures) != 0 || len(successes) != 2 {
		t.Fatalf("unexpected local upload result: successes=%+v failures=%+v", successes, failures)
	}
	if successes[0].Path == successes[1].Path {
		t.Fatalf("different local files used the same asset path: %+v", successes)
	}
	firstUploaded, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(successes[0].Path)))
	if err != nil {
		t.Fatal(err)
	}
	secondUploaded, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(successes[1].Path)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(firstUploaded, firstData) || !bytes.Equal(secondUploaded, secondData) {
		t.Fatalf("local uploaded contents were overwritten: first=%q second=%q", firstUploaded, secondUploaded)
	}
}

func TestInsertLocalAssetsDoesNotReuseAnyConsecutiveAssetID(t *testing.T) {
	assetsDir := setupAssetUploadTest(t)
	name := "photo-20260828120000-abcdefg-20260907120000-hijklmn.png"
	firstData := []byte("first local file with consecutive asset IDs")
	secondData := []byte("second local file with consecutive asset IDs")
	cacheAssetUploadTestFile(t, assetsDir, "first-local-consecutive-seed.png", firstData)
	cacheAssetUploadTestFile(t, assetsDir, "second-local-consecutive-seed.png", secondData)
	firstPath := filepath.Join(t.TempDir(), name)
	secondPath := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(firstPath, firstData, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(secondPath, secondData, 0644); err != nil {
		t.Fatal(err)
	}

	_, successes, failures, err := InsertLocalAssets("", []string{firstPath, secondPath}, true)
	if err != nil {
		t.Fatal(err)
	}
	cleanupAssetUploadTestHashes(t, successes)
	if len(failures) != 0 || len(successes) != 2 {
		t.Fatalf("unexpected local upload result: successes=%+v failures=%+v", successes, failures)
	}
	if successes[0].Path == successes[1].Path {
		t.Fatalf("consecutive asset IDs reused the same local path: %+v", successes)
	}
	firstUploaded, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(successes[0].Path)))
	if err != nil {
		t.Fatal(err)
	}
	secondUploaded, err := os.ReadFile(filepath.Join(assetsDir, filepath.Base(successes[1].Path)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(firstUploaded, firstData) || !bytes.Equal(secondUploaded, secondData) {
		t.Fatalf("local uploaded contents were overwritten: first=%q second=%q", firstUploaded, secondUploaded)
	}
}

func TestReadRTFDDirReturnsAnErrorForAFile(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), ".DS_Store")
	if err := os.WriteFile(filePath, []byte("metadata"), 0644); err != nil {
		t.Fatal(err)
	}

	entries, err := readRTFDDir(filePath)
	if err == nil {
		t.Fatal("expected reading a file as an RTFD directory to fail")
	}
	if len(entries) != 0 {
		t.Fatalf("unexpected RTFD entries: %+v", entries)
	}
}

func TestCopyRTFDEntriesRemovesPartialDestinationOnFailure(t *testing.T) {
	srcDir := t.TempDir()
	destDir := filepath.Join(t.TempDir(), "document.rtfd")
	for _, name := range []string{"first.png", "second.png"} {
		if err := os.WriteFile(filepath.Join(srcDir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		t.Fatal(err)
	}
	wantErr := errors.New("copy failed")
	copyCount := 0
	err = copyRTFDEntries(entries, srcDir, destDir, func(from, to string) error {
		copyCount++
		if copyCount == 2 {
			return wantErr
		}
		if err := os.MkdirAll(filepath.Dir(to), 0755); err != nil {
			return err
		}
		data, err := os.ReadFile(from)
		if err != nil {
			return err
		}
		return os.WriteFile(to, data, 0644)
	})

	if !errors.Is(err, wantErr) {
		t.Fatalf("unexpected copy error: %v", err)
	}
	if _, statErr := os.Stat(destDir); !os.IsNotExist(statErr) {
		t.Fatalf("partial RTFD directory was not removed: %v", statErr)
	}
}
