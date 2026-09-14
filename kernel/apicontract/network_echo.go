package apicontract

import (
	"crypto/dsa"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
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
	"sort"
	"strings"
	"time"
)

// 标准库诊断对象保持其原始 JSON 编码；专用 schema 完整描述它们的字段和有限多态值。
type NetworkEchoTLS struct{ value *tls.ConnectionState }
type NetworkEchoURL struct{ value *url.URL }
type NetworkEchoCookies struct{ value []*http.Cookie }

func EchoTLS(value *tls.ConnectionState) *NetworkEchoTLS {
	if value == nil {
		return nil
	}
	return &NetworkEchoTLS{value: value}
}
func EchoURL(value *url.URL) *NetworkEchoURL {
	if value == nil {
		return nil
	}
	return &NetworkEchoURL{value: value}
}
func EchoCookies(value []*http.Cookie) NetworkEchoCookies     { return NetworkEchoCookies{value: value} }
func (value NetworkEchoTLS) MarshalJSON() ([]byte, error)     { return json.Marshal(value.value) }
func (value NetworkEchoURL) MarshalJSON() ([]byte, error)     { return json.Marshal(value.value) }
func (value NetworkEchoCookies) MarshalJSON() ([]byte, error) { return json.Marshal(value.value) }

func networkEchoSchema(b *schemaBuilder, t reflect.Type) (*Schema, error) {
	switch t {
	case reflect.TypeFor[NetworkEchoTLS]():
		return networkEchoStandardSchema(b, reflect.TypeFor[tls.ConnectionState]())
	case reflect.TypeFor[NetworkEchoURL]():
		return networkEchoStandardSchema(b, reflect.TypeFor[url.URL]())
	case reflect.TypeFor[NetworkEchoCookies]():
		return networkEchoStandardSchema(b, reflect.TypeFor[[]*http.Cookie]())
	}
	return nil, fmt.Errorf("unsupported network echo wrapper: %s", t)
}

func networkEchoStandardSchema(b *schemaBuilder, t reflect.Type) (*Schema, error) {
	if t.Kind() == reflect.Pointer {
		child, err := networkEchoStandardSchema(b, t.Elem())
		if err != nil {
			return nil, err
		}
		return nullable(child), nil
	}
	switch t {
	case reflect.TypeFor[time.Time](), reflect.TypeFor[net.IP](), reflect.TypeFor[x509.OID]():
		return &Schema{Type: "string"}, nil
	case reflect.TypeFor[big.Int]():
		return &Schema{Type: "integer"}, nil
	}
	switch t.Kind() {
	case reflect.Bool:
		return &Schema{Type: "boolean"}, nil
	case reflect.String:
		return &Schema{Type: "string"}, nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return &Schema{Type: "integer"}, nil
	case reflect.Slice:
		if t.Elem().Kind() == reflect.Uint8 {
			return nullable(&Schema{Type: "string"}), nil
		}
		child, err := networkEchoStandardSchema(b, t.Elem())
		if err != nil {
			return nil, err
		}
		return nullable(&Schema{Type: "array", Items: child}), nil
	case reflect.Struct:
		name := "NetworkEcho" + t.Name()
		if t.Name() == "PublicKey" {
			name = "NetworkEcho" + strings.ToUpper(strings.TrimPrefix(t.PkgPath(), "crypto/")) + t.Name()
		}
		if owner, exists := b.owners[name]; exists {
			if owner != t {
				return nil, fmt.Errorf("conflicting echo type: %s", name)
			}
			return &Schema{Ref: "#/$defs/" + name}, nil
		}
		b.owners[name] = t
		result := object(map[string]*Schema{})
		b.definitions[name] = result
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			if !field.IsExported() {
				continue
			}
			var child *Schema
			var err error
			switch {
			case t == reflect.TypeFor[x509.Certificate]() && field.Name == "PublicKey":
				child, err = networkEchoPublicKeySchema(b)
			case t == reflect.TypeFor[pkix.AttributeTypeAndValue]() && field.Name == "Value":
				child, err = networkEchoASN1Schema(b)
			case t == reflect.TypeFor[ecdsa.PublicKey]() && field.Name == "Curve":
				var parameters *Schema
				parameters, err = networkEchoStandardSchema(b, reflect.TypeFor[elliptic.CurveParams]())
				child = nullable(&Schema{AnyOf: []*Schema{object(map[string]*Schema{}), parameters}})
			default:
				child, err = networkEchoStandardSchema(b, field.Type)
			}
			if err != nil {
				return nil, fmt.Errorf("%s.%s: %w", t, field.Name, err)
			}
			if field.Anonymous && field.Type.Kind() == reflect.Struct {
				// DSA 的嵌入参数是标准结构体，JSON 展平其导出字段。
				embedded := b.definitions["NetworkEcho"+field.Type.Name()]
				if embedded == nil {
					return nil, fmt.Errorf("unsupported embedded echo type: %s", field.Type)
				}
				for key, value := range embedded.Properties {
					result.Properties[key] = value
				}
				result.Required = append(result.Required, embedded.Required...)
			} else {
				result.Properties[field.Name] = child
				result.Required = append(result.Required, field.Name)
			}
		}
		sort.Strings(result.Required)
		return &Schema{Ref: "#/$defs/" + name}, nil
	default:
		return nil, fmt.Errorf("unsupported network echo standard type: %s", t)
	}
}

func networkEchoPublicKeySchema(b *schemaBuilder) (*Schema, error) {
	variants := []*Schema{{Type: "null"}, {Type: "string"}}
	for _, t := range []reflect.Type{reflect.TypeFor[rsa.PublicKey](), reflect.TypeFor[ecdsa.PublicKey](), reflect.TypeFor[dsa.PublicKey]()} {
		variant, err := networkEchoStandardSchema(b, t)
		if err != nil {
			return nil, err
		}
		variants = append(variants, variant)
	}
	return &Schema{AnyOf: variants}, nil
}

func networkEchoASN1Schema(b *schemaBuilder) (*Schema, error) {
	raw, err := networkEchoStandardSchema(b, reflect.TypeFor[asn1.RawValue]())
	if err != nil {
		return nil, err
	}
	bitString, err := networkEchoStandardSchema(b, reflect.TypeFor[asn1.BitString]())
	if err != nil {
		return nil, err
	}
	return &Schema{AnyOf: []*Schema{{Type: "null"}, {Type: "string"}, {Type: "integer"}, {Type: "boolean"}, {Type: "array", Items: &Schema{Type: "integer"}}, raw, bitString}}, nil
}
