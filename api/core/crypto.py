from cryptography.fernet import Fernet, MultiFernet
from django.conf import settings

# MultiFernet encrypts with the first key and decrypts with any of them, so APP_SECRET can be
# rotated without orphaning existing ciphertext: add the new key first, keep ENCRYPTION_KEY as
# LEGACY_ENCRYPTION_KEY until every row has been rewritten, then drop it.
_keys = [Fernet(settings.APP_SECRET)]
_legacy = getattr(settings, "LEGACY_ENCRYPTION_KEY", None)
if _legacy and _legacy != settings.APP_SECRET:
    _keys.append(Fernet(_legacy))
fernet = MultiFernet(_keys)

def encypt(value: str) -> str:
    """Encrypts a string using Fernet symmetric encryption"""
    if value is None:
        return None
    return fernet.encrypt(value.encode()).decode()

def decrypt(value: str) -> str:
    """Decrypts a string encrypted with Fernet"""
    if value is None:
        return None
    return fernet.decrypt(value.encode()).decode()