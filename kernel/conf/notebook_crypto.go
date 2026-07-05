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

package conf

import "github.com/siyuan-note/siyuan/kernel/util"

// NotebookCrypto 维护加密笔记本的全局密钥管理参数，随 conf.json 持久化。
// MasterSalt 与 KEKVerifier 设计为可明文存储：salt 不保密，verifier 本身是密文（用 KEK 加密的固定魔数）。
type NotebookCrypto struct {
	Enabled       bool              `json:"enabled"`       // 是否已启用加密笔记本功能
	MasterSalt    []byte            `json:"masterSalt"`    // 主密码 Argon2id 派生的 salt，全局唯一
	KDFParams     util.Argon2Params `json:"kdfParams"`     // Argon2id 参数，落盘以便跨平台一致派生
	KEKVerifier   []byte            `json:"kekVerifier"`   // 用 KEK 经 AES-GCM 加密的固定魔数，用于离线校验主密码
	VerifierNonce []byte            `json:"verifierNonce"` // verifier 的 GCM nonce（Encrypt 返回值的前 12 字节）
}

// NewNotebookCrypto 创建带默认 Argon2id 参数的 NotebookCrypto。
func NewNotebookCrypto() *NotebookCrypto {
	return &NotebookCrypto{
		KDFParams: util.DefaultArgon2Params(),
	}
}
