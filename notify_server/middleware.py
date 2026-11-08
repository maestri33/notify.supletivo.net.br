"""Correlation-id ponta a ponta (J1).

Cada request ganha (ou propaga) um `X-Request-ID`; o id entra no contexto do
structlog e sai em TODA linha de log do request. O send() grava o id no caller
implícito? Não — o elo com a fila é o `external_id` da Notification, que o
dispatch também binda. Requisição → fila → provider, tudo rastreável.
"""

from __future__ import annotations

import uuid

import structlog


class CorrelationIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        rid = (request.headers.get("X-Request-ID") or "").strip() or uuid.uuid4().hex[:16]
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=rid)
        request.request_id = rid
        response = self.get_response(request)
        response["X-Request-ID"] = rid
        return response


class CorsMiddleware:
    """Permite requisições de dashboard desacoplado (Pages / SPA) sem bloqueio CORS."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "OPTIONS":
            from django.http import HttpResponse
            response = HttpResponse()
        else:
            response = self.get_response(request)

        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Account-Slug, X-Priority-Queue, X-Request-ID"
        return response


class DashboardAdminRequiredMiddleware:
    """Protege todas as rotas do dashboard (/dashboard/...) e a raiz (/)
    exigindo que o usuário esteja autenticado e tenha status de staff/superuser.

    - Requisições HTMX: recebem cabeçalho HX-Redirect para redirecionamento full-page.
    - Requisições de navegador: redirecionam (302) para /admin/login/?next=...
    - Chamadas com Bearer API Key válida: liberadas para automação/monitoramento.
    - Assets estáticos (/dashboard/htmx.js, /dashboard/alpine.js): liberados.
    """

    EXEMPT_PATHS = {
        "/dashboard/htmx.js",
        "/dashboard/alpine.js",
    }

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.conf import settings

        if not getattr(settings, "NOTIFY_DASHBOARD_REQUIRE_ADMIN", True):
            return self.get_response(request)

        path = request.path
        is_dashboard_route = path == "/" or path.startswith("/dashboard/") or path == "/webhook/stream"

        if is_dashboard_route and path not in self.EXEMPT_PATHS:
            user = getattr(request, "user", None)
            is_staff = bool(user and user.is_authenticated and (user.is_staff or user.is_superuser))

            if not is_staff:
                # Permite chamadas com Authorization Bearer se tiver chave válida
                auth = request.headers.get("Authorization", "")
                if auth.startswith("Bearer "):
                    token = auth[7:].strip()
                    admin_key = getattr(settings, "EVOLUTION_GO_ADMIN_KEY", "")
                    if admin_key and token == admin_key:
                        return self.get_response(request)

                    from accounts.models import ApiKey
                    key_hash = ApiKey.hash_key(token)
                    if ApiKey.objects.filter(key_hash=key_hash, is_active=True).exists():
                        return self.get_response(request)

                login_url = f"/admin/login/?next={request.get_full_path()}"

                # Redirecionamento amigável para chamadas HTMX
                if request.headers.get("HX-Request") == "true":
                    from django.http import HttpResponse
                    resp = HttpResponse(status=200)
                    resp["HX-Redirect"] = login_url
                    return resp

                from django.shortcuts import redirect
                return redirect(login_url)

        return self.get_response(request)


