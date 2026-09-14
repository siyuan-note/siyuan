package apicontract

import (
	"crypto/dsa"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"reflect"
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
