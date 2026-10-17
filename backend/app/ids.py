import secrets
import string

_ALPHABET = string.ascii_lowercase + string.digits


def new_id(prefix: str) -> str:
    """Short random ID, e.g. new_id("t") -> "t_k3x9q2ma"."""
    return prefix + "_" + "".join(secrets.choice(_ALPHABET) for _ in range(8))
