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
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

const (
	TLSCACertFilename = "ca.crt"
	TLSCAKeyFilename  = "ca.key"
	TLSCertFilename   = "cert.pem"
	TLSKeyFilename    = "key.pem"
)

// Returns paths to existing TLS certificates or generates new ones signed by a local CA.
// Certificates are stored in the conf directory of the workspace.
func GetOrCreateTLSCert() (certPath, keyPath string, err error) {
	certPath = filepath.Join(ConfDir, TLSCertFilename)
	keyPath = filepath.Join(ConfDir, TLSKeyFilename)
	caCertPath := filepath.Join(ConfDir, TLSCACertFilename)
	caKeyPath := filepath.Join(ConfDir, TLSCAKeyFilename)

	if !gulu.File.IsExist(caCertPath) || !gulu.File.IsExist(caKeyPath) {
		logging.LogInfof("generating local CA for TLS...")
		if err = generateCACert(caCertPath, caKeyPath); err != nil {
			logging.LogErrorf("failed to generate CA certificates: %s", err)
			return "", "", err
		}
	}

	if gulu.File.IsExist(certPath) && gulu.File.IsExist(keyPath) {
		if validateCert(certPath) {
			logging.LogInfof("using existing TLS certificates from [%s]", ConfDir)
			return certPath, keyPath, nil
		}
		logging.LogInfof("existing TLS certificates are invalid or expired, regenerating...")
	}

	caCert, caKey, err := loadCA(caCertPath, caKeyPath)
	if err != nil {
		logging.LogErrorf("failed to load CA certificates: %s", err)
		return "", "", err
	}

	logging.LogInfof("generating TLS server certificates signed by local CA...")
	if err = generateServerCert(certPath, keyPath, caCert, caKey); err != nil {
		logging.LogErrorf("failed to generate TLS certificates: %s", err)
		return "", "", err
	}

	logging.LogInfof("generated TLS certificates at [%s]", ConfDir)
	return certPath, keyPath, nil
}

// Checks if the certificate file exists, is not expired, and contains all current IP addresses
func validateCert(certPath string) bool {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return false
	}

	block, _ := pem.Decode(certPEM)
	if block == nil {
		return false
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}

	// Check if certificate is still valid, with 7 day buffer
	if !time.Now().Add(7 * 24 * time.Hour).Before(cert.NotAfter) {
		return false
	}

	// Check if certificate contains all current IP addresses
	currentIPs := extractIPsFromServerAddrs()
	certIPMap := make(map[string]bool)
	for _, ip := range cert.IPAddresses {
		certIPMap[ip.String()] = true
	}

	for _, ipStr := range currentIPs {
		ipStr = trimIPv6Brackets(ipStr)
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}

		if !certIPMap[ip.String()] {
			logging.LogInfof("certificate missing current IP address [%s], will regenerate", ip.String())
			return false
		}
	}

	return true
}

// Creates a new self-signed CA certificate
func generateCACert(certPath, keyPath string) error {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}

	notBefore := time.Now()
	notAfter := notBefore.Add(10 * 365 * 24 * time.Hour)

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"SiYuan"},
			CommonName:   "SiYuan Local CA",
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return err
	}

	return writeCertAndKey(certPath, keyPath, certDER, privateKey)
}

// Creates a new server certificate signed by the CA
func generateServerCert(certPath, keyPath string, caCert *x509.Certificate, caKey any) error {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}

	notBefore := time.Now()
	notAfter := notBefore.Add(365 * 24 * time.Hour)

	ipAddresses := []net.IP{
		net.ParseIP("127.0.0.1"),
		net.IPv6loopback,
	}

	localIPs := extractIPsFromServerAddrs()
	for _, ipStr := range localIPs {
		ipStr = trimIPv6Brackets(ipStr)
		if ip := net.ParseIP(ipStr); ip != nil {
			ipAddresses = append(ipAddresses, ip)
		}
	}

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"SiYuan"},
			CommonName:   "SiYuan Local Server",
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           ipAddresses,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, caCert, &privateKey.PublicKey, caKey)
	if err != nil {
		return err
	}

	return writeCertAndKey(certPath, keyPath, certDER, privateKey)
}

// Loads the CA certificate and private key from files
func loadCA(certPath, keyPath string) (*x509.Certificate, any, error) {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, nil, err
	}

	block, _ := pem.Decode(certPEM)
	if block == nil {
		return nil, nil, fmt.Errorf("failed to decode CA certificate PEM")
	}

	caCert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, nil, err
	}

	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, nil, err
	}

	block, _ = pem.Decode(keyPEM)
	if block == nil {
		return nil, nil, fmt.Errorf("failed to decode CA key PEM")
	}

	caKey, err := x509.ParseECPrivateKey(block.Bytes)
	if err != nil {
		return nil, nil, err
	}

	return caCert, caKey, nil
}

func writeCertAndKey(certPath, keyPath string, certDER []byte, privateKey *ecdsa.PrivateKey) error {
	certFile, err := os.Create(certPath)
	if err != nil {
		return err
	}
	defer certFile.Close()

	if err = pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: certDER}); err != nil {
		return err
	}

	keyFile, err := os.Create(keyPath)
	if err != nil {
		return err
	}
	defer keyFile.Close()

	keyDER, err := x509.MarshalECPrivateKey(privateKey)
	if err != nil {
		return err
	}

	if err = pem.Encode(keyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}); err != nil {
		return err
	}

	return nil
}

// Imports a CA certificate and private key from PEM-encoded strings.
func ImportCABundle(caCertPEM, caKeyPEM string) error {
	certBlock, _ := pem.Decode([]byte(caCertPEM))
	if certBlock == nil {
		return fmt.Errorf("failed to decode CA certificate PEM")
	}

	caCert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse CA certificate: %w", err)
	}

	if !caCert.IsCA {
		return fmt.Errorf("the provided certificate is not a CA certificate")
	}

	keyBlock, _ := pem.Decode([]byte(caKeyPEM))
	if keyBlock == nil {
		return fmt.Errorf("failed to decode CA private key PEM")
	}

	_, err = x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse CA private key: %w", err)
	}

	caCertPath := filepath.Join(ConfDir, TLSCACertFilename)
	caKeyPath := filepath.Join(ConfDir, TLSCAKeyFilename)

	if err := os.WriteFile(caCertPath, []byte(caCertPEM), 0644); err != nil {
		return fmt.Errorf("failed to write CA certificate: %w", err)
	}

	if err := os.WriteFile(caKeyPath, []byte(caKeyPEM), 0600); err != nil {
		return fmt.Errorf("failed to write CA private key: %w", err)
	}

	certPath := filepath.Join(ConfDir, TLSCertFilename)
	keyPath := filepath.Join(ConfDir, TLSKeyFilename)

	if gulu.File.IsExist(certPath) {
		os.Remove(certPath)
	}
	if gulu.File.IsExist(keyPath) {
		os.Remove(keyPath)
	}

	logging.LogInfof("imported CA bundle, server certificate will be regenerated on next TLS initialization")
	return nil
}

// trimIPv6Brackets removes brackets from IPv6 address strings like "[::1]"
func trimIPv6Brackets(ip string) string {
	if len(ip) > 2 && ip[0] == '[' && ip[len(ip)-1] == ']' {
		return ip[1 : len(ip)-1]
	}
	return ip
}

// extractIPsFromServerAddrs extracts IP addresses from server URLs returned by GetServerAddrs()
// GetServerAddrs() returns URLs like "http://192.168.1.1:6806", this function extracts just the IP part
func extractIPsFromServerAddrs() []string {
	serverAddrs := GetServerAddrs()
	var ips []string
	for _, addr := range serverAddrs {
		addr = strings.TrimPrefix(addr, "http://")
		addr = strings.TrimPrefix(addr, "https://")

		if strings.HasPrefix(addr, "[") {
			// IPv6 address with brackets
			if idx := strings.Index(addr, "]:"); idx != -1 {
				addr = addr[1:idx]
			} else if strings.HasSuffix(addr, "]") {
				addr = addr[1 : len(addr)-1]
			}
		} else {
			// IPv4 address or IPv6 without brackets
			if idx := strings.LastIndex(addr, ":"); idx != -1 {
				if strings.Count(addr, ":") == 1 {
					// IPv4 with port
					addr = addr[:idx]
				}
			}
		}
		ips = append(ips, addr)
	}
	return ips
}
