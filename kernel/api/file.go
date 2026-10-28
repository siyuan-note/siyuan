// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// errMsgSeeKernelLog 接在 API 错误提示末尾，引导用户查看内核日志以获取完整信息（避免在 Msg 暴露工作空间绝对路径）。
const (
	errMsgSeeKernelLog = ". For details, see the SiYuan kernel log."
)

// rejectEncryptedBoxPath 检查 absPath 是否落在加密笔记本目录下（含 symlink 绕过），是则返回 true。
// 原始文件 API（getFile/putFile/copyFile/renameFile/removeFile）是绕过加密层的逃生口，
// 对加密笔记本的任何文件读写都应拒绝——合法读写走专用 API（upload/getBlockKramdown 等，已加密感知），
// 避免密文泄漏给插件或明文破坏加密格式。
// 防止 symlink 绕过：找到最长已存在的父路径，解析 symlink 后拼回剩余路径，再检查是否落入加密 box。
func rejectEncryptedBoxPath(absPath string) bool {
	return model.EncryptedRawPathBoxID(absPath) != ""
}

// copyDecryptedAsset 将加密 asset 解密后复制到目标路径（dest 必须在工作区外）。
func copyDecryptedAsset(src, dest string) error {
	// 安全守卫：dest 必须在工作区外，防止解密后的明文落入工作区普通目录
	if gulu.File.IsSubPath(util.WorkspaceDir, dest) {
		return fmt.Errorf("refuse to write decrypted asset inside workspace")
	}
	boxID := util.BoxIDFromDataPath(src)
	if boxID == "" || !model.IsEncryptedBox(boxID) {
		return fmt.Errorf("source is not an encrypted asset")
	}
	if !model.IsBoxUnlocked(boxID) {
		return fmt.Errorf("%s", model.Conf.Language(314))
	}
	if err := model.EnsureAssetLocal(src); err != nil {
		return err
	}
	model.HoldBoxReadLock(boxID)
	defer model.ReleaseBoxReadLock(boxID)
	dek, dekErr := model.GetDEKIfUnlocked(boxID)
	if dekErr != nil {
		return dekErr
	}
	diskName := filepath.Base(src)
	data, readErr := os.ReadFile(src)
	if readErr != nil {
		return readErr
	}
	plain, decErr := model.DecryptAsset(boxID, diskName, dek, data)
	if decErr != nil {
		return decErr
	}
	if err := model.CheckDocumentAddressingFileWrite(dest, plain, false); err != nil {
		return err
	}
	if writeErr := model.WriteFileWithDocumentAddressing(dest, plain); writeErr != nil {
		return writeErr
	}
	return nil
}

var getUniqueFilename = contractHandler(apicontract.GetUniqueFilename, func(c *gin.Context, request apicontract.FilePathRequest) apicontract.Response[apicontract.FilePathData] {
	filePath := request.Path
	if rejectEncryptedBoxPath(filePath) {
		return apicontract.Failure[apicontract.FilePathData](-3, model.Conf.Language(321))
	}
	return apicontract.Success(apicontract.FilePathData{Path: util.GetUniqueFilename(filePath)})
})

// prepareFileAssets 在原始文件 API 完成权限校验后补齐目录或文件的资源内容。
func prepareFileAssets(absPath string) error {
	absPath = filepath.Clean(absPath)
	dataPath := filepath.Clean(util.DataDir)
	if gulu.File.IsSubPath(absPath, dataPath) {
		absPath = dataPath
	} else if absPath != dataPath && !gulu.File.IsSubPath(dataPath, absPath) {
		return nil
	}
	files, err := model.DeferredSyncAssets()
	if err != nil {
		return err
	}
	for _, file := range files {
		assetPath := filepath.Join(util.DataDir, filepath.FromSlash(strings.TrimPrefix(file.Path, "/")))
		if (absPath == assetPath || gulu.File.IsSubPath(absPath, assetPath)) && rejectEncryptedBoxPath(assetPath) {
			return fmt.Errorf("%s", model.Conf.Language(321))
		}
	}
	return model.EnsureAssetPrefixLocal(absPath)
}

var globalCopyFiles = contractHandler(apicontract.GlobalCopyFiles, func(c *gin.Context, request apicontract.CopyFilesRequest) apicontract.Response[apicontract.Null] {
	var changedPaths []string
	defer func() {
		model.IncSyncIfNeeded(changedPaths...)
	}()

	srcs, destDirArg := request.Srcs, request.DestDir
	for i, src := range srcs {
		if !filepath.IsAbs(src) {
			logging.LogErrorf("global copy files src [%s] is not an absolute path", src)
			return apicontract.Failure[apicontract.Null](-1, "Field [srcs]: each path must be absolute")
		}

		absSrc, _ := filepath.Abs(src)
		if util.IsPluginDevelopmentRawPathForbidden(absSrc, true) {
			return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
		}

		if util.IsSensitivePath(absSrc) {
			logging.LogErrorf("refuse to copy sensitive file [%s]", src)
			return apicontract.Failure[apicontract.Null](-2, fmt.Sprintf("refuse to copy sensitive file [%s]", src))
		}

		if rejectEncryptedBoxPath(absSrc) {
			return apicontract.Failure[apicontract.Null](-3, model.Conf.Language(321))
		}

		if err := prepareFileAssets(absSrc); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		if !filelock.IsExist(absSrc) {
			return apicontract.Failure[apicontract.Null](-1, fmt.Sprintf("file [%s] does not exist", src))
		}
		srcs[i] = absSrc
	}

	destDir, err := util.GetAbsPathInWorkspace(destDirArg)
	if err != nil {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, err.Error())
	}
	// 在 MkdirAll 前拒绝加密笔记本目录，避免在加密笔记本内创建明文目录
	if util.IsPluginDevelopmentRawPathForbidden(destDir, false) {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
	}
	if rejectEncryptedBoxPath(destDir) {
		return apicontract.Failure[apicontract.Null](-1, "copying encrypted notebook files is not supported via this API")
	}
	var destinations []string
	for _, src := range srcs {
		destinations = append(destinations, filepath.Join(destDir, filepath.Base(src)))
	}
	if err = model.CheckDocumentAddressingFileCopies(srcs, destinations); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if filelock.IsExist(destDir) {
		destInfo, statErr := os.Stat(destDir)
		if statErr != nil {
			return apicontract.Failure[apicontract.Null](-1, statErr.Error())
		}
		if !destInfo.IsDir() {
			return apicontract.Failure[apicontract.Null](-1, fmt.Sprintf("Field [destDir]: path [%s] is not a directory", destDirArg))
		}
	} else {
		if err = os.MkdirAll(destDir, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destDir, err)
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
	}

	for _, src := range srcs {
		dest := filepath.Join(destDir, filepath.Base(src))
		if util.IsPluginDevelopmentRawPathForbidden(dest, true) {
			return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
		}
		if rejectEncryptedBoxPath(dest) {
			return apicontract.Failure[apicontract.Null](-3, model.Conf.Language(321))
		}
		// 拒绝目标已存在的 symlink：os.Create 会跟随 symlink，可能写入加密笔记本内部
		if li, lerr := os.Lstat(dest); lerr == nil && li.Mode()&os.ModeSymlink != 0 {
			return apicontract.Failure[apicontract.Null](-1, "destination path is a symlink, which is not supported")
		}
		if err := model.CopyFileWithDocumentAddressing(src, dest); err != nil {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", src, dest, err)
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		changedPaths = append(changedPaths, dest)
	}
	return apicontract.Success(apicontract.Null{})
})

var workspaceCopyFiles = contractHandler(apicontract.WorkspaceCopyFiles, func(c *gin.Context, request apicontract.CopyFilesRequest) apicontract.Response[apicontract.Null] {
	var changedPaths []string
	defer func() {
		model.IncSyncIfNeeded(changedPaths...)
	}()

	relSrcs, destDirArg := request.Srcs, request.DestDir
	var absSrcs []string
	for _, src := range relSrcs {
		absSrc, err := util.GetAbsPathInWorkspace(src)
		if err != nil {
			return apicontract.Failure[apicontract.Null](http.StatusForbidden, err.Error())
		}
		if util.IsSensitivePath(absSrc) {
			logging.LogErrorf("refuse to copy sensitive file [%s]", src)
			return apicontract.Failure[apicontract.Null](-2, fmt.Sprintf("refuse to copy sensitive file [%s]", src))
		}
		if util.IsPluginDevelopmentRawPathForbidden(absSrc, true) {
			return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
		}
		if rejectEncryptedBoxPath(absSrc) {
			return apicontract.Failure[apicontract.Null](-3, model.Conf.Language(321))
		}
		if err = prepareFileAssets(absSrc); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		if !filelock.IsExist(absSrc) {
			return apicontract.Failure[apicontract.Null](-1, fmt.Sprintf("file [%s] does not exist", src))
		}
		absSrcs = append(absSrcs, absSrc)
	}

	destDir, err := util.GetAbsPathInWorkspace(destDirArg)
	if err != nil {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, err.Error())
	}
	// 在 MkdirAll 前拒绝加密笔记本目录，避免在加密笔记本内创建明文目录
	if util.IsPluginDevelopmentRawPathForbidden(destDir, false) {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
	}
	if rejectEncryptedBoxPath(destDir) {
		return apicontract.Failure[apicontract.Null](-1, "copying encrypted notebook files is not supported via this API")
	}
	var destinations []string
	for _, src := range absSrcs {
		destinations = append(destinations, filepath.Join(destDir, filepath.Base(src)))
	}
	if err = model.CheckDocumentAddressingFileCopies(absSrcs, destinations); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if filelock.IsExist(destDir) {
		destInfo, err := os.Stat(destDir)
		if err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		if !destInfo.IsDir() {
			return apicontract.Failure[apicontract.Null](-1, "Field [destDir]: path is not a directory")
		}
	} else {
		if err = os.MkdirAll(destDir, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destDir, err)
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
	}

	for _, absSrc := range absSrcs {
		dest := filepath.Join(destDir, filepath.Base(absSrc))
		if util.IsPluginDevelopmentRawPathForbidden(dest, true) {
			return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
		}
		if rejectEncryptedBoxPath(dest) {
			return apicontract.Failure[apicontract.Null](-3, model.Conf.Language(321))
		}
		if li, lerr := os.Lstat(dest); lerr == nil && li.Mode()&os.ModeSymlink != 0 {
			return apicontract.Failure[apicontract.Null](-1, "destination path is a symlink, which is not supported")
		}
		if err := model.CopyFileWithDocumentAddressing(absSrc, dest); err != nil {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", absSrc, dest, err)
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		changedPaths = append(changedPaths, dest)
	}
	return apicontract.Success(apicontract.Null{})
})

var copyFile = contractHandler(apicontract.CopyFile, func(c *gin.Context, request apicontract.CopyFileRequest) apicontract.Response[apicontract.Null] {

	src, dest := request.Src, request.Dest
	if !filepath.IsAbs(dest) {
		logging.LogErrorf("copy file dest [%s] is not an absolute path", dest)
		return apicontract.FailureWithTimeout[apicontract.Null](-1, "Field [dest]: path must be absolute", 5000)
	}

	src, err := model.GetAssetAbsPathInBox(src, "")
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", src, err)
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}
	if util.IsPluginDevelopmentRawPathForbidden(src, true) || util.IsPluginDevelopmentRawPathForbidden(dest, true) {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
	}

	// 加密笔记本的文件不允许通过原始文件 API 复制（src 读出密文/明文，dest 写入破坏加密存储）
	// 例外：dest 在工作区外且非加密 box 时允许解密复制（用户导出的场景）
	if rejectEncryptedBoxPath(src) || rejectEncryptedBoxPath(dest) {
		if !rejectEncryptedBoxPath(dest) && !gulu.File.IsSubPath(util.WorkspaceDir, dest) {
			// dest 在工作区外且非加密 box，允许解密后复制
			boxID := util.BoxIDFromDataPath(src)
			if err = holdEncryptedBoxRequest(c, boxID); err != nil {
				return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(314))
			}
			if err = copyDecryptedAsset(src, dest); err != nil {
				return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
			}
			return apicontract.Success(apicontract.Null{})
		}
		return apicontract.FailureWithTimeout[apicontract.Null](-1, "copying encrypted notebook files is not supported via this API", 5000)
	}

	if err = prepareFileAssets(src); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 7000)
	}
	info, err := os.Stat(src)
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", src, err)
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}

	if info.IsDir() {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, "Field [src]: path is a directory", 5000)
	}

	if util.IsSensitivePath(dest) {
		logging.LogErrorf("refuse to copy sensitive file [%s]", dest)
		return apicontract.Failure[apicontract.Null](-2, fmt.Sprintf("refuse to copy sensitive file [%s]", dest))
	}

	if err = model.CheckDocumentAddressingFileCopies([]string{src}, []string{dest}); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = model.CopyFileWithDocumentAddressing(src, dest); err != nil {
		logging.LogErrorf("copy file [%s] to [%s] failed: %s", src, dest, err)
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}

	model.IncSyncIfNeeded(dest)
	return apicontract.Success(apicontract.Null{})
})

var getFile = contractHandler(apicontract.GetFile, func(c *gin.Context, request apicontract.FilePathRequest) apicontract.Response[apicontract.BinaryContent] {
	filePath := request.Path
	if !model.IsAdminRoleContext(c) {
		c.Header("Cache-Control", "private, no-store")
		if file, handled, err := model.OpenPublishPackageFile(c, filePath); handled {
			if err != nil {
				return apicontract.Failure[apicontract.BinaryContent](http.StatusForbidden, http.StatusText(http.StatusForbidden))
			}
			defer file.Close()
			data, readErr := io.ReadAll(file)
			if readErr != nil {
				return apicontract.Failure[apicontract.BinaryContent](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError))
			}
			contentType := mime.TypeByExtension(filepath.Ext(filePath))
			if contentType == "" {
				contentType = mimetype.Detect(data).String()
			}
			return apicontract.SuccessBinary(contentType, data)
		}
	}

	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if err != nil {
		return apicontract.Failure[apicontract.BinaryContent](http.StatusForbidden, err.Error())
	}
	// 加密笔记本的任何文件都不允许通过原始文件 API 读取（不只 .sy）：
	// 密文对插件无意义，且可能被误解析或泄漏；合法读取走专用 API（已加密感知）
	if rejectEncryptedBoxPath(fileAbsPath) {
		return apicontract.Failure[apicontract.BinaryContent](-3, model.Conf.Language(321))
	}
	// 解析符号链接（Windows 下含目录联接）后再做授权判断，防止 reader 通过 data/assets
	// 等目录下的链接读取工作空间外的文件（security advisory GHSA-g7gf-v79m-jwrm）
	resolvedPath, err := model.ResolveAssetPathWithMissingLeaf(fileAbsPath)
	if err != nil {
		logging.LogErrorf("resolve symlinks for [%s] failed: %s", fileAbsPath, err)
		return apicontract.Failure[apicontract.BinaryContent](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
	}
	// 符号链接指向加密笔记本时同样拒绝读取，防止密文泄漏
	if rejectEncryptedBoxPath(resolvedPath) {
		return apicontract.Failure[apicontract.BinaryContent](-3, model.Conf.Language(321))
	}
	fileAbsPath = resolvedPath
	if util.IsPluginDevelopmentRawPathForbidden(fileAbsPath, false) {
		return apicontract.Failure[apicontract.BinaryContent](http.StatusForbidden, "managed plugin development state cannot be read through raw file APIs")
	}

	// REF: https://github.com/siyuan-note/siyuan/issues/11364
	if !model.IsAdminRoleContext(c) {
		// 符号链接解析后的真实路径必须仍位于工作空间内（admin 不受此限制，兼容 assets
		// 指向工作空间外目录的合法用法），发布权限与敏感路径检查也基于解析后的路径执行
		if !gulu.File.IsSubPath(util.NormalizeAndResolve(util.WorkspaceDir), util.NormalizeAndResolve(fileAbsPath)) {
			return apicontract.Failure[apicontract.BinaryContent](http.StatusForbidden, http.StatusText(http.StatusForbidden))
		}
		if err := refuseToAccess(c, fileAbsPath); err != nil {
			return apicontract.FailureFrom[apicontract.BinaryContent](err)
		}
	}

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckAbsPathAccessableByPublishAccess(c, fileAbsPath, publishAccess) {
			return apicontract.Failure[apicontract.BinaryContent](http.StatusForbidden, http.StatusText(http.StatusForbidden))
		}
	}

	dataRoot, dataRootErr := model.ResolveAssetPathWithMissingLeaf(util.DataDir)
	if dataRootErr == nil && gulu.File.IsSubPath(dataRoot, fileAbsPath) {
		// 将授权后的真实路径映射回数据目录路径，使符号链接工作空间也能匹配按需下载清单。
		rel, relErr := filepath.Rel(dataRoot, fileAbsPath)
		if relErr != nil {
			return apicontract.Failure[apicontract.BinaryContent](http.StatusInternalServerError, relErr.Error())
		}
		if err = model.EnsureAssetLocal(filepath.Join(util.DataDir, rel)); err != nil {
			code := http.StatusServiceUnavailable
			if os.IsNotExist(err) {
				code = http.StatusNotFound
			}
			return apicontract.Failure[apicontract.BinaryContent](code, err.Error())
		}
	}
	info, err := os.Stat(fileAbsPath)
	if err != nil {
		code := http.StatusInternalServerError
		if os.IsNotExist(err) {
			code = http.StatusNotFound
		}
		return apicontract.Failure[apicontract.BinaryContent](code, err.Error())
	}
	if info.IsDir() {
		return apicontract.Failure[apicontract.BinaryContent](http.StatusConflict, "path is a directory")
	}
	data, err := filelock.ReadFile(fileAbsPath)
	if err != nil {
		logging.LogErrorf("read file [%s] failed: %s", fileAbsPath, err)
		return apicontract.Failure[apicontract.BinaryContent](http.StatusInternalServerError, err.Error())
	}

	contentType := mime.TypeByExtension(filepath.Ext(fileAbsPath))
	if "" == contentType {
		if m := mimetype.Detect(data); nil != m {
			contentType = m.String()
		}
	}
	if "" == contentType {
		contentType = "application/octet-stream"
	}
	return apicontract.SuccessBinary(contentType, data)
})

// refuseToAccess 判定该路径不可访问，返回 nil 表示允许。
// 敏感文件与无发布访问权限的文件均以 HTTP 403 拒绝。
func refuseToAccess(c *gin.Context, fileAbsPath string) error {
	// 禁止访问敏感文件（conf 目录下的 conf.json 与 TLS 密钥材料、data/snippets/conf.json、
	// data/templates、data/.siyuan/publishAccess.json），
	// 规范化与符号链接解析见 util.NormalizeAndResolve，防止通过大小写或符号链接绕过
	if util.IsForbiddenAbsPath(fileAbsPath) {
		return apicontract.RejectWith(http.StatusForbidden, http.StatusText(http.StatusForbidden))
	}

	// 禁止访问 无发布访问权限的文件
	publishAccess := model.GetPublishAccess()
	if !model.CheckAbsPathAccessableByPublishAccess(c, fileAbsPath, publishAccess) {
		return apicontract.RejectWith(http.StatusForbidden, http.StatusText(http.StatusForbidden))
	}

	return nil
}

var readDir = contractHandler(apicontract.ReadDirectory, func(c *gin.Context, request apicontract.ReadDirectoryRequest) apicontract.Response[[]apicontract.DirectoryEntry] {
	dirPath := request.Path
	dirAbsPath, err := util.GetAbsPathInWorkspace(dirPath)
	if err != nil {
		return apicontract.Failure[[]apicontract.DirectoryEntry](http.StatusForbidden, err.Error())
	}
	// 加密笔记本的任何目录都不允许通过原始文件 API 枚举（不只 .sy）：
	// 目录结构、文档 ID、随机化资产名和时间戳可能泄漏信息；合法读取走专用 API（已加密感知）
	if util.IsPluginDevelopmentRawPathForbidden(dirAbsPath, false) {
		return apicontract.Failure[[]apicontract.DirectoryEntry](http.StatusForbidden, "managed plugin development files require their dedicated tools")
	}
	if rejectEncryptedBoxPath(dirAbsPath) {
		return apicontract.Failure[[]apicontract.DirectoryEntry](-3, model.Conf.Language(321))
	}
	info, err := os.Stat(dirAbsPath)
	if os.IsNotExist(err) {
		return apicontract.Failure[[]apicontract.DirectoryEntry](http.StatusNotFound, "path does not exist")
	}
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", dirAbsPath, err)
		return apicontract.Failure[[]apicontract.DirectoryEntry](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
	}
	if !info.IsDir() {
		logging.LogErrorf("file [%s] is not a directory", dirAbsPath)
		return apicontract.Failure[[]apicontract.DirectoryEntry](http.StatusConflict, "path is not a directory")
	}

	entries, err := os.ReadDir(dirAbsPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", dirAbsPath, err)
		return apicontract.Failure[[]apicontract.DirectoryEntry](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
	}

	files := []apicontract.DirectoryEntry{}
	for _, entry := range entries {
		path := filepath.Join(dirAbsPath, entry.Name())
		if util.IsPluginDevelopmentRawPathForbidden(path, false) {
			continue
		}
		info, err = os.Stat(path)
		if err != nil {
			logging.LogErrorf("stat [%s] failed: %s", path, err)
			return apicontract.Failure[[]apicontract.DirectoryEntry](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
		}
		files = append(files, apicontract.DirectoryEntry{Name: entry.Name(), IsDir: info.IsDir(), IsSymlink: util.IsSymlink(entry), Updated: info.ModTime().Unix()})
	}

	return apicontract.Success(files)
})

var renameFile = contractHandler(apicontract.RenameFile, func(c *gin.Context, request apicontract.RenameFileRequest) apicontract.Response[apicontract.Null] {
	srcPath, destPath := request.Path, request.NewPath
	srcAbsPath, err := util.GetAbsPathInWorkspace(srcPath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, err.Error())
	}
	destAbsPath, err := util.GetAbsPathInWorkspace(destPath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, err.Error())
	}
	// 加密笔记本的文件不允许通过原始文件 API 重命名（会破坏加密存储结构/跨 box 搬运密文）
	if util.IsPluginDevelopmentRawPathForbidden(srcAbsPath, true) || util.IsPluginDevelopmentRawPathForbidden(destAbsPath, true) {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
	}
	if rejectEncryptedBoxPath(srcAbsPath) || rejectEncryptedBoxPath(destAbsPath) {
		return apicontract.Failure[apicontract.Null](-3, model.Conf.Language(321))
	}
	if err = prepareFileAssets(srcAbsPath); err == nil {
		err = prepareFileAssets(destAbsPath)
	}
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	srcInfo, srcStatErr := os.Stat(srcAbsPath)
	if srcStatErr != nil {
		code := http.StatusInternalServerError
		if os.IsNotExist(srcStatErr) {
			code = http.StatusNotFound
		}
		return apicontract.Failure[apicontract.Null](code, srcStatErr.Error())
	}
	if filelock.IsExist(destAbsPath) {
		return apicontract.Failure[apicontract.Null](http.StatusConflict, "Field [newPath]: path already exists")
	}

	if srcInfo.IsDir() && gulu.File.IsSubPath(srcAbsPath, destAbsPath) {
		return apicontract.Failure[apicontract.Null](http.StatusConflict, "Field [newPath]: cannot rename a directory into its own subdirectory")
	}
	if err = model.CheckDocumentAddressingFileCopies([]string{srcAbsPath}, []string{destAbsPath}); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = model.CheckDocumentAddressingFileRemoval(srcAbsPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	affectsSync := model.PathsAffectSync(srcAbsPath)

	destParent := filepath.Dir(destAbsPath)
	if filelock.IsExist(destParent) {
		parentInfo, statErr := os.Stat(destParent)
		if statErr != nil {
			logging.LogErrorf("stat [%s] failed: %s", destParent, statErr)
			return apicontract.Failure[apicontract.Null](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
		}
		if !parentInfo.IsDir() {
			return apicontract.Failure[apicontract.Null](http.StatusConflict, fmt.Sprintf("Field [newPath]: parent path [%s] is not a directory", filepath.Dir(destPath)))
		}
	} else {
		if err = os.MkdirAll(destParent, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destParent, err)
			return apicontract.Failure[apicontract.Null](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
		}
	}

	if err := model.MutateDocumentAddressingFiles(srcAbsPath, destAbsPath, func() error {
		if err := model.CheckDocumentAddressingFileCopies([]string{srcAbsPath}, []string{destAbsPath}); err != nil {
			return err
		}
		if err := model.CheckDocumentAddressingFileRemoval(srcAbsPath); err != nil {
			return err
		}
		return filelock.RenameWithoutFatal(srcAbsPath, destAbsPath)
	}); err != nil {
		logging.LogErrorf("rename file failed: %s", err)
		return apicontract.Failure[apicontract.Null](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
	}

	if affectsSync || model.PathsAffectSync(destAbsPath) {
		model.IncSync()
	}
	return apicontract.Success(apicontract.Null{})
})

var removeFile = contractHandler(apicontract.RemoveFile, func(c *gin.Context, request apicontract.RemoveFileRequest) apicontract.Response[apicontract.Null] {
	app, filePath := request.App, request.Path
	app = resolveRequestAppID(c, app)

	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, err.Error())
	}
	// 加密笔记本的文件不允许通过原始文件 API 删除（破坏加密存储结构）
	if util.IsPluginDevelopmentRawPathForbidden(fileAbsPath, true) {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
	}
	if rejectEncryptedBoxPath(fileAbsPath) {
		return apicontract.Failure[apicontract.Null](-3, model.Conf.Language(321))
	}
	if err = model.CheckDocumentAddressingFileRemoval(fileAbsPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if model.CheckDocumentAddressingPath(fileAbsPath) == nil {
		if err = prepareFileAssets(fileAbsPath); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
	}
	_, err = os.Stat(fileAbsPath)
	if os.IsNotExist(err) {
		return apicontract.Failure[apicontract.Null](http.StatusNotFound, "path does not exist")
	}
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", fileAbsPath, err)
		return apicontract.Failure[apicontract.Null](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
	}
	affectsSync := model.PathsAffectSync(fileAbsPath)

	if err = model.MutateDocumentAddressingFiles(fileAbsPath, "", func() error {
		if err := model.CheckDocumentAddressingFileRemoval(fileAbsPath); err != nil {
			return err
		}
		return filelock.RemoveWithoutFatal(fileAbsPath)
	}); err != nil {
		logging.LogErrorf("remove [%s] failed: %s", fileAbsPath, err)
		return apicontract.Failure[apicontract.Null](http.StatusInternalServerError, http.StatusText(http.StatusInternalServerError)+errMsgSeeKernelLog)
	}
	model.PushPluginStorageDataChanged(fileAbsPath, app)

	if affectsSync {
		model.IncSync()
	}
	return apicontract.Success(apicontract.Null{})
})

var putFileLock sync.Mutex

var putFile = contractHandler(apicontract.PutFile, func(c *gin.Context, request apicontract.PutFileRequest) apicontract.Response[apicontract.Null] {
	// 表单已由 contractHandler 接收完成，串行保护路径检查、文件写入、时间更新和变更通知。
	putFileLock.Lock()
	defer putFileLock.Unlock()

	isDirStr := request.IsDir
	isDir, _ := strconv.ParseBool(isDirStr)
	app := resolveRequestAppID(c, request.App)

	var err error
	filePath := request.Path
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return apicontract.Failure[apicontract.Null](http.StatusBadRequest, "path must not be empty")
	}
	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, err.Error())
	}

	// 加密笔记本的任何文件都不允许通过原始文件 API 写入（不只 .sy）：
	if util.IsPluginDevelopmentRawPathForbidden(fileAbsPath, true) {
		return apicontract.Failure[apicontract.Null](http.StatusForbidden, "managed plugin development files require their dedicated tools")
	}
	// 明文写入会破坏密文格式或污染加密存储；合法写入走专用 API（已加密感知）
	if rejectEncryptedBoxPath(fileAbsPath) {
		return apicontract.Failure[apicontract.Null](-3, model.Conf.Language(321))
	}

	fileExists := filelock.IsExist(fileAbsPath)
	if !fileExists {
		if !util.IsValidUploadFileName(filepath.Base(fileAbsPath)) { // Improve kernel API `/api/file/putFile` parameter validation https://github.com/siyuan-note/siyuan/issues/14658
			return apicontract.Failure[apicontract.Null](http.StatusBadRequest, "invalid file path. For details, please check https://github.com/siyuan-note/siyuan/issues/14658")
		}
	} else {
		info, statErr := os.Stat(fileAbsPath)
		if statErr != nil {
			logging.LogErrorf("stat file [%s] failed: %s", fileAbsPath, statErr)
			return apicontract.Failure[apicontract.Null](http.StatusInternalServerError, statErr.Error())
		}
		if info.IsDir() && !isDir {
			return apicontract.Failure[apicontract.Null](http.StatusBadRequest, "path is a directory")
		}
	}

	if isDir {
		if err = model.CheckDocumentAddressingFileWrite(fileAbsPath, nil, true); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		err = os.MkdirAll(fileAbsPath, 0755)
		if err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", fileAbsPath, err)
		}
	} else {
		fileHeader := request.File
		if nil == fileHeader {
			logging.LogErrorf("form file is nil [path=%s]", fileAbsPath)
			return apicontract.Failure[apicontract.Null](http.StatusBadRequest, "Field [file] must not be empty")
		}

		for range 1 {
			var f multipart.File
			f, err = fileHeader.Open()
			if err != nil {
				logging.LogErrorf("open file failed: %s", err)
				break
			}

			var data []byte
			data, err = io.ReadAll(f)
			f.Close()
			if err != nil {
				logging.LogErrorf("read file failed: %s", err)
				break
			}

			if err = model.CheckDocumentAddressingFileWrite(fileAbsPath, data, false); err != nil {
				break
			}
			dir := filepath.Dir(fileAbsPath)
			if err = os.MkdirAll(dir, 0755); err != nil {
				logging.LogErrorf("put file [%s] make dir [%s] failed: %s", fileAbsPath, dir, err)
				break
			}
			err = model.WriteFileWithDocumentAddressing(fileAbsPath, data)
			if err != nil {
				logging.LogErrorf("write file [%s] failed: %s", fileAbsPath, err)
				break
			}
		}
	}
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	modTimeStr := request.ModTime
	modTime := time.Now()
	if "" != modTimeStr {
		modTimeInt, parseErr := strconv.ParseInt(modTimeStr, 10, 64)
		if nil != parseErr {
			logging.LogErrorf("parse mod time [%s] failed: %s", modTimeStr, parseErr)
			return apicontract.Failure[apicontract.Null](http.StatusInternalServerError, parseErr.Error())
		}
		modTime = millisecond2Time(modTimeInt)
	}
	if err = os.Chtimes(fileAbsPath, modTime, modTime); err != nil {
		logging.LogErrorf("change time failed: %s", err)
		return apicontract.Failure[apicontract.Null](http.StatusInternalServerError, err.Error())
	}

	if !isDir {
		model.PushPluginStorageDataChanged(fileAbsPath, app)
		model.IncSyncIfNeeded(fileAbsPath)
	}
	return apicontract.Success(apicontract.Null{})
})

func millisecond2Time(t int64) time.Time {
	sec := t / 1000
	msec := t % 1000
	return time.Unix(sec, msec*int64(time.Millisecond))
}
