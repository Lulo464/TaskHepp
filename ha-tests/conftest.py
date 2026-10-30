"""Tests for the Tasklog integration against a running Tasklog (TASKLOG_URL, TASKLOG_TOKEN)."""

import os

import pytest
import pytest_socket


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Lets Home Assistant load custom_components/tasklog."""
    return


@pytest.fixture
def tasklog():
    url, token = os.environ.get("TASKLOG_URL"), os.environ.get("TASKLOG_TOKEN")
    if not url or not token:
        pytest.skip("TASKLOG_URL and TASKLOG_TOKEN point the tests at a running Tasklog")
    # Home Assistant's test plugin blocks all sockets; these tests talk to a real Tasklog on purpose.
    pytest_socket.enable_socket()
    return {"url": url, "api_token": token}
