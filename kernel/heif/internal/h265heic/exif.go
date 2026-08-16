package heic

import (
	"encoding/binary"
	"errors"
	"io"
	"slices"
)

// ErrNoExif is returned when the file carries no Exif item.
var ErrNoExif = errors.New("avif: no exif data")

// ErrNoXMP is returned when the file carries no XMP item.
var ErrNoXMP = errors.New("avif: no xmp data")

const xmpContentType = "application/rdf+xml"

// Exif holds the Exif metadata decoded from an HEIC image.
type Exif struct {
	// Orientation is the Exif orientation, 1 to 8, where 1 is upright.
	Orientation int
	// Width and Height are the dimensions the Exif tags report, which need
	// not be the dimensions the image decodes to.
	Width  int
	Height int

	// Make and Model name the camera, Software what wrote the file.
	Make     string
	Model    string
	Software string

	// DateTime and DateTimeOriginal are "YYYY:MM:DD HH:MM:SS", the first the
	// file's own time and the second the time the photo was taken.
	DateTime         string
	DateTimeOriginal string

	// ExposureTime is in seconds and FocalLength in millimetres.
	ExposureTime float64
	FNumber      float64
	ISOSpeed     int
	FocalLength  float64
	Flash        int

	// GPSLatitude and GPSLongitude are decimal degrees, positive north and
	// east. GPSAltitude is metres above sea level.
	GPSLatitude  float64
	GPSLongitude float64
	GPSAltitude  float64

	Copyright string
	Artist    string
}

// DecodeExif reads the Exif metadata of an HEIC image. Tags the file omits
// stay zero. It returns ErrNoExif when the file carries no Exif item.
func DecodeExif(r io.Reader) (*Exif, error) {
	tiff, err := RawExif(r)
	if err != nil {
		return nil, err
	}

	exif := &Exif{Orientation: 1}
	if err := parseExifData(tiff, exif); err != nil {
		return nil, err
	}

	return exif, nil
}

// RawExif returns the TIFF payload of the Exif item, without the
// exif_tiff_header_offset the HEIC container puts in front of it. It aliases a
// buffered input rather than copying it, so it must not be written to.
func RawExif(r io.Reader) ([]byte, error) {
	f, err := readFile(r)
	if err != nil {
		return nil, err
	}

	it := f.descItem("Exif", "")
	if it == nil {
		return nil, ErrNoExif
	}
	b, err := f.meta.data(it, f.src)
	if err != nil {
		return nil, err
	}
	tiff := exifTIFF(b)
	if tiff == nil {
		return nil, ErrNoExif
	}

	return tiff, nil
}

// RawXMP returns the XMP packet of the file. It aliases a buffered input
// rather than copying it, so it must not be written to.
func RawXMP(r io.Reader) ([]byte, error) {
	f, err := readFile(r)
	if err != nil {
		return nil, err
	}

	it := f.descItem("mime", xmpContentType)
	if it == nil {
		return nil, ErrNoXMP
	}

	return f.meta.data(it, f.src)
}

func readFile(r io.Reader) (*file, error) {
	src, err := srcFor(r)
	if err != nil {
		return nil, err
	}

	return parse(src)
}

// descItem finds the metadata item describing the primary image. A file with
// no image item at all still gives up its metadata.
func (f *file) descItem(typ, contentType string) *item {
	m := f.meta
	primary, _ := f.primary()

	for _, id := range m.order {
		it := m.items[id]
		if it == nil || it.typ != typ || it.unsupported {
			continue
		}
		if it.contentType != contentType {
			continue
		}
		if primary != nil && !slices.Contains(m.refsTo("cdsc", it.id), primary.id) {
			continue
		}

		return it
	}

	return nil
}

func isTIFFHeader(b []byte) bool {
	if len(b) < 4 {
		return false
	}

	return (b[0] == 'I' && b[1] == 'I' && b[2] == 42 && b[3] == 0) ||
		(b[0] == 'M' && b[1] == 'M' && b[2] == 0 && b[3] == 42)
}

// exifTIFF strips the exif_tiff_header_offset of ISO/IEC 23008-12 Annex A.2.1.
// A file that gets the offset wrong still parses, from the header found by
// scanning, which is the offset the writer should have signalled.
func exifTIFF(b []byte) []byte {
	if len(b) < 4 {
		return nil
	}
	off := uint64(binary.BigEndian.Uint32(b))
	b = b[4:]

	if off <= uint64(len(b)) && isTIFFHeader(b[off:]) {
		return b[off:]
	}
	for i := range b {
		if isTIFFHeader(b[i:]) {
			return b[i:]
		}
	}

	return nil
}

const (
	tagOrientation    = 0x0112
	tagImageWidth     = 0x0100
	tagImageLength    = 0x0101
	tagMake           = 0x010F
	tagModel          = 0x0110
	tagSoftware       = 0x0131
	tagDateTime       = 0x0132
	tagArtist         = 0x013B
	tagCopyright      = 0x8298
	tagExifIFDPointer = 0x8769
	tagGPSIFDPointer  = 0x8825

	tagExposureTime     = 0x829A
	tagFNumber          = 0x829D
	tagISOSpeedRatings  = 0x8827
	tagDateTimeOriginal = 0x9003
	tagFlash            = 0x9209
	tagFocalLength      = 0x920A

	tagGPSLatitudeRef  = 0x0001
	tagGPSLatitude     = 0x0002
	tagGPSLongitudeRef = 0x0003
	tagGPSLongitude    = 0x0004
	tagGPSAltitudeRef  = 0x0005
	tagGPSAltitude     = 0x0006
)

const (
	typeUnsignedByte     = 1
	typeASCIIString      = 2
	typeUnsignedShort    = 3
	typeUnsignedLong     = 4
	typeUnsignedRational = 5
	typeSignedByte       = 6
	typeUndefined        = 7
	typeSignedShort      = 8
	typeSignedLong       = 9
	typeSignedRational   = 10
	typeSingleFloat      = 11
	typeDoubleFloat      = 12
)

type exifReader struct {
	data         []byte
	littleEndian bool
}

func (r *exifReader) uint16(offset int) uint16 {
	if offset < 0 || offset+1 >= len(r.data) {
		return 0
	}
	if r.littleEndian {
		return uint16(r.data[offset]) | uint16(r.data[offset+1])<<8
	}

	return uint16(r.data[offset])<<8 | uint16(r.data[offset+1])
}

func (r *exifReader) uint32(offset int) uint32 {
	if offset < 0 || offset+3 >= len(r.data) {
		return 0
	}
	if r.littleEndian {
		return uint32(r.data[offset]) | uint32(r.data[offset+1])<<8 |
			uint32(r.data[offset+2])<<16 | uint32(r.data[offset+3])<<24
	}

	return uint32(r.data[offset])<<24 | uint32(r.data[offset+1])<<16 |
		uint32(r.data[offset+2])<<8 | uint32(r.data[offset+3])
}

func (r *exifReader) readString(offset, maxLen int) string {
	if offset < 0 || offset >= len(r.data) {
		return ""
	}
	end := offset
	for end < len(r.data) && end < offset+maxLen && r.data[end] != 0 {
		end++
	}

	return string(r.data[offset:end])
}

func (r *exifReader) readRational(offset int) float64 {
	if offset < 0 || offset+7 >= len(r.data) {
		return 0
	}
	num, den := r.uint32(offset), r.uint32(offset+4)
	if den == 0 {
		return 0
	}

	return float64(num) / float64(den)
}

func parseExifData(data []byte, exif *Exif) error {
	if len(data) < 8 {
		return errors.New("avif: exif data too short")
	}

	r := &exifReader{data: data}
	switch {
	case data[0] == 'I' && data[1] == 'I':
		r.littleEndian = true
	case data[0] == 'M' && data[1] == 'M':
	default:
		return errors.New("avif: invalid exif byte order marker")
	}

	if r.uint16(2) != 42 {
		return errors.New("avif: invalid exif magic number")
	}

	ifdOffset := r.uint32(4)
	if ifdOffset < 8 || int(ifdOffset) >= len(data) {
		return errors.New("avif: invalid exif ifd offset")
	}

	exifIFDOffset, gpsIFDOffset := parseIFD(r, int(ifdOffset), exif)
	if exifIFDOffset > 0 {
		parseExifSubIFD(r, exifIFDOffset, exif)
	}
	if gpsIFDOffset > 0 {
		parseGPSSubIFD(r, gpsIFDOffset, exif)
	}

	return nil
}

// eachEntry walks the entries of an IFD, resolving each value to its offset.
func eachEntry(r *exifReader, offset int, fn func(tag, dataType uint16, count uint32, valueOffset int)) {
	if offset < 0 || offset+1 >= len(r.data) {
		return
	}

	n := int(r.uint16(offset))
	offset += 2

	for i := range n {
		entry := offset + i*12
		if entry+11 >= len(r.data) {
			break
		}

		tag := r.uint16(entry)
		dataType := r.uint16(entry + 2)
		count := r.uint32(entry + 4)
		valueOffset := entry + 8

		if getDataSize(dataType, count) > 4 {
			valueOffset = int(r.uint32(valueOffset))
			if valueOffset >= len(r.data) {
				continue
			}
		}

		fn(tag, dataType, count, valueOffset)
	}
}

func parseIFD(r *exifReader, offset int, exif *Exif) (exifIFDOffset, gpsIFDOffset int) {
	eachEntry(r, offset, func(tag, dataType uint16, count uint32, valueOffset int) {
		switch tag {
		case tagOrientation:
			if dataType == typeUnsignedShort {
				exif.Orientation = int(r.uint16(valueOffset))
			}
		case tagImageWidth:
			switch dataType {
			case typeUnsignedShort:
				exif.Width = int(r.uint16(valueOffset))
			case typeUnsignedLong:
				exif.Width = int(r.uint32(valueOffset))
			}
		case tagImageLength:
			switch dataType {
			case typeUnsignedShort:
				exif.Height = int(r.uint16(valueOffset))
			case typeUnsignedLong:
				exif.Height = int(r.uint32(valueOffset))
			}
		case tagMake:
			if dataType == typeASCIIString {
				exif.Make = r.readString(valueOffset, int(count))
			}
		case tagModel:
			if dataType == typeASCIIString {
				exif.Model = r.readString(valueOffset, int(count))
			}
		case tagSoftware:
			if dataType == typeASCIIString {
				exif.Software = r.readString(valueOffset, int(count))
			}
		case tagDateTime:
			if dataType == typeASCIIString {
				exif.DateTime = r.readString(valueOffset, int(count))
			}
		case tagArtist:
			if dataType == typeASCIIString {
				exif.Artist = r.readString(valueOffset, int(count))
			}
		case tagCopyright:
			if dataType == typeASCIIString {
				exif.Copyright = r.readString(valueOffset, int(count))
			}
		case tagExifIFDPointer:
			if dataType == typeUnsignedLong {
				exifIFDOffset = int(r.uint32(valueOffset))
			}
		case tagGPSIFDPointer:
			if dataType == typeUnsignedLong {
				gpsIFDOffset = int(r.uint32(valueOffset))
			}
		}
	})

	return exifIFDOffset, gpsIFDOffset
}

func parseExifSubIFD(r *exifReader, offset int, exif *Exif) {
	eachEntry(r, offset, func(tag, dataType uint16, count uint32, valueOffset int) {
		switch tag {
		case tagExposureTime:
			if dataType == typeUnsignedRational {
				exif.ExposureTime = r.readRational(valueOffset)
			}
		case tagFNumber:
			if dataType == typeUnsignedRational {
				exif.FNumber = r.readRational(valueOffset)
			}
		case tagISOSpeedRatings:
			if dataType == typeUnsignedShort {
				exif.ISOSpeed = int(r.uint16(valueOffset))
			}
		case tagDateTimeOriginal:
			if dataType == typeASCIIString {
				exif.DateTimeOriginal = r.readString(valueOffset, int(count))
			}
		case tagFlash:
			if dataType == typeUnsignedShort {
				exif.Flash = int(r.uint16(valueOffset))
			}
		case tagFocalLength:
			if dataType == typeUnsignedRational {
				exif.FocalLength = r.readRational(valueOffset)
			}
		}
	})
}

func parseGPSSubIFD(r *exifReader, offset int, exif *Exif) {
	var latRef, lonRef string
	var lat, lon []float64
	var altRef uint8

	eachEntry(r, offset, func(tag, dataType uint16, count uint32, valueOffset int) {
		switch tag {
		case tagGPSLatitudeRef:
			if dataType == typeASCIIString {
				latRef = r.readString(valueOffset, 2)
			}
		case tagGPSLatitude:
			if dataType == typeUnsignedRational && count == 3 {
				lat = []float64{
					r.readRational(valueOffset),
					r.readRational(valueOffset + 8),
					r.readRational(valueOffset + 16),
				}
			}
		case tagGPSLongitudeRef:
			if dataType == typeASCIIString {
				lonRef = r.readString(valueOffset, 2)
			}
		case tagGPSLongitude:
			if dataType == typeUnsignedRational && count == 3 {
				lon = []float64{
					r.readRational(valueOffset),
					r.readRational(valueOffset + 8),
					r.readRational(valueOffset + 16),
				}
			}
		case tagGPSAltitudeRef:
			if dataType == typeUnsignedByte && valueOffset < len(r.data) {
				altRef = r.data[valueOffset]
			}
		case tagGPSAltitude:
			if dataType == typeUnsignedRational {
				exif.GPSAltitude = r.readRational(valueOffset)
			}
		}
	})

	if altRef == 1 {
		exif.GPSAltitude = -exif.GPSAltitude
	}
	if len(lat) == 3 {
		exif.GPSLatitude = lat[0] + lat[1]/60 + lat[2]/3600
		if latRef == "S" {
			exif.GPSLatitude = -exif.GPSLatitude
		}
	}
	if len(lon) == 3 {
		exif.GPSLongitude = lon[0] + lon[1]/60 + lon[2]/3600
		if lonRef == "W" {
			exif.GPSLongitude = -exif.GPSLongitude
		}
	}
}

func getDataSize(dataType uint16, count uint32) int {
	var size int
	switch dataType {
	case typeUnsignedByte, typeSignedByte, typeASCIIString, typeUndefined:
		size = 1
	case typeUnsignedShort, typeSignedShort:
		size = 2
	case typeUnsignedLong, typeSignedLong, typeSingleFloat:
		size = 4
	case typeUnsignedRational, typeSignedRational, typeDoubleFloat:
		size = 8
	default:
		size = 1
	}

	return size * int(count)
}
