"""Common-name lookup through GBIF (https://www.gbif.org), used when OpenPlantbook knows no match."""
from __future__ import annotations

import logging
from collections import Counter

import aiohttp

_LOGGER = logging.getLogger(__name__)
GBIF_SEARCH = "https://api.gbif.org/v1/species/search"
_TIMEOUT = aiohttp.ClientTimeout(total=10)
PLANTAE = "6"


async def async_common_name_genera(session: aiohttp.ClientSession, query: str, limit: int = 3) -> list[str]:
    """Genera (Latin) whose species carry a common name matching ``query``, best matches first."""
    params = {
        "q": query, "qField": "VERNACULAR", "status": "ACCEPTED",
        "highertaxonKey": PLANTAE, "rank": "SPECIES", "limit": "100",
    }
    try:
        async with session.get(GBIF_SEARCH, params=params, timeout=_TIMEOUT) as resp:
            resp.raise_for_status()
            data = await resp.json(content_type=None)
    except (aiohttp.ClientError, TimeoutError, ValueError) as err:
        _LOGGER.debug("GBIF common-name lookup failed: %s", err)
        return []
    counts: Counter[str] = Counter()
    first: dict[str, int] = {}
    for index, item in enumerate((data or {}).get("results") or []):
        genus = item.get("genus")
        if genus:
            counts[genus] += 1
            first.setdefault(genus, index)
    return sorted(counts, key=lambda g: (-counts[g], first[g]))[:limit]
