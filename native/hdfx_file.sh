#!/bin/sh
# Hochdeutsch-Fixer's file helper (Linux, macOS). Firefox lets no extension
# read a file on this computer, so it starts this script when a PDF from disk
# is opened, and only for this extension (see the manifest install.sh writes).
# It reads that one PDF, hands it over and exits: nothing keeps running.
#
# Firefox's native messaging: each message is a 32-bit length in the
# machine's byte order, then that many bytes of JSON. In: {"path": base64 of
# the path}. Out: {"chunk": base64} per 512 KiB (a message to the extension
# may be at most 1 MB), then {"done": true, "size": bytes}; or {"error": "..."}.
LC_ALL=C
export LC_ALL

send() {   # one message: its length, then the JSON
  n=${#1}
  printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $((n & 255)) $((n >> 8 & 255)) $((n >> 16 & 255)) $((n >> 24 & 255)))"
  printf '%s' "$1"
}
fail() { send "{\"error\":\"$1\"}"; exit 0; }
unbase64() { base64 -d 2>/dev/null || base64 -D 2>/dev/null || openssl base64 -d -A; }

# the request, read byte by byte so nothing after it is taken
len=$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' \n')
[ -n "$len" ] && [ "$len" -gt 0 ] && [ "$len" -lt 65536 ] || exit 0
req=$(dd bs=1 count="$len" 2>/dev/null)
b64=$(printf '%s' "$req" | sed -n 's/.*"path" *: *"\([A-Za-z0-9+\/=]*\)".*/\1/p')
[ -n "$b64" ] || fail 'bad request'
path=$(printf '%s' "$b64" | unbase64)

# only a PDF: its name, a readable file, and "%PDF-" near its start
case "$path" in
  *.[Pp][Dd][Ff]) ;;
  *) fail 'not a PDF' ;;
esac
[ -f "$path" ] && [ -r "$path" ] || fail 'not found'
head -c 1024 "$path" | grep -q '%PDF-' || fail 'not a PDF'
size=$(wc -c < "$path" | tr -d ' ')
[ "$size" -le 536870912 ] || fail 'too large'

# each piece read in full (tail seeks, head reads until it has them all: a
# single read may return less, on network or synced folders), and the size
# at the end, so the extension can tell that it has every byte
CHUNK=524288
at=0
while [ "$at" -lt "$size" ]; do
  data=$(tail -c +$((at + 1)) "$path" | head -c $CHUNK | base64 | tr -d '\n')
  send "{\"chunk\":\"$data\"}"
  at=$((at + CHUNK))
done
send "{\"done\":true,\"size\":$size}"
