// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package conf

import "testing"

func TestOIDCClientSecretEncryption(t *testing.T) {
	config := &OIDC{ClientSecret: "client-secret"}
	config.EncryptClientSecret()
	if config.ClientSecret == "" || config.ClientSecret == "client-secret" {
		t.Fatal("OIDC client secret was not encrypted")
	}
	config.DecryptClientSecret()
	if config.ClientSecret != "client-secret" {
		t.Fatalf("OIDC client secret did not round trip: %q", config.ClientSecret)
	}
}

func TestOIDCClientSecretDecryptPreservesPlaintextAndMalformedValues(t *testing.T) {
	for _, value := range []string{"plain-client-secret", "00000000000000000000000000000000"} {
		config := &OIDC{ClientSecret: value}
		config.DecryptClientSecret()
		if config.ClientSecret != value {
			t.Fatalf("malformed or plaintext client secret was changed: %q", config.ClientSecret)
		}
	}
}

func TestOIDCNormalizePreservesIssuerIdentifier(t *testing.T) {
	config := &OIDC{IssuerURL: "  https://issuer.example.com/  "}
	config.Normalize()
	if config.IssuerURL != "https://issuer.example.com/" {
		t.Fatalf("OIDC issuer identifier was changed: %q", config.IssuerURL)
	}
}
