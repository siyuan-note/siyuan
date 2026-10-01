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

// KeyType 对应 CryptoKey.type。
type KeyType string

const (
	KeyTypeSecret  KeyType = "secret"
	KeyTypePublic  KeyType = "public"
	KeyTypePrivate KeyType = "private"
)

// KeyUsage 对应 CryptoKey.usages 中的取值。
type KeyUsage string

const (
	UsageEncrypt    KeyUsage = "encrypt"
	UsageDecrypt    KeyUsage = "decrypt"
	UsageSign       KeyUsage = "sign"
	UsageVerify     KeyUsage = "verify"
	UsageDeriveKey  KeyUsage = "deriveKey"
	UsageDeriveBits KeyUsage = "deriveBits"
	UsageWrapKey    KeyUsage = "wrapKey"
	UsageUnwrapKey  KeyUsage = "unwrapKey"
)

// KeyUsages 是 KeyUsage 的全部合法取值，绑定层据此校验传入的用法字符串。
var KeyUsages = []KeyUsage{
	UsageEncrypt, UsageDecrypt, UsageSign, UsageVerify,
	UsageDeriveKey, UsageDeriveBits, UsageWrapKey, UsageUnwrapKey,
}

// KeyFormat 对应 importKey/exportKey 的 format 参数。
type KeyFormat string

const (
	FormatRaw   KeyFormat = "raw"
	FormatPKCS8 KeyFormat = "pkcs8"
	FormatSPKI  KeyFormat = "spki"
	FormatJWK   KeyFormat = "jwk"
)

// KeyFormats 是 KeyFormat 的全部合法取值。
var KeyFormats = []KeyFormat{FormatRaw, FormatPKCS8, FormatSPKI, FormatJWK}

// KeyAlgorithm 是 CryptoKey.algorithm 的内容，仅包含对应算法实际具备的成员。
type KeyAlgorithm struct {
	Name   string // 规范化后的算法名称
	Hash   string // 摘要算法名称，绑定层展开为 {name} 对象
	Length *int   // AES/HMAC 的密钥位长

	ModulusLength  *int   // RSA 密钥的模数位长
	PublicExponent []byte // RSA 密钥的公开指数，绑定层转换为 Uint8Array
	NamedCurve     string // ECDSA/ECDH 的曲线名称
}

// Key 是 CryptoKey 的算法层表示，密钥材料只保存在该结构中。
type Key struct {
	Type        KeyType
	Extractable bool
	Usages      []KeyUsage
	Algorithm   KeyAlgorithm

	secret  []byte // 对称密钥与 KDF 的原始密钥材料
	private any    // *rsa.PrivateKey、*ecdsa.PrivateKey、*ecdh.PrivateKey、ed25519.PrivateKey
	public  any    // *rsa.PublicKey、*ecdsa.PublicKey、*ecdh.PublicKey、ed25519.PublicKey
}

// HasUsage 判断密钥是否声明了某种用法。
func (k *Key) HasUsage(usage KeyUsage) bool {
	return containsUsage(k.Usages, usage)
}

// KeyPair 是 generateKey 的结果：对称算法只填充 Secret，非对称算法填充公私钥。
type KeyPair struct {
	Secret     *Key
	PublicKey  *Key
	PrivateKey *Key
}

// KeyData 是 importKey/exportKey 交换的密钥数据：raw/spki/pkcs8 使用 Raw，jwk 使用 JSON。
type KeyData struct {
	Raw  []byte
	JSON []byte
}

func containsUsage(usages []KeyUsage, usage KeyUsage) bool {
	for _, cur := range usages {
		if cur == usage {
			return true
		}
	}
	return false
}

// cloneUsages 复制用法列表，避免调用方持有的切片被后续修改影响。
func cloneUsages(usages []KeyUsage) []KeyUsage {
	if usages == nil {
		return []KeyUsage{}
	}
	ret := make([]KeyUsage, len(usages))
	copy(ret, usages)
	return ret
}

// filterUsages 返回 usages 中被 allowed 允许的部分，用于生成密钥对时区分公私钥用法。
func filterUsages(usages []KeyUsage, allowed ...KeyUsage) []KeyUsage {
	ret := make([]KeyUsage, 0, len(usages))
	for _, usage := range usages {
		if containsUsage(allowed, usage) {
			ret = append(ret, usage)
		}
	}
	return ret
}

func intPtr(value int) *int {
	return &value
}
