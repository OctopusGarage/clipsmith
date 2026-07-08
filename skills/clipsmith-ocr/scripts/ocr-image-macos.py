#!/usr/bin/env python3
from __future__ import annotations

import argparse
import platform
import sys
from pathlib import Path
from typing import Iterable


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="OCR image with macOS Vision.framework via pyobjc"
    )
    parser.add_argument("--image-path", required=True, help="Input image path")
    parser.add_argument(
        "--output-text", required=False, help="Optional output text file path"
    )
    parser.add_argument(
        "--languages",
        default="zh-Hans,zh-Hant,en",
        help="Comma-separated languages, default zh-Hans,zh-Hant,en",
    )
    parser.add_argument(
        "--recognition-level",
        choices=["accurate", "fast"],
        default="accurate",
        help="Vision recognition level",
    )
    return parser.parse_args()


def ensure_macos() -> None:
    if platform.system() != "Darwin":
        raise RuntimeError("This OCR skill only supports macOS (Darwin).")


def parse_languages(raw: str) -> list[str]:
    parts = [p.strip() for p in raw.split(",")]
    return [p for p in parts if p]


def import_vision_modules():
    try:
        import Vision  # type: ignore
        from Foundation import NSURL  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "Missing macOS Vision bridge dependencies. Restore the skill "
            "environment with: uv sync --project <skillRoot>"
        ) from exc
    return Vision, NSURL


def _obs_sort_key(observation) -> tuple[float, float]:
    bbox = observation.boundingBox()
    # Vision bounding box uses normalized coordinates with origin at lower-left.
    top_y = float(bbox.origin.y + bbox.size.height)
    left_x = float(bbox.origin.x)
    return (-top_y, left_x)


def run_ocr(
    image_path: Path,
    languages: Iterable[str],
    recognition_level: str,
) -> str:
    Vision, NSURL = import_vision_modules()

    url = NSURL.fileURLWithPath_(str(image_path))
    recognized: list[str] = []

    def on_complete(request, error):
        if error:
            raise RuntimeError(f"Vision OCR request failed: {error}")

        observations = list(request.results() or [])
        observations.sort(key=_obs_sort_key)

        for obs in observations:
            candidates = obs.topCandidates_(1)
            if not candidates:
                continue
            text = str(candidates[0].string()).strip()
            if text:
                recognized.append(text)

    request = Vision.VNRecognizeTextRequest.alloc().initWithCompletionHandler_(
        on_complete
    )
    request.setRecognitionLanguages_(list(languages))
    request.setRecognitionLevel_(
        Vision.VNRequestTextRecognitionLevelAccurate
        if recognition_level == "accurate"
        else Vision.VNRequestTextRecognitionLevelFast
    )
    request.setUsesLanguageCorrection_(True)

    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, {})
    success, error = handler.performRequests_error_([request], None)
    if not success:
        raise RuntimeError(f"Vision request execution failed: {error}")

    return "\n".join(recognized)


def main() -> int:
    args = parse_args()
    ensure_macos()

    image_path = Path(args.image_path).expanduser().resolve()
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError(f"Image file not found: {image_path}")

    languages = parse_languages(args.languages)
    if not languages:
        raise ValueError("No valid OCR languages provided.")

    text = run_ocr(
        image_path=image_path,
        languages=languages,
        recognition_level=args.recognition_level,
    )

    print(text)

    if args.output_text:
        output_path = Path(args.output_text).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
