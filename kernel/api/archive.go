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

package api

import (
	archivezip "archive/zip"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/text/encoding/simplifiedchinese"
)

// rejectEncryptedArchivePath 检查路径是否落入加密笔记本目录（含 symlink 绕过），是则返回错误。
func rejectEncryptedArchivePath(absPath string) error {
	if boxID := model.EncryptedRawPathBoxID(absPath); boxID != "" {
		return fmt.Errorf("path belongs to encrypted notebook [%s]", boxID)
	}
	resolved, err := resolveArchivePath(absPath)
	if err != nil {
		return err
	}
	dataDir, err := resolveArchivePath(util.DataDir)
	if err != nil {
		return err
	}
	if rel, relErr := filepath.Rel(dataDir, resolved); relErr == nil && filepath.IsLocal(rel) {
		if boxID := model.EncryptedRawPathBoxID(filepath.Join(util.DataDir, rel)); boxID != "" {
			return fmt.Errorf("path belongs to encrypted notebook [%s]", boxID)
		}
	}
	return nil
}

// resolveArchivePath 解析最长已存在父路径的最终位置，包含 Windows 目录联接；解析失败时拒绝访问。
func resolveArchivePath(path string) (string, error) {
	cleaned, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent := cleaned
	for {
		if _, err = os.Lstat(parent); err == nil {
			break
		}
		if !os.IsNotExist(err) || filepath.Dir(parent) == parent {
			return "", err
		}
		parent = filepath.Dir(parent)
	}
	resolved, err := model.ResolveRealPath(parent)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(parent, cleaned)
	if err != nil {
		return "", err
	}
	return filepath.Join(resolved, rel), nil
}

func zip(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var entryPath, zipFilePath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("path", &entryPath, true, true),      // 相对于工作空间的路径（待打包目录或文件）
		util.BindJsonArg("zipPath", &zipFilePath, true, true), // 相对于工作空间的路径（生成的 zip）
	) {
		return
	}
	entryAbsPath, err := util.GetAbsPathInWorkspace(entryPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = rejectEncryptedArchivePath(entryAbsPath); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	zipAbsFilePath, err := util.GetAbsPathInWorkspace(zipFilePath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = rejectEncryptedArchivePath(zipAbsFilePath); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	// 在创建归档前检查全部源条目，避免通过父目录打包加密笔记本。
	resolvedEntryPath, err := resolveArchivePath(entryAbsPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = filepath.WalkDir(resolvedEntryPath, func(path string, _ fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		return rejectEncryptedArchivePath(path)
	}); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipFile, err := gulu.Zip.Create(zipAbsFilePath)
	if err != nil {
		logging.LogErrorf("create zip [%s] failed: %s", zipAbsFilePath, err)
		ret.Code = -1
		ret.Msg = "create zip file failed" + errMsgSeeKernelLog
		return
	}

	base := filepath.Base(entryAbsPath)
	if gulu.File.IsDir(entryAbsPath) {
		err = zipFile.AddDirectory(base, entryAbsPath)
	} else {
		err = zipFile.AddEntry(base, entryAbsPath)
	}
	if err != nil {
		logging.LogErrorf("zip add entry [%s] failed: %s", entryAbsPath, err)
		ret.Code = -1
		ret.Msg = "zip failed" + errMsgSeeKernelLog
		return
	}

	if err = zipFile.Close(); err != nil {
		logging.LogErrorf("close zip [%s] failed: %s", zipAbsFilePath, err)
		ret.Code = -1
		ret.Msg = "close zip file failed" + errMsgSeeKernelLog
		return
	}
}

func unzip(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var zipFilePath, entryPath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("zipPath", &zipFilePath, true, true), // 相对于工作空间的路径
		util.BindJsonArg("path", &entryPath, true, false),     // 相对于工作空间的路径（解压目标目录）
	) {
		return
	}
	zipAbsFilePath, err := util.GetAbsPathInWorkspace(zipFilePath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = rejectEncryptedArchivePath(zipAbsFilePath); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	entryAbsPath, err := util.GetAbsPathInWorkspace(entryPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = rejectEncryptedArchivePath(entryAbsPath); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if !gulu.File.IsExist(zipAbsFilePath) {
		ret.Code = -1
		ret.Msg = "zip file does not exist"
		return
	}

	if err := unzipWorkspaceArchive(zipAbsFilePath, entryAbsPath); err != nil {
		logging.LogErrorf("unzip [%s] -> [%s] failed: %s", zipAbsFilePath, entryAbsPath, err)
		ret.Code = -1
		ret.Msg = "unzip failed" + errMsgSeeKernelLog
		return
	}
}

// unzipWorkspaceArchive 先校验全部条目，阻止已知非法路径导致部分写入，再从同一个归档句柄解压。
func unzipWorkspaceArchive(zipPath, destination string) error {
	reader, err := archivezip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	paths := make([]string, len(reader.File))
	for i, entry := range reader.File {
		name := entry.Name
		if !utf8.ValidString(name) {
			if name, err = simplifiedchinese.GB18030.NewDecoder().String(name); err != nil {
				return err
			}
		}
		name = strings.ReplaceAll(name, "\\", "/")
		if !filepath.IsLocal(filepath.FromSlash(name)) || entry.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("invalid archive entry [%s]", name)
		}
		paths[i] = filepath.Join(destination, filepath.FromSlash(name))
		if err = validateArchiveEntryPath(destination, paths[i]); err != nil {
			return err
		}
	}
	for i, entry := range reader.File {
		// 解压前再次检查已有符号链接和加密身份，不复用预检阶段的路径判定结果。
		if err = validateArchiveEntryPath(destination, paths[i]); err != nil {
			return err
		}
		if err = extractWorkspaceArchiveEntry(entry, paths[i]); err != nil {
			return err
		}
	}
	return nil
}

func validateArchiveEntryPath(destination, entryPath string) error {
	rel, err := filepath.Rel(destination, entryPath)
	if err != nil || !filepath.IsLocal(rel) {
		return fmt.Errorf("invalid archive entry path [%s]", entryPath)
	}
	resolved, err := resolveArchivePath(entryPath)
	if err != nil {
		return err
	}
	resolvedDestination, err := resolveArchivePath(destination)
	if err != nil {
		return err
	}
	rel, err = filepath.Rel(resolvedDestination, resolved)
	if err != nil || !filepath.IsLocal(rel) {
		return fmt.Errorf("archive entry resolves outside destination [%s]", entryPath)
	}
	return rejectEncryptedArchivePath(entryPath)
}

func extractWorkspaceArchiveEntry(entry *archivezip.File, destination string) error {
	if entry.FileInfo().IsDir() {
		return os.MkdirAll(destination, 0755)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	source, err := entry.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.Create(destination)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Chtimes(destination, entry.Modified, entry.Modified)
}
