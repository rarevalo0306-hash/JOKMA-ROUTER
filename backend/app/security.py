import hashlib
import secrets

from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings


def hash_api_key(raw_key: str) -> str:
    """SHA-256 hex digest. Internal keys are random, so this is a lookup key."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    raw = "ak_" + secrets.token_urlsafe(32)
    return raw, hash_api_key(raw), raw[:12]


def secrets_equal(left: str, right: str) -> bool:
    try:
        return secrets.compare_digest(left.encode(), right.encode())
    except (TypeError, ValueError):
        return False


def _fernet(settings: Settings) -> Fernet:
    try:
        return Fernet(settings.router_secret_key.encode())
    except (ValueError, TypeError) as exc:
        raise RuntimeError(
            "ROUTER_SECRET_KEY must be a Fernet key. Generate one with: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        ) from exc


def encrypt_secret(settings: Settings, plaintext: str) -> str:
    return _fernet(settings).encrypt(plaintext.encode()).decode()


def decrypt_secret(settings: Settings, ciphertext: str | None) -> str | None:
    if not ciphertext:
        return None
    try:
        return _fernet(settings).decrypt(ciphertext.encode()).decode()
    except (InvalidToken, RuntimeError) as exc:
        raise RuntimeError("provider secret could not be decrypted") from exc


def scrub(text: str, secret: str | None) -> str:
    if secret and secret in text:
        return text.replace(secret, "***")
    return text
