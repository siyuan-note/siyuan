// 本文件移植自 https://github.com/grafana/sobek-webapi-encoding 的 register_test.go（提交 5785852a34），
// 按 Apache License 2.0 使用，许可证全文见同目录 LICENSE。
// 修改：以 github.com/dop251/goja 替换 github.com/grafana/sobek，文件由 register_test.go 更名为 module_test.go，
// 改为测试本包的 Enable。

package encoding

import (
	"testing"

	"github.com/dop251/goja"
)

// TestEnable exercises Enable end to end against a plain goja runtime.
func TestEnable(t *testing.T) {
	t.Parallel()

	rt := goja.New()
	rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))

	Enable(rt)

	v, err := rt.RunString(`
		const encoder = new TextEncoder();
		const encoded = encoder.encode("Hello, World!");

		const decoder = new TextDecoder("utf-8");
		const decoded = decoder.decode(encoded);

		if (decoded !== "Hello, World!") {
			throw new Error("unexpected decoded value: " + decoded);
		}

		decoded;
	`)
	if err != nil {
		t.Fatalf("unexpected error running script: %v", err)
	}

	if got := v.String(); got != "Hello, World!" {
		t.Fatalf("expected %q, got %q", "Hello, World!", got)
	}
}

// TestEnableFatalOption guards against Enable leaving
// TextDecoder options such as "fatal" inert when the caller has configured a
// field name mapper as documented.
func TestEnableFatalOption(t *testing.T) {
	t.Parallel()

	rt := goja.New()
	rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))

	Enable(rt)

	_, err := rt.RunString(`
		const decoder = new TextDecoder("utf-8", { fatal: true });
		if (decoder.fatal !== true) {
			throw new Error("expected decoder.fatal to be true");
		}

		let threw = false;
		try {
			decoder.decode(new Uint8Array([0xFF]));
		} catch (e) {
			threw = e instanceof TypeError;
		}
		if (!threw) {
			throw new Error("expected decode() to throw a TypeError for invalid input");
		}
	`)
	if err != nil {
		t.Fatalf("unexpected error running script: %v", err)
	}
}

// TestEnableJSOptions guards the option names used by k6's
// JavaScript field-name mapper.
func TestEnableJSOptions(t *testing.T) {
	t.Parallel()

	rt := goja.New()
	rt.SetFieldNameMapper(goja.TagFieldNameMapper("js", true))

	Enable(rt)

	_, err := rt.RunString(`
		const decoder = new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true,
		});
		if (decoder.fatal !== true) {
			throw new Error("expected decoder.fatal to be true");
		}
		if (decoder.ignoreBOM !== true) {
			throw new Error("expected decoder.ignoreBOM to be true");
		}

		const streamingDecoder = new TextDecoder();
		const first = streamingDecoder.decode(
			new Uint8Array([0xE2, 0x82]),
			{ stream: true },
		);
		if (first !== "") {
			throw new Error("expected incomplete streaming input to be buffered");
		}

		const second = streamingDecoder.decode(new Uint8Array([0xAC]));
		if (second !== "€") {
			throw new Error("expected buffered streaming input to decode to the euro sign");
		}
	`)
	if err != nil {
		t.Fatalf("unexpected error running script: %v", err)
	}
}
