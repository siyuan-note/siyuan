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
	"crypto/rand"
	"fmt"

	"github.com/dop251/goja"
	"github.com/google/uuid"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/plugin/crypto"
)

// randomValuesMaxLength 是 getRandomValues 单次可填充的最大字节数，与浏览器一致。
const randomValuesMaxLength = 65536

// injectCrypto 注入 siyuan.crypto，实现 Web Crypto API 的 Crypto 接口，并以同一对象提供 globalThis.crypto，
// 供按标准全局名访问 Web Crypto 的代码使用。
// 密钥材料只保存在内核侧，插件通过 CryptoKey 句柄引用；运算在事件循环之外执行，
// 结果回到事件循环后再转换为 JS 值。
func injectCrypto(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectCrypto: %v", r)
		}
	}()

	host := lo.Must(newCryptoHost(p, rt))

	cryptoObj := rt.NewObject()

	// siyuan.crypto.getRandomValues(typedArray) -> typedArray
	lo.Must0(cryptoObj.Set("getRandomValues", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		value := call.Argument(0)
		data, err := randomValuesTarget(rt, value)
		if err != nil {
			panic(host.toJsError(rt, err))
		}
		if _, err := rand.Read(data); err != nil {
			panic(host.toJsError(rt, crypto.NewError(crypto.ErrNameOperation,
				"failed to read random bytes: %s", err)))
		}
		return value
	})))

	// siyuan.crypto.randomUUID() -> string
	lo.Must0(cryptoObj.Set("randomUUID", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return rt.ToValue(uuid.NewString())
	})))

	subtle := lo.Must(host.newSubtleObject(rt))
	lo.Must0(cryptoObj.Set("subtle", subtle))

	lo.Must0(ObjectFreeze(rt, cryptoObj))
	lo.Must0(siyuan.Set("crypto", cryptoObj))
	lo.Must0(rt.GlobalObject().Set("crypto", cryptoObj))
	return
}

// randomValuesTarget 校验 getRandomValues 的参数并返回可写入的字节视图。
// 规范只接受整数类型的 TypedArray，浮点数组与 DataView 返回 TypeMismatchError。
func randomValuesTarget(rt *goja.Runtime, value goja.Value) ([]byte, error) {
	if !isJsValueNotNull(value) {
		return nil, crypto.NewError(crypto.ErrNameTypeMismatch, "getRandomValues requires an integer TypedArray")
	}

	switch value.Export().(type) {
	case []int8, []byte, []int16, []uint16, []int32, []uint32, []int64, []uint64:
	default:
		return nil, crypto.NewError(crypto.ErrNameTypeMismatch, "getRandomValues requires an integer TypedArray")
	}

	var data []byte
	if err := rt.ExportTo(value, &data); err != nil {
		return nil, crypto.NewError(crypto.ErrNameTypeMismatch,
			"getRandomValues requires an integer TypedArray: %s", err)
	}
	if len(data) > randomValuesMaxLength {
		return nil, crypto.NewError(crypto.ErrNameQuotaExceeded,
			"getRandomValues supports at most %d bytes, got %d", randomValuesMaxLength, len(data))
	}
	return data, nil
}

// newSubtleObject 构造 siyuan.crypto.subtle。
func (h *cryptoHost) newSubtleObject(rt *goja.Runtime) (*goja.Object, error) {
	subtle := rt.NewObject()

	// subtle.digest(algorithm, data) -> Promise<ArrayBuffer>
	if err := subtle.Set("digest", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "digest", func() (func() (any, error), error) {
			alg, err := h.normalizeAlgorithm(rt, call.Argument(0))
			if err != nil {
				return nil, err
			}
			data, err := h.cryptoBytesOf(rt, call.Argument(1), "data")
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.Digest(alg, data) }, nil
		})
	})); err != nil {
		return nil, err
	}

	// subtle.encrypt(algorithm, key, data) -> Promise<ArrayBuffer>
	if err := subtle.Set("encrypt", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "encrypt", func() (func() (any, error), error) {
			alg, key, data, err := h.cipherArguments(rt, call)
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.Encrypt(alg, key, data) }, nil
		})
	})); err != nil {
		return nil, err
	}

	// subtle.decrypt(algorithm, key, data) -> Promise<ArrayBuffer>
	if err := subtle.Set("decrypt", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "decrypt", func() (func() (any, error), error) {
			alg, key, data, err := h.cipherArguments(rt, call)
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.Decrypt(alg, key, data) }, nil
		})
	})); err != nil {
		return nil, err
	}

	// subtle.sign(algorithm, key, data) -> Promise<ArrayBuffer>
	if err := subtle.Set("sign", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "sign", func() (func() (any, error), error) {
			alg, key, data, err := h.cipherArguments(rt, call)
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.Sign(alg, key, data) }, nil
		})
	})); err != nil {
		return nil, err
	}

	// subtle.verify(algorithm, key, signature, data) -> Promise<boolean>
	if err := subtle.Set("verify", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		return h.run(rt, "verify", func() (func() (any, error), error) {
			alg, err := h.normalizeAlgorithm(rt, call.Argument(0))
			if err != nil {
				return nil, err
			}
			key, err := cryptoKeyOf(rt, call.Argument(1), "key")
			if err != nil {
				return nil, err
			}
			signature, err := h.cryptoBytesOf(rt, call.Argument(2), "signature")
			if err != nil {
				return nil, err
			}
			data, err := h.cryptoBytesOf(rt, call.Argument(3), "data")
			if err != nil {
				return nil, err
			}

			return func() (any, error) { return crypto.Verify(alg, key, signature, data) }, nil
		})
	})); err != nil {
		return nil, err
	}

	if err := h.setKeyMethods(rt, subtle); err != nil {
		return nil, err
	}

	if err := ObjectFreeze(rt, subtle); err != nil {
		return nil, err
	}
	return subtle, nil
}

// cipherArguments 解析 (algorithm, key, data) 形式的参数。
func (h *cryptoHost) cipherArguments(rt *goja.Runtime, call goja.FunctionCall) (
	alg crypto.Algorithm, key *crypto.Key, data []byte, err error) {
	if alg, err = h.normalizeAlgorithm(rt, call.Argument(0)); err != nil {
		return
	}
	if key, err = cryptoKeyOf(rt, call.Argument(1), "key"); err != nil {
		return
	}
	data, err = h.cryptoBytesOf(rt, call.Argument(2), "data")
	return
}

// run 在事件循环上完成参数规范化，纯 Go 运算放入 goroutine，结果回到事件循环后转换为 JS 值。
func (h *cryptoHost) run(rt *goja.Runtime, name string,
	prepare func() (compute func() (any, error), err error)) goja.Value {
	p := h.plugin
	promise, resolve, reject := rt.NewPromise()

	rejectWith := func(rt *goja.Runtime, err error) {
		if rejectErr := reject(h.toJsError(rt, err)); rejectErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.crypto.subtle.%s reject: %v", p.Name, name, rejectErr)
		}
	}

	// 读取参数时可能调用脚本定义的 getter、valueOf 或迭代器。按 WebIDL 的约定，返回 Promise 的方法
	// 要把其中抛出的异常转为以原值拒绝，而不是同步抛出。Try 只捕获可捕获的 JS 异常，
	// 中断与栈溢出等不可捕获的异常仍会向上传播。
	var compute func() (any, error)
	var err error
	if exception := rt.Try(func() { compute, err = prepare() }); exception != nil {
		err = exception
	}
	if err != nil {
		rejectWith(rt, err)
		return rt.ToValue(promise)
	}

	go func() {
		var result any
		var computeErr error
		defer func() {
			if r := recover(); r != nil {
				computeErr = crypto.NewError(crypto.ErrNameOperation,
					"panic during siyuan.crypto.subtle.%s: %v", name, r)
			}

			runErr := p.worker.Run(func(rt *goja.Runtime) (any, error) {
				if computeErr != nil {
					rejectWith(rt, computeErr)
					return nil, nil
				}

				value, convertErr := h.toJsValue(rt, result)
				if convertErr != nil {
					rejectWith(rt, convertErr)
					return nil, nil
				}
				if resolveErr := resolve(value); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.crypto.subtle.%s resolve: %v", p.Name, name, resolveErr)
				}
				return nil, nil
			}, nil)
			if runErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.crypto.subtle.%s worker run: %v", p.Name, name, runErr)
			}
		}()

		result, computeErr = compute()
	}()

	return rt.ToValue(promise)
}

// toJsValue 将算法层的结果转换为 JS 值：字节切片转 ArrayBuffer，密钥转 CryptoKey。
func (h *cryptoHost) toJsValue(rt *goja.Runtime, result any) (goja.Value, error) {
	switch value := result.(type) {
	case nil:
		return goja.Undefined(), nil
	case []byte:
		return rt.ToValue(rt.NewArrayBuffer(value)), nil
	case bool:
		return rt.ToValue(value), nil
	case *crypto.Key:
		return h.newCryptoKeyObject(rt, value)
	case *crypto.KeyPair:
		return h.newKeyPairValue(rt, value)
	case *crypto.KeyData:
		return h.newKeyDataValue(rt, value)
	default:
		return nil, fmt.Errorf("unsupported crypto result type %T", result)
	}
}

// toJsError 将错误转换为 JS 错误对象：脚本抛出的异常保持原值，参数类型错误用 TypeError，
// 其余沿用 GoError 并把 name 设为 Web Crypto 规范的错误名称。
func (h *cryptoHost) toJsError(rt *goja.Runtime, err error) goja.Value {
	if exception, ok := err.(*goja.Exception); ok {
		return exception.Value()
	}

	cryptoErr, ok := err.(*crypto.Error)
	if !ok {
		return rt.NewGoError(err)
	}
	if cryptoErr.Name == crypto.ErrNameType {
		return rt.NewTypeError(cryptoErr.Message)
	}

	jsError := rt.NewGoError(cryptoErr)
	if setErr := jsError.Set("name", rt.ToValue(cryptoErr.Name)); setErr != nil {
		logging.LogErrorf("[plugin:%s] failed to set crypto error name: %v", h.plugin.Name, setErr)
	}
	return jsError
}
