from pathlib import Path

from mail import templates
from mail.client import get_client_from_identity
from seed import io as seed_io


def test_supletivo_template_has_its_own_identity():
    html = templates.render("supletivo", title="Matrícula confirmada", content="Tudo certo.")

    assert "Supletivo <span" in html
    assert "https://app.supletivo.net.br" in html
    assert "https://supletivo.net.br/privacidade/" in html


def test_legacy_student_templates_use_supletivo_shell():
    assert templates.render("welcome", title="Bem-vindo", content="Olá") == templates.render(
        "supletivo", title="Bem-vindo", content="Olá"
    )


def test_sender_name_can_follow_the_brand():
    class Identity:
        smtp_host = "smtp.example.com"
        smtp_port = 587
        smtp_user = "user"
        smtp_password = "secret"
        from_email = "noreply@supletivo.net.br"
        from_name = "Nome padrão"
        timeout = 10

    client = get_client_from_identity(Identity(), from_name="Supletivo Brasil")

    assert client.from_header == "Supletivo Brasil <noreply@supletivo.net.br>"


def test_seed_assigns_every_event_to_a_brand():
    seed_path = Path(__file__).resolve().parents[1] / "seed" / "templates.md"
    specs = seed_io.parse(seed_path.read_text(encoding="utf-8"))

    # Com a consolidação de marca canônica (AGENTS.md §4: Supletivo Brasil), todos os templates usam 'supletivo'
    assert all(spec.mail_template == "supletivo" for spec in specs)
