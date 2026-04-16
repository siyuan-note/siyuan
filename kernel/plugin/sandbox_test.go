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

package plugin

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/fastschema/qjs"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestSandboxGlobals(t *testing.T) {
	code := `
		const props = Object.getOwnPropertyNames(globalThis);
		siyuan.logger.debug(JSON.stringify(props));
		props.forEach(prop => {
			if (prop === "null" || prop === "undefined") return;
			siyuan.logger.debug(prop, typeof globalThis[prop]);
			siyuan.logger.debug(JSON.stringify(Object.getOwnPropertyNames(globalThis[prop])))
		});
	`
	petal := &model.Petal{
		Name: "test-sandbox",
		Kernel: &model.KernelPetal{
			JS: code,
		},
	}
	p := NewKernelPlugin(petal)
	err := p.Start()
	// ["Object","Function","Error","EvalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError","InternalError","AggregateError","Iterator","Array","parseInt","parseFloat","isNaN","isFinite","queueMicrotask","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape","Infinity","NaN","undefined","Number","Boolean","String","Math","Reflect","Symbol","eval","globalThis","Date","RegExp","JSON","Proxy","Map","Set","WeakMap","WeakSet","ArrayBuffer","SharedArrayBuffer","Uint8ClampedArray","Int8Array","Uint8Array","Int16Array","Uint16Array","Int32Array","Uint32Array","BigInt64Array","BigUint64Array","Float16Array","Float32Array","Float64Array","DataView","Promise","BigInt","WeakRef","FinalizationRegistry","DOMException","performance","gc","navigator","console","scriptArgs","print","bjson","std","os","setTimeout","setInterval","clearTimeout","clearInterval","QJS_PROXY_VALUE","siyuan"]
	// Object function
	// ["length","name","prototype","create","getPrototypeOf","setPrototypeOf","defineProperty","defineProperties","getOwnPropertyNames","getOwnPropertySymbols","groupBy","keys","values","entries","isExtensible","preventExtensions","getOwnPropertyDescriptor","getOwnPropertyDescriptors","is","assign","seal","freeze","isSealed","isFrozen","fromEntries","hasOwn"]
	// Function function
	// ["length","name","prototype"]
	// Error function
	// ["length","name","prototype","isError","captureStackTrace","stackTraceLimit","prepareStackTrace"]
	// EvalError function
	// ["length","name","prototype"]
	// RangeError function
	// ["length","name","prototype"]
	// ReferenceError function
	// ["length","name","prototype"]
	// SyntaxError function
	// ["length","name","prototype"]
	// TypeError function
	// ["length","name","prototype"]
	// URIError function
	// ["length","name","prototype"]
	// InternalError function
	// ["length","name","prototype"]
	// AggregateError function
	// ["length","name","prototype"]
	// Iterator function
	// ["length","name","prototype","concat","from"]
	// Array function
	// ["length","name","prototype","isArray","from","of","fromAsync"]
	// parseInt function
	// ["length","name"]
	// parseFloat function
	// ["length","name"]
	// isNaN function
	// ["length","name"]
	// isFinite function
	// ["length","name"]
	// queueMicrotask function
	// ["length","name"]
	// decodeURI function
	// ["length","name"]
	// decodeURIComponent function
	// ["length","name"]
	// encodeURI function
	// ["length","name"]
	// encodeURIComponent function
	// ["length","name"]
	// escape function
	// ["length","name"]
	// unescape function
	// ["length","name"]
	// Infinity number
	// []
	// NaN number
	// []
	// Number function
	// ["length","name","prototype","parseInt","parseFloat","isNaN","isFinite","isInteger","isSafeInteger","MAX_VALUE","MIN_VALUE","NaN","NEGATIVE_INFINITY","POSITIVE_INFINITY","EPSILON","MAX_SAFE_INTEGER","MIN_SAFE_INTEGER"]
	// Boolean function
	// ["length","name","prototype"]
	// String function
	// ["length","name","prototype","fromCharCode","fromCodePoint","raw"]
	// Math object
	// ["min","max","abs","floor","ceil","round","sqrt","acos","asin","atan","atan2","cos","exp","log","pow","sin","tan","trunc","sign","cosh","sinh","tanh","acosh","asinh","atanh","expm1","log1p","log2","log10","cbrt","hypot","random","f16round","fround","imul","clz32","sumPrecise","E","LN10","LN2","LOG2E","LOG10E","PI","SQRT1_2","SQRT2"]
	// Reflect object
	// ["apply","construct","defineProperty","deleteProperty","get","getOwnPropertyDescriptor","getPrototypeOf","has","isExtensible","ownKeys","preventExtensions","set","setPrototypeOf"]
	// Symbol function
	// ["length","name","prototype","for","keyFor","toPrimitive","iterator","match","matchAll","replace","search","split","toStringTag","isConcatSpreadable","hasInstance","species","unscopables","asyncIterator"]
	// eval function
	// ["length","name"]
	// globalThis object
	// ["Object","Function","Error","EvalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError","InternalError","AggregateError","Iterator","Array","parseInt","parseFloat","isNaN","isFinite","queueMicrotask","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape","Infinity","NaN","undefined","Number","Boolean","String","Math","Reflect","Symbol","eval","globalThis","Date","RegExp","JSON","Proxy","Map","Set","WeakMap","WeakSet","ArrayBuffer","SharedArrayBuffer","Uint8ClampedArray","Int8Array","Uint8Array","Int16Array","Uint16Array","Int32Array","Uint32Array","BigInt64Array","BigUint64Array","Float16Array","Float32Array","Float64Array","DataView","Promise","BigInt","WeakRef","FinalizationRegistry","DOMException","performance","gc","navigator","console","scriptArgs","print","bjson","std","os","setTimeout","setInterval","clearTimeout","clearInterval","QJS_PROXY_VALUE","siyuan"]
	// Date function
	// ["length","name","prototype","now","parse","UTC"]
	// RegExp function
	// ["length","name","prototype","escape"]
	// JSON object
	// ["parse","stringify"]
	// Proxy function
	// ["length","name","revocable"]
	// Map function
	// ["length","name","groupBy","prototype"]
	// Set function
	// ["length","name","prototype"]
	// WeakMap function
	// ["length","name","prototype"]
	// WeakSet function
	// ["length","name","prototype"]
	// ArrayBuffer function
	// ["length","name","prototype","isView"]
	// SharedArrayBuffer function
	// ["length","name","prototype"]
	// Uint8ClampedArray function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Int8Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Uint8Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Int16Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Uint16Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Int32Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Uint32Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// BigInt64Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// BigUint64Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Float16Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Float32Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Float64Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// DataView function
	// ["length","name","prototype"]
	// Promise function
	// ["length","name","resolve","reject","all","allSettled","any","try","race","withResolvers","prototype"]
	// BigInt function
	// ["length","name","prototype","asUintN","asIntN"]
	// WeakRef function
	// ["length","name","prototype"]
	// FinalizationRegistry function
	// ["length","name","prototype"]
	// DOMException function
	// ["length","name","prototype","INDEX_SIZE_ERR","DOMSTRING_SIZE_ERR","HIERARCHY_REQUEST_ERR","WRONG_DOCUMENT_ERR","INVALID_CHARACTER_ERR","NO_DATA_ALLOWED_ERR","NO_MODIFICATION_ALLOWED_ERR","NOT_FOUND_ERR","NOT_SUPPORTED_ERR","INUSE_ATTRIBUTE_ERR","INVALID_STATE_ERR","SYNTAX_ERR","INVALID_MODIFICATION_ERR","NAMESPACE_ERR","INVALID_ACCESS_ERR","VALIDATION_ERR","TYPE_MISMATCH_ERR","SECURITY_ERR","NETWORK_ERR","ABORT_ERR","URL_MISMATCH_ERR","QUOTA_EXCEEDED_ERR","TIMEOUT_ERR","INVALID_NODE_TYPE_ERR","DATA_CLONE_ERR"]
	// performance object
	// ["now","timeOrigin"]
	// gc function
	// ["length","name"]
	// navigator object
	// []
	// console object
	// ["log"]
	// scriptArgs object
	// ["length"]
	// print function
	// ["length","name"]
	// bjson object
	// ["READ_OBJ_BYTECODE","READ_OBJ_REFERENCE","READ_OBJ_SAB","WRITE_OBJ_BYTECODE","WRITE_OBJ_REFERENCE","WRITE_OBJ_SAB","WRITE_OBJ_STRIP_DEBUG","WRITE_OBJ_STRIP_SOURCE","read","write"]
	// std object
	// ["Error","SEEK_CUR","SEEK_END","SEEK_SET","err","evalScript","exit","fdopen","gc","getenv","getenviron","in","loadFile","loadScript","open","out","printf","puts","setenv","sprintf","strerror","unsetenv","writeFile"]
	// os object
	// ["O_APPEND","O_CREAT","O_EXCL","O_RDONLY","O_RDWR","O_TRUNC","O_WRONLY","SIGABRT","SIGFPE","SIGILL","SIGINT","SIGSEGV","SIGTERM","S_IFBLK","S_IFCHR","S_IFDIR","S_IFIFO","S_IFLNK","S_IFMT","S_IFREG","S_IFSOCK","S_ISGID","S_ISUID","chdir","clearInterval","clearTimeout","close","exePath","getcwd","isatty","mkdir","now","open","platform","read","readdir","remove","rename","seek","setInterval","setReadHandler","setTimeout","setWriteHandler","signal","sleep","sleepAsync","stat","utimes","write"]
	// setTimeout function
	// ["length","name"]
	// setInterval function
	// ["length","name"]
	// clearTimeout function
	// ["length","name"]
	// clearInterval function
	// ["length","name"]
	// QJS_PROXY_VALUE function
	// ["length","name","prototype"]
	// siyuan object
	// ["plugin","logger","storage","fetch","socket","rpc"]
	if err == nil {
		p.Stop()
	}
	// Just verify it doesn't panic - the actual injection is tested via integration
}

func TestSandboxSiyuan(t *testing.T) {
	code := `
		siyuan.logger.debug(JSON.stringify(siyuan.plugin));
	`
	petal := &model.Petal{
		Name: "test-sandbox",
		I18n: map[string]any{
			"test": "测试",
			"deep": map[string]any{
				"nested": "深层嵌套",
			},
		},
		Kernel: &model.KernelPetal{
			JS: code,
		},
	}
	p := NewKernelPlugin(petal)
	err := p.Start()
	// ["length","name","prototype","create","getPrototypeOf","setPrototypeOf","defineProperty","defineProperties","getOwnPropertyNames","getOwnPropertySymbols","groupBy","keys","values","entries","isExtensible","preventExtensions","getOwnPropertyDescriptor","getOwnPropertyDescriptors","is","assign","seal","freeze","isSealed","isFrozen","fromEntries","hasOwn"]
	// Function function
	// ["length","name","prototype"]
	// Error function
	// ["length","name","prototype","isError","captureStackTrace","stackTraceLimit","prepareStackTrace"]
	// EvalError function
	// ["length","name","prototype"]
	// RangeError function
	// ["length","name","prototype"]
	// ReferenceError function
	// ["length","name","prototype"]
	// SyntaxError function
	// ["length","name","prototype"]
	// TypeError function
	// ["length","name","prototype"]
	// URIError function
	// ["length","name","prototype"]
	// InternalError function
	// ["length","name","prototype"]
	// AggregateError function
	// ["length","name","prototype"]
	// Iterator function
	// ["length","name","prototype","concat","from"]
	// Array function
	// ["length","name","prototype","isArray","from","of","fromAsync"]
	// parseInt function
	// ["length","name"]
	// parseFloat function
	// ["length","name"]
	// isNaN function
	// ["length","name"]
	// isFinite function
	// ["length","name"]
	// queueMicrotask function
	// ["length","name"]
	// decodeURI function
	// ["length","name"]
	// decodeURIComponent function
	// ["length","name"]
	// encodeURI function
	// ["length","name"]
	// encodeURIComponent function
	// ["length","name"]
	// escape function
	// ["length","name"]
	// unescape function
	// ["length","name"]
	// Infinity number
	// []
	// NaN number
	// []
	// Number function
	// ["length","name","prototype","parseInt","parseFloat","isNaN","isFinite","isInteger","isSafeInteger","MAX_VALUE","MIN_VALUE","NaN","NEGATIVE_INFINITY","POSITIVE_INFINITY","EPSILON","MAX_SAFE_INTEGER","MIN_SAFE_INTEGER"]
	// Boolean function
	// ["length","name","prototype"]
	// String function
	// ["length","name","prototype","fromCharCode","fromCodePoint","raw"]
	// Math object
	// ["min","max","abs","floor","ceil","round","sqrt","acos","asin","atan","atan2","cos","exp","log","pow","sin","tan","trunc","sign","cosh","sinh","tanh","acosh","asinh","atanh","expm1","log1p","log2","log10","cbrt","hypot","random","f16round","fround","imul","clz32","sumPrecise","E","LN10","LN2","LOG2E","LOG10E","PI","SQRT1_2","SQRT2"]
	// Reflect object
	// ["apply","construct","defineProperty","deleteProperty","get","getOwnPropertyDescriptor","getPrototypeOf","has","isExtensible","ownKeys","preventExtensions","set","setPrototypeOf"]
	// Symbol function
	// ["length","name","prototype","for","keyFor","toPrimitive","iterator","match","matchAll","replace","search","split","toStringTag","isConcatSpreadable","hasInstance","species","unscopables","asyncIterator"]
	// eval function
	// ["length","name"]
	// globalThis object
	// ["Object","Function","Error","EvalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError","InternalError","AggregateError","Iterator","Array","parseInt","parseFloat","isNaN","isFinite","queueMicrotask","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape","Infinity","NaN","undefined","Number","Boolean","String","Math","Reflect","Symbol","eval","globalThis","Date","RegExp","JSON","Proxy","Map","Set","WeakMap","WeakSet","ArrayBuffer","SharedArrayBuffer","Uint8ClampedArray","Int8Array","Uint8Array","Int16Array","Uint16Array","Int32Array","Uint32Array","BigInt64Array","BigUint64Array","Float16Array","Float32Array","Float64Array","DataView","Promise","BigInt","WeakRef","FinalizationRegistry","DOMException","performance","gc","navigator","console","scriptArgs","print","bjson","std","os","setTimeout","setInterval","clearTimeout","clearInterval","QJS_PROXY_VALUE","siyuan"]
	// Date function
	// ["length","name","prototype","now","parse","UTC"]
	// RegExp function
	// ["length","name","prototype","escape"]
	// JSON object
	// ["parse","stringify"]
	// Proxy function
	// ["length","name","revocable"]
	// Map function
	// ["length","name","groupBy","prototype"]
	// Set function
	// ["length","name","prototype"]
	// WeakMap function
	// ["length","name","prototype"]
	// WeakSet function
	// ["length","name","prototype"]
	// ArrayBuffer function
	// ["length","name","prototype","isView"]
	// SharedArrayBuffer function
	// ["length","name","prototype"]
	// Uint8ClampedArray function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Int8Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Uint8Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Int16Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Uint16Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Int32Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Uint32Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// BigInt64Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// BigUint64Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Float16Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Float32Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// Float64Array function
	// ["length","name","prototype","BYTES_PER_ELEMENT"]
	// DataView function
	// ["length","name","prototype"]
	// Promise function
	// ["length","name","resolve","reject","all","allSettled","any","try","race","withResolvers","prototype"]
	// BigInt function
	// ["length","name","prototype","asUintN","asIntN"]
	// WeakRef function
	// ["length","name","prototype"]
	// FinalizationRegistry function
	// ["length","name","prototype"]
	// DOMException function
	// ["length","name","prototype","INDEX_SIZE_ERR","DOMSTRING_SIZE_ERR","HIERARCHY_REQUEST_ERR","WRONG_DOCUMENT_ERR","INVALID_CHARACTER_ERR","NO_DATA_ALLOWED_ERR","NO_MODIFICATION_ALLOWED_ERR","NOT_FOUND_ERR","NOT_SUPPORTED_ERR","INUSE_ATTRIBUTE_ERR","INVALID_STATE_ERR","SYNTAX_ERR","INVALID_MODIFICATION_ERR","NAMESPACE_ERR","INVALID_ACCESS_ERR","VALIDATION_ERR","TYPE_MISMATCH_ERR","SECURITY_ERR","NETWORK_ERR","ABORT_ERR","URL_MISMATCH_ERR","QUOTA_EXCEEDED_ERR","TIMEOUT_ERR","INVALID_NODE_TYPE_ERR","DATA_CLONE_ERR"]
	// performance object
	// ["now","timeOrigin"]
	// gc function
	// ["length","name"]
	// navigator object
	// []
	// console object
	// ["log"]
	// scriptArgs object
	// ["length"]
	// print function
	// ["length","name"]
	// bjson object
	// ["READ_OBJ_BYTECODE","READ_OBJ_REFERENCE","READ_OBJ_SAB","WRITE_OBJ_BYTECODE","WRITE_OBJ_REFERENCE","WRITE_OBJ_SAB","WRITE_OBJ_STRIP_DEBUG","WRITE_OBJ_STRIP_SOURCE","read","write"]
	// std object
	// ["Error","SEEK_CUR","SEEK_END","SEEK_SET","err","evalScript","exit","fdopen","gc","getenv","getenviron","in","loadFile","loadScript","open","out","printf","puts","setenv","sprintf","strerror","unsetenv","writeFile"]
	// os object
	// ["O_APPEND","O_CREAT","O_EXCL","O_RDONLY","O_RDWR","O_TRUNC","O_WRONLY","SIGABRT","SIGFPE","SIGILL","SIGINT","SIGSEGV","SIGTERM","S_IFBLK","S_IFCHR","S_IFDIR","S_IFIFO","S_IFLNK","S_IFMT","S_IFREG","S_IFSOCK","S_ISGID","S_ISUID","chdir","clearInterval","clearTimeout","close","exePath","getcwd","isatty","mkdir","now","open","platform","read","readdir","remove","rename","seek","setInterval","setReadHandler","setTimeout","setWriteHandler","signal","sleep","sleepAsync","stat","utimes","write"]
	// setTimeout function
	// ["length","name"]
	// setInterval function
	// ["length","name"]
	// clearTimeout function
	// ["length","name"]
	// clearInterval function
	// ["length","name"]
	// QJS_PROXY_VALUE function
	// ["length","name","prototype"]
	// siyuan object
	// ["plugin","logger","storage","fetch","socket","rpc"]
	if err == nil {
		p.Stop()
	}
	// Just verify it doesn't panic - the actual injection is tested via integration
}

func BenchmarkMapToJsConversion(b *testing.B) {
	m := map[string]any{
		"string": "hello world",
		"number": 42,
		"float":  3.14,
		"bool":   true,
		"nested": map[string]any{
			"key1": "value1",
			"key2": 100,
		},
		"slice": []any{"a", "b", "c"},
	}

	rt, err := qjs.New()
	if err != nil {
		b.Fatalf("failed to create QJS runtime: %v", err)
	}
	defer rt.Close()

	ctx := rt.Context()
	rv := reflect.ValueOf(m)

	b.Run("GoMapToJs", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			v, err := qjs.GoMapToJs(ctx, rv)
			if err != nil {
				b.Fatal(err)
			}
			_ = v
		}
	})

	b.Run("JsonMarshal+ParseJSON", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			jsonBytes, err := json.Marshal(m)
			if err != nil {
				b.Fatal(err)
			}
			v := ctx.ParseJSON(string(jsonBytes))
			_ = v
		}
	})
}
