# Instalação e configuração

## Aplicativo

Baixe o instalador Windows x64 em [Releases](https://github.com/felipesantos-svg/cocou-ads/releases), execute-o e abra Cocou Ads. O WebView2 pode precisar de instalação com acesso à internet. A versão pública não migra credenciais da instalação Coucou existente.

Para conferir o arquivo baixado, compare o resultado com `SHA256SUMS.txt` da mesma release:

```powershell
Get-FileHash .\Cocou-Ads-Windows-0.2.0-setup.exe -Algorithm SHA256
```

## Meta Ads

Abra Gestão de tráfego → Meta ao vivo. Informe um token de acesso autorizado com `ads_read`, valide e salve. **A chave secreta do aplicativo Meta não é um token.** O titular do token precisa ter acesso às contas dos clientes. Marque as contas desejadas e aplique a seleção.

Os relatórios usam a moeda e o fuso de cada conta. Os objetivos vêm dos campos oficiais da campanha. Configure limites e amostra mínima nos alertas. Custo por mensagem exige um valor numérico por conta. O fluxo atual usa token manual: ao expirar ou ser revogado, substitua-o. O login Facebook com OAuth público ainda não está implementado.

## Google Agenda

No seu projeto Google Cloud, habilite Google Calendar API, configure a tela de consentimento e crie um cliente OAuth **Aplicativo para computador**. Em ambiente de teste, inclua sua conta nos usuários de teste. Importe o JSON pela configuração da agenda e clique em Conectar com Google.

O login usa retorno local, PKCE e permissões de leitura. Não exige servidor ou domínio HTTPS próprio. O painel apresenta o dia atual e permite alternar esta semana/próxima semana. Por padrão consulta as agendas visíveis; a configuração permite limitar a uma agenda. Até 100 eventos por agenda e período são carregados; cobertura parcial é indicada. Eventos antigos deixam a lista após o dia correspondente, sem serem excluídos do Google. Compromissos que atravessam dias permanecem enquanto estiverem em andamento.

Cada usuário configura seu próprio cliente OAuth. Esta release não oferece um aplicativo OAuth compartilhado/verificado para o público.

## Chat e conhecimento de anúncios

Configure sua chave de API Anthropic e escolha um modelo disponível na conta. A assinatura do aplicativo Claude não substitui uma chave de API. O uso da API pode gerar cobranças do provedor.

O chat inclui referências locais do Claude Ads. Para analisar dados reais, ative **Usar contas Meta selecionadas**: os relatórios dessas contas são enviados à Anthropic junto da pergunta. Não ative para dados de clientes sem a autorização apropriada. O chat não executa alterações em campanhas e não acessa Google Ads real.

## Medidores de uso

Instale e autentique os clientes locais correspondentes: Claude Code, Codex ou Antigravity. Ter apenas o Claude Desktop aberto não garante autenticação no Claude Code. O Cocou Ads consulta limites usando seus próprios adaptadores e não depende do CodeNotch. Indisponibilidade, expiração ou respostas parciais são exibidas na interface; valores em cache podem permanecer sinalizados como antigos.

## Desinstalar

Desative os hooks opcionais de Claude Code pela configuração antes de desinstalar. Use Aplicativos instalados do Windows. Preferências e credenciais podem permanecer; remova as conexões pelo app antes da desinstalação e revogue permissões nos provedores quando desejar. As pastas desta distribuição são `Cocou Ads`, separadas do Coucou original.
