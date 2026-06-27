#!/usr/bin/env bash
# Regenerate manifest.json by scanning soundboard/sounds/<Category>/*.ogg.
# Run after dropping new split clips into sounds/<Category>/.  Needs ffprobe on PATH (or in this dir).
set -u
SB="$(cd "$(dirname "$0")" && pwd)"
FFPROBE="${FFPROBE:-$(command -v ffprobe || echo "$SB/ffprobe.exe")}"
FFMPEG="${FFMPEG:-$(command -v ffmpeg || echo "$SB/ffmpeg.exe")}"
MAN="$SB/manifest.json"

echo "[" > "$MAN"; first=1
for cat in $(ls "$SB/sounds" 2>/dev/null); do
  [ -d "$SB/sounds/$cat" ] || continue
  for f in "$SB/sounds/$cat"/*.ogg; do
    [ -e "$f" ] || continue
    bn=$(basename "$f")
    asset=$(echo "$bn" | sed -E 's/^[0-9]+_//; s/\.ogg$//')
    # loop = has a "Loop" suffix OR is a known behaviour-loop without one (e.g. SFX_Alarm)
    loop=$(echo "$asset" | grep -qiE "loop|^SFX_Alarm$" && echo true || echo false)
    # decode the real length (some OGGs have a bogus duration header; format=duration is unreliable)
    t=$("$FFMPEG" -nostdin -hide_banner -i "$f" -f null - 2>&1 | grep -oE 'time=[0-9:.]+' | tail -1 | sed 's/time=//')
    dur=$(awk -F: -v t="$t" 'BEGIN{n=split(t,a,":"); if(n==3) printf "%.2f", a[1]*3600+a[2]*60+a[3]; else printf "%.2f", (t==""?0:t)}')
    [ $first -eq 0 ] && echo "," >> "$MAN"; first=0
    printf '  {"file":"sounds/%s/%s","name":"%s","cat":"%s","loop":%s,"dur":%.2f}' \
      "$cat" "$bn" "$asset" "$cat" "$loop" "${dur:-0}" >> "$MAN"
  done
done
echo "" >> "$MAN"; echo "]" >> "$MAN"
echo "wrote $MAN ($(grep -c '"file"' "$MAN") entries)"
