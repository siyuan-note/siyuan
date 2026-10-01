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
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestClientFetchCopiesArrayBufferBody(t *testing.T) {
	received := make(chan []byte, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- body
	}))
	t.Cleanup(server.Close)

	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	originalPort := util.ServerPort
	util.ServerPort = serverURL.Port()
	t.Cleanup(func() { util.ServerPort = originalPort })

	// 请求在脚本修改缓冲区之后才发出，使共享 ArrayBuffer 内存的实现必然发送被修改的内容。
	mutated := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(mutated) }) }
	t.Cleanup(release)
	originalClient := httpClient
	httpClient = req.C().SetTimeout(5 * time.Second).OnBeforeRequest(func(*req.Client, *req.Request) error {
		<-mutated
		return nil
	})
	t.Cleanup(func() { httpClient = originalClient })

	ctx, cancel := context.WithCancel(context.Background())
	p := &KernelPlugin{Petal: &model.Petal{Name: "test-client-fetch-body"}, context: ctx, cancel: cancel}
	loop := eventloop.NewEventLoop()
	p.worker.Start(loop)
	loop.Start()
	t.Cleanup(func() {
		cancel()
		loop.Stop()
	})

	settled := make(chan string, 1)
	_, err = p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		siyuan := rt.NewObject()
		if injectErr := injectClient(p, rt, siyuan); injectErr != nil {
			return nil, injectErr
		}
		if setErr := rt.Set("siyuan", siyuan); setErr != nil {
			return nil, setErr
		}
		if setErr := rt.Set("settle", func(call goja.FunctionCall) goja.Value {
			settled <- call.Argument(0).String()
			return goja.Undefined()
		}); setErr != nil {
			return nil, setErr
		}
		_, runErr := rt.RunString(`
			const body = new Uint8Array([1, 2, 3, 4]);
			siyuan.client.fetch("/echo", {method: "POST", body: body.buffer})
				.then(() => settle(""), (e) => settle(String(e)));
			body.fill(0);
		`)
		return nil, runErr
	})
	release()
	if err != nil {
		t.Fatalf("run fetch script failed: %v", err)
	}

	select {
	case body := <-received:
		if !bytes.Equal(body, []byte{1, 2, 3, 4}) {
			t.Fatalf("request body = %v, want the ArrayBuffer content at call time [1 2 3 4]", body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch request")
	}

	select {
	case reason := <-settled:
		if reason != "" {
			t.Fatalf("fetch rejected: %s", reason)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch promise")
	}
}
