// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// cookieKeyMinLen 是 Cookie 密钥的最小长度。旧版本生成的密钥为 16 个小写字母和数字，读取到更短的密钥时生成新密钥替换。
const cookieKeyMinLen = 32

func cookieKeyPath() string {
	return filepath.Join(util.HomeDir, ".config", "siyuan", "cookie.key")
}

// loadCookieKey 返回同一主目录下各工作空间共用的 Cookie 密钥。Cookie 不按端口隔离，各工作空间须使用同一密钥才能互相保留会话。
// 密钥文件缺失时恢复工作空间配置中的密钥，读取失败时不改写文件；文件锁保证并发启动的内核生成或替换后得到同一密钥。
func loadCookieKey(confCookieKey string) string {
	keyPath := cookieKeyPath()
	lock := flock.New(keyPath + ".lock")
	if err := lock.Lock(); err != nil {
		logging.LogWarnf("lock cookie key file [%s] failed: %s", keyPath, err)
	} else {
		defer lock.Unlock()
	}

	data, err := os.ReadFile(keyPath)
	if err != nil && !os.IsNotExist(err) {
		logging.LogErrorf("read cookie key file [%s] failed: %s", keyPath, err)
		if cookieKeyMinLen <= len(confCookieKey) {
			return confCookieKey
		}
		return newCookieKey()
	}

	var key, legacyKey string
	if err == nil {
		if key = string(bytes.TrimSpace(data)); cookieKeyMinLen <= len(key) {
			restrictCookieKeyFile(keyPath)
			return key
		}
		logging.LogInfof("replace legacy cookie key [%s]", keyPath)
		legacyKey, key = key, newCookieKey()
	} else if cookieKeyMinLen <= len(confCookieKey) {
		key = confCookieKey
	} else {
		key = newCookieKey()
	}
	if err = gulu.File.WriteFileSafer(keyPath, []byte(key), 0600); err != nil {
		logging.LogErrorf("save cookie key file [%s] failed: %s", keyPath, err)
		if "" != legacyKey {
			// 替换失败时继续使用文件中的密钥，与共用该文件的其他工作空间保持一致
			return legacyKey
		}
	}
	return key
}

func newCookieKey() string {
	key := make([]byte, 32)
	rand.Read(key)
	return base64.RawURLEncoding.EncodeToString(key)
}

// restrictCookieKeyFile 将旧版本以 0644 写入的密钥文件收紧为仅当前用户可读写。Windows 由用户目录的访问控制保护。
func restrictCookieKeyFile(keyPath string) {
	if gulu.OS.IsWindows() {
		return
	}
	info, err := os.Stat(keyPath)
	if err != nil || 0 == info.Mode().Perm()&0077 {
		return
	}
	if err = os.Chmod(keyPath, 0600); err != nil {
		logging.LogWarnf("restrict cookie key file [%s] permission failed: %s", keyPath, err)
	}
}
