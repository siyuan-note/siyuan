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
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InsertLocalAssets(id string, assetAbsPaths []string, isUpload bool) (succMap map[string]any, err error) {
	succMap = map[string]any{}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		err = errors.New(Conf.Language(71))
		return
	}

	docDirLocalPath := filepath.Join(util.DataDir, bt.BoxID, path.Dir(bt.Path))
	assetsDirPath := getAssetsDir(filepath.Join(util.DataDir, bt.BoxID), docDirLocalPath)
	if !gulu.File.IsExist(assetsDirPath) {
		if err = os.MkdirAll(assetsDirPath, 0755); err != nil {
			return
		}
	}

	for _, assetAbsPath := range assetAbsPaths {
		baseName := filepath.Base(assetAbsPath)
		fName := baseName
		fName = util.FilterUploadFileName(fName)
		ext := filepath.Ext(fName)
		fName = strings.TrimSuffix(fName, ext)
		ext = strings.ToLower(ext)
		fName += ext
		if gulu.File.IsDir(assetAbsPath) || !isUpload {
			if !strings.HasPrefix(assetAbsPath, "\\\\") {
				assetAbsPath = "file://" + assetAbsPath
			}
			succMap[baseName] = assetAbsPath
			continue
		}

		if gulu.File.IsSubPath(assetsDirPath, assetAbsPath) {
			// 已经位于 assets 目录下的资源文件不处理
			// Dragging a file from the assets folder into the editor causes the kernel to exit https://github.com/siyuan-note/siyuan/issues/15355
			succMap[baseName] = "assets/" + baseName
			continue
		}

		fi, statErr := os.Stat(assetAbsPath)
		if nil != statErr {
			err = statErr
			return
		}
		f, openErr := os.Open(assetAbsPath)
		if nil != openErr {
			err = openErr
			return
		}

		hash, hashErr := util.GetEtagByHandle(f, fi.Size())
		if nil != hashErr {
			f.Close()
			return
		}

		if 1 > fi.Size() {
			hash = "random_1_" + gulu.Rand.String(12)
		}

		existAssetPath := GetAssetPathByHash(hash)
		if "" != existAssetPath {
			originalName := util.RemoveID(filepath.Base(existAssetPath))
			if strings.ToLower(fName) != strings.ToLower(originalName) {
				hash = "random_2_" + gulu.Rand.String(12)
			}
		}

		if "" != existAssetPath && !strings.HasPrefix(hash, "random_") {
			succMap[baseName] = strings.TrimPrefix(existAssetPath, "/")
			f.Close()
		} else {
			blockID := ast.NewNodeID()
			if IsEncryptedBox(bt.BoxID) {
				// 加密 box：磁盘文件名脱敏为 uuid-blockID.ext，原始名存加密映射
				fName = encryptedAssetName(util.Ext(fName), blockID)
				writeAssetNameMapping(bt.BoxID, fName, baseName)
			} else {
				fName = util.AssetName(fName, blockID)
			}
			writePath := filepath.Join(assetsDirPath, fName)
			if _, err = f.Seek(0, io.SeekStart); err != nil {
				f.Close()
				return
			}
			if err = writeAssetFile(writePath, f, bt.BoxID); err != nil {
				f.Close()
				return
			}
			f.Close()

			p := "assets/" + fName
			succMap[baseName] = p
			cache.SetAssetHash(hash, p)
		}
	}
	IncSync()
	return
}

func Upload(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	form, err := c.MultipartForm()
	if err != nil {
		logging.LogErrorf("insert asset failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	assetsDirPath := filepath.Join(util.DataDir, "assets")
	var uploadBoxID string // 记录上传目标 boxID，供 writeAssetFile 判断是否需加密
	if nil != form.Value["id"] {
		id := form.Value["id"][0]
		bt := treenode.GetBlockTree(id)
		if nil == bt {
			// 全局 blocktree 找不到时，遍历已打开的加密 box 查找
			for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if encBT := treenode.GetBlockTreeInBox(id, encBoxID); nil != encBT {
					bt = encBT
					break
				}
			}
		}
		if nil == bt {
			ret.Code = -1
			ret.Msg = Conf.Language(71)
			return
		}
		uploadBoxID = bt.BoxID
		docDirLocalPath := filepath.Join(util.DataDir, bt.BoxID, path.Dir(bt.Path))
		assetsDirPath = getAssetsDir(filepath.Join(util.DataDir, bt.BoxID), docDirLocalPath)
	}

	relAssetsDirPath := "assets"
	if nil != form.Value["assetsDirPath"] {
		relAssetsDirPath = form.Value["assetsDirPath"][0]
		assetsDirPath = filepath.Join(util.DataDir, relAssetsDirPath)
		if !util.IsAbsPathInWorkspace(assetsDirPath) {
			ret.Code = -1
			ret.Msg = "Path [" + assetsDirPath + "] is not in workspace"
			return
		}
	}
	if !gulu.File.IsExist(assetsDirPath) {
		if err = os.MkdirAll(assetsDirPath, 0755); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}

	var errFiles []string
	succMap := map[string]any{}
	files := form.File["file[]"]
	skipIfDuplicated := false // 默认不跳过重复文件，但是有的场景需要跳过，比如上传 PDF 标注图片 https://github.com/siyuan-note/siyuan/issues/10666
	if nil != form.Value["skipIfDuplicated"] {
		skipIfDuplicated = "true" == form.Value["skipIfDuplicated"][0]
	}

	for _, file := range files {
		baseName := file.Filename
		_, lastID := util.LastID(baseName)
		if !ast.IsNodeIDPattern(lastID) {
			lastID = ""
		}

		needUnzip2Dir := false
		if gulu.OS.IsDarwin() {
			if strings.HasSuffix(baseName, ".rtfd.zip") {
				needUnzip2Dir = true
			}
		}

		fName := baseName
		fName = util.FilterUploadFileName(fName)
		ext := filepath.Ext(fName)
		fName = strings.TrimSuffix(fName, ext)
		ext = strings.ToLower(ext)
		fName += ext
		f, openErr := file.Open()
		if nil != openErr {
			errFiles = append(errFiles, fName)
			ret.Msg = openErr.Error()
			break
		}

		hash, hashErr := util.GetEtagByHandle(f, file.Size)
		if nil != hashErr {
			errFiles = append(errFiles, fName)
			ret.Msg = err.Error()
			f.Close()
			break
		}

		if 1 > file.Size {
			hash = "random_1_" + gulu.Rand.String(12)
		}

		existAssetPath := GetAssetPathByHash(hash)
		if "" != existAssetPath {
			originalName := util.RemoveID(filepath.Base(existAssetPath))
			if strings.ToLower(fName) != strings.ToLower(originalName) {
				hash = "random_2_" + gulu.Rand.String(12)
			}
		}

		if "" != existAssetPath && !strings.HasPrefix(hash, "random_") {
			succMap[baseName] = strings.TrimPrefix(existAssetPath, "/")
			f.Close()
		} else {
			if skipIfDuplicated {
				// 复制 PDF 矩形注解时不再重复插入图片 No longer upload image repeatedly when copying PDF rectangle annotation https://github.com/siyuan-note/siyuan/issues/10666
				pattern := assetsDirPath + string(os.PathSeparator) + strings.TrimSuffix(fName, ext)
				_, patternLastID := util.LastID(fName)
				if lastID != "" && lastID != patternLastID {
					// 文件名太长被截断了，通过之前的 lastID 来匹配 PDF files with too long file names cannot generate annotated images https://github.com/siyuan-note/siyuan/issues/15739
					pattern = assetsDirPath + string(os.PathSeparator) + "*" + lastID + ext
				} else {
					pattern += "*" + ext
				}

				matches, globErr := filepath.Glob(pattern)
				if nil != globErr {
					logging.LogErrorf("glob failed: %s", globErr)
				} else {
					if 0 < len(matches) {
						fName = filepath.Base(matches[0])
						succMap[baseName] = strings.TrimPrefix(path.Join(relAssetsDirPath, fName), "/")
						f.Close()
						break
					}
				}
			}

			if "" == lastID {
				lastID = ast.NewNodeID()
			}
			if IsEncryptedBox(uploadBoxID) {
				// 加密 box：磁盘文件名脱敏为 uuid-blockID.ext，原始名存加密映射
				fName = encryptedAssetName(util.Ext(fName), lastID)
				writeAssetNameMapping(uploadBoxID, fName, baseName)
			} else {
				fName = util.AssetName(fName, lastID)
			}
			writePath := filepath.Join(assetsDirPath, fName)
			tmpDir := filepath.Join(util.TempDir, "convert", "zip", gulu.Rand.String(7))
			if needUnzip2Dir {
				if err = os.MkdirAll(tmpDir, 0755); err != nil {
					errFiles = append(errFiles, fName)
					ret.Msg = err.Error()
					f.Close()
					break
				}
				writePath = filepath.Join(tmpDir, fName)
			}

			if _, err = f.Seek(0, io.SeekStart); err != nil {
				logging.LogErrorf("seek failed: %s", err)
				errFiles = append(errFiles, fName)
				ret.Msg = err.Error()
				f.Close()
				break
			}
			if err = writeAssetFile(writePath, f, uploadBoxID); err != nil {
				logging.LogErrorf("write file failed: %s", err)
				errFiles = append(errFiles, fName)
				ret.Msg = err.Error()
				f.Close()
				break
			}
			f.Close()

			if needUnzip2Dir {
				baseName = strings.TrimSuffix(file.Filename, ".rtfd.zip") + ".rtfd"
				fName = baseName
				fName = util.FilterUploadFileName(fName)
				ext = filepath.Ext(fName)
				fName = strings.TrimSuffix(fName, ext)
				ext = strings.ToLower(ext)
				fName += ext
				fName = util.AssetName(fName, ast.NewNodeID())
				tmpDir2 := filepath.Join(util.TempDir, "convert", "zip", gulu.Rand.String(7))
				if err = gulu.Zip.Unzip(writePath, tmpDir2); err != nil {
					errFiles = append(errFiles, fName)
					ret.Msg = err.Error()
					break
				}

				entries, readErr := os.ReadDir(tmpDir2)
				if nil != readErr {
					logging.LogErrorf("read dir [%s] failed: %s", tmpDir2, readErr)
					errFiles = append(errFiles, fName)
					ret.Msg = readErr.Error()
					break
				}
				if 1 > len(entries) {
					logging.LogErrorf("read dir [%s] failed: no entry", tmpDir2)
					errFiles = append(errFiles, fName)
					ret.Msg = "no entry"
					break
				}
				dirName := entries[0].Name()
				srcDir := filepath.Join(tmpDir2, dirName)
				entries, readErr = os.ReadDir(srcDir)
				if nil != readErr {
					logging.LogErrorf("read dir [%s] failed: %s", filepath.Join(tmpDir2, entries[0].Name()), readErr)
					errFiles = append(errFiles, fName)
					ret.Msg = readErr.Error()
					break
				}
				destDir := filepath.Join(assetsDirPath, fName)
				for _, entry := range entries {
					from := filepath.Join(srcDir, entry.Name())
					to := filepath.Join(destDir, entry.Name())
					if copyErr := gulu.File.Copy(from, to); nil != copyErr {
						logging.LogErrorf("copy [%s] to [%s] failed: %s", from, to, copyErr)
						errFiles = append(errFiles, fName)
						ret.Msg = copyErr.Error()
						break
					}
				}
				os.RemoveAll(tmpDir)
				os.RemoveAll(tmpDir2)
			}

			p := strings.TrimPrefix(path.Join(relAssetsDirPath, fName), "/")
			succMap[baseName] = p
			cache.SetAssetHash(hash, p)
		}
	}

	ret.Data = map[string]any{
		"errFiles": errFiles,
		"succMap":  succMap,
	}

	IncSync()
}

func getAssetsDir(boxLocalPath, docDirLocalPath string) (assets string) {
	assets = filepath.Join(docDirLocalPath, "assets")
	if !filelock.IsExist(assets) {
		assets = filepath.Join(boxLocalPath, "assets")
		if !filelock.IsExist(assets) {
			// 加密笔记本禁用全局 data/assets 回退，强制使用笔记本级 assets，避免明文资源泄漏到全局
			boxID := filepath.Base(boxLocalPath)
			if IsEncryptedBox(boxID) {
				_ = os.MkdirAll(assets, 0755)
				return
			}
			assets = filepath.Join(util.DataDir, "assets")
		}
	}
	return
}

// writeAssetFile 把 src 的内容写入 writePath。若 boxID 是已解锁的加密 box，先加密字节流再落盘；
// 否则直接按 reader 写（走 filelock.WriteFileByReader 原路径，保留锁语义）。
func writeAssetFile(writePath string, src io.Reader, boxID string) (err error) {
	if boxID != "" {
		if dek, decErr := GetDEK(boxID); decErr == nil && dek != nil {
			// 已解锁的加密 box：全读 → 加密 → 落盘
			raw, readErr := io.ReadAll(src)
			if readErr != nil {
				return readErr
			}
			enc, encErr := util.Encrypt(dek, raw)
			if encErr != nil {
				return encErr
			}
			return filelock.WriteFile(writePath, enc)
		}
	}
	return filelock.WriteFileByReader(writePath, src)
}

// encryptedAssetName 生成加密 box 专用的无语义资源文件名：uuid-blockID.ext。
// 原始语义文件名（如"合同.pdf"）通过 writeAssetNameMapping 存入加密映射，磁盘上只保留随机名。
func encryptedAssetName(ext, blockID string) string {
	return gulu.Rand.String(16) + "-" + blockID + ext
}

// assetNameMappingPath 返回加密 box 资源名映射文件路径 <boxID>/assets/.names.json。
func assetNameMappingPath(boxID string) string {
	return filepath.Join(util.DataDir, boxID, "assets", ".names.json")
}

// writeAssetNameMapping 把"磁盘文件名 -> 原始文件名"映射写入加密 box 的 .names.json（DEK 加密落盘）。
func writeAssetNameMapping(boxID, diskName, originalName string) {
	if boxID == "" || !IsEncryptedBox(boxID) {
		return
	}
	mapping := readAssetNameMapping(boxID)
	mapping[diskName] = originalName
	data, err := json.Marshal(mapping)
	if err != nil {
		logging.LogErrorf("marshal asset name mapping failed: %s", err)
		return
	}
	dek, err := GetDEK(boxID)
	if err != nil || dek == nil {
		logging.LogErrorf("get DEK for asset name mapping failed: %s", err)
		return
	}
	enc, err := util.Encrypt(dek, data)
	if err != nil {
		logging.LogErrorf("encrypt asset name mapping failed: %s", err)
		return
	}
	if err = filelock.WriteFile(assetNameMappingPath(boxID), enc); err != nil {
		logging.LogErrorf("write asset name mapping failed: %s", err)
	}
}

// readAssetNameMapping 读取加密 box 的资源名映射（DEK 解密）。未解锁或文件不存在时返回空 map。
func readAssetNameMapping(boxID string) map[string]string {
	ret := map[string]string{}
	if boxID == "" || !IsEncryptedBox(boxID) {
		return ret
	}
	p := assetNameMappingPath(boxID)
	enc, err := filelock.ReadFile(p)
	if err != nil {
		return ret
	}
	dek, err := GetDEK(boxID)
	if err != nil || dek == nil {
		return ret
	}
	data, err := util.Decrypt(dek, enc)
	if err != nil {
		logging.LogErrorf("decrypt asset name mapping failed: %s", err)
		return ret
	}
	if err = json.Unmarshal(data, &ret); err != nil {
		logging.LogErrorf("unmarshal asset name mapping failed: %s", err)
		return map[string]string{}
	}
	return ret
}

// LookupAssetOriginalName 查询加密 box 资源的原始文件名（供下载 Content-Disposition 等展示用）。
// 未找到时返回空串。
func LookupAssetOriginalName(boxID, diskName string) string {
	return readAssetNameMapping(boxID)[diskName]
}
