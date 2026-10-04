# Indicadores nativos de IA

O Cocou Ads consulta os limites sem executar o CodeNotch nem ler seus arquivos.

- Claude: leitura da sessão em `CLAUDE_CONFIG_DIR/.credentials.json` ou
  `~/.claude/.credentials.json`, enviada somente ao endpoint HTTPS fixo de uso
  da Anthropic. Sessões vencidas não são enviadas. Perto da expiração, o Cocou Ads inicia
  o Claude Code nativo com entrada vazia, safe mode e sem persistir sessão,
  permitindo que o próprio cliente renove o login. Timeout de 30 segundos,
  intervalo mínimo de 10 minutos entre tentativas e nenhum prompt enviado.
  Se falhar, orienta reconectar o Claude Code CLI, distinguindo-o do Desktop.
- Codex: processo nativo `codex.exe app-server`, com initialize e
  account/rateLimits/read. Usa o login do cliente, sem copiar seus tokens.
  Timeout de 20 segundos e encerramento apenas do processo criado pelo Cocou Ads.
- Antigravity: `agy.exe --sandbox --print-timeout 30s --print /usage`, em console
  oculto, diretório temporário do Cocou Ads, timeout de 70 segundos e JobObject
  para encerrar os processos próprios. Não mantém o IDE aberto.

Consultas são espaçadas em pelo menos cinco minutos por serviço. A interface
consulta o cache nativo a cada 30 segundos, sem sobrepor chamadas. Claude 429
respeita Retry-After. O cache é somente em memória e reinicia junto com o app.
Falhas preservam a última leitura com aviso de desatualização; sem leitura,
mostra indisponibilidade. Os clientes locais precisam estar instalados e logados.

Os anéis mostram uso de limites, não contagem exata de tokens. Codex usa somente
primary do bucket codex, nunca substitui por Spark ou revisão. Antigravity
converte percentual restante em usado, separando famílias e períodos.
Tokens e respostas brutas não são enviados ao frontend, logs ou chat.

As implementações de transporte Codex e ConPTY Antigravity foram adaptadas do
CodeNotch (MIT); atribuição em public/provider-icons/CODENOTCH-LICENSE.
Os ícones têm atribuição LobeHub na mesma pasta.

Referências:
- https://learn.chatgpt.com/docs/app-server
- https://www.antigravity.google/docs/cli/headless
- https://github.com/vinzdg/codenotch/tree/main/windows/codenotch/src

Validação: testes de parsers para campos ausentes, zero real, aliases e bucket
Codex; consultas reais dos três provedores confirmadas nesta máquina.
