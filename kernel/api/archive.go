// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	archivezip "archive/zip"
	"fmt"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"io/fs"
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
	if util.IsPluginDevelopmentRawPathForbidden(absPath, false) {
		return fmt.Errorf("managed plugin development files require their dedicated tools")
	}
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
	resolved, err := util.ResolveRealPath(parent)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(parent, cleaned)
	if err != nil {
		return "", err
	}
	return filepath.Join(resolved, rel), nil
}

var zip = contractHandler(apicontract.Zip, func(c *gin.Context, request apicontract.ZipRequest) apicontract.Response[apicontract.Null] {

	entryPath, zipFilePath := request.Path, request.ZipPath

	entryAbsPath, err := util.GetAbsPathInWorkspace(entryPath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = rejectEncryptedArchivePath(entryAbsPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	zipAbsFilePath, err := util.GetAbsPathInWorkspace(zipFilePath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = rejectEncryptedArchivePath(zipAbsFilePath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	// 在创建归档前检查全部源条目，避免通过父目录打包加密笔记本。
	resolvedEntryPath, err := resolveArchivePath(entryAbsPath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = filepath.WalkDir(resolvedEntryPath, func(path string, _ fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		return rejectEncryptedArchivePath(path)
	}); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	resolvedZipPath, err := resolveArchivePath(zipAbsFilePath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if util.IsPluginDevelopmentRawWriteForbidden(resolvedZipPath) {
		return apicontract.Failure[apicontract.Null](-1, "managed plugin development files require their dedicated tools")
	}
	if err = rejectEncryptedArchivePath(resolvedZipPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = model.CheckDocumentAddressingFileWrite(resolvedZipPath, nil, false); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	zipFile, err := gulu.Zip.Create(resolvedZipPath)
	if err != nil {
		logging.LogErrorf("create zip [%s] failed: %s", zipAbsFilePath, err)
		return apicontract.Failure[apicontract.Null](-1, "create zip file failed"+errMsgSeeKernelLog)
	}

	base := filepath.Base(entryAbsPath)
	if gulu.File.IsDir(resolvedEntryPath) {
		err = zipFile.AddDirectory(base, resolvedEntryPath)
	} else {
		err = zipFile.AddEntry(base, resolvedEntryPath)
	}
	if err != nil {
		logging.LogErrorf("zip add entry [%s] failed: %s", entryAbsPath, err)
		return apicontract.Failure[apicontract.Null](-1, "zip failed"+errMsgSeeKernelLog)
	}

	if err = zipFile.Close(); err != nil {
		logging.LogErrorf("close zip [%s] failed: %s", zipAbsFilePath, err)
		return apicontract.Failure[apicontract.Null](-1, "close zip file failed"+errMsgSeeKernelLog)
	}

	return apicontract.Success(apicontract.Null{})
})

var unzip = contractHandler(apicontract.Unzip, func(c *gin.Context, request apicontract.UnzipRequest) apicontract.Response[apicontract.Null] {

	entryPath, zipFilePath := request.Path, request.ZipPath

	zipAbsFilePath, err := util.GetAbsPathInWorkspace(zipFilePath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = rejectEncryptedArchivePath(zipAbsFilePath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	entryAbsPath, err := util.GetAbsPathInWorkspace(entryPath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = rejectEncryptedArchivePath(entryAbsPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	if !gulu.File.IsExist(zipAbsFilePath) {
		return apicontract.Failure[apicontract.Null](-1, "zip file does not exist")
	}

	if err := unzipWorkspaceArchive(zipAbsFilePath, entryAbsPath); err != nil {
		logging.LogErrorf("unzip [%s] -> [%s] failed: %s", zipAbsFilePath, entryAbsPath, err)
		return apicontract.Failure[apicontract.Null](-1, "unzip failed"+errMsgSeeKernelLog)
	}

	return apicontract.Success(apicontract.Null{})
})

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
		if entry.FileInfo().IsDir() {
			if err = model.CheckDocumentAddressingFileWrite(paths[i], nil, true); err != nil {
				return err
			}
		}
	}
	// 解压到隔离目录后预检整个写入集合，拒绝未知模式或源格式时不创建目标目录。
	staging, err := os.MkdirTemp("", "siyuan-archive-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	sources := make([]string, len(reader.File))
	var copySources, copyDestinations []string
	for i, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		sources[i] = filepath.Join(staging, fmt.Sprint(i))
		if err = util.ExtractArchiveEntry(entry, sources[i]); err != nil {
			return err
		}
		copySources = append(copySources, sources[i])
		copyDestinations = append(copyDestinations, paths[i])
	}
	if err = model.CheckDocumentAddressingFileCopies(copySources, copyDestinations); err != nil {
		return err
	}
	for i, entry := range reader.File {
		// 解压前再次检查已有符号链接和加密身份，不复用预检阶段的路径判定结果。
		if err = validateArchiveEntryPath(destination, paths[i]); err != nil {
			return err
		}
		if entry.FileInfo().IsDir() {
			err = model.CheckDocumentAddressingFileWrite(paths[i], nil, true)
			if err == nil {
				err = os.MkdirAll(paths[i], 0755)
			}
		} else {
			if err = model.CheckDocumentAddressingFileCopies([]string{sources[i]}, []string{paths[i]}); err == nil {
				err = os.MkdirAll(filepath.Dir(paths[i]), 0755)
			}
			if err == nil {
				err = model.CopyFileWithDocumentAddressing(sources[i], paths[i])
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func validateArchiveEntryPath(destination, entryPath string) error {
	if util.IsPluginDevelopmentRawWriteForbidden(entryPath) {
		return fmt.Errorf("managed plugin development files require their dedicated tools")
	}
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
