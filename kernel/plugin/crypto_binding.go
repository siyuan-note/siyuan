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
	"bytes"
	"fmt"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/siyuan/kernel/plugin/crypto"
)

// cryptoHost 保存注入时捕获的运行时内建对象与 CryptoKey 原型，
// 避免插件脚本事后改写 ArrayBuffer.isView 等内建函数影响参数校验。
type cryptoHost struct {
	plugin *KernelPlugin

	isView       goja.Callable // ArrayBuffer.isView
	jsonParse    goja.Callable // JSON.parse
	jsonValue    goja.Value    // JSON，作为 parse 的 this
	keyPrototype *goja.Object  // CryptoKey.prototype
}

// cryptoKey 是 CryptoKey 的宿主对象实现：属性由原型上的只读访问器提供，
// 自身不暴露任何属性，因此 Object.keys() 与 JSON.stringify() 的结果与浏览器一致。
type cryptoKey struct {
	key       *crypto.Key
	algorithm *goja.Object // 创建时构造并冻结，每次读取返回同一对象
	usages    *goja.Object
}

func (o *cryptoKey) Get(string) goja.Value       { return nil }
func (o *cryptoKey) Set(string, goja.Value) bool { return false }
func (o *cryptoKey) Has(string) bool             { return false }
func (o *cryptoKey) Delete(string) bool          { return false }
func (o *cryptoKey) Keys() []string              { return nil }

// newCryptoHost 捕获运行时内建对象并构造 CryptoKey 原型。
func newCryptoHost(p *KernelPlugin, rt *goja.Runtime) (host *cryptoHost, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("newCryptoHost: %v", r)
		}
	}()

	host = &cryptoHost{plugin: p}

	arrayBuffer := rt.GlobalObject().Get("ArrayBuffer")
	if arrayBuffer == nil {
		return nil, fmt.Errorf("globalThis.ArrayBuffer is not available")
	}
	arrayBufferObj := arrayBuffer.ToObject(rt)
	if arrayBufferObj == nil {
		return nil, fmt.Errorf("globalThis.ArrayBuffer is not an object")
	}
	isView, ok := goja.AssertFunction(arrayBufferObj.Get("isView"))
	if !ok {
		return nil, fmt.Errorf("globalThis.ArrayBuffer.isView is not a function")
	}
	host.isView = isView

	jsonValue := rt.GlobalObject().Get("JSON")
	if jsonValue == nil {
		return nil, fmt.Errorf("globalThis.JSON is not available")
	}
	jsonObj := jsonValue.ToObject(rt)
	if jsonObj == nil {
		return nil, fmt.Errorf("globalThis.JSON is not an object")
	}
	jsonParse, ok := goja.AssertFunction(jsonObj.Get("parse"))
	if !ok {
		return nil, fmt.Errorf("globalThis.JSON.parse is not a function")
	}
	host.jsonValue = jsonValue
	host.jsonParse = jsonParse

	host.keyPrototype = lo.Must(newCryptoKeyPrototype(rt))
	return host, nil
}

// newCryptoKeyPrototype 构造 CryptoKey.prototype，其上的访问器从宿主对象读取属性。
func newCryptoKeyPrototype(rt *goja.Runtime) (*goja.Object, error) {
	prototype := rt.NewObject()

	accessor := func(name string, read func(host *cryptoKey) goja.Value) error {
		getter := rt.ToValue(func(call goja.FunctionCall) goja.Value {
			this := call.This.ToObject(rt)
			if this == nil {
				panic(rt.NewTypeError("CryptoKey.%s called on a non-object", name))
			}
			host, ok := this.Export().(*cryptoKey)
			if !ok {
				panic(rt.NewTypeError("CryptoKey.%s called on an object that is not a CryptoKey", name))
			}
			return read(host)
		})
		return prototype.DefineAccessorProperty(name, getter, nil, goja.FLAG_TRUE, goja.FLAG_TRUE)
	}

	if err := accessor("type", func(host *cryptoKey) goja.Value {
		return rt.ToValue(string(host.key.Type))
	}); err != nil {
		return nil, err
	}
	if err := accessor("extractable", func(host *cryptoKey) goja.Value {
		return rt.ToValue(host.key.Extractable)
	}); err != nil {
		return nil, err
	}
	if err := accessor("algorithm", func(host *cryptoKey) goja.Value {
		return host.algorithm
	}); err != nil {
		return nil, err
	}
	if err := accessor("usages", func(host *cryptoKey) goja.Value {
		return host.usages
	}); err != nil {
		return nil, err
	}

	// Symbol.toStringTag 让 Object.prototype.toString.call(key) 返回 [object CryptoKey]。
	if err := prototype.DefineDataPropertySymbol(goja.SymToStringTag, rt.ToValue("CryptoKey"),
		goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE); err != nil {
		return nil, err
	}
	return prototype, nil
}

// newCryptoKeyObject 将算法层的密钥包装为 JS 的 CryptoKey 对象。
func (h *cryptoHost) newCryptoKeyObject(rt *goja.Runtime, key *crypto.Key) (*goja.Object, error) {
	algorithm := rt.NewObject()
	if err := algorithm.Set("name", rt.ToValue(key.Algorithm.Name)); err != nil {
		return nil, err
	}
	if key.Algorithm.Length != nil {
		if err := algorithm.Set("length", rt.ToValue(*key.Algorithm.Length)); err != nil {
			return nil, err
		}
	}
	if key.Algorithm.Hash != "" {
		hash := rt.NewObject()
		if err := hash.Set("name", rt.ToValue(key.Algorithm.Hash)); err != nil {
			return nil, err
		}
		if err := ObjectFreeze(rt, hash); err != nil {
			return nil, err
		}
		if err := algorithm.Set("hash", hash); err != nil {
			return nil, err
		}
	}
	if err := ObjectFreeze(rt, algorithm); err != nil {
		return nil, err
	}

	usages := rt.NewArray()
	for i, usage := range key.Usages {
		if err := usages.Set(fmt.Sprint(i), rt.ToValue(string(usage))); err != nil {
			return nil, err
		}
	}
	if err := ObjectFreeze(rt, usages); err != nil {
		return nil, err
	}

	object := rt.NewDynamicObject(&cryptoKey{key: key, algorithm: algorithm, usages: usages})
	if err := object.SetPrototype(h.keyPrototype); err != nil {
		return nil, err
	}
	return object, nil
}

// cryptoKeyOf 从 JS 值中取出算法层密钥，只接受由内核创建的 CryptoKey 对象。
func cryptoKeyOf(rt *goja.Runtime, value goja.Value, name string) (*crypto.Key, error) {
	if !isJsValueNotNull(value) {
		return nil, crypto.NewError(crypto.ErrNameType, "%s must be a CryptoKey", name)
	}
	object := value.ToObject(rt)
	if object == nil {
		return nil, crypto.NewError(crypto.ErrNameType, "%s must be a CryptoKey", name)
	}
	host, ok := object.Export().(*cryptoKey)
	if !ok {
		return nil, crypto.NewError(crypto.ErrNameType, "%s must be a CryptoKey", name)
	}
	return host.key, nil
}

// cryptoBytesOf 读取 BufferSource 参数并复制其内容，异步运算不能直接引用 JS 引擎内存。
func (h *cryptoHost) cryptoBytesOf(rt *goja.Runtime, value goja.Value, name string) ([]byte, error) {
	view, err := h.isBufferSource(rt, value)
	if err != nil {
		return nil, err
	}
	if !view {
		return nil, crypto.NewError(crypto.ErrNameType,
			"%s must be an ArrayBuffer, a TypedArray or a DataView", name)
	}

	var data []byte
	if exportErr := rt.ExportTo(value, &data); exportErr != nil {
		return nil, crypto.NewError(crypto.ErrNameType, "%s could not be read as bytes: %s", name, exportErr)
	}
	return bytes.Clone(data), nil
}

// isBufferSource 判断值是 ArrayBuffer 还是 ArrayBuffer 视图。
func (h *cryptoHost) isBufferSource(rt *goja.Runtime, value goja.Value) (bool, error) {
	if !isJsValueNotNull(value) {
		return false, nil
	}
	if _, ok := value.Export().(goja.ArrayBuffer); ok {
		return true, nil
	}

	result, err := h.isView(goja.Undefined(), value)
	if err != nil {
		return false, err
	}
	return result.ToBoolean(), nil
}
