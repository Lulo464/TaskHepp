"""Fetches areas and tickets from Tasklog every 30 seconds."""

from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import TasklogApi, TasklogAuthError, TasklogError
from .const import DOMAIN, SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)

type TasklogConfigEntry = ConfigEntry[TasklogCoordinator]


@dataclass
class TasklogData:
    areas: list[dict[str, Any]]
    tickets: list[dict[str, Any]]


class TasklogCoordinator(DataUpdateCoordinator[TasklogData]):
    """Keeps the latest areas and tickets for the to-do lists."""

    config_entry: TasklogConfigEntry

    def __init__(self, hass: HomeAssistant, entry: TasklogConfigEntry, api: TasklogApi) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self.api = api

    async def _async_update_data(self) -> TasklogData:
        try:
            return TasklogData(areas=await self.api.areas(), tickets=await self.api.tickets())
        except TasklogAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except TasklogError as err:
            raise UpdateFailed(str(err)) from err
