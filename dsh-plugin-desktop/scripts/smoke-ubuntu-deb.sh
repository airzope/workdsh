#!/bin/bash
# Install a WorkDSH .deb into a clean Ubuntu container (20.04 and 24.04 in CI)
# and run its bundled runtimes headlessly with smoke-bundled-runtime.sh.
# Usage: smoke-ubuntu-deb.sh /path/to/<Product>-<version>-linux-<arch>.deb
set -euo pipefail

deb="$1"
# The Debian package is named after the brand's command, which /usr/bin links
# to the executable inside /opt/<Product>.
package="$(dpkg-deb -f "$deb" Package)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# The package's own Depends must resolve from the distribution archive. A
# font package stands in for the fonts a desktop installation already has.
if ! apt-get install -y -qq --no-install-recommends "$deb" fonts-dejavu-core > /tmp/apt.log 2>&1; then
  cat /tmp/apt.log
  exit 1
fi
. /etc/os-release
echo "Installed $(dpkg-query -W -f '${Package} ${Version} ${Architecture}' "$package") on ${PRETTY_NAME}, $(getconf GNU_LIBC_VERSION)"
test -x "/usr/bin/$package"
executable="$(readlink -f "/usr/bin/$package")"
case "$executable" in /opt/*) ;; *) echo "/usr/bin/$package does not point into /opt: $executable" >&2; exit 1 ;; esac

bash "$(dirname "$0")/smoke-bundled-runtime.sh" "$executable" "$(dirname "$executable")/resources/workdsh-runtime" \
  "$(dpkg --print-architecture | sed 's/amd64/x64/')"
