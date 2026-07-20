// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// 本文件为加密笔记本的 AV 定义提供笔记本级存储与 DEK 加解密支持。
// 与 filesys/crypto_hook.go 同模式：av 包不直接 import model（避免循环依赖），
// 由 model 层在 init 时注入回调函数。

package av

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vmihailenco/msgpack/v5"
)

// AVDEKProvider 由 model 层注入，返回已解锁加密笔记本的 DEK。
// 返回 (nil, nil) 表示该 box 非加密或未解锁——此时 AV 定义明文存储，对普通笔记本透明。
var AVDEKProvider func(boxID string) ([]byte, error)

// AVLockAcquire / AVLockRelease 由 model 层注入，在获取 DEK 前后持 box 读锁，
// 防止 LockBox 在 AV 加解密期间清除缓存。非加密 box 的注入为空时不影响行为。
var AVLockAcquire func(boxID string)
var AVLockRelease func(boxID string)

// AVEncryptedBoxIDs 由 model 层注入，返回所有已打开的加密 boxID 列表。
// 供 AV 路径 fallback 时遍历查找。
var AVEncryptedBoxIDs func() []string

// AVIsEncryptedBox 由 model 层注入，判断 boxID 是否为加密笔记本。
var AVIsEncryptedBox func(boxID string) bool

// AVGetBlockBoxID 由 model 层注入，返回 blockID 所在的 boxID（查 blocktree）。
// 用于镜像写入时校验源块与 AV 定义是否处于同一加密边界。
var AVGetBlockBoxID func(blockID string) string

// pendingAVBox 记录首次创建的 AV 归属哪个加密 box。
// handler 层创建 AV 前调 SetAVBoxID(avID, boxID)，SaveAttributeView 时
// findAttributeViewPath 会先查 pending 映射，找到则写入对应加密笔记本路径。
var pendingAVBox = map[string]string{}
var pendingAVBoxLock = sync.RWMutex{}

// SetAVBoxID 预设 AV 定义的归属 box。加密笔记本创建 AV 时调用，boxID 为空时清理映射。
// 普通笔记本不需要调（AV 默认走全局路径）。
func SetAVBoxID(avID, boxID string) {
	pendingAVBoxLock.Lock()
	defer pendingAVBoxLock.Unlock()
	if boxID != "" {
		pendingAVBox[avID] = boxID
	} else {
		delete(pendingAVBox, avID)
	}
}

// GetAVBoxID 查询 AV 定义的归属 box（供 handler 层判断）。
func GetAVBoxID(avID string) string {
	pendingAVBoxLock.RLock()
	defer pendingAVBoxLock.RUnlock()
	return pendingAVBox[avID]
}

// attributeViewDataPathByBox 返回指定 box 的 AV 定义路径。
// 加密 box：<DataDir>/<boxID>/storage/av/<avID>.json
// 普通 box（boxID 为空）：<DataDir>/storage/av/<avID>.json
func attributeViewDataPathByBox(avID, boxID string) string {
	if !ast.IsNodeIDPattern(avID) || (boxID != "" && !ast.IsNodeIDPattern(boxID)) {
		return ""
	}

	if boxID != "" {
		return filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json")
	}
	return filepath.Join(util.DataDir, "storage", "av", avID+".json")
}

// FindAttributeViewPath 按 fallback 逻辑查找 AV 定义文件的实际路径。
// 1. 先查 pendingAVBox（首次创建预设的 boxID），不检查文件是否存在（首次创建场景）
// 2. 查全局 storage/av/（普通 box）
// 3. 遍历已打开的加密笔记本查找
// 返回找到的路径和对应的 boxID（普通 box 返回空 boxID）。找不到返回空串。
func FindAttributeViewPath(avID string) (path string, boxID string) {
	if !ast.IsNodeIDPattern(avID) {
		return
	}

	// 先查 pendingAVBox（首次创建场景），不要求文件存在
	if pendingBoxID := GetAVBoxID(avID); pendingBoxID != "" {
		encPath := attributeViewDataPathByBox(avID, pendingBoxID)
		// pending 存在就直接返回该 box 路径（首次创建时文件尚不存在）
		return encPath, pendingBoxID
	}
	// 查全局
	globalPath := attributeViewDataPathByBox(avID, "")
	if filelock.IsExist(globalPath) {
		return globalPath, ""
	}
	// 遍历已打开的加密笔记本查找
	if AVEncryptedBoxIDs != nil {
		for _, encBoxID := range AVEncryptedBoxIDs() {
			encPath := attributeViewDataPathByBox(avID, encBoxID)
			if filelock.IsExist(encPath) {
				return encPath, encBoxID
			}
		}
	}
	return "", ""
}

// FindAttributeViewPathInBox 只在指定 box 内查找 AV 定义，避免加密上下文落回全局路径。
func FindAttributeViewPathInBox(avID, boxID string) (path string, retBoxID string) {
	if !ast.IsNodeIDPattern(avID) || (boxID != "" && !ast.IsNodeIDPattern(boxID)) {
		return
	}

	if pendingBoxID := GetAVBoxID(avID); pendingBoxID != "" {
		if pendingBoxID == boxID {
			// pending 匹配目标 box，直接返回（首次创建时文件尚不存在）
			return attributeViewDataPathByBox(avID, pendingBoxID), pendingBoxID
		}
		// pending 映射属于其他 box，不遮蔽本 box 的文件查找，继续检查磁盘
	}
	avPath := attributeViewDataPathByBox(avID, boxID)
	if filelock.IsExist(avPath) {
		return avPath, boxID
	}
	return "", boxID
}

// readAttributeViewData 按 fallback 逻辑读取 AV 定义数据（自动解密）。
func readAttributeViewData(avID string) ([]byte, error) {
	path, boxID := FindAttributeViewPath(avID)
	if path == "" {
		return nil, nil // 文件不存在，由调用方处理
	}
	data, err := filelock.ReadFile(path)
	if err != nil {
		return nil, err
	}
	// 加密笔记本的数据需解密
	if boxID != "" {
		data, err = decryptAVData(boxID, avID, data)
		if err != nil {
			return nil, err
		}
	}
	return data, nil
}

// ReadAttributeViewData 是 readAttributeViewData 的导出版本，供 model.export 等外部包
// 读取 AV 定义明文（含加密笔记本的笔记本级 AV 自动解密）。
func ReadAttributeViewData(avID string) ([]byte, error) {
	return readAttributeViewData(avID)
}

// ReadAttributeViewDataInBox 只读取指定 box 内的 AV 定义明文。
func ReadAttributeViewDataInBox(avID, boxID string) ([]byte, error) {
	path, retBoxID := FindAttributeViewPathInBox(avID, boxID)
	if path == "" {
		return nil, nil
	}
	data, err := filelock.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if retBoxID != "" {
		data, err = decryptAVData(retBoxID, avID, data)
		if err != nil {
			return nil, err
		}
	}
	return data, nil
}

// writeAttributeViewData 写入 AV 定义数据（自动加密）。
// boxID 为空时写全局路径（普通 box），非空时写加密笔记本路径并加密。
func writeAttributeViewData(avID, boxID string, data []byte) error {
	if !ast.IsNodeIDPattern(avID) {
		return ErrInvalidAttributeViewID
	}
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return ErrInvalidBoxID
	}

	path := attributeViewDataPathByBox(avID, boxID)
	// 确保目录存在
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	// 加密笔记本的数据需加密
	if boxID != "" {
		var err error
		data, err = encryptAVData(boxID, avID, data)
		if err != nil {
			return err
		}
	}
	return filelock.WriteFile(path, data)
}

// mirrorBlocksPath 返回镜像索引文件的路径。
// 加密 box：<DataDir>/<boxID>/storage/av/blocks.msgpack
// 普通 box：<DataDir>/storage/av/blocks.msgpack
func mirrorBlocksPath(boxID string) string {
	if boxID != "" {
		return filepath.Join(util.DataDir, boxID, "storage", "av", "blocks.msgpack")
	}
	return filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
}

// mirrorBlocksPathByAvID 通过 AV 定义的归属 box 返回镜像索引路径。
// 先查 findAttributeViewPath（含 pendingAVBox fallback），找到则返回对应 box 的镜像路径。
// 找不到则返回全局路径。
func mirrorBlocksPathByAvID(avID string) string {
	_, boxID := FindAttributeViewPath(avID)
	return mirrorBlocksPath(boxID)
}

// readMirrorBlocks 按路径读取镜像索引（boxID 为空读全局，非空读加密 box）。
// 加密笔记本的镜像索引是 DEK 加密的密文，读取后需解密。
func readMirrorBlocks(boxID string) (ret map[string][]string) {
	ret = map[string][]string{}
	p := mirrorBlocksPath(boxID)
	if !filelock.IsExist(p) {
		return
	}
	data, err := filelock.ReadFile(p)
	if err != nil {
		logging.LogErrorf("read attribute view blocks failed: %s", err)
		return
	}
	if boxID != "" {
		// 加密笔记本的镜像索引是密文，解密后再反序列化
		dec, decErr := decryptAVData(boxID, "mirror", data)
		if decErr != nil {
			logging.LogErrorf("decrypt attribute view blocks failed: %s", decErr)
			return
		}
		data = dec
	}
	if err = msgpack.Unmarshal(data, &ret); err != nil {
		logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
		return
	}
	return
}

// writeMirrorBlocks 按路径写入镜像索引。
// 加密笔记本的镜像索引写入前用 DEK 加密。
func writeMirrorBlocks(boxID string, data map[string][]string) error {
	p := mirrorBlocksPath(boxID)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	raw, err := msgpack.Marshal(data)
	if err != nil {
		return err
	}
	if boxID != "" {
		// 加密笔记本的镜像索引写入前加密
		enc, encErr := encryptAVData(boxID, "mirror", raw)
		if encErr != nil {
			return encErr
		}
		raw = enc
	}
	return filelock.WriteFile(p, raw)
}

// 路径形如 <DataDir>/<boxID>/storage/av/<avID>.json → 返回 boxID。
// 全局路径 <DataDir>/storage/av/<avID>.json → 返回空串。
func avBoxIDFromPath(absPath string) string {
	rel, err := filepath.Rel(util.DataDir, absPath)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	parts := strings.SplitN(rel, "/", 2)
	if len(parts) < 2 {
		return ""
	}
	boxID := parts[0]
	// 全局路径的第一段是 "storage"，加密笔记本路径的第一段是 boxID（节点 ID 格式）
	if boxID == "storage" {
		return ""
	}
	return boxID
}

func encryptAVData(boxID, avID string, data []byte) ([]byte, error) {
	if AVDEKProvider == nil {
		return data, nil
	}
	if AVLockAcquire != nil {
		AVLockAcquire(boxID)
		defer AVLockRelease(boxID)
	}
	dek, err := AVDEKProvider(boxID)
	if err != nil {
		return nil, err // 加密但未解锁，拒绝写盘避免明文泄漏
	}
	if dek == nil {
		return data, nil // 非加密 box
	}
	avKey := util.DeriveSubKey(dek, "siyuan/av")
	aad := avAAD(boxID, avID)
	return util.EncryptWithAAD(avKey, data, []byte(aad))
}

func decryptAVData(boxID, avID string, data []byte) ([]byte, error) {
	if AVDEKProvider == nil {
		return data, nil
	}
	if AVLockAcquire != nil {
		AVLockAcquire(boxID)
		defer AVLockRelease(boxID)
	}
	return decryptAVDataLocked(boxID, avID, data)
}

func decryptAVDataLocked(boxID, avID string, data []byte) ([]byte, error) {
	if AVDEKProvider == nil {
		return data, nil
	}
	dek, err := AVDEKProvider(boxID)
	if err != nil {
		return nil, err // 加密但未解锁，拒绝读盘
	}
	if dek == nil {
		return data, nil // 非加密 box
	}
	avKey := util.DeriveSubKey(dek, "siyuan/av")
	aad := avAAD(boxID, avID)
	return util.DecryptWithAAD(avKey, data, []byte(aad))
}

func avAAD(boxID, avID string) string {
	switch avID {
	case "mirror":
		return "siyuan:v1:av-mirror:" + boxID
	case "relation":
		return "siyuan:v1:av-relation:" + boxID
	default:
		return "siyuan:v1:av:" + boxID + ":" + avID
	}
}

// EncryptAVData 是 encryptAVData 的导出版本，供 model 层（导入/复制数据库等）统一加密 AV 定义。
func EncryptAVData(boxID, avID string, data []byte) ([]byte, error) {
	return encryptAVData(boxID, avID, data)
}

// DecryptAVData 是 decryptAVData 的导出版本。
func DecryptAVData(boxID, avID string, data []byte) ([]byte, error) {
	return decryptAVData(boxID, avID, data)
}

// DecryptAVDataLocked 在调用方已持有对应 box 读锁时解密 AV 数据。
func DecryptAVDataLocked(boxID, avID string, data []byte) ([]byte, error) {
	return decryptAVDataLocked(boxID, avID, data)
}
