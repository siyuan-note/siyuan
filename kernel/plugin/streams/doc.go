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

// Package streams 为 goja 运行时原生实现 WHATWG Streams Standard 的默认（非字节流）子集：ReadableStream、
// WritableStream、TransformStream 及其默认 controller/reader/writer，以及 CountQueuingStrategy 与
// ByteLengthQueuingStrategy。不实现字节流相关接口（ReadableByteStreamController、
// ReadableStreamBYOBReader、ReadableStreamBYOBRequest），插件脚本中 getReader({mode: "byob"}) 会报错。
//
// 本包不依赖 kernel/plugin 包，避免循环依赖；Enable 的调用方（kernel/plugin）反过来依赖本包。与仓库里
// Blob/FormData/AbortController 的既有写法一致：实例用 rt.NewDynamicObject 包装 Go 状态，方法与访问器
// 定义在每个 Host 构造时新建的共享原型上，不依赖 goja 的结构体字段名反射映射。
//
// Go 侧可读流桥接见 Host.NewReadableStream：数据源把 start/pull/cancel 实现为普通 Go 函数，返回值按与
// JS 版本相同的方式经由 awaitResult 处理。跨线程调度（开 goroutine 读取、通过事件循环的 RunOnLoop 回到
// VM 线程）由调用方完成，本包提供已在 VM 线程内可以安全调用的操作。可写流与转换流由插件脚本构造。
//
// # 参考
//
// 实现参考 WHATWG Streams Standard（https://streams.spec.whatwg.org/）的算法步骤，但不是逐字移植：
// 本包是独立编写的 Go 实现，仅在算法顺序上贴合规范，用以避免 Promise 同步 settle 时的重入隐患（规范算法
// 本身就是按"先更新内部状态、再触发回调"的顺序写的）。
package streams
