#!/bin/bash

# Proto source directory
PROTO_DIR="./proto"
# Output directory
OUT_DIR="./src/generated/proto"

# Check and install buf if not found
if ! command -v buf &> /dev/null; then
  echo "buf not found, installing..."
  
  # Detect OS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if command -v brew &> /dev/null; then
      brew install bufbuild/buf/buf
    else
      echo "Error: Homebrew not found. Please install Homebrew first"
      exit 1
    fi
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Ubuntu/Debian
    # Detect architecture
    ARCH=$(uname -m)
    case $ARCH in
      x86_64)
        PLATFORM="Linux-x86_64"
        ;;
      aarch64)
        PLATFORM="Linux-aarch64"
        ;;
      arm64)
        PLATFORM="Linux-arm64"
        ;;
      *)
        echo "Error: Unsupported architecture: $ARCH"
        exit 1
        ;;
    esac
    
    # Add buf's package repository
    curl -sSL "https://github.com/bufbuild/buf/releases/latest/download/buf-$PLATFORM" -o "buf"
    chmod +x buf
    sudo mv buf /usr/local/bin/
  else
    echo "Error: Unsupported operating system"
    exit 1
  fi
  
  echo "buf installed successfully"
fi

# Clean output directory
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
echo "Created output directory: $OUT_DIR"

# Ensure proto directory exists
if [ ! -d "$PROTO_DIR" ]; then
  mkdir -p "$PROTO_DIR"
  echo "Created proto directory: $PROTO_DIR"
else
  echo "Proto directory already exists: $PROTO_DIR"
fi

# Download Cosmos SDK protos
echo "Downloading Cosmos SDK protos..."
if ! buf export buf.build/cosmos/cosmos-sdk --output "$PROTO_DIR"; then
  echo "Error: Failed to download Cosmos SDK protos"
  exit 1
fi
echo "Cosmos SDK protos downloaded to $PROTO_DIR"

echo "Downloading CosmWasm protos..."
if ! buf export buf.build/cosmwasm/wasmd --output "$PROTO_DIR"; then
  echo "Error: Failed to download CosmWasm protos"
  exit 1
fi
echo "CosmWasm protos downloaded to $PROTO_DIR"

# Download Babylon protos
echo "Downloading Babylon protos..."
if [ ! -d "$PROTO_DIR/babylon" ]; then
  mkdir -p "$PROTO_DIR/babylon"
  echo "Created directory: $PROTO_DIR/babylon"
  
  if ! git clone https://github.com/babylonlabs-io/babylon.git babylon-temp; then
    echo "Error: Failed to clone Babylon repository"
    exit 1
  fi
  echo "Cloned Babylon repository to babylon-temp"
  
  if [ ! -d "babylon-temp/proto/babylon" ]; then
    echo "Error: Babylon proto directory not found in cloned repository"
    exit 1
  fi
  
  cp -r babylon-temp/proto/babylon/* "$PROTO_DIR/babylon/"
  echo "Copied Babylon proto files to $PROTO_DIR/babylon/"
  rm -rf babylon-temp
  echo "Removed babylon-temp directory"
else
  echo "Babylon proto directory already exists, skipping download"
fi

# Verify proto files exist
if [ -z "$(find "$PROTO_DIR" -name "*.proto" 2>/dev/null)" ]; then
  echo "Error: No proto files found in $PROTO_DIR"
  exit 1
fi

# Custom proto compilation options
PROTOC_GEN_TS_PROTO_OPTS="esModuleInterop=true,forceLong=long,useOptionals=true,useDate=false"
echo "Using proto compilation options: $PROTOC_GEN_TS_PROTO_OPTS"

# Check if protoc is installed
if ! command -v protoc &> /dev/null; then
  echo "protoc not found, installing..."
  
  # Detect OS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if command -v brew &> /dev/null; then
      brew install protobuf
    else
      echo "Error: Homebrew not found. Please install Homebrew first"
      exit 1
    fi
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Ubuntu/Debian
    sudo apt-get update
    sudo apt-get install -y protobuf-compiler
  else
    echo "Error: Unsupported operating system"
    exit 1
  fi
  
  echo "protoc installed successfully"
fi

# Check if protoc-gen-ts_proto is installed
if [ ! -f "./node_modules/.bin/protoc-gen-ts_proto" ]; then
  echo "Error: protoc-gen-ts_proto not found. Make sure ts-proto is installed"
  exit 1
fi

# Compile proto files
echo "Compiling proto files..."
protoc \
  --plugin="protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto" \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt="$PROTOC_GEN_TS_PROTO_OPTS" \
  --proto_path="$PROTO_DIR" \
  --include_imports \
  $(find "$PROTO_DIR" -name "*.proto") 2>/dev/null || {
    echo "Warning: Proto compilation had some issues, but continuing..."
  }
echo "Proto compilation completed"

# Verify output files were generated
if [ -z "$(find "$OUT_DIR" -name "*.ts" 2>/dev/null)" ]; then
  echo "Warning: No TypeScript files were generated in $OUT_DIR"
else
  echo "Successfully generated TypeScript files in $OUT_DIR"
fi

# Keep proto directory for reference
echo "Proto directory kept at $PROTO_DIR for reference"
