#!/usr/bin/env bash
# Build llama-server for Ubuntu 20.04 and newer. Runs as root inside an
# ubuntu:20.04 container; prepare-workdsh-llama.ts supplies the pinned inputs.
#
# Usage: build-llama-linux.sh <source> <output> <cmake-url> <cmake-sha256> <build-number>
#
# The official Ubuntu builds need glibc 2.34+ and OpenSSL 3, so WorkDSH builds
# its own against focal's glibc 2.31 and libstdc++. Focal's clang-12 supports
# every x86 CPU variant; neither focal compiler supports Arm SME, so the two
# armv9.2 variants are dropped (armv8.6_2 serves those CPUs).
set -euo pipefail

source_dir=$1
output_dir=$2
cmake_url=$3
cmake_sha256=$4
build_number=$5

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends clang-12 g++ make ca-certificates curl >/dev/null

curl -fsSL --retry 4 -o /tmp/cmake.tar.gz "$cmake_url"
echo "$cmake_sha256  /tmp/cmake.tar.gz" | sha256sum -c -
mkdir -p /opt/cmake
tar -xzf /tmp/cmake.tar.gz -C /opt/cmake --strip-components=1
cmake=/opt/cmake/bin/cmake

work=/tmp/llama-source
rm -rf "$work"
cp -a "$source_dir" "$work"
if [ "$(uname -m)" = aarch64 ]; then
  sed -i '/ggml_add_cpu_backend_variant(armv9\.2_/d' "$work/ggml/src/CMakeLists.txt"
fi

build=/tmp/llama-build
CC=clang-12 CXX=clang++-12 "$cmake" -S "$work" -B "$build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=ON \
  -DGGML_NATIVE=OFF \
  -DGGML_BACKEND_DL=ON \
  -DGGML_CPU_ALL_VARIANTS=ON \
  -DGGML_OPENMP=OFF \
  -DGGML_RPC=OFF \
  -DLLAMA_OPENSSL=OFF \
  -DLLAMA_BUILD_UI=OFF \
  -DLLAMA_USE_PREBUILT_UI=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_NUMBER="$build_number" \
  -DCMAKE_INSTALL_RPATH='$ORIGIN' \
  -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON

# Backends are loaded at run time, so they are separate targets.
variants=$("$cmake" --build "$build" --target help | grep -oE 'ggml-cpu-[A-Za-z0-9_.]+' | grep -v -- '-feats$' | sort -u)
# shellcheck disable=SC2086
"$cmake" --build "$build" --parallel "$(nproc)" --target llama-server $variants

mkdir -p "$output_dir"
cp -a "$build/bin/." "$output_dir/"
# Hand the output back to the invoking user.
if [ -n "${WORKDSH_OWNER:-}" ]; then chown -R "$WORKDSH_OWNER" "$output_dir"; fi
