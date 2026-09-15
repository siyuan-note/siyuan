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
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
	siyuanAppIDHeader  = "X-SiYuan-App-ID"
)

// resolveFileAPIAppID 优先使用宿主统一注入的应用标识，同时兼容旧请求体中的 app。
func resolveFileAPIAppID(c *gin.Context, bodyApp string) string {
	if headerApp := c.GetHeader(siyuanAppIDHeader); headerApp != "" {
		return headerApp
	}
	return bodyApp
}

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
	boxID := model.ExtractBoxIDFromAssetsPath(src)
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
	if writeErr := os.WriteFile(dest, plain, 0644); writeErr != nil {
		return writeErr
	}
	return nil
}

var getUniqueFilename = contractHandler(apicontract.GetUniqueFilename, func(c *gin.Context, request apicontract.FilePathRequest) apicontract.Response[apicontract.FilePathData] {
	ret := gulu.Ret.NewResult()
	filePath := request.Path
	if rejectEncryptedBoxPath(filePath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return contractFailure[apicontract.FilePathData](ret)
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
	ret := gulu.Ret.NewResult()
	var changedPaths []string
	defer func() {
		model.IncSyncIfNeeded(changedPaths...)
	}()

	srcs, destDirArg := request.Srcs, request.DestDir
	for i, src := range srcs {
		if !filepath.IsAbs(src) {
			logging.LogErrorf("global copy files src [%s] is not an absolute path", src)
			ret.Code = -1
			ret.Msg = "Field [srcs]: each path must be absolute"
			return contractFailure[apicontract.Null](ret)
		}

		absSrc, _ := filepath.Abs(src)

		if util.IsSensitivePath(absSrc) {
			logging.LogErrorf("refuse to copy sensitive file [%s]", src)
			ret.Code = -2
			ret.Msg = fmt.Sprintf("refuse to copy sensitive file [%s]", src)
			return contractFailure[apicontract.Null](ret)
		}

		if rejectEncryptedBoxPath(absSrc) {
			ret.Code = -3
			ret.Msg = model.Conf.Language(321)
			return contractFailure[apicontract.Null](ret)
		}

		if err := prepareFileAssets(absSrc); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
		if !filelock.IsExist(absSrc) {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("file [%s] does not exist", src)
			return contractFailure[apicontract.Null](ret)
		}
		srcs[i] = absSrc
	}

	destDir, err := util.GetAbsPathInWorkspace(destDirArg)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	// 在 MkdirAll 前拒绝加密笔记本目录，避免在加密笔记本内创建明文目录
	if rejectEncryptedBoxPath(destDir) {
		ret.Code = -1
		ret.Msg = "copying encrypted notebook files is not supported via this API"
		return contractFailure[apicontract.Null](ret)
	}
	if filelock.IsExist(destDir) {
		destInfo, statErr := os.Stat(destDir)
		if statErr != nil {
			ret.Code = -1
			ret.Msg = statErr.Error()
			return contractFailure[apicontract.Null](ret)
		}
		if !destInfo.IsDir() {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [destDir]: path [%s] is not a directory", destDirArg)
			return contractFailure[apicontract.Null](ret)
		}
	} else {
		if err = os.MkdirAll(destDir, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destDir, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
	}

	for _, src := range srcs {
		dest := filepath.Join(destDir, filepath.Base(src))
		if rejectEncryptedBoxPath(dest) {
			ret.Code = -3
			ret.Msg = model.Conf.Language(321)
			return contractFailure[apicontract.Null](ret)
		}
		// 拒绝目标已存在的 symlink：os.Create 会跟随 symlink，可能写入加密笔记本内部
		if li, lerr := os.Lstat(dest); lerr == nil && li.Mode()&os.ModeSymlink != 0 {
			ret.Code = -1
			ret.Msg = "destination path is a symlink, which is not supported"
			return contractFailure[apicontract.Null](ret)
		}
		if err := filelock.Copy(src, dest); err != nil {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", src, dest, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
		changedPaths = append(changedPaths, dest)
	}
	return apicontract.Success(apicontract.Null{})
})

var workspaceCopyFiles = contractHandler(apicontract.WorkspaceCopyFiles, func(c *gin.Context, request apicontract.CopyFilesRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	var changedPaths []string
	defer func() {
		model.IncSyncIfNeeded(changedPaths...)
	}()

	relSrcs, destDirArg := request.Srcs, request.DestDir
	var absSrcs []string
	for _, src := range relSrcs {
		absSrc, err := util.GetAbsPathInWorkspace(src)
		if err != nil {
			ret.Code = http.StatusForbidden
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
		if util.IsSensitivePath(absSrc) {
			logging.LogErrorf("refuse to copy sensitive file [%s]", src)
			ret.Code = -2
			ret.Msg = fmt.Sprintf("refuse to copy sensitive file [%s]", src)
			return contractFailure[apicontract.Null](ret)
		}
		if rejectEncryptedBoxPath(absSrc) {
			ret.Code = -3
			ret.Msg = model.Conf.Language(321)
			return contractFailure[apicontract.Null](ret)
		}
		if err = prepareFileAssets(absSrc); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
		if !filelock.IsExist(absSrc) {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("file [%s] does not exist", src)
			return contractFailure[apicontract.Null](ret)
		}
		absSrcs = append(absSrcs, absSrc)
	}

	destDir, err := util.GetAbsPathInWorkspace(destDirArg)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	// 在 MkdirAll 前拒绝加密笔记本目录，避免在加密笔记本内创建明文目录
	if rejectEncryptedBoxPath(destDir) {
		ret.Code = -1
		ret.Msg = "copying encrypted notebook files is not supported via this API"
		return contractFailure[apicontract.Null](ret)
	}
	if filelock.IsExist(destDir) {
		destInfo, err := os.Stat(destDir)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
		if !destInfo.IsDir() {
			ret.Code = -1
			ret.Msg = "Field [destDir]: path is not a directory"
			return contractFailure[apicontract.Null](ret)
		}
	} else {
		if err = os.MkdirAll(destDir, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destDir, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
	}

	for _, absSrc := range absSrcs {
		dest := filepath.Join(destDir, filepath.Base(absSrc))
		if rejectEncryptedBoxPath(dest) {
			ret.Code = -3
			ret.Msg = model.Conf.Language(321)
			return contractFailure[apicontract.Null](ret)
		}
		if li, lerr := os.Lstat(dest); lerr == nil && li.Mode()&os.ModeSymlink != 0 {
			ret.Code = -1
			ret.Msg = "destination path is a symlink, which is not supported"
			return contractFailure[apicontract.Null](ret)
		}
		if err := filelock.Copy(absSrc, dest); err != nil {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", absSrc, dest, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
		changedPaths = append(changedPaths, dest)
	}
	return apicontract.Success(apicontract.Null{})
})

var copyFile = contractHandler(apicontract.CopyFile, func(c *gin.Context, request apicontract.CopyFileRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	src, dest := request.Src, request.Dest
	if !filepath.IsAbs(dest) {
		logging.LogErrorf("copy file dest [%s] is not an absolute path", dest)
		ret.Code = -1
		ret.Msg = "Field [dest]: path must be absolute"
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	src, err := model.GetAssetAbsPathInBox(src, "")
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", src, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	// 加密笔记本的文件不允许通过原始文件 API 复制（src 读出密文/明文，dest 写入破坏加密存储）
	// 例外：dest 在工作区外且非加密 box 时允许解密复制（用户导出的场景）
	if rejectEncryptedBoxPath(src) || rejectEncryptedBoxPath(dest) {
		if !rejectEncryptedBoxPath(dest) && !gulu.File.IsSubPath(util.WorkspaceDir, dest) {
			// dest 在工作区外且非加密 box，允许解密后复制
			boxID := model.ExtractBoxIDFromAssetsPath(src)
			if err = holdEncryptedBoxRequest(c, boxID); err != nil {
				ret.Code = -1
				ret.Msg = model.Conf.Language(314)
				return contractFailure[apicontract.Null](ret)
			}
			if err = copyDecryptedAsset(src, dest); err != nil {
				ret.Code = -1
				ret.Msg = err.Error()
				return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
			}
			return apicontract.Success(apicontract.Null{})
		}
		ret.Code = -1
		ret.Msg = "copying encrypted notebook files is not supported via this API"
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	if err = prepareFileAssets(src); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 7000)
	}
	info, err := os.Stat(src)
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", src, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	if info.IsDir() {
		ret.Code = -1
		ret.Msg = "Field [src]: path is a directory"
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	if util.IsSensitivePath(dest) {
		logging.LogErrorf("refuse to copy sensitive file [%s]", dest)
		ret.Code = -2
		ret.Msg = fmt.Sprintf("refuse to copy sensitive file [%s]", dest)
		return contractFailure[apicontract.Null](ret)
	}

	if err = filelock.Copy(src, dest); err != nil {
		logging.LogErrorf("copy file [%s] to [%s] failed: %s", src, dest, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	model.IncSyncIfNeeded(dest)
	return apicontract.Success(apicontract.Null{})
})

var getFile = contractHandler(apicontract.GetFile, func(c *gin.Context, request apicontract.FilePathRequest) apicontract.Response[apicontract.BinaryContent] {
	ret := gulu.Ret.NewResult()
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
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return contractFailure[apicontract.BinaryContent](ret)
	}
	// 加密笔记本的任何文件都不允许通过原始文件 API 读取（不只 .sy）：
	// 密文对插件无意义，且可能被误解析或泄漏；合法读取走专用 API（已加密感知）
	if rejectEncryptedBoxPath(fileAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return contractFailure[apicontract.BinaryContent](ret)
	}
	// 解析符号链接（Windows 下含目录联接）后再做授权判断，防止 reader 通过 data/assets
	// 等目录下的链接读取工作空间外的文件（security advisory GHSA-g7gf-v79m-jwrm）
	resolvedPath, err := model.ResolveAssetPathWithMissingLeaf(fileAbsPath)
	if err != nil {
		logging.LogErrorf("resolve symlinks for [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return contractFailure[apicontract.BinaryContent](ret)
	}
	// 符号链接指向加密笔记本时同样拒绝读取，防止密文泄漏
	if rejectEncryptedBoxPath(resolvedPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return contractFailure[apicontract.BinaryContent](ret)
	}
	fileAbsPath = resolvedPath

	// REF: https://github.com/siyuan-note/siyuan/issues/11364
	if !model.IsAdminRoleContext(c) {
		// 符号链接解析后的真实路径必须仍位于工作空间内（admin 不受此限制，兼容 assets
		// 指向工作空间外目录的合法用法），发布权限与敏感路径检查也基于解析后的路径执行
		if !gulu.File.IsSubPath(util.NormalizeAndResolve(util.WorkspaceDir), util.NormalizeAndResolve(fileAbsPath)) {
			ret.Code = http.StatusForbidden
			ret.Msg = http.StatusText(http.StatusForbidden)
			return contractFailure[apicontract.BinaryContent](ret)
		}
		if refuseToAccess(c, fileAbsPath, ret) {
			return contractFailure[apicontract.BinaryContent](ret)
		}
	}

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckAbsPathAccessableByPublishAccess(c, fileAbsPath, publishAccess) {
			ret.Code = http.StatusForbidden
			ret.Msg = http.StatusText(http.StatusForbidden)
			return contractFailure[apicontract.BinaryContent](ret)
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
			ret.Code = http.StatusServiceUnavailable
			if os.IsNotExist(err) {
				ret.Code = http.StatusNotFound
			}
			ret.Msg = err.Error()
			return contractFailure[apicontract.BinaryContent](ret)
		}
	}
	info, err := os.Stat(fileAbsPath)
	if err != nil {
		ret.Code = http.StatusInternalServerError
		if os.IsNotExist(err) {
			ret.Code = http.StatusNotFound
		}
		ret.Msg = err.Error()
		return contractFailure[apicontract.BinaryContent](ret)
	}
	if info.IsDir() {
		ret.Code = http.StatusConflict
		ret.Msg = "path is a directory"
		return contractFailure[apicontract.BinaryContent](ret)
	}
	data, err := filelock.ReadFile(fileAbsPath)
	if err != nil {
		logging.LogErrorf("read file [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		return contractFailure[apicontract.BinaryContent](ret)
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

func refuseToAccess(c *gin.Context, fileAbsPath string, ret *gulu.Result) bool {
	// 禁止访问敏感文件（conf 目录下的 conf.json 与 TLS 密钥材料、data/snippets/conf.json、
	// data/templates、data/.siyuan/publishAccess.json），
	// 规范化与符号链接解析见 util.NormalizeAndResolve，防止通过大小写或符号链接绕过
	if util.IsForbiddenAbsPath(fileAbsPath) {
		ret.Code = http.StatusForbidden
		ret.Msg = http.StatusText(http.StatusForbidden)
		return true
	}

	// 禁止访问 无发布访问权限的文件
	publishAccess := model.GetPublishAccess()
	if !model.CheckAbsPathAccessableByPublishAccess(c, fileAbsPath, publishAccess) {
		ret.Code = http.StatusForbidden
		ret.Msg = http.StatusText(http.StatusForbidden)
		return true
	}

	return false
}

var readDir = contractHandler(apicontract.ReadDirectory, func(c *gin.Context, request apicontract.ReadDirectoryRequest) apicontract.Response[[]apicontract.DirectoryEntry] {
	ret := gulu.Ret.NewResult()
	dirPath := request.Path
	dirAbsPath, err := util.GetAbsPathInWorkspace(dirPath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return contractFailure[[]apicontract.DirectoryEntry](ret)
	}
	// 加密笔记本的任何目录都不允许通过原始文件 API 枚举（不只 .sy）：
	// 目录结构、文档 ID、随机化资产名和时间戳可能泄漏信息；合法读取走专用 API（已加密感知）
	if rejectEncryptedBoxPath(dirAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return contractFailure[[]apicontract.DirectoryEntry](ret)
	}
	info, err := os.Stat(dirAbsPath)
	if os.IsNotExist(err) {
		ret.Code = http.StatusNotFound
		ret.Msg = "path does not exist"
		return contractFailure[[]apicontract.DirectoryEntry](ret)
	}
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", dirAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return contractFailure[[]apicontract.DirectoryEntry](ret)
	}
	if !info.IsDir() {
		logging.LogErrorf("file [%s] is not a directory", dirAbsPath)
		ret.Code = http.StatusConflict
		ret.Msg = "path is not a directory"
		return contractFailure[[]apicontract.DirectoryEntry](ret)
	}

	entries, err := os.ReadDir(dirAbsPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", dirAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return contractFailure[[]apicontract.DirectoryEntry](ret)
	}

	files := []apicontract.DirectoryEntry{}
	for _, entry := range entries {
		path := filepath.Join(dirAbsPath, entry.Name())
		info, err = os.Stat(path)
		if err != nil {
			logging.LogErrorf("stat [%s] failed: %s", path, err)
			ret.Code = http.StatusInternalServerError
			ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
			return contractFailure[[]apicontract.DirectoryEntry](ret)
		}
		files = append(files, apicontract.DirectoryEntry{Name: entry.Name(), IsDir: info.IsDir(), IsSymlink: util.IsSymlink(entry), Updated: info.ModTime().Unix()})
	}

	return apicontract.Success(files)
})

var renameFile = contractHandler(apicontract.RenameFile, func(c *gin.Context, request apicontract.RenameFileRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	srcPath, destPath := request.Path, request.NewPath
	srcAbsPath, err := util.GetAbsPathInWorkspace(srcPath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	destAbsPath, err := util.GetAbsPathInWorkspace(destPath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	// 加密笔记本的文件不允许通过原始文件 API 重命名（会破坏加密存储结构/跨 box 搬运密文）
	if rejectEncryptedBoxPath(srcAbsPath) || rejectEncryptedBoxPath(destAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return contractFailure[apicontract.Null](ret)
	}
	if err = prepareFileAssets(srcAbsPath); err == nil {
		err = prepareFileAssets(destAbsPath)
	}
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	srcInfo, srcStatErr := os.Stat(srcAbsPath)
	if srcStatErr != nil {
		ret.Code = http.StatusInternalServerError
		if os.IsNotExist(srcStatErr) {
			ret.Code = http.StatusNotFound
		}
		ret.Msg = srcStatErr.Error()
		return contractFailure[apicontract.Null](ret)
	}
	if filelock.IsExist(destAbsPath) {
		ret.Code = http.StatusConflict
		ret.Msg = "Field [newPath]: path already exists"
		return contractFailure[apicontract.Null](ret)
	}

	if srcInfo.IsDir() && gulu.File.IsSubPath(srcAbsPath, destAbsPath) {
		ret.Code = http.StatusConflict
		ret.Msg = "Field [newPath]: cannot rename a directory into its own subdirectory"
		return contractFailure[apicontract.Null](ret)
	}
	affectsSync := model.PathsAffectSync(srcAbsPath)

	destParent := filepath.Dir(destAbsPath)
	if filelock.IsExist(destParent) {
		parentInfo, statErr := os.Stat(destParent)
		if statErr != nil {
			logging.LogErrorf("stat [%s] failed: %s", destParent, statErr)
			ret.Code = http.StatusInternalServerError
			ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
			return contractFailure[apicontract.Null](ret)
		}
		if !parentInfo.IsDir() {
			ret.Code = http.StatusConflict
			ret.Msg = fmt.Sprintf("Field [newPath]: parent path [%s] is not a directory", filepath.Dir(destPath))
			return contractFailure[apicontract.Null](ret)
		}
	} else {
		if err = os.MkdirAll(destParent, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destParent, err)
			ret.Code = http.StatusInternalServerError
			ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
			return contractFailure[apicontract.Null](ret)
		}
	}

	if err := filelock.RenameWithoutFatal(srcAbsPath, destAbsPath); err != nil {
		logging.LogErrorf("rename file failed: %s", err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return contractFailure[apicontract.Null](ret)
	}

	if affectsSync || model.PathsAffectSync(destAbsPath) {
		model.IncSync()
	}
	return apicontract.Success(apicontract.Null{})
})

var removeFile = contractHandler(apicontract.RemoveFile, func(c *gin.Context, request apicontract.RemoveFileRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	app, filePath := request.App, request.Path
	app = resolveFileAPIAppID(c, app)

	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	// 加密笔记本的文件不允许通过原始文件 API 删除（破坏加密存储结构）
	if rejectEncryptedBoxPath(fileAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return contractFailure[apicontract.Null](ret)
	}
	if err = prepareFileAssets(fileAbsPath); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	_, err = os.Stat(fileAbsPath)
	if os.IsNotExist(err) {
		ret.Code = http.StatusNotFound
		ret.Msg = "path does not exist"
		return contractFailure[apicontract.Null](ret)
	}
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return contractFailure[apicontract.Null](ret)
	}
	affectsSync := model.PathsAffectSync(fileAbsPath)

	if err = filelock.RemoveWithoutFatal(fileAbsPath); err != nil {
		logging.LogErrorf("remove [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return contractFailure[apicontract.Null](ret)
	}
	model.PushPluginStorageDataChanged(fileAbsPath, app)

	if affectsSync {
		model.IncSync()
	}
	return apicontract.Success(apicontract.Null{})
})

var putFile = contractHandler(apicontract.PutFile, func(c *gin.Context, request apicontract.PutFileRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	isDirStr := request.IsDir
	isDir, _ := strconv.ParseBool(isDirStr)
	app := resolveFileAPIAppID(c, request.App)

	var err error
	filePath := request.Path
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		ret.Code = http.StatusBadRequest
		ret.Msg = "path must not be empty"
		return contractFailure[apicontract.Null](ret)
	}
	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	// 加密笔记本的任何文件都不允许通过原始文件 API 写入（不只 .sy）：
	// 明文写入会破坏密文格式或污染加密存储；合法写入走专用 API（已加密感知）
	if rejectEncryptedBoxPath(fileAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return contractFailure[apicontract.Null](ret)
	}

	fileExists := filelock.IsExist(fileAbsPath)
	if !fileExists {
		if !util.IsValidUploadFileName(filepath.Base(fileAbsPath)) { // Improve kernel API `/api/file/putFile` parameter validation https://github.com/siyuan-note/siyuan/issues/14658
			ret.Code = http.StatusBadRequest
			ret.Msg = "invalid file path. For details, please check https://github.com/siyuan-note/siyuan/issues/14658"
			return contractFailure[apicontract.Null](ret)
		}
	} else {
		info, statErr := os.Stat(fileAbsPath)
		if statErr != nil {
			logging.LogErrorf("stat file [%s] failed: %s", fileAbsPath, statErr)
			ret.Code = http.StatusInternalServerError
			ret.Msg = statErr.Error()
			return contractFailure[apicontract.Null](ret)
		}
		if info.IsDir() && !isDir {
			ret.Code = http.StatusBadRequest
			ret.Msg = "path is a directory"
			return contractFailure[apicontract.Null](ret)
		}
	}

	if isDir {
		err = os.MkdirAll(fileAbsPath, 0755)
		if err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", fileAbsPath, err)
		}
	} else {
		fileHeader := request.File
		if nil == fileHeader {
			logging.LogErrorf("form file is nil [path=%s]", fileAbsPath)
			ret.Code = http.StatusBadRequest
			ret.Msg = "Field [file] must not be empty"
			return contractFailure[apicontract.Null](ret)
		}

		for range 1 {
			dir := filepath.Dir(fileAbsPath)
			if err = os.MkdirAll(dir, 0755); err != nil {
				logging.LogErrorf("put file [%s] make dir [%s] failed: %s", fileAbsPath, dir, err)
				break
			}

			var f multipart.File
			f, err = fileHeader.Open()
			if err != nil {
				logging.LogErrorf("open file failed: %s", err)
				break
			}

			var data []byte
			data, err = io.ReadAll(f)
			if err != nil {
				logging.LogErrorf("read file failed: %s", err)
				break
			}

			err = filelock.WriteFile(fileAbsPath, data)
			if err != nil {
				logging.LogErrorf("write file [%s] failed: %s", fileAbsPath, err)
				break
			}
		}
	}
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	modTimeStr := request.ModTime
	modTime := time.Now()
	if "" != modTimeStr {
		modTimeInt, parseErr := strconv.ParseInt(modTimeStr, 10, 64)
		if nil != parseErr {
			logging.LogErrorf("parse mod time [%s] failed: %s", modTimeStr, parseErr)
			ret.Code = http.StatusInternalServerError
			ret.Msg = parseErr.Error()
			return contractFailure[apicontract.Null](ret)
		}
		modTime = millisecond2Time(modTimeInt)
	}
	if err = os.Chtimes(fileAbsPath, modTime, modTime); err != nil {
		logging.LogErrorf("change time failed: %s", err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
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
