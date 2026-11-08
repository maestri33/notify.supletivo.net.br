"""Testes de segurança e controle de acesso ao Dashboard (/dashboard/ e /).

Garante que o dashboard seja estritamente acessível apenas por administradores (is_staff/is_superuser),
com redirecionamento apropriado para /admin/login/ em acessos anônimos ou não-staff,
incluindo suporte ao cabeçalho HX-Redirect para HTMX e liberação dos scripts estáticos vendor.
"""

import pytest
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.test import override_settings


@pytest.fixture
def admin_user(db):
    return User.objects.create_superuser(
        username="admin_test",
        email="admin_test@supletivo.net.br",
        password="super-secret-password-123"
    )


@pytest.fixture
def common_user(db):
    return User.objects.create_user(
        username="client_test",
        email="client_test@supletivo.net.br",
        password="client-password-123",
        is_staff=False,
        is_superuser=False
    )


@pytest.mark.django_db
def test_email_or_username_backend_authenticates(admin_user):
    """Testa se o backend permite autenticar tanto por username quanto por e-mail."""
    # Por username
    u1 = authenticate(username="admin_test", password="super-secret-password-123")
    assert u1 is not None
    assert u1.username == "admin_test"

    # Por email
    u2 = authenticate(username="admin_test@supletivo.net.br", password="super-secret-password-123")
    assert u2 is not None
    assert u2.username == "admin_test"

    # Senha errada
    u3 = authenticate(username="admin_test", password="wrong-password")
    assert u3 is None


@pytest.mark.django_db
@override_settings(NOTIFY_DASHBOARD_REQUIRE_ADMIN=True)
def test_anonymous_access_to_dashboard_redirects_to_login(client, account):
    """Usuário anônimo acessando o dashboard deve ser redirecionado (302) para o admin login."""
    rotas = [
        "/",
        "/dashboard/",
        "/dashboard/whatsapp/",
        "/dashboard/email/",
        "/dashboard/messages/",
        "/dashboard/inbox/",
        "/dashboard/webhooks/",
        "/dashboard/settings/",
        "/dashboard/setup/",
    ]
    for rota in rotas:
        resp = client.get(rota)
        assert resp.status_code == 302, f"Rota {rota} deveria redirecionar 302"
        assert "/admin/login/?next=" in resp.url, f"Redirect incorreto: {resp.url}"


@pytest.mark.django_db
@override_settings(NOTIFY_DASHBOARD_REQUIRE_ADMIN=True)
def test_anonymous_htmx_request_receives_hx_redirect(client):
    """Requisições HTMX anônimas devem receber cabeçalho HX-Redirect para navegação completa."""
    resp = client.get("/dashboard/whatsapp/", HTTP_HX_REQUEST="true")
    assert resp.status_code == 200
    assert "HX-Redirect" in resp.headers
    assert "/admin/login/?next=" in resp.headers["HX-Redirect"]


@pytest.mark.django_db
@override_settings(NOTIFY_DASHBOARD_REQUIRE_ADMIN=True)
def test_static_vendor_assets_are_exempt(client):
    """Scripts vendor do dashboard devem ser acessíveis sem redirecionamento."""
    for asset in ["/dashboard/htmx.js", "/dashboard/alpine.js"]:
        resp = client.get(asset)
        assert resp.status_code == 200


@pytest.mark.django_db
@override_settings(NOTIFY_DASHBOARD_REQUIRE_ADMIN=True)
def test_non_staff_user_is_redirected_to_login(client, common_user, account):
    """Usuário autenticado comum (sem flag de staff) deve ser bloqueado do dashboard."""
    client.force_login(common_user)
    resp = client.get("/dashboard/")
    assert resp.status_code == 302
    assert "/admin/login/?next=" in resp.url


@pytest.mark.django_db
@override_settings(NOTIFY_DASHBOARD_REQUIRE_ADMIN=True)
def test_admin_user_has_full_dashboard_access(client, admin_user, account):
    """Administrador autenticado tem acesso livre e com status 200 a todas as áreas."""
    client.force_login(admin_user)
    rotas = [
        f"/?app={account.slug}",
        f"/dashboard/?app={account.slug}",
        f"/dashboard/whatsapp/?app={account.slug}",
        f"/dashboard/email/?app={account.slug}",
        f"/dashboard/messages/?app={account.slug}",
        f"/dashboard/inbox/?app={account.slug}",
        f"/dashboard/webhooks/?app={account.slug}",
        f"/dashboard/settings/?app={account.slug}",
    ]
    for rota in rotas:
        resp = client.get(rota)
        assert resp.status_code == 200, f"Rota {rota} falhou para admin com {resp.status_code}"
