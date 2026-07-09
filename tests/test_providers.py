import pytest

from clipsmith.providers import ProviderExecutionMode, ProviderInfo, ProviderRegistry


def test_matches_xhs_urls():
    provider = ProviderRegistry.default().match(
        "https://www.xiaohongshu.com/explore/abc"
    )

    assert provider is not None
    assert provider.name == "xhs"
    assert provider.mode is ProviderExecutionMode.SKILL


def test_matches_x_urls():
    provider = ProviderRegistry.default().match("https://x.com/example/status/123")

    assert provider is not None
    assert provider.name == "x"


def test_matches_wechat_urls():
    provider = ProviderRegistry.default().match("https://mp.weixin.qq.com/s/example")

    assert provider is not None
    assert provider.name == "wechat"


def test_matches_x_urls_with_ports():
    provider = ProviderRegistry.default().match("https://x.com:443/example/status/123")

    assert provider is not None
    assert provider.name == "x"


def test_matches_xhs_urls_with_ports():
    provider = ProviderRegistry.default().match(
        "https://www.xiaohongshu.com:443/explore/abc"
    )

    assert provider is not None
    assert provider.name == "xhs"


def test_matches_wechat_urls_with_ports():
    provider = ProviderRegistry.default().match(
        "https://mp.weixin.qq.com:443/s/example"
    )

    assert provider is not None
    assert provider.name == "wechat"


def test_unknown_url_uses_web_provider():
    provider = ProviderRegistry.default().match("https://example.com/article")

    assert provider is not None
    assert provider.name == "web"


def test_custom_wildcard_provider_handles_unknown_urls():
    registry = ProviderRegistry(
        [
            ProviderInfo("x", "skill", "clipsmith-x", domains=["x.com"]),
            ProviderInfo("fallback", "skill", "fallback-skill", domains=["*"]),
        ]
    )

    provider = registry.match("https://unknown.example/path")

    assert provider is not None
    assert provider.name == "fallback"


def test_provider_info_requires_domains():
    with pytest.raises(TypeError):
        ProviderInfo("x", "skill", "clipsmith-x")


def test_provider_info_coerces_supported_execution_mode():
    provider = ProviderInfo("x", "skill", "clipsmith-x", domains=["x.com"])

    assert provider.mode is ProviderExecutionMode.SKILL


def test_provider_info_rejects_unsupported_execution_mode():
    with pytest.raises(ValueError, match="Unsupported provider execution mode"):
        ProviderInfo("x", "executor", "clipsmith-x", domains=["x.com"])


def test_registry_without_wildcard_returns_none_for_unknown_urls():
    registry = ProviderRegistry(
        [ProviderInfo("x", "skill", "clipsmith-x", domains=["x.com"])]
    )

    provider = registry.match("https://unknown.example/path")

    assert provider is None


def test_lookalike_x_host_uses_web_provider():
    provider = ProviderRegistry.default().match("https://notx.com/article")

    assert provider is not None
    assert provider.name == "web"


def test_lookalike_xhs_host_uses_web_provider():
    provider = ProviderRegistry.default().match("https://notxiaohongshu.com/post")

    assert provider is not None
    assert provider.name == "web"


def test_lookalike_wechat_host_uses_web_provider():
    provider = ProviderRegistry.default().match(
        "https://evilmp.weixin.qq.com.example.com/s/foo"
    )

    assert provider is not None
    assert provider.name == "web"


def test_lists_provider_names():
    names = [provider.name for provider in ProviderRegistry.default().list()]

    assert names == ["xhs", "x", "wechat", "web", "image-ocr"]
