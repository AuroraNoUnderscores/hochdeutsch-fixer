#!/bin/sh
# Removes Hochdeutsch-Fixer's file helper (what install.sh put there).
name=hochdeutsch_fixer
case "$(uname -s)" in
  Darwin)
    rm -f "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/$name.json"
    rm -rf "$HOME/Library/Application Support/Hochdeutsch-Fixer" ;;
  *)
    rm -f "$HOME/.mozilla/native-messaging-hosts/$name.json"
    rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/hochdeutsch-fixer" ;;
esac
echo "Removed. Firefox asks for PDFs from this computer again."
