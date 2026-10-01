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

package crypto

import "strings"

// 受支持的算法名称，取值与 Web Crypto 规范一致。
const (
	AlgSHA1   = "SHA-1"
	AlgSHA256 = "SHA-256"
	AlgSHA384 = "SHA-384"
	AlgSHA512 = "SHA-512"

	AlgAESCBC = "AES-CBC"
	AlgAESCTR = "AES-CTR"
	AlgAESGCM = "AES-GCM"
	AlgHMAC   = "HMAC"

	AlgHKDF   = "HKDF"
	AlgPBKDF2 = "PBKDF2"
)

// algorithmNames 以小写名称映射到规范化名称，用于大小写不敏感的算法查找。
var algorithmNames = func() map[string]string {
	names := []string{
		AlgSHA1, AlgSHA256, AlgSHA384, AlgSHA512,
		AlgAESCBC, AlgAESCTR, AlgAESGCM, AlgHMAC,
		AlgHKDF, AlgPBKDF2,
	}
	ret := make(map[string]string, len(names))
	for _, name := range names {
		ret[strings.ToLower(name)] = name
	}
	return ret
}()

// canonicalName 将算法名称规范化，未知名称返回 NotSupportedError。
func canonicalName(name string) (string, error) {
	canonical, ok := algorithmNames[strings.ToLower(strings.TrimSpace(name))]
	if !ok {
		return "", notSupportedError("%s is not a supported algorithm", name)
	}
	return canonical, nil
}

// Algorithm 是规范化后的算法参数，绑定层负责从 JS 值解析并填充。
// 各成员的含义取决于算法与操作，缺省的可选成员保持零值或 nil。
type Algorithm struct {
	Name string // 规范化后的算法名称
	Hash string // hash 成员，取值为摘要算法名称

	IV      []byte // AES-CBC/AES-GCM 的初始向量
	Counter []byte // AES-CTR 的初始计数器块
	AAD     []byte // AES-GCM 的附加认证数据

	Salt []byte // HKDF/PBKDF2 的盐
	Info []byte // HKDF 的上下文信息

	Length     *int // AES/HMAC 的密钥位长，AES-CTR 中为计数器位长
	TagLength  *int // AES-GCM 的认证标签位长
	Iterations *int // PBKDF2 的迭代次数
}

// usageTable 描述每个算法允许的用法，按密钥类型区分。
var usageTable = map[string]map[KeyType][]KeyUsage{
	AlgAESCBC: {KeyTypeSecret: {UsageEncrypt, UsageDecrypt, UsageWrapKey, UsageUnwrapKey}},
	AlgAESCTR: {KeyTypeSecret: {UsageEncrypt, UsageDecrypt, UsageWrapKey, UsageUnwrapKey}},
	AlgAESGCM: {KeyTypeSecret: {UsageEncrypt, UsageDecrypt, UsageWrapKey, UsageUnwrapKey}},
	AlgHMAC:   {KeyTypeSecret: {UsageSign, UsageVerify}},

	AlgHKDF:   {KeyTypeSecret: {UsageDeriveBits, UsageDeriveKey}},
	AlgPBKDF2: {KeyTypeSecret: {UsageDeriveBits, UsageDeriveKey}},
}

// checkUsages 校验用法列表是否被算法与密钥类型允许，并要求对称密钥与私钥至少声明一种用法。
func checkUsages(algName string, keyType KeyType, usages []KeyUsage) error {
	byKeyType, ok := usageTable[algName]
	if !ok {
		return notSupportedError("%s does not support key operations", algName)
	}

	allowed, ok := byKeyType[keyType]
	if !ok {
		return syntaxError("%s does not support %s keys", algName, keyType)
	}

	for _, usage := range usages {
		if !containsUsage(allowed, usage) {
			return syntaxError("%s %s keys cannot be used for %s", algName, keyType, usage)
		}
	}

	if keyType != KeyTypePublic && len(usages) == 0 {
		return syntaxError("%s keys require at least one key usage", algName)
	}
	return nil
}

// checkOperation 校验密钥是否允许执行某个操作。
func checkOperation(key *Key, algName string, usage KeyUsage) error {
	if key == nil {
		return typeError("key is required")
	}
	if key.Algorithm.Name != algName {
		return invalidAccessError("key algorithm %s does not match %s", key.Algorithm.Name, algName)
	}
	if !key.HasUsage(usage) {
		return invalidAccessError("key does not allow %s", usage)
	}
	return nil
}
