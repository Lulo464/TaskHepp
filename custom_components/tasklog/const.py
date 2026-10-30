"""Constants for the Tasklog integration."""

from datetime import timedelta

DOMAIN = "tasklog"
SCAN_INTERVAL = timedelta(seconds=30)
# Done tickets stay visible (ticked off) for a while, as in other to-do lists.
DONE_VISIBLE_FOR = timedelta(days=2)
