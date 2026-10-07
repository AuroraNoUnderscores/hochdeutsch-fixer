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

# Self-test: what Firefox will do, the helper reading a small PDF
pdf=$(mktemp "${TMPDIR:-/tmp}/hdfx-selftest-XXXXXX") && mv "$pdf" "$pdf.pdf" && pdf="$pdf.pdf"
printf '%%PDF-1.4\n%%%%EOF\n' > "$pdf"
req="{\"path\":\"$(printf '%s' "$pdf" | base64 | tr -d '\n')\"}"
n=${#req}
answer=$({ printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $((n & 255)) $((n >> 8 & 255)) $((n >> 16 & 255)) $((n >> 24 & 255)))"; printf '%s' "$req"; } \
  | "$dir/hdfx_file.sh" "$hosts/$name.json" hochdeutsch-fixer@addons.local 2>&1 | tr -d '\000-\010\016-\037')
rm -f "$pdf"
case "$answer" in
  *'"chunk"'*'"done"'*)
    echo "Self-test passed: PDFs from this computer now open converted in Firefox without asking."
    echo "(Reload the PDF tab, or open the PDF again.)" ;;
  *)
    echo "Self-test FAILED: the helper answered: $answer"
    echo "Firefox will keep asking for local PDFs. Please send this message to the extension's author."
    exit 1 ;;
esac
