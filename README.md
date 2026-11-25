# Ilha

Uma "ilha dinâmica" para o Windows: fica no topo da tela, no centro, como o notch do MacBook. Passe o mouse em cima e ela se abre num painel de vidro com animação de mola.

## Instalar

- Rode `npm run dist` e abra **`dist/Ilha-Setup-<versão>.exe`**: instala em um clique, cria atalho no menu Iniciar e na área de trabalho, e abre a Ilha. Para desinstalar: Configurações do Windows → Aplicativos → Ilha.
- `npm run icon` gera de novo o ícone (`build/icon.ico`).

## Abrir (desenvolvimento)

- Dê dois cliques em **`iniciar.vbs`** (abre sem janela de console), ou rode `npm start`.
- Atalho: **Ctrl + Alt + Espaço** abre e fecha. **Esc** fecha.
- Ícone na bandeja (perto do relógio): clique para abrir, botão direito para opções e **Sair**.

## Como ela se comporta

- Fica sempre por cima de todas as janelas e não rouba o foco ao clicar (só pega o teclado quando você clica num campo de texto).
- Quando uma janela está **maximizada ou em tela cheia** (Chrome, jogos, vídeos), a ilha sobe e some. Passe o mouse onde ela estaria e ela abre mesmo assim. Dá para desligar em Ajustes.
- Com algo acontecendo, a ilha fechada vira uma **atividade ao vivo**: música tocando (capa + equalizador), timer de foco (contagem) ou teste de internet (velocidade).
- **Indicador de volume** estilo iPhone ao usar as teclas de volume, e **avisos ao vivo**: carregador, bateria fraca, internet caiu/voltou e regras do SmartHouse que dispararam.

## Avisos do Claude Code

A Ilha mostra quando o Claude Code **termina** uma resposta (aviso compacto) e quando ele **pede permissão** ou espera você (alerta com som). Funciona por hooks do Claude Code em `~/.claude/settings.json` (`Stop` e `Notification`), que enviam o evento para `http://127.0.0.1:47823/claude`:

```json
{ "type": "command", "command": "curl -s -m 2 -o /dev/null -X POST -H \"x-ilha-key: $(cat ~/.ilha/claude-key 2>/dev/null)\" -H \"content-type: application/json\" --data-binary @- http://127.0.0.1:47823/claude 2>/dev/null || true" }
```

Além disso, hooks `UserPromptSubmit` e `PreToolUse` (assíncronos, não atrasam o Claude) mostram **o que ele está fazendo** e há quanto tempo, e a `statusLine` repassa os **limites do plano** (sessão de 5 h e semanal) e o contexto. Os tokens vêm do histórico da conversa. Tudo aparece na aba **Claude** e, com a ilha fechada, como atividade ao vivo.

O receptor só aceita conexões do próprio PC e exige a chave, que a Ilha grava em `~/.ilha/claude-key` (fora do `%APPDATA%`, porque o app do Claude para Windows é empacotado e enxerga outra cópia do `%APPDATA%`). Com a Ilha fechada, o hook não faz nada.

## Abas

- **Início:** relógio, semana, clima (clique para ver as próximas 12 horas e 7 dias), música/vídeo tocando com controles, barra clicável para avançar e volume real do Windows, CPU, RAM, bateria e rede, e botões de Wi-Fi e Bluetooth.
- **Internet:** teste de velocidade (ping, variação, download e upload) pelos servidores da Cloudflare, com provedor e histórico, e monitor de quedas (verifica a conexão a cada 5 s e registra quando caiu e por quanto tempo).
- **Sistema:** gráficos ao vivo de CPU, memória e rede, discos, bateria e dados do PC.
- **Casa:** favoritos (estrela) aparecem primeiro, gráfico de consumo das últimas 24 h, e controla o **SmartHouse** (interruptores tecla por tecla, tomadas, ar-condicionado com temperatura, cenas). Se o SmartHouse estiver neste PC, conecta sozinho; em outro PC, cole o link do QR code de *Ajustes → Celular*. O acesso pelo celular precisa estar ativo no SmartHouse.
- **Foco:** timer/pomodoro com aviso, histórico da área de transferência (clique para copiar de novo) e notas rápidas.
- **Claude:** o que o Claude Code está fazendo, tempo na tarefa, tokens da tarefa e da sessão, uso da sessão (5 h), semanal e contexto, e o histórico de ações.
- **Atalhos:** prateleira (arraste arquivos até a ilha para guardar e depois arraste para qualquer lugar) e favoritos (apps, pastas, arquivos e sites com um clique).
- **Ajustes:** transparência, temas em degradê, estilo da ilha fechada (notch colado no topo ou flutuante, preta ou com o tema, opacidade), monitor (principal ou o do mouse), avisos ao vivo, cidade do clima, esconder com janela maximizada, iniciar com o Windows, link do SmartHouse.

## Arquivos

- `main.js`: janela, hover, bandeja, teste de internet, ponte com o SmartHouse.
- `helper.ps1`: ajudante nativo (detecta janela maximizada, lê a mídia do Windows, mede rede e disco, teclas de mídia).
- `renderer/`: interface (HTML, CSS e JS).
- Ajustes ficam em `%APPDATA%\ilha\ilha.json`.
