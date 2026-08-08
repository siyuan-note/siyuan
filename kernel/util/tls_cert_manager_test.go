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

package util

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type tlsManagerTestConn struct {
	localAddr net.Addr
}

func (conn *tlsManagerTestConn) Read([]byte) (int, error)         { return 0, errors.New("not implemented") }
func (conn *tlsManagerTestConn) Write([]byte) (int, error)        { return 0, errors.New("not implemented") }
func (conn *tlsManagerTestConn) Close() error                     { return nil }
func (conn *tlsManagerTestConn) LocalAddr() net.Addr              { return conn.localAddr }
func (conn *tlsManagerTestConn) RemoteAddr() net.Addr             { return &net.TCPAddr{} }
func (conn *tlsManagerTestConn) SetDeadline(time.Time) error      { return nil }
func (conn *tlsManagerTestConn) SetReadDeadline(time.Time) error  { return nil }
func (conn *tlsManagerTestConn) SetWriteDeadline(time.Time) error { return nil }

func prepareTLSCertManagerTest(t *testing.T, initialIPs []net.IP) (manager *tlsCertManager, caCertPath,
	certPath, keyPath string) {
	t.Helper()

	dir := t.TempDir()
	caCertPath = filepath.Join(dir, TLSCACertFilename)
	caKeyPath := filepath.Join(dir, TLSCAKeyFilename)
	certPath = filepath.Join(dir, TLSCertFilename)
	keyPath = filepath.Join(dir, TLSKeyFilename)

	if err := generateCACert(caCertPath, caKeyPath); err != nil {
		t.Fatalf("generate CA certificate failed: %s", err)
	}
	caCert, caKey, err := loadCA(caCertPath, caKeyPath)
	if err != nil {
		t.Fatalf("load CA certificate failed: %s", err)
	}

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate server private key failed: %s", err)
	}
	certDER, _, err := createServerCertificate(caCert, caKey, privateKey, initialIPs, []string{"localhost"})
	if err != nil {
		t.Fatalf("generate server certificate failed: %s", err)
	}
	if err = writeCertAndKey(certPath, keyPath, certDER, privateKey); err != nil {
		t.Fatalf("write server certificate failed: %s", err)
	}

	manager, err = getTLSCertManager(certPath, keyPath)
	if err != nil {
		t.Fatalf("create TLS certificate manager failed: %s", err)
	}
	return
}

func TestTLSCertManagerRefreshesCertificateDuringIPHandshake(t *testing.T) {
	initialIP := net.ParseIP("192.0.2.10")
	manager, caCertPath, certPath, keyPath := prepareTLSCertManagerTest(t, []net.IP{initialIP})

	caBefore, err := os.ReadFile(caCertPath)
	if err != nil {
		t.Fatal(err)
	}
	keyBefore, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	tlsListener := tls.NewListener(listener, &tls.Config{GetCertificate: manager.GetCertificate})
	serverErr := make(chan error, 1)
	go func() {
		conn, acceptErr := tlsListener.Accept()
		if acceptErr != nil {
			serverErr <- acceptErr
			return
		}
		defer conn.Close()
		serverErr <- conn.(*tls.Conn).Handshake()
	}()

	caBlock, _ := pem.Decode(caBefore)
	if caBlock == nil {
		t.Fatal("decode CA certificate failed")
	}
	caCert, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(caCert)

	client, err := tls.Dial("tcp", listener.Addr().String(), &tls.Config{
		RootCAs:    roots,
		ServerName: "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("TLS handshake with dynamically discovered IP failed: %s", err)
	}
	peerCert := client.ConnectionState().PeerCertificates[0]
	client.Close()

	if err = <-serverErr; err != nil {
		t.Fatalf("server TLS handshake failed: %s", err)
	}
	if !certificateContainsIP(peerCert, initialIP) {
		t.Fatalf("refreshed certificate lost existing IP [%s]", initialIP)
	}
	if !certificateContainsIP(peerCert, net.ParseIP("127.0.0.1")) {
		t.Fatal("refreshed certificate does not contain the handshake local IP")
	}

	persistedCert, err := loadX509Certificate(certPath)
	if err != nil {
		t.Fatalf("load persisted certificate failed: %s", err)
	}
	if !certificateContainsIP(persistedCert, initialIP) ||
		!certificateContainsIP(persistedCert, net.ParseIP("127.0.0.1")) {
		t.Fatal("persisted certificate does not contain the merged IP addresses")
	}

	caAfter, err := os.ReadFile(caCertPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(caBefore, caAfter) {
		t.Fatal("refreshing the server certificate changed the CA certificate")
	}
	keyAfter, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(keyBefore, keyAfter) {
		t.Fatal("refreshing the server certificate changed the server private key")
	}
}

func TestTLSCertManagerRefreshesCertificateOnceForConcurrentHandshakes(t *testing.T) {
	initialIP := net.ParseIP("192.0.2.10")
	requestedIP := net.ParseIP("198.51.100.20")
	manager, _, _, _ := prepareTLSCertManagerTest(t, []net.IP{initialIP})

	const handshakeCount = 32
	certificates := make([]*tls.Certificate, handshakeCount)
	errs := make([]error, handshakeCount)
	var waitGroup sync.WaitGroup
	waitGroup.Add(handshakeCount)
	for i := 0; i < handshakeCount; i++ {
		go func(index int) {
			defer waitGroup.Done()
			certificates[index], errs[index] = manager.GetCertificate(&tls.ClientHelloInfo{
				Conn: &tlsManagerTestConn{localAddr: &net.TCPAddr{IP: requestedIP, Port: 6806}},
			})
		}(i)
	}
	waitGroup.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("handshake [%d] failed: %s", i, err)
		}
		if !bytes.Equal(certificates[0].Certificate[0], certificates[i].Certificate[0]) {
			t.Fatalf("handshake [%d] received a separately generated certificate", i)
		}
	}

	leaf, err := x509.ParseCertificate(certificates[0].Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	if !certificateContainsIP(leaf, initialIP) || !certificateContainsIP(leaf, requestedIP) {
		t.Fatal("refreshed certificate does not contain both existing and requested IP addresses")
	}
}

func TestServerCertificateAllowsClockSkew(t *testing.T) {
	beforeGeneration := time.Now()
	_, _, certPath, _ := prepareTLSCertManagerTest(t, []net.IP{net.ParseIP("192.0.2.10")})

	cert, err := loadX509Certificate(certPath)
	if err != nil {
		t.Fatalf("load server certificate failed: %s", err)
	}
	if cert.NotBefore.After(beforeGeneration.Add(-4 * time.Minute)) {
		t.Fatalf("server certificate NotBefore [%s] does not allow enough clock skew", cert.NotBefore)
	}
}

func TestServeMultiplexedRefreshesCertificateForConnectionLocalIP(t *testing.T) {
	initialIP := net.ParseIP("192.0.2.10")
	_, caCertPath, certPath, keyPath := prepareTLSCertManagerTest(t, []net.IP{initialIP})

	caPEM, err := os.ReadFile(caCertPath)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		t.Fatal("append CA certificate failed")
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	serveErr := make(chan error, 1)
	go func() {
		_, _, serveError := ServeMultiplexed(listener, newTestHandler(), certPath, keyPath, nil, nil)
		serveErr <- serveError
	}()
	awaitReady(t, listener.Addr().String())

	transport := &http.Transport{
		ForceAttemptHTTP2: false,
		TLSClientConfig: &tls.Config{
			RootCAs: roots,
		},
	}
	client := &http.Client{Transport: transport}
	response, err := client.Get("https://" + listener.Addr().String() + "/")
	if err != nil {
		listener.Close()
		t.Fatalf("multiplexed HTTPS request failed: %s", err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	transport.CloseIdleConnections()
	if err != nil {
		listener.Close()
		t.Fatal(err)
	}
	if string(body) != "ok" {
		listener.Close()
		t.Fatalf("unexpected response body [%s]", body)
	}

	if err = listener.Close(); err != nil {
		t.Logf("close listener failed: %s", err)
	}
	select {
	case <-serveErr:
	case <-time.After(5 * time.Second):
		t.Fatal("ServeMultiplexed did not stop after closing the listener")
	}
}
