"""Minimal async client for the OpenPlantbook API (https://open.plantbook.io)."""
from __future__ import annotations

import time
from typing import Any
from urllib.parse import quote

import aiohttp

BASE_URL = "https://open.plantbook.io/api/v1"
_TIMEOUT = aiohttp.ClientTimeout(total=25)
DEFAULT_RETRY_AFTER = 60


class OpenPlantbookError(Exception):
    """Base error."""


class OpenPlantbookConnectionError(OpenPlantbookError):
    """The service could not be reached."""


class OpenPlantbookAuthError(OpenPlantbookError):
    """The client id / secret were rejected."""


class OpenPlantbookRateLimit(OpenPlantbookError):
    """Too many requests; ``retry_after`` is the number of seconds to wait."""

    def __init__(self, retry_after: int = DEFAULT_RETRY_AFTER) -> None:
        super().__init__(f"rate limited, retry in {retry_after}s")
        self.retry_after = retry_after


def _retry_after(headers: Any) -> int:
    """Seconds the API asked us to wait (Retry-After), within sane bounds."""
    try:
        return max(5, min(int(float(headers.get("Retry-After"))), 3600))
    except (TypeError, ValueError, AttributeError):
        return DEFAULT_RETRY_AFTER


class OpenPlantbookClient:
    """Client-credentials OAuth client for the OpenPlantbook REST API."""

    def __init__(self, session: aiohttp.ClientSession, client_id: str, client_secret: str) -> None:
        self._session = session
        self._client_id = client_id
        self._client_secret = client_secret
        self._token: str | None = None
        self._expires = 0.0
        self._blocked_until = 0.0

    def _check_blocked(self) -> None:
        """Do not send anything while the API asked us to back off (that only prolongs the limit)."""
        remaining = self._blocked_until - time.monotonic()
        if remaining > 0:
            raise OpenPlantbookRateLimit(max(1, int(remaining)))

    def _rate_limited(self, headers: Any) -> OpenPlantbookRateLimit:
        wait = _retry_after(headers)
        self._blocked_until = time.monotonic() + wait
        return OpenPlantbookRateLimit(wait)

    async def async_validate(self) -> None:
        """Raise if the credentials do not work."""
        self._token = None
        await self._async_token()

    async def _async_token(self) -> str:
        self._check_blocked()
        if self._token and self._expires > time.monotonic() + 300:
            return self._token
        data = {
            "grant_type": "client_credentials",
            "client_id": self._client_id,
            "client_secret": self._client_secret,
        }
        try:
            async with self._session.post(f"{BASE_URL}/token/", data=data, timeout=_TIMEOUT) as resp:
                if resp.status == 429:
                    raise self._rate_limited(resp.headers)
                payload = await resp.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError) as err:
            raise OpenPlantbookConnectionError(str(err)) from err
        except ValueError as err:  # not JSON at all
            raise OpenPlantbookError("unexpected answer from OpenPlantbook") from err
        token = payload.get("access_token") if isinstance(payload, dict) else None
        if not token:
            raise OpenPlantbookAuthError
        self._token = token
        self._expires = time.monotonic() + int(payload.get("expires_in", 3600))
        return token

    async def _async_get(self, path: str, params: dict[str, str] | None = None) -> Any:
        token = await self._async_token()
        try:
            async with self._session.get(
                f"{BASE_URL}{path}", params=params, timeout=_TIMEOUT,
                headers={"Authorization": f"Bearer {token}"},
            ) as resp:
                if resp.status in (401, 403):
                    self._token = None
                    raise OpenPlantbookAuthError
                if resp.status == 404:
                    return None
                if resp.status == 429:
                    raise self._rate_limited(resp.headers)
                resp.raise_for_status()
                return await resp.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError) as err:
            raise OpenPlantbookConnectionError(str(err)) from err
        except ValueError as err:  # not JSON at all
            raise OpenPlantbookError("unexpected answer from OpenPlantbook") from err

    async def async_search(self, text: str) -> list[dict[str, Any]]:
        """Return [{pid, display_pid, alias, category}, ...]."""
        data = await self._async_get("/plant/search", {"alias": text})
        results = data.get("results") if isinstance(data, dict) else None
        return results if isinstance(results, list) else []

    async def async_detail(self, pid: str) -> dict[str, Any] | None:
        """Return the species record including the care texts, or None if unknown."""
        data = await self._async_get(f"/plant/detail/{quote(pid, safe='')}/", {"include": "care"})
        return data if isinstance(data, dict) else None
