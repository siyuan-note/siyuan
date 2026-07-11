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
	VerifierNonce []byte            `json:"verifierNonce"` // verifier 的 GCM nonce（从加密信封中提取）

	// 备份完整性字段（Spec>=1）
	// Spec 表示备份规范版本。Generation 单调递增。Checksum 防损坏。KEKMAC 需主密码验证。
	Spec       int    `json:"spec,omitempty"`       // 备份规范版本（见 CurrentNotebookCryptoSpec）
	BackupID   string `json:"backupID,omitempty"`   // 备份唯一标识（UUID）
	Generation uint64 `json:"generation,omitempty"` // 单调递增世代
	CreatedAt  int64  `json:"createdAt,omitempty"`  // 备份创建/更新时间（unix 秒）
	Checksum   string `json:"checksum,omitempty"`   // SHA-256 校验和
	KEKMAC     []byte `json:"kekMAC,omitempty"`     // KEK HMAC-SHA256（需主密码验证）
}

// NewNotebookCrypto 创建带默认 Argon2id 参数的 NotebookCrypto。
func NewNotebookCrypto() *NotebookCrypto {
	return &NotebookCrypto{
		KDFParams: util.DefaultArgon2Params(),
	}
}

// CurrentNotebookCryptoSpec 是当前备份规范版本号。
const CurrentNotebookCryptoSpec = 1

// UpgradeSpec 按需升级 NotebookCrypto 备份规范。
// 旧格式（Spec=0）升级为 Spec=1，补充校验和相关字段。
func UpgradeSpec(nc *NotebookCrypto) (upgraded bool) {
	if CurrentNotebookCryptoSpec <= nc.Spec {
		return
	}
	// spec0 → spec1：无版本/校验/世代的旧备份升级
	if nc.Spec < 1 {
		nc.Spec = 1
		upgraded = true
	}
	return
}
