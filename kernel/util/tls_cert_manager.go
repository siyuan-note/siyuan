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
	"crypto"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

const tlsCertMaxIPAddresses = 128

type tlsCertificateState struct {
	certificate tls.Certificate
	leaf        *x509.Certificate
}

type tlsCertManager struct {
	certPath   string
	caCertPath string
	caKeyPath  string

	refreshMu sync.Mutex
	state     atomic.Pointer[tlsCertificateState]
}

var tlsCertManagers = struct {
	sync.Mutex
	managers map[string]*tlsCertManager
}{
	managers: map[string]*tlsCertManager{},
}

func getTLSCertManager(certPath, keyPath string) (*tlsCertManager, error) {
	managerKey := tlsCertManagerKey(certPath, keyPath)

	tlsCertManagers.Lock()
	defer tlsCertManagers.Unlock()

	if manager := tlsCertManagers.managers[managerKey]; manager != nil {
		return manager, nil
	}

	state, err := loadTLSCertificateState(certPath, keyPath)
	if err != nil {
		return nil, err
	}

	certDir := filepath.Dir(certPath)
	manager := &tlsCertManager{
		certPath:   certPath,
		caCertPath: filepath.Join(certDir, TLSCACertFilename),
		caKeyPath:  filepath.Join(certDir, TLSCAKeyFilename),
	}
	manager.state.Store(state)
	tlsCertManagers.managers[managerKey] = manager
	return manager, nil
}

func hasTLSCertManager(certPath, keyPath string) bool {
	managerKey := tlsCertManagerKey(certPath, keyPath)
	tlsCertManagers.Lock()
	defer tlsCertManagers.Unlock()
	return tlsCertManagers.managers[managerKey] != nil
}

func tlsCertManagerKey(certPath, keyPath string) string {
	return filepath.Clean(certPath) + "\x00" + filepath.Clean(keyPath)
}

func loadTLSCertificateState(certPath, keyPath string) (*tlsCertificateState, error) {
	certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, err
	}
	if len(certificate.Certificate) == 0 {
		return nil, fmt.Errorf("TLS certificate chain is empty")
	}

	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return nil, err
	}
	certificate.Leaf = leaf
	return &tlsCertificateState{certificate: certificate, leaf: leaf}, nil
}

func (manager *tlsCertManager) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	state := manager.state.Load()
	if state == nil {
		return nil, fmt.Errorf("TLS certificate is not initialized")
	}

	var localIP net.IP
	if hello != nil && hello.Conn != nil {
		localIP = tlsLocalIP(hello.Conn.LocalAddr())
	}

	now := time.Now()
	if tlsCertificateStateValid(state, now) && (localIP == nil || certificateContainsIP(state.leaf, localIP)) {
		return &state.certificate, nil
	}
	return manager.refreshCertificate(localIP)
}

func (manager *tlsCertManager) refreshCertificate(localIP net.IP) (*tls.Certificate, error) {
	manager.refreshMu.Lock()
	defer manager.refreshMu.Unlock()

	currentState := manager.state.Load()
	if currentState == nil {
		return nil, fmt.Errorf("TLS certificate is not initialized")
	}
	now := time.Now()
	if tlsCertificateStateValid(currentState, now) &&
		(localIP == nil || certificateContainsIP(currentState.leaf, localIP)) {
		return &currentState.certificate, nil
	}

	privateKey, ok := currentState.certificate.PrivateKey.(crypto.Signer)
	if !ok {
		return nil, fmt.Errorf("TLS server private key does not implement crypto.Signer")
	}

	caCert, caKey, err := loadCA(manager.caCertPath, manager.caKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load CA certificates: %w", err)
	}

	ipAddresses := collectServerCertificateIPs(currentState.leaf.IPAddresses, localIP)
	dnsNames := collectServerCertificateDNSNames(currentState.leaf.DNSNames)
	certDER, leaf, err := createServerCertificate(caCert, caKey, privateKey, ipAddresses, dnsNames)
	if err != nil {
		return nil, fmt.Errorf("failed to generate TLS server certificate: %w", err)
	}

	certificate := tls.Certificate{
		Certificate: [][]byte{certDER},
		PrivateKey:  privateKey,
		Leaf:        leaf,
	}
	newState := &tlsCertificateState{certificate: certificate, leaf: leaf}
	manager.state.Store(newState)

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	if err = gulu.File.WriteFileSafer(manager.certPath, certPEM, 0644); err != nil {
		logging.LogWarnf("failed to persist refreshed TLS server certificate: %s", err)
	}

	if localIP == nil {
		logging.LogInfof("refreshed TLS server certificate before expiration")
	} else {
		logging.LogInfof("refreshed TLS server certificate for local IP address [%s]", localIP.String())
	}
	return &newState.certificate, nil
}

func tlsCertificateStateValid(state *tlsCertificateState, now time.Time) bool {
	return state != nil && state.leaf != nil &&
		!now.Before(state.leaf.NotBefore) &&
		now.Add(tlsCertRenewBefore).Before(state.leaf.NotAfter)
}

func certificateContainsIP(cert *x509.Certificate, target net.IP) bool {
	if cert == nil || target == nil {
		return false
	}
	for _, candidate := range cert.IPAddresses {
		if candidate.Equal(target) {
			return true
		}
	}
	return false
}

func tlsLocalIP(addr net.Addr) net.IP {
	if addr == nil {
		return nil
	}

	if tcpAddr, ok := addr.(*net.TCPAddr); ok {
		return normalizeTLSIP(tcpAddr.IP)
	}

	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		return nil
	}
	if zoneIndex := strings.LastIndex(host, "%"); zoneIndex > -1 {
		host = host[:zoneIndex]
	}
	return normalizeTLSIP(net.ParseIP(host))
}

func normalizeTLSIP(ip net.IP) net.IP {
	if ip == nil || ip.IsUnspecified() {
		return nil
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		return append(net.IP(nil), ipv4...)
	}
	if ipv6 := ip.To16(); ipv6 != nil {
		return append(net.IP(nil), ipv6...)
	}
	return nil
}

func collectServerCertificateIPs(existing []net.IP, requested net.IP) []net.IP {
	ipMap := map[string]net.IP{}
	addIP := func(ip net.IP) {
		if len(ipMap) >= tlsCertMaxIPAddresses {
			return
		}
		normalized := normalizeTLSIP(ip)
		if normalized != nil {
			ipMap[normalized.String()] = normalized
		}
	}

	addIP(requested)
	addIP(net.ParseIP("127.0.0.1"))
	addIP(net.IPv6loopback)
	for _, ipStr := range extractIPsFromServerAddrs() {
		addIP(net.ParseIP(trimIPv6Brackets(ipStr)))
	}
	for _, ip := range existing {
		addIP(ip)
	}

	keys := make([]string, 0, len(ipMap))
	for key := range ipMap {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	ret := make([]net.IP, 0, len(keys))
	for _, key := range keys {
		ret = append(ret, ipMap[key])
	}
	return ret
}

func collectServerCertificateDNSNames(existing []string) []string {
	nameMap := map[string]string{"localhost": "localhost"}
	for _, name := range existing {
		name = strings.TrimSpace(name)
		if name != "" {
			nameMap[strings.ToLower(name)] = name
		}
	}

	keys := make([]string, 0, len(nameMap))
	for key := range nameMap {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	ret := make([]string, 0, len(keys))
	for _, key := range keys {
		ret = append(ret, nameMap[key])
	}
	return ret
}
