"""Account-scoped authentication with an explicit private-network legacy mode.

Production requires an active ApiKey by default. Invalid or missing credentials
never fall through to the default account when NOTIFY_REQUIRE_AUTH is enabled.
The legacy account_id/default contract is available only by explicit opt-out.
"""

from __future__ import annotations

from django.conf import settings
from ninja.errors import HttpError

from accounts.models import Account, ApiKey


def _account_by_key(request) -> Account | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    key_hash = ApiKey.hash_key(auth[7:])
    api_key = (
        ApiKey.objects.select_related("account")
        .filter(key_hash=key_hash, is_active=True, account__is_active=True)
        .first()
    )
    return api_key.account if api_key else None


def _account_by_id(account_id: str | int) -> Account:
    lookup = {"slug": str(account_id)}
    if str(account_id).isdigit():
        lookup = {"pk": int(account_id)}
    account = Account.objects.filter(**lookup).first()
    if account is None:
        raise HttpError(404, f"Conta '{account_id}' não existe.")
    if not account.is_active:
        raise HttpError(403, f"Conta '{account.slug}' está desativada.")
    return account


def resolve_account(request, account_id: str | int | None = None) -> Account:
    """Conta do request: key válida (se houver) > account_id > default."""
    account = _account_by_key(request)
    if account is not None:
        return account
    if getattr(settings, "NOTIFY_REQUIRE_AUTH", True):
        raise HttpError(401, "Credencial de notificacao ausente ou invalida.")
    if account_id:
        return _account_by_id(account_id)
    from accounts.bootstrap import ensure_default_account

    account, _created = ensure_default_account()
    default_slug = account.slug
    if not account.is_active:
        raise HttpError(403, f"Conta default '{default_slug}' está desativada.")
    return account


from ninja.security import HttpBearer


class VpnBearerAuth(HttpBearer):
    """Autenticador nativo do Django Ninja para ambiente VPN / Sem Chave.

    - Documenta 'BearerAuth' automaticamente no OpenAPI / Swagger.
    - Se houver token Bearer válido, autentica a conta da chave.
    - Se o token for omitido ou inválido, resolve via payload/query (account_id) ou conta default.
    - Injeta a instância Account diretamente em request.auth.
    """

    openapi_name = "BearerAuth"

    def authenticate(self, request, token: str) -> Account | None:
        if token:
            key_hash = ApiKey.hash_key(token)
            api_key = (
                ApiKey.objects.select_related("account")
                .filter(key_hash=key_hash, is_active=True, account__is_active=True)
                .first()
            )
            if api_key:
                return api_key.account
        return None

    def __call__(self, request):
        headers = request.headers
        auth = headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:].strip()
            account = self.authenticate(request, token)
            if account:
                return account

        # Se não houver Bearer válido, tenta account_id via query param ou body JSON
        account_id = request.GET.get("account_id")
        if not account_id and request.body:
            try:
                import json

                body_data = json.loads(request.body.decode("utf-8"))
                if isinstance(body_data, dict):
                    account_id = body_data.get("account_id")
            except Exception:
                pass

        return resolve_account(request, account_id)


def api_key_auth(request, account_id: str | int | None = None) -> Account:
    """Compat: os call-sites antigos ganham o novo comportamento sem key."""
    if account_id is None and getattr(request, "auth", None) is not None:
        if isinstance(request.auth, Account):
            return request.auth
    return resolve_account(request, account_id)
