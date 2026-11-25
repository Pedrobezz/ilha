# Ilha

Uma "ilha dinâmica" para o Windows: fica no topo da tela, no centro, como o notch do MacBook. Passe o mouse em cima e ela se abre num painel de vidro com animação de mola.

## Instalar em qualquer PC (mais fácil)

1. No GitHub, abra este repositório e clique em **Releases** (lado direito da página), ou acesse `github.com/Pedrobezz/ilha/releases/latest`.
2. Baixe o arquivo **Ilha-Setup-<versão>.exe** (não precisa baixar o ZIP do código).
3. Dê dois cliques. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo** (o app não tem assinatura digital paga).
4. Pronto: instala em um clique, cria atalhos e abre a Ilha. Não precisa de Node, npm nem nada instalado.
5. A partir da 1.8, a Ilha **se atualiza sozinha**: procura versão nova ao abrir e a cada 6 horas, baixa em segundo plano e avisa "Atualização pronta" com o botão **Reiniciar** (ou instala quando você sair). Em *Ajustes → Atualizações* dá para procurar na hora.

Para os avisos do Claude Code nesse outro PC: abra a Ilha e clique em **Conectar ao Claude Code** (aba Claude, ou *Ajustes → Claude Code*). Depois feche e abra o Claude Code de novo.

## Gerar o instalador (desenvolvimento)

- Rode `npm run dist` e abra **`dist/Ilha-Setup-<versão>.exe`**: instala em um clique, cria atalho no menu Iniciar e na área de trabalho, e abre a Ilha. Para desinstalar: Configurações do Windows → Aplicativos → Ilha.
- **Publicar uma versão:** suba o `version` no `package.json` e rode `npm run release`. Ele gera o instalador e cria a release `v<versão>` no GitHub com os 3 arquivos que a atualização automática precisa: `Ilha-Setup-<versão>.exe`, `.exe.blockmap` e `latest.yml`. Sem o `latest.yml` na release, as Ilhas instaladas não enxergam a versão nova.
- `npm run icon` gera de novo o ícone (`build/icon.ico`).

## Abrir (desenvolvimento)

- Dê dois cliques em **`iniciar.vbs`** (abre sem janela de console), ou rode `npm start`.
- Atalho: **Ctrl + Alt + Espaço** abre e fecha. **Esc** fecha. Com a ilha aberta pelo atalho, **comece a digitar** para abrir a barra de comandos (ou clique na lupa ao lado do relógio).
- Ícone na bandeja (perto do relógio): clique para abrir, botão direito para opções e **Sair**.

## Como ela se comporta

- Fica sempre por cima de todas as janelas e não rouba o foco ao clicar (só pega o teclado quando você clica num campo de texto).
- Quando uma janela está **maximizada ou em tela cheia** (Chrome, jogos, vídeos), a ilha sobe e some. Passe o mouse onde ela estaria e ela abre mesmo assim. Dá para desligar em Ajustes.
- Com algo acontecendo, a ilha fechada vira uma **atividade ao vivo**: música tocando (capa + equalizador), timer de foco (contagem) ou teste de internet (velocidade).
- **Ponto de microfone/câmera** em uso (laranja/verde, como no iPhone), com botão para silenciar o microfone no topo do painel.
- **Downloads ao vivo** (Chrome, Edge, Firefox): progresso na ilha e, no fim, botões Abrir e Mostrar.
- **Pulsa com a música:** a ilha brilha no ritmo do som do PC, na cor da capa do álbum (dá para desligar em Ajustes).
- **Bateria dos aparelhos Bluetooth** conectados (fones, teclado, mouse).
- **Indicador de volume** estilo iPhone ao usar as teclas de volume, e **avisos ao vivo**: carregador, bateria fraca, internet caiu/voltou e regras do SmartHouse que dispararam.
- **Em chamada:** Teams, Discord, Zoom, Slack, WhatsApp e chamadas no navegador (Meet, Teams web) viram atividade ao vivo, com o app, o tempo de chamada e um botão para silenciar o microfone sem abrir o painel. No fim, avisa quanto durou. Uma chamada no navegador com reunião da agenda no horário aparece com o nome do serviço (ex.: Google Meet).
- **Notificações do Windows na ilha:** WhatsApp, Discord, e-mail e qualquer app que mande notificação aparecem num aviso com o ícone do app, o texto e os botões **Abrir** e **Silenciar** (aquele app para de aparecer; *Ajustes → Notificações do Windows → Mostrar de novo* desfaz). Não interrompe quem está usando o painel: espera fechar. Dá para desligar em Ajustes, e aí a Ilha nem lê as notificações.
- **Gestos na ilha fechada:** rolar o mouse em cima muda o volume (5% por clique da rodinha), rolar de lado (ou Shift + rolar) troca de faixa, e o botão do meio pausa/toca. Como a ilha abre ao passar o mouse, rolar logo em seguida ainda conta como gesto.
- **Barra de comandos:** abre apps (todos do menu Iniciar, inclusive os da Store), faz contas (`12*3,5`, `200 + 15%`), converte unidades (`5 km em mi`, `30 c em f`, `1,5 gb em mb`) e moedas pela cotação do Banco Central Europeu (`100 usd em brl`, `dólar`, `50 euro`), abre sites e favoritos, e faz ações da ilha: `timer 10`, `nota comprar pão`, `print`, `teste de internet`, `mudo`, `microfone`, `wifi`, abas (`casa`, `claude`…). Se nada servir, pesquisa no Google. Enter copia resultados; os apps mais usados sobem na lista.

## Avisos do Claude Code

A Ilha mostra quando o Claude Code **termina** uma resposta (aviso compacto) e quando ele **pede permissão** ou espera você (alerta com som).

**Para ligar:** clique em **Conectar ao Claude Code** (aba Claude ou *Ajustes → Claude Code*) e abra o Claude Code de novo. O botão acrescenta os hooks abaixo em `~/.claude/settings.json` sem mexer no resto (guarda uma cópia em `settings.json.ilha-backup`), não duplica se já estiver conectado e não troca uma linha de status que você já use. **Desconectar** tira só o que é da Ilha.

Funciona por hooks do Claude Code (`Stop` e `Notification`), que enviam o evento para `http://127.0.0.1:47823/claude`:

```json
{ "type": "command", "command": "curl -s -m 2 -o /dev/null -X POST -H \"x-ilha-key: $(cat ~/.ilha/claude-key 2>/dev/null)\" -H \"content-type: application/json\" --data-binary @- http://127.0.0.1:47823/claude 2>/dev/null || true" }
```

Além disso, hooks `UserPromptSubmit` e `PreToolUse` (assíncronos, não atrasam o Claude) mostram **o que ele está fazendo** e há quanto tempo, e a `statusLine` repassa os **limites do plano** (sessão de 5 h e semanal) e o contexto. Os tokens vêm do histórico da conversa. Tudo aparece na aba **Claude** e, com a ilha fechada, como atividade ao vivo.

O hook `PermissionRequest` mostra os pedidos de permissão na ilha com **Permitir** e **Negar**; sem resposta em 30 s, o Claude mostra o pedido normal dele.

O receptor só aceita conexões do próprio PC e exige a chave, que a Ilha grava em `~/.ilha/claude-key` (fora do `%APPDATA%`, porque o app do Claude para Windows é empacotado e enxerga outra cópia do `%APPDATA%`). Com a Ilha fechada, o hook não faz nada.

## Abas

- **Início:** relógio, semana, próximo compromisso da agenda (clique para ver a agenda), brilho do monitor, clima (clique para ver as próximas 12 horas e 7 dias), música/vídeo tocando com controles, barra clicável para avançar e volume real do Windows, CPU, RAM, bateria e rede, e botões de Wi-Fi e Bluetooth.
- **Internet:** teste de velocidade (ping, variação, download e upload) pelos servidores da Cloudflare, com provedor e histórico, e monitor de quedas (verifica a conexão a cada 5 s e registra quando caiu e por quanto tempo).
- **Sistema:** gráficos ao vivo de CPU, memória e rede, discos, bateria e dados do PC.
- **Casa:** favoritos (estrela) aparecem primeiro, gráfico de consumo das últimas 24 h, e controla o **SmartHouse** (interruptores tecla por tecla, tomadas, ar-condicionado com temperatura, cenas). Se o SmartHouse estiver neste PC, conecta sozinho; em outro PC, cole o link do QR code de *Ajustes → Celular*. O acesso pelo celular precisa estar ativo no SmartHouse.
- **Foco:** timer/pomodoro com aviso, histórico da área de transferência (clique para copiar de novo) e notas rápidas.
- **Claude:** resumo do dia (tarefas, tempo, tokens, commits), status dos testes do GitHub (avisa quando falha), o que o Claude Code está fazendo, tempo na tarefa, tokens da tarefa e da sessão, uso da sessão (5 h), semanal e contexto, e o histórico de ações.
- **Atalhos:** print de uma área da tela (botão Print ou Ctrl+Alt+P, vai direto para a prateleira), prateleira (arraste arquivos até a ilha para guardar e depois arraste para qualquer lugar) e favoritos (apps, pastas, arquivos e sites com um clique).
- **Ajustes:** transparência, temas em degradê, estilo da ilha fechada (notch colado no topo ou flutuante, preta ou com o tema, opacidade), monitor (principal ou o do mouse), avisos ao vivo, cidade do clima, agenda (link iCal do Google Agenda ou Outlook, com aviso 10 min antes e botão Entrar), esconder com janela maximizada, iniciar com o Windows, notificações do Windows, gestos, atualizações, link do SmartHouse.

## Arquivos

- `main.js`: janela, hover, bandeja, teste de internet, ponte com o SmartHouse.
- `helper.ps1`: ajudante nativo (detecta janela maximizada, lê a mídia do Windows e as notificações, mede rede e disco, teclas de mídia).
- `build/release.js`: publica a versão no GitHub Releases (`npm run release`).
- `renderer/`: interface (HTML, CSS e JS).
- Ajustes ficam em `%APPDATA%\ilha\ilha.json`.
