# 🔊 Leitor em Voz Alta

**Desenvolvido por Francis Nascimento.**

Extensão para Chrome/Edge (Manifest V3) que lê páginas, PDFs e textos selecionados, começando de onde você clicar,
com a frase e a palavra atuais destacadas na página.
Todo o processamento é local: nenhum texto é enviado para servidores.

## Recursos
- Player no popup com o texto, frase atual destacada e clique em qualquer frase para pular
- ⏮ ⏯ ⏭, repetir frase, barra de progresso clicável
- "Ler daqui em diante" a partir da palavra clicada, inclusive dentro de iframes (plataformas de curso)
- Leitura de PDF com pdf.js (Mozilla)
- Detecta o conteúdo principal e pula menus, rodapés e barras laterais
- Velocidade (0,5x a 3x), tom e escolha de voz, aplicados na hora

## Atalhos
| Atalho | Ação |
|---|---|
| Alt+Shift+D | Ler daqui em diante |
| Alt+Shift+P | Ler / pausar / continuar |
| Alt+Shift+← / → | Frase anterior / próxima |

## Instalação
1. `chrome://extensions` (ou `edge://extensions`) → ative o **Modo do desenvolvedor**
2. **Carregar sem compactação** → selecione esta pasta

## Estrutura
- `background.js` — motor: estado do player, fila de frases, extração de texto das abas e iframes
- `frases.js` — divisão em frases e reconstrução de parágrafos de PDF
- `offscreen.html/js` — documento invisível que roda o pdf.js
- `popup.html/js` — interface do player
- `marcador.js` — guarda onde você clicou/selecionou por último (para o "Ler daqui em diante")
- `lib/` — pdf.js (licença Apache 2.0)

## Autor e licença
© 2026 Francis Nascimento — licença MIT (veja `LICENSE`). Inclui pdf.js © Mozilla, licença Apache 2.0.
