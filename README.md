# Coucou Ads

Assistente de desktop para gestores de tráfego, em português brasileiro. Fica no canto inferior esquerdo e reúne alertas de campanhas, compromissos e limites de uso de IA em uma janela compacta.

**Adaptação independente do [Coucou](https://github.com/Louis-CFM/coucou), criado por [Louis Raillé](https://github.com/Louis-CFM).** O mascote Mochi e a base do aplicativo vêm do projeto original. A licença MIT e os créditos foram preservados. Este projeto não é uma versão oficial do autor original nem dos provedores integrados.

## Instalação no Windows

1. Acesse [Releases](https://github.com/felipesantos-svg/cocou-ads/releases).
2. Baixe `Coucou-Ads-Windows-0.2.0-setup.exe` da versão desejada.
3. Execute o instalador e abra **Cocou Ads** pelo menu Iniciar.
4. Abra a engrenagem para configurar suas próprias integrações.

Requer Windows 10/11 de 64 bits e Microsoft Edge WebView2. O instalador usa a conta atual do Windows. Esta primeira distribuição é experimental e não tem assinatura digital; confira a origem e o SHA-256 da release. Não é necessário desativar o antivírus. Se houver bloqueio, use a compilação a partir do código ou aguarde uma distribuição assinada.

Nenhuma conta, chave ou relatório do mantenedor acompanha o instalador. A configuração é separada da instalação original do Coucou. Veja [instalação e configuração](docs/INSTALACAO.md).

## O que está disponível

| Recurso | Situação |
|---|---|
| Meta Ads | Leitura real com token próprio; seleção de várias contas por caixas |
| Campanhas | Separadas por conta, objetivo e status; sem misturar moedas ou conversões |
| Alertas | ROAS abaixo de 5, CTR abaixo de 1% e custo por mensagem configurável |
| Google Agenda | Hoje, esta semana e próxima semana; compromissos passados saem da visualização |
| Chat | API Anthropic e referências Claude Ads; contexto Meta opcional e explícito |
| Limites de IA | Adaptadores nativos para Claude Code, Codex e Antigravity; não exige CodeNotch |
| Google Ads | Somente demonstração; não há conexão real nesta versão |

Os alertas são avaliados ao consultar relatórios. Não há otimização automática, alteração de campanhas ou monitoramento contínuo do Meta em segundo plano. Os limites de IA dependem da autenticação e disponibilidade dos respectivos clientes locais; dados antigos são sinalizados.

A barra minimizada mede 288 × 50 pixels lógicos, permanece visível quando ociosa e mostra detalhes de uso ao passar o mouse. Integrações originais continuam acessíveis.

## Compilar

Instale Git, Node.js 24 LTS, Rust estável para Windows MSVC e Visual Studio Build Tools com **Desenvolvimento para desktop com C++**, além do WebView2.

```powershell
git clone https://github.com/felipesantos-svg/coucou-ads.git
cd cocou-ads/windows
npm ci
npm run tauri dev
```

Para gerar o instalador:

```powershell
npm run pack
```

O resultado fica em `windows/release/`. `npm run dev` sozinho abre apenas a prévia web; as integrações nativas exigem o aplicativo Tauri.

## Dados e credenciais

Chaves configuradas no aplicativo ficam no Gerenciador de Credenciais do Windows. Preferências ficam em `%APPDATA%\Cocou Ads`; arquivos locais em `%LOCALAPPDATA%\Cocou Ads`. Relatórios e compromissos são consultados com as permissões do usuário. Quando ativado, o contexto Meta do chat envia relatórios à Anthropic, com possível cobrança de API. Consulte [privacidade](docs/PRIVACIDADE.md).

## Créditos e licença

- **Louis Raillé / Louis-CFM** — Coucou, arquitetura original, mascote e recursos de base. [Repositório original](https://github.com/Louis-CFM/coucou).
- **Felipe Santos / felipesantos-svg** — distribuição Cocou Ads e adaptações para gestão de tráfego.
- Claude Ads, CodeNotch e LobeHub — referências e componentes com atribuições em [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Distribuído sob a [licença MIT](LICENSE), com o aviso de copyright original preservado. Nomes e marcas de terceiros identificam integrações e não indicam afiliação.
