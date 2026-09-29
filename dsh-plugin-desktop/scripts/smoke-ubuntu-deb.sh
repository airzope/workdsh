#!/bin/bash
# Install a WorkDSH .deb into a clean Ubuntu container (20.04 and 24.04 in CI)
# and run its bundled runtimes headlessly with smoke-bundled-runtime.sh.
# Usage: smoke-ubuntu-deb.sh /path/to/WorkDSH-<version>-linux-<arch>.deb
set -euo pipefail

deb="$1"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# The package's own Depends must resolve from the distribution archive. A
# font package stands in for the fonts a desktop installation already has.
if ! apt-get install -y -qq --no-install-recommends "$deb" fonts-dejavu-core > /tmp/apt.log 2>&1; then
  cat /tmp/apt.log
  exit 1
fi
. /etc/os-release
echo "Installed $(dpkg-query -W -f '${Package} ${Version} ${Architecture}' workdsh) on ${PRETTY_NAME}, $(getconf GNU_LIBC_VERSION)"
test -x /usr/bin/workdsh

bash "$(dirname "$0")/smoke-bundled-runtime.sh" /opt/WorkDSH/workdsh /opt/WorkDSH/resources/workdsh-runtime \
  "$(dpkg --print-architecture | sed 's/amd64/x64/')"
