#!/usr/bin/env bash
# Regenerate manifest.json by scanning soundboard/sounds/<Category>/*.ogg.
# Run after dropping new split clips into sounds/<Category>/.  Needs ffprobe on PATH (or in this dir).
set -u
SB="$(cd "$(dirname "$0")" && pwd)"
FFPROBE="$(command -v ffprobe || echo "$SB/ffprobe.exe")"
MAN="$SB/manifest.json"

echo "[" > "$MAN"; first=1
for cat in $(ls "$SB/sounds" 2>/dev/null); do
  [ -d "$SB/sounds/$cat" ] || continue
  for f in "$SB/sounds/$cat"/*.ogg; do
    [ -e "$f" ] || continue
    bn=$(basename "$f")
    asset=$(echo "$bn" | sed -E 's/^[0-9]+_//; s/\.ogg$//')
    loop=$(echo "$asset" | grep -qi "loop" && echo true || echo false)
    dur=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null)
    [ $first -eq 0 ] && echo "," >> "$MAN"; first=0
    printf '  {"file":"sounds/%s/%s","name":"%s","cat":"%s","loop":%s,"dur":%.2f}' \
      "$cat" "$bn" "$asset" "$cat" "$loop" "${dur:-0}" >> "$MAN"
  done
done
echo "" >> "$MAN"; echo "]" >> "$MAN"
echo "wrote $MAN ($(grep -c '"file"' "$MAN") entries)"
