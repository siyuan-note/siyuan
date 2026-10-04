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
	"io"
	"mime"
	"mime/multipart"
	"strings"
	"testing"

	"github.com/dop251/goja"
)

func TestFormDataAppendGetGetAllHas(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`(() => {
		const fd = new FormData();
		fd.append("a", "1");
		fd.append("b", 2);
		fd.append("a", "3");
		fd.append("\ud800", "\udc00x");
		return JSON.stringify([
			fd.get("a"), fd.get("b"), fd.get("missing"), fd.getAll("a"), fd.getAll("missing"),
			fd.has("a"), fd.has("missing"), fd.get("\ufffd"),
		]);
	})()`)
	if want := "[\"1\",\"2\",null,[\"1\",\"3\"],[],true,false,\"\uFFFDx\"]"; got != want {
		t.Fatalf("entries = %s, want %s", got, want)
	}
}

func TestFormDataSetAndDelete(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`(() => {
		const fd = new FormData();
		fd.append("a", "1");
		fd.append("b", "2");
		fd.append("a", "3");
		fd.append("c", "4");
		fd.append("a", "5");
		// set 替换第一个同名条目并移除其余同名条目，没有同名条目时追加到末尾。
		fd.set("a", "x");
		fd.set("d", "y");
		const afterSet = [...fd];
		fd.append("b", "6");
		fd.delete("b");
		fd.delete("missing");
		return JSON.stringify([afterSet, [...fd]]);
	})()`)
	want := `[[["a","x"],["b","2"],["c","4"],["d","y"]],[["a","x"],["c","4"],["d","y"]]]`
	if got != want {
		t.Fatalf("set/delete = %s, want %s", got, want)
	}
}

func TestFormDataBlobValuesBecomeFiles(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.await(`(async () => {
		const fd = new FormData();
		const file = new File(["f"], "orig.txt", {type: "text/plain", lastModified: 123});
		const blob = new Blob(["b"], {type: "image/png"});
		fd.append("file", file);
		fd.append("blob", blob);
		fd.append("renamed", file, "new.txt");
		fd.append("blobNamed", blob, "pic.png");
		fd.append("undefinedName", blob, undefined);

		const fromBlob = fd.get("blob");
		const renamed = fd.get("renamed");
		const results = [
			fd.get("file") === file, fd.get("blob") === fromBlob,
			fromBlob instanceof File, fromBlob.name, fromBlob.type, fromBlob !== blob,
			renamed !== file, renamed.name, renamed.type, renamed.lastModified,
			fd.get("blobNamed").name, fd.get("blobNamed").type,
			fd.get("undefinedName").name,
			await fromBlob.text(), await renamed.text(),
		];
		try {
			fd.append("bad", "not a blob", "name.txt");
			results.push("no throw");
		} catch (e) {
			results.push(e.constructor.name);
		}
		return JSON.stringify(results);
	})()`)
	want := `[true,true,true,"blob","image/png",true,true,"new.txt","text/plain",123,"pic.png","image/png","blob",` +
		`"b","f","TypeError"]`
	if got != want {
		t.Fatalf("blob entries = %s, want %s", got, want)
	}
}

func TestFormDataIteration(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`(() => {
		const fd = new FormData();
		fd.append("a", "1");
		fd.append("b", new Blob(["x"]));
		const describe = (value) => typeof value === "string" ? value : value.name;
		const iterator = fd.entries();
		const result = {
			sameFunction: FormData.prototype[Symbol.iterator] === FormData.prototype.entries,
			tag: Object.prototype.toString.call(iterator),
			selfIterable: iterator[Symbol.iterator]() === iterator,
			keys: [...fd.keys()],
			values: [...fd.values()].map(describe),
			entries: Array.from(fd, ([key, value]) => key + "=" + describe(value)),
		};

		// 迭代按下标读取当前条目：迭代过程中追加的条目也会被遍历到。
		const live = [];
		for (const [key] of fd) {
			live.push(key);
			if (key === "a") {
				fd.append("c", "3");
			}
		}
		result.live = live;

		// forEach 的回调参数为 (value, key, formData)，第二个参数作为回调的 this；回调中追加的条目同样会被遍历到。
		const seen = [];
		fd.forEach(function (value, key, target) {
			seen.push([describe(value), key, target === fd, this.marker]);
			if (key === "a") {
				fd.append("d", "4");
			}
		}, {marker: "this"});
		result.seen = seen;

		const keys = fd.keys();
		for (let i = 0; i < 4; i++) {
			keys.next();
		}
		result.exhausted = keys.next();
		return JSON.stringify(result);
	})()`)
	want := `{"sameFunction":true,"tag":"[object FormData Iterator]","selfIterable":true,"keys":["a","b"],` +
		`"values":["1","blob"],"entries":["a=1","b=blob"],"live":["a","b","c"],` +
		`"seen":[["1","a",true,"this"],["blob","b",true,"this"],["3","c",true,"this"],["4","d",true,"this"]],` +
		`"exhausted":{"done":true}}`
	if got != want {
		t.Fatalf("iteration = %s, want %s", got, want)
	}
}

func TestFormDataRejectsInvalidArguments(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`(() => {
		const results = [];
		for (const fn of [
			() => new FormData({}),
			() => new FormData(null),
			() => new FormData().append("a"),
			() => new FormData().set(),
			() => new FormData().get(),
			() => new FormData().append(Symbol("name"), "x"),
			() => FormData.prototype.append.call({}, "a", "b"),
			() => FormData.prototype.entries.call({}),
			() => new FormData().forEach(null),
			() => new FormData().entries().next.call({}),
		]) {
			try {
				fn();
				results.push("no throw");
			} catch (e) {
				results.push(e.constructor.name);
			}
		}
		results.push(new FormData(undefined) instanceof FormData);
		return results.join(",");
	})()`)
	if want := strings.Repeat("TypeError,", 10) + "true"; got != want {
		t.Fatalf("invalid arguments = %s, want %s", got, want)
	}
}

func TestFormDataInterfaceShape(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`(() => {
		class ExtendedFormData extends FormData {
			extra = "field";
		}
		const extended = new ExtendedFormData();
		extended.append("a", "1");
		return JSON.stringify([
			Object.keys(FormData.prototype),
			FormData.prototype.append.length,
			FormData.prototype.forEach.length,
			Object.prototype.toString.call(new FormData()),
			JSON.stringify(new FormData()),
			extended instanceof ExtendedFormData, extended.get("a"), Object.keys(extended),
			new URLSearchParams(extended).toString(),
		]);
	})()`)
	want := `[["append","delete","get","getAll","has","set","entries","keys","values","forEach"],2,1,` +
		`"[object FormData]","{}",true,"1",["extra"],"a=1"]`
	if got != want {
		t.Fatalf("interface shape = %s, want %s", got, want)
	}
}

// encodeFormDataGlobal 对全局变量 name 引用的 FormData 编码，返回请求体与 boundary。
func encodeFormDataGlobal(t *testing.T, rt *formDataTestRuntime, name string) (body []byte, boundary string) {
	t.Helper()

	var contentType string
	found := false
	rt.withRuntime(func(rt *goja.Runtime) {
		var state *formDataState
		if state, found = formDataStateOf(rt.Get(name)); found {
			body, contentType = state.encodeMultipart()
		}
	})
	if !found {
		t.Fatalf("globalThis.%s is not a FormData", name)
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/form-data" {
		t.Fatalf("content type = %q (%v), want multipart/form-data", contentType, err)
	}
	boundary = params["boundary"]
	if !strings.HasPrefix(boundary, "----formdata-siyuan-") || len(boundary) > 70 {
		t.Fatalf("boundary = %q, want a random boundary of at most 70 characters", boundary)
	}
	return body, boundary
}

func TestFormDataEncodeMultipart(t *testing.T) {
	rt := newFormDataTestRuntime(t)
	rt.run(`
		globalThis.fd = new FormData();
		fd.append("text", "line1\nline2\rline3\r\nend");
		fd.append("we\"ird\nname", "v");
		fd.append("file", new File(["hello"], "a\"b\r\n.txt", {type: "Text/Plain"}));
		fd.append("blob", new Blob([new Uint8Array([0, 255])]));
		fd.append("renamed", new Blob(["x"], {type: "image/png"}), "pic.png");
		fd.append("\u4e2d\u6587", "\u503c");
		globalThis.empty = new FormData();
	`)

	body, boundary := encodeFormDataGlobal(t, rt, "fd")
	want := strings.Join([]string{
		"--" + boundary,
		`Content-Disposition: form-data; name="text"`,
		"",
		"line1\r\nline2\r\nline3\r\nend",
		"--" + boundary,
		`Content-Disposition: form-data; name="we%22ird%0D%0Aname"`,
		"",
		"v",
		"--" + boundary,
		`Content-Disposition: form-data; name="file"; filename="a%22b%0D%0A.txt"`,
		"Content-Type: text/plain",
		"",
		"hello",
		"--" + boundary,
		`Content-Disposition: form-data; name="blob"; filename="blob"`,
		"Content-Type: application/octet-stream",
		"",
		"\x00\xff",
		"--" + boundary,
		`Content-Disposition: form-data; name="renamed"; filename="pic.png"`,
		"Content-Type: image/png",
		"",
		"x",
		"--" + boundary,
		`Content-Disposition: form-data; name="中文"`,
		"",
		"值",
		"--" + boundary + "--",
		"",
	}, "\r\n")
	if string(body) != want {
		t.Fatalf("body = %q, want %q", body, want)
	}

	// 内核用 Go 的 mime/multipart 解析表单，编码结果必须能被它还原；与浏览器一样，名称中的转义不会被解码。
	form, err := multipart.NewReader(bytes.NewReader(body), boundary).ReadForm(1 << 20)
	if err != nil {
		t.Fatalf("parse multipart body: %v", err)
	}
	t.Cleanup(func() { form.RemoveAll() })
	for name, want := range map[string]string{
		"text":               "line1\r\nline2\r\nline3\r\nend",
		"we%22ird%0D%0Aname": "v",
		"中文":                 "值",
	} {
		if got := form.Value[name]; len(got) != 1 || got[0] != want {
			t.Fatalf("form value %q = %q, want [%q]", name, got, want)
		}
	}
	for name, want := range map[string][3]string{
		"file":    {"a%22b%0D%0A.txt", "text/plain", "hello"},
		"blob":    {"blob", "application/octet-stream", "\x00\xff"},
		"renamed": {"pic.png", "image/png", "x"},
	} {
		files := form.File[name]
		if len(files) != 1 {
			t.Fatalf("form file %q count = %d, want 1", name, len(files))
		}
		file, err := files[0].Open()
		if err != nil {
			t.Fatalf("open form file %q: %v", name, err)
		}
		content, err := io.ReadAll(file)
		file.Close()
		if err != nil {
			t.Fatalf("read form file %q: %v", name, err)
		}
		got := [3]string{files[0].Filename, files[0].Header.Get("Content-Type"), string(content)}
		if got != want {
			t.Fatalf("form file %q = %q, want %q", name, got, want)
		}
	}

	body, boundary = encodeFormDataGlobal(t, rt, "empty")
	if want := "--" + boundary + "--\r\n"; string(body) != want {
		t.Fatalf("empty body = %q, want %q", body, want)
	}
}
