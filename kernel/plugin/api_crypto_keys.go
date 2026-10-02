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

package plugin

import (
	"github.com/dop251/goja"
	"github.com/siyuan-note/siyuan/kernel/plugin/crypto"
)

// setKeyMethods 在 subtle 上设置密钥管理相关的方法。
func (h *cryptoHost) setKeyMethods(rt *goja.Runtime, subtle *goja.Object) error {
	// subtle.generateKey(algorithm, extractable, keyUsages) -> Promise<CryptoKey>
	if err := subtle.Set("generateKey", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "generateKey", func() (func() (any, error), error) {
			alg, err := h.normalizeAlgorithm(rt, call.Argument(0))
			if err != nil {
				return nil, err
			}
			extractable := call.Argument(1).ToBoolean()
			usages, err := keyUsagesOf(rt, call.Argument(2))
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.GenerateKey(alg, extractable, usages) }, nil
		})
	})); err != nil {
		return err
	}

	// subtle.importKey(format, keyData, algorithm, extractable, keyUsages) -> Promise<CryptoKey>
	if err := subtle.Set("importKey", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "importKey", func() (func() (any, error), error) {
			format, err := keyFormatOf(call.Argument(0))
			if err != nil {
				return nil, err
			}
			data, err := h.keyDataOf(rt, format, call.Argument(1))
			if err != nil {
				return nil, err
			}
			alg, err := h.normalizeAlgorithm(rt, call.Argument(2))
			if err != nil {
				return nil, err
			}
			extractable := call.Argument(3).ToBoolean()
			usages, err := keyUsagesOf(rt, call.Argument(4))
			if err != nil {
				return nil, err
			}

			return func() (any, error) {
				return crypto.ImportKey(format, data, alg, extractable, usages)
			}, nil
		})
	})); err != nil {
		return err
	}

	// subtle.exportKey(format, key) -> Promise<ArrayBuffer | JsonWebKey>
	if err := subtle.Set("exportKey", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "exportKey", func() (func() (any, error), error) {
			format, err := keyFormatOf(call.Argument(0))
			if err != nil {
				return nil, err
			}
			key, err := cryptoKeyOf(rt, call.Argument(1), "key")
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.ExportKey(format, key) }, nil
		})
	})); err != nil {
		return err
	}

	// subtle.deriveBits(algorithm, baseKey, length) -> Promise<ArrayBuffer>
	if err := subtle.Set("deriveBits", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "deriveBits", func() (func() (any, error), error) {
			alg, err := h.normalizeAlgorithm(rt, call.Argument(0))
			if err != nil {
				return nil, err
			}
			key, err := cryptoKeyOf(rt, call.Argument(1), "baseKey")
			if err != nil {
				return nil, err
			}
			length, err := optionalLengthOf(call.Argument(2))
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.DeriveBits(alg, key, length) }, nil
		})
	})); err != nil {
		return err
	}

	// subtle.deriveKey(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) -> Promise<CryptoKey>
	if err := subtle.Set("deriveKey", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "deriveKey", func() (func() (any, error), error) {
			alg, err := h.normalizeAlgorithm(rt, call.Argument(0))
			if err != nil {
				return nil, err
			}
			key, err := cryptoKeyOf(rt, call.Argument(1), "baseKey")
			if err != nil {
				return nil, err
			}
			derived, err := h.normalizeAlgorithm(rt, call.Argument(2))
			if err != nil {
				return nil, err
			}
			extractable := call.Argument(3).ToBoolean()
			usages, err := keyUsagesOf(rt, call.Argument(4))
			if err != nil {
				return nil, err
			}

			return func() (any, error) {
				return crypto.DeriveKey(alg, key, derived, extractable, usages)
			}, nil
		})
	})); err != nil {
		return err
	}

	// subtle.wrapKey(format, key, wrappingKey, wrapAlgorithm) -> Promise<ArrayBuffer>
	if err := subtle.Set("wrapKey", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "wrapKey", func() (func() (any, error), error) {
			format, err := keyFormatOf(call.Argument(0))
			if err != nil {
				return nil, err
			}
			key, err := cryptoKeyOf(rt, call.Argument(1), "key")
			if err != nil {
				return nil, err
			}
			wrappingKey, err := cryptoKeyOf(rt, call.Argument(2), "wrappingKey")
			if err != nil {
				return nil, err
			}
			alg, err := h.normalizeAlgorithm(rt, call.Argument(3))
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.WrapKey(format, key, wrappingKey, alg) }, nil
		})
	})); err != nil {
		return err
	}

	// subtle.unwrapKey(format, wrappedKey, unwrappingKey, unwrapAlgorithm,
	//                  unwrappedKeyAlgorithm, extractable, keyUsages) -> Promise<CryptoKey>
	if err := subtle.Set("unwrapKey", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "unwrapKey", func() (func() (any, error), error) {
			format, err := keyFormatOf(call.Argument(0))
			if err != nil {
				return nil, err
			}
			wrapped, err := h.cryptoBytesOf(rt, call.Argument(1), "wrappedKey")
			if err != nil {
				return nil, err
			}
			unwrappingKey, err := cryptoKeyOf(rt, call.Argument(2), "unwrappingKey")
			if err != nil {
				return nil, err
			}
			alg, err := h.normalizeAlgorithm(rt, call.Argument(3))
			if err != nil {
				return nil, err
			}
			unwrapped, err := h.normalizeAlgorithm(rt, call.Argument(4))
			if err != nil {
				return nil, err
			}
			extractable := call.Argument(5).ToBoolean()
			usages, err := keyUsagesOf(rt, call.Argument(6))
			if err != nil {
				return nil, err
			}

			return func() (any, error) {
				return crypto.UnwrapKey(format, wrapped, unwrappingKey, alg, unwrapped, extractable, usages)
			}, nil
		})
	})); err != nil {
		return err
	}
	return nil
}

// keyDataOf 读取 importKey 的密钥数据：jwk 格式接受对象，其余格式接受 BufferSource。
func (h *cryptoHost) keyDataOf(rt *goja.Runtime, format crypto.KeyFormat, value goja.Value) (
	data crypto.KeyData, err error) {
	if format == crypto.FormatJWK {
		if !isJsValueNotNull(value) {
			err = crypto.NewError(crypto.ErrNameType, "keyData must be a JsonWebKey object")
			return
		}
		object := value.ToObject(rt)
		if object == nil {
			err = crypto.NewError(crypto.ErrNameType, "keyData must be a JsonWebKey object")
			return
		}

		json, marshalErr := object.MarshalJSON()
		if marshalErr != nil {
			// 序列化失败时返回的是 JS 异常，例如 getter 抛出的异常或循环引用导致的 TypeError，
			// 原样传出，以原值拒绝 Promise。
			err = marshalErr
			return
		}
		data.JSON = json
		return
	}

	data.Raw, err = h.cryptoBytesOf(rt, value, "keyData")
	return
}

// optionalLengthOf 解析 deriveBits 的 length 参数，null 与 undefined 表示未指定。
func optionalLengthOf(value goja.Value) (*int, error) {
	if !isJsValueNotNull(value) {
		return nil, nil
	}

	length, err := integerOf(value, "length")
	if err != nil {
		return nil, err
	}
	return &length, nil
}

// newKeyPairValue 将密钥对转换为 JS 值：对称算法返回 CryptoKey，
// 非对称算法返回含 publicKey 与 privateKey 的 CryptoKeyPair。
func (h *cryptoHost) newKeyPairValue(rt *goja.Runtime, pair *crypto.KeyPair) (goja.Value, error) {
	if pair.Secret != nil {
		return h.newCryptoKeyObject(rt, pair.Secret)
	}
	if pair.PublicKey == nil || pair.PrivateKey == nil {
		return nil, crypto.NewError(crypto.ErrNameOperation, "generateKey produced no key")
	}

	publicKey, err := h.newCryptoKeyObject(rt, pair.PublicKey)
	if err != nil {
		return nil, err
	}
	privateKey, err := h.newCryptoKeyObject(rt, pair.PrivateKey)
	if err != nil {
		return nil, err
	}

	keyPair := rt.NewObject()
	if err = keyPair.Set("publicKey", publicKey); err != nil {
		return nil, err
	}
	if err = keyPair.Set("privateKey", privateKey); err != nil {
		return nil, err
	}
	return keyPair, nil
}

// newKeyDataValue 将导出的密钥数据转换为 JS 值：raw 等格式返回 ArrayBuffer，jwk 返回普通对象。
func (h *cryptoHost) newKeyDataValue(rt *goja.Runtime, data *crypto.KeyData) (goja.Value, error) {
	if data.JSON == nil {
		return rt.ToValue(rt.NewArrayBuffer(data.Raw)), nil
	}

	// 用运行时自身的 JSON.parse 构造对象，保证属性顺序与 JSON 文本一致。
	return h.jsonParse(h.jsonValue, rt.ToValue(string(data.JSON)))
}
