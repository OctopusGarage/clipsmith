from __future__ import annotations

from dataclasses import KW_ONLY, dataclass
from enum import StrEnum
from urllib.parse import urlparse


class ProviderExecutionMode(StrEnum):
    SKILL = "skill"


@dataclass(frozen=True)
class ProviderInfo:
    name: str
    mode: ProviderExecutionMode
    skill: str
    _: KW_ONLY
    domains: list[str]

    def __post_init__(self) -> None:
        if isinstance(self.mode, ProviderExecutionMode):
            return

        try:
            mode = ProviderExecutionMode(self.mode)
        except ValueError as exc:
            raise ValueError(
                f"Unsupported provider execution mode: {self.mode}"
            ) from exc
        object.__setattr__(self, "mode", mode)


class ProviderRegistry:
    def __init__(self, providers: list[ProviderInfo]) -> None:
        self._providers = providers

    @classmethod
    def default(cls) -> "ProviderRegistry":
        return cls(
            [
                ProviderInfo(
                    "xhs",
                    ProviderExecutionMode.SKILL,
                    "clipsmith-xhs",
                    domains=["xiaohongshu.com", "xhslink.com"],
                ),
                ProviderInfo(
                    "x",
                    ProviderExecutionMode.SKILL,
                    "clipsmith-x",
                    domains=["x.com", "twitter.com"],
                ),
                ProviderInfo(
                    "wechat",
                    ProviderExecutionMode.SKILL,
                    "clipsmith-wechat",
                    domains=["mp.weixin.qq.com", "weixin.qq.com"],
                ),
                ProviderInfo(
                    "web", ProviderExecutionMode.SKILL, "clipsmith-web", domains=["*"]
                ),
                ProviderInfo(
                    "image-ocr",
                    ProviderExecutionMode.SKILL,
                    "clipsmith-ocr",
                    domains=[],
                ),
            ]
        )

    def list(self) -> list[ProviderInfo]:
        return list(self._providers)

    def match(self, value: str) -> ProviderInfo | None:
        parsed = urlparse(value)
        host = (parsed.hostname or "").casefold()
        if not host and value.lower().endswith(
            (".png", ".jpg", ".jpeg", ".heic", ".tiff", ".bmp", ".gif", ".webp")
        ):
            return self._provider_by_name("image-ocr")
        wildcard_provider = None
        for provider in self._providers:
            for domain in provider.domains:
                if domain == "*":
                    wildcard_provider = provider
                    continue
                if _host_matches(host, domain):
                    return provider
        return wildcard_provider

    def _provider_by_name(self, name: str) -> ProviderInfo | None:
        for provider in self._providers:
            if provider.name == name:
                return provider
        return None


def _host_matches(host: str, pattern: str) -> bool:
    return host == pattern or host.endswith(f".{pattern}")
