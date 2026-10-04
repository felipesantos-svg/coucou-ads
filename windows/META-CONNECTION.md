# Conexão Meta

Consulte [Instalação e configuração](../docs/INSTALACAO.md#meta-ads) e [Privacidade](../docs/PRIVACIDADE.md). A implementação usa leituras HTTPS da Graph API v26.0 e token próprio com `ads_read`, no serviço `app.cocouads.desktop.ads`.

Seleção por caixas preserva a escolha local; a consulta mantém contas, moedas, objetivos e tipos de ações separados. Sem preferência, são oferecidas contas ativas. Seleção vazia é respeitada.

Alertas iniciais: ROAS < 5 e CTR < 1%, com mínimo ajustável de 1.000 impressões. Custo por mensagem exige limite numérico por conta. CTR considera cliques totais/impressões. ROAS usa website_purchase_roas para offsite_conversion.fb_pixel_purchase quando disponível e em objetivos de vendas. Mensagens usam onsite_conversion.messaging_conversation_started_7d. Ausência de métrica não é zero. Dados com mais de 24 horas e campanhas pausadas não disparam alertas.

As consultas ocorrem por solicitação; não há monitoramento contínuo ou alterações de campanhas. O chat pode enviar os relatórios das contas selecionadas à Anthropic quando essa opção está ativada. Google Ads real e OAuth Facebook público não estão implementados.

Testes de modelos: `node scripts/meta.test.mjs` e `node scripts/alerts.test.mjs`. Testes de contas reais são ignorados por padrão e exigem credenciais e autorização específica, fora do CI.
