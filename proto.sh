#!/bin/bash

# Proto source directory
PROTO_DIR="./proto"
# Output directory
OUT_DIR="./src/generated/proto"

# Clean output directory
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Create a temporary directory for proto files
PROTO_FULL_DIR="./proto-full"
rm -rf "$PROTO_FULL_DIR"
mkdir -p "$PROTO_FULL_DIR"

# Download Cosmos SDK protos
echo "Downloading Cosmos SDK protos..."
buf export buf.build/cosmos/cosmos-sdk --output "$PROTO_FULL_DIR"

# Download Babylon protos
echo "Downloading Babylon protos..."
if [ ! -d "$PROTO_DIR/babylon" ]; then
  mkdir -p "$PROTO_DIR/babylon"
  git clone https://github.com/babylonlabs-io/babylon.git babylon-temp
  cp -r babylon-temp/proto/babylon/* "$PROTO_DIR/babylon/"
  rm -rf babylon-temp
fi

# Copy proto directory structure
cp -r "$PROTO_DIR" "$OUT_DIR"
cp -r "$PROTO_FULL_DIR" "$OUT_DIR/proto-full"

# Clean all .proto files and only keep compiled ones
find "$OUT_DIR" -name "*.proto" -delete

# Custom proto compilation options
PROTOC_GEN_TS_PROTO_OPTS="esModuleInterop=true,forceLong=long,useOptionals=true,useDate=false"

# Compile proto files, ignore errors
protoc \
  --plugin="protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto" \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt="$PROTOC_GEN_TS_PROTO_OPTS" \
  --proto_path="$PROTO_DIR" \
  --proto_path="$PROTO_FULL_DIR" \
  --include_imports \
  $(find "$PROTO_DIR" "$PROTO_FULL_DIR" -name "*.proto") 2>/dev/null || true

# Clean up temporary directory
rm -rf "$PROTO_FULL_DIR"