"""Shared errors for existing-installation update orchestration."""

from .update_transaction import TransactionFailure


class ExistingInstallationError(TransactionFailure):
    """The orchestration cannot safely advance or reconcile."""
