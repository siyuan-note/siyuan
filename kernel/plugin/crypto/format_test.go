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

package crypto

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"testing"
)

// formatCase 描述一个算法的密钥格式往返用例。
type formatCase struct {
	label    string
	alg      Algorithm
	usages   []KeyUsage
	jwkKty   string
	jwkCrv   string
	jwkAlg   string
	rawIsPub bool // raw 格式是否仅支持公钥
}

func asymmetricFormatCases() []formatCase {
	rsa := func(name string, hash string) Algorithm {
		return Algorithm{Name: name, Hash: hash, ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}}
	}

	return []formatCase{
		{label: "RSASSA-PKCS1-v1_5", alg: rsa(AlgRSASSAPKCS1, AlgSHA256),
			usages: []KeyUsage{UsageSign, UsageVerify}, jwkKty: "RSA", jwkAlg: "RS256"},
		{label: "RSA-PSS", alg: rsa(AlgRSAPSS, AlgSHA384),
			usages: []KeyUsage{UsageSign, UsageVerify}, jwkKty: "RSA", jwkAlg: "PS384"},
		{label: "RSA-OAEP", alg: rsa(AlgRSAOAEP, AlgSHA256),
			usages: []KeyUsage{UsageEncrypt, UsageDecrypt}, jwkKty: "RSA", jwkAlg: "RSA-OAEP-256"},
		{label: "ECDSA P-256", alg: Algorithm{Name: AlgECDSA, Hash: AlgSHA256, NamedCurve: CurveP256},
			usages: []KeyUsage{UsageSign, UsageVerify}, jwkKty: "EC", jwkCrv: CurveP256,
			jwkAlg: "ES256", rawIsPub: true},
		{label: "ECDH P-384", alg: Algorithm{Name: AlgECDH, NamedCurve: CurveP384},
			usages: []KeyUsage{UsageDeriveBits}, jwkKty: "EC", jwkCrv: CurveP384, rawIsPub: true},
		{label: "Ed25519", alg: Algorithm{Name: AlgEd25519},
			usages: []KeyUsage{UsageSign, UsageVerify}, jwkKty: "OKP", jwkCrv: "Ed25519", rawIsPub: true},
		{label: "X25519", alg: Algorithm{Name: AlgX25519},
			usages: []KeyUsage{UsageDeriveBits}, jwkKty: "OKP", jwkCrv: "X25519", rawIsPub: true},
	}
}

// publicUsagesOf 返回用例中属于公钥的用法。
func publicUsagesOf(c formatCase) []KeyUsage {
	_, public := splitAsymmetricUsages(c.alg.Name, c.usages)
	return public
}

// privateUsagesOf 返回用例中属于私钥的用法。
func privateUsagesOf(c formatCase) []KeyUsage {
	private, _ := splitAsymmetricUsages(c.alg.Name, c.usages)
	return private
}

func TestSPKIAndPKCS8RoundTrip(t *testing.T) {
	for _, c := range asymmetricFormatCases() {
		pair, err := GenerateKey(c.alg, true, c.usages)
		if err != nil {
			t.Fatalf("%s: %v", c.label, err)
		}

		// 公钥走 spki。
		spki, err := ExportKey(FormatSPKI, pair.PublicKey)
		if err != nil {
			t.Fatalf("%s: export spki: %v", c.label, err)
		}
		reimportedPublic, err := ImportKey(FormatSPKI, KeyData{Raw: spki.Raw}, c.alg, true, publicUsagesOf(c))
		if err != nil {
			t.Fatalf("%s: import spki: %v", c.label, err)
		}
		if reimportedPublic.Type != KeyTypePublic {
			t.Fatalf("%s: imported key type = %s", c.label, reimportedPublic.Type)
		}
		again, err := ExportKey(FormatSPKI, reimportedPublic)
		if err != nil {
			t.Fatalf("%s: re-export spki: %v", c.label, err)
		}
		if !bytes.Equal(spki.Raw, again.Raw) {
			t.Fatalf("%s: spki round trip changed the encoding", c.label)
		}

		// 私钥走 pkcs8。
		pkcs8, err := ExportKey(FormatPKCS8, pair.PrivateKey)
		if err != nil {
			t.Fatalf("%s: export pkcs8: %v", c.label, err)
		}
		reimportedPrivate, err := ImportKey(FormatPKCS8, KeyData{Raw: pkcs8.Raw}, c.alg, true, privateUsagesOf(c))
		if err != nil {
			t.Fatalf("%s: import pkcs8: %v", c.label, err)
		}
		if reimportedPrivate.Type != KeyTypePrivate {
			t.Fatalf("%s: imported key type = %s", c.label, reimportedPrivate.Type)
		}
		again, err = ExportKey(FormatPKCS8, reimportedPrivate)
		if err != nil {
			t.Fatalf("%s: re-export pkcs8: %v", c.label, err)
		}
		if !bytes.Equal(pkcs8.Raw, again.Raw) {
			t.Fatalf("%s: pkcs8 round trip changed the encoding", c.label)
		}

		// 格式与密钥类型必须匹配。
		if _, err = ExportKey(FormatPKCS8, pair.PublicKey); errorName(t, err) != ErrNameInvalidAccess {
			t.Fatalf("%s: exporting a public key as pkcs8: error = %v", c.label, err)
		}
		if _, err = ExportKey(FormatSPKI, pair.PrivateKey); errorName(t, err) != ErrNameInvalidAccess {
			t.Fatalf("%s: exporting a private key as spki: error = %v", c.label, err)
		}
	}
}

func TestAsymmetricJWKRoundTrip(t *testing.T) {
	for _, c := range asymmetricFormatCases() {
		pair, err := GenerateKey(c.alg, true, c.usages)
		if err != nil {
			t.Fatalf("%s: %v", c.label, err)
		}

		for _, entry := range []struct {
			kind   string
			key    *Key
			usages []KeyUsage
		}{
			{"public", pair.PublicKey, publicUsagesOf(c)},
			{"private", pair.PrivateKey, privateUsagesOf(c)},
		} {
			data, exportErr := ExportKey(FormatJWK, entry.key)
			if exportErr != nil {
				t.Fatalf("%s %s: export jwk: %v", c.label, entry.kind, exportErr)
			}

			var jwk map[string]any
			if err = json.Unmarshal(data.JSON, &jwk); err != nil {
				t.Fatalf("%s %s: %v", c.label, entry.kind, err)
			}
			if jwk["kty"] != c.jwkKty {
				t.Errorf("%s %s: kty = %v, want %s", c.label, entry.kind, jwk["kty"], c.jwkKty)
			}
			if c.jwkCrv != "" && jwk["crv"] != c.jwkCrv {
				t.Errorf("%s %s: crv = %v, want %s", c.label, entry.kind, jwk["crv"], c.jwkCrv)
			}
			if c.jwkAlg != "" && jwk["alg"] != c.jwkAlg {
				t.Errorf("%s %s: alg = %v, want %s", c.label, entry.kind, jwk["alg"], c.jwkAlg)
			}
			if ext, ok := jwk["ext"].(bool); !ok || !ext {
				t.Errorf("%s %s: ext = %v, want true", c.label, entry.kind, jwk["ext"])
			}
			// 私钥必须含 d 成员，公钥不能含。
			_, hasD := jwk["d"]
			if entry.kind == "private" && !hasD {
				t.Errorf("%s private: jwk is missing the d member", c.label)
			}
			if entry.kind == "public" && hasD {
				t.Errorf("%s public: jwk contains the d member", c.label)
			}
			// go-jose 的 use/kid 不应出现在输出中。
			if _, ok := jwk["use"]; ok {
				t.Errorf("%s %s: jwk contains an unexpected use member", c.label, entry.kind)
			}

			reimported, importErr := ImportKey(FormatJWK, KeyData{JSON: data.JSON}, c.alg, true, entry.usages)
			if importErr != nil {
				t.Fatalf("%s %s: import jwk: %v", c.label, entry.kind, importErr)
			}
			if string(reimported.Type) != entry.kind {
				t.Fatalf("%s %s: imported key type = %s", c.label, entry.kind, reimported.Type)
			}

			// 再次导出必须得到相同的密钥材料。
			againData, exportErr := ExportKey(FormatJWK, reimported)
			if exportErr != nil {
				t.Fatalf("%s %s: re-export jwk: %v", c.label, entry.kind, exportErr)
			}
			var again map[string]any
			if err = json.Unmarshal(againData.JSON, &again); err != nil {
				t.Fatal(err)
			}
			for _, member := range []string{"kty", "crv", "n", "e", "x", "y", "d"} {
				if jwk[member] != again[member] {
					t.Errorf("%s %s: jwk member %s changed: %v -> %v",
						c.label, entry.kind, member, jwk[member], again[member])
				}
			}
		}
	}
}

func TestRawFormatForPublicKeys(t *testing.T) {
	for _, c := range asymmetricFormatCases() {
		if !c.rawIsPub {
			continue
		}

		pair, err := GenerateKey(c.alg, true, c.usages)
		if err != nil {
			t.Fatalf("%s: %v", c.label, err)
		}

		data, err := ExportKey(FormatRaw, pair.PublicKey)
		if err != nil {
			t.Fatalf("%s: export raw: %v", c.label, err)
		}
		// EC 公钥为未压缩点，OKP 公钥为 32 字节。
		switch c.jwkKty {
		case "EC":
			if data.Raw[0] != 4 {
				t.Fatalf("%s: raw public key is not an uncompressed point", c.label)
			}
		case "OKP":
			if len(data.Raw) != 32 {
				t.Fatalf("%s: raw public key length = %d, want 32", c.label, len(data.Raw))
			}
		}

		reimported, err := ImportKey(FormatRaw, KeyData{Raw: data.Raw}, c.alg, true, publicUsagesOf(c))
		if err != nil {
			t.Fatalf("%s: import raw: %v", c.label, err)
		}
		again, err := ExportKey(FormatRaw, reimported)
		if err != nil {
			t.Fatalf("%s: re-export raw: %v", c.label, err)
		}
		if !bytes.Equal(data.Raw, again.Raw) {
			t.Fatalf("%s: raw round trip changed the key material", c.label)
		}

		// 私钥不支持 raw 格式。
		if _, err = ExportKey(FormatRaw, pair.PrivateKey); errorName(t, err) != ErrNameInvalidAccess {
			t.Fatalf("%s: exporting a private key as raw: error = %v", c.label, err)
		}
	}
}

func TestImportRejectsMismatchedKeyMaterial(t *testing.T) {
	// 用 P-256 的密钥冒充 P-384。
	p256, err := GenerateKey(Algorithm{Name: AlgECDSA, Hash: AlgSHA256, NamedCurve: CurveP256},
		true, []KeyUsage{UsageSign, UsageVerify})
	if err != nil {
		t.Fatal(err)
	}
	spki, err := ExportKey(FormatSPKI, p256.PublicKey)
	if err != nil {
		t.Fatal(err)
	}

	wrongCurve := Algorithm{Name: AlgECDSA, Hash: AlgSHA256, NamedCurve: CurveP384}
	if _, err = ImportKey(FormatSPKI, KeyData{Raw: spki.Raw}, wrongCurve, true, []KeyUsage{UsageVerify}); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}

	// 用 X25519 的密钥冒充 ECDH P-256。
	x25519, err := GenerateKey(Algorithm{Name: AlgX25519}, true, []KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatal(err)
	}
	xSPKI, err := ExportKey(FormatSPKI, x25519.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	ecdhAlg := Algorithm{Name: AlgECDH, NamedCurve: CurveP256}
	if _, err = ImportKey(FormatSPKI, KeyData{Raw: xSPKI.Raw}, ecdhAlg, true, nil); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}

	// 用 RSA 的密钥冒充 Ed25519。
	rsaPair, err := GenerateKey(Algorithm{Name: AlgRSASSAPKCS1, Hash: AlgSHA256,
		ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}}, true, []KeyUsage{UsageSign, UsageVerify})
	if err != nil {
		t.Fatal(err)
	}
	rsaSPKI, err := ExportKey(FormatSPKI, rsaPair.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ImportKey(FormatSPKI, KeyData{Raw: rsaSPKI.Raw},
		Algorithm{Name: AlgEd25519}, true, []KeyUsage{UsageVerify}); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}

	// 无效的 DER 数据。
	if _, err = ImportKey(FormatSPKI, KeyData{Raw: []byte{1, 2, 3}},
		Algorithm{Name: AlgEd25519}, true, []KeyUsage{UsageVerify}); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}
}

func TestOKPJWKRejectsInconsistentKeyPair(t *testing.T) {
	for _, algName := range []string{AlgEd25519, AlgX25519} {
		usages := []KeyUsage{UsageSign}
		if algName == AlgX25519 {
			usages = []KeyUsage{UsageDeriveBits}
		}
		alg := Algorithm{Name: algName}

		first, err := GenerateKey(alg, true, usages)
		if err != nil {
			t.Fatalf("%s: %v", algName, err)
		}
		second, err := GenerateKey(alg, true, usages)
		if err != nil {
			t.Fatalf("%s: %v", algName, err)
		}

		firstData, err := ExportKey(FormatJWK, first.PrivateKey)
		if err != nil {
			t.Fatalf("%s: %v", algName, err)
		}
		secondData, err := ExportKey(FormatJWK, second.PrivateKey)
		if err != nil {
			t.Fatalf("%s: %v", algName, err)
		}

		var firstJWK, secondJWK map[string]any
		if err = json.Unmarshal(firstData.JSON, &firstJWK); err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(secondData.JSON, &secondJWK); err != nil {
			t.Fatal(err)
		}

		// 把私钥的 d 换成另一个密钥的，公钥不变。
		firstJWK["d"] = secondJWK["d"]
		mixed, err := json.Marshal(firstJWK)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = ImportKey(FormatJWK, KeyData{JSON: mixed}, alg, true, usages); errorName(t, err) != ErrNameData {
			t.Fatalf("%s: error = %v, want DataError", algName, err)
		}
	}
}

func TestECJWKRejectsInvalidPrivateKey(t *testing.T) {
	// P-256 的阶 n，d 必须小于它。
	order := "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"

	for _, c := range []struct {
		alg         Algorithm
		usages      []KeyUsage
		importUsage KeyUsage
	}{
		{Algorithm{Name: AlgECDSA, NamedCurve: CurveP256}, []KeyUsage{UsageSign, UsageVerify}, UsageSign},
		{Algorithm{Name: AlgECDH, NamedCurve: CurveP256}, []KeyUsage{UsageDeriveBits}, UsageDeriveBits},
	} {
		first, err := GenerateKey(c.alg, true, c.usages)
		if err != nil {
			t.Fatalf("%s: %v", c.alg.Name, err)
		}
		second, err := GenerateKey(c.alg, true, c.usages)
		if err != nil {
			t.Fatalf("%s: %v", c.alg.Name, err)
		}

		firstData, err := ExportKey(FormatJWK, first.PrivateKey)
		if err != nil {
			t.Fatalf("%s: %v", c.alg.Name, err)
		}
		secondData, err := ExportKey(FormatJWK, second.PrivateKey)
		if err != nil {
			t.Fatalf("%s: %v", c.alg.Name, err)
		}
		var firstJWK, secondJWK map[string]any
		if err = json.Unmarshal(firstData.JSON, &firstJWK); err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(secondData.JSON, &secondJWK); err != nil {
			t.Fatal(err)
		}

		// d 来自另一把密钥、为 0 或等于曲线阶时都必须拒绝，x 与 y 保持不变。
		for label, d := range map[string]any{
			"d from another key": secondJWK["d"],
			"d = 0":              base64.RawURLEncoding.EncodeToString(make([]byte, 32)),
			"d = n":              base64.RawURLEncoding.EncodeToString(mustHex(t, order)),
		} {
			invalid := map[string]any{}
			for member, value := range firstJWK {
				invalid[member] = value
			}
			invalid["d"] = d

			data, marshalErr := json.Marshal(invalid)
			if marshalErr != nil {
				t.Fatal(marshalErr)
			}
			_, err = ImportKey(FormatJWK, KeyData{JSON: data}, c.alg, true, []KeyUsage{c.importUsage})
			if name := errorName(t, err); name != ErrNameData {
				t.Errorf("%s %s: error name = %q, want %q", c.alg.Name, label, name, ErrNameData)
			}
		}

		// 原样导入的私钥仍然可用。
		if _, err = ImportKey(FormatJWK, KeyData{JSON: firstData.JSON}, c.alg, true,
			[]KeyUsage{c.importUsage}); err != nil {
			t.Fatalf("%s: %v", c.alg.Name, err)
		}
	}
}

func TestOKPJWKRejectsWrongCurve(t *testing.T) {
	ed, err := GenerateKey(Algorithm{Name: AlgEd25519}, true, []KeyUsage{UsageSign})
	if err != nil {
		t.Fatal(err)
	}
	data, err := ExportKey(FormatJWK, ed.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}

	// Ed25519 的 JWK 不能当作 X25519 导入。
	if _, err = ImportKey(FormatJWK, KeyData{JSON: data.JSON},
		Algorithm{Name: AlgX25519}, true, []KeyUsage{UsageDeriveBits}); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}
}

func TestExportedKeyPairInteroperates(t *testing.T) {
	// 导入导出后的密钥必须仍能与原密钥互相验证。
	alg := Algorithm{Name: AlgECDSA, Hash: AlgSHA256, NamedCurve: CurveP256}
	pair, err := GenerateKey(alg, true, []KeyUsage{UsageSign, UsageVerify})
	if err != nil {
		t.Fatal(err)
	}

	pkcs8, err := ExportKey(FormatPKCS8, pair.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	importedPrivate, err := ImportKey(FormatPKCS8, KeyData{Raw: pkcs8.Raw}, alg, true, []KeyUsage{UsageSign})
	if err != nil {
		t.Fatal(err)
	}

	data := []byte("cross-check")
	signature, err := Sign(alg, importedPrivate, data)
	if err != nil {
		t.Fatal(err)
	}
	// 用原始公钥校验导入私钥产生的签名。
	ok, err := Verify(alg, pair.PublicKey, signature, data)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("the original public key could not verify the imported private key's signature")
	}
}
