# Ilha

Uma "ilha dinâmica" para o Windows: fica no topo da tela, no centro, como o notch do MacBook. Passe o mouse em cima e ela se abre num painel de vidro com animação de mola.

## Abrir

- Dê dois cliques em **`iniciar.vbs`** (abre sem janela de console), ou rode `npm start`.
- Atalho: **Ctrl + Alt + Espaço** abre e fecha. **Esc** fecha.
- Ícone na bandeja (perto do relógio): clique para abrir, botão direito para opções e **Sair**.

## Como ela se comporta

- Fica sempre por cima de todas as janelas e não rouba o foco ao clicar (só pega o teclado quando você clica num campo de texto).
- Quando uma janela está **maximizada ou em tela cheia** (Chrome, jogos, vídeos), a ilha sobe e some. Passe o mouse onde ela estaria e ela abre mesmo assim. Dá para desligar em Ajustes.
- Com algo acontecendo, a ilha fechada vira uma **atividade ao vivo**: música tocando (capa + equalizador), timer de foco (contagem) ou teste de internet (velocidade).

## Abas

- **Início:** relógio, semana, clima (Open-Meteo, cidade detectada sozinha), música/vídeo tocando com controles e volume, CPU, RAM, bateria e rede.
- **Internet:** teste de velocidade (ping, variação, download e upload) pelos servidores da Cloudflare, com provedor e histórico.
- **Sistema:** gráficos ao vivo de CPU, memória e rede, discos, bateria e dados do PC.
- **Casa:** controla o **SmartHouse** (interruptores tecla por tecla, tomadas, ar-condicionado com temperatura, cenas). Se o SmartHouse estiver neste PC, conecta sozinho; em outro PC, cole o link do QR code de *Ajustes → Celular*. O acesso pelo celular precisa estar ativo no SmartHouse.
- **Foco:** timer/pomodoro com aviso, histórico da área de transferência (clique para copiar de novo) e notas rápidas.
- **Ajustes:** cidade do clima, esconder com janela maximizada, iniciar com o Windows, link do SmartHouse.

## Arquivos

- `main.js`: janela, hover, bandeja, teste de internet, ponte com o SmartHouse.
- `helper.ps1`: ajudante nativo (detecta janela maximizada, lê a mídia do Windows, mede rede e disco, teclas de mídia).
- `renderer/`: interface (HTML, CSS e JS).
- Ajustes ficam em `%APPDATA%\ilha\ilha.json`.
