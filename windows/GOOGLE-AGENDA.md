# Google Agenda

Consulte [Instalação e configuração](../docs/INSTALACAO.md#google-agenda) e [Privacidade](../docs/PRIVACIDADE.md). A implementação usa retorno local, PKCE e permissões de leitura de agendas e eventos. Credenciais usam o serviço `app.cocouads.desktop.calendar`.

Testes: `node scripts/calendar.test.mjs` e `cargo test --locked --workspace`. Testes de contas reais são ignorados por padrão.
