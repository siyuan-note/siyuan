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
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// InsertAssetBytes 将内存中的资源直接写入目标文档资源目录，避免生成内容经过明文临时文件。
func InsertAssetBytes(id, fileName string, data []byte) (assetPath string, created bool, err error) {
	bt := treenode.GetBlockTree(id)
	if bt == nil {
		return "", false, errors.New(Conf.Language(71))
	}
	if len(data) == 0 {
		return "", false, errors.New("asset data is empty")
	}

	baseName := filepath.Base(fileName)
	fName := util.FilterUploadFileName(baseName)
	ext := strings.ToLower(filepath.Ext(fName))
	fName = strings.TrimSuffix(fName, filepath.Ext(fName)) + ext
	if fName == "" || fName == "." || ext == "" {
		return "", false, errors.New("invalid asset filename")
	}

	docDirLocalPath := filepath.Join(util.DataDir, bt.BoxID, path.Dir(bt.Path))
	assetsDirPath := getAssetsDir(filepath.Join(util.DataDir, bt.BoxID), docDirLocalPath)
	if err = os.MkdirAll(assetsDirPath, 0755); err != nil {
		return "", false, err
	}

	reader := bytes.NewReader(data)
	hash, err := util.GetEtagByHandle(reader, int64(len(data)))
	if err != nil {
		return "", false, err
	}
	if existAssetPath := GetAssetPathByHash(hash, bt.BoxID); existAssetPath != "" {
		originalName := util.RemoveID(filepath.Base(existAssetPath))
		if strings.EqualFold(fName, originalName) {
			return strings.TrimPrefix(existAssetPath, "/"), false, nil
		}
		hash = "random_2_" + gulu.Rand.String(12)
	}

	blockID := ast.NewNodeID()
	if IsEncryptedBox(bt.BoxID) {
		fName = encryptedAssetName(util.Ext(fName), blockID)
		if err = writeAssetNameMapping(bt.BoxID, fName, baseName); err != nil {
			return "", false, err
		}
	} else {
		fName = util.AssetName(fName, blockID)
	}
	writePath := filepath.Join(assetsDirPath, fName)
	if err = writeAssetFile(writePath, bytes.NewReader(data), bt.BoxID); err != nil {
		if IsEncryptedBox(bt.BoxID) {
			_ = removeAssetNameMapping(bt.BoxID, fName)
		}
		return "", false, err
	}

	assetPath = "assets/" + fName
	if IsEncryptedBox(bt.BoxID) {
		assetPath += "?box=" + bt.BoxID
	} else {
		cache.SetAssetHash(hash, assetPath)
	}
	IncSync()
	return assetPath, true, nil
}

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

		existAssetPath := GetAssetPathByHash(hash, bt.BoxID)
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
				// 映射写入失败则不写 asset，避免产出"孤儿密文 asset 无映射"（详见设计文档 §7）
				if mapErr := writeAssetNameMapping(bt.BoxID, fName, baseName); mapErr != nil {
					err = mapErr
					f.Close()
					return
				}
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
			if IsEncryptedBox(bt.BoxID) {
				p += "?box=" + bt.BoxID
			}
			succMap[baseName] = p
			if !IsEncryptedBox(bt.BoxID) {
				cache.SetAssetHash(hash, p) // 加密笔记本不写全局 cache，避免跨边界去重污染
			}
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
			// 全局 blocktree 找不到时，遍历已打开的加密笔记本查找
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
		// assetsDirPath 可能指向加密 box（调用方未传 id），反查 boxID 让文件名脱敏/.names.json 生效
		if pathBox := ExtractBoxIDFromAssetsPath(assetsDirPath); pathBox != "" && IsEncryptedBox(pathBox) {
			uploadBoxID = pathBox
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
		if needUnzip2Dir && IsEncryptedBox(uploadBoxID) {
			errFiles = append(errFiles, fName)
			ret.Msg = "directory assets are not supported in encrypted notebooks"
			f.Close()
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

		existAssetPath := GetAssetPathByHash(hash, uploadBoxID)
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
				// 映射写入失败则不写 asset，避免产出"孤儿密文 asset 无映射"（详见设计文档 §7）
				if mapErr := writeAssetNameMapping(uploadBoxID, fName, baseName); mapErr != nil {
					errFiles = append(errFiles, fName)
					ret.Msg = mapErr.Error()
					f.Close()
					break
				}
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
			if uploadBoxID != "" && IsEncryptedBox(uploadBoxID) {
				p += "?box=" + uploadBoxID
			}
			succMap[baseName] = p
			if uploadBoxID == "" || !IsEncryptedBox(uploadBoxID) {
				cache.SetAssetHash(hash, p) // 加密笔记本不写全局 cache
			}
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

// writeAssetFile 把 src 的内容写入 writePath。从 writePath 反查真实 boxID 决定是否加密——
// 不轻信传入的 boxID（调用方可能未传，或 assetsDirPath 指向加密笔记本但 id 为空）。
// 加密笔记本必须已解锁（DEK 在内存）才写入；加密但未解锁返回错误（fail-closed，避免明文落盘）。
// 非加密笔记本按 reader 直接写（走 filelock.WriteFileByReader 原路径，保留锁语义）。
func writeAssetFile(writePath string, src io.Reader, boxID string) (err error) {
	// 从 writePath 反查真实 boxID，与传入 boxID 交叉校验
	pathBoxID := ExtractBoxIDFromAssetsPath(writePath)
	// 传入 boxID 与路径 box 都非空但不一致：路径指向另一个 box，拒绝（防跨 box 写入）
	if boxID != "" && pathBoxID != "" && boxID != pathBoxID {
		return fmt.Errorf("boxID mismatch: param=%s, path=%s", boxID, pathBoxID)
	}
	// 路径不在 box 下但传入的是加密 box：加密内容只能写 box 内，拒绝写全局 assets
	if pathBoxID == "" && boxID != "" && IsEncryptedBox(boxID) {
		return fmt.Errorf("encrypted box asset must be written inside the box directory, got global path: %s", writePath)
	}
	actualBoxID := pathBoxID
	if actualBoxID == "" {
		actualBoxID = boxID // 路径不在 box 下（如全局 assets），回退传入值
	}
	if actualBoxID != "" && IsEncryptedBox(actualBoxID) {
		HoldBoxReadLock(actualBoxID)
		defer ReleaseBoxReadLock(actualBoxID)
		dek, dekErr := GetDEKIfUnlocked(actualBoxID)
		if dekErr != nil {
			// 加密笔记本未解锁：拒绝写入，避免明文落盘（深度防御，见 issue #18034）
			return dekErr
		}
		// 已解锁的加密 box：全读 → 加密 → 落盘
		raw, readErr := io.ReadAll(src)
		if readErr != nil {
			return readErr
		}
		enc, encErr := EncryptAsset(actualBoxID, filepath.Base(writePath), dek, raw)
		if encErr != nil {
			return encErr
		}
		return filelock.WriteFile(writePath, enc)
	}
	return filelock.WriteFileByReader(writePath, src)
}

// StoreAssetForBox 统一资产写入入口：根据 boxID 决定加密/明文写入，返回磁盘文件名（不含路径前缀）。
// 加密 box：生成脱敏名 → writeAssetNameMapping 记录映射 → EncryptAsset 加密 → filelock.WriteFile
// 普通 box：util.AssetName 生成名 → filelock.WriteFile 明文写入
// boxID 为空时按普通 box 处理（写入全局 assets）。
func StoreAssetForBox(boxID, assetDirPath, originalName string, data []byte) (diskName string, err error) {
	return storeAssetForBox(boxID, assetDirPath, originalName, data)
}

// storeAssetForBox 统一资产写入入口：根据 boxID 决定加密/明文写入，返回磁盘文件名（不含路径前缀）。
// 加密 box：生成脱敏名 → writeAssetNameMapping 记录映射 → EncryptAsset 加密 → filelock.WriteFile
// 普通 box：util.AssetName 生成名 → filelock.WriteFile 明文写入
// boxID 为空时按普通 box 处理（写入全局 assets）。
func storeAssetForBox(boxID, assetDirPath, originalName string, data []byte) (diskName string, err error) {
	if IsEncryptedBox(boxID) {
		HoldBoxReadLock(boxID)
		defer ReleaseBoxReadLock(boxID)

		ext := filepath.Ext(originalName)
		blockID := ast.NewNodeID()
		diskName = encryptedAssetName(ext, blockID)
		// 映射写入失败则不写 asset，避免产出"孤儿密文 asset 无映射"（详见设计文档 §7）
		if mapErr := writeAssetNameMappingLocked(boxID, diskName, originalName); mapErr != nil {
			return "", mapErr
		}

		dek, dekErr := GetDEKIfUnlocked(boxID)
		if dekErr != nil {
			return "", dekErr
		}
		enc, encErr := EncryptAsset(boxID, diskName, dek, data)
		if encErr != nil {
			return "", encErr
		}
		writePath := filepath.Join(assetDirPath, diskName)
		if err = filelock.WriteFile(writePath, enc); err != nil {
			return "", err
		}
		return diskName, nil
	}

	// 普通 box：生成带 ID 的文件名，明文写入
	diskName = util.AssetName(originalName, ast.NewNodeID())
	writePath := filepath.Join(assetDirPath, diskName)
	if err = filelock.WriteFile(writePath, data); err != nil {
		return "", err
	}
	return diskName, nil
}

// encryptedAssetName 生成加密笔记本专用的无语义资源文件名：uuid-blockID.ext。
// 原始语义文件名（如"合同.pdf"）通过 writeAssetNameMapping 存入加密映射，磁盘上只保留随机名。
func encryptedAssetName(ext, blockID string) string {
	return gulu.Rand.String(16) + "-" + blockID + ext
}

// assetNameMappingPath 返回加密笔记本资源名映射文件路径 <boxID>/assets/.names.json。
func assetNameMappingPath(boxID string) string {
	return filepath.Join(util.DataDir, boxID, "assets", ".names.json")
}

// assetNameMappingLocks 按 boxID 分组的互斥锁，保护 .names.json read-modify-write 的并发安全
var assetNameMappingLocks sync.Map // map[string]*sync.Mutex

// writeAssetNameMapping 把"磁盘文件名 -> 原始文件名"映射写入加密笔记本的 .names.json（DEK 加密落盘）。
// 返回错误时调用方不得继续写 asset 密文，避免产出"孤儿密文 asset 无映射"（详见设计文档 §7）。
func writeAssetNameMapping(boxID, diskName, originalName string) error {
	if boxID == "" || !IsEncryptedBox(boxID) {
		return nil
	}
	HoldBoxReadLock(boxID)
	defer ReleaseBoxReadLock(boxID)
	return writeAssetNameMappingLocked(boxID, diskName, originalName)
}

func writeAssetNameMappingLocked(boxID, diskName, originalName string) error {
	muI, _ := assetNameMappingLocks.LoadOrStore(boxID, &sync.Mutex{})
	mu := muI.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	mapping := readAssetNameMappingLocked(boxID)
	mapping[diskName] = originalName
	data, err := json.Marshal(mapping)
	if err != nil {
		return fmt.Errorf("marshal asset name mapping failed: %w", err)
	}
	dek, err := GetDEK(boxID)
	if err != nil || dek == nil {
		return fmt.Errorf("get DEK for asset name mapping failed: %w", err)
	}
	enc, err := EncryptAssetNameMapping(boxID, dek, data)
	if err != nil {
		return fmt.Errorf("encrypt asset name mapping failed: %w", err)
	}
	// 原子写入（temp+rename）：防止半写映射残留，并避免与并发写者竞争同一文件造成 lost update
	if err = atomicWriteFile(assetNameMappingPath(boxID), enc); err != nil {
		return fmt.Errorf("write asset name mapping failed: %w", err)
	}
	return nil
}

func removeAssetNameMapping(boxID, diskName string) error {
	if boxID == "" || !IsEncryptedBox(boxID) {
		return nil
	}
	HoldBoxReadLock(boxID)
	defer ReleaseBoxReadLock(boxID)

	muI, _ := assetNameMappingLocks.LoadOrStore(boxID, &sync.Mutex{})
	mu := muI.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	mapping := readAssetNameMappingLocked(boxID)
	if _, exists := mapping[diskName]; !exists {
		return nil
	}
	delete(mapping, diskName)
	data, err := json.Marshal(mapping)
	if err != nil {
		return fmt.Errorf("marshal asset name mapping failed: %w", err)
	}
	dek, err := GetDEK(boxID)
	if err != nil || dek == nil {
		return fmt.Errorf("get DEK for asset name mapping failed: %w", err)
	}
	enc, err := EncryptAssetNameMapping(boxID, dek, data)
	if err != nil {
		return fmt.Errorf("encrypt asset name mapping failed: %w", err)
	}
	if err = atomicWriteFile(assetNameMappingPath(boxID), enc); err != nil {
		return fmt.Errorf("write asset name mapping failed: %w", err)
	}
	return nil
}

// readAssetNameMapping 读取加密笔记本的资源名映射（DEK 解密）。未解锁或文件不存在时返回空 map。
func readAssetNameMapping(boxID string) map[string]string {
	ret := map[string]string{}
	if boxID == "" || !IsEncryptedBox(boxID) {
		return ret
	}
	HoldBoxReadLock(boxID)
	defer ReleaseBoxReadLock(boxID)
	return readAssetNameMappingLocked(boxID)
}

func readAssetNameMappingLocked(boxID string) map[string]string {
	ret := map[string]string{}
	p := assetNameMappingPath(boxID)
	enc, err := filelock.ReadFile(p)
	if err != nil {
		return ret
	}
	dek, err := GetDEK(boxID)
	if err != nil || dek == nil {
		return ret
	}
	data, err := DecryptAssetNameMapping(boxID, dek, enc)
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

// LookupAssetOriginalName 查询加密笔记本资源的原始文件名（供下载 Content-Disposition 等展示用）。
// 未找到时返回空串。
func LookupAssetOriginalName(boxID, diskName string) string {
	return readAssetNameMapping(boxID)[diskName]
}

// LookupAssetOriginalNameLocked 在调用方已持有 box 读锁时查询原始资源名。
func LookupAssetOriginalNameLocked(boxID, diskName string) string {
	return readAssetNameMappingLocked(boxID)[diskName]
}
