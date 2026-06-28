"""Transaction status predicates — port of src/domain/transactions/status.ts."""


def is_in_flight_status(status: str | None = None) -> bool:
    return status in ("queued", "processing", "merging")


def is_failed_status(status: str | None = None) -> bool:
    return status in ("failed", "merge_failed")


def is_merge_status(status: str | None = None) -> bool:
    return status in ("merging", "merge_failed")
