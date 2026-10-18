class PremiumVerificationError(RuntimeError):
    pass


class PremiumUpdateUnavailable(PremiumVerificationError):
    pass
