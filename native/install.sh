#!/bin/sh
# Installs Hochdeutsch-Fixer's file helper for this user (Linux, macOS; no
# root needed): copies hdfx_file.sh to a folder of its own and tells Firefox
# where it is. uninstall.sh takes it away again.
set -e
name=hochdeutsch_fixer
here=$(cd "$(dirname "$0")" && pwd)
case "$(uname -s)" in
  Darwin)
    hosts="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    dir="$HOME/Library/Application Support/Hochdeutsch-Fixer" ;;
  *)
    hosts="$HOME/.mozilla/native-messaging-hosts"
    dir="${XDG_DATA_HOME:-$HOME/.local/share}/hochdeutsch-fixer" ;;
esac
mkdir -p "$hosts" "$dir"
cp "$here/hdfx_file.sh" "$dir/hdfx_file.sh"
chmod 755 "$dir/hdfx_file.sh"

# Firefox finds the helper through this file
path=$(printf '%s' "$dir/hdfx_file.sh" | sed 's/\\/\\\\/g; s/"/\\"/g')
cat > "$hosts/$name.json" <<EOF
{
  "name": "$name",
  "description": "Hochdeutsch-Fixer: opens a PDF from this computer for the extension",
  "path": "$path",
  "type": "stdio",
  "allowed_extensions": ["hochdeutsch-fixer@addons.local"]
}
EOF
echo "Installed: $dir/hdfx_file.sh"
echo "PDFs from this computer now open converted in Firefox without asking."
