from __future__ import annotations


class ClipsmithError(Exception):
    """Base error for controlled Clipsmith failures."""


class BundleError(ClipsmithError):
    """Raised when a capture bundle cannot be read or written."""
