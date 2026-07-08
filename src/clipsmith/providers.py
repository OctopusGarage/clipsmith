from __future__ import annotations

from dataclasses import KW_ONLY, dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class ProviderInfo:
    name: str
    mode: str
    skill: str
    _: KW_ONLY
    domains: list[str]


class ProviderRegistry:
    def __init__(self, providers: list[ProviderInfo]) -> None:
        self._providers = providers

    @classmethod
    def default(cls) -> "ProviderRegistry":
        return cls(
            [
                ProviderInfo(
                    "xhs",
                    "skill",
                    "clipsmith-xhs",
                    domains=["xiaohongshu.com", "xhslink.com"],
                ),
                ProviderInfo(
                    "x", "skill", "clipsmith-x", domains=["x.com", "twitter.com"]
                ),
                ProviderInfo(
                    "wechat",
                    "skill",
                    "clipsmith-wechat",
                    domains=["mp.weixin.qq.com", "weixin.qq.com"],
                ),
                ProviderInfo("web", "skill", "clipsmith-web", domains=["*"]),
                ProviderInfo("image-ocr", "skill", "clipsmith-ocr", domains=[]),
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
