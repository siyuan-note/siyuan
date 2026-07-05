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

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vmihailenco/msgpack/v5"
)

// AVDEKProvider 由 model 层注入，返回已解锁加密 box 的 DEK。
// 返回 (nil, nil) 表示该 box 非加密或未解锁——此时 AV 定义明文存储，对普通笔记本透明。
var AVDEKProvider func(boxID string) ([]byte, error)

// AVEncryptedBoxIDs 由 model 层注入，返回所有已打开的加密 boxID 列表。
// 供 AV 路径 fallback 时遍历查找。
var AVEncryptedBoxIDs func() []string

// AVIsEncryptedBox 由 model 层注入，判断 boxID 是否为加密 notebook。
var AVIsEncryptedBox func(boxID string) bool

// pendingAVBox 记录首次创建的 AV 归属哪个加密 box。
// handler 层创建 AV 前调 SetAVBoxID(avID, boxID)，SaveAttributeView 时
// findAttributeViewPath 会先查 pending 映射，找到则写入对应加密 box 路径。
var pendingAVBox = map[string]string{}
var pendingAVBoxLock = sync.RWMutex{}

// SetAVBoxID 预设 AV 定义的归属 box。加密 notebook 创建 AV 时调用。
// 普通笔记本不需要调（AV 默认走全局路径）。
func SetAVBoxID(avID, boxID string) {
	if boxID != "" {
		pendingAVBoxLock.Lock()
		defer pendingAVBoxLock.Unlock()
		pendingAVBox[avID] = boxID
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
	if boxID != "" {
		return filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json")
	}
	return filepath.Join(util.DataDir, "storage", "av", avID+".json")
}

// findAttributeViewPath 按 fallback 逻辑查找 AV 定义文件的实际路径。
// 1. 先查 pendingAVBox（首次创建预设的 boxID）
// 2. 查全局 storage/av/（普通 box）
// 3. 遍历已打开的加密 box 查找
// 返回找到的路径和对应的 boxID（普通 box 返回空 boxID）。找不到返回空串。
func FindAttributeViewPath(avID string) (path string, boxID string) {
	// 先查 pendingAVBox（首次创建场景）
	if pendingBoxID := GetAVBoxID(avID); pendingBoxID != "" {
		encPath := attributeViewDataPathByBox(avID, pendingBoxID)
		return encPath, pendingBoxID
	}
	// 查全局
	globalPath := attributeViewDataPathByBox(avID, "")
	if filelock.IsExist(globalPath) {
		return globalPath, ""
	}
	// 遍历已打开的加密 box
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
	// 加密 box 的数据需解密
	if boxID != "" {
		data, err = decryptAVData(boxID, data)
		if err != nil {
			return nil, err
		}
	}
	return data, nil
}

// writeAttributeViewData 写入 AV 定义数据（自动加密）。
// boxID 为空时写全局路径（普通 box），非空时写加密 box 路径并加密。
func writeAttributeViewData(avID, boxID string, data []byte) error {
	path := attributeViewDataPathByBox(avID, boxID)
	// 确保目录存在
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	// 加密 box 的数据需加密
	if boxID != "" {
		var err error
		data, err = encryptAVData(boxID, data)
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
	if err = msgpack.Unmarshal(data, &ret); err != nil {
		logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
		return
	}
	return
}

// writeMirrorBlocks 按路径写入镜像索引。
func writeMirrorBlocks(boxID string, data map[string][]string) error {
	p := mirrorBlocksPath(boxID)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	raw, err := msgpack.Marshal(data)
	if err != nil {
		return err
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
	// 全局路径的第一段是 "storage"，加密 box 路径的第一段是 boxID（节点 ID 格式）
	if boxID == "storage" {
		return ""
	}
	return boxID
}

func encryptAVData(boxID string, data []byte) ([]byte, error) {
	if AVDEKProvider == nil {
		return data, nil
	}
	dek, err := AVDEKProvider(boxID)
	if err != nil || dek == nil {
		return data, nil
	}
	return util.Encrypt(dek, data)
}

func decryptAVData(boxID string, data []byte) ([]byte, error) {
	if AVDEKProvider == nil {
		return data, nil
	}
	dek, err := AVDEKProvider(boxID)
	if err != nil || dek == nil {
		return data, nil
	}
	return util.Decrypt(dek, data)
}
