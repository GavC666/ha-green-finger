"""The OpenPlantbook client backs off after a 429."""
from __future__ import annotations

from typing import Any

import pytest

from custom_components.green_finger.openplantbook import OpenPlantbookClient, OpenPlantbookRateLimit


class _Response:
    def __init__(self, status: int, payload: Any = None, headers: dict | None = None) -> None:
        self.status = status
        self._payload = payload
        self.headers = headers or {}

    async def json(self, content_type: Any = None) -> Any:
        return self._payload

    def raise_for_status(self) -> None:
        return None

    async def __aenter__(self) -> _Response:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _Session:
    """Answers token requests with a token and every GET with the next queued response."""

    def __init__(self, gets: list[_Response]) -> None:
        self.gets = list(gets)
        self.get_calls = 0
        self.post_calls = 0

    def post(self, url: str, **kwargs: Any) -> _Response:
        self.post_calls += 1
        return _Response(200, {"access_token": "t", "expires_in": 3600})

    def get(self, url: str, **kwargs: Any) -> _Response:
        self.get_calls += 1
        return self.gets.pop(0)


async def test_search_works() -> None:
    session = _Session([_Response(200, {"results": [{"pid": "ficus benjamina"}]})])
    client = OpenPlantbookClient(session, "id", "secret")  # type: ignore[arg-type]
    assert await client.async_search("ficus") == [{"pid": "ficus benjamina"}]


async def test_after_a_429_nothing_more_is_sent_until_the_wait_is_over() -> None:
    session = _Session([_Response(429, None, {"Retry-After": "42"}), _Response(200, {"results": []})])
    client = OpenPlantbookClient(session, "id", "secret")  # type: ignore[arg-type]
    with pytest.raises(OpenPlantbookRateLimit) as first:
        await client.async_search("ficus")
    assert first.value.retry_after == 42
    calls = session.get_calls

    with pytest.raises(OpenPlantbookRateLimit) as second:
        await client.async_search("ficus")
    assert 1 <= second.value.retry_after <= 42
    assert session.get_calls == calls, "a request was sent while backing off"
    assert session.post_calls == 1, "a new token was requested while backing off"


async def test_a_429_without_retry_after_uses_a_default() -> None:
    session = _Session([_Response(429)])
    client = OpenPlantbookClient(session, "id", "secret")  # type: ignore[arg-type]
    with pytest.raises(OpenPlantbookRateLimit) as err:
        await client.async_detail("ficus benjamina")
    assert err.value.retry_after == 60


class _BrokenJson(_Response):
    async def json(self, content_type: Any = None) -> Any:
        raise ValueError("not json")


async def test_an_answer_that_is_not_json_is_a_readable_error() -> None:
    from custom_components.green_finger.openplantbook import OpenPlantbookError

    session = _Session([_BrokenJson(200)])
    client = OpenPlantbookClient(session, "id", "secret")  # type: ignore[arg-type]
    with pytest.raises(OpenPlantbookError):
        await client.async_detail("ficus benjamina")


async def test_forbidden_counts_as_a_rejected_login() -> None:
    from custom_components.green_finger.openplantbook import OpenPlantbookAuthError

    session = _Session([_Response(403)])
    client = OpenPlantbookClient(session, "id", "secret")  # type: ignore[arg-type]
    with pytest.raises(OpenPlantbookAuthError):
        await client.async_search("ficus")
