// 本文件移植自 https://github.com/grafana/sobek-webapi-encoding 的 encoding/text_decoder.go（提交 5785852a34），
// 按 Apache License 2.0 使用，许可证全文见同目录 LICENSE。
// 修改：以 github.com/dop251/goja 替换 github.com/grafana/sobek。

package encoding

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// TextDecoder represents a decoder for a specific text encoding, such
// as UTF-8, UTF-16LE, or UTF-16BE.
//
// A decoder takes a stream of bytes as input and emits a stream of code points.
//
// See https://encoding.spec.whatwg.org/#textdecoder
type TextDecoder struct {
	TextDecoderCommon

	decoder   encoding.Encoding
	transform transform.Transformer

	buffer []byte
}

// TextDecoderOptions represents the options that can be passed to the
// TextDecoder constructor.
type TextDecoderOptions struct {
	// Fatal holds a boolean value indicating if the TextDecoder.decode()
	// method must throw a TypeError when decoding invalid data.
	//
	// It defaults to false, which means that the decoder will substitute
	// malformed data with a replacement character (U+FFFD).
	Fatal bool `json:"fatal" js:"fatal"`

	// IgnoreBOM holds a boolean value indicating whether the byte order
	// mark (BOM) is ignored.
	IgnoreBOM bool `json:"ignoreBOM" js:"ignoreBOM"`
}

// TextDecoderCommon represents the common subset of the TextDecoder interface
// that is shared between the TextDecoder and TextDecoderStream interfaces.
//
// See https://encoding.spec.whatwg.org/#textdecodercommon
type TextDecoderCommon struct {
	// Encoding holds the name of the decoder, which is a string describing
	// the method the TextDecoder will use.
	Encoding Name `json:"encoding"`

	// Fatal holds a boolean value indicating if the TextDecoder.decode()
	// method must throw a TypeError when decoding invalid data.
	//
	// It defaults to false, which means that the decoder will substitute
	// malformed data with a replacement character (U+FFFD).
	Fatal bool `json:"fatal"`

	// IgnoreBOM holds a boolean value indicating whether the byte order
	// mark (BOM) is ignored.
	IgnoreBOM bool `json:"ignoreBOM"`
}

// NewTextDecoder returns a new TextDecoder object instance that will
// generate a string from a byte stream with a specific encoding.
//
// Implementation follows the WHATWG Encoding spec:
// https://encoding.spec.whatwg.org/#dom-textdecoder
func NewTextDecoder(label string, options TextDecoderOptions) (*TextDecoder, error) {
	// Pick the encoding BOM policy accordingly
	bomPolicy := unicode.IgnoreBOM
	if !options.IgnoreBOM {
		bomPolicy = unicode.UseBOM
	}

	// Step 1: Let encoding be the result of getting an encoding from label.
	var enc Name
	var decoder encoding.Encoding
	// Trim ASCII whitespace only (TAB, LF, FF, CR, SPACE); it's narrower than
	// Unicode whitespace, which get-an-encoding's label trimming step needs.
	switch strings.Trim(strings.ToLower(label), "\t\n\f\r ") {
	case "",
		"unicode-1-1-utf-8",
		"unicode11utf8",
		"unicode20utf8",
		"utf-8",
		"utf8",
		"x-unicode20utf8":
		enc = UTF8EncodingFormat
		decoder = unicode.UTF8
	case "csunicode",
		"iso-10646-ucs-2",
		"ucs-2",
		"unicode",
		"unicodefeff",
		"utf-16",
		"utf-16le":
		enc = UTF16LEEncodingFormat
		decoder = unicode.UTF16(unicode.LittleEndian, bomPolicy)
	case "unicodefffe", "utf-16be":
		enc = UTF16BEEncodingFormat
		decoder = unicode.UTF16(unicode.BigEndian, bomPolicy)
	default:
		// Step 2: If encoding is failure or replacement, throw a RangeError.
		return nil, NewError(RangeError, fmt.Sprintf("unsupported encoding: %s", label))
	}

	// Step 3: Set this's encoding to encoding.
	td := &TextDecoder{}
	td.Encoding = enc
	td.decoder = decoder

	// Step 4: If options["fatal"] is true, set this's error mode to "fatal".
	if options.Fatal {
		td.Fatal = true
	}

	// Step 5: Set this's ignore BOM to options["ignoreBOM"].
	td.IgnoreBOM = options.IgnoreBOM

	return td, nil
}

// appendReplacementCharUTF8 appends the UTF-8 encoded form of U+FFFD.
func appendReplacementCharUTF8(dst []byte) []byte {
	return append(dst, 0xEF, 0xBF, 0xBD)
}

const (
	// utf8MaxBytesPerCodePoint is the max expansion factor for UTF-8 decoding.
	utf8MaxBytesPerCodePoint = 4
	// minTransformBufferSize is the minimum buffer used for streaming transforms.
	minTransformBufferSize = 64
)

// Decode takes a byte stream as input and returns a string.
func (td *TextDecoder) Decode(buffer []byte, options TextDecodeOptions) (string, error) {
	if td.decoder == nil {
		return "", errors.New("encoding not set")
	}

	if td.Encoding == UTF8EncodingFormat {
		return td.decodeUTF8(buffer, options)
	}

	return td.decodeUTF16(buffer, options)
}

func (td *TextDecoder) decodeUTF8(buffer []byte, options TextDecodeOptions) (string, error) {
	stream := options.Stream

	if td.transform == nil {
		decoder := td.decoder.NewDecoder()
		if !td.IgnoreBOM {
			td.transform = unicode.BOMOverride(decoder)
		} else {
			td.transform = decoder
		}
	}

	combined := append(append([]byte{}, td.buffer...), buffer...)
	td.buffer = td.buffer[:0]

	processed, leftover, hadInvalid := sanitizeUTF8Bytes(combined, stream)
	if len(leftover) > 0 {
		td.buffer = append(td.buffer, leftover...)
	}

	atEOF := !stream
	if stream && len(td.buffer) == 0 {
		atEOF = true
	}

	decoded, _, err := td.applyTransform(processed, atEOF)
	if err != nil && !errors.Is(err, transform.ErrShortDst) && !errors.Is(err, transform.ErrShortSrc) {
		if td.Fatal {
			td.resetState()
			return "", NewError(TypeError, "decoding text: "+err.Error())
		}
		return "", err
	}

	if td.Fatal && hadInvalid {
		td.resetState()
		return "", NewError(TypeError, "decoding text: invalid byte sequence")
	}

	if !stream {
		td.resetState()
	}

	return decoded, nil
}

func (td *TextDecoder) decodeUTF16(buffer []byte, options TextDecodeOptions) (string, error) {
	stream := options.Stream

	if td.transform == nil {
		td.transform = td.decoder.NewDecoder()
	}

	// Keep td.buffer as the canonical byte queue so sequences that span multiple
	// calls (e.g., surrogate pairs) remain intact until the transformer consumes
	// them.
	td.buffer = append(td.buffer, buffer...)

	processLen := len(td.buffer)
	var pending []byte

	if stream {
		if processLen%2 == 1 {
			processLen--
		}
	} else if processLen%2 == 1 {
		pending = append(pending, td.buffer[processLen-1])
		processLen--
	}

	var decoded string
	var err error
	var consumed int
	var hadInvalid bool

	if processLen > 0 {
		toDecode := td.buffer[:processLen]
		decoded, consumed, err = td.applyTransform(toDecode, !stream)
		if consumed > 0 {
			hadInvalid = hasInvalidUTF16Surrogate(toDecode[:consumed], td.Encoding == UTF16BEEncodingFormat)
		}
		td.buffer = append(td.buffer[:0], td.buffer[consumed:]...)
	} else {
		decoded, _, err = td.applyTransform(nil, !stream)
	}
	if err != nil && !errors.Is(err, transform.ErrShortDst) && !errors.Is(err, transform.ErrShortSrc) {
		if td.Fatal {
			td.resetState()
			return "", NewError(TypeError, "decoding text: "+err.Error())
		}
		return "", err
	}

	var builder strings.Builder
	builder.WriteString(decoded)

	if len(pending) > 0 {
		if td.Fatal {
			td.resetState()
			return "", NewError(TypeError, "decoding text: invalid byte sequence")
		}
		builder.WriteRune('\uFFFD')
	}

	result := builder.String()

	if td.Fatal && hadInvalid {
		td.resetState()
		return "", NewError(TypeError, "decoding text: invalid byte sequence")
	}

	if !stream {
		td.resetState()
	}

	return result, nil
}

// hasInvalidUTF16Surrogate reports whether data (a sequence of 2-byte code
// units in the given endianness) contains a lone/unpaired UTF-16 surrogate.
//
// The x/text UTF-16 decoder substitutes such sequences with U+FFFD without
// surfacing an error, so this scans the source bytes directly rather than
// inferring invalidity from the decoded output (which cannot distinguish a
// substitution from a legitimately-encoded U+FFFD character).
func hasInvalidUTF16Surrogate(data []byte, bigEndian bool) bool {
	for i := 0; i+1 < len(data); i += 2 {
		unit := decodeUTF16CodeUnit(data[i], data[i+1], bigEndian)

		switch {
		case isUTF16HighSurrogate(unit):
			if i+3 >= len(data) {
				return true
			}

			next := decodeUTF16CodeUnit(data[i+2], data[i+3], bigEndian)
			if !isUTF16LowSurrogate(next) {
				return true
			}

			i += 2
		case isUTF16LowSurrogate(unit):
			return true
		}
	}

	return false
}

func decodeUTF16CodeUnit(b0, b1 byte, bigEndian bool) uint16 {
	if bigEndian {
		return uint16(b0)<<8 | uint16(b1)
	}
	return uint16(b1)<<8 | uint16(b0)
}

func isUTF16HighSurrogate(u uint16) bool {
	return u >= 0xD800 && u <= 0xDBFF
}

func isUTF16LowSurrogate(u uint16) bool {
	return u >= 0xDC00 && u <= 0xDFFF
}

// applyTransform applies the decoder's transformer to the input bytes and returns
// the decoded string along with the number of bytes consumed.
//
// The atEOF parameter indicates whether this is the final chunk of input. When true,
// the transformer will flush any pending state and report errors for incomplete sequences.
// The function handles transform.ErrShortDst by growing the destination buffer as needed.
func (td *TextDecoder) applyTransform(input []byte, atEOF bool) (string, int, error) {
	if td.transform == nil {
		return "", 0, errors.New("transformer not initialized")
	}

	if len(input) == 0 {
		if atEOF {
			empty := make([]byte, 0)
			if _, _, err := td.transform.Transform(empty, empty, true); err != nil &&
				!errors.Is(err, transform.ErrShortDst) &&
				!errors.Is(err, transform.ErrShortSrc) {
				return "", 0, err
			}
		}
		return "", 0, nil
	}

	destSize := max(len(input)*utf8MaxBytesPerCodePoint+minTransformBufferSize, minTransformBufferSize)
	dest := make([]byte, destSize)

	var (
		builder  strings.Builder
		src      = input
		consumed int
	)

	for len(src) > 0 {
		nDst, nSrc, err := td.transform.Transform(dest, src, atEOF)
		builder.Write(dest[:nDst])
		src = src[nSrc:]
		consumed += nSrc

		if err == nil {
			continue
		}

		if errors.Is(err, transform.ErrShortDst) {
			if nSrc == 0 {
				dest = make([]byte, len(dest)*2)
			}
			continue
		}

		if errors.Is(err, transform.ErrShortSrc) && !atEOF {
			break
		}

		if !errors.Is(err, transform.ErrShortSrc) && !errors.Is(err, transform.ErrShortDst) {
			return "", consumed, err
		}
	}

	return builder.String(), consumed, nil
}

func (td *TextDecoder) resetState() {
	if td.transform != nil {
		td.transform.Reset()
		td.transform = nil
	}
	td.buffer = nil
}

// sanitizeUTF8Bytes validates and processes UTF-8 byte sequences, handling
// incomplete and invalid sequences according to the WHATWG Encoding spec.
//
// It returns:
//   - processed: valid UTF-8 bytes with invalid sequences replaced by U+FFFD
//   - leftover: incomplete trailing bytes (only when stream=true)
//   - hadInvalid: true if any invalid sequences were encountered
//
// When stream is true, incomplete multi-byte sequences at the end of the input
// are preserved in leftover for the next chunk. When stream is false (final chunk),
// incomplete sequences are replaced with U+FFFD.
//
// This function implements the "replacement" error mode behavior where malformed
// byte sequences are replaced with the Unicode replacement character (U+FFFD).
//
// This duplicates validation logic golang.org/x/text/encoding/unicode's own
// UTF-8 decoder already contains, but that decoder's Transform cannot be used
// here directly: when it is short on source bytes and atEOF is false, it
// always waits for more data via transform.ErrShortSrc, even if the bytes
// already available prove the sequence malformed (e.g. a lead byte followed
// by a byte outside the valid continuation range). It only resolves such a
// sequence once atEOF is true. The WHATWG spec instead requires detecting an
// invalid continuation byte as soon as it is seen, independent of whether the
// caller is still streaming (see TestTextDecoderUTF8StreamingStateMachine's
// IncompleteThenInvalidContinuation case). Hence this package needs its own
// incremental scan rather than delegating to the transform's error signal.
func sanitizeUTF8Bytes(data []byte, stream bool) (processed []byte, leftover []byte, hadInvalid bool) {
	if len(data) == 0 {
		return nil, nil, false
	}

	processed = make([]byte, 0, len(data))

	for i := 0; i < len(data); {
		b := data[i]

		if b < 0x80 {
			processed = append(processed, b)
			i++
			continue
		}

		var needed int
		switch {
		case b >= 0xC2 && b <= 0xDF:
			needed = 2
		case b >= 0xE0 && b <= 0xEF:
			needed = 3
		case b >= 0xF0 && b <= 0xF4:
			needed = 4
		default:
			hadInvalid = true
			processed = appendReplacementCharUTF8(processed)
			i++
			continue
		}

		validCount := 0
		incomplete := false
		invalidSeq := false
		for j := 1; j < needed; j++ {
			idx := i + j
			if idx >= len(data) {
				if stream {
					leftover = append([]byte{}, data[i:]...)
					return processed, leftover, hadInvalid
				}
				incomplete = true
				break
			}

			cb := data[idx]
			if !isValidContinuationByte(cb) || !passesUTF8RangeChecks(b, j, cb) {
				invalidSeq = true
				break
			}
			validCount++
		}

		if invalidSeq {
			hadInvalid = true
			processed = appendReplacementCharUTF8(processed)
			i += 1 + validCount
			continue
		}

		if incomplete {
			hadInvalid = true
			processed = appendReplacementCharUTF8(processed)
			i += 1 + validCount
			continue
		}

		processed = append(processed, data[i:i+needed]...)
		i += needed
		continue
	}

	return processed, leftover, hadInvalid
}

// isValidContinuationByte checks if a byte is a valid UTF-8 continuation byte.
// Continuation bytes have the bit pattern 10xxxxxx (0x80-0xBF).
func isValidContinuationByte(b byte) bool {
	return b&0xC0 == 0x80
}

// passesUTF8RangeChecks validates that continuation bytes fall within valid ranges
// for specific UTF-8 start bytes. This rejects overlong encodings and surrogate pairs.
//
// The checks are:
//   - 0xE0: First continuation must be >= 0xA0 (rejects overlong 2-byte forms of U+0000-U+07FF)
//   - 0xED: First continuation must be <= 0x9F (rejects surrogate pairs U+D800-U+DFFF)
//   - 0xF0: First continuation must be >= 0x90 (rejects overlong 3-byte forms of U+0000-U+FFFF)
//   - 0xF4: First continuation must be <= 0x8F (rejects code points > U+10FFFF)
func passesUTF8RangeChecks(start byte, position int, cont byte) bool {
	switch start {
	case 0xE0:
		if position == 1 {
			return cont >= 0xA0 && cont <= 0xBF
		}
	case 0xED:
		if position == 1 {
			return cont >= 0x80 && cont <= 0x9F
		}
	case 0xF0:
		if position == 1 {
			return cont >= 0x90 && cont <= 0xBF
		}
	case 0xF4:
		if position == 1 {
			return cont >= 0x80 && cont <= 0x8F
		}
	}
	return true
}

// TextDecodeOptions represents the options that can be passed to the
// TextDecoder.decode() method.
type TextDecodeOptions struct {
	// A boolean flag indicating whether additional data
	// will follow in subsequent calls to decode().
	//
	// Set to true if processing the data in chunks, and
	// false for the final chunk or if the data is not chunked.
	Stream bool `json:"stream" js:"stream"`
}
