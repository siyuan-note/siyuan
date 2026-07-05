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

package util

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/soheilhy/cmux"
)

// writeSelfSignedCert 生成自签 TLS 证书并写入 t.TempDir()，返回证书与私钥路径。
// 测试不能依赖工作空间的 ConfDir，故自行生成证书供 ServeMultiplexed 的 tls.LoadX509KeyPair 加载。
// 临时目录由 testing 框架在测试结束后自动清理。
func writeSelfSignedCert(t *testing.T) (certPath, keyPath string) {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key failed: %s", err)
	}

	template := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "siyuan-test"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA:                  true,
		BasicConstraintsValid: true,
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1)},
	}

	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create certificate failed: %s", err)
	}

	keyDER, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal key failed: %s", err)
	}

	dir := t.TempDir()
	certPath = filepath.Join(dir, "cert.pem")
	keyPath = filepath.Join(dir, "key.pem")
	if err = os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatalf("write cert failed: %s", err)
	}
	if err = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatalf("write key failed: %s", err)
	}
	return certPath, keyPath
}

// newTestHandler 构造一个简单的 HTTP handler。
func newTestHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "ok")
	})
	return mux
}

// awaitReady 轮询直到目标地址可建立 TCP 连接，或超时失败。
func awaitReady(t *testing.T, addr string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if c, err := net.Dial("tcp", addr); err == nil {
			c.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server at %s did not become ready", addr)
}

// 防止回归：cmux 派生 listener 的 Close 会关闭底层 root listener。
// 这是历史回归的根源——HTTP/HTTPS 共用 server 时，对该 server 调 Close 会通过
// 两个派生 listener 把 root 关掉，进而让 m.Serve 提前返回非关闭类错误
// （accept ...: use of closed network connection），触发内核退出码 21。
func TestCmuxDerivedListenerCloseClosesRoot(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()

	m := cmux.New(ln)
	derived := m.Match(cmux.Any())

	serveErrCh := make(chan error, 1)
	go func() { serveErrCh <- m.Serve() }()

	if err := derived.Close(); err != nil {
		t.Logf("derived listener close: %s", err)
	}

	// m.Serve 应当因 root 被关而返回，且返回的不是 cmux.ErrListenerClosed
	// （root.Accept 返回的是底层 "use of closed network connection"，
	// 调用方若只判断 ErrListenerClosed/ErrServerClosed 会误把它当作致命错误）。
	select {
	case err := <-serveErrCh:
		if errors.Is(err, cmux.ErrListenerClosed) {
			t.Fatalf("m.Serve should NOT return cmux.ErrListenerClosed, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("m.Serve did not return after closing derived listener")
	}

	// root 已被关闭，新连接应被拒绝
	if c, err := net.Dial("tcp", addr); err == nil {
		c.Close()
		t.Fatal("expected root listener to be closed, but connection succeeded")
	}
}

// 防止回归：HTTP 与 HTTPS 必须使用各自独立的 *http.Server。
// 若复用同一个 server 同时 Serve 两个派生 listener，调用该 server 的 Close 会把 root 一并关掉，
// 导致 m.Serve 提前返回 "use of closed network connection"——这正是历史回归（内核退出码 21、
// 弹窗“监听端口失败”）的成因。本测试模拟发布服务提前创建两个独立 server 传入，
// 验证二者是不同实例，且关闭服务能干净返回。
func TestServeMultiplexed_HTTPAndHTTPSMustUseSeparateServers(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	handler := newTestHandler()
	certPath, keyPath := writeSelfSignedCert(t)

	// 发布服务模式：调用方提前创建并持有两个独立 server 传入
	pubHTTP := &http.Server{Handler: handler}
	pubHTTPS := &http.Server{Handler: handler}
	if pubHTTP == pubHTTPS {
		t.Fatal("HTTP and HTTPS servers must be independent instances")
	}

	serveErrCh := make(chan error, 1)
	go func() {
		_, _, e := ServeMultiplexed(ln, handler, certPath, keyPath, pubHTTP, pubHTTPS)
		serveErrCh <- e
	}()

	awaitReady(t, addr)

	// 关闭调用方持有的 HTTP server：应能干净地让 ServeMultiplexed 返回
	pubHTTP.Close()

	select {
	case <-serveErrCh:
		// 干净返回即通过（返回 "use of closed" 属预期，因派生 listener Close 会关 root）
	case <-time.After(3 * time.Second):
		t.Fatal("ServeMultiplexed did not return after closing HTTP server (timeout)")
	}

	pubHTTPS.Close()
}

// 防止回归：主服务器场景（传入外部 httpServer，httpsServer 为 nil）。
//
// HTTPS 必须使用独立于外部 httpServer 的实例。历史上的一次回归让 HTTPS 复用了同一个
// httpServer（即 util.HttpServer），导致该 server 的 listeners 里同时记录了 httpL 和 tlsListener
// 两个都指向 cmux root 的派生 listener——退出时 util.HttpServer.Close() 会通过它们把 root 关掉，
// m.Serve 返回 "use of closed network connection"，而 serve.go 只识别 ErrServerClosed/
// ErrListenerClosed，于是误判为致命错误并 os.Exit(21)，弹窗“监听端口失败”。
//
// 本测试断言返回的 https server 与传入的外部 server 是不同实例，从根上杜绝这种复用。
func TestServeMultiplexed_HTTPSMustNotReuseExternalServer(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	handler := newTestHandler()
	certPath, keyPath := writeSelfSignedCert(t)

	// 主服务器模式：传入自己的 httpServer，HTTPS 交给内部创建
	externalServer := &http.Server{Handler: handler}

	type result struct {
		httpSrv  *http.Server
		httpsSrv *http.Server
		err      error
	}
	resultCh := make(chan result, 1)
	go func() {
		h, hs, e := ServeMultiplexed(ln, handler, certPath, keyPath, externalServer, nil)
		resultCh <- result{h, hs, e}
	}()

	awaitReady(t, addr)

	// 触发关闭，让 ServeMultiplexed 返回以便检查其返回值
	externalServer.Close()

	var res result
	select {
	case res = <-resultCh:
	case <-time.After(5 * time.Second):
		t.Fatal("ServeMultiplexed did not return after externalServer.Close() (timeout)")
	}

	// 返回的 http server 应复用外部传入的实例（主服务器语义）
	if res.httpSrv != externalServer {
		t.Fatal("returned http server should be the external one")
	}
	// 关键断言：HTTPS 必须是独立实例，不能复用外部 httpServer
	if res.httpsSrv == nil {
		t.Fatal("returned https server should be non-nil")
	}
	if res.httpsSrv == externalServer {
		t.Fatal("returned https server must NOT reuse the external httpServer (would close cmux root on Close)")
	}

	// 关键断言：外部 server 关闭后，cmux 派生 listener 的 Close 会连带关掉 root，
	// m.Serve() 随后返回的是 *net.OpError("use of closed network connection")。
	// 它既不是 http.ErrServerClosed 也不是 cmux.ErrListenerClosed，但能用 net.ErrClosed 匹配——
	// serve.go 的判错逻辑必须覆盖这一哨兵，否则正常退出会被误判为致命错误并 os.Exit(21)
	// （多实例下关闭任一实例即弹"监听端口失败"窗的回归，见 issue #18086）。
	if res.err == nil {
		t.Fatal("ServeMultiplexed should return non-nil error after external server close")
	}
	if !errors.Is(res.err, net.ErrClosed) {
		t.Fatalf("returned error should match net.ErrClosed (got %v), otherwise serve.go would os.Exit(21)", res.err)
	}
}

// 防止回归：端到端验证发布服务的“启动—关闭”闭环。
// 关闭发布服务后，端口上不应再有服务在监听，新连接应被拒绝——这是发布服务可被彻底关闭、
// 进而允许切换到另一工作空间的前提（历史 issue 16587/17973：旧连接未断导致串内容）。
func TestServeMultiplexed_CloseDropsActiveConnections(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	handler := newTestHandler()
	certPath, keyPath := writeSelfSignedCert(t)

	pubHTTP := &http.Server{Handler: handler}
	pubHTTPS := &http.Server{Handler: handler}

	serveErrCh := make(chan error, 1)
	go func() {
		_, _, e := ServeMultiplexed(ln, handler, certPath, keyPath, pubHTTP, pubHTTPS)
		serveErrCh <- e
	}()

	awaitReady(t, addr)

	// 服务运行期间，能正常处理 HTTP 请求
	resp, err := http.Get("http://" + addr + "/")
	if err != nil {
		t.Fatalf("request before shutdown failed: %s", err)
	}
	resp.Body.Close()

	// 关闭发布服务：与 closePublishListener 一致的顺序——先关 listener 停新连接，
	// 再 Shutdown 两个 server 断活跃连接，最后 Close 兜底。
	if err := ln.Close(); err != nil {
		t.Logf("listener close: %s", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = pubHTTP.Shutdown(ctx)
	_ = pubHTTPS.Shutdown(ctx)
	cancel()
	pubHTTP.Close()
	pubHTTPS.Close()

	select {
	case <-serveErrCh:
		// ServeMultiplexed 已返回
	case <-time.After(5 * time.Second):
		t.Fatal("ServeMultiplexed did not return after shutdown (timeout)")
	}

	// 关闭后，新连接应被拒绝（端口已无服务监听）
	if c, err := net.DialTimeout("tcp", addr, 2*time.Second); err == nil {
		c.Close()
		t.Fatal("expected connection to be refused after publish service shutdown, but dial succeeded")
	}
}
