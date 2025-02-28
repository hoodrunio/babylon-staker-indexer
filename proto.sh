
#!/bin/bash

# Proto kaynak dizini
PROTO_DIR="./proto"
# Çıktı dizini
OUT_DIR="./src/generated/proto"

# Çıktı dizinini temizle
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Proto dizin yapısını kopyala
cp -r "$PROTO_DIR" "$OUT_DIR"

# Tüm .proto dosyalarını temizle ve sadece derlenenleri tut
find "$OUT_DIR" -name "*.proto" -delete

# Özel proto derleme seçenekleri
PROTOC_GEN_TS_PROTO_OPTS="esModuleInterop=true,forceLong=long,useOptionals=true,useDate=false"

# Proto dosyalarını derle, hataları yok say
protoc \
  --plugin="protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto" \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt="$PROTOC_GEN_TS_PROTO_OPTS" \
  --proto_path="$PROTO_DIR" \
  --proto_path="$PROTO_DIR/third_party/proto" \
  --include_imports \
  $(find "$PROTO_DIR" -name "*.proto") 2>/dev/null || true