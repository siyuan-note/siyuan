// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
