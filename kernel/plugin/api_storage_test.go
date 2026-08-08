// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package plugin

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type storageScriptResult struct {
	value string
	err   error
}

func runInjectStorageScript(t *testing.T, plugin *KernelPlugin, body string) string {
	t.Helper()
	loop := eventloop.NewEventLoop()
	plugin.worker.Start(loop)
	loop.Start()
	defer loop.Stop()

	completed := make(chan storageScriptResult, 1)
	if ok := loop.RunOnLoop(func(rt *goja.Runtime) {
		siyuan := rt.NewObject()
		if err := injectStorage(plugin, rt, siyuan); err != nil {
			completed <- storageScriptResult{err: err}
			return
		}
		if err := rt.Set("siyuan", siyuan); err != nil {
			completed <- storageScriptResult{err: err}
			return
		}
		if err := rt.Set("__storageTestDone", func(call goja.FunctionCall) goja.Value {
			completed <- storageScriptResult{value: call.Argument(0).String()}
			return goja.Undefined()
		}); err != nil {
			completed <- storageScriptResult{err: err}
			return
		}
		if err := rt.Set("__storageTestFail", func(call goja.FunctionCall) goja.Value {
			completed <- storageScriptResult{err: fmt.Errorf("%s", call.Argument(0).String())}
			return goja.Undefined()
		}); err != nil {
			completed <- storageScriptResult{err: err}
			return
		}
		script := `(async () => {` + body + `})().then(
			(value) => __storageTestDone(JSON.stringify(value)),
			(error) => __storageTestFail(String(error && error.message ? error.message : error))
		);`
		if _, err := rt.RunString(script); err != nil {
			completed <- storageScriptResult{err: err}
		}
	}); !ok {
		t.Fatal("failed to schedule storage script")
	}

	select {
	case result := <-completed:
		if result.err != nil {
			t.Fatalf("storage script failed: %v", result.err)
		}
		return result.value
	case <-time.After(10 * time.Second):
		t.Fatal("storage script timed out")
		return ""
	}
}

func newInjectStorageTestPlugin(t *testing.T) (*KernelPlugin, string) {
	t.Helper()
	plugin, storageDir := newStorageTestPlugin(t)
	plugin.Petal = &model.Petal{Name: "storage-test"}
	return plugin, storageDir
}

func decodeStorageScriptResult(t *testing.T, value string) map[string]any {
	t.Helper()
	result := map[string]any{}
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		t.Fatalf("decode %q: %v", value, err)
	}
	return result
}

func TestInjectStorageMethodsArgumentsAndFrozenObjects(t *testing.T) {
	plugin, _ := newInjectStorageTestPlugin(t)
	result := decodeStorageScriptResult(t, runInjectStorageScript(t, plugin, `
		const storage = siyuan.storage;
		async function rejection(call) {
			try {
				await call();
				return "";
			} catch (error) {
				return String(error && error.message ? error.message : error);
			}
		}
		const missing = {
			get: await rejection(() => storage.get()),
			put: await rejection(() => storage.put("only-path")),
			remove: await rejection(() => storage.remove()),
			list: await rejection(() => storage.list())
		};
		await storage.put(7, 8);
		const converted = await (await storage.get("7")).text();
		return {
			methods: Object.keys(storage).sort(),
			watcherMethods: Object.keys(storage.watcher).sort(),
			storageFrozen: Object.isFrozen(storage),
			watcherFrozen: Object.isFrozen(storage.watcher),
			missing,
			converted
		};
	`))

	methods, _ := json.Marshal(result["methods"])
	if string(methods) != `["get","list","put","remove","watcher"]` {
		t.Fatalf("unexpected storage methods: %s", methods)
	}
	watcherMethods, _ := json.Marshal(result["watcherMethods"])
	if string(watcherMethods) != `["add","remove"]` {
		t.Fatalf("unexpected watcher methods: %s", watcherMethods)
	}
	if result["storageFrozen"] != true || result["watcherFrozen"] != true {
		t.Fatalf("storage objects are not frozen: %#v", result)
	}
	missing := result["missing"].(map[string]any)
	for method, message := range missing {
		if !strings.Contains(message.(string), "required") {
			t.Fatalf("%s missing-argument error = %q", method, message)
		}
	}
	if result["converted"] != "8" {
		t.Fatalf("put argument conversion = %#v", result["converted"])
	}
}

func TestInjectStorageCRUDPromisesAndDataMethods(t *testing.T) {
	plugin, storageDir := newInjectStorageTestPlugin(t)
	result := decodeStorageScriptResult(t, runInjectStorageScript(t, plugin, `
		const putValue = await siyuan.storage.put("nested/value.json", '{"answer":42}');
		const data = await siyuan.storage.get("nested/value.json");
		const text = await data.text();
		const parsed = await data.json();
		const buffer = await data.buffer();
		const arrayBuffer = await data.arrayBuffer();
		const entries = await siyuan.storage.list("nested");
		const removeValue = await siyuan.storage.remove("nested/value.json");
		let missing = "";
		try {
			await siyuan.storage.get("nested/value.json");
		} catch (error) {
			missing = String(error && error.message ? error.message : error);
		}
		return {
			putNull: putValue === null,
			text,
			answer: parsed.answer,
			bufferLength: buffer.length,
			arrayBufferLength: arrayBuffer.byteLength,
			entry: entries[0],
			removeNull: removeValue === null,
			missing
		};
	`))

	if result["putNull"] != true || result["removeNull"] != true {
		t.Fatalf("unexpected mutation resolve values: %#v", result)
	}
	if result["text"] != `{"answer":42}` || result["answer"] != float64(42) || result["bufferLength"] != float64(13) ||
		result["arrayBufferLength"] != float64(13) {
		t.Fatalf("unexpected data method result: %#v", result)
	}
	entry := result["entry"].(map[string]any)
	if entry["name"] != "value.json" || entry["isDir"] != false || entry["isSymlink"] != false {
		t.Fatalf("unexpected list entry: %#v", entry)
	}
	if result["missing"] == "" {
		t.Fatal("missing file did not reject")
	}
	if _, err := os.Lstat(filepath.Join(storageDir, "nested", "value.json")); !os.IsNotExist(err) {
		t.Fatalf("remove did not delete file: %v", err)
	}
}

func TestInjectStorageReadOnly(t *testing.T) {
	plugin, storageDir := newInjectStorageTestPlugin(t)
	if err := os.WriteFile(filepath.Join(storageDir, "value"), []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	previousReadOnly := util.ReadOnly
	util.ReadOnly = true
	defer func() { util.ReadOnly = previousReadOnly }()

	result := decodeStorageScriptResult(t, runInjectStorageScript(t, plugin, `
		async function rejection(call) {
			try {
				await call();
				return "";
			} catch (error) {
				return String(error && error.message ? error.message : error);
			}
		}
		const text = await (await siyuan.storage.get("value")).text();
		const entries = await siyuan.storage.list("");
		return {
			text,
			entryCount: entries.length,
			putError: await rejection(() => siyuan.storage.put("value", "changed")),
			removeError: await rejection(() => siyuan.storage.remove("value"))
		};
	`))

	if result["text"] != "original" || result["entryCount"] != float64(1) {
		t.Fatalf("read operations changed in read-only mode: %#v", result)
	}
	if !strings.Contains(result["putError"].(string), "read-only") ||
		!strings.Contains(result["removeError"].(string), "read-only") {
		t.Fatalf("mutations were not rejected in read-only mode: %#v", result)
	}
	data, err := os.ReadFile(filepath.Join(storageDir, "value"))
	if err != nil || string(data) != "original" {
		t.Fatalf("read-only mutation changed data %q: %v", data, err)
	}
}
