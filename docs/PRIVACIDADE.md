# Dados e privacidade

Esta distribuição não contém contas ou credenciais pré-configuradas e não inclui um servidor do mantenedor.

| Integração | Dados e destino |
|---|---|
| Meta | Consultas HTTPS à Graph API com token próprio; contas e relatórios retornam ao aplicativo |
| Google Agenda | Autorização Google e leitura de agendas/eventos; os eventos não são enviados ao chat |
| Chat Anthropic | Perguntas, histórico da conversa, arquivos anexados e, quando habilitado, relatórios das contas Meta selecionadas |
| Limites de IA | Credenciais/sessões dos clientes locais usadas pelos adaptadores para consultar o respectivo provedor |
| Integrações originais | Serviços configurados explicitamente pelo usuário |

Credenciais configuradas no Cocou Ads ficam no Gerenciador de Credenciais do Windows, com prefixo `app.cocouads.desktop`. Preferências, seleção de contas e regras podem persistir localmente. Relatórios e eventos ficam em memória; arquivos arrastados para o app são copiados para a pasta local de entrada. Logs técnicos locais e dados armazenados pelos próprios clientes de IA seguem seus mecanismos respectivos.

Não há telemetria adicionada pelo Cocou Ads. Os serviços externos têm suas próprias condições de uso e políticas. Remover uma conexão local não revoga automaticamente uma autorização no provedor. Nunca publique tokens, JSON OAuth, logs com dados pessoais ou relatórios reais em issues.
