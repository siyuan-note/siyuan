package apicontract

import (
	"crypto/dsa"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestNetworkEchoStandardJSON(t *testing.T) {
	builder := &schemaBuilder{definitions: map[string]*Schema{}, owners: map[string]reflect.Type{}}
	parsed, _ := url.Parse("https://name:password@example.com:443/a%20b?q=1#fragment")
	cases := []struct {
		original, wrapped any
		typ               reflect.Type
	}{
		{parsed, EchoURL(parsed), reflect.TypeFor[NetworkEchoURL]()},
		{[]*http.Cookie(nil), EchoCookies(nil), reflect.TypeFor[NetworkEchoCookies]()},
		{[]*http.Cookie{{Name: "session", Value: "x", Expires: time.Unix(0, 0).UTC(), SameSite: http.SameSiteStrictMode}}, EchoCookies([]*http.Cookie{{Name: "session", Value: "x", Expires: time.Unix(0, 0).UTC(), SameSite: http.SameSiteStrictMode}}), reflect.TypeFor[NetworkEchoCookies]()},
	}
	for _, key := range []any{nil, &rsa.PublicKey{N: new(big.Int).Lsh(big.NewInt(1), 2048), E: 65537}, &ecdsa.PublicKey{Curve: elliptic.P256(), X: big.NewInt(1), Y: big.NewInt(2)}, ed25519.PublicKey{0, 1, 255}, &dsa.PublicKey{Parameters: dsa.Parameters{P: big.NewInt(1), Q: big.NewInt(2), G: big.NewInt(3)}, Y: big.NewInt(4)}} {
		cert := &x509.Certificate{SerialNumber: big.NewInt(123), PublicKey: key, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, Subject: pkix.Name{Names: []pkix.AttributeTypeAndValue{{Type: asn1.ObjectIdentifier{2, 5, 4, 3}, Value: "name"}}}}
		state := &tls.ConnectionState{Version: tls.VersionTLS13, HandshakeComplete: true, PeerCertificates: []*x509.Certificate{cert}, VerifiedChains: [][]*x509.Certificate{{cert}}}
		cases = append(cases, struct {
			original, wrapped any
			typ               reflect.Type
		}{state, EchoTLS(state), reflect.TypeFor[NetworkEchoTLS]()})
	}
	for _, tt := range cases {
		expected, err := json.Marshal(tt.original)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(tt.wrapped)
		if err != nil || string(actual) != string(expected) {
			t.Fatalf("standard JSON changed: %s %v", actual, err)
		}
		schema, err := networkEchoSchema(builder, tt.typ)
		if err != nil {
			t.Fatal(err)
		}
		var value any
		decoder := json.NewDecoder(strings.NewReader(string(actual)))
		decoder.UseNumber()
		if err = decoder.Decode(&value); err != nil {
			t.Fatal(err)
		}
		if err = (&Bundle{Definitions: builder.definitions}).validate(schema, value, "$"); err != nil {
			t.Fatalf("%s: %v", tt.typ, err)
		}
	}
}

func TestAPIContractNetworkEchoStableSchema(t *testing.T) {
	builder := &schemaBuilder{definitions: map[string]*Schema{}, owners: map[string]reflect.Type{}}
	for _, typ := range []reflect.Type{reflect.TypeFor[NetworkEchoTLS](), reflect.TypeFor[NetworkEchoURL](), reflect.TypeFor[NetworkEchoCookies]()} {
		if _, err := networkEchoSchema(builder, typ); err != nil {
			t.Fatal(err)
		}
	}
	baseline := map[string]*Schema{}
	for name := range networkEchoDefinitions() {
		definition := *builder.definitions[name]
		definition.AdditionalProperties = false
		baseline[name] = &definition
	}
	data, err := json.Marshal(baseline)
	if err != nil {
		t.Fatal(err)
	}
	var canonical map[string]any
	if err = json.Unmarshal(data, &canonical); err != nil {
		t.Fatal(err)
	}
	data, err = json.Marshal(canonical)
	if err != nil {
		t.Fatal(err)
	}
	// 已发布 Go 1.26 契约的摘要，不包含额外诊断字段的扩展声明。
	const expected = "ff57eab17cce50d147a984e1ce23268394d0dcd84584df64928ee98d3be4bf18"
	if actual := fmt.Sprintf("%x", sha256.Sum256(data)); actual != expected {
		t.Fatalf("published diagnostic fields changed: %s", actual)
	}
	for name, field := range map[string]string{"NetworkEchoConnectionState": "LocalCertificate", "NetworkEchoCertificate": "RawSignatureAlgorithm"} {
		definition := builder.definitions[name]
		if definition.Properties[field] != nil || slices.Contains(definition.Required, field) {
			t.Fatalf("toolchain field %s.%s leaked into generated declarations", name, field)
		}
	}
}

func TestAPIContractNetworkEchoAdditionalDiagnostics(t *testing.T) {
	builder := &schemaBuilder{definitions: map[string]*Schema{}, owners: map[string]reflect.Type{}}
	schema, err := networkEchoSchema(builder, reflect.TypeFor[NetworkEchoTLS]())
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := json.Marshal(&x509.Certificate{SerialNumber: new(big.Int).Lsh(big.NewInt(1), 2048)})
	if err != nil {
		t.Fatal(err)
	}
	var certFields map[string]json.RawMessage
	if err = json.Unmarshal(certificate, &certFields); err != nil {
		t.Fatal(err)
	}
	certFields["RawSignatureAlgorithm"] = json.RawMessage(`{"Tag":16,"Bytes":"AA==","Nested":[null,true,123]}`)
	certificate, err = json.Marshal(certFields)
	if err != nil {
		t.Fatal(err)
	}
	state, err := json.Marshal(&tls.ConnectionState{})
	if err != nil {
		t.Fatal(err)
	}
	var stateFields map[string]json.RawMessage
	if err = json.Unmarshal(state, &stateFields); err != nil {
		t.Fatal(err)
	}
	stateFields["LocalCertificate"] = certificate
	stateFields["PeerCertificates"] = append(append([]byte("["), certificate...), ']')
	validate := func() error {
		encoded, err := json.Marshal(stateFields)
		if err != nil {
			return err
		}
		decoder := json.NewDecoder(strings.NewReader(string(encoded)))
		decoder.UseNumber()
		var value any
		if err = decoder.Decode(&value); err != nil {
			return err
		}
		return (&Bundle{Definitions: builder.definitions}).validate(schema, value, "$")
	}
	if err = validate(); err != nil {
		t.Fatalf("additional diagnostics rejected: %v", err)
	}
	stateFields["Version"] = json.RawMessage(`"invalid"`)
	if err = validate(); err == nil {
		t.Fatal("invalid published field accepted")
	}
	delete(stateFields, "Version")
	if err = validate(); err == nil {
		t.Fatal("missing published field accepted")
	}
}

func TestNetworkForwardCompatibility(t *testing.T) {
	for _, body := range []string{`{"url":" https://example.com ","method":null,"timeout":null,"responseEncoding":12,"redirect":"false","headers":[null,1,{"X-A":null},{"X-B":[1,true]}],"payload":{"n":9007199254740993}}`, `{"url":"https://example.com","headers":{},"redirect":null}`} {
		request, err := NetworkForwardProxy.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if request.URL != "https://example.com" {
			t.Fatal("URL trim changed")
		}
		options, err := request.Options()
		if err != nil {
			t.Fatal(err)
		}
		if options.Redirect != nil || options.ResponseEncoding != "" {
			t.Fatal("ignored option compatibility changed")
		}
		if strings.Contains(body, "9007199254740993") {
			if len(options.Headers) != 2 {
				t.Fatal("heterogeneous headers changed")
			}
			encoded, _ := options.Payload.MarshalJSON()
			if string(encoded) != `{"n":9007199254740992}` {
				t.Fatalf("legacy float normalization changed: %s", encoded)
			}
		}
	}
	request, err := NetworkForwardProxy.Decode(strings.NewReader(`{"url":"invalid","method":3}`))
	if err != nil {
		t.Fatal("options decoded before URL validation", err)
	}
	if _, err = request.Options(); err == nil {
		t.Fatal("invalid method accepted")
	}
}
