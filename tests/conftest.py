"""Fixtures for The Green Finger tests.

The pure logic tests (test_logic.py) run anywhere. The integration tests need
pytest-homeassistant-custom-component (and the Python version current Home Assistant requires).
"""
from __future__ import annotations

import importlib.util

import pytest

HAS_HA_PLUGIN = importlib.util.find_spec("pytest_homeassistant_custom_component") is not None

if HAS_HA_PLUGIN:
    pytest_plugins = "pytest_homeassistant_custom_component"
else:
    collect_ignore = ["test_integration.py", "test_sensor_rules.py", "test_search.py"]


if HAS_HA_PLUGIN:

    @pytest.fixture(autouse=True)
    def auto_enable_custom_integrations(enable_custom_integrations):
        """Allow the integration under test to load."""
        yield
