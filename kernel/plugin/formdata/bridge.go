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

package formdata

import "github.com/dop251/goja"

// NewUint8Array 用注册时捕获的 Uint8Array 构造函数把 data 包装为 Uint8Array，不复制 data：新实例的 ArrayBuffer
// 直接以 data 为底层存储。
func (h *Host) NewUint8Array(rt *goja.Runtime, data []byte) (goja.Value, error) {
	return rt.New(h.uint8Array, rt.ToValue(rt.NewArrayBuffer(data)))
}

// NewBlob 用注册时捕获的 Blob 原型构造一个内容为 data 副本的 Blob，其 type 是按 Blob 构造函数的 type 选项
// 规范化后的 contentType（见 normalizeBlobType，不按 MIME 类型解析）。
func (h *Host) NewBlob(rt *goja.Runtime, data []byte, contentType string) *goja.Object {
	return newBlobObject(rt, h.blobPrototype, &blobState{data: cloneBytes(data), typ: normalizeBlobType(contentType)})
}
