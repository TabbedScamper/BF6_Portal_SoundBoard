#!/usr/bin/env bash
# Regenerate manifest.json by scanning soundboard/sounds/<Category>/*.ogg.
# Run after dropping new split clips into sounds/<Category>/.  Needs ffprobe on PATH (or in this dir).
set -u
SB="$(cd "$(dirname "$0")" && pwd)"
FFPROBE="${FFPROBE:-$(command -v ffprobe || echo "$SB/ffprobe.exe")}"
FFMPEG="${FFMPEG:-$(command -v ffmpeg || echo "$SB/ffmpeg.exe")}"
MAN="$SB/manifest.json"

echo "[" > "$MAN"; first=1
for dir in $(ls "$SB/sounds" 2>/dev/null); do
  [ -d "$SB/sounds/$dir" ] || continue
  for f in "$SB/sounds/$dir"/*.ogg; do
    [ -e "$f" ] || continue
    bn=$(basename "$f")
    # split.sh names a captured-but-silent slot "<idx>_<asset>_SILENT.ogg"
    silent=false; case "$bn" in *_SILENT.ogg) silent=true;; esac
    asset=$(echo "$bn" | sed -E 's/^[0-9]+_//; s/_SILENT\.ogg$//; s/\.ogg$//')
    # category = token after SFX_ in the asset name (NOT the folder: GameModes/Gamemodes collide on
    # case-insensitive Windows, so both casings live in one folder and are split here by their real name).
    # VO_* clips are PlayVO announcer events -> "Announcer" category, parsed into event/flag/variant so the site can
    # show ONE card per event with a flag dropdown (A-I) + a random variant per play (name: VO_<event>_<A..I>_v<n>).
    vo=false; event=""; flag=""; variant=0
    case "$asset" in
      VO_*)
        cat="Announcer"; vo=true
        rest="${asset#VO_}"
        variant=$(echo "$rest" | sed -nE 's/.*_v([0-9]+)$/\1/p'); [ -z "$variant" ] && variant=0
        rest2=$(echo "$rest" | sed -E 's/_v[0-9]+$//')
        flag=$(echo "$rest2" | sed -nE 's/.*_([A-I])$/\1/p')
        if [ -n "$flag" ]; then event=$(echo "$rest2" | sed -E 's/_[A-I]$//'); else event="$rest2"; fi
        ;;
      *) cat=$(echo "$asset" | sed -E 's/^SFX_//; s/_.*//');;
    esac
    # CrashSounds folder = assets that CRASH the game when played; kept out of their SDK category and flagged.
    # (Audio here is whatever was captured right before the crash, so it may be cut short or absent.)
    crash=false; case "$dir" in CrashSounds) cat="Crash Sounds"; crash=true;; esac
    # Announcer (PlayVO) lines fire randomly / often silent on the live build -> flag as unreliable (yellow on site).
    unreliable=false; case "$cat" in Announcer) unreliable=true;; esac
    # loop = has a "Loop" suffix OR is a known behaviour-loop without one (e.g. SFX_Alarm)
    loop=$(echo "$asset" | grep -qiE "loop|^SFX_Alarm$|Switchblade_Engine_Propellar" && echo true || echo false)
    # decode the real length (some OGGs have a bogus duration header; format=duration is unreliable)
    t=$("$FFMPEG" -nostdin -hide_banner -i "$f" -f null - 2>&1 | grep -oE 'time=[0-9:.]+' | tail -1 | sed 's/time=//')
    dur=$(awk -F: -v t="$t" 'BEGIN{n=split(t,a,":"); if(n==3) printf "%.2f", a[1]*3600+a[2]*60+a[3]; else printf "%.2f", (t==""?0:t)}')
    [ $first -eq 0 ] && echo "," >> "$MAN"; first=0
    printf '  {"file":"sounds/%s/%s","name":"%s","cat":"%s","loop":%s,"silent":%s,"crash":%s,"unreliable":%s,"dur":%.2f,"vo":%s,"event":"%s","flag":"%s","variant":%d}' \
      "$dir" "$bn" "$asset" "$cat" "$loop" "$silent" "$crash" "$unreliable" "${dur:-0}" "$vo" "$event" "$flag" "$variant" >> "$MAN"
  done
done
echo "" >> "$MAN"; echo "]" >> "$MAN"
echo "wrote $MAN ($(grep -c '"file"' "$MAN") entries)"
