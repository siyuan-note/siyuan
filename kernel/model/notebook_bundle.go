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
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	syNotebookBundleSpec         = 1
	syNotebookBundleManifestPath = ".siyuan/notebooks.json"
)

type syNotebookBundleManifest struct {
	Spec      int                     `json:"spec"`
	Notebooks []syNotebookBundleEntry `json:"notebooks"`
}

type syNotebookBundleEntry struct {
	Archive string `json:"archive"`
}

type inspectedSYNotebook struct {
	archivePath string
	name        string
	boxDocID    string
	blockIDs    []string
}

// isSYNotebookBundle 判断压缩包是否为批量笔记本导出包。
func isSYNotebookBundle(zipPath string) bool {
	archive, err := zip.OpenReader(zipPath)
	if nil != err {
		return false
	}
	defer archive.Close()
	manifestSuffix := "/" + syNotebookBundleManifestPath
	for _, file := range archive.File {
		if strings.HasSuffix(file.Name, manifestSuffix) {
			return true
		}
	}
	return false
}

func exportNotebooksSYBundle(ids []string) (zipPath string) {
	ids = gulu.Str.RemoveDuplicatedElem(ids)
	if len(ids) < 1 {
		return
	}
	defer util.ClearPushProgress(100)

	var boxes []*Box
	for _, id := range ids {
		box := Conf.Box(id)
		if nil == box || IsEncryptedBox(id) {
			return
		}
		boxes = append(boxes, box)
	}

	originalIncludeRelatedDocs := Conf.Export.IncludeRelatedDocs
	Conf.Export.IncludeRelatedDocs = false
	defer func() {
		Conf.Export.IncludeRelatedDocs = originalIncludeRelatedDocs
	}()

	workDir := filepath.Join(util.TempDir, "export", "notebooks-"+gulu.Rand.String(7))
	if err := os.MkdirAll(workDir, 0755); nil != err {
		logging.LogErrorf("create notebook bundle temp folder failed: %s", err)
		return
	}
	defer os.RemoveAll(workDir)

	boxPaths := exportNotebookMarkdownPaths(boxes, nil)
	manifest := &syNotebookBundleManifest{Spec: syNotebookBundleSpec}
	innerArchives := map[string]string{}
	for _, box := range boxes {
		innerURI := exportBoxSYZip(box.ID)
		innerPath, err := exportedFilePath(innerURI)
		if nil != err {
			logging.LogErrorf("resolve exported notebook archive failed: %s", err)
			return ""
		}
		archiveName := boxPaths[box.ID] + ".sy.zip"
		archivePath := path.Join("notebooks", archiveName)
		stagedPath := filepath.Join(workDir, archiveName)
		if err = filelock.Copy(innerPath, stagedPath); nil != err {
			logging.LogErrorf("stage exported notebook archive failed: %s", err)
			return ""
		}
		_ = os.Remove(innerPath)
		manifest.Notebooks = append(manifest.Notebooks, syNotebookBundleEntry{Archive: archivePath})
		innerArchives[archivePath] = stagedPath
	}

	baseFolderName := exportNotebooksBaseName(boxes)
	manifestData, err := gulu.JSON.MarshalIndentJSON(manifest, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal notebook bundle manifest failed: %s", err)
		return
	}
	manifestPath := filepath.Join(workDir, "notebooks.json")
	if err = os.WriteFile(manifestPath, manifestData, 0644); nil != err {
		logging.LogErrorf("write notebook bundle manifest failed: %s", err)
		return
	}

	partialPath := filepath.Join(workDir, "notebooks.sy.zip.partial")
	archive, err := gulu.Zip.Create(partialPath)
	if nil != err {
		logging.LogErrorf("create notebook bundle failed: %s", err)
		return
	}
	closed := false
	defer func() {
		if !closed {
			_ = archive.Close()
		}
	}()
	callback := func(filename string) {
		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(253), filename))
	}
	if err = archive.AddEntry(path.Join(baseFolderName, syNotebookBundleManifestPath), manifestPath, callback); nil != err {
		logging.LogErrorf("add notebook bundle manifest failed: %s", err)
		return ""
	}
	for archivePath, innerPath := range innerArchives {
		if err = archive.AddEntry(path.Join(baseFolderName, archivePath), innerPath, callback); nil != err {
			logging.LogErrorf("add notebook archive [%s] failed: %s", archivePath, err)
			return ""
		}
	}
	if err = archive.Close(); nil != err {
		logging.LogErrorf("close notebook bundle failed: %s", err)
		return ""
	}
	closed = true

	finalPath := filepath.Join(util.TempDir, "export", baseFolderName+".sy.zip")
	if err = os.Remove(finalPath); nil != err && !os.IsNotExist(err) {
		logging.LogErrorf("remove previous notebook bundle failed: %s", err)
		return ""
	}
	if err = os.Rename(partialPath, finalPath); nil != err {
		logging.LogErrorf("publish notebook bundle failed: %s", err)
		return ""
	}
	return "/export/" + url.PathEscape(filepath.Base(finalPath))
}

func exportedFilePath(exportPath string) (ret string, err error) {
	encoded, ok := strings.CutPrefix(exportPath, "/export/")
	if !ok || encoded == "" {
		return "", errors.New("invalid export path")
	}
	decoded, err := url.PathUnescape(encoded)
	if nil != err {
		return "", err
	}
	ret = filepath.Join(util.TempDir, "export", filepath.FromSlash(decoded))
	if !gulu.File.IsSubPath(filepath.Join(util.TempDir, "export"), ret) {
		return "", errors.New("export path is outside export directory")
	}
	return
}

// ImportSYNotebookBundle 导入批量笔记本包。普通 .sy.zip 返回 bundle=false，由原有导入流程继续处理。
func ImportSYNotebookBundle(zipPath string) (boxIDs []string, bundle bool, err error) {
	archive, openErr := zip.OpenReader(zipPath)
	if nil != openErr {
		err = openErr
		return
	}
	var manifestData []byte
	rootName := ""
	manifestSuffix := "/" + syNotebookBundleManifestPath
	for _, file := range archive.File {
		if !strings.HasSuffix(file.Name, manifestSuffix) {
			continue
		}
		candidateRoot := strings.TrimSuffix(file.Name, manifestSuffix)
		if candidateRoot == "" || strings.Contains(candidateRoot, "/") || rootName != "" {
			_ = archive.Close()
			return nil, true, errors.New(Conf.Language(199))
		}
		reader, readErr := file.Open()
		if nil != readErr {
			_ = archive.Close()
			return nil, true, readErr
		}
		manifestData, readErr = io.ReadAll(reader)
		_ = reader.Close()
		if nil != readErr {
			_ = archive.Close()
			return nil, true, readErr
		}
		rootName = candidateRoot
	}
	_ = archive.Close()
	if rootName == "" {
		return nil, false, nil
	}
	bundle = true
	manifest := &syNotebookBundleManifest{}
	if err = gulu.JSON.UnmarshalJSON(manifestData, manifest); nil != err || manifest.Spec != syNotebookBundleSpec || len(manifest.Notebooks) < 1 {
		err = errors.New(Conf.Language(199))
		return
	}

	unzipPath := filepath.Join(filepath.Dir(zipPath), strings.TrimSuffix(filepath.Base(zipPath), filepath.Ext(zipPath))+"-bundle-"+gulu.Rand.String(7))
	if err = gulu.Zip.Unzip(zipPath, unzipPath); nil != err {
		return
	}
	defer os.RemoveAll(unzipPath)
	rootPath := filepath.Join(unzipPath, filepath.FromSlash(rootName))
	if !gulu.File.IsDir(rootPath) {
		err = errors.New(Conf.Language(199))
		return
	}

	var notebooks []*inspectedSYNotebook
	seenArchives := map[string]struct{}{}
	for _, item := range manifest.Notebooks {
		archivePath := path.Clean("/" + item.Archive)
		archivePath = strings.TrimPrefix(archivePath, "/")
		if !strings.HasPrefix(archivePath, "notebooks/") || !strings.HasSuffix(strings.ToLower(archivePath), ".sy.zip") {
			err = errors.New(Conf.Language(199))
			return
		}
		if _, ok := seenArchives[archivePath]; ok {
			err = errors.New(Conf.Language(199))
			return
		}
		seenArchives[archivePath] = struct{}{}
		innerPath := filepath.Join(rootPath, filepath.FromSlash(archivePath))
		if !gulu.File.IsSubPath(rootPath, innerPath) || !filelock.IsExist(innerPath) {
			err = errors.New(Conf.Language(199))
			return
		}
		var inspected *inspectedSYNotebook
		if inspected, err = inspectSYNotebookArchive(innerPath); nil != err {
			return
		}
		notebooks = append(notebooks, inspected)
	}

	sharedBlockIDs := map[string]string{}
	blockOwners := map[string]int{}
	for index, notebook := range notebooks {
		for _, oldID := range notebook.blockIDs {
			if owner, ok := blockOwners[oldID]; ok && owner != index {
				err = errors.New(Conf.Language(199))
				return
			}
			blockOwners[oldID] = index
			if sharedBlockIDs[oldID] == "" {
				sharedBlockIDs[oldID] = util.TimeFromID(oldID) + "-" + util.RandString(7)
			}
		}
	}

	cleanupCreated := true
	defer func() {
		if !cleanupCreated {
			return
		}
		for _, boxID := range boxIDs {
			treenode.RemoveBlockTreesByBoxID(boxID)
			sql.DeleteBoxQueue(boxID)
			_ = filelock.Remove(filepath.Join(util.DataDir, boxID))
		}
	}()
	for _, notebook := range notebooks {
		var boxID string
		boxID, err = CreateBox(util.RemoveInvalid(notebook.name))
		if nil != err {
			return
		}
		boxIDs = append(boxIDs, boxID)
		if notebook.boxDocID != "" {
			sharedBlockIDs[notebook.boxDocID] = boxID
		}
	}
	for index, notebook := range notebooks {
		if _, err = importSY0(notebook.archivePath, boxIDs[index], "/", true, false, sharedBlockIDs, true); nil != err {
			return
		}
	}
	cleanupCreated = false
	return
}

func inspectSYNotebookArchive(zipPath string) (ret *inspectedSYNotebook, err error) {
	unzipPath := filepath.Join(filepath.Dir(zipPath), strings.TrimSuffix(filepath.Base(zipPath), filepath.Ext(zipPath))+"-inspect-"+gulu.Rand.String(7))
	if err = gulu.Zip.Unzip(zipPath, unzipPath); nil != err {
		return
	}
	defer os.RemoveAll(unzipPath)

	entries, readErr := os.ReadDir(unzipPath)
	if nil != readErr || len(entries) != 1 || !entries[0].IsDir() {
		return nil, errors.New(Conf.Language(199))
	}
	rootPath := filepath.Join(unzipPath, entries[0].Name())
	ret = &inspectedSYNotebook{archivePath: zipPath, name: entries[0].Name()}
	confPath := filepath.Join(rootPath, ".siyuan", "conf.json")
	hasNotebookMetadata := filelock.IsExist(confPath)
	if hasNotebookMetadata {
		boxConf := conf.NewBoxConf()
		confData, readConfErr := filelock.ReadFile(confPath)
		if nil != readConfErr || gulu.JSON.UnmarshalJSON(confData, boxConf) != nil {
			return nil, errors.New(Conf.Language(199))
		}
		if boxConf.Name != "" {
			ret.name = boxConf.Name
		}
	}
	boxDocPath := filepath.Join(rootPath, ".siyuan", boxDocMetaName)
	if filelock.IsExist(boxDocPath) {
		hasNotebookMetadata = true
		meta := &boxDocMeta{}
		metaData, readMetaErr := filelock.ReadFile(boxDocPath)
		if nil != readMetaErr || gulu.JSON.UnmarshalJSON(metaData, meta) != nil || meta.Spec != boxDocMetaSpec || !ast.IsNodeIDPattern(meta.BoxDocID) {
			return nil, errors.New(Conf.Language(199))
		}
		ret.boxDocID = meta.BoxDocID
	}

	luteEngine := util.NewLute()
	seenBlockIDs := map[string]struct{}{}
	syCount := 0
	err = filelock.Walk(rootPath, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if nil != walkErr {
			return walkErr
		}
		if nil == entry || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sy") {
			return nil
		}
		syCount++
		data, readTreeErr := filelock.ReadFile(currentPath)
		if nil != readTreeErr {
			return readTreeErr
		}
		tree, _, parseErr := dataparser.ParseJSON(data, luteEngine.ParseOptions)
		if nil != parseErr {
			return parseErr
		}
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.ID != "" {
				seenBlockIDs[node.ID] = struct{}{}
			}
			return ast.WalkContinue
		})
		return nil
	})
	if nil != err || (syCount < 1 && !hasNotebookMetadata) {
		return nil, errors.New(Conf.Language(199))
	}
	for blockID := range seenBlockIDs {
		ret.blockIDs = append(ret.blockIDs, blockID)
	}
	return
}
