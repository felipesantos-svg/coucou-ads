# Claude Ads no chat

Fonte: https://github.com/AgriciDaniel/claude-ads
Revisão local: ac21644933910419529bcf81efb95a9ca71edf81
Incorporado em 2026-10-01. Licença MIT preservada em LICENSE.

Esta integração incorpora os guias Meta e Google e o framework de raciocínio
ao prompt da API Anthropic em cada pergunta. Não instala o runtime Claude Code,
adaptadores, agentes ou comandos do repositório. Arquivos referenciados pelos
guias, mas ausentes nesta pasta, não estão disponíveis ao modelo.

É uma cópia fixa: não há atualização automática. Afirmações atuais precisam
ser verificadas pela busca web. Requer chave Anthropic nas configurações.

Com acesso Meta ligado na aba, cada pergunta consulta as contas explicitamente
selecionadas em Meta ao vivo, no período de 7, 14 ou 30 dias escolhido no chat.
Os relatórios são enviados à Anthropic para análise; tokens não são enviados.
O snapshot inclui conta, moeda, fuso, campanhas, objetivos, status, datas e
métricas. Falhas de contas e limites de tamanho/tempo são identificados como
cobertura parcial. Não há alteração de campanhas nem acesso Google Ads real.
