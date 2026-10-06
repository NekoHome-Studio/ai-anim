#!/usr/bin/env python3
"""anim 的默认 TTS 驱动：edge-tts + **词级时间戳**。

    python tools/tts-edge.py --voice zh-CN-YunxiNeural --rate=-6% \
        --text "一个汉字，正好对应八个兽语字。" \
        --write-media out.mp3 --write-words out.words.json

为什么不用现成的 `edge-tts` 命令行：
`edge-tts` 7.x 的 `--write-subtitles` 用的是 **SentenceBoundary**（整句一条字幕），
拿不到词级时间戳；而引擎的 `type.karaoke`（`docs/NARRATION.md` C 档）要的正是词级。
`edge_tts` 这个库本身支持 `boundary="WordBoundary"`，所以这里薄薄包一层：
音频照写，另外把每个词的起止时间吐成 JSON。

输出约定（`scripts/lib/say.mjs` 的 `resolveTts()` 认这个约定）：
  · `--write-media <文件>`  必写，音频
  · `--write-words <文件>`  选写，`[{"w": "汉字", "start": 0.12, "end": 0.46}, ...]`（秒，相对本句音频开头）

时间单位：edge-tts 的 offset/duration 是 **100 纳秒**（1e7 = 1 秒）。
"""
import argparse
import asyncio
import json
import sys

try:
    import edge_tts
except ImportError:  # pragma: no cover
    sys.stderr.write("没有 edge_tts：先 pip install edge-tts（或把 ANIM_PYTHON 指到装了它的解释器）\n")
    raise SystemExit(3)

TICKS_PER_SECOND = 10_000_000


async def synth(text, voice, rate, volume, pitch, media, words_file):
    kwargs = {"rate": rate}
    if volume:
        kwargs["volume"] = volume
    if pitch:
        kwargs["pitch"] = pitch
    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary", **kwargs)

    words = []
    with open(media, "wb") as f:
        async for chunk in communicate.stream():
            kind = chunk.get("type")
            if kind == "audio":
                f.write(chunk["data"])
            elif kind == "WordBoundary":
                start = chunk["offset"] / TICKS_PER_SECOND
                end = (chunk["offset"] + chunk["duration"]) / TICKS_PER_SECOND
                words.append({"w": chunk["text"], "start": round(start, 4), "end": round(end, 4)})
    if words_file:
        with open(words_file, "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False, indent=1)
    return len(words)


def main():
    ap = argparse.ArgumentParser(description="edge-tts driver for `anim say`")
    ap.add_argument("--voice", required=True)
    ap.add_argument("--rate", default="+0%")
    ap.add_argument("--volume", default=None)
    ap.add_argument("--pitch", default=None)
    ap.add_argument("--text", required=True)
    ap.add_argument("--write-media", required=True)
    ap.add_argument("--write-words", default=None)
    args = ap.parse_args()

    n = asyncio.run(synth(args.text, args.voice, args.rate, args.volume, args.pitch,
                          args.write_media, args.write_words))
    # 词级时间戳一个都没有 = 下游只能按字数近似，必须说出来（不然没人知道）
    if args.write_words and n == 0:
        sys.stderr.write("⚠ 这次一个 WordBoundary 都没收到（网络？文本全是标点？）\n")
    print(f"{n} words" if args.write_words else "ok")


if __name__ == "__main__":
    main()
