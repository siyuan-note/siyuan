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

package api

import (
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// errMsgSeeKernelLog 接在 API 错误提示末尾，引导用户查看内核日志以获取完整信息（避免在 Msg 暴露工作空间绝对路径）。
const errMsgSeeKernelLog = ". For details, see the SiYuan kernel log."

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

func getUniqueFilename(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var filePath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("path", &filePath, true, true),
	) {
		return
	}

	ret.Data = map[string]any{
		"path": util.GetUniqueFilename(filePath),
	}
}

func globalCopyFiles(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var srcsArg []any
	var destDirArg string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("srcs", &srcsArg, true, true),        // 绝对路径
		util.BindJsonArg("destDir", &destDirArg, true, false), // 相对于工作空间的路径
	) {
		return
	}

	var srcs []string
	for _, s := range srcsArg {
		str, elemOk := s.(string)
		if !elemOk {
			ret.Code = -1
			ret.Msg = "Field [srcs]: each element should be of type [String]"
			return
		}
		srcs = append(srcs, str)
	}

	for i, src := range srcs {
		if !filepath.IsAbs(src) {
			logging.LogErrorf("global copy files src [%s] is not an absolute path", src)
			ret.Code = -1
			ret.Msg = "Field [srcs]: each path must be absolute"
			return
		}

		absSrc, _ := filepath.Abs(src)

		if !filelock.IsExist(absSrc) {
			logging.LogErrorf("file [%s] does not exist", src)
			ret.Code = -1
			ret.Msg = fmt.Sprintf("file [%s] does not exist", src)
			return
		}

		if util.IsSensitivePath(absSrc) {
			logging.LogErrorf("refuse to copy sensitive file [%s]", src)
			ret.Code = -2
			ret.Msg = fmt.Sprintf("refuse to copy sensitive file [%s]", src)
			return
		}

		if rejectEncryptedBoxPath(absSrc) {
			ret.Code = -3
			ret.Msg = model.Conf.Language(321)
			return
		}

		srcs[i] = absSrc
	}

	destDir, err := util.GetAbsPathInWorkspace(destDirArg)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	// 在 MkdirAll 前拒绝加密笔记本目录，避免在加密笔记本内创建明文目录
	if rejectEncryptedBoxPath(destDir) {
		ret.Code = -1
		ret.Msg = "copying encrypted notebook files is not supported via this API"
		return
	}
	if filelock.IsExist(destDir) {
		destInfo, statErr := os.Stat(destDir)
		if statErr != nil {
			ret.Code = -1
			ret.Msg = statErr.Error()
			return
		}
		if !destInfo.IsDir() {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [destDir]: path [%s] is not a directory", destDirArg)
			return
		}
	} else {
		if err = os.MkdirAll(destDir, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destDir, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}

	for _, src := range srcs {
		dest := filepath.Join(destDir, filepath.Base(src))
		if rejectEncryptedBoxPath(dest) {
			ret.Code = -3
			ret.Msg = model.Conf.Language(321)
			return
		}
		// 拒绝目标已存在的 symlink：os.Create 会跟随 symlink，可能写入加密笔记本内部
		if li, lerr := os.Lstat(dest); lerr == nil && li.Mode()&os.ModeSymlink != 0 {
			ret.Code = -1
			ret.Msg = "destination path is a symlink, which is not supported"
			return
		}
		if err := filelock.Copy(src, dest); err != nil {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", src, dest, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}

	model.IncSync()
}

func workspaceCopyFiles(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var srcsArg []any
	var destDirArg string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("srcs", &srcsArg, true, true),        // 相对于工作空间的路径
		util.BindJsonArg("destDir", &destDirArg, true, false), // 相对于工作空间的路径
	) {
		return
	}

	var relSrcs []string
	for _, s := range srcsArg {
		str, elemOk := s.(string)
		if !elemOk {
			ret.Code = -1
			ret.Msg = "Field [srcs]: each element should be of type [String]"
			return
		}
		str = strings.TrimSpace(str)
		if str == "" {
			ret.Code = -1
			ret.Msg = "Field [srcs]: path must not be empty"
			return
		}
		relSrcs = append(relSrcs, str)
	}

	var absSrcs []string
	for _, src := range relSrcs {
		absSrc, err := util.GetAbsPathInWorkspace(src)
		if err != nil {
			ret.Code = http.StatusForbidden
			ret.Msg = err.Error()
			return
		}
		if !filelock.IsExist(absSrc) {
			logging.LogErrorf("file [%s] does not exist", src)
			ret.Code = -1
			ret.Msg = fmt.Sprintf("file [%s] does not exist", src)
			return
		}
		if util.IsSensitivePath(absSrc) {
			logging.LogErrorf("refuse to copy sensitive file [%s]", src)
			ret.Code = -2
			ret.Msg = fmt.Sprintf("refuse to copy sensitive file [%s]", src)
			return
		}
		if rejectEncryptedBoxPath(absSrc) {
			ret.Code = -3
			ret.Msg = model.Conf.Language(321)
			return
		}
		absSrcs = append(absSrcs, absSrc)
	}

	destDir, err := util.GetAbsPathInWorkspace(destDirArg)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	// 在 MkdirAll 前拒绝加密笔记本目录，避免在加密笔记本内创建明文目录
	if rejectEncryptedBoxPath(destDir) {
		ret.Code = -1
		ret.Msg = "copying encrypted notebook files is not supported via this API"
		return
	}
	if filelock.IsExist(destDir) {
		destInfo, err := os.Stat(destDir)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		if !destInfo.IsDir() {
			ret.Code = -1
			ret.Msg = "Field [destDir]: path is not a directory"
			return
		}
	} else {
		if err = os.MkdirAll(destDir, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destDir, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}

	for _, absSrc := range absSrcs {
		dest := filepath.Join(destDir, filepath.Base(absSrc))
		if rejectEncryptedBoxPath(dest) {
			ret.Code = -3
			ret.Msg = model.Conf.Language(321)
			return
		}
		if li, lerr := os.Lstat(dest); lerr == nil && li.Mode()&os.ModeSymlink != 0 {
			ret.Code = -1
			ret.Msg = "destination path is a symlink, which is not supported"
			return
		}
		if err := filelock.Copy(absSrc, dest); err != nil {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", absSrc, dest, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}

	model.IncSync()
}

func copyFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var src, dest string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("src", &src, true, true),   // 资源路径，由 GetAssetAbsPath 解析
		util.BindJsonArg("dest", &dest, true, true), // 绝对路径
	) {
		return
	}

	if !filepath.IsAbs(dest) {
		logging.LogErrorf("copy file dest [%s] is not an absolute path", dest)
		ret.Code = -1
		ret.Msg = "Field [dest]: path must be absolute"
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	src, err := model.GetAssetAbsPathInBox(src, "")
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", src, err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	// 加密笔记本的文件不允许通过原始文件 API 复制（src 读出密文/明文，dest 写入破坏加密存储）
	// 例外：dest 在工作区外且非加密 box 时允许解密复制（用户导出的场景）
	if rejectEncryptedBoxPath(src) || rejectEncryptedBoxPath(dest) {
		if !rejectEncryptedBoxPath(dest) && !gulu.File.IsSubPath(util.WorkspaceDir, dest) {
			// dest 在工作区外且非加密 box，允许解密后复制
			if err = copyDecryptedAsset(src, dest); err != nil {
				ret.Code = -1
				ret.Msg = err.Error()
				ret.Data = map[string]any{"closeTimeout": 5000}
				return
			}
			return
		}
		ret.Code = -1
		ret.Msg = "copying encrypted notebook files is not supported via this API"
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	info, err := os.Stat(src)
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", src, err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	if info.IsDir() {
		ret.Code = -1
		ret.Msg = "Field [src]: path is a directory"
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	if util.IsSensitivePath(dest) {
		logging.LogErrorf("refuse to copy sensitive file [%s]", dest)
		ret.Code = -2
		ret.Msg = fmt.Sprintf("refuse to copy sensitive file [%s]", dest)
		return
	}

	if err = filelock.Copy(src, dest); err != nil {
		logging.LogErrorf("copy file [%s] to [%s] failed: %s", src, dest, err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	model.IncSync()
}

func getFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	arg, ok := util.JsonArg(c, ret)
	if !ok {
		ret.Code = -1
		c.JSON(http.StatusAccepted, ret)
		return
	}

	var filePath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("path", &filePath, true, true),
	) {
		c.JSON(http.StatusAccepted, ret)
		return
	}

	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}
	// 加密笔记本的任何文件都不允许通过原始文件 API 读取（不只 .sy）：
	// 密文对插件无意义，且可能被误解析或泄漏；合法读取走专用 API（已加密感知）
	if rejectEncryptedBoxPath(fileAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		c.JSON(http.StatusAccepted, ret)
		return
	}
	if !filelock.IsExist(fileAbsPath) {
		ret.Code = http.StatusNotFound
		ret.Msg = "file does not exist"
		c.JSON(http.StatusAccepted, ret)
		return
	}

	info, err := os.Stat(fileAbsPath)
	if os.IsNotExist(err) {
		ret.Code = http.StatusNotFound
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}
	if info.IsDir() {
		logging.LogErrorf("path [%s] is a directory path", fileAbsPath)
		ret.Code = http.StatusConflict
		ret.Msg = "path is a directory"
		c.JSON(http.StatusAccepted, ret)
		return
	}

	// REF: https://github.com/siyuan-note/siyuan/issues/11364
	if !model.IsAdminRoleContext(c) {
		if refuseToAccess(c, fileAbsPath, ret) {
			return
		}
	}

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckAbsPathAccessableByPublishAccess(c, fileAbsPath, publishAccess) {
			ret.Code = http.StatusForbidden
			ret.Msg = http.StatusText(http.StatusForbidden)
			c.JSON(http.StatusAccepted, ret)
			return
		}
	}

	data, err := filelock.ReadFile(fileAbsPath)
	if err != nil {
		logging.LogErrorf("read file [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
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
	c.Data(http.StatusOK, contentType, data)
}

func refuseToAccess(c *gin.Context, fileAbsPath string, ret *gulu.Result) bool {
	// 规范化并解析符号链接，防止通过大小写或符号链接绕过
	fileNorm := normalizeAndResolve(fileAbsPath)

	// 禁止访问配置文件 conf/conf.json
	confPath := normalizeAndResolve(filepath.Join(util.ConfDir, "conf.json"))
	if fileNorm == confPath {
		ret.Code = http.StatusForbidden
		ret.Msg = http.StatusText(http.StatusForbidden)
		c.JSON(http.StatusAccepted, ret)
		return true
	}

	// 禁止访问 data/snippets/conf.json
	snippetPath := normalizeAndResolve(filepath.Join(util.DataDir, "snippets", "conf.json"))
	if fileNorm == snippetPath {
		ret.Code = http.StatusForbidden
		ret.Msg = http.StatusText(http.StatusForbidden)
		c.JSON(http.StatusAccepted, ret)
		return true
	}

	// 禁止访问 data/templates 目录
	templatesBase := normalizeAndResolve(filepath.Join(util.DataDir, "templates"))
	if gulu.File.IsSubPath(templatesBase, fileNorm) {
		ret.Code = http.StatusForbidden
		ret.Msg = http.StatusText(http.StatusForbidden)
		c.JSON(http.StatusAccepted, ret)
		return true
	}

	// 禁止访问 data/.siyuan/publishAccess.json
	publishAccessPath := normalizeAndResolve(filepath.Join(util.DataDir, ".siyuan", "publishAccess.json"))
	if fileNorm == publishAccessPath {
		ret.Code = http.StatusForbidden
		ret.Msg = http.StatusText(http.StatusForbidden)
		c.JSON(http.StatusAccepted, ret)
		return true
	}

	// 禁止访问 无发布访问权限的文件
	publishAccess := model.GetPublishAccess()
	if !model.CheckAbsPathAccessableByPublishAccess(c, fileAbsPath, publishAccess) {
		ret.Code = http.StatusForbidden
		ret.Msg = http.StatusText(http.StatusForbidden)
		c.JSON(http.StatusAccepted, ret)
		return true
	}

	return false
}

// normalizeAndResolve 将路径转为绝对、解析符号链接并清理；在需要时转为小写以实现不区分大小写比较
func normalizeAndResolve(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	if eval, err := filepath.EvalSymlinks(p); err == nil {
		p = eval
	}
	p = filepath.Clean(p)
	// 在 Windows 和 macOS 上文件系统通常为不区分大小写，使用小写统一比较
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		p = strings.ToLower(p)
	}
	return p
}

func readDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	var dirPath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("path", &dirPath, true, false),
	) {
		return
	}

	dirAbsPath, err := util.GetAbsPathInWorkspace(dirPath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	// 加密笔记本的任何目录都不允许通过原始文件 API 枚举（不只 .sy）：
	// 目录结构、文档 ID、随机化资产名和时间戳可能泄漏信息；合法读取走专用 API（已加密感知）
	if rejectEncryptedBoxPath(dirAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return
	}
	info, err := os.Stat(dirAbsPath)
	if os.IsNotExist(err) {
		ret.Code = http.StatusNotFound
		ret.Msg = "path does not exist"
		return
	}
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", dirAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return
	}
	if !info.IsDir() {
		logging.LogErrorf("file [%s] is not a directory", dirAbsPath)
		ret.Code = http.StatusConflict
		ret.Msg = "path is not a directory"
		return
	}

	entries, err := os.ReadDir(dirAbsPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", dirAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return
	}

	files := []map[string]any{}
	for _, entry := range entries {
		path := filepath.Join(dirAbsPath, entry.Name())
		info, err = os.Stat(path)
		if err != nil {
			logging.LogErrorf("stat [%s] failed: %s", path, err)
			ret.Code = http.StatusInternalServerError
			ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
			return
		}
		files = append(files, map[string]any{
			"name":      entry.Name(),
			"isDir":     info.IsDir(),
			"isSymlink": util.IsSymlink(entry),
			"updated":   info.ModTime().Unix(),
		})
	}

	ret.Data = files
}

func renameFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	var srcPath, destPath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("path", &srcPath, true, true),
		util.BindJsonArg("newPath", &destPath, true, true),
	) {
		return
	}

	srcAbsPath, err := util.GetAbsPathInWorkspace(srcPath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	srcInfo, srcStatErr := os.Stat(srcAbsPath)
	if os.IsNotExist(srcStatErr) {
		ret.Code = http.StatusNotFound
		ret.Msg = "Field [path]: path does not exist"
		return
	}
	if srcStatErr != nil {
		logging.LogErrorf("stat [%s] failed: %s", srcAbsPath, srcStatErr)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return
	}

	destAbsPath, err := util.GetAbsPathInWorkspace(destPath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	// 加密笔记本的文件不允许通过原始文件 API 重命名（会破坏加密存储结构/跨 box 搬运密文）
	if rejectEncryptedBoxPath(srcAbsPath) || rejectEncryptedBoxPath(destAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return
	}
	if filelock.IsExist(destAbsPath) {
		ret.Code = http.StatusConflict
		ret.Msg = "Field [newPath]: path already exists"
		return
	}

	if srcInfo.IsDir() && gulu.File.IsSubPath(srcAbsPath, destAbsPath) {
		ret.Code = http.StatusConflict
		ret.Msg = "Field [newPath]: cannot rename a directory into its own subdirectory"
		return
	}

	destParent := filepath.Dir(destAbsPath)
	if filelock.IsExist(destParent) {
		parentInfo, statErr := os.Stat(destParent)
		if statErr != nil {
			logging.LogErrorf("stat [%s] failed: %s", destParent, statErr)
			ret.Code = http.StatusInternalServerError
			ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
			return
		}
		if !parentInfo.IsDir() {
			ret.Code = http.StatusConflict
			ret.Msg = fmt.Sprintf("Field [newPath]: parent path [%s] is not a directory", filepath.Dir(destPath))
			return
		}
	} else {
		if err = os.MkdirAll(destParent, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", destParent, err)
			ret.Code = http.StatusInternalServerError
			ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
			return
		}
	}

	if err := filelock.RenameWithoutFatal(srcAbsPath, destAbsPath); err != nil {
		logging.LogErrorf("rename file failed: %s", err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return
	}

	model.IncSync()
}

func removeFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	var filePath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("path", &filePath, true, true),
	) {
		return
	}

	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	// 加密笔记本的文件不允许通过原始文件 API 删除（破坏加密存储结构）
	if rejectEncryptedBoxPath(fileAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return
	}
	_, err = os.Stat(fileAbsPath)
	if os.IsNotExist(err) {
		ret.Code = http.StatusNotFound
		ret.Msg = "path does not exist"
		return
	}
	if err != nil {
		logging.LogErrorf("stat [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return
	}

	if err = filelock.RemoveWithoutFatal(fileAbsPath); err != nil {
		logging.LogErrorf("remove [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = http.StatusText(http.StatusInternalServerError) + errMsgSeeKernelLog
		return
	}

	model.IncSync()
}

func putFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	isDirStr := c.PostForm("isDir")
	isDir, _ := strconv.ParseBool(isDirStr)

	var err error
	filePath := c.PostForm("path")
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		ret.Code = http.StatusBadRequest
		ret.Msg = "path must not be empty"
		return
	}
	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if err != nil {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}

	// 加密笔记本的任何文件都不允许通过原始文件 API 写入（不只 .sy）：
	// 明文写入会破坏密文格式或污染加密存储；合法写入走专用 API（已加密感知）
	if rejectEncryptedBoxPath(fileAbsPath) {
		ret.Code = -3
		ret.Msg = model.Conf.Language(321)
		return
	}

	fileExists := filelock.IsExist(fileAbsPath)
	if !fileExists {
		if !util.IsValidUploadFileName(filepath.Base(fileAbsPath)) { // Improve kernel API `/api/file/putFile` parameter validation https://github.com/siyuan-note/siyuan/issues/14658
			ret.Code = http.StatusBadRequest
			ret.Msg = "invalid file path. For details, please check https://github.com/siyuan-note/siyuan/issues/14658"
			return
		}
	} else {
		info, statErr := os.Stat(fileAbsPath)
		if statErr != nil {
			logging.LogErrorf("stat file [%s] failed: %s", fileAbsPath, statErr)
			ret.Code = http.StatusInternalServerError
			ret.Msg = statErr.Error()
			return
		}
		if info.IsDir() && !isDir {
			ret.Code = http.StatusBadRequest
			ret.Msg = "path is a directory"
			return
		}
	}

	if isDir {
		err = os.MkdirAll(fileAbsPath, 0755)
		if err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", fileAbsPath, err)
		}
	} else {
		fileHeader, _ := c.FormFile("file")
		if nil == fileHeader {
			logging.LogErrorf("form file is nil [path=%s]", fileAbsPath)
			ret.Code = http.StatusBadRequest
			ret.Msg = "Field [file] must not be empty"
			return
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
		return
	}

	modTimeStr := c.PostForm("modTime")
	modTime := time.Now()
	if "" != modTimeStr {
		modTimeInt, parseErr := strconv.ParseInt(modTimeStr, 10, 64)
		if nil != parseErr {
			logging.LogErrorf("parse mod time [%s] failed: %s", modTimeStr, parseErr)
			ret.Code = http.StatusInternalServerError
			ret.Msg = parseErr.Error()
			return
		}
		modTime = millisecond2Time(modTimeInt)
	}
	if err = os.Chtimes(fileAbsPath, modTime, modTime); err != nil {
		logging.LogErrorf("change time failed: %s", err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		return
	}

	model.IncSync()
}

func millisecond2Time(t int64) time.Time {
	sec := t / 1000
	msec := t % 1000
	return time.Unix(sec, msec*int64(time.Millisecond))
}
